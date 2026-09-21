/**
 * Enumerate the skills and slash commands Claude Code can load in this session.
 *
 * Sources, in the order Claude Code itself surfaces them:
 *   ~/.claude/skills/<name>/SKILL.md            user skills
 *   ~/.claude/skills/synced/<bucket>/<name>/    account-synced skills -> "anthropic-skills:<name>"
 *   ~/.claude/plugins/synced/<bucket>/<plugin>/  account-synced plugins -> "<plugin>:<skill>"
 *   ~/.claude/skills/<plugin>/.claude-plugin/   skills-dir plugins -> "<plugin>:<skill>"
 *   ~/.claude/plugins/installed_plugins.json    marketplace plugins (user scope, or this project)
 *   <cwd>/.claude/skills, .claude/commands, .agents/skills
 *
 * Names are namespaced the way the session catalog shows them so a suggestion can be
 * invoked verbatim.
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
  readonly body: string;
}

const BODY_CHARS = 2_000;

/** The session catalog shows account-synced user skills under this namespace. */
const SYNCED_SKILLS_PREFIX = 'anthropic-skills:';

/** Minimal frontmatter reader: `key: value` with indented continuation lines folded into one. */
export function parseSkillFile(markdown: string): ParsedSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { name: undefined, description: undefined, body: markdown.trim().slice(0, BODY_CHARS) };
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const raw of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (kv) {
      current = kv[1]!;
      fields[current] = kv[2]!.trim();
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
  if (!description) return undefined;
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
    for (const plugin of await listDirs(join(root, bucket))) out.push(...(await pluginEntries(join(root, bucket, plugin), plugin)));
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
      out.push(...(await pluginEntries(path, dir)));
      continue;
    }
    const entry = await skillEntry(join(path, 'SKILL.md'), dir, '', 'skill');
    if (entry) out.push(entry);
  }
  return out;
}

export interface LoadRosterOptions {
  readonly home: string;
  readonly cwd: string;
}

export async function loadRoster({ home, cwd }: LoadRosterOptions): Promise<RosterEntry[]> {
  const all = [
    ...(await userSkillEntries(home)),
    ...(await installedPluginEntries(home, cwd)),
    ...(await syncedPluginEntries(home)),
    ...(await skillsUnder(join(cwd, '.claude', 'skills'))),
    ...(await commandsUnder(join(cwd, '.claude', 'commands'))),
    ...(await skillsUnder(join(cwd, '.agents', 'skills'))),
  ];
  const byName = new Map<string, RosterEntry>();
  for (const entry of all) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  return [...byName.values()];
}
