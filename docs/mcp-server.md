# Optional MCP server

`dist/mcp.js` is a stdio MCP server exposing the same two operations as the command. It is **not registered by default**: the plugin ships no `.mcp.json`, and `claude plugin details` shows zero MCP servers. It exists for agents that cannot run a shell.

## Why it is opt-in

With an MCP tool, every candidate's text must be emitted by the model as tool-call arguments. Ranking 200 files means the model reads them into context and types them back out, which is exactly the work the tool was supposed to save. The command reads files and pipes itself. See `docs/why-a-cli.md` for the arithmetic and `docs/decisions.md`, decision 2.

## Registering it

```bash
claude mcp add jev -- node ~/code/abilenduke/jev-agent-tools/dist/mcp.js
codex  mcp add jev -- node ~/code/abilenduke/jev-agent-tools/dist/mcp.js
```

Or by hand in a `.mcp.json` / `config.toml` stdio entry with `command: node` and `args: [<path>/dist/mcp.js]`. The key is resolved as for the command; if the client strips the environment, the key file is what works.

## Tools

**`jev_rank`** — input `{ query, candidates: [{id, text}], mode?: "window"|"rerank", top?: number }`, output as `jev rank`. Returns `isError` with a message on validation or runtime failure.

**`jev_ask`** — input `{ state, questions }`, output `{ model, answers, usage }` as `jev ask`.

Both are annotated read-only and open-world. Input schemas are the zod schemas in `src/schemas.ts`, shared with the command, so the two interfaces cannot drift.

## Verifying

A client script using `@modelcontextprotocol/sdk`'s `StdioClientTransport` can list tools and call `jev_rank`. Pass `env: { ...process.env }` to the transport or rely on the key file; the SDK's default spawns the server with a minimal environment, which is how the key-file fallback was first found to be necessary.
