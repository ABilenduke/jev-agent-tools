# Development

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # cleans dist-test/, compiles src+test into it and runs node --test
npm run build       # tsc -> dist/ (what the hook, the bin and the MCP server run)
npm run check       # all three
npm run link        # symlink ~/.local/bin/jev -> dist/cli.js
```

No test framework beyond Node's built-in runner. No bundler. TypeScript 7 (native) with `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

## Testing approach

Every module that reaches Jev takes a `Judge` function, so tests inject a fake that answers from a probability table and records requests. Tests assert on the requests sent (which questions, which state) and on the decisions made from the answers, never on the SDK.

Test files, one per module:

| File | Covers |
|---|---|
| `test/client.test.ts` | key resolution order and trimming |
| `test/rank.test.ts` | window and rerank modes, state shape, verdict thresholds, `top`, fallback above 255, validation |
| `test/check.test.ts` | one Noul per condition, state shape, verdict thresholds, validation |
| `test/classify.test.ts` | option specs, one request per item, the added `none`, query in state, counts, validation |
| `test/lint.test.ts` | each `jev ask` warning, and silence on a well-formed request |
| `test/roster.test.ts` | frontmatter parsing including block scalars, `config.toml` scanning, every roster source against a temp fixture tree, plugin naming, numeric version order, dropping undescribed and model-hidden entries |
| `test/suggest.test.ts` | skip rules, the two-pass flow, gate and fit thresholds, chunked wide pass, hook output shape, data-directory trust, `runHook` success, failure and deadline records, and the built hook as a process |
| `test/schemas.test.ts` | zod schemas for ask and rank input |
| `test/cli.test.ts` | argument parsing, per-command flags and conflicts, `check` and `classify` end to end, `ask` warnings, the three candidate input modes, excludes, `--max`, both commands, `--version` against package.json and plugin.json, usage and runtime exit codes |

The code was written test-first: each test was run and seen to fail before its implementation existed. Keep that discipline; a test that passes on first run has not proven it can fail.

Live checks are manual and cheap: `docs/install.md` lists three one-liners. A run costs a fraction of a cent.

## Adding a question

1. Add the constant or builder to `src/questions.ts` with a doc comment saying what the number means.
2. Add or extend a test that asserts the question is sent and the threshold is applied.
3. Update `docs/questions-and-thresholds.md`.
4. If it changes behaviour a user would notice, add a dated entry to `docs/decisions.md`.

## Adding a command

Start from `check.ts` or `classify.ts`. Put the question builder and any threshold in `src/questions.ts`, and the logic in its own module taking a `Judge`. Wire the command in `cli-core.ts`, adding its accepted flags to `ACCEPTS`. Add a zod schema and an MCP tool if shell-less agents should have it. Then update `docs/cli.md`, `docs/questions-and-thresholds.md`, the skill's "Pick the command" table and `docs/decisions.md`. The aim is that the agent supplies data and short labels, never question text.

## Adding a roster source

Add an enumerator in `src/roster.ts`, extend the fixture tree in `test/roster.test.ts` with the new layout and the expected namespaced name, and update the table in `docs/hook-skill-suggestion.md`.

## Conventions

- Never write a credential, never log a prompt. The log stores a prompt hash.
- The hook must never exit non-zero or print to stdout on failure. Keep its logic in `runHook`, where tests reach it; `main()` does only I/O.
- A version bump touches `package.json`, `.claude-plugin/plugin.json` and `src/version.ts`; a test fails if they disagree.
- The command prints JSON only on stdout; everything else goes to stderr.
- Keep state minimal in every request. If a question needs more context, add a named field, not surrounding text.
- `dist/` and `dist-test/` are ignored; build before relying on the command or the hook.
