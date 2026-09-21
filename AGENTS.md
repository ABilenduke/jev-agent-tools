# Guidance for agents working in this repository

This is `jev-agent-tools`: a `jev` command, a skill and a prompt hook that give coding agents access to Jev, TypeSafe's System One judgment model. Read `README.md` first, then `docs/architecture.md`.

## Rules

- **Test first.** Every module that reaches Jev takes a `Judge` function; write the test against the fake judge, run it, watch it fail, then implement. `npm run check` must pass before you report done.
- **`src/questions.ts` is the reviewed file.** All question text and every threshold live there. Changing a number is a decision: update `docs/questions-and-thresholds.md` and add a dated entry to `docs/decisions.md`.
- **Never write, copy or log a credential.** The key comes from `TYPESAFE_API_KEY` or `~/.config/typesafe/api_key`; the tool only reads it. Logs store a prompt hash.
- **The hook never blocks.** Any failure exits 0 with no stdout. Keep it that way.
- **Keep state minimal.** Jev's accuracy drops with unrelated context. Filter in code, send named fields.
- **Build before trusting.** `dist/` is what the hook, the bin and the MCP server run. It is not committed.
- **This repo documents itself.** Behaviour, decisions and measurements go in `docs/`, not in any external knowledge base. This is personal tooling and no company repository depends on it.
- **Commit only when asked.**

## Map

| Want to | Read |
|---|---|
| understand the pieces | `docs/architecture.md` |
| use the command | `docs/cli.md` |
| understand why it is a command, not MCP | `docs/why-a-cli.md` |
| understand or tune the hook | `docs/hook-skill-suggestion.md`, `docs/evaluation-and-tuning.md` |
| review what Jev is asked | `docs/questions-and-thresholds.md` |
| install anywhere | `docs/install.md`, `docs/cross-agent.md`, `docs/mcp-server.md` |
| know why it is this way | `docs/decisions.md` |
| add something | `docs/development.md`, `docs/roadmap.md` |
