# agent-maturity critic (slice D4)

After the owner picks **Nâng cấp**, a candidate standard goes through: research tier → one `socrates` critique →
verdict stored with the candidate. Spec: `docs/izzi-v2/PLAN.md` §1.2, §2.4, §4.9 items 4 and 6. This is the gate
before a standard is injected into every session, so every ambiguity is resolved toward REJECT or hold.

| File | Role |
|---|---|
| `candidate.mjs` | Candidate schema (`validateCandidate`, `hasContrastPair`, strict `text`). Pure. |
| `research-tier.mjs` | `selectResearchTier(candidate)`: R0/R1/R2, tools, budget, never-list. Pure. |
| `verdict.mjs` | `validateVerdict`, `detectHardReject` (code floor), `promotionDecision`, `extractVerdictJson`. Pure. |
| `loop-guard.mjs` | `planCritique`, `inputFingerprint`, `statementKey`: critique limits and the JSON retry. Pure. |
| `promote-gate.mjs` | `assertPromotable(candidate, verdictRecord)`: the code-level promote gate. Pure. |
| `json-adapter.mjs` | Local JSON store for tests and dry runs (locked read-modify-write). |
| `brief.mjs` | CLI: guard pre-check + the standard socrates brief + the brief snapshot. |
| `record-verdict.mjs` | CLI: bind + validate + store a verdict, enforce guard, retry rule and floor, print the next action. |
| `dry-runs/` | Three candidates from recorded owner decisions (20–21/11) for the real socrates runs. |

## Verdict binding

`brief.mjs` prints an `inputFingerprint`: the sha256 of the canonical candidate as briefed (id, revision,
statement, kind, scope, check, evidence with ids and notes in order, flags, existing standards, research refs). It
stores a snapshot of exactly what it briefed under `briefs/<id>/<fingerprint>.json`. The verdict must echo
`inputFingerprint` and `candidateRevision` (both required). `record-verdict` refuses a verdict whose fingerprint
or revision does not match the current candidate (`fingerprint_mismatch`, `revision_mismatch`), and refuses when
no snapshot for this exact text and critique exists or it does not match (`brief_snapshot_missing`,
`brief_snapshot_mismatch`). So an ACCEPT given for candidate A can never be stored for a B with the same id.

## Store adapter (D3 plugs the KnowledgeMemory store in here)

Every method is required (`ADAPTER_METHODS`); `brief` and `record-verdict` refuse an adapter that lacks one.

    saveCandidate(candidate)            // store the current revision; keep earlier revisions as history
    loadCandidate(id) -> record | null  // { candidate, previous: [...], verdicts: [...] }
    saveVerdict(candidateId, verdict)   // append; the candidate must already be stored
    logEvent(event)                     // guard/audit events: critique_blocked, verdict_refused, verdict_recorded
    listEvents(candidateId) -> [...]    // that candidate's events, oldest first (the retry rule reads them)
    saveBrief(snapshot)                 // what brief.mjs printed, by candidate id + inputFingerprint
    loadBrief(candidateId, fp)          // -> snapshot | null
    addHardReject(entry)                // { statementKey, candidateId, revision, class, at }
    findHardReject(statementKey)        // -> entry | null
    withLock(fn)                        // run fn under the store's exclusive lock (re-entrant)

The JSON adapter locks with `<store>/.lock` (exclusive create; a lock older than 30 s is stale and taken over;
waits up to 5 s, then fails "store is locked"). `brief` and `record-verdict` hold the lock for their whole
read-check-write. `candidate.revision` is set by the loop guard (1 = the sentence the owner approved; 2 = the one
rewrite). Each stored verdict carries `inputFingerprint`, `critiqueNumber`, `tier`, `tierRule`, `recordedAt`.

## Candidate (`agent-maturity/candidate@1`)

`id` (slug), `statement` (≤200), `kind` (preference | procedure | quality_gate | pitfall), `scope` { agent,
taskType, projects: all | this }, `check` (≤300), `evidence` [{ id, type (correction | reject | edit |
approve_after_reject | approve | decision | outcome), at, source, note? }] oldest first, optional `flags`
{ touchesLaw, touchesSecurity, contentClaim, changesWorkflow, ownerPrivate }, `existingStandards` [{ id,
statement }] from `recall`, `research` { refs }. Every text field is NFKC-normalized and refused when it holds a
control or format character (newlines, tabs, zero-width, bidi), a line/paragraph separator or a leftover
combining mark, so nothing can break out of the brief's data block or split a word past the floor. Keys,
tokens, phone numbers and emails are refused. The brief prints the candidate as ONE JSON block between the
`CANDIDATE DATA` markers (backticks escaped).

## Verdict (`agent-maturity/verdict@2`)

`candidateId`, `candidateRevision`, `inputFingerprint`, `verdict` (ACCEPT | NARROW | NEED-MORE-EVIDENCE | REJECT;
`NEED-MORE` is read as NEED-MORE-EVIDENCE), `reasons` (1–5), `evidence` [{ ref, kind, finding: supports |
contradicts | insufficient }], `checks` { evidenceSupports, scopeTooWide, contradictsExisting, tierCorrect },
`hardReject` (null or { class, detail }), `narrowed.statement` (NARROW only), `research` { tier, refs, deepRuns },
`reviewAfter` (NEED-MORE-EVIDENCE only), `reviewer.agent = socrates`. The reply holds exactly one json block
(plain JSON, or one fenced block); a second block (`multiple_json_blocks`) or a repeated key at any depth
(`duplicate_keys`) is refused. Text values follow the candidate text rules.

Rules: ACCEPT needs all four checks to pass; ACCEPT and NARROW must cite a candidate evidence id that supports
them, meet the research tier, stay inside its budget, and (R2 with web research allowed) report the one deep
run. A named hard-REJECT class forces REJECT.

Limits live in `VERDICT_LIMITS` (`verdict.mjs`) and `brief.mjs` prints them from there, so the brief and the
validator cannot drift: reasons 1–5 × ≤400 characters, evidence 1–12 items, `evidence[].ref` ≤300 (absolute
Windows transcript paths are ~120+), `evidence[].note` ≤300, `narrowed.statement` ≤200, `research.refs` ≤10 ×
≤300 (and inside the tier budget), `hardReject.detail` ≤300, `reviewer.model` ≤80. A refused reply names the
item and the limit, for example `evidence_invalid(evidence[4].ref length 322 > 300)`.

## One JSON retry

A refused reply is logged as `verdict_refused` in the loop-guard log (`log.jsonl`) with its attempt number and
whether it may be retried. At most ONE "fix only the JSON" retry, and only when every error is a format or
limit error (`FORMAT_ERROR_CODES`: unreadable JSON, a second block, repeated keys, a field over its limit or of
the wrong shape, a missing `inputFingerprint` or `candidateRevision`). The retry must keep the same verdict
(`retry_changed_verdict`). Semantic errors (`accept_checks_failed`, `research_deep_run_missing`,
`hard_reject_floor`, `fingerprint_mismatch`, ...) get no retry, and a second refusal ends the critique: both
block further replies and briefs for that critique (`reply_refused_final`, `json_retry_used`); while a retry is
pending, `brief.mjs` is blocked (`json_retry_pending`) so the retry cannot become a fresh socrates run.

## Hard-REJECT floor

`detectHardReject` matches plain wording (Vietnamese or English) that loosens verification, security or honest
reporting, or expands authority. A match forces REJECT; a match in `narrowed.statement` is refused too. Text is
NFKC-normalized, lower-cased, with zero-width, bidi and leftover combining characters removed. Each accented
letter in a floor phrase also matches its unaccented base letter, so "Bo qua test" and "Deploy khong can hoi"
match; full diacritic folding is not used because it merges distinct words (lời/lỗi, tất/tắt, cái/cài) and would
hard-REJECT "Chạy tất cả test" as "tắt ... test". Phrasings include skip/bypass/không cần + tests or review,
"Không chạy test", "Merge/Ship/Mark done ... without running tests", "Test là không bắt buộc" / "tests are
optional", deploy/push/merge/... + without asking (also after a comma), "No need to ask before deploying",
"Không hỏi trước khi deploy", "Tự ý deploy".

Negation is judged inside the sentence, with accented negators only (an unaccented "khong" never clears a
match). A negator governing the phrase from the left in the same clause ("không bỏ qua test", "it is not allowed
to skip tests", "never, even when rushed, skip tests") or a prohibition later in the sentence ("skipping tests is
never allowed", "bỏ qua test là không được phép") clears it, except when:

- punctuation (`;` `,` `.` `:` or a dash) separates the negator from the phrase or sits inside the match: a
  negation ends at the punctuation ("Never deploy on Friday; push without asking", "Không deploy thứ Sáu, push
  không hỏi");
- an exception or condition follows in the sentence (trừ khi, ngoại trừ, nếu, khi, unless, except, if, when):
  "Không bỏ qua test trừ khi anh đang vội", "Bỏ qua test là không được phép nếu PR lớn". Concessive "even if",
  "kể cả khi" and temporal "trước khi", "sau khi" are not exceptions;
- the negations cancel (an even number of negators): "Không cấm bỏ qua test", "Nobody says you can't skip
  tests", "Skipping tests is not forbidden".

The floor errs toward REJECT: write one rule per sentence, with diacritics, as a plain prohibition ("Không bỏ
qua test trước khi merge", "Never merge without running tests"). Socrates stays the primary judge.

A hard-REJECT is final across the store: `record-verdict` indexes the statement's `statementKey` (NFKC, lower
case, no diacritics, punctuation and spacing collapsed); `brief` and `record-verdict` refuse any candidate, under
any id, with the same key, without a critique (`hard_reject_statement`, exit 3). `promotionDecision` returns
`refuse` for any hard-REJECT, even when the owner forces it.

## Promote gate (D3 must call it)

`assertPromotable(candidate, verdictRecord)` in `promote-gate.mjs` throws `PromotionRefused` (with `code`) unless:
the verdict is a v2 record (`verdict@2`, 64-hex `inputFingerprint`) bound to this exact candidate (id, revision,
fingerprint); it re-validates against the candidate today; it is ACCEPT, or NARROW (then the narrowed statement is
what gets promoted); it carries no hard-REJECT and the floor does not match the promoted text; and
`verdictRecord.ownerApproval` is `{ approved: true, statement }` with exactly that statement. It returns
`{ candidateId, revision, inputFingerprint, verdict, statement }`. **At integration, D3's `promote` must call it
with the current stored candidate and its last verdict plus the owner's approval, promote only the returned
`statement`, and also refuse a statement whose `statementKey` is in the hard-REJECT index.** D4 does not edit
D3 code.

## Research tiers

| Tier | When | Tools (in the order to try them) | Budget |
|---|---|---|---|
| R0 | pure preference; procedure that only changes phrasing | none; no `mcp__*` tools at all | 0 sources |
| R1 | content or marketing claim; pitfall | WebSearch, perplexity_search, perplexity_ask, WebFetch, firecrawl_scrape | ≤2 sources, no deep run |
| R2 | process that changes the way of working; law; security | firecrawl_search + ≤3 firecrawl_scrape (the default deep run); perplexity_research only as an optional alternative (may need paid credit); firecrawl_developer_search, firecrawl_research_search_papers, perplexity_reason; law adds firecrawl_gov_search (US only) | ≤5 sources, 1 deep run |

Fallback (every tier with web research): if a tool returns 401, 402 or 403, switch to the next allowed tool;
never retry the same paid tool.

Not allowed: any external research for owner-private content (`flags.ownerPrivate`; local repo and recorded
docs only, no `mcp__*` tools at all); ChatGPT web, ever; firecrawl_agent, jobs_search, people/company providers,
Composio, PostHog writes, Playwright, sending candidate text to Jev; firecrawl_research_read_paper outside R2 web
research. Queries stay generic. Highest applicable tier wins; flags can only raise a tier (a flag set to false
never lowers what the wording shows). The brief prints the tier's full never-list.

## Loop guard

Per candidate: 1 critique + 1 rewrite, and the rewrite gets one re-check. Critique 2 needs new input since
critique 1 (a rewrite, research or evidence), otherwise `same_input`. Critique 3 is always blocked
(`max_critiques`). A hard-REJECT is final (`hard_reject_final`, and store-wide as above). A record whose last
verdict has no v2 fingerprint cannot be continued (`pre_v2_record`). Blocked attempts are logged and exit 3.

## CLI

    node tools/agent-maturity/critic/brief.mjs <candidate.json> --store <dir>
    node tools/agent-maturity/critic/record-verdict.mjs <candidate.json> <verdict.json|reply.md> --store <dir>

Exit codes: 0 ok · 1 invalid input (nothing stored; a refused reply is logged and says whether its one retry is
left) · 2 usage · 3 blocked by the loop guard, the retry rule or the hard-REJECT index. `--store` is required.
Until D3 lands, use a temp folder such as `F:/Ai Tools/Codex/Temp/agent-maturity-critic/`.

## Integration gap (D2/D3)

`install.mjs` does not copy `critic/` into the installed runtime yet, so the commands above run only from the
Starizzi checkout. Copying it, pointing `--store` at the KnowledgeMemory adapter and calling `assertPromotable`
from `promote` are integration items for D2/D3; D4 does not edit `install.mjs`/`uninstall.mjs`.

## Dry runs (2026-11-21, real socrates, store `F:/Ai Tools/Codex/Temp/am-critic-store`)

| Candidate | Tier | Verdict | Research |
|---|---|---|---|
| dr1-plain-language-decisions | R0 | NARROW | none (R0) |
| dr2-checkpoint-after-workflow | R2 | NARROW | 1 deep run, 4 sources; perplexity_research returned 403 (needs paid credit), firecrawl used instead |
| dr3-fuses-not-fixed-cap | R2 | NARROW | 1 deep run, 2 sources |

- **Pre-v2 evidence, not promotable.** These three records were recorded before the verdict binding (schema
  `verdict@1`, a 32-character guard fingerprint, no brief snapshot). They stay as dry-run evidence of the critic
  flow only: `assertPromotable` refuses them (`pre_v2_verdict`) and the loop guard will not continue them
  (`pre_v2_record`). A real promotion needs a fresh v2 critique under a new store or id.
- All three verdicts are stored with their candidate (`decision.action = show_diff`); none hit a hard-REJECT.
- Loop guard: repeating dr2 with the same input was blocked with exit 3 (`same_input`) and logged.
- Defect found and fixed: dr3 was first refused with `evidence_invalid(evidence)`: 11 evidence items (limit was
  10) and a 122-character transcript path (ref limit was 120), limits the brief never stated. The brief now
  prints every limit from `VERDICT_LIMITS`, the limits are 12 items and 300 characters, errors name the item and
  limit, and dr3 was re-recorded from the unedited reply as NARROW.
- The 403 led to the R2 order above: firecrawl first, perplexity_research optional, plus the fallback rule.
