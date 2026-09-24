import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintRequest } from '../src/lint.js';
import { STATE_WARN_CHARS } from '../src/questions.js';

const noul = (instructions: unknown, criteria: unknown = { true: 'yes', false: 'no' }) => ({ type: 'noul' as const, instructions, criteria });

test('a well-formed request has no warnings', () => {
  const warnings = lintRequest({ ticket: { messages: [{ text: 'help' }] } }, {
    urgent: noul('Is `ticket.messages[0].text` urgent?'),
    area: { type: 'choice', instructions: 'Which area is `ticket` about?', criteria: { billing: 'money', other: null } },
    severity: { type: 'score', instructions: 'How severe is `ticket`?', criteria: ['none', 'some', 'a lot'] },
  });
  assert.deepEqual(warnings, []);
});

test('warns when instructions reference a field the state does not have', () => {
  const warnings = lintRequest({ diff: 'x' }, { a: noul('Does `patch` add an export?'), b: noul({ question: 'Is `summary` accurate?' }) });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /a: .*`patch`.*not a field of state/);
  assert.match(warnings[1]!, /b: .*`summary`/);
});

test('does not check field references when state is text or an array', () => {
  assert.deepEqual(lintRequest('some text', { a: noul('Does `text` mention cats?') }), []);
  assert.deepEqual(lintRequest([1, 2], { a: noul('Is `items` sorted?') }), []);
});

test('warns on a choice without a none or other option', () => {
  const warnings = lintRequest('t', { area: { type: 'choice', instructions: 'Which?', criteria: { billing: null, shipping: null } } });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /area: .*none/);
  for (const escape of ['none', 'Other', 'none_of_the_above', 'unknown', 'neither']) {
    assert.deepEqual(lintRequest('t', { area: { type: 'choice', instructions: 'Which?', criteria: { billing: null, [escape]: null } } }), [], escape);
  }
});

test('warns on a noul without criteria and on oversized state', () => {
  const bare = lintRequest('t', { a: { type: 'noul', instructions: 'Is it?' } });
  assert.equal(bare.length, 1);
  assert.match(bare[0]!, /a: .*criteria/);
  const big = lintRequest('x'.repeat(STATE_WARN_CHARS + 1), { a: noul('Is it?') });
  assert.equal(big.length, 1);
  assert.match(big[0]!, /state is .* characters/);
});
