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

The hook costs under a tenth of a cent per prompt. The suggestions were the expected skill in the two cases where one applied, and none in the knowledge-question case.

## What has not been measured

- Precision and recall of the hook over a labelled set of real prompts. The cookbook's numbers were measured on its own 488-request set against Claude Haiku, not here.
- Ranking quality of `jev rank` beyond a handful of spot checks.
- The hook inside a live Codex session. Offline, with Codex's stdin shape, it ranks the Codex roster and suggests a Codex-invocable skill (`docs/cross-agent.md`).

## Tuning the hook from the log

The log is `suggestions.jsonl` in the data directory (`~/.local/state/jev-agent-tools/` unless `CLAUDE_PLUGIN_DATA` names this plugin). After a week of ordinary use:

```bash
# suggestions by skill, per agent
jq -r '[.agent // "claude", .skill // "none"] | @tsv' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort | uniq -c | sort -rn

# suggestions by skill
jq -r '.skill // "none"' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort | uniq -c | sort -rn

# gate and fit distributions
jq -r '[.gate, .fit // "-", .skill // "none"] | @tsv' ~/.local/state/jev-agent-tools/suggestions.jsonl

# latency
jq '.latency_ms' ~/.local/state/jev-agent-tools/suggestions.jsonl | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR/2)], "p90", a[int(NR*0.9)]}'
```

Read the rows where the suggestion was wrong or missing, then:

| Symptom | Adjust |
|---|---|
| Suggestions on prompts that needed no skill | raise `SUGGEST_FIT`, or raise `SUGGEST_GATE` if the gate was the weak signal |
| Obvious skills missed with the gate closed | lower `SUGGEST_GATE` |
| Right skill in the shortlist but not chosen | check the skill's description; the shortlist Choice reads the full description plus 600 body characters, and a vague description loses to a specific one |
| Right skill never in the shortlist | its truncated description does not say what it does; fix the SKILL.md frontmatter, or raise `SUGGEST_WIDE_DESCRIPTION_CHARS` |

Change constants in `src/questions.ts`, run `npm run check`, and note the change and evidence in `docs/decisions.md`.

## Evaluating `jev rank`

Build a small labelled set: a query, a candidate list and the id that should win. Run both modes and compare the winner and the `verdict` against the label. The rerank cookbook reports top-1 accuracy rising from 5% to 18% and top-10 from 38% to 62% on a legal retrieval benchmark; treat that as a reference point, not an expectation for other domains.

When a ranking looks wrong, inspect the exact state that was sent: too much unrelated text per candidate is the most common cause, and `--chars` is the first thing to reduce.
