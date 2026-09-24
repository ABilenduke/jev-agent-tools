# Decisions

Dated, in the order they were made. Each records what was chosen, what was rejected and why. 1 to 13 on 2026-09-20; later entries carry their date.

## 1. Shape: a command and a hook, not an agent or a gateway

**Chosen.** Expose Jev as something the agent runs (originally MCP tools, see decision 2) plus a hook the harness runs on every prompt.

**Rejected.** A subagent wrapping Jev: a reasoning model in front of a 100 ms judgment API removes the speed and cost advantage, and Jev does not converse. A gateway or proxy: one endpoint, one bearer key, retries in the SDK; nothing to route. Documentation only: the pre-existing `typesafe` skill already covered writing product code against Jev, but gave the agent no way to use Jev in its own work.

**Why a hook first.** TypeSafe's skill-suggestion cookbook targets the harness problem directly, with measured results, and the roster on this machine is large. It also demonstrates the second kind of use: Jev deciding with no model in the loop.

## 2. Command-line interface as primary; MCP server opt-in

**Chosen.** `jev rank` and `jev ask` on PATH. `dist/mcp.js` kept in the repo, not registered.

**Rejected.** MCP tools as the primary interface, which is what was built first.

**Why.** Andrew asked why an MCP server rather than a CLI, and the comparison did not favour MCP for this tool. With an MCP tool the model must emit every candidate's text as tool-call arguments, so bulk data flows through its context and output tokens; the command reads files and grep output itself. A command runs in any agent with a shell, composes with pipes and `jq`, and costs no context until used. MCP keeps a small edge for shell-less agents and for typed input without shell quoting, which the command matches by taking JSON on stdin. Noted as a standing preference: default to a CLI plus a skill; propose MCP only when there is no shell. The token arithmetic is worked through in `docs/why-a-cli.md`.

## 3. Personal tooling, not a product dependency

**Chosen.** The plugin lives outside every Cylinder Software repository and no company code depends on it. Product code that needs a judgment service continues to take a judgment function as an argument, as the design-system authoring layer does, so the provider remains an open product choice.

**Why.** The company's AGENTS.md forbids child repositories depending on personal plugins, and TypeSafe has not been selected for any product. Documentation of this plugin belongs in this repo, not in the company knowledge vault.

## 4. Key resolution: environment, then a key file; never write one

**Chosen.** `TYPESAFE_API_KEY`, else `~/.config/typesafe/api_key`. The plugin never creates or copies a key.

**Why.** Hooks run under `sh -c` without the interactive profile, and MCP clients strip the environment; both were observed during development. A file with mode 600 is reachable by every launch path. Copying a secret is the user's action, not the tool's.

## 5. The Judge port and offline tests

**Chosen.** Every module that asks Jev takes a `Judge` function. Tests pass a fake; production passes the SDK-backed judge from `client.ts`. The suite runs with no network.

**Why.** Mirrors the port the design-system package already uses for the same reason, and made test-first development possible for ranking, suggestion and the command without spending tokens or depending on model behaviour.

## 6. Window mode falls back to rerank above 255 candidates

**Chosen.** No two-pass window selection.

**Rejected.** The cookbook's two-pass approach (a Choice picks a window of lines, a second Choice ranks within it).

**Why.** Simpler, and rerank is already the more isolated mode. Window selection can be added if a real workload with thousands of candidates shows rerank too slow or costly.

## 7. All questions and thresholds in one file

**Chosen.** `src/questions.ts` holds every question text and constant. No configuration file, no environment overrides.

**Why.** TypeSafe's guidance is that these are what a human should review. A constant in a reviewed diff is easier to reason about than a value that might come from three places.

## 8. Roster naming follows the Claude Code catalog

**Chosen.** Plugin skills are `<plugin>:<skill>`, synced user skills are `anthropic-skills:<name>`, project commands are bare names.

**Why.** A suggestion is only useful if the agent can invoke it verbatim. The names were checked against the session catalog and the first live runs.

## 9. Trust `CLAUDE_PLUGIN_DATA` only when it names this plugin

**Chosen.** The data directory is `CLAUDE_PLUGIN_DATA` only if its basename starts with `jev`; otherwise `~/.local/state/jev-agent-tools`.

**Why.** During development the shell carried another plugin's `CLAUDE_PLUGIN_DATA`, and the first log line landed in that plugin's directory. The harness sets the variable correctly for real hook runs; the guard protects against inherited values.

## 10. Repository renamed from `jev-claude-plugin` to `jev-agent-tools`

**Chosen.** The rename, with the plugin id `jev`, the MCP server name `jev` and the skill `jev-tools` unchanged.

**Why.** Andrew asked whether it would work with Codex and other agents. The command and skill do; the name should not claim otherwise.

## 11. No cache for the roster or for answers

**Chosen.** Re-read roster files on every hook run; never cache Jev answers.

**Why.** About 90 small files read in milliseconds; a cache is one more thing to invalidate. Answers are cheap and state changes between calls.

## 12. Codex roster from observed catalogs; agent detected from hook stdin

**Chosen.** `loadRoster` takes an `agent`. The hook sets it from stdin: `transcript_path` means Claude Code, `turn_id` means Codex, neither means `unknown` and the union of both rosters. The Codex sources are the ones Codex's own session rollouts list as skill roots on this machine (codex-cli 0.154): `~/.agents/skills`, `~/.codex/skills/.system`, the plugin cache's `skills/` and `.codex-plugin/migrated-command-skills/`, and `<cwd>/.agents/skills`. Plugins are filtered by `enabled = false` and by whether their marketplace is still declared in `config.toml`, with the remote marketplace always in. `config.toml` is scanned by line for table headers and `enabled` only.

**Rejected.** The roadmap's list, which included legacy `~/.codex/skills/<name>`: that directory holds a valid skill here and appears in none of the twelve latest session catalogs, so Codex 0.154 does not read it and ranking it would suggest something the agent cannot load. Plugin `commands/*.md` under Codex, for the same reason. Reading the catalog out of the current session's rollout at hook time: exact, but the rollout is an internal format and may not yet contain the catalog when the first prompt's hook runs. A TOML parser dependency for two fields.

**Known imprecision.** The loader reproduces the latest real catalog (111 entries) plus 21 Codex hides without any visible marker: the 20 skills of the remote `openai-templates` plugin, which `codex plugin list` reports installed and enabled, and the system skill `review-agent`. Accepted until a real prompt is mis-suggested to one of them; the log's `agent` and `skill` fields will show it.

**Why.** Andrew asked for the hook to be correct under Codex. The catalog Codex writes into its rollouts is better evidence than its documentation, which lists locations this version does not read and omits the plugin naming. Detecting the agent was thought impossible when `docs/cross-agent.md` was first written; the stdin field lists of the two harnesses differ, and the offline run shows the same prompt suggesting `design:accessibility-review` under Claude Code and `vercel:react-best-practices` under Codex, each invocable where it is suggested.

## 13. Shortlist body excerpt aligned to the cookbook's 700 characters

**Chosen.** `SUGGEST_BODY_CHARS` goes from 600 to 700.

**Why.** A conformance review against TypeSafe's cookbooks (`docs/evaluation-and-tuning.md`, 2026-09-20) found this the only constant that differed from its cookbook source without a recorded reason. Every threshold here is still an untuned cookbook default, so an unexplained deviation from the one measured configuration is worse than none. The review also recorded that the `jev rank` questions generalise the line-by-line search cookbook rather than copy it, and that rerank mode's `exists` is this project's own heuristic; both are now stated in `docs/questions-and-thresholds.md`.

## 14. A 5 s deadline for the hook, and errors in the log (2026-09-24)

**Chosen.** `HOOK_DEADLINE_MS = 5_000`. The hook races its work against the deadline and passes an `AbortSignal` to the judge so in-flight requests are cancelled; a backstop timer exits 0 if stdin never closes. On any failure or the deadline it prints nothing, as before, but now logs one line with `error` set to the error's `name` (or `deadline`) and no message. `main()` became a thin wrapper around a testable `runHook`, and a test spawns the built hook to check it exits 0 with empty stdout on garbage input and on a missing key.

**Rejected.** Relying on the 10 s timeout in `hooks.json`. The SDK's timeout is per attempt, with two retries and no total budget, so two requests could take about 30 s; the harness would kill the hook after 10 s with the user waiting. Lowering the SDK's retries instead: a retry that fits inside the deadline is still worth having. Logging error messages: names are enough to diagnose, and a message could carry a path or other detail that has no business in a log.

**Why.** A failed hook used to leave no trace, so a missing key or a slow network looked the same as "no skill fits". Typical runs take about 1 s, so 5 s cuts nothing that would have succeeded.

## 15. Roster names and entries match the catalog again (2026-09-24)

**Chosen.** A plugin's namespace comes from its `.claude-plugin/plugin.json` `name`, else its directory name without a `~suffix`. Entries with `disable-model-invocation: true` are dropped. YAML block-scalar indicators (`>`, `|-` and so on) are folded like continuation lines instead of becoming the first characters of the description. Codex plugin versions are compared numerically.

**Evidence.** Each was found on this machine. Account-synced plugins now sit in directories such as `pdf-viewer~g2`, so the roster offered `pdf-viewer~g2:open` while the catalog shows `pdf-viewer:open`. The five `codex:*` commands marked `disable-model-invocation` are absent from the model's catalog, yet on 2026-09-24 the hook suggested `codex:result` for a real prompt. The `typesafe:typesafe-ai` description began with `>`. A text sort of versions puts `6.3.0` above `10.0.0`. `user-invocable: false` skills stay: they are in the model's catalog.

**Why.** Decision 8: a suggestion is only useful if the agent can invoke it verbatim.

## 16. Wide pass split into Choices of at most 255 (2026-09-24)

**Chosen.** When the roster has more than `WINDOW_MAX` entries, the wide pass asks one Choice per balanced chunk (`which::0`, `which::1`, ...) in the same single request, with the same gate Nouls. Each chunk nominates its top `SUGGEST_SHORTLIST`, and the shortlist pass judges every nominee. At 255 entries or fewer, the request is identical to before.

**Rejected.** Truncating the roster, which would silently drop skills. A separate request per chunk, which adds latency for no gain because questions in one request already run in parallel.

**Why.** TypeSafe's Choice accepts at most 255 options. The union roster was 183 entries on 2026-09-21 and grows with every plugin; past 255 the wide request would fail on every prompt, silently. Probabilities from different chunks are not one distribution, which is why nominees go to the shortlist pass rather than being compared directly.

## 17. Guards on `jev rank` input (2026-09-24)

**Chosen.** `MAX_CANDIDATES = 1_000`, raised per call with `--max N`; exceeding it is a usage error before any request. `--files` skips `node_modules` and `.git` unless the pattern names them, and skips empty files and files with a NUL byte. `--lines` also reads single-file `grep -n` output (`12:text`, id `12`) and paths with spaces, and skips matches with no text. `--files` with `--lines`, `--chars` without `--files`, and flags on `ask` are usage errors rather than silently ignored.

**Why.** Above 255 candidates every candidate is its own request. A glob such as `'**/*.md'` from a repository root matched every dependency's README, and 10,000 candidates would be 10,000 requests against a limit of 1,200 a minute. At 1,000 the worst case stays around a minute. The `grep -n "" file` recipe in `docs/cli.md` produced wrong ids and let blank lines become candidates.

## 18. `jev check` and `jev classify`: question wording in code, not in the agent (2026-09-24)

**Chosen.** Two commands in the mould of `rank`. `check` takes a subject on stdin and conditions as plain sentences, and sends one request with a Noul per condition. `classify` takes label names, with optional descriptions, and items from the `rank` input modes, and sends one Choice per item with a `none` option added. Wording, criteria and thresholds live in `questions.ts`, with verdicts `true`/`false`/`unsure` at 0.70/0.30. Both are also MCP tools, validated by shared schemas.

**Rejected.** Templates in the skill as the main answer: they still leave the agent writing questions, and the skill's own description already promised "checking a batch of yes/no conditions", which only `ask` could do. Classifying all items in one request, one Choice each over a shared state: fewer requests, but items would share context and sway one another, the problem rerank mode exists to avoid, and state would grow with the batch. Letting `check` treat "not shown" as uncertain: an agent acting on `check` should act on evidence.

**Evidence.** First live runs, 2026-09-24. `check` on a four-line diff got all five conditions right, each with p >= 0.90 or <= 0.03. `classify` put five TODO comments in the expected categories, with "buy milk" going to the automatic `none` (0.53). Three issue reports were classified by bare labels plus `--query`, all at p = 1.

**Why.** Question quality was the one part of the tool no code checked. `rank` and the hook were reviewed; hand-written `ask` requests were not, and Jev cannot judge question design (conformance review, 2026-09-20). Moving the common shapes into reviewed code removes the question from the agent's hands.

## 19. `jev ask` warns about requests that are valid but likely wrong (2026-09-24)

**Chosen.** `src/lint.ts` checks a parsed request for a backticked name missing from object state, a Noul without criteria, a Choice without a none/other option, and state over `STATE_WARN_CHARS`. The CLI prints the warnings on stderr and the MCP tool returns them as `warnings`. They never block the request.

**Rejected.** Failing on them: each has legitimate exceptions, such as a Choice whose options are exhaustive, or a backticked literal. Asking Jev to review the questions: it was measured poor at that.

**Why.** Jev answers flawed questions without complaint. In the first live test, a Noul pointing at a missing field still came back at 0.98. These are the mistakes code can see and the model cannot.
