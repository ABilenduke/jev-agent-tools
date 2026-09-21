import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { parseArgs, candidatesFromLines, candidatesFromJson, candidatesFromFiles, runCli } from '../src/cli-core.js';
import type { Judge, JudgeRequest } from '../src/judge.js';

function fakeJudge(table: Record<string, number>) {
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
        answers[id] = { type: 'noul', noul: 0.9 };
      } else if (q.type === 'score') {
        answers[id] = { type: 'score', score: 1.5, confidence: 0.6, legend: {}, probabilities: {} };
      }
    }
    return { model: 'fake', answers, usage: { input_tokens: 7, output_tokens: 1 } } as unknown as SystemOneResult<Q>;
  };
  return { judge, requests };
}

async function run(argv: string[], stdin: string, judge: Judge) {
  let out = '';
  let err = '';
  const code = await runCli(argv, { stdin: async () => stdin, judge: () => judge, stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

test('parseArgs reads the command and its flags', () => {
  const parsed = parseArgs(['rank', '--query', 'q', '--mode', 'rerank', '--top', '3', '--files', 'a/*.md', '--files', 'b/*.md', '--chars', '200', '--lines']);
  assert.equal(parsed.command, 'rank');
  assert.deepEqual(parsed.options, { query: 'q', mode: 'rerank', top: 3, files: ['a/*.md', 'b/*.md'], chars: 200, lines: true });
});

test('parseArgs rejects unknown flags and missing values', () => {
  assert.throws(() => parseArgs(['rank', '--bogus']), /unknown flag/);
  assert.throws(() => parseArgs(['rank', '--query']), /--query needs a value/);
  assert.throws(() => parseArgs(['rank', '--top', 'x']), /--top/);
});

test('candidatesFromLines uses a leading path:line: prefix as id, else the line number', () => {
  const c = candidatesFromLines('src/a.ts:12: const x = 1\nplain line\n\nsrc/b.ts:3:  y\n');
  assert.deepEqual(c, [
    { id: 'src/a.ts:12', text: 'const x = 1' },
    { id: '2', text: 'plain line' },
    { id: 'src/b.ts:3', text: 'y' },
  ]);
});

test('candidatesFromJson accepts an array or an object with candidates', () => {
  assert.deepEqual(candidatesFromJson('[{"id":"a","text":"t"}]'), [{ id: 'a', text: 't' }]);
  assert.deepEqual(candidatesFromJson('{"candidates":[{"id":"a","text":"t"}]}'), [{ id: 'a', text: 't' }]);
  assert.throws(() => candidatesFromJson('{"nope":1}'), /candidates/);
  assert.throws(() => candidatesFromJson('[{"id":"a"}]'), /text/);
});

test('candidatesFromFiles expands globs and truncates to --chars', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-cli-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'one.md'), 'x'.repeat(50));
    writeFileSync(join(dir, 'sub', 'two.md'), 'short');
    writeFileSync(join(dir, 'skip.txt'), 'no');
    const c = await candidatesFromFiles(['**/*.md'], 10, dir);
    assert.deepEqual(
      c.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'one.md', text: 'x'.repeat(10) },
        { id: 'sub/two.md', text: 'short' },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rank reads JSON candidates from stdin and prints a JSON result', async () => {
  const { judge, requests } = fakeJudge({ a: 0.2, b: 0.8 });
  const { code, out } = await run(['rank', '--query', 'which'], '[{"id":"a","text":"1"},{"id":"b","text":"2"}]', judge);
  assert.equal(code, 0);
  assert.equal(requests.length, 1);
  const result = JSON.parse(out) as { ranked: { id: string }[]; verdict: string };
  assert.equal(result.ranked[0]?.id, 'b');
  assert.equal(result.verdict, 'present');
});

test('rank --lines reads grep-style lines from stdin', async () => {
  const { judge, requests } = fakeJudge({ 'f.ts:2': 1 });
  const { code, out } = await run(['rank', '--query', 'q', '--lines'], 'f.ts:1: a\nf.ts:2: b\n', judge);
  assert.equal(code, 0);
  assert.deepEqual(Object.keys((requests[0]!.questions['best'] as { criteria: object }).criteria), ['f.ts:1', 'f.ts:2']);
  assert.equal((JSON.parse(out) as { ranked: { id: string }[] }).ranked[0]?.id, 'f.ts:2');
});

test('rank without --query is a usage error with exit code 2 and no request', async () => {
  const { judge, requests } = fakeJudge({});
  const { code, err } = await run(['rank'], '[]', judge);
  assert.equal(code, 2);
  assert.match(err, /--query/);
  assert.equal(requests.length, 0);
});

test('ask forwards state and questions from stdin and prints answers', async () => {
  const { judge, requests } = fakeJudge({});
  const { code, out } = await run(['ask'], '{"state":"hello","questions":{"u":{"type":"noul","instructions":"Urgent?"}}}', judge);
  assert.equal(code, 0);
  assert.equal(requests[0]!.state, 'hello');
  const result = JSON.parse(out) as { answers: { u: { noul: number } } };
  assert.equal(result.answers.u.noul, 0.9);
});

test('ask rejects an invalid request with exit code 2 before any request', async () => {
  const { judge, requests } = fakeJudge({});
  const { code, err } = await run(['ask'], '{"state":"x","questions":{}}', judge);
  assert.equal(code, 2);
  assert.match(err, /question/);
  assert.equal(requests.length, 0);
});

test('help prints usage and exits 0; unknown command exits 2', async () => {
  const { judge } = fakeJudge({});
  const help = await run(['--help'], '', judge);
  assert.equal(help.code, 0);
  assert.match(help.out, /jev rank/);
  assert.match(help.out, /jev ask/);
  const bad = await run(['frobnicate'], '', judge);
  assert.equal(bad.code, 2);
});

test('a judge factory failure (missing key) is reported with exit code 1', async () => {
  let out = '';
  let err = '';
  const code = await runCli(['ask'], {
    stdin: async () => '{"state":"x","questions":{"a":{"type":"noul"}}}',
    judge: () => {
      throw new Error('No TypeSafe API key');
    },
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  });
  assert.equal(code, 1);
  assert.match(err, /No TypeSafe API key/);
  assert.equal(out, '');
});
