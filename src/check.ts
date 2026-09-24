/**
 * Check several yes/no conditions against one subject in one request.
 *
 * The agent supplies the subject (text or JSON) and each condition as a plain sentence; the
 * question wording, criteria and thresholds come from `questions.ts`. Independent Nouls in one
 * request run in parallel, and none sees another's answer.
 */
import type { EntryType } from '@typesafe-ai/sdk';
import type { Judge } from './judge.js';
import { CHECK_FALSE, CHECK_TRUE, checkQuestions } from './questions.js';

export type CheckVerdict = 'true' | 'false' | 'unsure';

export interface CheckOptions {
  readonly subject: EntryType;
  readonly conditions: readonly string[];
}

export interface CheckResult {
  /** One per condition, in the order given. */
  readonly checks: readonly { condition: string; p: number; verdict: CheckVerdict }[];
  readonly requests: number;
  readonly inputTokens: number;
}

export function checkVerdict(p: number): CheckVerdict {
  if (p >= CHECK_TRUE) return 'true';
  if (p <= CHECK_FALSE) return 'false';
  return 'unsure';
}

export async function check(judge: Judge, { subject, conditions }: CheckOptions): Promise<CheckResult> {
  if (conditions.length === 0) throw new Error('check needs at least one condition');
  if (conditions.some((c) => c.trim() === '')) throw new Error('check conditions cannot be blank');
  const trimmed = conditions.map((c) => c.trim());
  const result = await judge({ state: { subject }, questions: checkQuestions(trimmed) });
  const checks = trimmed.map((condition, i) => {
    const p = result.answers[`c${i}`]!.noul;
    return { condition, p, verdict: checkVerdict(p) };
  });
  return { checks, requests: 1, inputTokens: result.usage.input_tokens };
}
