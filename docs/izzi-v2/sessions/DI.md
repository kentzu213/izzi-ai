# [DI] Nối D3 (kho chuẩn) với D4 (cổng phản biện)

Đọc trước: `sessions/README.md` (luật chung); `tools/agent-maturity/critic/README.md`; `tools/agent-maturity/standards/README.md`; `tools/agent-maturity/skill/upgrade-checkpoint/SKILL.md`; `PLAN.md` §2.4–2.5.

**Worktree:** `F:\Ai Tools\_wt-izzi-v2-di` · **Nhánh:** `izzi-v2/di-d3-d4-wiring` (từ nhánh epic sau khi đã merge D3 + D4).

## Mục tiêu

Một chuẩn chỉ vào kho KnowledgeMemory qua **một cửa duy nhất**, và cửa đó luôn đi qua cổng D4. Gọi `promote` thẳng vào kho để lưu chuẩn dev mà không qua cửa này thì phải bị từ chối.

## Thiết kế đã chốt (root, 21/11)

- **Hai kho, hai việc.**
  - *Sổ phản biện* (`critic/json-adapter.mjs`, mặc định `~/.claude/agent-maturity/critic/`) giữ ứng viên, brief, verdict, các lần anh duyệt (`promotion_approved`). Không viết adapter KnowledgeMemory cho D4.
  - *KnowledgeMemory* chỉ giữ chuẩn đã được duyệt cuối cùng.
- **Cửa duy nhất** là `standards/promote-standard.mjs` (CLI + hàm), nhận `--candidate <id> --owner-message <sessionId>:<uuid|ts>`, làm đúng thứ tự:
  1. `assertPromotable({ adapter: sổ phản biện, candidateId, ownerApproval })`. Lấy câu cần lưu từ cổng: câu thu hẹp nếu verdict là NARROW, không bao giờ lấy từ tham số.
  2. **Đối chiếu tin nhắn duyệt với log của hook D1**: phải có sự kiện trả lời checkpoint của đúng phiên đó, chỉ outcome `accept` (Nâng cấp) mới là duyệt (`edit`/Chỉnh nghĩa là anh đổi câu nên bị từ chối với mã `owner_message_not_accept`, phải hỏi lại với câu mới), lệch thời điểm tối đa ±5 giây, không quá 7 ngày (`owner_message_stale`), với NARROW phải sau verdict (`owner_message_before_verdict`), và chưa từng dùng cho câu hoặc ứng viên khác. Không có log hoặc không khớp thì từ chối với mã `owner_message_unverified` (fail closed). Trước D2 hook chưa cài nên chưa lưu được chuẩn nào; đây là điều đúng.
  3. `capture` vào KnowledgeMemory: topic `dev-standard/<statementKey ngắn>`, nguồn `userSource(sessionId, ts)`, phạm vi theo ứng viên (mặc định `user`), kèm id ứng viên và id verdict.
  4. `promote(id, 'user_instruction')`.
  5. Nếu có chuẩn cũ cùng chủ đề đang dùng: `supersede` có lý do.
  6. `exportActive` để khối chèn cập nhật ngay.
  7. Ghi sự kiện `standard_promoted` vào sổ phản biện.
  Bước nào lỗi thì dừng và báo rõ, không để kho ở trạng thái lửng.
- **Khoá cửa sau.** `store-cli.mjs` `promote` từ chối mọi bản ghi topic `dev-standard/` nếu không được gọi từ `promote-standard` (token nội bộ do module cấp, test được), mã lỗi `promote_requires_gate`. Bản ghi không thuộc `dev-standard/` giữ nguyên hành vi.
- **Cài đặt.** `install.mjs` chép thêm `critic/*.mjs` (trừ test-corpus, dry-runs) và `standards/promote-standard.mjs`, `standards/store-cli.mjs`, `standards/refresh.mjs` vào `~/.claude/agent-maturity/bin/`. SKILL.md trỏ tới đường dẫn đã cài, kèm phương án dự phòng là đường dẫn repo.
- **SKILL.md:** quy trình sau "Nâng cấp" kết thúc bằng đúng một lệnh `promote-standard`.

## Được sửa

`tools/agent-maturity/standards/**`, `tools/agent-maturity/critic/**` (chỉ khi cần cho việc nối, giữ mọi bảo đảm cũ), `install.mjs`, `uninstall.mjs`, `skill/upgrade-checkpoint/SKILL.md`, `tools/agent-maturity/README.md`, test mới `test/di-*.test.mjs` và test cài đặt.

## Xong khi

- Test đầu-cuối trên kho tạm (`--store` và `--vault` tạm, sổ phản biện tạm, log hook tạm):
  1. ứng viên → brief → verdict ACCEPT → anh duyệt (log hook có `accept`) → `promote-standard` → chuẩn có trong export và trong khối chèn SessionStart;
  2. NARROW thì lưu câu thu hẹp;
  3. không có log hook, sai phiên, lệch thời điểm >5 giây, hoặc dùng lại tin nhắn → từ chối;
  4. `hard_reject` hoặc REJECT → từ chối;
  5. gọi `promote` thẳng vào `dev-standard/` → `promote_requires_gate`;
  6. chuẩn cùng chủ đề → supersede, export chỉ còn chuẩn mới.
- `npm run test:agent-maturity` xanh. `npx --no-install eslint tools/agent-maturity` exit 0 (chạy `pnpm install --frozen-lockfile --prefer-offline` trong worktree trước).
- Kho thật, vault thật, sổ phản biện thật, `settings.json` thật không đổi.
- Review độc lập không còn lỗi HIGH/MEDIUM. CI của PR xanh.
