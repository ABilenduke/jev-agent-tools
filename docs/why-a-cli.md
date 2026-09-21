# Why a CLI beats an MCP server for this tool

The short version: with an MCP tool the agent has to read every candidate and type it back out; with the command it reads none of them. Everything below is that one fact worked through.

## The two paths for the same job

The job: find which of 200 source files is the one you want, so you can read that one.

**MCP tool path.** The tool call is `jev_rank({ query, candidates: [{id, text}, ...] })`. The candidates are tool-call arguments, and tool-call arguments are text the model generates. So the agent must:

1. Read each file to get its text into context. 200 reads, 200 tool results, all now permanently in the context window.
2. Generate the tool call: write out an id and a text excerpt for all 200 candidates, token by token. Output tokens, which are the slowest and most expensive tokens there are.
3. Receive the ranking, then read the winner. Again, because the earlier read is buried 200 results back.

**Command path.** The agent runs one shell command:

```bash
jev rank --query "..." --files 'src/**/*.ts' --chars 400 --top 5
```

`jev` opens the files, truncates each to 400 characters, sends them to Jev, and prints five ids with probabilities. The agent sees about 150 tokens of JSON. It then reads the one file that won.

## The arithmetic

Assumptions: 200 files averaging 2,000 tokens each; a 400-character excerpt is about 100 tokens; the model reads at input rates and writes at roughly 50 to 100 tokens per second.

| | MCP tool path | Command path |
|---|---|---|
| Model input tokens to load candidates | 200 files x 2,000 = **400,000** (the full files, since Read returns whole files) | **0** |
| Model output tokens to hand candidates to Jev | 200 x ~110 (id plus excerpt plus JSON) = **~22,000** | **0** |
| Time spent generating that tool call | 22,000 tokens at 50 to 100 tok/s = **4 to 7 minutes** | **0** |
| Jev input tokens | ~22,000 | ~22,000 (same excerpts, sent by the command) |
| Jev cost | ~$0.001 | ~$0.001 |
| Tokens that land in the agent's context | 400,000 in, 22,000 out, plus results | **~150** (the ranked JSON) |
| Context window after the operation | mostly consumed; a 200k window overflows before step 2 | untouched |

The MCP path does not merely cost more. On a 200k-token window it cannot complete: the reads alone overflow it. In practice the agent would notice and read fewer files, which means it is no longer ranking all 200, which was the point.

The command path costs the agent nothing it would not have spent anyway. It reads the winner. The 200 excerpts existed only inside the `jev` process and the API request.

## The same thing with grep

```bash
grep -rn "contrast" src | jev rank --query "the actual WCAG computation, not a call site" --lines --top 3
```

Forty matching lines go from grep to `jev` through a pipe. The agent never sees them. Under MCP it would first run grep, get forty lines back into context, then re-emit those forty lines as the tool call's `candidates`, doubling the tokens and adding a generation pass before Jev is even asked.

## Second-order effects

- **Latency compounds.** Every generation pass is serial and slow. The command's overhead is Node startup, about 100 ms, plus one API call, about 200 ms.
- **Context stays clean.** Nothing enters the window that the agent did not decide to read. Long sessions stay coherent longer.
- **Composition is free.** `jq`, `grep`, `find`, `sort`, and `head` all work on either side of `jev`. An MCP call is one shot with one argument shape.
- **Portability is free.** Anything with a shell can run it. MCP needs registration per agent and a running server.
- **No always-on cost.** MCP tool schemas sit in context or behind a lookup. The command costs nothing until the agent reads the skill or runs `--help`.

## Where MCP still earns its place

- Agents with no shell, or sandboxes that forbid subprocesses. That is why `dist/mcp.js` stays in the repo as an opt-in.
- Small inputs that the agent already has in context and would have to write to a file first. For a dozen candidates the difference is a few hundred tokens either way.
- Typed input validation without shell quoting. The command gets the same by taking JSON on stdin, validated by the same zod schemas.

## The rule this became

Default to a command plus a skill that documents it. Propose an MCP server only when the agent cannot run a shell, and say why. Recorded as decision 2 in `docs/decisions.md`.
