/**
 * Rank candidates against a query.
 *
 * `window` (default): one request, a Choice over candidate ids plus an "exists" Noul, following
 * TypeSafe's line-by-line search recipe. `rerank`: one Noul per candidate, following the
 * re-ranking recipe; better isolation, more requests. Window mode falls back to rerank when
 * there are more candidates than one Choice can carry.
 */
import type { Judge } from './judge.js';
import {
  EXISTS_PARTIAL,
  EXISTS_PRESENT,
  RERANK_CONCURRENCY,
  WINDOW_MAX,
  rankPairQuestions,
  rankWindowQuestions,
} from './questions.js';

export interface Candidate {
  readonly id: string;
  readonly text: string;
}

export type RankMode = 'window' | 'rerank';
export type Verdict = 'present' | 'partial' | 'absent';

export interface RankOptions {
  readonly query: string;
  readonly candidates: readonly Candidate[];
  readonly mode?: RankMode;
  readonly top?: number;
}

export interface RankResult {
  readonly mode: RankMode;
  /** Probability that at least one candidate satisfies the query. */
  readonly exists: number;
  readonly verdict: Verdict;
  readonly ranked: readonly { id: string; p: number }[];
  readonly requests: number;
  readonly inputTokens: number;
}

export function verdictFor(exists: number): Verdict {
  if (exists >= EXISTS_PRESENT) return 'present';
  if (exists >= EXISTS_PARTIAL) return 'partial';
  return 'absent';
}

function validate(candidates: readonly Candidate[]): void {
  if (candidates.length === 0) throw new Error('rank needs at least one candidate');
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) throw new Error(`duplicate candidate id: ${c.id}`);
    seen.add(c.id);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function rank(judge: Judge, options: RankOptions): Promise<RankResult> {
  validate(options.candidates);
  const requested = options.mode ?? 'window';
  const mode: RankMode = requested === 'window' && options.candidates.length > WINDOW_MAX ? 'rerank' : requested;

  let exists: number;
  let scored: { id: string; p: number }[];
  let requests: number;
  let inputTokens: number;

  if (mode === 'window') {
    const ids = options.candidates.map((c) => c.id);
    const result = await judge({
      state: { query: options.query, candidates: options.candidates.map((c) => ({ id: c.id, text: c.text })) },
      questions: rankWindowQuestions(ids),
    });
    exists = result.answers.exists.noul;
    scored = ids.map((id) => ({ id, p: result.answers.best.probabilities[id] ?? 0 }));
    requests = 1;
    inputTokens = result.usage.input_tokens;
  } else {
    const results = await mapLimit(options.candidates, RERANK_CONCURRENCY, (candidate) =>
      judge({
        state: { query: options.query, candidate: { id: candidate.id, text: candidate.text } },
        questions: rankPairQuestions(),
      }),
    );
    scored = options.candidates.map((c, i) => ({ id: c.id, p: results[i]!.answers.matches.noul }));
    exists = scored.reduce((max, s) => Math.max(max, s.p), 0);
    requests = results.length;
    inputTokens = results.reduce((sum, r) => sum + r.usage.input_tokens, 0);
  }

  scored.sort((a, b) => b.p - a.p);
  const ranked = options.top === undefined ? scored : scored.slice(0, options.top);
  return { mode, exists, verdict: verdictFor(exists), ranked, requests, inputTokens };
}
