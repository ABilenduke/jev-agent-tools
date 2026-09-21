# Development

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # compiles src+test to dist-test/ and runs node --test
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
| `test/roster.test.ts` | frontmatter parsing, every roster source against a temp fixture tree, namespacing, dropping undescribed entries |
| `test/suggest.test.ts` | skip rules, the two-pass flow, gate and fit thresholds, hook output shape, data-directory trust |
| `test/schemas.test.ts` | zod schemas for ask and rank input |
| `test/cli.test.ts` | argument parsing, the three candidate input modes, both commands, usage and runtime exit codes |

The code was written test-first: each test was run and seen to fail before its implementation existed. Keep that discipline; a test that passes on first run has not proven it can fail.

Live checks are manual and cheap: `docs/install.md` lists three one-liners. A run costs a fraction of a cent.

## Adding a question

1. Add the constant or builder to `src/questions.ts` with a doc comment saying what the number means.
2. Add or extend a test that asserts the question is sent and the threshold is applied.
3. Update `docs/questions-and-thresholds.md`.
4. If it changes behaviour a user would notice, add a dated entry to `docs/decisions.md`.

## Adding a roster source

Add an enumerator in `src/roster.ts`, extend the fixture tree in `test/roster.test.ts` with the new layout and the expected namespaced name, and update the table in `docs/hook-skill-suggestion.md`.

## Conventions

- Never write a credential, never log a prompt. The log stores a prompt hash.
- The hook must never exit non-zero or print to stdout on failure.
- The command prints JSON only on stdout; everything else goes to stderr.
- Keep state minimal in every request. If a question needs more context, add a named field, not surrounding text.
- `dist/` and `dist-test/` are ignored; build before relying on the command or the hook.
