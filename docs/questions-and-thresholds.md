# Questions and thresholds

Everything Jev is asked, and every constant that turns a probability into a decision, lives in `src/questions.ts`. This page explains each one. If you change a question or a threshold, change it there and update this page.

TypeSafe's own guidance: the most important thing for a human to review is the questions and any threshold constants. Typed output guarantees the interface, not the truth; the questions decide what is being judged.

## Conventions used in every question

- State fields are referenced in backticks, such as `` `query` `` or `` `candidate.text` ``, which is how System One instructions point at parts of the state.
- Each question asks one coherent judgment. Independent dimensions are separate questions so their probabilities can be combined in code.
- Noul criteria describe both outcomes so the yes/no boundary is explicit.
- Choice options are ids or names; their descriptions carry the meaning. A Choice always produces a winner, so wherever "nothing fits" is possible there is a separate Noul for it.

## `jev rank`

| Constant | Value | Meaning |
|---|---|---|
| `WINDOW_MAX` | 255 | Most candidate ids one Choice carries. Above this, window mode falls back to rerank. From TypeSafe's line-by-line search cookbook. |
| `EXISTS_PRESENT` | 0.70 | `exists` at or above this gives verdict `present`. Cookbook notes present answers typically read 0.9 or higher. |
| `EXISTS_PARTIAL` | 0.35 | At or above this but below present: `partial`. Below: `absent`. |
| `RERANK_CONCURRENCY` | 12 | Parallel requests in rerank mode. The cookbook used 12 workers; the API limit is 1,200 requests per minute. |

The constants follow TypeSafe's line-by-line search cookbook exactly. The questions do not: that cookbook asks "which line of the document contains the answer" with the query inside the instructions, while `jev rank` asks which candidate best answers or satisfies a `query` held in state, so it works over files, grep lines and arbitrary JSON candidates. The cookbook's measured results therefore do not transfer to `jev rank` as evidence. In rerank mode `exists` is the highest per-candidate probability, a heuristic of this project with no cookbook basis.

**Window mode** (`rankWindowQuestions`), state `{ query, candidates: [{id, text}] }`:

- `best` (Choice over ids): "Which candidate in `candidates` best answers or satisfies `query`? Judge by meaning, not by shared words. Each option is a candidate id."
- `exists` (Noul): "Does at least one entry in `candidates` genuinely answer or satisfy `query`?" True: some candidate directly addresses what the query asks for. False: the candidates are only loosely related, or none addresses the query.

**Rerank mode** (`rankPairQuestions`), state `{ query, candidate: {id, text} }`, one request per candidate:

- `matches` (Noul): "Does `candidate.text` answer or satisfy `query`?" True: directly addresses what the query asks for. False: only topically similar, or unrelated.

## Skill suggestion

| Constant | Value | Meaning |
|---|---|---|
| `SUGGEST_GATE` | 0.30 | Mean of the three gate signals must reach this before any skill is suggested. Cookbook value. |
| `SUGGEST_FIT` | 0.30 | Best shortlist `fits` probability must reach this for the winner to be suggested. Cookbook value. |
| `SUGGEST_SHORTLIST` | 3 | Candidates carried into the second request. |
| `SUGGEST_WIDE_DESCRIPTION_CHARS` | 240 | Description length in the wide pass, approximating what the agent's own catalog shows. |
| `SUGGEST_BODY_CHARS` | 700 | Body excerpt appended to the description in the shortlist pass. Cookbook value; was 600 until the 2026-09-20 conformance review (decision 13). |
| `MIN_PROMPT_CHARS` (in the hook) | 12 | Shorter prompts are skipped. |

**Wide pass** (`suggestWideQuestions`), state `{ request }`:

- `which` (Choice over every skill name, described by its truncated description): "Which skill best fits `request`? Each option is a skill name with a description of when it should be used."
- `acts_on_user_system` (Noul): "Does `request` ask the assistant to do something on the user's systems, files, or accounts, rather than only answer from knowledge?"
- `would_follow_documented_procedure` (Noul): "Would a competent assistant handling `request` want to follow a documented procedure or checklist rather than improvise?"
- `prose_suffices` (Noul): "Could `request` be fully satisfied by a plain prose answer, with no tool use, files, or procedure?"

Gate = mean(`acts_on_user_system`, `would_follow_documented_procedure`, 1 - `prose_suffices`). The third signal is inverted because a high probability means no skill is needed.

**Shortlist pass** (`suggestShortlistQuestions`), same state:

- `which` (Choice over the three, each described by full description plus body excerpt): "Which of these skills best fits `request`? Each option is a skill name with its full description."
- `fits::<name>` (Noul, one per candidate; instructions are a structured object with `question`, `skill` and `description`): "Does this skill perform the specific task that `request` asks for?" True: the skill's stated purpose covers what the request actually asks for. False: the skill is only adjacent, or the request asks for something it does not do.

## What the thresholds are not

They are cookbook starting points, not tuned values. `docs/evaluation-and-tuning.md` explains how to tune them from the log. A Choice's `confidence` is how concentrated its distribution is, not how correct the workflow is. A Noul near 0.5 is uncertainty, not medium intensity. None of these numbers is permission to act without the agent's own judgment.
