/** Input validation shared by the `jev` command and the MCP tools. Mirrors the SDK's question shapes. */
import { z } from 'zod';

const json: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));

/** Text, a JSON object or array, or null: what `state`, `instructions` and criteria accept. */
const entry = z.union([z.string(), z.null(), z.array(json), z.record(z.string(), json)]);

const noulQuestion = z.object({
  type: z.literal('noul'),
  instructions: entry.optional(),
  criteria: z.object({ true: entry.optional(), false: entry.optional() }).nullable().optional(),
});

const choiceQuestion = z.object({
  type: z.literal('choice'),
  instructions: entry.optional(),
  criteria: z.record(z.string(), entry),
});

const scoreQuestion = z.object({
  type: z.literal('score'),
  instructions: entry.optional(),
  criteria: z.array(entry).min(2).max(10),
});

export const question = z.discriminatedUnion('type', [noulQuestion, choiceQuestion, scoreQuestion]);

export const askInput = z.object({
  state: entry.describe('What to judge: text, a JSON object, or an array. Send only what the questions need.'),
  questions: z
    .record(z.string(), question)
    .refine((q) => Object.keys(q).length > 0, 'at least one question')
    .describe('Named questions of type noul, choice or score; independent questions run in parallel.'),
});

export const candidate = z.object({ id: z.string().min(1), text: z.string() });

export const candidateList = z.array(candidate).min(1);

export const rankInput = z.object({
  query: z.string().min(1).describe('What the candidates are judged against.'),
  candidates: candidateList.describe('Items to rank. Keep text to what the query needs.'),
  mode: z
    .enum(['window', 'rerank'])
    .default('window')
    .describe('window: one request over all ids (<=255). rerank: one yes/no per candidate, better isolation.'),
  top: z.number().int().positive().optional().describe('Return only the best N.'),
});

export const checkInput = z.object({
  subject: entry.describe('What the conditions are checked against: text, a JSON object, or an array.'),
  conditions: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe('Each condition as a plain sentence, such as "adds a public export". One yes/no probability each.'),
});

export const classifyInput = z.object({
  query: z.string().min(1).optional().describe('What the options answer, when the labels alone do not say.'),
  options: z
    .record(z.string().min(1), z.string().nullable())
    .refine((o) => Object.keys(o).length >= 2, 'at least two options')
    .describe('Label -> description, or null. A "none" option is added unless one is given.'),
  candidates: candidateList.describe('Items to label, one request each.'),
});

/** One line per zod issue, `path: message`, for usage errors. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export type AskInput = z.infer<typeof askInput>;
export type RankInput = z.infer<typeof rankInput>;
export type CheckInput = z.infer<typeof checkInput>;
export type ClassifyInput = z.infer<typeof classifyInput>;
