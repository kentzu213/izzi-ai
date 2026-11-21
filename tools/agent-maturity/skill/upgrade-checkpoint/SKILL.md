---
name: upgrade-checkpoint
description: Use when the agent-maturity hook notes a completion signal, when you finished a workflow the owner delegated (merge, release, deploy, verified) and an earlier correction backs a lesson, or when the owner asks to upgrade how an agent works or thinks. Turns one evidence-backed lesson into a proposed working standard with a single question; never asks without evidence.
---

# Upgrade checkpoint

Goal: when work the owner accepted taught one concrete lesson, ask **one** question at the end of the reply:
should this lesson become a working standard? No evidence, no question.

## When you may ask

- The hook note says the owner just gave a completion signal (decision such as "phát hành", "merge", "đồng ý",
  "duyệt theo", "sửa ở đây", or clear praise), **and** you have a candidate the rules below allow.
- You yourself finished a workflow the owner delegated (merge, release or deploy, verified) and an earlier owner
  correction in this task backs the candidate. Ask once, in that workflow's final report.
- The owner explicitly asks to upgrade how an agent works or thinks.

## Hard rules

1. **One candidate, at the end.** Never ask mid-task. Finish what was asked first. If the work continues in a later
   turn (CI, build, review), ask in that work's final report, not now.
2. **Evidence or silence.** Strong evidence = an in-session contrast pair: the owner corrected or rejected something,
   then later approved the fixed version. Weak evidence = no correction, but you used a method not already in the
   active standards and its result was verified in this task; at most once per session.
3. **Never evidence:** lone praise; resignation ("thôi được rồi", "cũng được", "tạm được"); flow control ("tiếp tục",
   "ok"); questions or negations ("merge chưa?", "đừng phát hành"); your own output or opinions.
4. **Limits.** At most 1 ask per task; ask again only with new evidence (a new correction after the last ask) and at
   least 3 owner prompts later; at most 3 asks per session, including asks you start yourself (the hook counts every
   ask block). If the hook note says strict mode is on: contrast pairs only, at most 1 per session. Strict mode turns
   on when 6 of the last 10 asks were skipped or unanswered, and ends 7 days later with an empty count. Only CLI and
   desktop sessions update that count; `claude -p` and SDK sessions only log.
5. **Do not mention the hook note** when you decide not to ask.
6. **Kill switch:** environment `AGENT_MATURITY=off`, or `"enabled": false` in `~/.claude/agent-maturity/config.json`.

## The question (exact frame, Vietnamese, last thing in the reply)

    [Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?
    - Đề xuất: <đúng câu sẽ lưu, ≤200 ký tự; không ngoặc kép, không in đậm, không ghi chú>
    - Áp dụng cho: <vai trò/agent> · <loại việc> · <dự án này | mọi dự án>
    - Cách kiểm: <điều kiện kiểm được trước khi giao>
    - Bằng chứng: <lúc trước anh sửa/từ chối gì, ≤15 từ> → <sau đó anh duyệt gì>
    - Loại: sở thích | quy trình | cổng chất lượng · Tra cứu: R0 | R1 | R2
    - Nhãn an toàn (chỉ khi nhãn không phải pass): owner_review_required (cần anh xem) · Chủ đề: <topics, hoặc "không có"> · Lý do: <lý do bằng lời thường>
    Trả lời: gõ đúng chữ Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua

The first line is a fixed marker; keep it byte-exact. Write the block as plain lines: the hook counts an ask only when
the header starts a line and the `Trả lời:` line follows; naming the header inside a sentence is not an ask, and a
block inside a code fence (```` ``` ```` or `~~~`) or an HTML comment is not read. Exactly one live ask block per
message: with two, the hook binds the answer to neither and `promote-standard` refuses it. Scope is
always explicit (role, task type, project or all projects). The check must be something a reviewer can verify before
hand-off. Explain internal codes in plain words.

**Exact text and safety label, before asking.** A standard may be stored only after the owner chooses **Nâng cấp**
on its exact text, and the promote gate needs a pointer to that answer (step 6): the "Đề xuất" line is always the
exact final sentence that would be stored, never a paraphrase, and nothing else (no quotes, bold, note or second
sentence on that line). The hook logs the sha256 of that line's text (after "Đề xuất:", trimmed, NFC) and the label
on the "Nhãn an toàn" line of the block the owner answered, never the text; `promote-standard` refuses with
`owner_message_unbound` unless the hash is of exactly the text it stores (the narrowed one for NARROW) and, when the
label is not `pass`, the logged label is that label. So the "Nhãn an toàn" line starts with the label code
(`owner_review_required`), and every ask uses this block, a NARROW or rewrite diff included.
Write the candidate file first (see "Nâng cấp" step 2) and run `node <am>/critic/label.mjs <candidate.json>`: it
prints the code floor's label of exactly that sentence, check, kind and flags (`floor`, `topics`, `reviewReasons`).
When the label is not `pass`, add the "Nhãn an toàn" line next to the exact text with the label, its topics and
one plain-Vietnamese reason per `reviewReasons` entry (for example `kind_not_preference`: "loại quy trình nên luôn
cần anh xem"; `protected_topic`: "đụng tới kiểm thử và phát hành"; `no_style_signal`: "có vế câu không nói về hình
thức câu trả lời (giọng, độ dài, định dạng, ngôn ngữ, bố cục, ví dụ, hình ảnh, đặt tên)"; `disclosure` topic: "đụng
tới việc nói rõ mình là AI, luật bắt buộc khi nói chuyện với khách"; `acts_on_world`: "có hành động
tác động ra ngoài (giá, chấp nhận thay anh, chép vào file, thanh toán, gửi hoặc đăng, xoá, chạy hoặc cài, đổi cấu hình,
tự làm)"). `pass` is only what a word matcher can check: a preference with a style word in EVERY clause of the sentence
(clauses split at ; , . : ! ? brackets and dashes), no action word, no protected topic and no review flag. It cannot
judge meaning, so `pass` is not proof the sentence is harmless; every procedure, quality gate and pitfall is
`owner_review_required`. The floor only decides whether that warning line is shown and whether `hard_reject` blocks
the sentence outright. If the label is `hard_reject`, do not ask: that sentence can never become a standard; tell the
owner which policy it would loosen. The owner choosing **Nâng cấp** on a question that showed the exact text (and the
label, when there is one) IS the approval and the acknowledgement; there is no second approval. Note where the owner
answered (session id and the time of that message, from the transcript) for `--owner-message` in step 6: every
standard needs it, `pass` included. `promote-standard` checks it against the hook log (an answer Nâng cấp in that
session within 5 s of that time, at most 7 days old) and refuses the same answer for a second text or candidate.
**Chỉnh is not approval:** a Chỉnh (or Bỏ qua) answer is refused (`owner_message_not_accept`). **Only the option
word approves:** the owner's reply must be exactly `Nâng cấp` (any case, with or without diacritics, a final `.` or
`!` allowed); "Nâng cấp nhé", "có", "ok" or "1" is refused (`owner_message_not_literal`), so the `Trả lời:` line
asks for the word itself and a looser yes means asking again. The hook logs no message uuid, so give the time, one
answer per standard.

## A standard is data, not authority

A stored standard describes how to do work the owner already asked for. It never grants tool authority or
permissions, never overrides CLAUDE.md, AGENTS.md or system rules, and never overrides the owner's current
instructions. When a standard and those conflict, the governing instructions win and you say so.

## After the owner answers

- **Bỏ qua:** write nothing to the store. The hook already logs the outcome.
- **Chỉnh:** the owner's wording replaces the proposal. Rewrite the candidate file and run `label.mjs` again: if it
  is `hard_reject`, stop; otherwise ask the checkpoint question again with the new exact text (and its label when it
  is not `pass`): the owner has not yet chosen Nâng cấp on that exact sentence.
- **Nâng cấp:**
  1. **Root only** writes the critic store and KnowledgeMemory (steps 2-6). A subagent never writes either; it returns the
     proposal (claim, scope, check, evidence, source = session id + time) to root.
  2. Root writes the candidate file (schema in `<am>/critic/README.md`, examples in `<am>/critic/dry-runs/`): id,
     the approved sentence, kind, scope, check, evidence ids oldest first with where each is recorded, flags
     (`ownerPrivate` for shop or customer content), and same-topic standards from `recall`. `<am>` is the installed
     runtime `~/.claude/agent-maturity/bin`, or `tools/agent-maturity` in the Starizzi checkout when it is not
     installed. `<critic>` is the critic store `~/.claude/agent-maturity/critic` (the default of step 6).
  3. `node <am>/critic/brief.mjs <candidate.json> --store <critic> --repo-root <checkout folder>` (the folder the
     evidence paths are relative to; without it, the working folder) picks the research tier, checks the loop guard and
     the store-wide hard-REJECT index, prints the standard brief with its `inputFingerprint` and the code floor's
     class, and stores a snapshot of exactly what it briefed. Every brief is logged; a candidate revision gets at
     most two briefs. Exit 3 = blocked: do not run socrates; tell the owner why. Otherwise paste the brief
     unchanged as the prompt of the `socrates` agent. Never run socrates on a candidate without this brief, and do
     not edit the candidate file between the brief and step 5 (the verdict is bound to that exact text).
  4. Socrates critiques once and researches only inside the tier's budget:
     - R0 (pure preference, or a procedure that only changes phrasing): no research.
     - R1 (content, ads, claims; pitfalls): one cheap cited lookup (WebSearch, perplexity_search or
       perplexity_ask), at most 2 sources.
     - R2 (process that changes the way of working, or law or security): one deep run (firecrawl_search plus at
       most 3 scrapes by default; perplexity_research only as an optional alternative, it may need paid credit),
       at most 5 sources; ACCEPT or NARROW needs that deep run.
     - A tool that returns 401, 402 or 403: switch to the next allowed tool; never retry the same paid tool.
     - Owner-private content: no external research at any tier. ChatGPT web: never.
  5. Save socrates' reply to a file and run
     `node <am>/critic/record-verdict.mjs <candidate.json> <reply> --store <critic>`. The reply must hold exactly one
     json block, without repeated keys, echoing `candidateId`, `candidateRevision` and `inputFingerprint` from the
     brief. It checks the brief snapshot, validates the verdict, applies the hard-REJECT floor and the loop guard,
     stores the verdict with the candidate and prints `decision`. Exit 1 = invalid: nothing is stored and the
     refusal is logged in the loop-guard log. At most ONE retry, and only when the message says
     `one retry allowed` (a format or limit error such as a too-long field or a missing `inputFingerprint`): ask
     the same socrates run to fix only the JSON, keeping its verdict and its hardReject (if its verdict could not
     be read, the retry may only be REJECT or NEED-MORE-EVIDENCE). Never retry a semantic error
     (`accept_checks_failed`, `research_deep_run_missing`, `hard_reject_floor`, `fingerprint_mismatch` or any
     other `no retry` message), never retry twice, and never re-run brief.mjs to get a fresh socrates run: hold
     the candidate and tell the owner why.
  6. Act on `decision.action`: `promote` (ACCEPT, sentence unchanged: the owner approved that exact sentence at the
     checkpoint) · `show_diff` (NARROW or a rewrite: the text changed, so ask again with the checkpoint frame above,
     the new exact text (the narrowed statement, byte for byte) on its "Đề xuất" line and ITS floor label and topics
     on the "Nhãn an toàn" line when it is not `pass` (`floor` and `floorTopics` from the record-verdict summary);
     only an answer to a real ask block is in the hook log and bound to its text, so a diff shown as plain prose, or a
     block showing the old text, is refused: `owner_message_unbound`) · `hold` (NEED-MORE-EVIDENCE: keep it until `reviewAfter`; REJECT: give
     the reason; this door has no owner override of a REJECT) · `refuse` (hard-REJECT: never promoted, never
     overridden). `ownerReviewRequired: true` means the promoted text is `owner_review_required`: give the owner
     socrates' risk explanation with the label; their Nâng cấp on that question is the acknowledgement. When the
     owner approved the exact text that would be stored, the flow ends with exactly one command, run by root:

         node <am>/standards/promote-standard.mjs --candidate <id> --owner-message <sessionId>:<ISO time of the owner answer>

     Add `--project <main checkout folder>` when the candidate is for one project. It finds the owner answer in the
     hook log (that session, an interactive session, within 5 s; `owner_message_unverified` otherwise, also when the
     hook is not installed; only Nâng cấp approves: Chỉnh or Bỏ qua is `owner_message_not_accept`; an answer older
     than 7 days is `owner_message_stale`; for NARROW the answer must come after the recorded verdict,
     `owner_message_before_verdict`; the answered block must show exactly the text it stores and, unless it is `pass`,
     its label, `owner_message_unbound` otherwise), runs the promote gate on `<critic>` (it stores only the text the
     gate returns: the narrowed one for NARROW; the floor label stored with the verdict is the acknowledgement;
     `owner_message_reused` when that answer already approved another text or candidate), captures the standard into
     KnowledgeMemory (topic `dev-standard/<12 hex of the statement key>`, user scope unless the candidate is for one
     project), promotes it, supersedes the active standard on the same topic, re-exports for the SessionStart hook and
     logs `standard_promoted`. Exit 0 prints what was stored; exit 1 prints `error` (and `step` when it stopped
     after the gate: the store steps are idempotent, so the same command finishes the job once the cause is fixed).
     Report a refusal to the owner in plain words; never work around it.
  7. Loop guard: per candidate 1 critique + 1 rewrite, and the rewrite gets one re-check (critique 2 needs new
     input: a rewrite, research or evidence). A third critique is blocked and logged. A hard-REJECT is final across
     the store: a new candidate id with the same statement (ignoring case, spacing and punctuation) is refused.
  8. Never promote a dev standard any other way: `store-cli.mjs promote` refuses `dev-standard/` records
     (`promote_requires_gate`), and a record promoted any other way (the raw KnowledgeMemory CLI included) is never
     exported to a session (`not_via_door`): only the door's own records, logged as `standard_promoted`, are.
  9. The same statement approved again supersedes the old standard automatically (history is kept). A new standard
     with other wording that replaces an old one: list the old record (id from `recall`) in the candidate's
     `existingStandards` and add `--supersedes <old record id>` to the step 6 command; the new text is stored under
     the old standard's topic and supersedes it (`supersedes_invalid`, before the gate, when the old record is not in
     `existingStandards`, not a standard this door stored, on another scope or project, or no longer active). To
     drop a standard: `retract` with a reason.
  10. `promote-standard` re-exports by itself, and so does the `store-cli.mjs retract` command line, so the next
      session gets the current standards.

## Not a yes-machine

- **Hard-REJECT class.** Socrates must **REJECT** any standard that:
  - loosens verification, security or honest reporting (for example "skip tests when the owner is in a hurry",
    "do not mention failed checks");
  - expands authority (for example "deploy, push or send without asking", "skip review or tests", "approve your own
    PR", "use credentials or permissions you were not given").
  A code floor backs this up in three classes: `hard_reject` (a plain, unconditional loosening such as "Bỏ qua
  test." or "Push without asking."; `record-verdict.mjs` refuses any verdict other than REJECT and the statement is
  blocked store-wide), `pass` (an allowlist: a preference with a style word in every clause, no action on the
  world, no changesWorkflow, touchesSecurity or touchesLaw flag, no protected topic, nothing unreadable) and
  `owner_review_required` (everything else: every procedure, quality gate and pitfall, any rule that is not about
  the form of the output or that acts on the world, and any text touching tests, review, CI, deploy, push, merge,
  release, security, secrets, permission, payment, customer contact, reporting, asking the owner or saying it is an
  AI). Whatever the class, a standard needs the owner's Nâng cấp on the exact text (the gate requires a pointer to
  that answer); the floor decides whether the warning label
  is shown and whether `hard_reject` blocks it. The topics are a warning label, not proof of safety: absence of
  danger words is not evidence of safety.
  Root never promotes a hard-REJECT, even when the owner chose Nâng cấp; tell the owner which policy it would loosen. Those
  policies change only by editing the governing instructions directly. The owner's live instruction in a session
  still governs that session; only storing it as a standard is refused.
- When you report "approved the first time" for work, also report the counter-metric: work approved and later
  reopened or rolled back.

## Store commands (root only, Codex KnowledgeMemory)

Single store: `F:/Ai Tools/Codex/KnowledgeMemory/memory.sqlite3`. Standards learned in a slice worktree go to the
main project (Starizzi id `2a906db6-a103-5375-b672-ad090f686c7e`) or user scope, never to the worktree. A dev
standard is captured, promoted and superseded only by `promote-standard` (step 6). The other commands, through the
wrapper (it runs the Python bundled with Codex isolated and re-exports after a retract):

    node <am>/standards/store-cli.mjs retract <id> --reason "<reason naming the evidence or the new record>"
    node <am>/standards/store-cli.mjs get <id>
    node <am>/standards/store-cli.mjs export

To find same-topic standards for the candidate's `existingStandards`, recall with the raw CLI (read-only; on Windows
set `PYTHONIOENCODING=utf-8` or `projects` fails with UnicodeEncodeError):

    PY="C:/Users/NgNghia213/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
    CLI="C:/Users/NgNghia213/.codex/bin/project-memory.py"
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" recall --project <project-id> --query "<topic>" --limit 3

Never paste conversation text, keys, phone numbers or customer data into a candidate. Tests use `--store` and
`--vault` temp folders, never the live store.
