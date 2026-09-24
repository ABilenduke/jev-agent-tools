#!/usr/bin/env node
/**
 * UserPromptSubmit hook: rank the installed skill roster against the prompt and inject a
 * `<skill_relevance>` hint, following TypeSafe's skill-suggestion cookbook.
 *
 * Two requests. The first ranks every skill by its short description and asks three gate
 * questions about whether the request wants a skill at all. The second re-ranks the top
 * few with full descriptions and body excerpts and asks, per candidate, whether it does the
 * specific task. Anything short of both thresholds yields "no skill appears relevant".
 *
 * The hook never blocks: every failure path, including the deadline, exits 0 with no output.
 * `runHook` holds the whole run minus process I/O so tests drive it with a fake judge.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { NoulResponse, ChoiceResponse } from '@typesafe-ai/sdk';
import { createJudge } from '../client.js';
import type { Judge } from '../judge.js';
import {
  SUGGEST_BODY_CHARS,
  SUGGEST_FIT,
  SUGGEST_GATE,
  SUGGEST_GATE_QUESTIONS,
  SUGGEST_SHORTLIST,
  suggestShortlistQuestions,
  suggestWideQuestions,
} from '../questions.js';
import { loadRoster, type Agent, type RosterEntry } from '../roster.js';

export const MIN_PROMPT_CHARS = 12;

/**
 * Wall-clock budget for one hook run, after stdin is read. Under the 10 s timeout in hooks.json
 * so the hook gives up quietly instead of being killed; the SDK's own timeout is per attempt
 * with retries and no total budget. Typical runs take about 1 s (decision 14).
 */
export const HOOK_DEADLINE_MS = 5_000;

export function shouldSkip(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed.length < MIN_PROMPT_CHARS || trimmed.startsWith('/');
}

export interface SuggestResult {
  readonly skill: string | null;
  /** Mean of the three gate nouls. */
  readonly gate: number;
  readonly shortlist: readonly string[];
  /** Best `fits` probability among the shortlist, when the second pass ran. */
  readonly fit?: number;
  readonly requests: number;
  readonly inputTokens: number;
}

export async function suggest(judge: Judge, roster: readonly RosterEntry[], prompt: string): Promise<SuggestResult> {
  if (roster.length === 0) return { skill: null, gate: 0, shortlist: [], requests: 0, inputTokens: 0 };
  const state = { request: prompt };

  const wide = await judge({ state, questions: suggestWideQuestions(roster) });
  const answers = wide.answers as Record<string, NoulResponse | ChoiceResponse<Record<string, string>>>;
  const [acts, follows, prose] = SUGGEST_GATE_QUESTIONS.map((id) => (answers[id] as NoulResponse).noul) as [number, number, number];
  const gate = (acts + follows + (1 - prose)) / 3;
  // Each wide Choice (one, unless the roster exceeds a Choice) nominates its top few.
  const ranked = Object.entries(answers)
    .filter(([id]) => id === 'which' || id.startsWith('which::'))
    .flatMap(([, a]) =>
      Object.entries((a as ChoiceResponse<Record<string, string>>).probabilities)
        .sort((x, y) => y[1] - x[1])
        .slice(0, SUGGEST_SHORTLIST),
    )
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  let inputTokens = wide.usage.input_tokens;
  if (gate < SUGGEST_GATE) return { skill: null, gate, shortlist: ranked, requests: 1, inputTokens };

  const shortlist = ranked
    .map((name) => roster.find((e) => e.name === name))
    .filter((e): e is RosterEntry => e !== undefined)
    .map((e) => ({ name: e.name, description: `${e.description}\n\n${e.body.slice(0, SUGGEST_BODY_CHARS)}`.trim() }));
  const narrow = await judge({ state, questions: suggestShortlistQuestions(shortlist) });
  inputTokens += narrow.usage.input_tokens;
  const which = narrow.answers['which'] as ChoiceResponse<Record<string, string>> | undefined;
  let fit = 0;
  for (const c of shortlist) {
    const answer = narrow.answers[`fits::${c.name}`] as NoulResponse | undefined;
    if (answer && answer.noul > fit) fit = answer.noul;
  }
  const skill = which && fit >= SUGGEST_FIT ? which.choice : null;
  return { skill, gate, shortlist: ranked, fit, requests: 2, inputTokens };
}

/**
 * Which harness sent the prompt. Claude Code's UserPromptSubmit input carries `transcript_path`;
 * Codex's carries `turn_id` and no transcript. Anything else gets the union roster.
 */
export function detectAgent(input: { readonly transcript_path?: unknown; readonly turn_id?: unknown }): Agent {
  if (typeof input.transcript_path === 'string' && input.transcript_path.length > 0) return 'claude';
  if (typeof input.turn_id === 'string' && input.turn_id.length > 0) return 'codex';
  return 'unknown';
}

export function hookOutput(skill: string | null): unknown {
  const text =
    skill === null
      ? 'No skill in the roster appears relevant to this request.'
      : `Relevant to the current request: ${skill}. Ignore this if it does not fit what the user actually asked for.`;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `<skill_relevance>${text}</skill_relevance>`,
    },
  };
}

/**
 * Where the suggestion log lives. Claude Code sets `CLAUDE_PLUGIN_DATA` per plugin, but a shell
 * inherited from another plugin's context can carry that plugin's value, so only a directory
 * named for this plugin is trusted.
 */
export function dataDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const fromEnv = env['CLAUDE_PLUGIN_DATA'];
  if (fromEnv && basename(fromEnv).startsWith('jev')) return fromEnv;
  return join(home, '.local', 'state', 'jev-agent-tools');
}

export interface HookDeps {
  /** Called once per run that reaches the judge; may throw (a missing key). */
  readonly judge: () => Judge;
  readonly home: string;
  /** Used when stdin carries no `cwd`. */
  readonly cwd: string;
  readonly deadlineMs: number;
}

export interface HookRun {
  /** What to print, only on success. */
  readonly stdout?: string;
  /** What to log. Never holds the prompt: a hash, its length, and error names only. */
  readonly record?: Record<string, unknown>;
}

const DEADLINE = Symbol('deadline');

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof DEADLINE> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export async function runHook(stdinText: string, deps: HookDeps): Promise<HookRun> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  let context: Record<string, unknown> = {};
  try {
    const input = JSON.parse(stdinText) as { prompt?: unknown; cwd?: unknown; transcript_path?: unknown; turn_id?: unknown };
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (shouldSkip(prompt)) return {};
    const agent = detectAgent(input);
    const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : deps.cwd;
    context = {
      prompt_sha256: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
      prompt_chars: prompt.length,
      agent,
    };
    const work = (async () => {
      const judge = deps.judge();
      const roster = await loadRoster({ home: deps.home, cwd, agent });
      return { roster, result: await suggest(judge, roster, prompt) };
    })();
    const outcome = await withDeadline(work, deps.deadlineMs);
    if (outcome === DEADLINE) return { record: { at, ...context, error: 'deadline', latency_ms: Date.now() - started } };
    const { roster, result } = outcome;
    return {
      stdout: JSON.stringify(hookOutput(result.skill)),
      record: { at, ...context, roster_size: roster.length, ...result, latency_ms: Date.now() - started },
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    return { record: { at, ...context, error: name, latency_ms: Date.now() - started } };
  }
}

async function log(record: Record<string, unknown>): Promise<void> {
  try {
    const dir = dataDir(process.env, homedir());
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'suggestions.jsonl'), `${JSON.stringify(record)}\n`);
  } catch {
    // logging is best effort
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  // Last resort if stdin never closes or something ignores the deadline: leave quietly.
  setTimeout(() => process.exit(0), HOOK_DEADLINE_MS + 2_000).unref();
  const stdin = await readStdin();
  const signal = AbortSignal.timeout(HOOK_DEADLINE_MS);
  const { stdout, record } = await runHook(stdin, {
    judge: () => createJudge({ signal }),
    home: homedir(),
    cwd: process.cwd(),
    deadlineMs: HOOK_DEADLINE_MS,
  });
  if (stdout) process.stdout.write(stdout);
  if (record) await log(record);
}

const invokedDirectly = process.argv[1]?.endsWith('skill-suggest.js') ?? false;
if (invokedDirectly) {
  main().catch(() => undefined).finally(() => process.exit(0));
}
