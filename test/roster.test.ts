import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFile, loadRoster } from '../src/roster.js';

test('parseSkillFile reads name, folded description and body excerpt', () => {
  const md = `---
name: example
description: Use when the user wants X.
  Continues on a second line.
---

# Example

Body text here.`;
  const parsed = parseSkillFile(md);
  assert.equal(parsed.name, 'example');
  assert.equal(parsed.description, 'Use when the user wants X. Continues on a second line.');
  assert.match(parsed.body, /^# Example/);
});

test('parseSkillFile tolerates a file without frontmatter', () => {
  const parsed = parseSkillFile('Just a body.');
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, undefined);
  assert.equal(parsed.body, 'Just a body.');
});

let home: string;
let cwd: string;
let other: string;

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps.`;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'jev-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'jev-cwd-'));
  other = mkdtempSync(join(tmpdir(), 'jev-other-'));

  // user skills, including a synced bucket and a skills-dir plugin
  write(join(home, '.claude/skills/cylinder-design/SKILL.md'), skill('cylinder-design', 'Design judgment.'));
  write(join(home, '.claude/skills/synced/uuid_x/docx/SKILL.md'), skill('docx', 'Word documents.'));
  write(join(home, '.claude/skills/jev/.claude-plugin/plugin.json'), JSON.stringify({ name: 'jev' }));
  write(join(home, '.claude/skills/jev/skills/jev-tools/SKILL.md'), skill('jev-tools', 'Rank many items.'));
  write(join(home, '.claude/skills/nodesc/SKILL.md'), `---\nname: nodesc\n---\nbody`);

  // installed plugins: one user-scoped, one for this project, one for another project, one disabled
  const cache = join(home, '.claude/plugins/cache');
  write(join(cache, 'mk/superpowers/1/skills/brainstorming/SKILL.md'), skill('brainstorming', 'Explore intent.'));
  write(join(cache, 'mk/superpowers/1/commands/write-plan.md'), `---\ndescription: Write a plan.\n---\nDo it.`);
  write(join(cache, 'mk/proj/1/skills/here/SKILL.md'), skill('here', 'Project plugin.'));
  write(join(cache, 'mk/elsewhere/1/skills/there/SKILL.md'), skill('there', 'Other project plugin.'));
  write(join(cache, 'mk/off/1/skills/off/SKILL.md'), skill('off', 'Disabled plugin.'));
  write(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@mk': [{ scope: 'user', installPath: join(cache, 'mk/superpowers/1') }],
        'proj@mk': [{ scope: 'project', projectPath: cwd, installPath: join(cache, 'mk/proj/1') }],
        'elsewhere@mk': [{ scope: 'project', projectPath: other, installPath: join(cache, 'mk/elsewhere/1') }],
        'off@mk': [{ scope: 'user', installPath: join(cache, 'mk/off/1') }],
      },
    }),
  );
  write(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@mk': true, 'off@mk': false } }));

  // account-synced plugins: ~/.claude/plugins/synced/<bucket>/<plugin>/{skills,commands}
  const synced = join(home, '.claude/plugins/synced/bucket_1');
  write(join(synced, 'design/skills/accessibility-review/SKILL.md'), skill('accessibility-review', 'WCAG audit.'));
  write(join(synced, 'pdf-viewer/commands/open.md'), `---\ndescription: Open a PDF.\n---\nOpen.`);
  write(join(synced, 'manifest.json'), '{}');

  // project-level
  write(join(cwd, '.claude/commands/vault-sync.md'), `---\ndescription: Run vault maintenance.\n---\nRitual.`);
  write(join(cwd, '.claude/skills/local-skill/SKILL.md'), skill('local-skill', 'Project skill.'));
  write(join(cwd, '.agents/skills/agents-skill/SKILL.md'), skill('agents-skill', 'Agents dir skill.'));
});

after(() => {
  for (const d of [home, cwd, other]) rmSync(d, { recursive: true, force: true });
});

test('loadRoster gathers user, synced, plugin, registry and project entries with namespaced names', async () => {
  const roster = await loadRoster({ home, cwd });
  const names = roster.map((e) => e.name).sort();
  assert.deepEqual(names, [
    'agents-skill',
    'superpowers:brainstorming',
    'cylinder-design',
    'anthropic-skills:docx',
    'design:accessibility-review',
    'pdf-viewer:open',
    'proj:here',
    'jev:jev-tools',
    'local-skill',
    'superpowers:write-plan',
    'vault-sync',
  ].sort());
});

test('loadRoster drops entries without a description and marks commands', async () => {
  const roster = await loadRoster({ home, cwd });
  assert.equal(roster.find((e) => e.name === 'nodesc'), undefined);
  assert.equal(roster.find((e) => e.name === 'vault-sync')?.kind, 'command');
  assert.equal(roster.find((e) => e.name === 'superpowers:write-plan')?.kind, 'command');
  assert.equal(roster.find((e) => e.name === 'pdf-viewer:open')?.kind, 'command');
  assert.equal(roster.find((e) => e.name === 'cylinder-design')?.kind, 'skill');
});

test('loadRoster keeps a body excerpt for the shortlist pass', async () => {
  const roster = await loadRoster({ home, cwd });
  assert.match(roster.find((e) => e.name === 'cylinder-design')!.body, /Steps\./);
});
