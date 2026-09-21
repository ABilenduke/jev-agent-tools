# Install and credentials

## Requirements

- Node 22 or newer (`fs.glob` is used by `--files`). Developed and measured on Node 24.
- A TypeSafe API key from https://console.typesafe.ai/.

## Install

```bash
git clone <this repo> ~/code/abilenduke/jev-agent-tools
cd ~/code/abilenduke/jev-agent-tools
npm install
npm run check     # typecheck, tests, build
npm run link      # ~/.local/bin/jev -> dist/cli.js
jev --help
```

`~/.local/bin` must be on PATH. Without the link, `node ~/code/abilenduke/jev-agent-tools/dist/cli.js` is equivalent everywhere `jev` is written.

`dist/` is a build product and is not committed. After pulling changes, run `npm run build` (or `npm run check`) before relying on the command or the hook.

## Credentials

The key is resolved in this order:

1. `TYPESAFE_API_KEY` in the environment, ignored if blank.
2. The contents of `~/.config/typesafe/api_key`, trimmed.

Create the file once:

```bash
mkdir -p ~/.config/typesafe
printf '%s' 'ts_...' > ~/.config/typesafe/api_key   # sanitized example
chmod 600 ~/.config/typesafe/api_key
```

The file fallback matters more than it looks. Claude Code runs hooks through `sh -c`, which does not source an interactive shell profile, and MCP clients typically spawn servers with a stripped environment. An `export` in `.bashrc` reaches the interactive shell and processes started from it, and nothing else. With the key file in place the export can be removed.

The plugin never writes a credential anywhere and never logs one. The suggestion log stores a prompt hash, not the prompt.

When no key is found: the hook exits 0 silently, so prompts are unaffected; `jev` exits 1 with a message naming both locations; the optional MCP tools return an error result with the same message.

## Claude Code

```bash
ln -s ~/code/abilenduke/jev-agent-tools ~/.claude/skills/jev
```

It loads next session as `jev@skills-dir` (or after `/reload-plugins`). Confirm:

```bash
claude plugin details jev@skills-dir
```

Expected inventory: one skill (`jev-tools`), one hook (`UserPromptSubmit`), zero MCP servers, about 180 always-on tokens.

Disable: `claude plugin disable jev@skills-dir`. Remove: delete the symlink.

## Codex

The command needs nothing beyond PATH. For the skill:

```bash
ln -s ~/code/abilenduke/jev-agent-tools/skills/jev-tools ~/.agents/skills/jev-tools
```

For the hook, add the `UserPromptSubmit` entry from `hooks/hooks.json` to `~/.codex/hooks.json`, replacing `${CLAUDE_PLUGIN_ROOT}` with the repo path if Codex does not expand it in that file. Codex documents the same stdin fields and honours `hookSpecificOutput.additionalContext`. Known gap: the roster loader enumerates Claude Code locations only, so the suggestions will name Claude's skills. See `docs/roadmap.md`.

## Other agents

Any agent with a shell can run `jev` once it is on PATH; point its skill or instructions mechanism at `skills/jev-tools/SKILL.md`. Agents without a shell can use the optional MCP server, `docs/mcp-server.md`.

## Verifying an install

```bash
echo '{"state":"Help!","questions":{"urgent":{"type":"noul","instructions":"Is this urgent?"}}}' | jev ask
printf 'a.md:1: apples\nb.md:1: bolts\n' | jev rank --query "hardware" --lines
echo '{"prompt":"audit the accessibility of the button","cwd":"'"$PWD"'"}' | node dist/hooks/skill-suggest.js
```

The first two print JSON with probabilities. The third prints the hook's JSON with a `<skill_relevance>` block, and appends a line to `~/.local/state/jev-agent-tools/suggestions.jsonl`.
