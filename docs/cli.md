# `jev` command reference

| Command | Use it for | The agent supplies |
|---|---|---|
| `jev rank` | the best few of many items for one question | a query and the items |
| `jev check` | yes/no answers to several conditions about one subject | the subject and each condition as a sentence |
| `jev classify` | a label from a few categories for each of many items | label names, optional descriptions, the items |
| `jev ask` | anything else: raw System One requests | the whole request |

The first three hold their question wording, criteria and thresholds in `src/questions.ts`, so the agent never writes a question. `ask` is the escape hatch, with warnings for likely mistakes (below).

`jev` is installed by `npm run link` as `~/.local/bin/jev` pointing at `dist/cli.js`. Without the link, `node <repo>/dist/cli.js` is equivalent. `jev --help` prints the usage text; `jev --version` prints the version.

Output is always JSON on stdout. Diagnostics go to stderr.

| Exit code | Meaning |
|---|---|
| 0 | Success; JSON on stdout |
| 1 | Runtime failure: network, API error, missing key. Message on stderr, nothing on stdout |
| 2 | Usage error: bad flag, a flag or argument the command does not take, missing `--query`, conditions or options, empty or invalid stdin, more candidates than `--max`. Message plus usage on stderr, no request sent |

## `jev rank`

Rank candidates against a query.

```
jev rank --query "..." [--mode window|rerank] [--top N] [--max N] [--lines | --files GLOB... [--chars N]]
```

| Flag | Meaning |
|---|---|
| `--query TEXT` | Required. What the candidates are judged against. Write it as the question you would ask a colleague. |
| `--mode window` | Default. One request with every candidate id as a Choice option plus an `exists` Noul. Up to 255 candidates; more falls back to `rerank`. |
| `--mode rerank` | One Noul per candidate, 12 concurrent. Better isolation, more requests. Use when ordering matters and candidates could distract one another. |
| `--top N` | Return only the best N of `ranked`. `exists` and `verdict` still consider every candidate. |
| `--max N` | Refuse more than N candidates; default 1,000 (`MAX_CANDIDATES`). Above 255 every candidate is its own request, so this stops a mistaken glob from sending thousands. |
| `--files GLOB` | Repeatable. Each matched file is a candidate: id is the path relative to the working directory, text is its first `--chars` characters. Globs use Node's `fs.glob`; quote them so the shell does not expand them. `node_modules` and `.git` are skipped unless the pattern names them, and so are empty files and binary files (a NUL byte in the excerpt). |
| `--chars N` | With `--files` only, characters of each file to send. Default 400. |
| `--lines` | Read candidates from stdin, one per line. Blank lines are skipped. Cannot be combined with `--files`. |
| `--text-field F`, `--id-field F` | JSON input only: take each item's text from field `F` instead of `text`, and its id from another field instead of `id` (numbers are accepted as ids). Any JSON array of objects then works without reshaping. |

### Candidate input modes

**Files.** Reads the files itself; the agent never sees their contents.

```bash
jev rank --query "where is the WCAG contrast ratio computed" --files 'src/**/*.ts' --chars 400 --top 5
```

**Lines.** Each non-blank stdin line is a candidate. A leading `path:line:` prefix (`grep -rn`, paths may contain spaces) or `line:` prefix (`grep -n` on one file) becomes the id and is stripped from the text, so grep output works unchanged; a prefixed line with no text after it is skipped. Lines without a prefix get their 1-based stdin line number as id.

```bash
grep -rn "contrast" src | jev rank --query "the actual computation, not a call site" --lines --top 5
```

**JSON.** Default when neither `--files` nor `--lines` is given. Either an array or an object with a `candidates` array. Each candidate needs a non-empty string `id` and a string `text`. Duplicate ids are rejected.

```bash
jev rank --query "which note covers colour generation" <<'JSON'
[{"id":"a","text":"..."},{"id":"b","text":"..."}]
JSON
```

### Output

```json
{
  "mode": "window",
  "exists": 0.67,
  "verdict": "partial",
  "ranked": [{ "id": "Projects/Design Suite/Design System Color Generation.md", "p": 0.98 }, { "id": "...", "p": 0.01 }],
  "requests": 1,
  "inputTokens": 4389
}
```

| Field | Meaning |
|---|---|
| `mode` | The mode actually used. `window` becomes `rerank` above 255 candidates. |
| `exists` | Probability that at least one candidate genuinely satisfies the query. In window mode it is the `exists` Noul; in rerank mode it is the highest per-candidate probability. |
| `verdict` | `present` when `exists >= 0.70`, `partial` when `>= 0.35`, otherwise `absent`. Thresholds live in `src/questions.ts`. |
| `ranked` | Ids with probabilities, best first. In window mode the probabilities are one distribution summing to 1; in rerank mode each is an independent yes/no probability. |
| `requests` | API requests made. |
| `inputTokens` | Input tokens billed across those requests. Output tokens are free. |

Read `verdict` before `ranked`. In window mode the Choice always produces a top item, even when nothing fits.

### Recipes

```bash
# Which of these review findings are worth verifying first
jq -r '.[] | "\(.file):\(.line): \(.summary)"' findings.json | jev rank --query "likely a real correctness bug, not style" --lines --top 5

# Triage a directory of notes before reading any
jev rank --query "bears on the token pipeline decision" --files 'Projects/**/*.md' --chars 300 --top 5

# Semantic find in one long file: rank its lines (ids are the file's line numbers; blank lines drop out)
grep -n "" long-file.md | jev rank --query "where the migration order is specified" --lines --top 3
# Above 255 non-blank lines that is one request per line; narrow first when the file is long
grep -n -i "migrat" long-file.md | jev rank --query "where the migration order is specified" --lines --top 3

# Careful ordering of a shortlist you already narrowed
jev rank --query "..." --mode rerank < shortlist.json
```

## `jev check`

Check several yes/no conditions against one subject in one request.

```
jev check "condition" ["condition"...] [--json] < subject
```

| Input | Meaning |
|---|---|
| positional arguments | One or more conditions, each a quoted sentence stating what would be true: "adds a public export", not "Does it add a public export?". |
| stdin | The subject. Text by default; with `--json`, parsed as JSON and sent as structured state. |

```bash
git diff | jev check "adds or changes a public export" "changes behaviour without a test" "touches authentication"
jev check --json "the customer is asking for a refund" "the customer is angry" < ticket.json
```

Each condition becomes a Noul over state `{ subject }`, with instructions ``{ question: "Does `subject` show that this condition holds?", condition }`` and criteria for both outcomes (`docs/questions-and-thresholds.md`). "Not shown" counts as false. All conditions go in one request, judged independently.

```json
{ "checks": [{ "condition": "adds or changes a public export", "p": 0.98, "verdict": "true" }], "requests": 1, "inputTokens": 684 }
```

`verdict` is `true` when `p >= 0.70`, `false` when `p <= 0.30`, otherwise `unsure`. State over 60,000 characters draws a warning on stderr.

## `jev classify`

Label each of many items with one of a few named options.

```
jev classify --options a,b,c [--option 'name=description'...] [--query "..."] [--max N] [--lines | --files GLOB... [--chars N]]
```

| Flag | Meaning |
|---|---|
| `--options a,b,c` | Labels without descriptions. Repeatable, and combinable with `--option`. |
| `--option 'name=description'` | One label with a description, for labels that need defining. A bare `name` is allowed. At least two labels in total. |
| `--query TEXT` | What the labels answer, when they do not say it themselves ("what kind of issue report is this"). |
| `--lines`, `--files`, `--chars`, `--max`, `--text-field`, `--id-field`, JSON stdin | As for `rank`. |

A `none` label is added unless one named `none` is given, so an item that fits nothing is labelled `none` rather than forced into a category. Each item is its own request, as in rerank mode, so items cannot sway one another.

```bash
grep -rn "TODO" src | jev classify --lines --options bug,refactor,docs,feature
jev classify --files 'notes/*.md' --option 'decision=records a choice made' --option 'meeting=notes from a meeting'
jev classify --text-field summary --options minor,major,critical < incidents.json     # [{"id":"INC-1","summary":"..."}]
```

```json
{ "items": [{ "id": "src/a.ts:10", "label": "bug", "p": 0.98 }, { "id": "src/c.ts:22", "label": "none", "p": 0.53 }],
  "counts": { "bug": 1, "refactor": 0, "docs": 0, "feature": 0, "none": 1 }, "requests": 2, "inputTokens": 830 }
```

`items` keeps input order. `p` is the chosen label's probability; a low `p` means the item sits between labels. `counts` lists every label, including `none`.

## `jev ask`

Send a raw System One request. The request is JSON on stdin with `state` and `questions`. `ask` takes no flags. Prefer `check` or `classify` when one fits.

```bash
jev ask <<'JSON'
{
  "state": { "diff": "renamed exported function getUser to fetchUser in public index.ts" },
  "questions": {
    "breaking": { "type": "noul",   "instructions": "Is this a breaking change for package consumers?",
                  "criteria": { "true": "Consumers importing the old name break.", "false": "Internal only or aliased." } },
    "area":     { "type": "choice", "instructions": "Which area does this touch?",
                  "criteria": { "public-api": "exported surface", "internal": "no export change", "docs": null } },
    "severity": { "type": "score",  "instructions": "How disruptive is this to consumers?",
                  "criteria": ["none", "minor", "major"] }
  }
}
JSON
```

### Question types

| Type | Answer | Notes |
|---|---|---|
| `noul` | `{ "noul": 0.93 }` probability of yes | Optional `criteria: { true, false }` describe the two outcomes. No separate confidence. Near 0.5 means genuinely uncertain, not medium. |
| `choice` | `{ "choice": "public-api", "confidence": 0.8, "probabilities": {...} }` | `criteria` maps each option to a description or `null`. Probabilities sum to 1, so include a no-match option when nothing may fit. |
| `score` | `{ "score": 1.72, "confidence": 0.59, "legend": {...}, "probabilities": {...} }` | `criteria` is an ordered list of 2 to 10 level descriptions, lowest first. `score` is the probability-weighted level and can fall between levels. |

`state` may be a string, an object or an array. Refer to nested fields in instructions with backticked paths such as `` `diff` `` or `` `ticket.messages[0].text` ``. Independent questions in one request run in parallel and cannot see one another's answers.

### Output

```json
{ "model": "jev-1.13.0", "answers": { "breaking": { "type": "noul", "noul": 0.93 } }, "usage": { "input_tokens": 295, "output_tokens": 20 } }
```

### Warnings

The schemas reject malformed requests (exit 2). A well-formed request can still ask the wrong thing, and Jev answers it anyway with a confident-looking probability. `jev ask` warns on stderr, without blocking the request, about:

| Warning | Why it matters |
|---|---|
| instructions mention `` `name` ``, which is not a field of state | Backticks point Jev at a state field; a typo or stale name points it at nothing. Checked only when state is an object. A backticked literal such as a function name also triggers it. |
| noul has no criteria | Without descriptions of true and false, the boundary is left to Jev. |
| choice has no none or other option | A Choice always picks one; without an escape option, "nothing fits" comes back as some option. Recognised names: `none`, `other`, `neither`, `unknown`, `n/a`, `no match`, `none of the above`, `not applicable`. |
| state is N characters | Over 60,000 characters (`STATE_WARN_CHARS`); accuracy drops with unrelated context. |

Each line reads `jev: warning: <question id>: <message>`. stdout stays clean JSON. The MCP tool returns the same list as `warnings` in its result.

## Limits worth knowing

- 64k tokens per request across state and all questions; 32k for state plus the longest question.
- 255 options per Choice, which is why window mode stops at 255 candidates.
- 1,200 requests per minute. Rerank mode's concurrency of 12 stays well inside that, and `--max` bounds the total.
- Text only. Jev is documented as weak at arithmetic, counting, date comparison, multi-hop inference and adversarial framing. Keep those in code.
