# The skill-suggestion hook

A `UserPromptSubmit` hook that runs before the agent sees each prompt, ranks every installed skill and slash command against it, and injects one line of context naming the most relevant one or saying none applies. It follows TypeSafe's skill-suggestion cookbook, which measured wrong-skill loads halving and needless loads halving on a 182-skill roster.

## Why it exists

Agents with large skill rosters load the wrong skill or a needless one a meaningful fraction of the time, because they choose from truncated descriptions in one pass. A calibrated judgment over the whole roster, made before the agent starts, is cheap insurance: about 7k input tokens and under a second per prompt on an 86-entry roster.

## What the agent sees

```
<skill_relevance>Relevant to the current request: design:accessibility-review. Ignore this if it does not fit what the user actually asked for.</skill_relevance>
```

or

```
<skill_relevance>No skill in the roster appears relevant to this request.</skill_relevance>
```

It is a hint, not an instruction. The agent's own skill rules still decide.

## Registration

`hooks/hooks.json`:

```json
{ "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/skill-suggest.js", "timeout": 10 } ] } ] } }
```

Claude Code loads it with the plugin. Codex reads the same file format from `~/.codex/hooks.json`; the entry there names the built file by absolute path because nothing sets `CLAUDE_PLUGIN_ROOT` outside a plugin (`docs/install.md`).

## Input

Hook stdin JSON. Fields used: `prompt`, `cwd`, and two that identify the harness: Claude Code sends `transcript_path`, Codex sends `turn_id` and no transcript. `transcript_path` wins, then `turn_id`, else the agent is `unknown` and both rosters are ranked as one. The hook skips silently when the trimmed prompt is under 12 characters or starts with `/` (a slash command already names its skill).

## The two requests

Both use `state = { request: <prompt> }`. Question text is in `src/questions.ts`.

**Request 1, wide pass.**

- `which`: a Choice over every roster name; each option's description is truncated to 240 characters, roughly what the agent itself sees in its catalog.
- `acts_on_user_system`: does the request ask for action on the user's systems, files or accounts?
- `would_follow_documented_procedure`: would a competent assistant want a documented procedure rather than improvising?
- `prose_suffices`: could a plain prose answer satisfy it?

The gate is the mean of the first two and `1 - prose_suffices`. If the gate is below `SUGGEST_GATE` (0.30) the hook reports no relevant skill and stops after one request.

**Request 2, shortlist pass.** The top `SUGGEST_SHORTLIST` (3) names from the wide Choice.

- `which`: a Choice over the three, each described by its full description plus the first 600 characters of its SKILL.md body.
- `fits::<name>`: one Noul per shortlisted skill asking whether it performs the specific task requested. The instructions carry the skill name and description as a structured object.

If the best `fits` probability is below `SUGGEST_FIT` (0.30) nothing is suggested. Otherwise the shortlist Choice winner is suggested.

## Roster sources

`src/roster.ts` enumerates the locations of whichever agent sent the prompt, and names entries the way that agent's session catalog shows them so a suggestion can be invoked verbatim.

**Claude Code**, in the order the session catalog surfaces them:

| Location | Named as |
|---|---|
| `~/.claude/skills/<name>/SKILL.md` | `<name>` |
| `~/.claude/skills/synced/<bucket>/<name>/SKILL.md` | `anthropic-skills:<name>` |
| `~/.claude/skills/<plugin>/.claude-plugin/` (skills-dir plugins) | `<plugin>:<skill>`, `<plugin>:<command>` |
| `~/.claude/plugins/installed_plugins.json` entries with scope `user`, or scope `project` matching `cwd`, not disabled in `settings.json` | `<plugin>:<skill>`, `<plugin>:<command>` |
| `~/.claude/plugins/synced/<bucket>/<plugin>/` | `<plugin>:<skill>`, `<plugin>:<command>` |
| `<cwd>/.claude/skills/<name>/SKILL.md` | `<name>` |
| `<cwd>/.claude/commands/<name>.md` | `<name>` |
| `<cwd>/.agents/skills/<name>/SKILL.md` | `<name>` |

Entries without a `description` in frontmatter are dropped: the model cannot judge what is not described. Duplicate names keep the first occurrence. Frontmatter parsing is minimal and folds indented continuation lines into the value, which is how the scaffolded descriptions are written.

**Codex** (codex-cli 0.154), taken from the `<skills_instructions>` catalog Codex writes into every session rollout rather than from its documentation:

| Location | Named as |
|---|---|
| `~/.agents/skills/<name>/SKILL.md` | `<name>` |
| `~/.codex/skills/.system/<name>/SKILL.md` | `<name>` |
| `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md` | `<plugin>:<skill>` |
| `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/.codex-plugin/migrated-command-skills/<dir>/SKILL.md` | `<plugin>:<dir>` |
| `<cwd>/.agents/skills/<name>/SKILL.md` | `<name>` |

A cached plugin counts when `~/.codex/config.toml` does not set `enabled = false` for `<plugin>@<marketplace>` and either declares `[marketplaces.<marketplace>]` or the marketplace is the account-managed `openai-curated-remote`, whose plugins have no config entry. The file is scanned line by line for those two things only. When several versions are cached the newest wins the name. Legacy `~/.codex/skills/<name>` and plugin `commands/` directories are not in the Codex catalog and are skipped.

Compared with the catalog of a real session on this machine (111 entries), the loader produces the same 111 plus 21 it cannot tell apart: the 20 `openai-templates:*` skills of a remote plugin that is installed and enabled but not surfaced, and the system skill `review-agent`. Both have ordinary frontmatter; whatever hides them is not on disk. Decision 12.

`agent: 'unknown'` returns the union of both lists, Claude Code entries first.

## Logging

Each run that reaches the judge appends one JSON line to `suggestions.jsonl` in the data directory:

| Field | Meaning |
|---|---|
| `at` | ISO timestamp |
| `prompt_sha256` | first 16 hex characters of the prompt's SHA-256; the prompt itself is not stored |
| `prompt_chars` | prompt length |
| `agent` | `claude`, `codex` or `unknown`, from the stdin fields above |
| `roster_size` | entries considered |
| `skill` | the suggestion, or `null` |
| `gate` | the gate mean |
| `shortlist` | the three names from the wide pass |
| `fit` | best shortlist `fits` probability; absent when the gate closed |
| `requests`, `inputTokens` | 1 or 2, and tokens billed |
| `latency_ms` | wall time for the whole hook run |

The data directory is `CLAUDE_PLUGIN_DATA` when its basename starts with `jev`, otherwise `~/.local/state/jev-agent-tools/`. The basename check exists because a shell inherited from another plugin's context can carry that plugin's `CLAUDE_PLUGIN_DATA`; this was observed during development.

## Failure behaviour

Any error, including a missing API key, a network failure, unreadable roster files or malformed stdin, results in exit 0 with no stdout. The prompt proceeds without a hint. The hook timeout in `hooks.json` is 10 s; typical runs are under 1 s.

## Observed behaviour on first day

| Prompt | Suggestion | Gate | Fit |
|---|---|---|---|
| "audit the accessibility of the primary button component" | `design:accessibility-review` | 0.67 | 0.93 |
| "what is our PTO policy for contractors?" | `human-resources:policy-lookup` | 0.49 | 0.93 |
| "explain the difference between a noul and a score in typesafe" | none (gate closed) | < 0.30 | – |

Before the synced-plugin sources were added the roster had 65 entries and the first prompt was matched to `cylinder-design`, a reasonable but less specific pick. Roster coverage matters as much as thresholds.
