# Changelog

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
