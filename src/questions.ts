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

/** Most candidate ids one Choice question carries; beyond this, rank per candidate instead. */
export const WINDOW_MAX = 255;

/** `exists` at or above this: the query is answered by at least one candidate. */
export const EXISTS_PRESENT = 0.7;
/** `exists` at or above this but below present: partial coverage; below: nothing fits. */
export const EXISTS_PARTIAL = 0.35;

/** How many per-candidate requests run at once in rerank mode. Well under the 1,200/min limit. */
export const RERANK_CONCURRENCY = 12;

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
/** Characters of skill body appended to the description in the shortlist pass. */
export const SUGGEST_BODY_CHARS = 600;

export interface SuggestCandidate {
  readonly name: string;
  readonly description: string;
}

export function suggestWideQuestions(candidates: readonly SuggestCandidate[]): {
  which: ChoiceQuestion<Record<string, string>>;
  acts_on_user_system: NoulQuestion;
  would_follow_documented_procedure: NoulQuestion;
  prose_suffices: NoulQuestion;
} {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.name] = c.description.slice(0, SUGGEST_WIDE_DESCRIPTION_CHARS);
  return {
    which: choice(
      'Which skill best fits `request`? Each option is a skill name with a description of when it should be used.',
      criteria,
    ),
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
