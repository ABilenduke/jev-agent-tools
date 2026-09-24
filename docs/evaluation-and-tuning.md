# Evaluation and tuning

## What has been measured

First-day measurements on Node 24 under WSL, 2026-09-20. Prices at $0.042 per million input tokens; output tokens are free.

| Path | Requests | Input tokens | Wall time |
|---|---|---|---|
| Hook, 86-entry roster, "audit the accessibility of the primary button component" | 2 | 7.5k | 0.98 s including Node startup |
| Hook, same roster, "what is our PTO policy for contractors?" | 2 | 7.1k | 0.91 s |
| Hook, "explain the difference between a noul and a score in typesafe" | 1 (gate closed) | ~5k | – |
| `jev rank --files 'Projects/**/*.md' --chars 300`, 30 vault notes | 1 | 4.4k | 0.73 s including Node startup |
| `grep -rn contrast src \| jev rank --lines`, 40 lines | 1 | 1.0k | ~0.5 s |
| `jev ask`, one noul over a one-line diff | 1 | 295 | ~0.4 s |
| Hook as Codex, 132-entry roster, the accessibility prompt | 2 | 10.0k | 0.99 s |
| Hook with unknown agent, 183-entry union roster, same prompt | 2 | 13.0k | 1.06 s |
| `jev check`, 5 conditions over a 4-line diff (2026-09-24) | 1 | 684 | – |
| `jev classify --lines`, 5 TODO comments, 4 labels plus `none` (2026-09-24) | 5 | 2.1k | – |

The hook costs under a tenth of a cent per prompt. The suggestions were the expected skill in the two cases where one applied, and none in the knowledge-question case.

## What has not been measured

- Precision and recall of the hook over a labelled set of real prompts. The cookbook's numbers were measured on its own 488-request set against Claude Haiku, not here.
- Ranking quality of `jev rank` beyond a handful of spot checks.
- `jev check` and `jev classify` beyond their first live runs (decision 18). All five `check` verdicts and all eight `classify` labels were as expected; that is a smoke test, not an accuracy figure. The `CHECK_TRUE`/`CHECK_FALSE` thresholds are this project's choice, not a cookbook's.
- The hook inside a live Codex session. Offline, with Codex's stdin shape, it ranks the Codex roster and suggests a Codex-invocable skill (`docs/cross-agent.md`).

## Skill evaluation, 2026-09-24

The `jev-tools` skill was tested with the skill-creator workflow: each task was run by one subagent given the skill and one given an earlier version, with a logging wrapper around `jev` and answers graded by script against known ground truth. The tasks were a five-item merge checklist over a 91-line diff, 48 TODO/FIXME comments to triage, and 24 incident reports to rate for severity and data loss. There was one run per version per task, so the differences are directional.

| Round | Skill | Checks passed | Mean time | Notes |
|---|---|---|---|---|
| 1 | original (rank and ask only) | 75% | 54 s | Right answers, but hand-written `ask`, a severity level named `none`, failed calls |
| 1 | with `check`/`classify` | 94% | 67 s | Right answers; the incidents task looped `ask` 24 times (101 s) |
| 2 | previous round's version | 89% | 63 s | Missed a critical incident; used `none` as a level again |
| 2 | revised | 100% | 54 s | Two `classify` calls for the incidents (66 s); read 12 of 24 items to verify |

The findings that changed the skill: the "Pick the command" table sent per-item scores to `ask`; "not for anything readable in one pass" contradicted the labelling use cases, and every agent re-read every input; and a label named `none` silently replaces `classify`'s escape option. Round 2 also led to `--text-field`, because every agent had to reshape JSON by hand. Agents given the original skill found `check` and `classify` through `jev --help`, which is why that version scored as well as it did.

## Cookbook conformance review, 2026-09-20

The questions and constants in `src/questions.ts` were checked against the three cookbooks they cite (skill suggestion, line-by-line search, re-ranking) and the state, Noul and Choice guidance pages, read verbatim from docs.typesafe.ai. Jev itself judged the question comparisons through `jev ask`.

Constants: gate 0.30, fit 0.30, shortlist 3, window 255, present 0.70, absent 0.35 and concurrency 12 all match. The shortlist body excerpt was 600 against the cookbook's 700 and is now 700 (decision 13).

Question equivalence, as Jev probabilities that the project's question asks the same judgment as the cookbook's, over the two verbatim texts:

| Question | Same judgment |
|---|---|
| `acts_on_user_system` | 0.96 |
| `prose_suffices` | 0.96 |
| `would_follow_documented_procedure` | 0.95 |
| shortlist `which` | 0.88 |
| rerank `matches` versus the re-ranking cookbook's Noul | 0.88 |
| `fits` | 0.71 |
| wide `which` (the project drops "if any"; 0.41 that this matters given the gate) | 0.68 |
| `exists` versus the line-search presence Noul | 0.52 |
| `best` versus "which line contains the answer" | 0.43 |

The two `jev rank` questions are a deliberate generalisation and are documented as such in `docs/questions-and-thresholds.md`.

Method note: Jev was poor at the design-level questions ("does this question obey the Noul rules"): a Score over the whole set came back flat with zero confidence. Pairwise "do these two texts ask the same judgment" questions were decisive. Use Jev for comparisons over evidence, not for reviewing question design.

## Tuning the hook from the log

The log is `suggestions.jsonl` in the data directory: `~/.local/state/jev-agent-tools/`, unless `CLAUDE_PLUGIN_DATA` names this plugin. Under Claude Code that is `~/.claude/plugins/data/jev-skills-dir/`, so substitute that path below. Lines with an `error` field are failed runs; filter them out of the suggestion statistics (`select(.error | not)`). After a week of ordinary use:

```bash
# suggestions by skill, per agent
jq -r '[.agent // "claude", .skill // "none"] | @tsv' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort | uniq -c | sort -rn

# suggestions by skill
jq -r '.skill // "none"' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort | uniq -c | sort -rn

# gate and fit distributions
jq -r '[.gate, .fit // "-", .skill // "none"] | @tsv' ~/.local/state/jev-agent-tools/suggestions.jsonl

# failures by kind: deadline, MissingApiKeyError, APIConnectionError, ...
jq -r 'select(.error) | .error' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort | uniq -c

# latency of successful runs
jq 'select(.error | not) | .latency_ms' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR/2)], "p90", a[int(NR*0.9)]}'
```

Read the rows where the suggestion was wrong or missing, then:

| Symptom | Adjust |
|---|---|
| Suggestions on prompts that needed no skill | raise `SUGGEST_FIT`, or raise `SUGGEST_GATE` if the gate was the weak signal |
| Obvious skills missed with the gate closed | lower `SUGGEST_GATE` |
| Right skill in the shortlist but not chosen | check the skill's description; the shortlist Choice reads the full description plus 700 body characters, and a vague description loses to a specific one |
| Right skill never in the shortlist | its truncated description does not say what it does; fix the SKILL.md frontmatter, or raise `SUGGEST_WIDE_DESCRIPTION_CHARS` |

Change constants in `src/questions.ts`, run `npm run check`, and note the change and evidence in `docs/decisions.md`.

## Evaluating `jev rank`

Build a small labelled set: a query, a candidate list and the id that should win. Run both modes and compare the winner and the `verdict` against the label. The rerank cookbook reports top-1 accuracy rising from 5% to 18% and top-10 from 38% to 62% on a legal retrieval benchmark; treat that as a reference point, not an expectation for other domains.

When a ranking looks wrong, inspect the exact state that was sent: too much unrelated text per candidate is the most common cause, and `--chars` is the first thing to reduce.
