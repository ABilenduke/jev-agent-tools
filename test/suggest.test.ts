import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { suggest, shouldSkip, hookOutput, detectAgent, dataDir, runHook, type HookDeps } from '../src/hooks/skill-suggest.js';
import { MissingApiKeyError } from '../src/client.js';
import { SUGGEST_GATE, SUGGEST_FIT, SUGGEST_SHORTLIST, WINDOW_MAX } from '../src/questions.js';
import type { Judge, JudgeRequest } from '../src/judge.js';
import type { RosterEntry } from '../src/roster.js';

function entry(name: string, description: string, body = `# ${name}\n\nDetails about ${name}.`): RosterEntry {
  return { name, description, body, path: `/x/${name}`, kind: 'skill' };
}

const roster: RosterEntry[] = [
  entry('a11y', 'Accessibility audits.'),
  entry('design', 'Design judgment.'),
  entry('docx', 'Word documents.'),
  entry('pdf', 'PDF work.'),
  entry('xlsx', 'Spreadsheets.'),
];

/** Answers choices from `choiceP`, nouls from `noulP` (keyed by question id, `fits::*` via prefix table). */
function fakeJudge(choiceP: Record<string, number>, noulP: Record<string, number>) {
  const requests: JudgeRequest<Questions>[] = [];
  const judge: Judge = async <Q extends Questions>(req: JudgeRequest<Q>) => {
    requests.push(req as JudgeRequest<Questions>);
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      if (q.type === 'choice') {
        const probabilities: Record<string, number> = {};
        for (const label of Object.keys(q.criteria)) probabilities[label] = choiceP[label] ?? 0;
        const choice = Object.keys(probabilities).sort((x, y) => probabilities[y]! - probabilities[x]!)[0]!;
        answers[id] = { type: 'choice', choice, confidence: 0.8, probabilities };
      } else if (q.type === 'noul') {
        answers[id] = { type: 'noul', noul: noulP[id] ?? 0 };
      }
    }
    return { model: 'fake', answers, usage: { input_tokens: 5, output_tokens: 1 } } as unknown as SystemOneResult<Q>;
  };
  return { judge, requests };
}

const gateOpen = { acts_on_user_system: 0.8, would_follow_documented_procedure: 0.8, prose_suffices: 0.1 };
const gateClosed = { acts_on_user_system: 0.1, would_follow_documented_procedure: 0.1, prose_suffices: 0.9 };

test('shouldSkip rejects short prompts and slash commands', () => {
  assert.equal(shouldSkip('hi'), true);
  assert.equal(shouldSkip('/vault-sync now please'), true);
  assert.equal(shouldSkip('   '), true);
  assert.equal(shouldSkip('audit the accessibility of the button'), false);
});

test('suggest asks a wide choice over the whole roster plus three gate nouls, and stops when the gate is closed', async () => {
  const { judge, requests } = fakeJudge({ a11y: 0.9 }, gateClosed);
  const result = await suggest(judge, roster, 'what is accessibility?');
  assert.equal(requests.length, 1);
  const q = requests[0]!.questions;
  assert.deepEqual(Object.keys((q['which'] as { criteria: object }).criteria), roster.map((e) => e.name));
  assert.deepEqual(requests[0]!.state, { request: 'what is accessibility?' });
  assert.equal(result.skill, null);
  assert.ok(result.gate < SUGGEST_GATE);
});

test('suggest shortlists the top candidates with body excerpts and returns the choice winner when it fits', async () => {
  const fits = { 'fits::a11y': 0.9, 'fits::design': 0.4, 'fits::docx': 0.05 };
  const { judge, requests } = fakeJudge({ a11y: 0.6, design: 0.3, docx: 0.08, pdf: 0.01, xlsx: 0.01 }, { ...gateOpen, ...fits });
  const result = await suggest(judge, roster, 'audit the accessibility of the button');
  assert.equal(requests.length, 2);
  const second = requests[1]!.questions;
  const shortlist = Object.keys((second['which'] as { criteria: Record<string, string> }).criteria);
  assert.deepEqual(shortlist, ['a11y', 'design', 'docx']);
  assert.equal(shortlist.length, SUGGEST_SHORTLIST);
  assert.match((second['which'] as { criteria: Record<string, string> }).criteria['a11y']!, /Details about a11y/);
  for (const name of shortlist) assert.equal(second[`fits::${name}`]?.type, 'noul');
  assert.equal(result.skill, 'a11y');
  assert.equal(result.fit, 0.9);
});

test('suggest returns null when no shortlisted skill fits well enough', async () => {
  const fits = { 'fits::a11y': SUGGEST_FIT - 0.01, 'fits::design': 0.1, 'fits::docx': 0.1 };
  const { judge } = fakeJudge({ a11y: 0.6, design: 0.3, docx: 0.08 }, { ...gateOpen, ...fits });
  const result = await suggest(judge, roster, 'audit the accessibility of the button');
  assert.equal(result.skill, null);
});

test('hookOutput wraps the suggestion for UserPromptSubmit', () => {
  const out = hookOutput('a11y') as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /<skill_relevance>Relevant to the current request: a11y\./);
  assert.match(out.hookSpecificOutput.additionalContext, /Ignore this if it does not fit/);
  const none = hookOutput(null) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(none.hookSpecificOutput.additionalContext, /No skill in the roster appears relevant/);
});

test('dataDir trusts CLAUDE_PLUGIN_DATA only when it belongs to this plugin', () => {
  const home = '/home/u';
  assert.equal(dataDir({ CLAUDE_PLUGIN_DATA: '/x/plugins/data/jev-skills-dir' }, home), '/x/plugins/data/jev-skills-dir');
  assert.equal(dataDir({ CLAUDE_PLUGIN_DATA: '/x/plugins/data/codex-openai-codex' }, home), '/home/u/.local/state/jev-agent-tools');
  assert.equal(dataDir({}, home), '/home/u/.local/state/jev-agent-tools');
});

test('detectAgent reads the harness from hook stdin fields', () => {
  assert.equal(detectAgent({ transcript_path: '/h/.claude/projects/x/y.jsonl' }), 'claude');
  assert.equal(detectAgent({ turn_id: '0199-abc' }), 'codex');
  assert.equal(detectAgent({ transcript_path: '/t', turn_id: 'x' }), 'claude');
  assert.equal(detectAgent({}), 'unknown');
});

test('suggest splits a roster larger than one Choice into chunks in the same request and shortlists each chunk\'s nominees', async () => {
  const big = Array.from({ length: 300 }, (_, i) => entry(`s${i}`, `Skill ${i}.`));
  const choiceP = { s0: 0.9, s1: 0.5, s2: 0.4, s200: 0.8, s201: 0.3, s202: 0.2 };
  const { judge, requests } = fakeJudge(choiceP, { ...gateOpen, 'fits::s0': 0.9 });
  const result = await suggest(judge, big, 'audit the accessibility of the button');
  assert.equal(requests.length, 2);
  const wide = requests[0]!.questions;
  assert.equal(wide['which'], undefined);
  const chunks = Object.keys(wide).filter((k) => k.startsWith('which::'));
  assert.deepEqual(chunks, ['which::0', 'which::1']);
  const names = chunks.flatMap((k) => Object.keys((wide[k] as { criteria: object }).criteria));
  for (const k of chunks) assert.ok(Object.keys((wide[k] as { criteria: object }).criteria).length <= WINDOW_MAX);
  assert.deepEqual(names, big.map((e) => e.name));
  assert.deepEqual(result.shortlist, ['s0', 's200', 's1', 's2', 's201', 's202']);
  assert.deepEqual(Object.keys((requests[1]!.questions['which'] as { criteria: object }).criteria), result.shortlist);
  assert.equal(result.skill, 's0');
});

// ---------------------------------------------------------------------------------------------
// runHook: the whole hook run minus process I/O
// ---------------------------------------------------------------------------------------------

function hookHome(): { home: string; cwd: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'jev-hook-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'jev-hook-cwd-'));
  mkdirSync(join(home, '.claude/skills/a11y'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/a11y/SKILL.md'), '---\nname: a11y\ndescription: Accessibility audits.\n---\n\nSteps.');
  return { home, cwd, cleanup: () => [home, cwd].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}

const PROMPT = 'audit the accessibility of the button';

function deps(home: string, cwd: string, judge: () => Judge, deadlineMs = 1_000): HookDeps {
  return { judge, home, cwd, deadlineMs };
}

test('runHook suggests a skill, logs a hashed record, and never logs the prompt', async () => {
  const { home, cwd, cleanup } = hookHome();
  try {
    const { judge } = fakeJudge({ a11y: 1 }, { ...gateOpen, 'fits::a11y': 0.9 });
    const run = await runHook(JSON.stringify({ prompt: PROMPT, cwd, transcript_path: '/t.jsonl' }), deps(home, cwd, () => judge));
    assert.match(run.stdout ?? '', /Relevant to the current request: a11y\./);
    assert.equal(run.record?.['agent'], 'claude');
    assert.equal(run.record?.['skill'], 'a11y');
    assert.equal(run.record?.['roster_size'], 1);
    assert.equal(typeof run.record?.['latency_ms'], 'number');
    assert.equal(run.record?.['error'], undefined);
    assert.ok(!JSON.stringify(run.record).includes(PROMPT));
  } finally {
    cleanup();
  }
});

test('runHook does nothing for a skipped prompt', async () => {
  const { home, cwd, cleanup } = hookHome();
  try {
    const run = await runHook(JSON.stringify({ prompt: '/commit' }), deps(home, cwd, () => assert.fail('no judge for a skipped prompt')));
    assert.deepEqual(run, {});
  } finally {
    cleanup();
  }
});

test('runHook turns malformed stdin into an error record and no output', async () => {
  const run = await runHook('{not json', deps('/nonexistent', '/nonexistent', () => assert.fail('no judge')));
  assert.equal(run.stdout, undefined);
  assert.equal(run.record?.['error'], 'SyntaxError');
});

test('runHook logs a missing key by error name only and prints nothing', async () => {
  const { home, cwd, cleanup } = hookHome();
  try {
    const run = await runHook(JSON.stringify({ prompt: PROMPT, cwd }), deps(home, cwd, () => {
      throw new MissingApiKeyError(home);
    }));
    assert.equal(run.stdout, undefined);
    assert.equal(run.record?.['error'], 'MissingApiKeyError');
    assert.equal(run.record?.['agent'], 'unknown');
    assert.ok(!JSON.stringify(run.record).includes(home));
  } finally {
    cleanup();
  }
});

test('runHook gives up at the deadline with no output', async () => {
  const { home, cwd, cleanup } = hookHome();
  try {
    const never: Judge = () => new Promise(() => undefined);
    const run = await runHook(JSON.stringify({ prompt: PROMPT, cwd }), deps(home, cwd, () => never, 20));
    assert.equal(run.stdout, undefined);
    assert.equal(run.record?.['error'], 'deadline');
  } finally {
    cleanup();
  }
});

test('the built hook exits 0 with no stdout on garbage input and on a missing key', () => {
  const script = fileURLToPath(new URL('../src/hooks/skill-suggest.js', import.meta.url));
  const home = mkdtempSync(join(tmpdir(), 'jev-hook-proc-'));
  try {
    const env = { PATH: process.env['PATH'] ?? '', HOME: home };
    const garbage = spawnSync(process.execPath, [script], { input: '{garbage', env, encoding: 'utf8' });
    assert.equal(garbage.status, 0);
    assert.equal(garbage.stdout, '');
    const noKey = spawnSync(process.execPath, [script], { input: JSON.stringify({ prompt: PROMPT, cwd: home }), env, encoding: 'utf8' });
    assert.equal(noKey.status, 0);
    assert.equal(noKey.stdout, '');
    const log = readFileSync(join(home, '.local/state/jev-agent-tools/suggestions.jsonl'), 'utf8').trim().split('\n');
    assert.equal((JSON.parse(log.at(-1)!) as { error: string }).error, 'MissingApiKeyError');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
