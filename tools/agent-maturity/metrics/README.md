# agent-maturity metrics (slice D5, part 1)

Reads the D1 hook event log and prints the numbers of `docs/izzi-v2/PLAN.md` §2.6. Read-only: nothing here writes a
file, calls the network or stores prompt text. Part 2 (after D2): run on at least 7 days of real log, and pass the
checker gate below on real labelled pairs before its numbers are used.

    node tools/agent-maturity/report.mjs --since 2026-11-21 [--events <file>] [--baseline <file>] [--json]
    node tools/agent-maturity/metrics/check-repeats.mjs --standards <file> --transcript <file> [...] [--threshold 0.5] [--json]
    node tools/agent-maturity/metrics/eval-checker.mjs --pairs <file> [--threshold 0.5] [--json]

`--since` is a date (midnight UTC) or a timestamp with an offset; an impossible calendar date (2026-02-30) is
rejected. Without `--events` the report reads every `log/events-YYYY-MM.jsonl` under `AGENT_MATURITY_HOME` (default
`~/.claude/agent-maturity`). Strict mode is read from the log only: `global.json` flips strict mode at the same
moment the hook logs it (the next interactive prompt), and the report already applies the 7-day expiry.

## Event-log fields used

Every line: `ts`, `type`, `session`, `ep` (the hook's stamp). By type: `prompt` (`label`, `wrapper`),
`milestone`, `nudge` (`kind`), `checkpoint_outcome` (`outcome`, `initiated`), `strict_on`, `strict_off`. Lines that
do not parse or lack `ts`/`type` are skipped and counted. Only interactive sessions (`ep` = `cli` or
`claude-desktop`, the ones D1 nudges) with a session id are counted, so `claude -p` and SDK runs do not mix in.

## Definitions (`metrics@1`, shared with D0 `eval/eval-gold.mjs`)

The three rates below are `metrics@1`. D0 computes the same definitions over its gold set; change the version in
both places (`METRICS_VERSION`) whenever one of them changes.

- **Owner prompts:** `prompt` events without `wrapper` from `--since` on, minus checkpoint answers. Wrapper turns,
  checkpoint answers, non-interactive and session-less prompts are shown apart.
- **Checkpoint answers** are not owner prompts: a `prompt` whose hook run (same session, `ts` and `turn`) also logged
  a `checkpoint_outcome` of `accept`, `edit` or `skip`. D0's history has no such prompts, and counting them would grow
  the denominator. An `ignored` ask means the owner typed something else, so that prompt stays.
- **Corrections per 100 prompts:** owner prompts labelled `correction` or `clarify` × 100 / owner prompts. Both labels
  count, as in D1 `decide()`; the two counts are also shown separately.
- **Milestones:** `milestone` events (D1 never logs one for a reply to a checkpoint question).
- **First-pass approval:** milestones with no `correction`/`clarify` owner prompt since the previous milestone of the
  same session (or the session's first logged event) ÷ milestones. Tasks are rebuilt from the whole log, so a
  correction just before `--since` still counts against the milestone after it.
- **Reopened after approval (estimate, the reverse metric):** milestones followed, in the same session and before
  the next milestone, by a `correction`/`clarify` among the next 3 owner prompts. The log holds no text, so "about
  the same task" is assumed from closeness; rollbacks the owner does not type are not seen.
- **Parity with D0 prompts.** D0 counts typed prompts of up to 4000 characters from transcripts (not starting with
  `<` or `[Request interrupted`). The log keeps only a length bucket (largest `>200`), so prompts over 4000
  characters stay in the report's count; the classifier labels them `abstain:too-long`, so they never add a
  correction, only a denominator count. D0 also read `claude -p`/SDK transcripts, which the report leaves out.
  Transcript readers here (`check-repeats.mjs`, `eval-checker.mjs`) apply the D0 rules exactly.
- **Checkpoints:** `nudge` events (strong/weak); asks = `checkpoint_outcome` with `accept`/`edit`/`skip`/`ignored`
  (after a nudge or agent-initiated); `abstained` = nudged but the agent did not ask. Rates of Nâng cấp / Chỉnh /
  Bỏ qua / không trả lời are shares of asks.
- **Strict mode:** the last `strict_on`/`strict_off` in the whole log; on until 7 days after `strict_on`.
- **Fatigue alarm:** 6 or more `skip`/`ignored` among the last 10 asks in the whole log (fewer than 10 asks can
  already raise it). Unlike D1 strict mode, agent abstentions do not take a place in the window.

## Baseline file (`--baseline`)

The baseline is the file D0 writes with `eval/eval-gold.mjs ... --split test --export-baseline <file>` (kept outside
git, for example `F:/Ai Tools/Codex/AgentMaturity/d0/baseline-test.json`):

    { "schema": "agent-maturity/baseline@1",
      "definitions": "metrics@1",
      "classifierVersion": "1d11a4300477",
      "split": "test",
      "n": { "prompts": { "classifier": 252, "gold": 252 }, "milestones": { "classifier": 13, "gold": 60 } },
      "instruments": {
        "classifier": { "correctionsPer100": 3.17, "firstPassRate": 0.923, "reopenedRate": 0.077 },
        "gold": { "correctionsPer100": 15.08, "firstPassRate": 0.817, "reopenedRate": 0.133 } },
      "ownerReviewed": false }

`classifierVersion` = first 12 hex of sha256 over `lib/classify.mjs` with LF line endings (so a CRLF checkout gives
the git blob's value). Rates may be `null`; shares are 0–1, `correctionsPer100` ≥ 0; other schemas, unknown
instruments or fields are rejected.

Deltas are like for like only:
- **classifier** gets a delta for each rate only when `definitions` is `metrics@1` and `classifierVersion` equals the
  hash of this checkout's `classify.mjs`. Otherwise the baseline values are shown, every delta is `null`, and the
  report says which of the two differs (`comparable: false`, `reasons`). After the classifier is tuned, D0 must
  export a new baseline with the new classifier before deltas come back.
- **gold** never gets a delta (`delta: null` plus a warning in the text and JSON): the hook log is labelled by the
  classifier, so comparing it with human labels mixes two instruments. A gold comparison needs a gold-labelled
  sample of the pilot.

The report also prints the baseline's split, size and whether the owner reviewed its gold labels.

## Repeated-error checker v1

`checker.mjs` asks whether a correction repeats a standard that already existed. A standard is eligible when its
state is `active` or `candidate`, its scope covers the correction (`user`: every project; `project`: same
`project_id`, or the correction's folder equals or sits inside `project_root`) and it was created before the
correction. Text is lower-cased and accents stripped; stop words and correction markers are dropped.

Project scope follows PLAN §2.5: a worktree counts as its root project. `PROJECTS` in `checker.mjs` maps
`F:/Ai Tools/Tool Starizzi - B2C - Openclaw` and every `F:/Ai Tools/_wt-*` folder to project id
`2a906db6-a103-5375-b672-ad090f686c7e`, for both the correction's folder (`cwd`) and a standard's `project_root`, so a
standard with only `project_id` matches corrections typed in the root or any worktree. A project standard whose only
`project_id` is not in `PROJECTS` can never match a transcript correction (it has a folder, not an id); such
standards are counted as `unmatchable`.

- Term score: distinct terms shared with the standard's `title`/`summary`/`statement`/`topic_key`; 0 below 2, 1 at 4.
- Keyword score: each listed `keywords` phrase found in order; 0.5 for one, +0.25 for each further one.
- Confidence = the higher score; a repeat when confidence ≥ threshold (default 0.5).

Standards input (`--standards`): an array or `{ "standards": [...] }` of KnowledgeMemory-style records: `id`, `scope`,
`project_id` or `project_root`, `state` (or `status`; a record without one is taken as active), `created_at`,
`title`, `summary`, optional `topic_key`, `keywords`. `check-repeats.mjs` reads transcripts in place, classifies owner prompts with the D1 classifier and
checks those labelled `correction`/`clarify`; it prints transcript name, line uuid, label, standard id and scores.
Owner prompts follow the D0 rules (typed, at most 4000 characters, not `<…` or `[Request interrupted`); wrapper
prompts and answers to a checkpoint question (the assistant turn before asked one and the prompt picks an option, as
the hook decides) are not counted. A transcript that cannot be read or is over 256 MB is skipped with a warning on
stderr that names the file only.

### Labelled pair file (`--pairs`)

    { "version": 1,
      "standards": [ ...standard records as above... ],
      "pairs": [
        { "id": "p01", "standard": "std-a", "repeat": true,
          "correction": { "transcript": "C:/.../<session>.jsonl", "uuid": "<prompt line uuid>" } },
        { "id": "p02", "standard": "std-b", "repeat": false,
          "correction": { "text": "synthetic text", "project_root": "F:/proj", "at": "2026-11-12T08:00:00Z" } } ] }

`repeat` is the human label: does this correction repeat this standard? Real pairs use the transcript pointer, so
prompt text stays in the transcript; a relative path is read from the pair file's folder, and `project_root`/`at`
default to the line's `cwd`/`timestamp`. Inline `text` is for synthetic tests only. Keep real pair files outside git.
A pair whose standard or transcript line is not found is listed as unresolved and not scored. The harness reports
TP/FP/FN/TN, precision, recall, accuracy, distinct corrections and the part-2 gate.

**Part-2 gate.** Every check must pass: at least 30 scored pairs, at least 10 predicted repeats (TP + FP), at least
10 distinct corrections (one correction scored against several standards counts once), and the 95% Clopper-Pearson
lower bound of precision at 0.8 or more (same implementation as D0). The bound needs at least 17/17 predicted repeats
right, or 29/30; 16/16 or 28/30 still fail.
