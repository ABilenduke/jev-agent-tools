# Cross-agent support

The repo is named `jev-agent-tools` because the intent is any coding agent, not one. This page records what is portable today, what is verified, and what is not.

| Piece | Claude Code | Codex | Other agents with a shell | Agents without a shell |
|---|---|---|---|---|
| `jev` command | yes | yes, nothing to register | yes | no; use the MCP server |
| `jev-tools` skill | yes, via the plugin | yes, symlink into `~/.agents/skills` | yes if the agent reads Agent Skills (`SKILL.md`) | depends |
| Skill-suggestion hook | yes, verified live | yes: detects Codex from the hook input and ranks Codex's own roster; registered in `~/.codex/hooks.json`; verified offline against a real session catalog, live run pending (see below) | mostly no; prompt hooks are uncommon | no |
| MCP server | opt-in, verified live with an SDK client | opt-in, `codex mcp add`; not verified live | if the agent speaks MCP | yes |

## Evidence

- Codex's documentation lists `UserPromptSubmit` among its hook events with the same stdin fields, states that plain stdout or `hookSpecificOutput.additionalContext` is added as context, and says it sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatibility with existing plugin hooks (read 2026-09-20).
- On this machine Codex already runs Claude-format plugin hooks: its `config.toml` holds trusted-hash entries for `security-guidance@claude-plugins-official:hooks/hooks.json` and others.
- Codex registers stdio MCP servers with `[mcp_servers.<name>]` tables or `codex mcp add`.
- `~/.agents/skills` is already used by Codex on this machine for skills such as `brd-plan` and `execute-plan`.
- Every Codex session rollout under `~/.codex/sessions/` records the exact skill catalog the agent saw, with roots and names. The Codex roster loader was built from those catalogs and reproduces the latest one on this machine exactly, plus 21 entries Codex hides for reasons not visible on disk (`docs/hook-skill-suggestion.md`).
- Codex's `UserPromptSubmit` stdin carries `turn_id` and no `transcript_path`; Claude Code's carries `transcript_path`. That is enough to tell them apart (2026-09-20).
- Codex is installed on this machine inside the VS Code extension, `~/.vscode-server/extensions/openai.chatgpt-*/bin/linux-x86_64/codex` (0.154.0-alpha.6.2), not on PATH.

## Not verified

- Loading the plugin directory itself into Codex. Its docs describe marketplace installs; direct registration of the command, skill and hook avoids the question.
- The hook under Codex end to end. On 2026-09-20 `codex exec` reached `turn.started` and then failed on the account's Codex usage limit (resets 2026-09-22); the hook was registered but no prompt completed. Also pending: Codex records a `trusted_hash` per hook in `config.toml`, so the first interactive session will probably ask to trust the new entry. To finish: open Codex, accept the hook, send a prompt, and check the newest line of `suggestions.jsonl` has `"agent":"codex"`.

## The former gap

Until 2026-09-20 `src/roster.ts` knew Claude Code's skill locations only, and this page said the hook input could not identify the agent. Both were fixed the same day: the loader takes an `agent` and enumerates that agent's locations, the hook reads the agent from stdin, and the union is only the fallback for an unrecognised harness. Decision 12 in `docs/decisions.md`.
