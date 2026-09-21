# `jev` command reference

`jev` is installed by `npm run link` as `~/.local/bin/jev` pointing at `dist/cli.js`. Without the link, `node <repo>/dist/cli.js` is equivalent. `jev --help` prints the usage text.

Output is always JSON on stdout. Diagnostics go to stderr.

| Exit code | Meaning |
|---|---|
| 0 | Success; JSON on stdout |
| 1 | Runtime failure: network, API error, missing key. Message on stderr, nothing on stdout |
| 2 | Usage error: bad flag, missing `--query`, invalid stdin. Message plus usage on stderr, no request sent |

## `jev rank`

Rank candidates against a query.

```
jev rank --query "..." [--mode window|rerank] [--top N] [--lines | --files GLOB... [--chars N]]
```

| Flag | Meaning |
|---|---|
| `--query TEXT` | Required. What the candidates are judged against. Write it as the question you would ask a colleague. |
| `--mode window` | Default. One request with every candidate id as a Choice option plus an `exists` Noul. Up to 255 candidates; more falls back to `rerank`. |
| `--mode rerank` | One Noul per candidate, 12 concurrent. Better isolation, more requests. Use when ordering matters and candidates could distract one another. |
| `--top N` | Return only the best N of `ranked`. `exists` and `verdict` still consider every candidate. |
| `--files GLOB` | Repeatable. Each matched file is a candidate: id is the path relative to the working directory, text is its first `--chars` characters. Globs use Node's `fs.glob`; quote them so the shell does not expand them. |
| `--chars N` | With `--files`, characters of each file to send. Default 400. |
| `--lines` | Read candidates from stdin, one per line. Blank lines are skipped. |

### Candidate input modes

**Files.** Reads the files itself; the agent never sees their contents.

```bash
jev rank --query "where is the WCAG contrast ratio computed" --files 'src/**/*.ts' --chars 400 --top 5
```

**Lines.** Each non-blank stdin line is a candidate. A leading `path:line:` prefix becomes the id and is stripped from the text, so `grep -n` and `grep -rn` output works unchanged. Lines without that prefix get their 1-based line number as id.

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

# Semantic find in one long file: rank its lines
grep -n "" long-file.md | jev rank --query "where the migration order is specified" --lines --top 3

# Careful ordering of a shortlist you already narrowed
jev rank --query "..." --mode rerank < shortlist.json
```

## `jev ask`

Send a raw System One request. The request is JSON on stdin with `state` and `questions`.

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

## Limits worth knowing

- 64k tokens per request across state and all questions; 32k for state plus the longest question.
- 1,200 requests per minute. Rerank mode's concurrency of 12 stays well inside that.
- Text only. Jev is documented as weak at arithmetic, counting, date comparison, multi-hop inference and adversarial framing. Keep those in code.
