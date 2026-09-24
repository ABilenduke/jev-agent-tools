import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { check, checkVerdict } from '../src/check.js';
import { CHECK_TRUE, CHECK_FALSE } from '../src/questions.js';
import type { Judge, JudgeRequest } from '../src/judge.js';

/** Answers each noul from a table keyed by question id. */
function fakeJudge(table: Record<string, number>) {
  const requests: JudgeRequest<Questions>[] = [];
  const judge: Judge = async <Q extends Questions>(req: JudgeRequest<Q>) => {
    requests.push(req as JudgeRequest<Questions>);
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(req.questions)) answers[id] = { type: 'noul', noul: table[id] ?? 0 };
    return { model: 'fake', answers, usage: { input_tokens: 9, output_tokens: 1 } } as unknown as SystemOneResult<Q>;
  };
  return { judge, requests };
}

test('check asks one request with one noul per condition over the subject', async () => {
  const { judge, requests } = fakeJudge({ c0: 0.9, c1: 0.1 });
  const result = await check(judge, { subject: 'diff text', conditions: ['adds an export', 'touches auth'] });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]!.state, { subject: 'diff text' });
  const q = requests[0]!.questions;
  assert.deepEqual(Object.keys(q), ['c0', 'c1']);
  for (const [id, condition] of [['c0', 'adds an export'], ['c1', 'touches auth']] as const) {
    assert.equal(q[id]?.type, 'noul');
    assert.equal((q[id] as unknown as { instructions: { condition: string } }).instructions.condition, condition);
    assert.ok((q[id] as unknown as { criteria?: { true?: unknown } }).criteria?.true);
  }
  assert.deepEqual(result.checks, [
    { condition: 'adds an export', p: 0.9, verdict: 'true' },
    { condition: 'touches auth', p: 0.1, verdict: 'false' },
  ]);
  assert.equal(result.requests, 1);
  assert.equal(result.inputTokens, 9);
});

test('check passes structured subjects through unchanged', async () => {
  const { judge, requests } = fakeJudge({});
  await check(judge, { subject: { ticket: { title: 't' } }, conditions: ['is urgent'] });
  assert.deepEqual(requests[0]!.state, { subject: { ticket: { title: 't' } } });
});

test('checkVerdict: true at or above CHECK_TRUE, false at or below CHECK_FALSE, unsure between', () => {
  assert.equal(checkVerdict(CHECK_TRUE), 'true');
  assert.equal(checkVerdict(CHECK_FALSE), 'false');
  assert.equal(checkVerdict((CHECK_TRUE + CHECK_FALSE) / 2), 'unsure');
});

test('check rejects no conditions and blank conditions before any request', async () => {
  const { judge, requests } = fakeJudge({});
  await assert.rejects(check(judge, { subject: 's', conditions: [] }), /at least one condition/);
  await assert.rejects(check(judge, { subject: 's', conditions: ['ok', '  '] }), /blank/);
  assert.equal(requests.length, 0);
});
