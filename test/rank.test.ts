import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { rank } from '../src/rank.js';
import { WINDOW_MAX, EXISTS_PRESENT, EXISTS_PARTIAL } from '../src/questions.js';
import type { Judge, JudgeRequest } from '../src/judge.js';

/** A judge that records requests and answers from a table of probabilities keyed by candidate id. */
function fakeJudge(table: Record<string, number>, exists = 0.9) {
  const requests: JudgeRequest<Questions>[] = [];
  const judge: Judge = async <Q extends Questions>(req: JudgeRequest<Q>) => {
    requests.push(req as JudgeRequest<Questions>);
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      if (q.type === 'choice') {
        const probabilities: Record<string, number> = {};
        for (const label of Object.keys(q.criteria)) probabilities[label] = table[label] ?? 0;
        const choice = Object.keys(probabilities).sort((a, b) => probabilities[b]! - probabilities[a]!)[0]!;
        answers[id] = { type: 'choice', choice, confidence: 0.8, probabilities };
      } else if (q.type === 'noul') {
        const state = req.state as { candidate?: { id: string } };
        const p = state.candidate ? (table[state.candidate.id] ?? 0) : exists;
        answers[id] = { type: 'noul', noul: p };
      }
    }
    return { model: 'fake', answers, usage: { input_tokens: 10, output_tokens: 1 } } as unknown as SystemOneResult<Q>;
  };
  return { judge, requests };
}

const three = [
  { id: 'a', text: 'alpha' },
  { id: 'b', text: 'beta' },
  { id: 'c', text: 'gamma' },
];

test('window mode asks one request with a choice over every candidate id and an exists noul', async () => {
  const { judge, requests } = fakeJudge({ a: 0.2, b: 0.7, c: 0.1 });
  const result = await rank(judge, { query: 'second letter', candidates: three });
  assert.equal(requests.length, 1);
  const q = requests[0]!.questions;
  assert.equal(q['best']?.type, 'choice');
  assert.deepEqual(Object.keys((q['best'] as { criteria: object }).criteria), ['a', 'b', 'c']);
  assert.equal(q['exists']?.type, 'noul');
  assert.deepEqual(
    result.ranked.map((r: { id: string }) => r.id),
    ['b', 'a', 'c'],
  );
  assert.equal(result.ranked[0]?.p, 0.7);
  assert.equal(result.requests, 1);
});

test('window mode sends only the query and candidates as state', async () => {
  const { judge, requests } = fakeJudge({ a: 1 });
  await rank(judge, { query: 'q', candidates: three });
  assert.deepEqual(requests[0]!.state, { query: 'q', candidates: three });
});

test('verdict follows the exists probability thresholds', async () => {
  for (const [exists, verdict] of [
    [EXISTS_PRESENT, 'present'],
    [EXISTS_PARTIAL, 'partial'],
    [EXISTS_PARTIAL - 0.01, 'absent'],
  ] as const) {
    const { judge } = fakeJudge({ a: 1 }, exists);
    const result = await rank(judge, { query: 'q', candidates: three });
    assert.equal(result.verdict, verdict, `exists=${exists}`);
    assert.equal(result.exists, exists);
  }
});

test('top limits the ranked list', async () => {
  const { judge } = fakeJudge({ a: 0.5, b: 0.3, c: 0.2 });
  const result = await rank(judge, { query: 'q', candidates: three, top: 2 });
  assert.equal(result.ranked.length, 2);
});

test('rerank mode asks one noul per candidate and sorts by probability', async () => {
  const { judge, requests } = fakeJudge({ a: 0.1, b: 0.9, c: 0.5 });
  const result = await rank(judge, { query: 'q', candidates: three, mode: 'rerank' });
  assert.equal(requests.length, 3);
  for (const r of requests) {
    assert.equal(r.questions['matches']?.type, 'noul');
    assert.equal(typeof (r.state as { candidate: { id: string } }).candidate.id, 'string');
  }
  assert.deepEqual(result.ranked.map((r: { id: string }) => r.id), ['b', 'c', 'a']);
  assert.equal(result.exists, 0.9);
  assert.equal(result.requests, 3);
});

test('window mode falls back to rerank when candidates exceed the window', async () => {
  const many = Array.from({ length: WINDOW_MAX + 1 }, (_, i) => ({ id: `c${i}`, text: `t${i}` }));
  const { judge, requests } = fakeJudge({ c5: 1 });
  const result = await rank(judge, { query: 'q', candidates: many });
  assert.equal(requests.length, WINDOW_MAX + 1);
  assert.equal(result.mode, 'rerank');
  assert.equal(result.ranked[0]?.id, 'c5');
});

test('rank rejects duplicate candidate ids and empty candidate lists', async () => {
  const { judge } = fakeJudge({});
  await assert.rejects(rank(judge, { query: 'q', candidates: [] }), /at least one/);
  await assert.rejects(
    rank(judge, { query: 'q', candidates: [{ id: 'a', text: '1' }, { id: 'a', text: '2' }] }),
    /duplicate/,
  );
});
