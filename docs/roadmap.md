# Roadmap

Ordered by value. None of these is started.

1. **Codex roster sources.** Add `~/.codex/skills`, user-level `~/.agents/skills` and the Codex plugin cache to `src/roster.ts` so the hook is correct under Codex. Then verify the hook end to end in Codex. Closes the one known cross-agent gap; see `docs/cross-agent.md`.
2. **Threshold tuning from real data.** After a week of use, follow `docs/evaluation-and-tuning.md` and record the outcome in `docs/decisions.md`.
3. **`PreToolUse` on Bash: risk scoring.** A Noul for "modifies files outside the project, rewrites git history or writes to the network" plus a severity Score, escalating to a permission prompt with a reason. Code rules stay the primary gate; Jev only escalates. Needs a small evaluation set first, because Jev is documented as weak against adversarial framing and a command can be phrased to look benign.
4. **`Stop` hook: knowledge classification.** Ask whether the task produced durable knowledge worth recording, and block once with a reminder. Guard with `stop_hook_active`.
5. **`PostToolUse` on subagent results.** Rank a subagent's findings before they enter the main context.
6. **Two-pass window selection** for thousands of candidates, only if a real workload shows rerank too slow or costly.
7. **Marketplace packaging.** The repo already has the plugin layout; publishing needs a marketplace manifest and a release process. Not needed while it is one machine.
