/**
 * Label many items with one of a few named options.
 *
 * One request per item, like rerank mode, so items cannot distract one another's judgment. The
 * question wording and the `none` escape option come from `questions.ts`; the agent supplies only
 * option names, optional descriptions, and the items.
 */
import type { Judge } from './judge.js';
import { RERANK_CONCURRENCY, classifyQuestions } from './questions.js';
import { mapLimit, type Candidate } from './rank.js';

export type OptionMap = Readonly<Record<string, string | null>>;

export interface ClassifyOptions {
  /** What the options answer, when the labels alone do not say, such as "what kind of change is this". */
  readonly query?: string;
  readonly options: OptionMap;
  readonly items: readonly Candidate[];
}

export interface ClassifyResult {
  /** One per item, in input order: the chosen label and its probability. */
  readonly items: readonly { id: string; label: string; p: number }[];
  /** Items per label, for every label including `none`, in option order. */
  readonly counts: Readonly<Record<string, number>>;
  readonly requests: number;
  readonly inputTokens: number;
}

/** `name=description` or a bare `name` per spec. */
export function parseOptionSpecs(specs: readonly string[]): Record<string, string | null> {
  const options: Record<string, string | null> = {};
  for (const spec of specs) {
    const at = spec.indexOf('=');
    const name = (at === -1 ? spec : spec.slice(0, at)).trim();
    const description = at === -1 ? '' : spec.slice(at + 1).trim();
    if (name === '') throw new Error(`option needs a name: "${spec}"`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate option: ${name}`);
    options[name] = description === '' ? null : description;
  }
  return options;
}

export async function classify(judge: Judge, { query, options, items }: ClassifyOptions): Promise<ClassifyResult> {
  if (Object.keys(options).length < 2) throw new Error('classify needs at least two options');
  if (items.length === 0) throw new Error('classify needs at least one item');
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`duplicate item id: ${item.id}`);
    seen.add(item.id);
  }
  const questions = classifyQuestions(options, query !== undefined);
  const results = await mapLimit(items, RERANK_CONCURRENCY, (item) => {
    const it = { id: item.id, text: item.text };
    return judge({ state: query === undefined ? { item: it } : { query, item: it }, questions });
  });
  const counts: Record<string, number> = {};
  for (const label of Object.keys(questions.label.criteria)) counts[label] = 0;
  const labelled = items.map((item, i) => {
    const answer = results[i]!.answers.label;
    counts[answer.choice] = (counts[answer.choice] ?? 0) + 1;
    return { id: item.id, label: answer.choice, p: answer.probabilities[answer.choice] ?? 0 };
  });
  return {
    items: labelled,
    counts,
    requests: results.length,
    inputTokens: results.reduce((sum, r) => sum + r.usage.input_tokens, 0),
  };
}
