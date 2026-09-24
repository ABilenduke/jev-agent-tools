/**
 * Every question Jev is asked, and every threshold that turns a probability into a decision.
 *
 * This is the file a human reviews. Thresholds are the TypeSafe cookbook starting points and
 * have not yet been tuned on this machine's data; `suggestions.jsonl` exists so they can be.
 */
import { choice, noul } from '@typesafe-ai/sdk';
import type { ChoiceQuestion, NoulQuestion } from '@typesafe-ai/sdk';

// ---------------------------------------------------------------------------------------------
// jev_rank
// ---------------------------------------------------------------------------------------------

/**
 * Most options one Choice question accepts (the API's limit). `jev rank` falls back to one request
 * per candidate beyond it; the hook's wide pass splits the roster into Choices of at most this many.
 */
export const WINDOW_MAX = 255;

/** `exists` at or above this: the query is answered by at least one candidate. */
export const EXISTS_PRESENT = 0.7;
/** `exists` at or above this but below present: partial coverage; below: nothing fits. */
export const EXISTS_PARTIAL = 0.35;

/** How many per-candidate requests run at once in rerank mode. Well under the 1,200/min limit. */
export const RERANK_CONCURRENCY = 12;

/**
 * Most candidates `jev rank` accepts unless `--max` raises it. Above `WINDOW_MAX` every candidate
 * is its own request, so this bounds a mistaken glob to about a minute of requests (decision 17).
 */
export const MAX_CANDIDATES = 1_000;

export function rankWindowQuestions(ids: readonly string[]): {
  best: ChoiceQuestion<Record<string, null>>;
  exists: NoulQuestion;
} {
  const criteria: Record<string, null> = {};
  for (const id of ids) criteria[id] = null;
  return {
    best: choice(
      'Which candidate in `candidates` best answers or satisfies `query`? Judge by meaning, not by shared words. Each option is a candidate id.',
      criteria,
    ),
    exists: noul('Does at least one entry in `candidates` genuinely answer or satisfy `query`?', {
      true: 'Some candidate directly addresses what the query asks for.',
      false: 'The candidates are only loosely related, or none addresses the query.',
    }),
  };
}

export function rankPairQuestions(): { matches: NoulQuestion } {
  return {
    matches: noul('Does `candidate.text` answer or satisfy `query`?', {
      true: 'The candidate directly addresses what the query asks for.',
      false: 'The candidate is only topically similar, or unrelated.',
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// jev check
// ---------------------------------------------------------------------------------------------

/** A condition's probability at or above this reads as `true`. */
export const CHECK_TRUE = 0.7;
/** At or below this reads as `false`; between the two thresholds, `unsure`. */
export const CHECK_FALSE = 0.3;

/**
 * One Noul per condition over state `{ subject }`, keyed `c0`, `c1`, ... The condition travels in
 * the instructions, as `fits::` does for skills, so the agent writes a sentence and never a
 * question. "Not shown" is false: a check asks what the subject shows, not what is conceivable.
 */
export function checkQuestions(conditions: readonly string[]): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  conditions.forEach((condition, i) => {
    questions[`c${i}`] = noul(
      { question: 'Does `subject` show that this condition holds?', condition },
      {
        true: 'The subject shows that the condition holds.',
        false: 'The subject does not show that the condition holds, or shows that it does not.',
      },
    );
  });
  return questions;
}

// ---------------------------------------------------------------------------------------------
// jev classify
// ---------------------------------------------------------------------------------------------

/** The escape option every classification gets unless the caller supplies one named `none`. */
export const CLASSIFY_NONE = 'none';
export const CLASSIFY_NONE_DESCRIPTION = 'None of the other options fits the item.';

/**
 * One Choice per item over state `{ item }` or `{ query, item }`. A Choice always picks an option,
 * so `none` is added: TypeSafe's Choice guidance is to include one whenever nothing may fit.
 */
export function classifyQuestions(
  options: Readonly<Record<string, string | null>>,
  withQuery: boolean,
): { label: ChoiceQuestion<Record<string, string | null>> } {
  const criteria: Record<string, string | null> = { ...options };
  if (!Object.keys(criteria).some((k) => k.toLowerCase() === CLASSIFY_NONE)) criteria[CLASSIFY_NONE] = CLASSIFY_NONE_DESCRIPTION;
  const question = withQuery ? 'Which option best answers `query` for `item.text`?' : 'Which option best describes `item.text`?';
  return {
    label: choice(`${question} Judge by meaning, not by shared words. Each option is a label, with a description where one was given.`, criteria),
  };
}

// ---------------------------------------------------------------------------------------------
// jev ask warnings
// ---------------------------------------------------------------------------------------------

/**
 * State larger than this draws a warning from `jev ask` and `jev check`. About 15k tokens, half the
 * 32k allowed for state plus the longest question; accuracy falls with unrelated context well
 * before the limit.
 */
export const STATE_WARN_CHARS = 60_000;

// ---------------------------------------------------------------------------------------------
// Skill suggestion (UserPromptSubmit hook)
// ---------------------------------------------------------------------------------------------

/** Mean of the three gate nouls must reach this before any skill is suggested. */
export const SUGGEST_GATE = 0.3;
/** Best shortlist `fits` noul must reach this for the winner to be suggested. */
export const SUGGEST_FIT = 0.3;
/** Shortlist size for the second request. */
export const SUGGEST_SHORTLIST = 3;
/** Characters of description used in the wide first pass. */
export const SUGGEST_WIDE_DESCRIPTION_CHARS = 240;
/** Characters of skill body appended to the description in the shortlist pass. Cookbook value (decision 13). */
export const SUGGEST_BODY_CHARS = 700;

export interface SuggestCandidate {
  readonly name: string;
  readonly description: string;
}

/** The wide pass's gate Nouls, by question id. */
export const SUGGEST_GATE_QUESTIONS = ['acts_on_user_system', 'would_follow_documented_procedure', 'prose_suffices'] as const;

/**
 * Split a roster into balanced chunks of at most `WINDOW_MAX`, one wide Choice each. A roster that
 * fits in one Choice is one chunk, asked as `which`; more are asked as `which::0`, `which::1`, ...
 * in the same request (decision 16).
 */
export function suggestWideChunks<T>(candidates: readonly T[]): T[][] {
  const count = Math.max(1, Math.ceil(candidates.length / WINDOW_MAX));
  const size = Math.ceil(candidates.length / count);
  return Array.from({ length: count }, (_, i) => candidates.slice(i * size, (i + 1) * size));
}

export function suggestWideQuestions(candidates: readonly SuggestCandidate[]): Record<
  string,
  ChoiceQuestion<Record<string, string>> | NoulQuestion
> {
  const chunks = suggestWideChunks(candidates);
  const which: Record<string, ChoiceQuestion<Record<string, string>>> = {};
  chunks.forEach((chunk, i) => {
    const criteria: Record<string, string> = {};
    for (const c of chunk) criteria[c.name] = c.description.slice(0, SUGGEST_WIDE_DESCRIPTION_CHARS);
    which[chunks.length === 1 ? 'which' : `which::${i}`] = choice(
      'Which skill best fits `request`? Each option is a skill name with a description of when it should be used.',
      criteria,
    );
  });
  return {
    ...which,
    acts_on_user_system: noul(
      'Does `request` ask the assistant to do something on the user\'s systems, files, or accounts, rather than only answer from knowledge?',
    ),
    would_follow_documented_procedure: noul(
      'Would a competent assistant handling `request` want to follow a documented procedure or checklist rather than improvise?',
    ),
    prose_suffices: noul(
      'Could `request` be fully satisfied by a plain prose answer, with no tool use, files, or procedure?',
    ),
  };
}

export function suggestShortlistQuestions(candidates: readonly SuggestCandidate[]): Record<
  string,
  ChoiceQuestion<Record<string, string>> | NoulQuestion
> {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.name] = c.description;
  const questions: Record<string, ChoiceQuestion<Record<string, string>> | NoulQuestion> = {
    which: choice('Which of these skills best fits `request`? Each option is a skill name with its full description.', criteria),
  };
  for (const c of candidates) {
    questions[`fits::${c.name}`] = noul(
      { question: 'Does this skill perform the specific task that `request` asks for?', skill: c.name, description: c.description },
      {
        true: 'The skill\'s stated purpose covers what the request actually asks for.',
        false: 'The skill is only adjacent, or the request asks for something it does not do.',
      },
    );
  }
  return questions;
}
