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
    - Đề xuất: <một câu chuẩn, ≤200 ký tự>
    - Áp dụng cho: <vai trò/agent> · <loại việc> · <dự án này | mọi dự án>
    - Cách kiểm: <điều kiện kiểm được trước khi giao>
    - Bằng chứng: <lúc trước anh sửa/từ chối gì, ≤15 từ> → <sau đó anh duyệt gì>
    - Loại: sở thích | quy trình | cổng chất lượng · Tra cứu: R0 | R1 | R2
    - Nhãn an toàn (chỉ khi nhãn không phải pass): owner_review_required (cần anh xem) · Chủ đề: <topics, hoặc "không có"> · Lý do: <lý do bằng lời thường>
    Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua

The first line is a fixed marker; keep it byte-exact. Write the block as plain lines: the hook counts an ask only when
the header starts a line and the `Trả lời:` line follows; naming the header inside a sentence is not an ask. Scope is
always explicit (role, task type, project or all projects). The check must be something a reviewer can verify before
hand-off. Explain internal codes in plain words.

**Exact text and safety label, before asking.** No standard is ever stored without the owner choosing **Nâng cấp**
on its exact text: the "Đề xuất" line is always the exact final sentence that would be stored, never a paraphrase.
Write the candidate file first (see "Nâng cấp" step 2) and run `node <am>/critic/label.mjs <candidate.json>`: it
prints the code floor's label of exactly that sentence, check, kind and flags (`floor`, `topics`, `reviewReasons`).
When the label is not `pass`, add the "Nhãn an toàn" line next to the exact text with the label, its topics and
one plain-Vietnamese reason per `reviewReasons` entry (for example `kind_not_preference`: "loại quy trình nên luôn
cần anh xem"; `protected_topic`: "đụng tới kiểm thử và phát hành"; `no_style_signal`: "không phải luật về hình thức
câu trả lời (giọng, độ dài, định dạng, ngôn ngữ, bố cục, ví dụ, hình ảnh, đặt tên)"; `acts_on_world`: "có hành động
tác động ra ngoài (giá, chấp nhận thay anh, chép vào file, thanh toán, gửi hoặc đăng, xoá, chạy hoặc cài, đổi cấu hình,
tự làm)"). Only a preference about the form of the output (a style word in the sentence) with no action on the
world, no protected topic and no review flag is `pass`; every procedure, quality gate and pitfall is
`owner_review_required`. The floor only decides whether that warning line is shown and whether `hard_reject` blocks
the sentence outright. If the label is `hard_reject`, do not ask: that sentence can never become a standard; tell the
owner which policy it would loosen. The owner choosing **Nâng cấp** on a question that showed the exact text (and the
label, when there is one) IS the approval and the acknowledgement; there is no second approval. Note where the owner
answered (session id, and the message uuid or time) for `ownerApproval.ownerMessage` in step 6: the gate needs it for
every standard, `pass` included.

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
  1. **Root only** captures the candidate (commands below). A subagent never writes the store; it returns the
     proposal (claim, scope, check, evidence, source = session id + time) to root.
  2. Root writes the candidate file (schema in `<am>/critic/README.md`, examples in `<am>/critic/dry-runs/`): id,
     the approved sentence, kind, scope, check, evidence ids oldest first with where each is recorded, flags
     (`ownerPrivate` for shop or customer content), and same-topic standards from `recall`. `<am>` is
     `tools/agent-maturity` in the Starizzi checkout; the installed runtime does not copy `critic/` yet.
  3. `node <am>/critic/brief.mjs <candidate.json> --store <dir>` picks the research tier, checks the loop guard and
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
     `node <am>/critic/record-verdict.mjs <candidate.json> <reply> --store <dir>`. The reply must hold exactly one
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
     checkpoint) · `show_diff` (NARROW or a rewrite: the text changed, so show the owner the new exact text, with ITS
     floor label and topics when it is not `pass` (`floor` and `floorTopics` from the record-verdict summary), and
     promote only after the owner's OK on that text) · `hold` (NEED-MORE-EVIDENCE: keep it until `reviewAfter`; REJECT: give the reason) · `refuse`
     (hard-REJECT: never promoted). `ownerReviewRequired: true` means the promoted text is `owner_review_required`:
     the gate needs the owner's acknowledgement of its label, and a socrates ACCEPT alone never promotes it; also give
     the owner socrates' risk explanation. The owner may override a plain REJECT only by explicit approval of the
     exact text; a hard-REJECT can never be overridden. Every promote goes through
     `assertPromotable({ adapter, candidateId, ownerApproval })` in `<am>/critic/promote-gate.mjs`, which loads the
     stored candidate, its last verdict and the hard-REJECT index itself. `ownerApproval` is
     `{ approved: true, statement: '<exact text>', ownerMessage: { sessionId, uuid or ts } }` for EVERY standard,
     `pass` included (`ownerMessage` points to the owner's Nâng cấp on that exact text, or OK to the diff; never the
     message text; `owner_message_missing` otherwise); for `owner_review_required` text also add `floorClass` and
     `topics` (the label the owner was shown next to that exact text; the gate checks they equal the stored floor);
     add `overrideReject: true` to override a plain REJECT. Promote only the statement it
     returns (slice D3 wires this into `promote`).
  7. Loop guard: per candidate 1 critique + 1 rewrite, and the rewrite gets one re-check (critique 2 needs new
     input: a rewrite, research or evidence). A third critique is blocked and logged. A hard-REJECT is final across
     the store: a new candidate id with the same statement (ignoring case, spacing and punctuation) is refused.
  8. Until slice D3 plugs in the KnowledgeMemory adapter, `--store` is a temp folder (for example
     `F:/Ai Tools/Codex/Temp/agent-maturity-critic/`), never `~/.claude`.
  9. A new standard that contradicts an old one: capture and promote the new one, then `supersede` the old one
     (history is kept). To drop a standard: `retract` with a reason.
  10. After every promote, supersede or retract, re-export the active standards for later sessions (slice D3;
      until D3 exists, say so in the report).

## Not a yes-machine

- **Hard-REJECT class.** Socrates must **REJECT** any standard that:
  - loosens verification, security or honest reporting (for example "skip tests when the owner is in a hurry",
    "do not mention failed checks");
  - expands authority (for example "deploy, push or send without asking", "skip review or tests", "approve your own
    PR", "use credentials or permissions you were not given").
  A code floor backs this up in three classes: `hard_reject` (a plain, unconditional loosening such as "Bỏ qua
  test." or "Push without asking."; `record-verdict.mjs` refuses any verdict other than REJECT and the statement is
  blocked store-wide), `pass` (an allowlist: a preference with a style word in the sentence, no action on the
  world, no changesWorkflow, touchesSecurity or touchesLaw flag, no protected topic, nothing unreadable) and
  `owner_review_required` (everything else: every procedure, quality gate and pitfall, any rule that is not about
  the form of the output or that acts on the world, and any text touching tests, review, CI, deploy, push, merge,
  release, security, secrets, permission, payment, customer contact, reporting or asking the owner). Whatever the
  class, only the owner's Nâng cấp on the exact text promotes a standard; the floor decides whether the warning label
  is shown and whether `hard_reject` blocks it. The topics are a warning label, not proof of safety: absence of
  danger words is not evidence of safety.
  Root never promotes a hard-REJECT, even when the owner chose Nâng cấp; tell the owner which policy it would loosen. Those
  policies change only by editing the governing instructions directly. The owner's live instruction in a session
  still governs that session; only storing it as a standard is refused.
- When you report "approved the first time" for work, also report the counter-metric: work approved and later
  reopened or rolled back.

## Store commands (root only, Codex KnowledgeMemory)

Single store: `F:/Ai Tools/Codex/KnowledgeMemory/memory.sqlite3`. Use the Python bundled with Codex; on Windows set
`PYTHONIOENCODING=utf-8` or `projects` fails with UnicodeEncodeError. Standards learned in a slice worktree go to the
main project (Starizzi id `2a906db6-a103-5375-b672-ad090f686c7e`) or user scope, never to the worktree.

    PY="C:/Users/NgNghia213/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
    CLI="C:/Users/NgNghia213/.codex/bin/project-memory.py"
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" capture --file <payload.json>      # returns a candidate id
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" promote <id> --basis user_instruction
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" supersede <old-id> <new-id> --reason "<evidence-backed reason>"
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" retract <id> --reason "<reason>"
    PYTHONIOENCODING=utf-8 "$PY" "$CLI" recall --project <project-id> --query "<topic>" --limit 3

Payload (write it to a temp file outside the repo, e.g. `F:/Ai Tools/Codex/Temp/`):

    {"scope": "project", "project_id": "<id>", "agent": "<role>", "kind": "procedure",
     "topic_key": "<stable-topic>", "title": "<short title>",
     "summary": "<standard sentence>. Applies to: <scope>. Check: <check>.",
     "source": {"type": "user", "uri": "claude-user://<session-id>/<message-timestamp>"},
     "author": "root", "evidence": "direct", "confidence": 0.9, "sensitivity": "local"}

`kind`: preference (sở thích), procedure (quy trình, cổng chất lượng), pitfall (a trap to avoid). `scope`: project,
role or user. The source points to the owner's message by session id and time; never paste conversation text,
keys, phone numbers or customer data into the payload. Tests use `--store` and `--vault` temp folders before the
subcommand, never the live store.
