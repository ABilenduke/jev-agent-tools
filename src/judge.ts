/**
 * The judgment port.
 *
 * Everything in this plugin that needs Jev asks through a `Judge`, never through the SDK
 * directly, so ranking and suggestion logic run in tests against a fake with no network.
 * The shapes are the SDK's own: one state, a map of named typed questions, answers keyed
 * by the same names.
 */
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

export interface JudgeRequest<Q extends Questions> {
  readonly state: EntryType;
  readonly questions: Q;
}

export type Judge = <Q extends Questions>(request: JudgeRequest<Q>) => Promise<SystemOneResult<Q>>;
