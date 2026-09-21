/**
 * The `jev` command, separated from process wiring so it runs in tests with a fake judge.
 *
 *   jev rank --query Q [--mode window|rerank] [--top N] [--lines | --files GLOB... [--chars N]]
 *   jev ask                      request JSON on stdin: { state, questions }
 *
 * Output is always JSON on stdout. Exit codes: 0 ok, 1 runtime failure, 2 usage error.
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import type { Judge } from './judge.js';
import { rank, type Candidate, type RankMode } from './rank.js';
import { askInput } from './schemas.js';

export const DEFAULT_CHARS = 400;

export interface RankFlags {
  query?: string;
  mode?: RankMode;
  top?: number;
  files?: string[];
  chars?: number;
  lines?: boolean;
}

export interface ParsedArgs {
  command: 'rank' | 'ask' | 'help';
  options: RankFlags;
}

export class UsageError extends Error {}

export const USAGE = `jev - Jev (TypeSafe System One) judgments from the shell

  jev rank --query "..." [--mode window|rerank] [--top N] < candidates.json
  jev rank --query "..." --lines            < lines            (grep -n output works as-is)
  jev rank --query "..." --files 'src/**/*.ts' [--chars ${DEFAULT_CHARS}]
  jev ask                                   < request.json     ({ "state": ..., "questions": {...} })

Candidates JSON: [{"id":"...","text":"..."}] or {"candidates":[...]}.
--lines: each stdin line is a candidate; a leading "path:line:" becomes its id, else the line number.
--files: each matched file is a candidate with its path as id and its first --chars characters as text.

Output is JSON. rank -> { mode, exists, verdict, ranked:[{id,p}], requests, inputTokens }.
ask  -> { model, answers, usage }. Exit 0 ok, 1 runtime failure, 2 usage error.
Key: TYPESAFE_API_KEY, else ~/.config/typesafe/api_key.
`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') return { command: 'help', options: {} };
  if (first !== 'rank' && first !== 'ask') throw new UsageError(`unknown command: ${first}`);
  const options: RankFlags = {};
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
      case '--help':
      case '-h':
        return { command: 'help', options: {} };
      default:
        throw new UsageError(`unknown flag: ${flag}`);
    }
  }
  return { command: first, options };
}

export function candidatesFromLines(text: string): Candidate[] {
  const out: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const m = /^(\S+?):(\d+):\s*(.*)$/.exec(line);
    if (m) out.push({ id: `${m[1]}:${m[2]}`, text: m[3]!.trim() });
    else out.push({ id: String(i + 1), text: line.trim() });
  }
  return out;
}

export function candidatesFromJson(text: string): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError('stdin is not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) throw new UsageError('expected a JSON array or an object with a "candidates" array');
  return list.map((item, i) => {
    const c = item as { id?: unknown; text?: unknown };
    if (typeof c?.id !== 'string' || c.id === '') throw new UsageError(`candidate ${i} needs a string id`);
    if (typeof c.text !== 'string') throw new UsageError(`candidate ${c.id} needs a string text`);
    return { id: c.id, text: c.text };
  });
}

export async function candidatesFromFiles(patterns: readonly string[], chars: number, cwd = process.cwd()): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for await (const rel of glob(pattern, { cwd })) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text: string;
      try {
        text = await readFile(join(cwd, rel), 'utf8');
      } catch {
        continue;
      }
      out.push({ id: rel, text: text.slice(0, chars) });
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

async function loadCandidates(options: RankFlags, io: CliIo): Promise<Candidate[]> {
  if (options.files && options.files.length > 0) return candidatesFromFiles(options.files, options.chars ?? DEFAULT_CHARS, io.cwd);
  const text = await io.stdin();
  return options.lines ? candidatesFromLines(text) : candidatesFromJson(text);
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'help') {
      io.stdout(USAGE);
      return 0;
    }
    if (command === 'rank') {
      if (!options.query) throw new UsageError('rank needs --query');
      const candidates = await loadCandidates(options, io);
      if (candidates.length === 0) throw new UsageError('no candidates');
      const judge = io.judge();
      const result = await rank(judge, {
        query: options.query,
        candidates,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.top === undefined ? {} : { top: options.top }),
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await io.stdin());
    } catch {
      throw new UsageError('stdin is not valid JSON');
    }
    const parsed = askInput.safeParse(raw);
    if (!parsed.success) throw new UsageError(`invalid request: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const judge = io.judge();
    const result = await judge({ state: parsed.data.state as EntryType, questions: parsed.data.questions as Questions });
    io.stdout(`${JSON.stringify({ model: result.model, answers: result.answers, usage: result.usage })}\n`);
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
