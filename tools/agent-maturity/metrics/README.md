# agent-maturity metrics (slice D5, part 1)

Reads the D1 hook event log and prints the numbers of `docs/izzi-v2/PLAN.md` §2.6. Read-only: nothing here writes a
file, calls the network or stores prompt text. Part 2 (after D2): run on at least 7 days of real log, and score the
checker on at least 30 real labelled pairs (precision ≥ 0.8) before its numbers are used.

    node tools/agent-maturity/report.mjs --since 2026-11-21 [--events <file>] [--baseline <file>] [--json]
    node tools/agent-maturity/metrics/check-repeats.mjs --standards <file> --transcript <file> [...] [--threshold 0.5] [--json]
    node tools/agent-maturity/metrics/eval-checker.mjs --pairs <file> [--threshold 0.5] [--json]

`--since` is a date (midnight UTC) or a timestamp with an offset. Without `--events` the report reads every
`log/events-YYYY-MM.jsonl` under `AGENT_MATURITY_HOME` (default `~/.claude/agent-maturity`).

## Event-log fields used

Every line: `ts`, `type`, `session`, `ep` (the hook's stamp). By type: `prompt` (`label`, `wrapper`),
`milestone`, `nudge` (`kind`), `checkpoint_outcome` (`outcome`, `initiated`), `strict_on`, `strict_off`. Lines that
do not parse or lack `ts`/`type` are skipped and counted. Only interactive sessions (`ep` = `cli` or
`claude-desktop`, the ones D1 nudges) with a session id are counted, so `claude -p` and SDK runs do not mix in.

## Definitions

- **Prompts:** `prompt` events without `wrapper` from `--since` on. Wrapper turns, non-interactive and session-less
  prompts are shown apart.
- **Corrections per 100 prompts:** prompts labelled `correction` or `clarify` × 100 / prompts. Both labels count,
  as in D1 `decide()`; the two counts are also shown separately.
- **Milestones:** `milestone` events (D1 never logs one for a reply to a checkpoint question).
- **First-pass approval:** milestones with no `correction`/`clarify` prompt since the previous milestone of the same
  session (or the session's first logged event) ÷ milestones. Tasks are rebuilt from the whole log, so a
  correction just before `--since` still counts against the milestone after it.
- **Reopened after approval (estimate, the reverse metric):** milestones followed, in the same session and before
  the next milestone, by a `correction`/`clarify` among the next 3 owner prompts. The log holds no text, so "about
  the same task" is assumed from closeness; rollbacks the owner does not type are not seen.
- **Checkpoints:** `nudge` events (strong/weak); asks = `checkpoint_outcome` with `accept`/`edit`/`skip`/`ignored`
  (after a nudge or agent-initiated); `abstained` = nudged but the agent did not ask. Rates of Nâng cấp / Chỉnh /
  Bỏ qua / không trả lời are shares of asks.
- **Strict mode:** the last `strict_on`/`strict_off` in the whole log; on until 7 days after `strict_on`.
- **Fatigue alarm:** 6 or more `skip`/`ignored` among the last 10 asks in the whole log (fewer than 10 asks can
  already raise it). Unlike D1 strict mode, agent abstentions do not take a place in the window.

## Baseline file (`--baseline`)

D0 reports its baseline for two instruments: `gold` (human labels) and `classifier` (the D1 classifier run over the
same prompts). The hook log is classifier-labelled, so only `classifier` compares like with like; `gold` is shown as
reference only. Either instrument may be left out, and either value inside it.

    { "source": "D0-REPORT.md 2026-11-21, test split",
      "instruments": {
        "classifier": { "firstPassRate": 0.9, "correctionsPer100": 1.2, "note": "optional" },
        "gold": { "firstPassRate": 0.817, "correctionsPer100": 14.3 } } }

`firstPassRate` is 0–1, `correctionsPer100` ≥ 0; unknown instruments or fields are rejected. Check the D0
definition before comparing: the first D0 gold baseline counts `correction` only, this report counts `clarify` too.

## Repeated-error checker v1

`checker.mjs` asks whether a correction repeats a standard that already existed. A standard is eligible when its
state is `active` or `candidate`, its scope covers the correction (`user`: every project; `project`: same
`project_id`, or the correction's folder equals or sits inside `project_root`) and it was created before the
correction. Text is lower-cased and accents stripped; stop words and correction markers are dropped.

- Term score: distinct terms shared with the standard's `title`/`summary`/`statement`/`topic_key`; 0 below 2, 1 at 4.
- Keyword score: each listed `keywords` phrase found in order; 0.5 for one, +0.25 for each further one.
- Confidence = the higher score; a repeat when confidence ≥ threshold (default 0.5).

Standards input (`--standards`): an array or `{ "standards": [...] }` of KnowledgeMemory-style records: `id`, `scope`,
`project_id` or `project_root`, `state` (or `status`; a record without one is taken as active), `created_at`,
`title`, `summary`, optional `topic_key`, `keywords`. `check-repeats.mjs` reads transcripts in place, classifies owner prompts with the D1 classifier and
checks those labelled `correction`/`clarify`; it prints transcript name, line uuid, label, standard id and scores.

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
TP/FP/FN/TN, precision, recall, accuracy and the part-2 gate.
