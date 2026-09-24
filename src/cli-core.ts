/**
 * The `jev` command, separated from process wiring so it runs in tests with a fake judge.
 *
 *   jev rank --query Q [--mode window|rerank] [--top N] [--max N] [--lines | --files GLOB... [--chars N]]
 *   jev check "condition" ["condition"...] [--json]     subject on stdin
 *   jev classify --options a,b [--option name=desc...] [--query Q] [--max N] [--lines | --files GLOB... [--chars N] | --text-field F]
 *   jev ask                      request JSON on stdin: { state, questions }
 *   jev --version
 *
 * Output is always JSON on stdout. Exit codes: 0 ok, 1 runtime failure, 2 usage error.
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import { check } from './check.js';
import { classify, parseOptionSpecs } from './classify.js';
import type { Judge } from './judge.js';
import { lintRequest, stateSizeWarning } from './lint.js';
import { rank, type Candidate, type RankMode } from './rank.js';
import { MAX_CANDIDATES } from './questions.js';
import { askInput, candidateList, formatIssues } from './schemas.js';
import { VERSION } from './version.js';

export const DEFAULT_CHARS = 400;

/** Path segments `--files` never descends into unless a pattern names them. */
export const DEFAULT_EXCLUDES: readonly string[] = ['node_modules', '.git'];

export interface CliOptions {
  query?: string;
  mode?: RankMode;
  top?: number;
  files?: string[];
  chars?: number;
  lines?: boolean;
  max?: number;
  /** `--options a,b` and `--option name=desc` specs, in order. */
  option?: string[];
  /** `jev check`: parse stdin as JSON rather than text. */
  json?: boolean;
  /** `jev check`: the positional arguments. */
  conditions?: string[];
  /** JSON input: read each item's text from this field instead of `text`. */
  textField?: string;
  /** JSON input: read each item's id from this field instead of `id`. */
  idField?: string;
}

export type Command = 'rank' | 'check' | 'classify' | 'ask';

export interface ParsedArgs {
  command: Command | 'help' | 'version';
  options: CliOptions;
}

export class UsageError extends Error {}

/** Which options each command accepts; anything else is a usage error rather than silently ignored. */
const ACCEPTS: Readonly<Record<Command, readonly (keyof CliOptions)[]>> = {
  rank: ['query', 'mode', 'top', 'files', 'chars', 'lines', 'max', 'textField', 'idField'],
  classify: ['query', 'option', 'files', 'chars', 'lines', 'max', 'textField', 'idField'],
  check: ['json', 'conditions'],
  ask: [],
};

export const USAGE = `jev - Jev (TypeSafe System One) judgments from the shell

  jev rank --query "..." [--mode window|rerank] [--top N] [--max N] < candidates.json
  jev rank --query "..." --lines            < lines            (grep -n output works as-is)
  jev rank --query "..." --files 'src/**/*.ts' [--chars ${DEFAULT_CHARS}]
  jev check "condition" ["condition"...] [--json] < subject  (text, or JSON with --json)
  jev classify --options bug,docs [--option 'name=description'] [--query "..."] [--lines | --files GLOB | --text-field F]
  jev ask                                   < request.json     ({ "state": ..., "questions": {...} })
  jev --version

Candidates JSON (rank, classify): [{"id":"...","text":"..."}] or {"candidates":[...]}.
--text-field F, --id-field F: take each item's text (and id) from other fields, so any JSON array of objects works as-is.
--lines: each stdin line is a candidate; a leading "path:line:" or "line:" becomes its id, else the line number.
--files: each matched file is a candidate with its path as id and its first --chars characters as text.
         ${DEFAULT_EXCLUDES.join(' and ')} are skipped unless the pattern names them; so are empty and binary files.
--max: refuse more than N candidates (default ${MAX_CANDIDATES}); classify, and rank above 255, make one request each.
classify adds a "none" option unless one is given.

Output is JSON. rank -> { mode, exists, verdict, ranked:[{id,p}], requests, inputTokens }.
check -> { checks:[{condition,p,verdict}], requests, inputTokens }; verdict is true, false or unsure.
classify -> { items:[{id,label,p}], counts, requests, inputTokens }.
ask  -> { model, answers, usage }; likely mistakes in the request are warned about on stderr.
Exit 0 ok, 1 runtime failure, 2 usage error. Key: TYPESAFE_API_KEY, else ~/.config/typesafe/api_key.
`;

const FLAG_NAMES: Readonly<Record<keyof CliOptions, string>> = {
  query: '--query',
  mode: '--mode',
  top: '--top',
  files: '--files',
  chars: '--chars',
  lines: '--lines',
  max: '--max',
  option: '--option',
  json: '--json',
  conditions: 'positional arguments',
  textField: '--text-field',
  idField: '--id-field',
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') return { command: 'help', options: {} };
  if (first === '--version' || first === '-v' || first === 'version') return { command: 'version', options: {} };
  if (first !== 'rank' && first !== 'ask' && first !== 'check' && first !== 'classify') throw new UsageError(`unknown command: ${first}`);
  const command: Command = first;
  const options: CliOptions = {};
  const value = (flag: string, i: number): string => {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  const integer = (flag: string, raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} needs a positive integer, got ${raw}`);
    return n;
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (!flag.startsWith('-')) {
      if (command !== 'check') throw new UsageError(`${command} takes no positional arguments: ${flag}`);
      (options.conditions ??= []).push(flag);
      continue;
    }
    switch (flag) {
      case '--query':
        options.query = value(flag, i++);
        break;
      case '--mode': {
        const m = value(flag, i++);
        if (m !== 'window' && m !== 'rerank') throw new UsageError(`--mode must be window or rerank, got ${m}`);
        options.mode = m;
        break;
      }
      case '--top':
        options.top = integer(flag, value(flag, i++));
        break;
      case '--files':
        (options.files ??= []).push(value(flag, i++));
        break;
      case '--chars':
        options.chars = integer(flag, value(flag, i++));
        break;
      case '--lines':
        options.lines = true;
        break;
      case '--max':
        options.max = integer(flag, value(flag, i++));
        break;
      case '--options':
        (options.option ??= []).push(...value(flag, i++).split(',').map((o) => o.trim()).filter((o) => o !== ''));
        break;
      case '--option':
        (options.option ??= []).push(value(flag, i++));
        break;
      case '--json':
        options.json = true;
        break;
      case '--text-field':
        options.textField = value(flag, i++);
        break;
      case '--id-field':
        options.idField = value(flag, i++);
        break;
      case '--help':
      case '-h':
        return { command: 'help', options: {} };
      default:
        throw new UsageError(`unknown flag: ${flag}`);
    }
  }
  const given = Object.keys(options) as (keyof CliOptions)[];
  if (command === 'ask' && given.length > 0) throw new UsageError('ask takes no flags; the request is JSON on stdin');
  for (const key of given) {
    if (!ACCEPTS[command].includes(key)) throw new UsageError(`${command} does not take ${FLAG_NAMES[key]}`);
  }
  if (options.files && options.lines) throw new UsageError('--files and --lines are separate input modes; use one');
  if (options.chars !== undefined && !options.files) throw new UsageError('--chars needs --files');
  if ((options.textField || options.idField) && (options.files || options.lines)) {
    throw new UsageError('--text-field and --id-field apply to JSON input, not --files or --lines');
  }
  if (command === 'check' && !options.conditions) throw new UsageError('check needs at least one condition, as a quoted argument');
  if (command === 'classify' && !options.option) throw new UsageError('classify needs --options or --option');
  return { command, options };
}

export function candidatesFromLines(text: string): Candidate[] {
  const out: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    // `grep -rn`: path:line:text, where the path may hold spaces; `grep -n` on one file: line:text
    const m = /^(?:(.+?):)?(\d+):(.*)$/.exec(line);
    if (m) {
      const text = m[3]!.trim();
      if (text !== '') out.push({ id: m[1] === undefined ? m[2]! : `${m[1]}:${m[2]}`, text });
    } else out.push({ id: String(i + 1), text: line.trim() });
  }
  return out;
}

/** Which fields of each JSON item hold its id and text; `id` and `text` by default. */
export interface JsonFields {
  readonly id?: string;
  readonly text?: string;
}

export function candidatesFromJson(text: string, fields: JsonFields = {}): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError('stdin is not valid JSON; for one candidate per line, such as grep output, add --lines');
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) throw new UsageError('expected a JSON array or an object with a "candidates" array');
  if (fields.id !== undefined || fields.text !== undefined) {
    const idKey = fields.id ?? 'id';
    const textKey = fields.text ?? 'text';
    return list.map((item, i) => {
      const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const id = record[idKey];
      const body = record[textKey];
      if (!((typeof id === 'string' && id !== '') || typeof id === 'number')) throw new UsageError(`item ${i} has no string or number "${idKey}"`);
      if (typeof body !== 'string') throw new UsageError(`item ${i} has no string "${textKey}"`);
      return { id: String(id), text: body };
    });
  }
  const result = candidateList.safeParse(list);
  if (!result.success) throw new UsageError(`invalid candidates: ${formatIssues(result.error)}`);
  return result.data;
}

export async function candidatesFromFiles(patterns: readonly string[], chars: number, cwd = process.cwd()): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const named = new Set(pattern.split(/[\\/]/));
    const skip = DEFAULT_EXCLUDES.filter((segment) => !named.has(segment));
    const exclude = (path: string | { name: string }): boolean => {
      const p = typeof path === 'string' ? path : path.name;
      return p.split(/[\\/]/).some((segment) => skip.includes(segment));
    };
    for await (const rel of glob(pattern, { cwd, exclude })) {
      if (seen.has(rel) || rel.split(sep).some((segment) => skip.includes(segment))) continue;
      seen.add(rel);
      let text: string;
      try {
        text = (await readFile(join(cwd, rel), 'utf8')).slice(0, chars);
      } catch {
        continue;
      }
      // nothing to judge in an empty file; a NUL byte means binary
      if (text.trim() === '' || text.includes('\u0000')) continue;
      out.push({ id: rel, text });
    }
  }
  return out;
}

export interface CliIo {
  readonly stdin: () => Promise<string>;
  readonly judge: () => Judge;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  readonly cwd?: string;
}

async function readInput(io: CliIo, what: string): Promise<string> {
  const text = await io.stdin();
  if (text.trim() === '') throw new UsageError(`no input on stdin: ${what}`);
  return text;
}

async function loadCandidates(options: CliOptions, io: CliIo): Promise<Candidate[]> {
  if (options.files && options.files.length > 0) return candidatesFromFiles(options.files, options.chars ?? DEFAULT_CHARS, io.cwd);
  const text = await readInput(io, 'pipe candidates JSON, or use --lines or --files');
  if (options.lines) return candidatesFromLines(text);
  return candidatesFromJson(text, {
    ...(options.idField === undefined ? {} : { id: options.idField }),
    ...(options.textField === undefined ? {} : { text: options.textField }),
  });
}

function enforceMax(candidates: readonly Candidate[], options: CliOptions): void {
  const max = options.max ?? MAX_CANDIDATES;
  if (candidates.length > max) {
    throw new UsageError(`${candidates.length} candidates is more than --max ${max}; narrow the glob or grep, or raise --max`);
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function runRank(options: CliOptions, io: CliIo): Promise<void> {
  if (!options.query) throw new UsageError('rank needs --query');
  const candidates = await loadCandidates(options, io);
  if (candidates.length === 0) throw new UsageError('no candidates');
  enforceMax(candidates, options);
  const result = await rank(io.judge(), {
    query: options.query,
    candidates,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.top === undefined ? {} : { top: options.top }),
  });
  io.stdout(json(result));
}

async function runCheck(options: CliOptions, io: CliIo): Promise<void> {
  const text = await readInput(io, options.json ? 'pipe the subject as JSON' : 'pipe the text to check, or JSON with --json');
  let subject: EntryType = text;
  if (options.json) {
    try {
      subject = JSON.parse(text) as EntryType;
    } catch {
      throw new UsageError('stdin is not valid JSON');
    }
  }
  const warning = stateSizeWarning(subject);
  if (warning) io.stderr(`jev: warning: ${warning}\n`);
  io.stdout(json(await check(io.judge(), { subject, conditions: options.conditions ?? [] })));
}

async function runClassify(options: CliOptions, io: CliIo): Promise<void> {
  let labels: Record<string, string | null>;
  try {
    labels = parseOptionSpecs(options.option ?? []);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (Object.keys(labels).length < 2) throw new UsageError('classify needs at least two options');
  const items = await loadCandidates(options, io);
  if (items.length === 0) throw new UsageError('no candidates');
  enforceMax(items, options);
  const result = await classify(io.judge(), { options: labels, items, ...(options.query ? { query: options.query } : {}) });
  io.stdout(json(result));
}

async function runAsk(io: CliIo): Promise<void> {
  const text = await readInput(io, 'pipe a request JSON: { "state": ..., "questions": {...} }');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UsageError('stdin is not valid JSON');
  }
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) throw new UsageError(`invalid request: ${formatIssues(parsed.error)}`);
  for (const warning of lintRequest(parsed.data.state, parsed.data.questions)) io.stderr(`jev: warning: ${warning}\n`);
  const result = await io.judge()({ state: parsed.data.state as EntryType, questions: parsed.data.questions as Questions });
  io.stdout(json({ model: result.model, answers: result.answers, usage: result.usage }));
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'help') io.stdout(USAGE);
    else if (command === 'version') io.stdout(`${VERSION}\n`);
    else if (command === 'rank') await runRank(options, io);
    else if (command === 'check') await runCheck(options, io);
    else if (command === 'classify') await runClassify(options, io);
    else await runAsk(io);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`jev: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    io.stderr(`jev: ${message}\n`);
    return 1;
  }
}
