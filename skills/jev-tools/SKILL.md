---
name: jev-tools
description: Use the `jev` command whenever a task means judging many items at once instead of reading them all - ranking or filtering more than about 20 files, grep hits, vault notes, review findings or options against a question; finding which lines of a long document answer a question; triaging a list before reading it; or checking a batch of yes/no conditions. Not for arithmetic, dates, counting, anything readable in one pass, or writing product code that calls TypeSafe (use the typesafe skill for that).
---

# Jev tools

Jev is a fast, cheap judgment model: about 100 ms per request, fractions of a cent, calibrated probabilities, no text generation. The `jev` command hands it bulk judgment from the shell, so candidate text never has to pass through your context: pipe grep output or point it at files and read only the ranked result.

`jev` is on PATH via `~/.local/bin/jev`. If not, run `node ~/.claude/skills/jev/dist/cli.js`. `jev --help` prints usage.

## When to reach for it

- A list longer than you want to read and one question to ask of every item.
- "Which of these" or "does any of these" over candidates you can enumerate with a glob or grep.
- A probability per item so you can threshold in code, not a paragraph of reasoning.

Do not use it for arithmetic, date comparison, counting, multi-hop inference, or anything a single Read answers. Filter with grep or globs first; send only what the question needs. Unrelated context lowers accuracy.

## `jev rank`

```bash
jev rank --query "where is the contrast ratio computed" --files 'src/**/*.ts' --chars 400 --top 5
grep -rn "contrast" src | jev rank --query "the actual WCAG computation" --lines --top 5
jev rank --query "..." < candidates.json        # [{"id":"...","text":"..."}]
```

- `--files GLOB` (repeatable): each file is a candidate, id = path, text = first `--chars` characters (default 400).
- `--lines`: each stdin line is a candidate; a leading `path:line:` becomes the id, so `grep -n` output works unchanged.
- `--mode window` (default): one request over all ids, up to 255; more falls back to `rerank`. `--mode rerank`: one yes/no per candidate, better isolation, more requests.

Output JSON: `exists` (probability any candidate satisfies the query), `verdict` (`present`, `partial`, `absent`), `ranked` (ids with probabilities, best first), `requests`, `inputTokens`.

Read `verdict` before `ranked`. A Choice always produces a top item even when nothing fits.

## `jev ask`

Raw System One request on stdin: `state` (string, object or array) and `questions` (map of `noul`, `choice`, `score`). Use when `rank` does not fit: several independent checks over one state, a score on a described scale, a choice among named options. Independent questions in one call run in parallel.

```bash
jev ask <<'JSON'
{ "state": { "diff": "..." },
  "questions": {
    "breaking": { "type": "noul",   "instructions": "Is this a breaking change?", "criteria": { "true": "...", "false": "..." } },
    "area":     { "type": "choice", "instructions": "Which area?", "criteria": { "auth": "...", "billing": "...", "other": null } },
    "severity": { "type": "score",  "instructions": "How severe?", "criteria": ["none", "minor", "major", "critical"] }
  } }
JSON
```

Read probabilities, not just the winner. A noul near 0.5 means genuinely uncertain, not medium.

## Designing questions for `jev ask`

The `typesafe` skill, when installed, is the maintained guide to writing state and questions; prefer it. Without it, read the live docs rather than guessing: the index at https://docs.typesafe.ai/llms.txt lists every page, and any page serves Markdown when `.md` is appended to its path.

- Primitives: [noul](https://docs.typesafe.ai/primitives/noul.md), [choice](https://docs.typesafe.ai/primitives/choice.md), [score](https://docs.typesafe.ai/primitives/score.md); [state](https://docs.typesafe.ai/concepts/state.md) for shaping the input.
- Cookbooks: the [index](https://docs.typesafe.ai/cookbooks) has worked recipes. This command implements [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md), [line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find.md) and [re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md); its reviewed question text is in `docs/questions-and-thresholds.md` next to this skill's repo.

This is for questions you pass to the command. Building an application that calls TypeSafe is a different task; use the `typesafe` skill for that.

## Exit codes

0 ok, 1 runtime failure (network, missing key: set `TYPESAFE_API_KEY` or write `~/.config/typesafe/api_key`), 2 usage error with usage on stderr.
