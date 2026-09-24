/**
 * Enumerate the skills and slash commands the running agent can load in this session.
 *
 * Claude Code sources, in the order Claude Code itself surfaces them:
 *   ~/.claude/skills/<name>/SKILL.md            user skills
 *   ~/.claude/skills/synced/<bucket>/<name>/    account-synced skills -> "anthropic-skills:<name>"
 *   ~/.claude/plugins/synced/<bucket>/<dir>/    account-synced plugins -> "<plugin>:<skill>"
 *   ~/.claude/skills/<dir>/.claude-plugin/      skills-dir plugins -> "<plugin>:<skill>"
 *   ~/.claude/plugins/installed_plugins.json    marketplace plugins (user scope, or this project)
 *   <cwd>/.claude/skills, .claude/commands, .agents/skills
 *
 * Codex sources, as its session catalog lists them (codex-cli 0.154):
 *   ~/.agents/skills/<name>/SKILL.md            user skills
 *   ~/.codex/skills/.system/<name>/SKILL.md     bundled system skills
 *   ~/.codex/plugins/cache/<mkt>/<plugin>/<ver>/skills/<skill>/           -> "<plugin>:<skill>"
 *   ~/.codex/plugins/cache/<mkt>/<plugin>/<ver>/.codex-plugin/migrated-command-skills/<dir>/ -> "<plugin>:<dir>"
 *   <cwd>/.agents/skills
 * A cached plugin counts only if config.toml does not disable it and its marketplace is still
 * declared there, or it comes from the account-managed remote marketplace. Legacy
 * ~/.codex/skills/<name> and plugin commands/ are not in the Codex catalog and are skipped.
 *
 * Names are namespaced the way each session catalog shows them so a suggestion can be
 * invoked verbatim: a plugin is named by its plugin.json `name`, not its directory, which may
 * carry a generation suffix such as `pdf-viewer~g2`. Entries marked
 * `disable-model-invocation: true` are left out because the catalog hides them from the model.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type RosterKind = 'skill' | 'command';

export interface RosterEntry {
  readonly name: string;
  readonly description: string;
  /** Markdown after the frontmatter, for the shortlist pass. */
  readonly body: string;
  readonly path: string;
  readonly kind: RosterKind;
}

export interface ParsedSkillFile {
  readonly name: string | undefined;
  readonly description: string | undefined;
  /** `disable-model-invocation: true`: only the user can run it, so the model's catalog omits it. */
  readonly disableModelInvocation: boolean;
  readonly body: string;
}

const BODY_CHARS = 2_000;

/** The session catalog shows account-synced user skills under this namespace. */
const SYNCED_SKILLS_PREFIX = 'anthropic-skills:';

/** YAML block-scalar indicators (`description: >-` and friends); the value is the folded lines below. */
const BLOCK_SCALAR = /^[|>][+-]?$/;

/**
 * Minimal frontmatter reader: `key: value` with indented continuation lines folded into one.
 * Block scalars are folded the same way, which is close enough for a description.
 */
export function parseSkillFile(markdown: string): ParsedSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { name: undefined, description: undefined, disableModelInvocation: false, body: markdown.trim().slice(0, BODY_CHARS) };
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const raw of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (kv) {
      current = kv[1]!;
      const value = kv[2]!.trim();
      fields[current] = BLOCK_SCALAR.test(value) ? '' : value;
    } else if (current && /^\s+\S/.test(raw)) {
      fields[current] = `${fields[current]} ${raw.trim()}`.trim();
    }
  }
  const unquote = (v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    const q = /^(['"])([\s\S]*)\1$/.exec(v);
    return (q ? q[2] : v)?.trim() || undefined;
  };
  return {
    name: unquote(fields['name']),
    description: unquote(fields['description']),
    disableModelInvocation: fields['disable-model-invocation'] === 'true',
    body: markdown.slice(match[0].length).trim().slice(0, BODY_CHARS),
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(path: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(suffix)).map((e) => e.name);
  } catch {
    return [];
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function skillEntry(path: string, fallbackName: string, prefix: string, kind: RosterKind): Promise<RosterEntry | undefined> {
  const text = await readOptional(path);
  if (text === undefined) return undefined;
  const parsed = parseSkillFile(text);
  const description = parsed.description;
  if (!description || parsed.disableModelInvocation) return undefined;
  const name = `${prefix}${parsed.name ?? fallbackName}`;
  return { name, description, body: parsed.body, path, kind };
}

/** `<root>/<name>/SKILL.md` for every subdirectory of `root`. */
async function skillsUnder(root: string, prefix = ''): Promise<RosterEntry[]> {
  const out: RosterEntry[] = [];
  for (const dir of await listDirs(root)) {
    const entry = await skillEntry(join(root, dir, 'SKILL.md'), dir, prefix, 'skill');
    if (entry) out.push(entry);
  }
  return out;
}

/** `<root>/<name>.md` slash commands. */
async function commandsUnder(root: string, prefix = ''): Promise<RosterEntry[]> {
  const out: RosterEntry[] = [];
  for (const file of await listFiles(root, '.md')) {
    const entry = await skillEntry(join(root, file), file.slice(0, -3), prefix, 'command');
    if (entry) out.push({ ...entry, name: `${prefix}${file.slice(0, -3)}` });
  }
  return out;
}

/** A plugin's catalog name: plugin.json `name`, else its directory name without a `~suffix`. */
async function pluginName(dir: string, dirName: string): Promise<string> {
  try {
    const name = (JSON.parse((await readOptional(join(dir, '.claude-plugin', 'plugin.json'))) ?? '{}') as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  } catch {
    // fall through to the directory name
  }
  return dirName.replace(/~[^~]*$/, '');
}

async function pluginEntries(installPath: string, pluginName: string): Promise<RosterEntry[]> {
  const prefix = `${pluginName}:`;
  return [...(await skillsUnder(join(installPath, 'skills'), prefix)), ...(await commandsUnder(join(installPath, 'commands'), prefix))];
}

interface InstalledPlugin {
  scope?: string;
  projectPath?: string;
  installPath?: string;
}

async function installedPluginEntries(home: string, cwd: string): Promise<RosterEntry[]> {
  const registryText = await readOptional(join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!registryText) return [];
  const settingsText = await readOptional(join(home, '.claude', 'settings.json'));
  let enabled: Record<string, unknown> = {};
  try {
    enabled = (JSON.parse(settingsText ?? '{}') as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {};
  } catch {
    enabled = {};
  }
  let registry: { plugins?: Record<string, InstalledPlugin[]> };
  try {
    registry = JSON.parse(registryText) as { plugins?: Record<string, InstalledPlugin[]> };
  } catch {
    return [];
  }
  const out: RosterEntry[] = [];
  for (const [key, installs] of Object.entries(registry.plugins ?? {})) {
    if (enabled[key] === false) continue;
    const pluginName = key.split('@')[0]!;
    for (const install of installs) {
      if (!install.installPath) continue;
      const applies = install.scope === 'user' || (install.scope === 'project' && install.projectPath === cwd) || install.scope === undefined;
      if (!applies) continue;
      out.push(...(await pluginEntries(install.installPath, pluginName)));
    }
  }
  return out;
}

async function syncedPluginEntries(home: string): Promise<RosterEntry[]> {
  const root = join(home, '.claude', 'plugins', 'synced');
  const out: RosterEntry[] = [];
  for (const bucket of await listDirs(root)) {
    for (const dir of await listDirs(join(root, bucket))) {
      const path = join(root, bucket, dir);
      out.push(...(await pluginEntries(path, await pluginName(path, dir))));
    }
  }
  return out;
}

async function userSkillEntries(home: string): Promise<RosterEntry[]> {
  const root = join(home, '.claude', 'skills');
  const out: RosterEntry[] = [];
  for (const dir of await listDirs(root)) {
    const path = join(root, dir);
    if (dir === 'synced') {
      for (const bucket of await listDirs(path)) out.push(...(await skillsUnder(join(path, bucket), SYNCED_SKILLS_PREFIX)));
      continue;
    }
    if (await isDir(join(path, '.claude-plugin'))) {
      out.push(...(await pluginEntries(path, await pluginName(path, dir))));
      continue;
    }
    const entry = await skillEntry(join(path, 'SKILL.md'), dir, '', 'skill');
    if (entry) out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------------

/** Codex's account-managed marketplace; its plugins have no config.toml entry and are all active. */
export const CODEX_REMOTE_MARKETPLACE = 'openai-curated-remote';

interface CodexPluginConfig {
  readonly marketplaces: ReadonlySet<string>;
  /** `<plugin>@<marketplace>` -> enabled, for every `[plugins."..."]` table that sets it. */
  readonly enabled: ReadonlyMap<string, boolean>;
}

/**
 * The two things this tool needs from `~/.codex/config.toml`: which marketplaces are declared and
 * which plugins are switched off. A line scanner, not a TOML parser; the file may hold other
 * settings and is never logged.
 */
export function parseCodexConfig(toml: string): CodexPluginConfig {
  const marketplaces = new Set<string>();
  const enabled = new Map<string, boolean>();
  let plugin: string | undefined;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      plugin = undefined;
      const mk = /^marketplaces\.(?:"([^"]+)"|([^.\s]+))$/.exec(header[1]!);
      if (mk) marketplaces.add(mk[1] ?? mk[2]!);
      const pl = /^plugins\."([^"]+)"$/.exec(header[1]!);
      if (pl) plugin = pl[1];
      continue;
    }
    if (!plugin) continue;
    const kv = /^enabled\s*=\s*(true|false)\b/.exec(line);
    if (kv) enabled.set(plugin, kv[1] === 'true');
  }
  return { marketplaces, enabled };
}

async function codexPluginEntries(home: string): Promise<RosterEntry[]> {
  const config = parseCodexConfig((await readOptional(join(home, '.codex', 'config.toml'))) ?? '');
  const cache = join(home, '.codex', 'plugins', 'cache');
  const out: RosterEntry[] = [];
  for (const marketplace of await listDirs(cache)) {
    if (!config.marketplaces.has(marketplace) && marketplace !== CODEX_REMOTE_MARKETPLACE) continue;
    for (const plugin of await listDirs(join(cache, marketplace))) {
      if (config.enabled.get(`${plugin}@${marketplace}`) === false) continue;
      // newest first, so the newest version wins a name; numeric so 10.0.0 sorts above 6.3.0
      const versions = (await listDirs(join(cache, marketplace, plugin))).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const version of versions) {
        const root = join(cache, marketplace, plugin, version);
        out.push(...(await skillsUnder(join(root, 'skills'), `${plugin}:`)));
        out.push(...(await skillsUnder(join(root, '.codex-plugin', 'migrated-command-skills'), `${plugin}:`)));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export type Agent = 'claude' | 'codex' | 'unknown';

export interface LoadRosterOptions {
  readonly home: string;
  readonly cwd: string;
  /** Which harness is running the hook; `unknown` (the default) takes the union of both rosters. */
  readonly agent?: Agent;
}

async function claudeEntries(home: string, cwd: string): Promise<RosterEntry[]> {
  return [
    ...(await userSkillEntries(home)),
    ...(await installedPluginEntries(home, cwd)),
    ...(await syncedPluginEntries(home)),
    ...(await skillsUnder(join(cwd, '.claude', 'skills'))),
    ...(await commandsUnder(join(cwd, '.claude', 'commands'))),
    ...(await skillsUnder(join(cwd, '.agents', 'skills'))),
  ];
}

async function codexEntries(home: string, cwd: string): Promise<RosterEntry[]> {
  return [
    ...(await skillsUnder(join(home, '.agents', 'skills'))),
    ...(await skillsUnder(join(home, '.codex', 'skills', '.system'))),
    ...(await codexPluginEntries(home)),
    ...(await skillsUnder(join(cwd, '.agents', 'skills'))),
  ];
}

export async function loadRoster({ home, cwd, agent = 'unknown' }: LoadRosterOptions): Promise<RosterEntry[]> {
  const all: RosterEntry[] = [];
  if (agent !== 'codex') all.push(...(await claudeEntries(home, cwd)));
  if (agent !== 'claude') all.push(...(await codexEntries(home, cwd)));
  const byName = new Map<string, RosterEntry>();
  for (const entry of all) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  return [...byName.values()];
}
