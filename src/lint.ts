/**
 * Warnings for hand-written `jev ask` requests: mistakes code can see and Jev cannot. Shape is
 * already enforced by the schemas; these catch requests that are valid but ask the wrong thing.
 * Warnings never stop a request.
 */
import { STATE_WARN_CHARS } from './questions.js';

export interface LintQuestion {
  readonly type: string;
  readonly instructions?: unknown;
  readonly criteria?: unknown;
}

/** Option names that let a Choice say nothing fits. */
const ESCAPE_OPTION = /^(none|other|others|neither|unknown|n\/a|no[ _-]?match|none[ _-]of[ _-]the[ _-]above|not[ _-]applicable)$/i;

/** A backticked reference such as `ticket.messages[0].text`; group 1 is its root field. */
const FIELD_REF = /`([A-Za-z_][\w-]*)(?:[.[][^`]*)?`/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (isRecord(value)) return Object.values(value).flatMap(textsIn);
  return [];
}

export function stateSizeWarning(state: unknown): string | undefined {
  const size = typeof state === 'string' ? state.length : (JSON.stringify(state)?.length ?? 0);
  if (size <= STATE_WARN_CHARS) return undefined;
  return `state is ${size} characters; Jev's accuracy drops with unrelated context, so send only what the questions need`;
}

export function lintRequest(state: unknown, questions: Readonly<Record<string, LintQuestion>>): string[] {
  const warnings: string[] = [];
  const fields = isRecord(state) ? new Set(Object.keys(state)) : undefined;
  for (const [id, q] of Object.entries(questions)) {
    if (fields) {
      const missing = new Set<string>();
      for (const text of textsIn(q.instructions)) for (const m of text.matchAll(FIELD_REF)) if (!fields.has(m[1]!)) missing.add(m[1]!);
      for (const field of missing) {
        warnings.push(`${id}: instructions mention \`${field}\`, which is not a field of state; backticks point Jev at state fields`);
      }
    }
    if (q.type === 'choice' && isRecord(q.criteria) && !Object.keys(q.criteria).some((k) => ESCAPE_OPTION.test(k.trim()))) {
      warnings.push(`${id}: choice has no none or other option; a Choice always picks one, so add one when nothing may fit`);
    }
    if (q.type === 'noul' && !(isRecord(q.criteria) && (q.criteria['true'] != null || q.criteria['false'] != null))) {
      warnings.push(`${id}: noul has no criteria; describing what true and false mean sharpens the boundary`);
    }
  }
  const size = stateSizeWarning(state);
  if (size) warnings.push(size);
  return warnings;
}
