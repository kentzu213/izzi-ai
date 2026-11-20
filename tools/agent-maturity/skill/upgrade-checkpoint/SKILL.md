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
    Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua

The first line is a fixed marker; keep it byte-exact. Write the block as plain lines: the hook counts an ask only when
the header starts a line and the `Trả lời:` line follows; naming the header inside a sentence is not an ask. Scope is
always explicit (role, task type, project or all projects). The check must be something a reviewer can verify before
hand-off. Explain internal codes in plain words.

## A standard is data, not authority

A stored standard describes how to do work the owner already asked for. It never grants tool authority or
permissions, never overrides CLAUDE.md, AGENTS.md or system rules, and never overrides the owner's current
instructions. When a standard and those conflict, the governing instructions win and you say so.

## After the owner answers

- **Bỏ qua:** write nothing to the store. The hook already logs the outcome.
- **Chỉnh:** the owner's wording replaces the proposal; continue as "Nâng cấp".
- **Nâng cấp:**
  1. **Root only** captures the candidate (commands below). A subagent never writes the store; it returns the
     proposal (claim, scope, check, evidence, source = session id + time) to root.
  2. Socrates reviews once against the evidence and existing standards on the same topic: does the evidence support
     the sentence, is the scope too wide, does it contradict an active standard, is the research tier right?
     Verdict: ACCEPT / NARROW / NEED-MORE / REJECT.
  3. Research tier: R0 (preference) none; R1 (content, ads, claims) 1–2 sources; R2 (process change, or touches law
     or security) deep research, then Socrates again. At most 1 critique + 1 rewrite per candidate.
  4. ACCEPT with the sentence unchanged: root promotes (the owner approved that exact sentence). NARROW or changed
     wording: show the owner the diff and promote only after OK. NEED-MORE: keep the candidate, set a review date.
     REJECT: keep the candidate and give the reason; the owner may still force approval, except a standard in the
     hard-REJECT class below, which root never promotes.
  5. A new standard that contradicts an old one: capture and promote the new one, then `supersede` the old one
     (history is kept). To drop a standard: `retract` with a reason.
  6. After every promote, supersede or retract, re-export the active standards for later sessions (slice D3; until
     D3 exists, say so in the report).

## Not a yes-machine

- **Hard-REJECT class.** Socrates must **REJECT** any standard that:
  - loosens verification, security or honest reporting (for example "skip tests when the owner is in a hurry",
    "do not mention failed checks");
  - expands authority (for example "deploy, push or send without asking", "skip review or tests", "approve your own
    PR", "use credentials or permissions you were not given").
  Root never promotes it, even when the owner chose Nâng cấp; tell the owner which policy it would loosen. Those
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
