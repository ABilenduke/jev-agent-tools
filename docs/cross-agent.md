# Cross-agent support

The repo is named `jev-agent-tools` because the intent is any coding agent, not one. This page records what is portable today, what is verified, and what is not.

| Piece | Claude Code | Codex | Other agents with a shell | Agents without a shell |
|---|---|---|---|---|
| `jev` command | yes | yes, nothing to register | yes | no; use the MCP server |
| `jev-tools` skill | yes, via the plugin | yes, symlink into `~/.agents/skills` | yes if the agent reads Agent Skills (`SKILL.md`) | depends |
| Skill-suggestion hook | yes, verified live | runs (same hook format, `CLAUDE_PLUGIN_ROOT` set for compatibility) but ranks the wrong roster; not verified live | mostly no; prompt hooks are uncommon | no |
| MCP server | opt-in, verified live with an SDK client | opt-in, `codex mcp add`; not verified live | if the agent speaks MCP | yes |

## Evidence

- Codex's documentation lists `UserPromptSubmit` among its hook events with the same stdin fields, states that plain stdout or `hookSpecificOutput.additionalContext` is added as context, and says it sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatibility with existing plugin hooks (read 2026-09-20).
- On this machine Codex already runs Claude-format plugin hooks: its `config.toml` holds trusted-hash entries for `security-guidance@claude-plugins-official:hooks/hooks.json` and others.
- Codex registers stdio MCP servers with `[mcp_servers.<name>]` tables or `codex mcp add`.
- `~/.agents/skills` is already used by Codex on this machine for skills such as `brd-plan` and `execute-plan`.

## Not verified

- Loading the plugin directory itself into Codex. Its docs describe marketplace installs; direct registration of the command, skill and hook avoids the question.
- The hook under Codex end to end. The Codex binary was not on PATH in the session that built this.

## The one real gap

`src/roster.ts` knows Claude Code's skill locations only. To be correct under Codex it needs, at minimum, `~/.codex/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md` at user level, and the Codex plugin cache under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills`. Detecting which agent invoked the hook is not possible from the hook input; a practical approach is to enumerate every known location and let the roster be the union, deduplicated by name. This is the first item in `docs/roadmap.md`.
