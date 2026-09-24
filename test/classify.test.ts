import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { classify, parseOptionSpecs } from '../src/classify.js';
import { CLASSIFY_NONE } from '../src/questions.js';
import type { Judge, JudgeRequest } from '../src/judge.js';

/** Answers the choice from a table keyed by item id, then by label. */
function fakeJudge(table: Record<string, Record<string, number>>) {
  const requests: JudgeRequest<Questions>[] = [];
  const judge: Judge = async <Q extends Questions>(req: JudgeRequest<Q>) => {
    requests.push(req as JudgeRequest<Questions>);
    const itemId = (req.state as { item: { id: string } }).item.id;
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      if (q.type !== 'choice') continue;
      const probabilities: Record<string, number> = {};
      for (const label of Object.keys(q.criteria)) probabilities[label] = table[itemId]?.[label] ?? 0;
      const choice = Object.keys(probabilities).sort((a, b) => probabilities[b]! - probabilities[a]!)[0]!;
      answers[id] = { type: 'choice', choice, confidence: 0.5, probabilities };
    }
    return { model: 'fake', answers, usage: { input_tokens: 4, output_tokens: 1 } } as unknown as SystemOneResult<Q>;
  };
  return { judge, requests };
}

const items = [
  { id: 'a', text: 'fix crash on empty input' },
  { id: 'b', text: 'rename variable' },
  { id: 'c', text: 'lunch order' },
];

test('parseOptionSpecs reads name=description and bare names', () => {
  assert.deepEqual(parseOptionSpecs(['bug=a defect in behaviour', ' docs ', 'refactor = no behaviour change']), {
    bug: 'a defect in behaviour',
    docs: null,
    refactor: 'no behaviour change',
  });
  assert.throws(() => parseOptionSpecs(['bug', 'bug=again']), /duplicate option: bug/);
  assert.throws(() => parseOptionSpecs(['=nameless']), /option needs a name/);
});

test('classify asks one isolated request per item with the options plus a none option', async () => {
  const { judge, requests } = fakeJudge({ a: { bug: 0.8 }, b: { refactor: 0.7 }, c: { [CLASSIFY_NONE]: 0.9 } });
  const result = await classify(judge, { options: { bug: 'a defect', refactor: null }, items });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0]!.state, { item: { id: 'a', text: 'fix crash on empty input' } });
  const criteria = (requests[0]!.questions['label'] as { criteria: Record<string, unknown> }).criteria;
  assert.deepEqual(Object.keys(criteria), ['bug', 'refactor', CLASSIFY_NONE]);
  assert.equal(criteria['bug'], 'a defect');
  assert.deepEqual(result.items, [
    { id: 'a', label: 'bug', p: 0.8 },
    { id: 'b', label: 'refactor', p: 0.7 },
    { id: 'c', label: CLASSIFY_NONE, p: 0.9 },
  ]);
  assert.deepEqual(result.counts, { bug: 1, refactor: 1, [CLASSIFY_NONE]: 1 });
  assert.equal(result.requests, 3);
  assert.equal(result.inputTokens, 12);
});

test('classify puts the query in state when given and keeps a user-supplied none option', async () => {
  const { judge, requests } = fakeJudge({});
  await classify(judge, { query: 'what kind of change', options: { bug: null, none: 'not a code change' }, items: [items[0]!] });
  assert.deepEqual(requests[0]!.state, { query: 'what kind of change', item: items[0] });
  const q = requests[0]!.questions['label'] as { criteria: Record<string, unknown>; instructions: string };
  assert.deepEqual(Object.keys(q.criteria), ['bug', 'none']);
  assert.equal(q.criteria['none'], 'not a code change');
  assert.match(q.instructions, /`query`/);
});

test('classify rejects fewer than two options, no items and duplicate ids', async () => {
  const { judge, requests } = fakeJudge({});
  await assert.rejects(classify(judge, { options: { bug: null }, items }), /at least two options/);
  await assert.rejects(classify(judge, { options: { bug: null, docs: null }, items: [] }), /at least one item/);
  await assert.rejects(classify(judge, { options: { bug: null, docs: null }, items: [items[0]!, items[0]!] }), /duplicate/);
  assert.equal(requests.length, 0);
});
