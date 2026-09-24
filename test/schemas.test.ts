import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askInput, rankInput, checkInput, classifyInput } from '../src/schemas.js';

test('askInput accepts each question type and rejects unknown types', () => {
  const ok = askInput.safeParse({
    state: { text: 'hello' },
    questions: {
      a: { type: 'noul', instructions: 'Is it?' },
      b: { type: 'choice', instructions: 'Which?', criteria: { x: 'ex', y: null } },
      c: { type: 'score', instructions: 'How much?', criteria: ['none', 'some', 'lots'] },
    },
  });
  assert.equal(ok.success, true);
  const bad = askInput.safeParse({ state: 's', questions: { a: { type: 'essay', instructions: 'Write' } } });
  assert.equal(bad.success, false);
});

test('askInput rejects an empty question map and a score with fewer than two levels', () => {
  assert.equal(askInput.safeParse({ state: 's', questions: {} }).success, false);
  assert.equal(askInput.safeParse({ state: 's', questions: { a: { type: 'score', criteria: ['only'] } } }).success, false);
});

test('rankInput requires candidates with id and text and defaults mode', () => {
  const ok = rankInput.safeParse({ query: 'q', candidates: [{ id: 'a', text: 't' }] });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.mode, 'window');
  assert.equal(rankInput.safeParse({ query: 'q', candidates: [] }).success, false);
  assert.equal(rankInput.safeParse({ query: 'q', candidates: [{ id: 'a' }] }).success, false);
  assert.equal(rankInput.safeParse({ query: 'q', candidates: [{ id: 'a', text: 't' }], mode: 'fast' }).success, false);
});

test('checkInput needs a subject and at least one non-empty condition', () => {
  assert.equal(checkInput.safeParse({ subject: 'diff', conditions: ['adds an export'] }).success, true);
  assert.equal(checkInput.safeParse({ subject: { a: 1 }, conditions: ['x'] }).success, true);
  assert.equal(checkInput.safeParse({ subject: 'diff', conditions: [] }).success, false);
  assert.equal(checkInput.safeParse({ subject: 'diff', conditions: [''] }).success, false);
});

test('classifyInput needs two options and candidates', () => {
  const candidates = [{ id: 'a', text: 't' }];
  assert.equal(classifyInput.safeParse({ options: { bug: 'a defect', docs: null }, candidates }).success, true);
  assert.equal(classifyInput.safeParse({ query: 'kind of change', options: { bug: null, docs: null }, candidates }).success, true);
  assert.equal(classifyInput.safeParse({ options: { bug: null }, candidates }).success, false);
  assert.equal(classifyInput.safeParse({ options: { bug: null, docs: null }, candidates: [] }).success, false);
});
