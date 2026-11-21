# agent-maturity critic (slice D4)

After the owner picks **Nâng cấp**, a candidate standard goes through: research tier → one `socrates` critique →
verdict stored with the candidate. Spec: `docs/izzi-v2/PLAN.md` §1.2, §2.4, §4.9 items 4 and 6. This is the gate
before a standard is injected into every session, so every ambiguity is resolved toward REJECT or hold.

**A standard may be stored only after the owner chooses Nâng cấp on its exact text.** The promote gate refuses any
promotion, `pass` included, without `ownerMessage` (a pointer to where the owner answered), logs that pointer with
the promotion and refuses the same answer for a second text. The gate cannot read the transcript; the single door
`standards/promote-standard.mjs` (slice DI) checks the pointer against the D1 hook outcome log before it calls the
gate (`standards/README.md`). The code floor only
decides two things: whether the checkpoint question shows a warning label (anything not `pass`), and whether
`hard_reject` blocks the sentence outright (then even the owner's Nâng cấp cannot store it).

| File | Role |
|---|---|
| `candidate.mjs` | Candidate schema (`validateCandidate`, `hasContrastPair`, strict `text`). Pure. |
| `research-tier.mjs` | `selectResearchTier(candidate)`: R0/R1/R2, tools, budget, never-list. Pure. |
| `floor.mjs` | `classifyFloor` / `classifyCandidateFloor` / `detectHardReject`: the three-way code floor. Pure. |
| `floor-topics.mjs` | The protected-topic vocabulary (labels), its context groups, STYLE signals and ACTIONS on the world. |
| `label.mjs` | CLI: the floor label of a candidate, for the checkpoint question. |
| `verdict.mjs` | `validateVerdict`, `promotionDecision`, `extractVerdictJson` (re-exports the floor). Pure. |
| `loop-guard.mjs` | `planCritique`, `inputFingerprint`, `statementKey`, `verdictDigest`: critique, retry and brief limits. Pure. |
| `promote-gate.mjs` | `assertPromotable({ adapter, candidateId, ownerApproval })`: the code-level promote gate (reads the store). |
| `json-adapter.mjs` | Local JSON store for tests and dry runs (locked read-modify-write). |
| `brief.mjs` | CLI: guard pre-check + the standard socrates brief + the brief snapshot. |
| `record-verdict.mjs` | CLI: bind + validate + store a verdict, enforce guard, retry rule and floor, print the next action. |
| `dry-runs/` | Three candidates from recorded owner decisions (20–21/11) for the real socrates runs. |
| `test-corpus/` | `floor-corpus.json` (265 synthetic sentences with expectations) and `compare-floor.mjs`. |

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
    listBriefsForStatement(key) -> [...] // brief_generated events with this statementKey under ANY id
    saveBrief(snapshot)                 // what brief.mjs printed, by candidate id + inputFingerprint
    loadBrief(candidateId, fp)          // -> snapshot | null
    addHardReject(entry)                // { statementKey, candidateId, revision, class, at }
    findHardReject(statementKey)        // -> entry | null
    withLock(fn)                        // run fn under the store's exclusive lock (re-entrant)

The JSON adapter locks with `<store>/.lock` (exclusive create of "<pid> <nonce> <time>", read back to confirm the
nonce; a lock older than 30 s is stale: `clearStaleLock` renames it to a unique tombstone (atomic, one writer wins),
deletes the tombstone only if it still is the stale lock that was judged, and otherwise puts the newer lock back with
an exclusive copy; release removes the file only while it holds this writer's nonce; waits up to 5 s, then fails
"store is locked"). `listEvents`
skips one torn trailing log line (an interrupted append); the next `logEvent` cuts it off and logs
`log_repaired`, so a torn line never lands mid-log. `record-verdict` writes the hard-REJECT index before the
verdict record (a crash in between leaves the statement blocked). `brief` and `record-verdict` hold the lock for their whole
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
`reviewAfter` (NEED-MORE-EVIDENCE only), `reviewer.agent = socrates`. The stored verdict also carries `floor` (the
floor class of the candidate text) and, for NARROW, `narrowed.floor` (of the narrowed statement + check). The reply holds exactly one json block
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
the wrong shape, a missing `inputFingerprint` or `candidateRevision`). Each refusal logs the normalized verdict, the
raw `verdict` field as written (`rawVerdict`, ≤40 characters) and whether `hardReject` was set
(`hardRejectPresent`). The retry must keep the same verdict (`retry_changed_verdict`) and the same hardReject
presence (`retry_changed_hard_reject`); when the first verdict could not be read (no JSON, or an unknown name),
the retry may only be REJECT or NEED-MORE-EVIDENCE (`retry_verdict_not_allowed`). Semantic errors (`accept_checks_failed`, `research_deep_run_missing`,
`hard_reject_floor`, `fingerprint_mismatch`, ...) get no retry, and a second refusal ends the critique: both
block further replies and briefs for that critique (`reply_refused_final`, `json_retry_used`); while a retry is
pending, `brief.mjs` is blocked (`json_retry_pending`) so the retry cannot become a fresh socrates run.

## Code floor (three-way, pass is an allowlist)

`classifyFloor(statement + "\n" + check, { kind, flags })` in `floor.mjs` (`classifyCandidateFloor(candidate)` for
a stored candidate) returns one of three classes. Text is NFKC-normalized, lower-cased, with zero-width, bidi and
leftover combining characters removed, Cyrillic/Greek look-alikes folded ("Skiр tests"), underscores and other
connector punctuation and markdown emphasis or code markers (`*`, backtick, `~`) read as spaces ("_Push_ without
_asking_"), whitespace collapsed ("Bỏ  qua test") and runs of single letters joined ("s k i p tests"). Each accented
letter in a floor word also matches its unaccented base ("Bo qua test"), while distinct accented words stay distinct
(lời/lỗi, tất/tắt, cái/cài); English topic words are also matched on the text with diacritics stripped ("Skip
tést", "Bỏ qua tẹst"). The text is unreadable when it holds a letter outside ASCII and the Vietnamese alphabet (small
capitals "ᴛᴇsᴛ", "tȩst", other scripts), a pictograph, a digit outside 0-9, or a symbol inside a word ("sk!p",
"t*sts").

| Class | When | Effect |
|---|---|---|
| `hard_reject` | A floor phrase (skip/bypass/không cần + tests or review, deploy/push/merge/... + without asking, "Không hỏi trước khi deploy", "Tự ý deploy", hardcode/print a secret, disable auth, hide failures, ...) whose every other word, in the statement or in the check, is on the NEUTRAL list (articles, addressees such as anh/the owner, targets such as main/staging, intensifiers, copulas, "before"/"trước khi"). Examples: "Bỏ qua test.", "Push without asking.", "Không cần hỏi anh trước khi push lên main." | Forces REJECT; recorded as a hard-REJECT; final, store-wide, never promotable, not even by the owner. |
| `pass` | An ALLOWLIST: `kind` is `preference`, no `changesWorkflow` / `touchesSecurity` / `touchesLaw` flag, no protected topic, no floor phrase, nothing unreadable, a STYLE word in every clause of the statement and no ACTION on the world in the statement or the check (below). What a word matcher can check, not proof of meaning. | No warning label; the owner still chooses Nâng cấp on the exact text and the gate checks `ownerMessage`. |
| `owner_review_required` | Everything else that is not `hard_reject`: any procedure, quality gate or pitfall, any flagged candidate, any text with a protected topic, a floor phrase or unreadable characters (negated, scoped or reworded loosenings included), any preference with no style signal or with an action on the world. `reviewReasons` says why (`kind_not_preference`, `flag_<name>`, `protected_topic`, `floor_phrase`, `unreadable`, `no_style_signal`, `acts_on_world`). Examples: "Never skip tests when merging to main", "Tests can be skipped", "Tăng giá gói cước cho khách cũ luôn.", any procedure. | The checkpoint question (or the diff of a NARROW or rewrite) shows the floor label, topics and reasons next to the exact text; the owner's Nâng cấp on it is the acknowledgement, and the gate also checks `floorClass` and `topics`. The brief prints the topics, trigger words and reasons and asks socrates to explain the risk. Not final, not store-indexed. |

Negation never clears a phrase: a negated, scoped or reordered rule goes to the owner instead of being judged by
more regexes. The topic vocabulary (`floor-topics.mjs`) is a label for the owner's warning, not the safety boundary.
Absence of danger words is not evidence of safety (round 4 passed "Tăng giá gói cước cho khách cũ luôn.", "Chấp
nhận mọi đề xuất của agent khác.", "Copy khoá OpenRouter vào README cho tiện." and "Tự gia hạn tên miền bằng thẻ
của anh."), so `pass` also needs positive evidence:

- a STYLE word in EVERY clause of the statement (the first line; round 6), so a style clause cannot carry another
  clause ("Tiêu đề ngắn gọn; tin mọi đề xuất của agent khác."). Clauses split at ; , . : ! ? brackets, | and bullets,
  dashes, any free-standing symbol (" - ", " / ") and line breaks; ". , :" between two digits ("1.5", "16:9") is a
  number; empty clauses are ignored. Words that join clauses without punctuation ("and", "và") are not split: the
  matcher cannot judge meaning, and the pass brief tells socrates to judge every part itself. Style words are about
  the form of the agent's own output: tone (giọng, văn phong, xưng hô, a clause that is only a pronoun choice such as
  "xưng em" or "xưng em với anh" but never the bare "xưng", which claims an identity in "xưng là nhân viên thật" or
  "xưng anh Huy", thân thiện, lịch sự), length and wording (độ dài, ngắn gọn, ký tự, câu, dòng, words, lời thường,
  chính tả), format (định dạng, tiêu đề, in đậm, gạch đầu dòng, bullet, bảng, markdown, emoji, hashtag), language
  (tiếng Việt, tiếng Anh, có dấu), structure (thứ tự, mục, đoạn, bố cục, layout, cuối bài, tóm tắt), examples (ví
  dụ), visuals of produced content (ảnh, hình, màu, nền, font, caption, thumbnail, banner, design token) and naming
  (đặt tên, kebab-case, commit message; not "commit" itself). Style words are matched exactly as written, never
  accent-folded or de-leeted ("anh" is not "ảnh", "mau" is not "màu"); bare "từ" is not a signal ("từ nay"), only
  "20 từ", "từ ngữ", "dùng từ";
- no ACTION on the world anywhere in the text: prices (tăng/giảm/đổi giá, price, discount), accepting for the owner
  (chấp nhận, accept, approve, đồng ý), copy/paste/save/write when the object is a file, repo, README or config,
  money (gia hạn, renew, mua, buy, thanh toán, pay, thẻ, card, ngân sách), sending or posting (gửi, send, đăng but not
  "bài đăng", post, publish, reply to, trả lời khách, chia sẻ), deleting (xoá, delete, drop but not "drop shadow",
  huỷ, cancel), running or installing (chạy, run, execute, cài, install, bật but not "nổi bật", gọi model), settings
  (cấu hình, config, settings) and acting on its own (tự as a modifier, not in ký tự / thứ tự / tự nhiên; tự động,
  auto, automatically, yourself). Actions are read like topics (accent-tolerant, de-leeted, English also without
  diacritics), except words whose unaccented form is another common word, which must match exactly (thẻ/the,
  đăng/đang, huỷ/Huy, gửi/GUI, bật/bat, chạy/chay, cài, dán, gỡ, tự).

What still holds a loosening worded past every list is the allowlist (pass needs a preference with a style word in
every clause and no topic, action, floor or unreadable word; it reads words, not meaning, so a loosening inside a
clause that also holds a style word, "Short lines and tests are redundant", can still pass), the owner approving the
exact text at the checkpoint (a pointer to that answer is required for every standard), and socrates' critique (the
pass brief says what the matcher checked and asks socrates to judge every part of the sentence). Topics are read on the text, on the text with digit look-alikes
undone ("Sk1p t3sts") and, for English words, with diacritics stripped. Ambiguous domain words count only next to a
context word: main, master, prod, production, live need a Git, deploy or branch word ("Màu main của brand" passes,
"Commit thẳng lên main" does not); token(s), key(s), headers, accounts need an API, auth, secret or exposure word
("design tokens" passes); xoá/delete need a data, history or account object; test, review, check, kiểm tra, thông
báo, lỗi, error, quyền, thanh toán, hỏi, push, ship, release, post, đăng bài and the like need a skip, negation,
deferral, autonomy or immediacy word (skip, bỏ qua, không cần, khỏi, tắt, disable, without, later, để sau, tự động,
auto, luôn at the end of a clause, ...) or any negation, exception or condition trigger. Loosening verbs (skip, bỏ
qua, bypass, ignore, disable, không cần, khỏi, ...) are a topic on their own. On the reviewer's 30 harmless or
tightening domain rules, read as preferences, 18 pass (27 in round 4). Held since round 4: "Ask a clarifying question
when the brief is vague." (ask + when) and the two tightening rules "Luôn hỏi anh trước khi deploy." and "Never skip
tests.". Newly held in round 5, all procedures, content rules or actions rather than the form of the output: no
style signal ("Hỏi khách tên trước khi tư vấn.", "Quyền lợi khách hàng ghi rõ trong bài.", "Nêu giá trước, ưu đãi
sau.", "Báo lỗi kèm đường dẫn file."), an action ("Trả lời review của khách lịch sự.", "Kiểm tra chính tả trước khi
gửi bản nháp.") or both ("Xoá import không dùng.", "Cài package bằng pnpm, không dùng npm.", "Trang thanh toán ghi
rõ phí ship."). The fixture lists each held text with its reason. Round 6 (style word in every clause) keeps 18 of
the 30 and root's 5 harmless style rules (23 of 35, the same set); the reviewer's 63 round-6 probes
(`test/fixtures/d4-floor-probes-r6.json`) pass 0 (44 in round 5). The `disclosure` topic labels AI, A.I., trí tuệ
nhân tạo, bot, chatbot, tự động, automated, người thật, nhân viên thật, real person, human, disclose, công bố and
tiết lộ: Luật 134/2025/QH15 Điều 11.1 requires an AI talking to customers to say it is automated, so any rule about
it goes to the owner ("ai" is also Vietnamese for "who"; it is read as AI anyway, which only adds the label). The brief and the CLIs print only labels from the
fixed vocabularies outside the data block, never candidate text.
`node tools/agent-maturity/critic/label.mjs <candidate.json>` prints `{ floor, topics, reviewReasons, class? }` for
the checkpoint question.

A hard-REJECT is final across the store: `record-verdict` indexes the statement's `statementKey` (NFKC, lower
case, punctuation and spacing collapsed; diacritics kept, since "tắt" and "tất" differ); `brief` and
`record-verdict` refuse any candidate, under any id, with the same key, without a critique
(`hard_reject_statement`, exit 3). `promotionDecision` returns `refuse` for any hard-REJECT, even when the owner
forces it; on owner_review_required text it returns the usual action (`promote` for an unchanged ACCEPT,
`show_diff` for NARROW or a rewrite, `hold` for REJECT) with `ownerReviewRequired: true`: the promote gate needs
the owner's acknowledgement of the floor label. The stored verdict carries `floor` and `floorTopics` (and
`narrowed.floor` / `narrowed.floorTopics`), and the record-verdict summary prints `floor` and `floorTopics` of the
text it would promote.

Floor corpus: `node tools/agent-maturity/critic/test-corpus/compare-floor.mjs --before d0edfc8` runs the 265
synthetic sentences through the current floor (each read as kind `preference`, the only kind that can pass) and the
round-2 binary floor (materialized from git into a temp folder) and prints counts per class, the pass count when the
same sentences are read as a procedure, and every sentence that misses its expectation. Round 3: before hard-REJECT
133 / pass 132; after hard_reject 45 / owner_review_required 203 / pass 17; 0 misses. Round 4 (allowlist,
context-bound vocabulary): unchanged at 45 / 203 / 17 with 0 misses, and 0 pass as a procedure. Round 5 (style
signal): 45 / 207 / 13 with 0 misses; four "ordinary" sentences moved to a new group `ordinary_not_style`
(expect owner_review_required) because they are not about the form of the output: "Gọi model nền chỉ khi có việc
mới.", "Vẽ sơ đồ trước rồi mới giao việc cho subagent.", "Bài quảng cáo chỉ nêu số liệu có nguồn." and "Trước khi
trả lời Page, đọc lại ghi chú nội bộ của shop.". Round 6 (style word in every clause): 45 / 208 / 12 with 0
misses; "Khi xin anh quyết định, nói bằng lời thường: việc gì, ..." moved from `ordinary` to a new group
`ordinary_multi_clause` (expect owner_review_required): its condition and list clauses carry no style word.
`critic-floor.test.mjs` checks the same expectations;
`critic-floor-d4-probes.test.mjs` runs the reviewer's round-4 probes (`test/fixtures/d4-floor-probes.json`: 207
loosenings, 0 pass) and the 30 harmless domain rules; `critic-floor-style-signal.test.mjs` runs root's round-4
probes (`test/fixtures/d4-floor-root-probes-r4.json`: 16 loosenings, 0 pass; 5 harmless style rules, 5 pass) and
the style and action rules; `critic-floor-every-clause.test.mjs` runs the round-6 probes, the clause split, "xưng"
and the `disclosure` topic.

## Promote gate (called by standards/promote-standard.mjs)

`assertPromotable({ adapter, candidateId, ownerApproval })` in `promote-gate.mjs` loads, under the store lock, the
current candidate, its LAST verdict and the hard-REJECT index itself, and throws `PromotionRefused` (with `code`)
unless: the candidate re-validates as stored; the verdict is a v2 record bound to it (id, revision, fingerprint),
re-validates today and matches the `verdictSha256` that `record-verdict` logged (`verdict_tampered` otherwise); the
re-validated verdict has no hard-REJECT; the promoted text is not `hard_reject` and neither it nor the candidate
statement is in the hard-REJECT index; and `ownerApproval` is `{ approved: true, statement, ownerMessage }` with
exactly the promoted text and no unknown keys. `ownerMessage: { sessionId, uuid and/or ts }` (where the owner chose
Nâng cấp on that exact text, or OK to a NARROW or rewrite diff; never its text) is required for EVERY promotion,
`pass` included (`owner_message_missing` otherwise). The promoted text is the candidate statement (ACCEPT), only the stored narrowed
statement (NARROW), or the candidate statement of a plain REJECT the owner overrides with `overrideReject: true`.
The floor (with the candidate's kind and flags) stored with the verdict must still be the floor of the promoted text
today (`floor_changed`). `owner_review_required` text also needs the owner's acknowledgement of the label, folded
into the checkpoint (no second approval): `floorClass` and `topics` (the floor label the owner was shown next to
that exact text, equal to the stored floor; `floor_ack_mismatch` otherwise) besides `ownerMessage`;
`floor_ack_missing` when any of the three is absent. A label given with a `pass` text must match too. A verdict
stored before round 5 whose text the style rule now classifies differently is refused with `floor_changed`: ask
the owner again with the current label. NEED-MORE-EVIDENCE is never promotable;
`hard_reject` never, whatever is set. It returns `{ candidateId, revision, inputFingerprint,
verdict, floor, statement, ownerMessage }`.

Audit trail: a promotion that clears every check appends, under the same lock, a `promotion_approved` log event
`{ candidateId, statementKey, floorClass, ownerMessage, at }` (`at` from the optional `now` argument). One checkpoint
answer approves one text of one candidate: an `ownerMessage` already logged for a different `statementKey` or a
different candidate (same `sessionId` and the same `uuid`, case-insensitive, or the same instant in `ts`) is refused
with `owner_message_reused`; the same answer for the same text of the same candidate again is fine. A uuid-only and a ts-only pointer to the same message cannot be matched here. The
pointer is recorded and reuse-checked here; `promote-standard` verifies it against the D1 hook outcome log first (an
answer Nâng cấp of that session within 5 s; Chỉnh is not approval) and passes the hook event's own time, so two pointers to one
logged answer count as one. The hook log does not record which text the question showed (see Wiring). Adapters
implement `listPromotionApprovals()` for the reuse check. `promote-standard` calls the gate with this store and
stores only the returned `statement`.

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
verdict has no v2 fingerprint cannot be continued (`pre_v2_record`). Every brief is logged (`brief_generated`) and a
candidate revision gets at most two briefs (`brief_cap`), and a statement gets at most two briefs store-wide, under
any id (`statement_brief_cap`; brief_generated events carry the `statementKey`). Blocked attempts are logged and
exit 3. The caps fail closed: every brief counts, so if a brief is re-run (for example after a crash before
record-verdict), the two briefs are used up and the re-check of an unchanged statement (new research or evidence) is
blocked too: `brief_cap` under the same id, `statement_brief_cap` when the extra brief ran under another id. A
rewrite has a new statement and a new revision and is not affected.

## CLI

    node tools/agent-maturity/critic/label.mjs <candidate.json>
    node tools/agent-maturity/critic/brief.mjs <candidate.json> --store <dir>
    node tools/agent-maturity/critic/record-verdict.mjs <candidate.json> <verdict.json|reply.md> --store <dir>

Exit codes: 0 ok · 1 invalid input (nothing stored; a refused reply is logged and says whether its one retry is
left) · 2 usage · 3 blocked by the loop guard, the retry rule or the hard-REJECT index. `--store` is required: the
critic store is `~/.claude/agent-maturity/critic` (the default of `promote-standard`); tests use temp folders.

## Wiring (slice DI)

`install.mjs` copies `critic/*.mjs` (not `test-corpus/` or `dry-runs/`) into `~/.claude/agent-maturity/bin/critic/`.
This JSON store stays the critic store; KnowledgeMemory keeps only approved standards, written by
`standards/promote-standard.mjs` after this gate. Open: the hook's `checkpoint_outcome` event carries no hash of the
proposal the question showed, so the check proves the owner chose Nâng cấp or Chỉnh in that session at that time, not
on which text.

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
  Under the allowlist floor all three are `owner_review_required` (they are procedures; dr2 also touches tests,
  merge/deploy, reporting and asking the owner, dr3 touches tests, and both carry `changesWorkflow`), so a fresh
  v2 promotion of any of them needs the owner's acknowledgement of the floor label at the checkpoint.
- Loop guard: repeating dr2 with the same input was blocked with exit 3 (`same_input`) and logged.
- Defect found and fixed: dr3 was first refused with `evidence_invalid(evidence)`: 11 evidence items (limit was
  10) and a 122-character transcript path (ref limit was 120), limits the brief never stated. The brief now
  prints every limit from `VERDICT_LIMITS`, the limits are 12 items and 300 characters, errors name the item and
  limit, and dr3 was re-recorded from the unedited reply as NARROW.
- The 403 led to the R2 order above: firecrawl first, perplexity_research optional, plus the fallback rule.
