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
 * The hook never blocks: every failure path exits 0 with no output.
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
  SUGGEST_SHORTLIST,
  suggestShortlistQuestions,
  suggestWideQuestions,
} from '../questions.js';
import { loadRoster, type RosterEntry } from '../roster.js';

export const MIN_PROMPT_CHARS = 12;

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
  const gates = [wide.answers.acts_on_user_system, wide.answers.would_follow_documented_procedure];
  const gate = (gates.reduce((s, a) => s + a.noul, 0) + (1 - wide.answers.prose_suffices.noul)) / 3;
  const ranked = Object.entries(wide.answers.which.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUGGEST_SHORTLIST)
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
  const started = Date.now();
  const input = JSON.parse(await readStdin()) as { prompt?: string; cwd?: string };
  const prompt = input.prompt ?? '';
  if (shouldSkip(prompt)) return;
  const judge = createJudge();
  const roster = await loadRoster({ home: homedir(), cwd: input.cwd ?? process.cwd() });
  const result = await suggest(judge, roster, prompt);
  process.stdout.write(JSON.stringify(hookOutput(result.skill)));
  await log({
    at: new Date().toISOString(),
    prompt_sha256: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
    prompt_chars: prompt.length,
    roster_size: roster.length,
    ...result,
    latency_ms: Date.now() - started,
  });
}

const invokedDirectly = process.argv[1]?.endsWith('skill-suggest.js') ?? false;
if (invokedDirectly) {
  main().catch(() => undefined).finally(() => process.exit(0));
}
