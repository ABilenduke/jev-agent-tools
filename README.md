# jev-agent-tools

Jev, TypeSafe's System One judgment model, as a runtime primitive for coding agents: a `jev` command any agent with a shell can run, a skill that says when to use it, and a prompt hook that ranks your installed skills against each request.

Jev is not a chat model. One request carries a `state` and typed questions (`noul` yes/no probability, `choice` distribution over named options, `score` weighted position on ordered levels) and returns calibrated probabilities in about 100 ms for $0.042 per million input tokens. Code owns the workflow; Jev supplies judgment where code needs semantic understanding.

## What it ships

| Piece | What it does |
|---|---|
| `jev rank` | Ranks many candidates against one query. Candidates come from `--files GLOB`, from grep output on stdin (`--lines`), or from JSON. Returns `exists`, a `verdict` and ranked ids with probabilities. The candidate text never passes through the agent's context. Refuses more than 1,000 candidates unless `--max` says otherwise. |
| `jev check` | Yes/no answers to several conditions about one subject, such as a diff, file or ticket, in one request. The agent writes each condition as a sentence; the question wording is fixed and reviewed. |
| `jev classify` | Labels each of many items (grep hits, files, JSON) with one of a few named options, plus an automatic `none`. |
| `jev ask` | Raw System One request on stdin for anything the three above do not cover. Warns about likely mistakes in the request. |
| `jev-tools` skill | Tells the agent when to reach for the command and which subcommand fits, and how to write a raw request when none does. |
| `UserPromptSubmit` hook | Two-pass ranking of every installed skill and slash command against the prompt, injecting a `<skill_relevance>` hint. Never blocks: gives up silently after 5 s. Logs each run, and each failure by name, for tuning. |
| MCP server | Optional, for agents without a shell. Not registered by default. See [docs/why-a-cli.md](docs/why-a-cli.md) for why. |

## Quick start

```bash
npm install && npm run check && npm run link
mkdir -p ~/.config/typesafe && printf '%s' 'ts_...' > ~/.config/typesafe/api_key && chmod 600 ~/.config/typesafe/api_key
ln -s "$PWD" ~/.claude/skills/jev        # Claude Code plugin, loads next session as jev@skills-dir

grep -rn "contrast" src | jev rank --query "where the WCAG ratio is actually computed" --lines --top 5
git diff | jev check "adds a public export" "changes behaviour without a test"
grep -rn TODO src | jev classify --lines --options bug,refactor,docs,feature
jev rank --query "bears on the token pipeline" --files 'docs/**/*.md' --chars 300 --top 5
jev --help
```

## Documentation

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Modules, the Judge port, data flow for the command and the hook |
| [docs/cli.md](docs/cli.md) | Full `jev` reference: flags, input modes, output fields, exit codes, recipes |
| [docs/why-a-cli.md](docs/why-a-cli.md) | Why a command and not an MCP server: the token arithmetic of not reading and rewriting every file |
| [docs/hook-skill-suggestion.md](docs/hook-skill-suggestion.md) | How the hook decides, roster sources and naming, logging, failure behaviour |
| [docs/questions-and-thresholds.md](docs/questions-and-thresholds.md) | Every question Jev is asked and every threshold, with meaning |
| [docs/install.md](docs/install.md) | Requirements, credentials and the key file, Claude Code, Codex, verification |
| [docs/cross-agent.md](docs/cross-agent.md) | What is portable to which agents, evidence, what is still unverified |
| [docs/mcp-server.md](docs/mcp-server.md) | The optional server and how to register it |
| [docs/decisions.md](docs/decisions.md) | Why it is this way: CLI over MCP, key handling, thresholds, naming |
| [docs/evaluation-and-tuning.md](docs/evaluation-and-tuning.md) | Measured numbers and how to tune thresholds from the log |
| [docs/development.md](docs/development.md) | Commands, test approach, how to add a question or a roster source |
| [docs/roadmap.md](docs/roadmap.md) | What is next, in order |
| [AGENTS.md](AGENTS.md) | Rules for agents editing this repo |
| [CHANGELOG.md](CHANGELOG.md) | Versions |

## The file to review

`src/questions.ts` holds every question and threshold. Thresholds are TypeSafe cookbook starting points and are not yet tuned; the hook's log exists so they can be.

## Status

0.3.0, 2026-09-24. 83 offline tests, including one that runs the built hook as a process. Verified live on Claude Code: `rank` in all three input modes, `check`, `classify` and `ask` warnings, the hook on three prompts, and all four tools of the optional MCP server through an SDK client. Under Codex the hook ranks Codex's own roster, checked offline against a real session catalog; the live run is pending on a Codex usage limit (`docs/cross-agent.md`).

This is personal tooling. No company repository depends on it.
