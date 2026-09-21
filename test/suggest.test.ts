import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { suggest, shouldSkip, hookOutput, detectAgent } from '../src/hooks/skill-suggest.js';
import { SUGGEST_GATE, SUGGEST_FIT, SUGGEST_SHORTLIST } from '../src/questions.js';
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

import { dataDir } from '../src/hooks/skill-suggest.js';

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
