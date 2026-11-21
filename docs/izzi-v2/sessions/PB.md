# [PB] Cầu chì ngân sách cho bộ chắt lọc hồ sơ agent trong app izzi

Đọc trước:
- `sessions/README.md` (luật chung)
- `PLAN.md` §1.2 (đã cập nhật ngày 21/11: **trần chi tiêu tháng tắt**) và dòng PB ở §3.3
- `docs/MYGRAPH-AGENT-MEMORY.md` §4 (thiết kế S2 hiện tại)
- `CLAUDE.md` của repo (luật GitNexus: chạy impact trước khi sửa symbol)

**Worktree:** `F:\Ai Tools\_wt-izzi-v2-pb` · **Nhánh:** `izzi-v2/pb-budget-fuses`

## Mục tiêu

Anh đã chốt bỏ trần gọi model cố định. Bộ chắt lọc hồ sơ agent hiện cho tối đa 3 lượt và 6 lần gọi mỗi ngày. Sau slice này nó **chỉ gọi khi có việc thật**, và được bảo vệ bằng cầu chì.

## Được sửa

- `apps/desktop/src/main/agents/memory/**`: chủ yếu `agent-profile-store.ts`, `agent-profile-service.ts` và test của hai file này.
- Câu chữ về giới hạn trong ngày ở `apps/desktop/src/renderer/components/AgentProfilesSection*` hoặc `renderer/pages/agent-profiles-flow*`, nếu đang hiển thị giới hạn đó.
- **Không** đụng `customer-marketing/**`, MyGraph publisher hay luật ghi MyGraph. Luật ghi MyGraph giữ nguyên: chỉ ghi khi fingerprint đổi, ≤1 lần/ngày.

## Việc cần làm (TDD bằng vitest)

1. Bỏ `AGENT_PROFILES_MAX_RUNS_PER_DAY = 3` và `AGENT_PROFILES_MAX_CALLS_PER_DAY = 6`.
2. Không có hoạt động mới thì gọi model **0 lần**. Cùng một đầu vào không bao giờ trả tiền hai lần (giữ luật S2).
3. Gặp **402** thì dừng ngay, không gọi model dự phòng, và báo rõ cho anh.
4. Mỗi lần gọi hết hạn sau **90 giây**. Mỗi lúc chỉ chạy **một lượt**.
5. **Bộ phát hiện vòng lặp**, chỉ áp cho lần gọi nền:
   - cùng fingerprint đầu vào bị gọi lại, hoặc N lần gọi liền không có hoạt động mới, thì tạm dừng và hiện nút "Tiếp tục";
   - lần anh tự bấm "Cập nhật hồ sơ ngay" **không bao giờ bị chặn**.
6. **Không có trần tháng** (anh đã chốt tắt).

## Kiểm chứng

- Trong worktree: `pnpm install --frozen-lockfile`, rồi chạy
  - `pnpm -C apps/desktop exec vitest run src/main/agents/memory`;
  - typecheck và lint của desktop (xem script trong `apps/desktop/package.json`).
- GitNexus: worktree này chưa được index. Chạy `impact` theo tên symbol: index của repo `starizzi-app` vẫn có các symbol cũ. Ghi blast radius vào PR. Nếu impact báo HIGH hoặc CRITICAL thì dừng và hỏi anh.

## Xong khi

- Có test cho từng điều ở mục 1–6.
- Mọi test vitest của `agents/memory` xanh; typecheck và lint sạch.
- Reviewer không còn lỗi HIGH hoặc MEDIUM.
- Đã mở PR.
- **Không phát hành.** Phát hành bản desktop cần anh OK riêng.
