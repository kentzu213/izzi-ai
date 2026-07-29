# Wave dispatch — W1 … W4 (Option A: keep the 5-window design)

Issued by W0 at integration ref `feature/personal-office-baseline-20260728`, tip `aa96a8f`.

Each window already holds the Common Session Constitution and its Loop Card. This dispatch adds
only what changed since those were written, plus the gate that applies to that window right now.

**State at dispatch**

| Loop | Window | Status | Worktree |
| --- | --- | --- | --- |
| 00 | W0 | ACCEPTED | exists |
| 01 | W1 | PROVISIONAL — 3 of 4 conditions met, one left | exists, rebased onto `0cbf888` |
| 02 | W2 | blocked on Loop 01 | **none — must not be created yet** |
| 03 | W3 | blocked on Loop 01 | **none — must not be created yet** |
| 04 | W4 | blocked on Loop 01 **and** Loop 03 | **none — must not be created yet** |

Open gates: `PO-RUNSTATE-CONTRACT-GAP` (CRITICAL), `PO-VERSION-COLLISION` (HIGH), `PQ-01` (HIGH),
`PO-LOOP04-DEPENDENCY` (LOW). Resolved/handled: `PQ-08` RULED, `PO-VAULT-OWNERSHIP` RESOLVED,
`QUARANTINE-DRIFT` MITIGATED, `BF-01` accepted limitation.

---

## W1 — one item left on Loop 01

```text
Áp dụng Common Session Constitution + Loop 01 Card. Bạn là W1.

TÔI ĐÃ VERIFY: bạn hoàn thành 3/4 điều kiện. Không làm lại.
- MAP-ARCHIVED: ĐÃ ÁP (mapping có legacy_archived_outcome_unknown, archived → canceled).
- Lineage + canonicalJson: ĐÃ HẤP THU (entities.ts có lineage, canonical.ts + test tồn tại).
- Handoff: ĐÃ SUBMIT (docs/handoffs/personal-office/loop-01.json).

CÒN MỘT VIỆC — bạn chưa biết về nó vì nó phát sinh sau khi bạn base.
Branch bạn đang ở base trên 0cbf888. Gate mới nằm ở aa96a8f.

BƯỚC 1 — re-sync để lấy gate mới
  cd "F:\Ai Tools\_wt-starizzi-personal-office-loop01"
  git status --porcelain          # commit phần worklog đang dở trước
  git rebase feature/personal-office-baseline-20260728
Sau rebase, đọc:
- docs/handoffs/personal-office/integration-ledger.json → programmeGates → PO-RUNSTATE-CONTRACT-GAP
- docs/handoffs/personal-office/planning/loops-01-04-provisional-plan.md §1

BƯỚC 2 — CONTRACT CHANGE REQUEST từ W0: thêm waiting_external
Roadmap Loop 03 §4 quy định state machine TỐI THIỂU gồm waiting_external.
RunState của bạn hiện là: created, queued, running, awaiting_approval, paused,
completed, failed, canceled — KHÔNG có waiting_external.

Mapping §3.4 của bạn từ chối nó: "Do not add a new top-level state on evidence this thin."
Lập luận đó đúng với câu hỏi migration. Nhưng đây là yêu cầu sản phẩm, và có hai
bằng chứng chưa được cân:
1. Roadmap gọi đó là "tối thiểu" — sàn, không phải menu. Acceptance Loop 03 đo theo nó.
2. Loop 02 §3 buộc Today phải có 3 lane riêng: Active work / Waiting for me / Delivered.
   Một run bị chặn bởi integration hoặc runtime KHÔNG thuộc lane nào. Theo contract
   hiện tại nó là paused + pausedReason OPTIONAL. Không dựng được một lane sản phẩm
   luôn-hiển-thị trên field optional: writer nào quên set thì run bị xếp sai lane
   trong im lặng, và state machine không enforce transition trên field nó không mô hình hoá.

Hệ quả: Loop 03 KHÔNG THỂ đạt acceptance criteria của chính nó khi import contract này.

YÊU CẦU:
- Thêm waiting_external là RunState first-class.
- Transition: running → waiting_external; waiting_external → running | canceled (đối xứng paused).
- Giữ pausedReason cho các nguyên nhân thật sự reason-shaped: 'stuck', 'guardrail'.
- GIỮ NGUYÊN 4 identifier còn lại. Roadmap mô tả semantics, bạn chọn identifier và có
  bằng chứng: §3.3 bác đổi awaiting_approval → waiting_user là đúng; completed/canceled
  khớp US spelling của codebase; §3.7 đã lập luận draft là WORKSPACE state.
  Tôi KHÔNG yêu cầu đổi tên gì.
- Nếu bạn phản đối: được, nhưng phải trả lời trực diện lập luận lane "Waiting for me"
  ở trên, không chỉ nêu lại evidence migration.

BƯỚC 3 — verify và submit
- Cập nhật state-machine.test.ts: transition hợp lệ + invalid-transition cho state mới.
- PERSONAL_OFFICE_SCHEMA_VERSION vẫn là authority duy nhất. Đây là breaking change trên
  contract CHƯA SHIP nên chi phí chỉ là version note, không phải migration — xem gate
  PO-VERSION-COLLISION. Phải xử lý TRƯỚC khi Loop 03 persist bất cứ gì.
- Cập nhật loop-01.json: contractChanges ghi rõ breaking + consumer list (Loop 03, Loop 02, Loop 12).
- Build + test + git diff --check. Lint KHÔNG chạy được ở canonical (BF-03/BF-04) — đừng claim pass.
- Commit exact owned paths. Báo commit SHA cho W0.

KHÔNG: không sửa UI, DB, preload, agent runtime. Không ghi vào quarantine worktree.
```

---

## W2 — provisional only, no worktree yet

```text
Áp dụng Common Session Constitution + Loop 02 Card. Bạn là W2.

GATE: Loop 01 CHƯA ACCEPTED → bạn KHÔNG có worktree và KHÔNG được implement.
Chỉ W0 tạo worktree, và chỉ sau khi Loop 01 ACCEPTED. Đừng tự tạo.

ĐƯỢC LÀM NGAY (PROVISIONAL RULE): read/search, route map, component map,
interaction-state checklist, test plan, accessibility checklist, UX map.
KHÔNG ĐƯỢC: sửa source, App.tsx, Sidebar.tsx, navigation, store, CSS.

TIN QUAN TRỌNG: shell của bạn ĐÃ TỒN TẠI dưới dạng draft chưa commit trong quarantine.
19 file, ~106 KB — lớn hơn ước tính PQ-08 khoảng 4 lần. Đã có: PersonalOfficeShell,
ShellNav (5 route), TodayPage, WorkspacesPage, WorkspaceHome, WorkLane, CommandPalette,
DelegateComposer, SurfaceState (loading/empty/error/offline), featureFlags (có rollback),
workAdapter, useWorkSnapshot, MyGraphRoute, legacySurfaces.

ĐỌC (read-only, KHÔNG apply):
- docs/handoffs/personal-office/quarantine/loop-02-dirty-salvage.json — inventory + hash + verdict từng file
- docs/handoffs/personal-office/planning/loops-01-04-provisional-plan.md §3, §5
- Snapshot content: F:\Ai Tools\_po-quarantine-snapshot-20260728\untracked
  (bytes đã được W0 bảo toàn ngoài repo; quarantine worktree là READ-ONLY)

KHI ĐƯỢC MỞ KHOÁ, việc của bạn là salvage có chọn lọc, không cherry-pick mù:
- Retarget workAdapter.ts, types.ts, useWorkSnapshot.ts từ main/agent/types.ts sang shared/personal-office/.
- Bỏ ApprovalRequest local — dùng Approval của W1 + work-approvals.ts của W3.
- Xin W0 lease cho App.tsx và Sidebar.tsx. Draft cũ đã sửa App.tsx KHÔNG có lease; đừng lặp lại.
- Viết lại §0 của docs/product/personal-office-ia.md — nó đang ghi giả định "chưa có contract",
  giả định đó hết hiệu lực.
- MyGraphRoute: bạn sở hữu route shell, Loop 04 sở hữu phần bên trong. Không restyle graph.

RANH GIỚI ĐÃ CHỐT: vault-ops / vault-types / wikilink KHÔNG phải của bạn — đã assign Loop 04.

VERIFY BẮT BUỘC khi implement: 1440x900, 1024x768, 390x844; keyboard/focus;
text zoom 200%; reduced motion; touch target >= 44x44; empty/loading/error/offline/degraded
trên MỌI primary surface. CommandPalette cần chú ý focus-trap. Demo state phải ghi rõ là demo.

VIỆC NÊN LÀM BÂY GIỜ: dựng route/component/interaction-state map + accessibility test plan
dựa trên inventory salvage. Loop 02 Card §11 yêu cầu viết mấy map này TRƯỚC khi implement —
làm luôn bây giờ là hợp lệ và tiết kiệm thời gian sau.
```

---

## W3 — provisional only, and one gate must land first

```text
Áp dụng Common Session Constitution + Loop 03 Card. Bạn là W3.

GATE: Loop 01 CHƯA ACCEPTED → chưa có worktree, chưa implement. Đừng tự tạo.

CẢNH BÁO RIÊNG CHO BẠN — đọc trước khi lập kế hoạch:
Loop 03 §4 buộc state machine tối thiểu phải có waiting_external. Contract Loop 01 hiện
KHÔNG có state đó. Nếu bạn implement trên contract hiện tại, bạn sẽ KHÔNG đạt acceptance
criteria của chính mình, hoặc buộc phải fork state machine — đúng thứ PQ-08 tồn tại để ngăn.
W0 đã gửi contract change request cho W1. Đừng bắt đầu trước khi nó land.
Gate: PO-RUNSTATE-CONTRACT-GAP.

VIỆC THỨ HAI phải xử lý trước khi persist bất cứ gì — gate PO-VERSION-COLLISION:
Cả hai contract đang khai version 1 cho shape khác nhau (PERSONAL_OFFICE_SCHEMA_VERSION
của W1 và WORK_SCHEMA_VERSION của draft). Row nào tag 1 cũng nhập nhằng. Chi phí sửa
HÔM NAY = 0 vì chưa ship. Nếu để build mang draft chạm DB thật trước thì thành forensics.
=> Bỏ WORK_SCHEMA_VERSION, import PERSONAL_OFFICE_SCHEMA_VERSION. Thêm test: envelope
của engine pass guard của W1, và version lạ bị REJECT chứ không bị coerce.

TIN TỐT: execution core của bạn đã tồn tại. 13 module, ~160 KB, kèm 5 file test:
work-service (31 KB), run-repository (38 KB), work-adapters, work-migration, work-ipc,
work-approvals, work-hash, work-backup, work-sqlite, test-support.

ĐỌC (read-only):
- docs/handoffs/personal-office/quarantine/loop-03-dirty-salvage.json — verdict từng file
- docs/handoffs/personal-office/acceptance/loop-00.json → pq08Ruling, mappingRulings, versionImpact
- docs/handoffs/personal-office/planning/loops-01-04-provisional-plan.md §1, §3, §5
- Snapshot: F:\Ai Tools\_po-quarantine-snapshot-20260728

PQ-08 ĐÃ PHÁN QUYẾT — mô hình hai lớp:
- shared/personal-office/** của W1 = contract of record. Bạn IMPORT, không định nghĩa lại.
- main/work/** = của bạn, adopt toàn bộ.
- shared/work-model.ts = SUPERSEDED as contract. Không land nó như contract thứ hai.
  Nội dung giá trị (lineage, canonicalJson, action-hash) đã được W1 hấp thu.

HAI MAPPING ĐÃ CHỐT — implement trong work-adapters.ts kèm test W1 đã đặc tả:
- MAP-BLOCKED: blocked → paused, TUYỆT ĐỐI không failed. pausedReason là additive.
- MAP-ARCHIVED (W0 đã sửa đề xuất của W1): derive terminal từ agent_run_entries khi kết luận
  được; khi không → canceled + canceledReason='legacy_archived_outcome_unknown', KHÔNG default
  sang completed. Luôn set archivedAt, giữ legacyStatusRaw. Lý do: default completed là bịa
  THÀNH CÔNG — nói với operator rằng việc đã xong khi có thể chưa bao giờ hoàn tất.

LEASE: xin W0 lease cho database.ts, index.ts, preload.ts. KHÔNG lấy App.tsx — Loop 02 là
owner đầu tiên, dù draft cũ đã sửa nó.

BẮT BUỘC KHÁC:
- Sửa migration fail-open: hiện log-rồi-đi-tiếp, chỉ hợp lệ khi v1 thuần additive.
- work-sqlite.ts phải unit-test được KHÔNG cần native binding thật (BF-01: máy không có MSVC).
- Migration idempotent — test chạy hai lần là bắt buộc. Kèm backup/recovery note.
- Event: append-only, monotonic seq, idempotency key, typed payload version, redaction.
  Tiền lệ có sẵn: offline_queue dùng seq AUTOINCREMENT + base_updated_at. Dùng lại, đừng phát minh.
- Không thực thi external side effect thật trong test.

VIỆC NÊN LÀM BÂY GIỜ: migration plan + test plan cho 10 test bắt buộc trong Card.
```

---

## W4 — provisional only, gated on two loops

```text
Áp dụng Common Session Constitution + Loop 04 Card. Bạn là W4.

GATE: Loop 04 phụ thuộc Loop 01 VÀ Loop 03. Card của bạn chỉ ghi Loop 01 — chưa đủ.
PHẢI ĐỌC của Loop 04 gồm "unified work model Loop 03", nên cạnh thật là 01 → 03 → 04.
Bạn KHÔNG phải sibling song song tự do. Gate: PO-LOOP04-DEPENDENCY.
Chưa có worktree. Đừng tự tạo.

OWNERSHIP MỚI — W0 vừa chốt cho bạn:
vault-ops.ts, vault-types.ts, wikilink.ts và renderer/components/vault/* là INPUT CỦA BẠN,
không phải salvage của Loop 02. Trước đó chúng bị treo HOLD_PENDING_OWNERSHIP; nay resolved
về Loop 04 vì PHẢI ĐỌC của Card bạn gọi tên chúng trực tiếp. Gate PO-VAULT-OWNERSHIP đã đóng.
Bản draft chưa commit của mấy file này nằm trong snapshot:
F:\Ai Tools\_po-quarantine-snapshot-20260728\untracked (kèm hash trong
docs/handoffs/personal-office/quarantine/loop-02-dirty-salvage.json → vaultAndWiki).

ĐƯỢC LÀM NGAY: Live Profile section schema, precedence test plan, no-secret validator design,
conflict/offline flow design, graph fact/edge mapping proposal, threat model.
KHÔNG ĐƯỢC: sửa graph store/pages, work schema, agent runtime, hay bất cứ source nào.

RANH GIỚI ĐÃ VẠCH (plan §3) — đọc kỹ, đây là chỗ dễ đụng nhau nhất:
- Context snapshot: Loop 03 sở hữu ENVELOPE (identity, version, run ownership, immutability)
  và lưu content dạng opaque. BẠN sở hữu CONTENT MODEL (sections, facts, provenance, scope,
  expiry). Loop 05 sở hữu compilation + injection.
  => Bạn không tự phát minh storage; Loop 03 không parse content của bạn.
- Card bạn đã tự ghi: "Không inject Live.md trực tiếp vào model call; việc đó thuộc Loop 05."
- Graph: Loop 02 sở hữu route shell (MyGraphRoute), bạn sở hữu phần bên trong.

RÀNG BUỘC BẢO MẬT LÀ HARD GATE, không phải warning:
Live.md TUYỆT ĐỐI không chứa API key / OAuth token / password. Chỉ opaque reference +
connection status. Export phải sạch secret. no-secret validator là gate chặn.

NGUYÊN TẮC SẢN PHẨM phải test được, không chỉ viết prose:
- Precedence: safety/system > current user request > workspace policy > global Live.md >
  learned preference > model default.
- AI chỉ tạo Preference Proposal. Không ghi durable preference nào mà không có accept/edit/reject.
- Học bền vững từ email/browser/chat/file: opt-in THEO TỪNG loại nguồn, mặc định chỉ proposal.
- Markdown round-trip phải lossless trong khi sections vẫn project thành graph facts có provenance.
- Non-regression: wiki/daily notes hiện có không được vỡ.

VIỆC NÊN LÀM BÂY GIỜ: section schema + precedence test matrix + no-secret validator spec.
```

---

## W0's own next actions

1. Await W1's `waiting_external` change, then run the §11 integration gate on Loop 01.
2. On Loop 01 ACCEPTED: create the Loop 02 and Loop 03 worktrees from integration HEAD, grant the
   queued leases, and update the ledger. Loop 04's worktree waits for Loop 03.
3. Still open and unowned: `PQ-01` — grant the package-manifest lease to exactly one loop, port
   `eslint.config.mjs`, then re-measure the warning ceiling on canonical rather than adopting 359.
4. `QUARANTINE-DRIFT` remains mitigated, not closed — the concurrent writer is still outside W0
   control and can still overwrite files the snapshot captured.
