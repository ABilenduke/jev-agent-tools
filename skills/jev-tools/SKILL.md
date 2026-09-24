---
name: jev-tools
description: Use the `jev` command whenever a task means judging many items at once instead of reading them all - ranking or filtering more than about 20 files, grep hits, vault notes, review findings or options against a question; finding which lines of a long document answer a question; triaging a list before reading it; labelling many items into a few categories; or checking a batch of yes/no conditions against a diff, file or text. Also whenever the user asks to use jev. Not for arithmetic, dates, counting, a handful of items you can just read, or writing product code that calls TypeSafe (use the typesafe skill for that).
---

# Jev tools

Jev is a fast, cheap judgment model: about 100 ms per request, fractions of a cent, calibrated probabilities, no text generation. The `jev` command hands it bulk judgment from the shell, so candidate text never has to pass through your context: pipe grep output or point it at files and read only the result.

`jev` is on PATH via `~/.local/bin/jev`. If not, run `node ~/.claude/skills/jev/dist/cli.js`. `jev --help` prints usage.

## Pick the command

| You want | Command | You write |
|---|---|---|
| The best few of many items for one question | `jev rank` | a query |
| Yes/no answers to several conditions about one thing | `jev check` | each condition as a sentence |
| One answer per item for many items: a category, a level on a scale (`minor`/`major`/`critical`), or a yes/no | `jev classify` | the labels, with a description each when they need defining |
| Several different questions about one thing, including a numeric score | `jev ask` | the whole request |

`rank`, `check` and `classify` hold their question wording, criteria and thresholds in reviewed code, so you supply only data. Prefer them. If you find yourself about to run `jev ask` once per item in a loop, stop: that is `classify`, in one command, with the levels or yes/no as its labels.

## When it is worth it

Use `jev` when the user asks for it, or when there are more items than you would want to read one by one (roughly 20 or more), or when the input is long enough that reading it costs real context. For a handful of short items nobody asked to run through `jev`, just read them.

Once you have used it, trust the result the way you would trust a careful colleague's: do not re-read every item to confirm it. Read the ones `jev` was unsure about (`verdict` `unsure`, or a `p` below about 0.8), and the few you are about to act on or report as the headline. That is where the effort pays.

Do not use `jev` for arithmetic, date comparison, counting or multi-hop inference; Jev is weak at those. Filter with grep or globs first; send only what the question needs. Unrelated context lowers accuracy.

## `jev rank`

```bash
jev rank --query "where is the contrast ratio computed" --files 'src/**/*.ts' --chars 400 --top 5
grep -rn "contrast" src | jev rank --query "the actual WCAG computation" --lines --top 5
jev rank --query "..." < candidates.json        # [{"id":"...","text":"..."}]
```

- `--files GLOB` (repeatable): each file is a candidate, id = path, text = first `--chars` characters (default 400). Skips `node_modules`, `.git`, empty and binary files.
- `--lines`: each stdin line is a candidate; a leading `path:line:` or `line:` becomes the id, so `grep -n` and `grep -rn` output works unchanged.
- `--mode window` (default): one request over all ids, up to 255; more falls back to `rerank`. `--mode rerank`: one yes/no per candidate, better isolation, more requests.
- `--max N`: more than 1,000 candidates is refused by default. Narrow the glob or grep before raising it.
- `--text-field F` (and `--id-field F`): for JSON input whose items keep their text somewhere other than `text`.

Output: `exists` (probability any candidate satisfies the query), `verdict` (`present`, `partial`, `absent`), `ranked` (ids with probabilities, best first). Read `verdict` before `ranked`: the top item exists even when nothing fits.

## `jev check`

```bash
git diff | jev check "adds or changes a public export" "changes behaviour without a test" "touches authentication"
jev check --json "the customer is asking for a refund" < ticket.json
```

The subject is stdin: text, or JSON with `--json`. Each condition is a quoted sentence stating what would be true; write "adds a public export", not "Does it add a public export?". One request covers all conditions, and each is judged independently.

Output: `checks`, one per condition in order, each with `p` and a `verdict` of `true` (p >= 0.7), `false` (p <= 0.3) or `unsure`. False includes "the subject does not show it". Treat `unsure` as a reason to look, not as half-true.

`check` says whether, not where. To point someone at the lines behind a `true` in a long input, rank them: `grep -n "" pr.diff | jev rank --lines --query "<the condition>" --top 3`.

## `jev classify`

```bash
grep -rn "TODO" src | jev classify --lines --options bug,refactor,docs,feature
jev classify --files 'notes/*.md' --option 'decision=records a choice made' --option 'meeting=notes from a meeting' --option 'reference=how-to or facts'
jev classify --lines --options bug,feature-request,question --query "what kind of issue report is this" < issues.txt
```

- `--options a,b,c` for self-explanatory labels; `--option 'name=description'` (repeatable) when a label needs defining. Give at least two.
- `--query` names the axis when the labels alone do not.
- Input as for `rank` (`--lines`, `--files`, JSON on stdin); one request per item, so items cannot sway one another; `--max` applies.
- JSON items need an `id` and a `text`. For any other array of objects, name the fields with `--text-field summary` (and `--id-field key` if the id is not in `id`) instead of reshaping the file.

A level on a scale is a classification: give each level as an option and put the rubric in its description. A yes/no per item is too: two options whose descriptions say exactly what counts, including the near-misses. Run one `classify` per question; two questions about the same items is two commands, not a loop.

```bash
# incidents.json: [{"id":"INC-1","summary":"..."}]; --text-field names the field to judge
jev classify --text-field summary --query "how severe is this incident" --option 'no-impact=no customer impact' --option 'minor=brief or cosmetic, few customers' --option 'major=significant customer impact, or data lost for some customers' --option 'critical=outage for all customers, a security breach, or data lost at scale' < incidents.json
jev classify --text-field summary --query "was customer data lost" --option 'lost=deleted, overwritten or unrecoverable' --option 'not-lost=intact, recovered, or only exposed or delayed' < incidents.json
```

The descriptions are the rubric, and Jev applies them literally: write them for your case rather than copying these.

**The `none` label.** `classify` adds a label named `none`, meaning "fits none of the options", so an item that fits nothing is not forced into a category. If you name one of your own labels `none`, yours replaces it and takes your description, and the "fits nothing" escape is gone. So do not call a real category `none`; for the bottom of a severity scale write `no-impact`. A catch-all of your own with a different meaning, such as `not-a-code-task`, sits alongside `none` without conflict.

Output: `items` (id, label, p, in input order) and `counts` per label. A low `p` means the item sits between labels.

## `jev ask`

A raw System One request on stdin: `state` (string, object or array) and `questions` (map of `noul`, `choice`, `score`). Independent questions in one call run in parallel and cannot see each other. It is one request about one state; for the same questions over many items, use `classify` per question instead of looping `ask`.

```bash
jev ask <<'JSON'
{ "state": { "diff": "..." },
  "questions": {
    "breaking": { "type": "noul",   "instructions": "Is `diff` a breaking change for package consumers?",
                  "criteria": { "true": "Consumers importing the old surface break.", "false": "Internal only, or aliased." } },
    "area":     { "type": "choice", "instructions": "Which area does `diff` touch?",
                  "criteria": { "auth": "login, sessions, tokens", "billing": "charges, invoices", "other": null } },
    "severity": { "type": "score",  "instructions": "How disruptive is `diff` to consumers?",
                  "criteria": ["none", "minor", "major", "critical"] }
  } }
JSON
```

Rules that matter most:

- Refer to state fields in backticks, exactly as named: `` `diff` ``, `` `ticket.messages[0].text` ``. Backticks mean "this field of state".
- Give every noul `criteria` for both `true` and `false`.
- Give every choice a `none` or `other` option unless something always fits; a Choice always picks one.
- One judgment per question. Split "is it urgent and about billing" into two.
- Score levels go lowest first, 2 to 10 of them, each a description rather than just a number.

`jev ask` warns on stderr about a backticked name that is not in state, a noul without criteria, a choice without an escape option, and oversized state. Fix the request and rerun; the answer to a flawed question still comes back, and still looks confident.

Read probabilities, not just the winner. A noul near 0.5 means genuinely uncertain, not medium.

For more on writing questions, the `typesafe` skill, when installed, is the maintained guide; prefer it. Without it, read the live docs rather than guessing: the index at https://docs.typesafe.ai/llms.txt lists every page, and any page serves Markdown when `.md` is appended to its path. Primitives: [noul](https://docs.typesafe.ai/primitives/noul.md), [choice](https://docs.typesafe.ai/primitives/choice.md), [score](https://docs.typesafe.ai/primitives/score.md); [state](https://docs.typesafe.ai/concepts/state.md). Cookbooks: the [index](https://docs.typesafe.ai/cookbooks). This command implements [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md), [line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find.md) and [re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md); its reviewed question text is in `docs/questions-and-thresholds.md` in this skill's repo.

This is for judgments you make while working. Building an application that calls TypeSafe is a different task; use the `typesafe` skill for that.

## Exit codes

0 ok, 1 runtime failure (network, missing key: set `TYPESAFE_API_KEY` or write `~/.config/typesafe/api_key`), 2 usage error with the reason and usage on stderr; no request was sent.
