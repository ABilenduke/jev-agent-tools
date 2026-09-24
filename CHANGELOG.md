# Changelog

## 0.3.0 — 2026-09-24

Two parts. First, a deep review of the code found several bugs, each reproduced on this machine first. Second, the agent no longer has to write Jev questions for the common cases.

- `jev check`: several yes/no conditions over one subject (stdin text, or JSON with `--json`), one request, verdicts `true`/`false`/`unsure` at 0.70/0.30 (decision 18).
- `jev classify`: labels items from the `rank` input modes with `--options`/`--option`, an automatic `none`, optional `--query`, one request per item (decision 18).
- `jev ask` warns on stderr about backticked names missing from state, Nouls without criteria, Choices without an escape option, and oversized state; the MCP tool returns them as `warnings` (decision 19).
- MCP tools `jev_check` and `jev_classify`.
- `jev-tools` skill rewritten around choosing a command; the `ask` section adds the rules that matter most.
- Every command rejects flags it does not take; non-JSON stdin without `--lines` suggests `--lines`.
- `--text-field` and `--id-field` let `rank` and `classify` read any JSON array of objects without reshaping it.
- `jev-tools` skill evaluated against its previous versions on three tasks and revised twice: per-item levels and yes/no go to `classify`, a rule for when `jev` is worth it and what to verify, and the `none` label explained (`docs/evaluation-and-tuning.md`).

- Hook: 5 s deadline (`HOOK_DEADLINE_MS`) with request cancellation. The SDK's per-attempt timeout with retries could previously outlast the 10 s hook timeout. Failed runs now log an `error` line (error name only, or `deadline`) instead of nothing (decision 14).
- Roster: plugins are named from `plugin.json`, so account-synced `pdf-viewer~g2` is `pdf-viewer` again, as the catalog shows. Entries with `disable-model-invocation: true` are dropped; the hook had suggested `codex:result`, which the model cannot invoke. `description: >-` block scalars no longer leave `>-` in the text. Codex plugin versions compare numerically (decision 15).
- Hook: rosters above 255 entries are split into several wide Choices in the same request instead of failing on the Choice option limit (decision 16).
- `jev rank`: `--max` and a 1,000-candidate default cap. `--files` skips `node_modules`, `.git`, empty and binary files. `--lines` reads single-file `grep -n` output and paths with spaces, and skips empty matches. Conflicting or ignored flags are usage errors. Empty stdin says what to pipe (decision 17).
- `jev --version`; `src/version.ts` feeds the CLI and the MCP server, which had reported 0.1.0. A test keeps it equal to `package.json` and `plugin.json`.
- JSON candidates are validated by the same zod schema as the MCP tool.
- `npm test` cleans `dist-test/` first, so deleted tests stop running.
- 83 offline tests.

## 0.2.0 — 2026-09-20

- The hook recognises which agent sent the prompt (`transcript_path` for Claude Code, `turn_id` for Codex) and ranks that agent's roster; unknown harnesses get the union. Logged as `agent`.
- Codex roster sources: `~/.agents/skills`, `~/.codex/skills/.system`, the plugin cache's `skills/` and migrated command skills, filtered by `config.toml`. Built from the catalogs in Codex's own session rollouts, not from its docs (decision 12).
- Codex hook registration documented and installed on this machine in `~/.codex/hooks.json`. Live Codex run still pending.
- Cookbook conformance review recorded in `docs/evaluation-and-tuning.md`; the shortlist body excerpt moves from 600 to the cookbook's 700 characters (decision 13).
- `jev-tools` skill links the TypeSafe docs index, primitive pages and the three cookbooks this tool implements, for agents without the `typesafe` skill.
- 40 offline tests.

## 0.1.0 — 2026-09-20

First working version, built and verified in one day.

- `jev rank` with `--files`, `--lines` and JSON input; window and rerank modes; `exists` and `verdict` alongside the ranking.
- `jev ask` for raw System One requests.
- `jev-tools` skill telling the agent when to use the command.
- `UserPromptSubmit` hook implementing TypeSafe's two-pass skill suggestion over every installed skill and slash command, with a JSONL log for tuning.
- Optional MCP server (`dist/mcp.js`) exposing `jev_rank` and `jev_ask`; not registered by default.
- Key resolution from `TYPESAFE_API_KEY` or `~/.config/typesafe/api_key`.
- 37 offline tests against a fake judge.

Changed the same day: the MCP server was the first interface and was replaced by the command as primary (`docs/decisions.md`, 2); the repository was renamed from `jev-claude-plugin` (decision 10); account-synced plugins were added to the roster after the first live run showed 65 of 86 entries (decision 8).
