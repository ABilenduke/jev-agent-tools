import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { parseArgs, candidatesFromLines, candidatesFromJson, candidatesFromFiles, runCli } from '../src/cli-core.js';
import type { Judge, JudgeRequest } from '../src/judge.js';
import { MAX_CANDIDATES } from '../src/questions.js';
import { VERSION } from '../src/version.js';

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
  const parsed = parseArgs(['rank', '--query', 'q', '--mode', 'rerank', '--top', '3', '--files', 'a/*.md', '--files', 'b/*.md', '--chars', '200', '--max', '50']);
  assert.equal(parsed.command, 'rank');
  assert.deepEqual(parsed.options, { query: 'q', mode: 'rerank', top: 3, files: ['a/*.md', 'b/*.md'], chars: 200, max: 50 });
  assert.deepEqual(parseArgs(['rank', '--query', 'q', '--lines']).options, { query: 'q', lines: true });
});

test('parseArgs rejects flag combinations that would be silently ignored', () => {
  assert.throws(() => parseArgs(['rank', '--query', 'q', '--files', 'x', '--lines']), /--files and --lines/);
  assert.throws(() => parseArgs(['rank', '--query', 'q', '--chars', '5']), /--chars needs --files/);
  assert.throws(() => parseArgs(['ask', '--query', 'q']), /ask takes no flags/);
});

test('--version prints the version, which matches package.json and plugin.json', async () => {
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
  const plugin = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', root), 'utf8')) as { version: string };
  assert.equal(VERSION, pkg.version);
  assert.equal(VERSION, plugin.version);
  const { judge } = fakeJudge({});
  const { code, out } = await run(['--version'], '', judge);
  assert.equal(code, 0);
  assert.equal(out, `${VERSION}\n`);
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

test('candidatesFromLines reads single-file grep -n, paths with spaces, and skips empty matches', () => {
  const c = candidatesFromLines('12:hello\n13:\nProjects/Design Suite/Note.md:4: colour tokens\nC:\\x\\y.ts:7: win\nplain\n');
  assert.deepEqual(c, [
    { id: '12', text: 'hello' },
    { id: 'Projects/Design Suite/Note.md:4', text: 'colour tokens' },
    { id: 'C:\\x\\y.ts:7', text: 'win' },
    { id: '5', text: 'plain' },
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
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, 'node_modules', 'pkg', 'readme.md'), 'dependency');
    writeFileSync(join(dir, '.git', 'notes.md'), 'git internals');
    writeFileSync(join(dir, 'empty.md'), '');
    writeFileSync(join(dir, 'binary.md'), 'abc\u0000def');
    const c = await candidatesFromFiles(['**/*.md'], 10, dir);
    assert.deepEqual(
      c.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'one.md', text: 'x'.repeat(10) },
        { id: 'sub/two.md', text: 'short' },
      ],
    );
    // a pattern that names node_modules itself still reaches it
    assert.deepEqual(await candidatesFromFiles(['node_modules/**/*.md'], 10, dir), [{ id: join('node_modules', 'pkg', 'readme.md'), text: 'dependency' }]);
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

test('rank refuses more candidates than --max, default MAX_CANDIDATES, before any request', async () => {
  const { judge, requests } = fakeJudge({});
  const three = '[{"id":"a","text":"1"},{"id":"b","text":"2"},{"id":"c","text":"3"}]';
  const over = await run(['rank', '--query', 'q', '--max', '2'], three, judge);
  assert.equal(over.code, 2);
  assert.match(over.err, /3 candidates.*--max 2/);
  assert.equal((await run(['rank', '--query', 'q', '--max', '3'], three, judge)).code, 0);
  const lines = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => `f.ts:${i + 1}: line`).join('\n');
  assert.equal((await run(['rank', '--query', 'q', '--lines'], lines, judge)).code, 2);
  assert.equal(requests.length, 1);
});

test('--text-field and --id-field read items from any JSON array of objects', () => {
  assert.deepEqual(candidatesFromJson('[{"id":"INC-1","summary":"db down"},{"id":2,"summary":"typo"}]', { text: 'summary' }), [
    { id: 'INC-1', text: 'db down' },
    { id: '2', text: 'typo' },
  ]);
  assert.deepEqual(candidatesFromJson('{"candidates":[{"key":"a","body":"t"}]}', { id: 'key', text: 'body' }), [{ id: 'a', text: 't' }]);
  assert.throws(() => candidatesFromJson('[{"id":"a","title":"t"}]', { text: 'summary' }), /item 0 has no string "summary"/);
  assert.throws(() => candidatesFromJson('[{"summary":"t"}]', { text: 'summary' }), /item 0 has no string or number "id"/);
});

test('--text-field is for JSON input only and is accepted by rank and classify', () => {
  assert.deepEqual(parseArgs(['classify', '--options', 'a,b', '--text-field', 'summary', '--id-field', 'key']).options, {
    option: ['a', 'b'],
    textField: 'summary',
    idField: 'key',
  });
  assert.equal(parseArgs(['rank', '--query', 'q', '--text-field', 'summary']).options.textField, 'summary');
  assert.throws(() => parseArgs(['rank', '--query', 'q', '--lines', '--text-field', 'summary']), /--text-field and --id-field apply to JSON input/);
  assert.throws(() => parseArgs(['check', 'x', '--text-field', 'summary']), /check does not take --text-field/);
});

test('classify --text-field labels a JSON file as it is', async () => {
  const { judge, requests } = fakeJudge({ minor: 0.8 });
  const { code, out } = await run(['classify', '--options', 'minor,major', '--text-field', 'summary'], '[{"id":"INC-1","summary":"slow dashboard"}]', judge);
  assert.equal(code, 0);
  assert.deepEqual(requests[0]!.state, { item: { id: 'INC-1', text: 'slow dashboard' } });
  assert.equal((JSON.parse(out) as { items: { label: string }[] }).items[0]?.label, 'minor');
});

test('non-JSON candidates on stdin suggest --lines', async () => {
  const { judge } = fakeJudge({});
  const { code, err } = await run(['rank', '--query', 'q'], 'src/a.ts:1: x\n', judge);
  assert.equal(code, 2);
  assert.match(err, /not valid JSON.*--lines/);
});

test('empty stdin is a usage error that says what to pipe', async () => {
  const { judge, requests } = fakeJudge({});
  const rank = await run(['rank', '--query', 'q'], '', judge);
  assert.equal(rank.code, 2);
  assert.match(rank.err, /no input on stdin/);
  const ask = await run(['ask'], '  \n', judge);
  assert.equal(ask.code, 2);
  assert.match(ask.err, /no input on stdin/);
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

test('parseArgs reads check conditions as positional arguments and classify options', () => {
  assert.deepEqual(parseArgs(['check', 'adds an export', '--json', 'touches auth']), {
    command: 'check',
    options: { conditions: ['adds an export', 'touches auth'], json: true },
  });
  assert.deepEqual(parseArgs(['classify', '--options', 'bug, docs', '--option', 'refactor=no behaviour change', '--lines']).options, {
    option: ['bug', 'docs', 'refactor=no behaviour change'],
    lines: true,
  });
});

test('parseArgs rejects flags and arguments a command does not take', () => {
  assert.throws(() => parseArgs(['check']), /check needs at least one condition/);
  assert.throws(() => parseArgs(['check', 'x', '--query', 'q']), /check does not take --query/);
  assert.throws(() => parseArgs(['classify', '--lines']), /classify needs --options/);
  assert.throws(() => parseArgs(['classify', '--options', 'a,b', '--mode', 'rerank']), /classify does not take --mode/);
  assert.throws(() => parseArgs(['rank', '--query', 'q', 'stray']), /rank takes no positional arguments: stray/);
  assert.throws(() => parseArgs(['rank', '--query', 'q', '--json']), /rank does not take --json/);
});

test('check reads text from stdin as the subject and prints one verdict per condition', async () => {
  const { judge, requests } = fakeJudge({});
  const { code, out } = await run(['check', 'adds an export', 'touches auth'], 'diff --git a/x b/x\n+export const y = 1\n', judge);
  assert.equal(code, 0);
  assert.deepEqual(requests[0]!.state, { subject: 'diff --git a/x b/x\n+export const y = 1\n' });
  const result = JSON.parse(out) as { checks: { condition: string; p: number; verdict: string }[]; requests: number };
  assert.deepEqual(result.checks.map((c) => [c.condition, c.p, c.verdict]), [
    ['adds an export', 0.9, 'true'],
    ['touches auth', 0.9, 'true'],
  ]);
  assert.equal(result.requests, 1);
});

test('check --json parses stdin as structured state; bad JSON and empty stdin are usage errors', async () => {
  const { judge, requests } = fakeJudge({});
  assert.equal((await run(['check', 'is urgent', '--json'], '{"ticket":{"title":"down"}}', judge)).code, 0);
  assert.deepEqual(requests[0]!.state, { subject: { ticket: { title: 'down' } } });
  const bad = await run(['check', 'is urgent', '--json'], 'not json', judge);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not valid JSON/);
  const empty = await run(['check', 'is urgent'], '', judge);
  assert.equal(empty.code, 2);
  assert.match(empty.err, /no input on stdin/);
  assert.equal(requests.length, 1);
});

test('classify labels each stdin line and counts labels', async () => {
  const { judge, requests } = fakeJudge({ bug: 0.7, docs: 0.2 });
  const { code, out } = await run(['classify', '--options', 'bug,docs', '--lines'], 'a.ts:1: crash on null\nb.md:4: typo\n', judge);
  assert.equal(code, 0);
  assert.equal(requests.length, 2);
  const result = JSON.parse(out) as { items: { id: string; label: string }[]; counts: Record<string, number> };
  assert.deepEqual(result.items.map((i) => [i.id, i.label]), [
    ['a.ts:1', 'bug'],
    ['b.md:4', 'bug'],
  ]);
  assert.deepEqual(result.counts, { bug: 2, docs: 0, none: 0 });
});

test('classify rejects a single option, a malformed option and too many items before any request', async () => {
  const { judge, requests } = fakeJudge({});
  const one = await run(['classify', '--options', 'bug', '--lines'], 'a.ts:1: x\n', judge);
  assert.equal(one.code, 2);
  assert.match(one.err, /at least two options/);
  assert.equal((await run(['classify', '--option', '=x', '--option', 'b', '--lines'], 'a.ts:1: x\n', judge)).code, 2);
  const over = await run(['classify', '--options', 'a,b', '--lines', '--max', '1'], 'a.ts:1: x\na.ts:2: y\n', judge);
  assert.equal(over.code, 2);
  assert.match(over.err, /--max 1/);
  assert.equal(requests.length, 0);
});

test('ask warns on stderr about likely question mistakes but still answers', async () => {
  const { judge, requests } = fakeJudge({});
  const { code, out, err } = await run(['ask'], '{"state":{"diff":"x"},"questions":{"a":{"type":"noul","instructions":"Does `patch` add an export?"}}}', judge);
  assert.equal(code, 0);
  assert.equal(requests.length, 1);
  assert.match(err, /jev: warning: a: .*`patch`/);
  assert.match(err, /jev: warning: a: noul has no criteria/);
  assert.doesNotThrow(() => JSON.parse(out));
});

test('help prints usage and exits 0; unknown command exits 2', async () => {
  const { judge } = fakeJudge({});
  const help = await run(['--help'], '', judge);
  assert.equal(help.code, 0);
  assert.match(help.out, /jev rank/);
  assert.match(help.out, /jev ask/);
  assert.match(help.out, /jev check/);
  assert.match(help.out, /jev classify/);
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
