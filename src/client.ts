/**
 * One place that knows how to reach TypeSafe.
 *
 * Key resolution: `TYPESAFE_API_KEY` in the environment, then `~/.config/typesafe/api_key`.
 * The file fallback matters because Claude Code runs hooks through `sh -c`, which does not
 * source the interactive shell profile where the export usually lives.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { Judge } from './judge.js';

export const API_KEY_ENV = 'TYPESAFE_API_KEY';
export const DEFAULT_TIMEOUT_MS = 5_000;

export function apiKeyFilePath(home: string): string {
  return join(home, '.config', 'typesafe', 'api_key');
}

export interface ResolveApiKeyOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** Returns the file's contents, or undefined when it cannot be read. */
  readonly readFile: (path: string) => string | undefined;
}

export function resolveApiKey({ env, home, readFile }: ResolveApiKeyOptions): string | undefined {
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readFile(apiKeyFilePath(home))?.trim();
  return fromFile || undefined;
}

export class MissingApiKeyError extends Error {
  constructor(home: string) {
    super(`No TypeSafe API key: set ${API_KEY_ENV} or write the key to ${apiKeyFilePath(home)}`);
    this.name = 'MissingApiKeyError';
  }
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export interface CreateJudgeOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /** Cancels in-flight requests and pending retries; the SDK's timeout is per attempt, with no total budget. */
  readonly signal?: AbortSignal;
}

/** Builds a `Judge` backed by the real API. Throws `MissingApiKeyError` when no key is found. */
export function createJudge(options: CreateJudgeOptions = {}): Judge {
  const home = homedir();
  const apiKey = options.apiKey ?? resolveApiKey({ env: process.env, home, readFile: readOptional });
  if (!apiKey) throw new MissingApiKeyError(home);
  const client = new TypeSafeClient({
    apiKey,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    logLevel: 'error',
  });
  const requestOptions = options.signal ? { signal: options.signal } : {};
  return (request) => client.systemOne({ state: request.state, questions: request.questions }, requestOptions);
}
