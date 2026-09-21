/** Input validation for the MCP tools. Mirrors the SDK's question shapes. */
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

export const rankInput = z.object({
  query: z.string().min(1).describe('What the candidates are judged against.'),
  candidates: z
    .array(z.object({ id: z.string().min(1), text: z.string() }))
    .min(1)
    .describe('Items to rank. Keep text to what the query needs.'),
  mode: z
    .enum(['window', 'rerank'])
    .default('window')
    .describe('window: one request over all ids (<=255). rerank: one yes/no per candidate, better isolation.'),
  top: z.number().int().positive().optional().describe('Return only the best N.'),
});

export type AskInput = z.infer<typeof askInput>;
export type RankInput = z.infer<typeof rankInput>;
