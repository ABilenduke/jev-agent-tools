# Architecture

`jev-agent-tools` puts one idea in front of every module: **code owns the workflow, Jev supplies a probability.** Jev (TypeSafe's System One model) answers typed questions about a piece of state in about 100 ms and never generates text. Everything here either builds a question, feeds one to Jev, or turns a probability into a decision.

## Modules

```
src/
  judge.ts               the Judge port: (state, questions) -> answers. Every caller goes through it.
  client.ts              key resolution and the only place that constructs the TypeSafe client
  questions.ts           every question text and every threshold. The file a human reviews.
  rank.ts                ranking: window mode (one Choice over ids) and rerank mode (one Noul per candidate)
  schemas.ts             zod schemas for ask/rank input, shared by the CLI and the MCP server
  cli-core.ts            argument parsing, the three candidate input modes, command logic
  cli.ts                 `jev` entry point: wires stdin/stdout/process.exit to cli-core
  roster.ts              enumerates installed skills and slash commands for the hook
  hooks/skill-suggest.ts UserPromptSubmit hook: two-pass skill suggestion, logging, never blocks
  mcp.ts                 optional MCP server exposing jev_rank and jev_ask; not registered by default
```

Packaging files:

```
.claude-plugin/plugin.json   plugin manifest; skills path points at skills/jev-tools
hooks/hooks.json             registers the UserPromptSubmit hook with a 10 s timeout
skills/jev-tools/SKILL.md    tells the agent when to reach for `jev`
dist/                        compiled output that hooks.json and the bin entry run; built, not committed
```

## The Judge port

```ts
type Judge = <Q extends Questions>(request: { state: EntryType; questions: Q }) => Promise<SystemOneResult<Q>>;
```

`rank()`, `suggest()` and the CLI core take a `Judge` argument. Tests pass a fake that answers from a probability table; production passes `createJudge()`, which wraps the real SDK client. Nothing else in the codebase imports the SDK client. This is what makes the whole suite run offline in about 100 ms and lets the ranking and suggestion logic be reasoned about without a network.

## Data flow: `jev rank`

```
--files GLOB ─┐
--lines stdin ─┼─> Candidate[] {id, text} ─> rank(judge, {query, candidates, mode, top})
JSON stdin   ─┘                                   │
                                   window ────────┼──────── rerank
                    one request:                  │        one request per candidate,
                    state {query, candidates}     │        state {query, candidate},
                    best: Choice over ids         │        matches: Noul, 12 concurrent
                    exists: Noul                  │
                                                  ▼
                            { mode, exists, verdict, ranked[{id,p}], requests, inputTokens }
```

Window mode is one request and one Choice whose options are the candidate ids. The Choice always produces a winner, so a separate `exists` Noul says whether anything actually fits; `verdict` is derived from it in code. Above 255 candidates the Choice cannot carry every id, so window mode falls back to rerank rather than attempting a two-pass window selection. That fallback was chosen over the two-pass approach for simplicity; see `docs/decisions.md`.

Rerank mode isolates each candidate in its own request, following TypeSafe's re-ranking cookbook. It is more requests but no candidate can distract the judgment of another.

## Data flow: skill-suggestion hook

```
stdin {prompt, cwd}
   │  skip if < 12 chars or starts with "/"
   ▼
loadRoster(home, cwd) ──> RosterEntry[] {name, description, body, kind}
   │
   ▼  request 1, state {request: prompt}
which: Choice over every roster name (descriptions truncated to 240 chars)
acts_on_user_system, would_follow_documented_procedure, prose_suffices: Nouls
   │  gate = mean(acts, follows, 1 - prose); stop if gate < 0.30
   ▼  request 2, same state
which: Choice over top 3 (full description + 700 chars of body)
fits::<name>: one Noul per shortlisted skill
   │  suggest Choice winner if max(fits) >= 0.30, else nothing
   ▼
stdout {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<skill_relevance>...</skill_relevance>"}}
log line appended to suggestions.jsonl
```

Every failure path exits 0 with no output. The hook can slow a prompt by about a second; it can never block one.

## Why state stays small

Jev's accuracy falls as unrelated state grows (TypeSafe documents this under "jaggedness"). So `rank` sends only the query and the candidate text, never surrounding context; `--chars` truncates files; the hook sends only the prompt. Anything that needs filtering is filtered in code before the request.

## What is deliberately not here

- No caching of answers. Requests are cheap and state changes between calls.
- No retries beyond the SDK's own. A 5 s per-attempt timeout is set in `client.ts`.
- No roster cache. Reading about 90 small files takes a few milliseconds; a cache would be another thing to invalidate.
- No configuration file. Thresholds are constants in `questions.ts` so a change is a reviewed diff.
