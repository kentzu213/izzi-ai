# Phiên song song của izzi 2.0 agent maturity

Mỗi file trong thư mục này là brief cho **một phiên Claude Code riêng**. Mỗi phiên làm một slice, trên nhánh và worktree của chính slice đó. Phiên root (phiên điều phối) giữ `PLAN.md` và `TRACKER.md`, rồi nghiệm thu từng PR.

## Cách mở một phiên (anh làm)

1. Trong app Claude, mở **phiên mới**. Chọn thư mục là worktree của slice (bảng dưới).
2. Dán câu đầu tiên: `[<ID>] Đọc docs/izzi-v2/sessions/<ID>.md và làm đúng theo đó.`
3. Khi phiên báo đã mở PR, quay lại phiên root và nhắn "PR <ID> xong" để root kiểm lại và cập nhật TRACKER.

| ID | Worktree (thư mục) | Nhánh | Brief |
|---|---|---|---|
| D3 | `F:\Ai Tools\_wt-izzi-v2-d3` | `izzi-v2/d3-standards-store` | `D3.md` |
| D4 | `F:\Ai Tools\_wt-izzi-v2-d4` | `izzi-v2/d4-critic-research` | `D4.md` |
| D5 | `F:\Ai Tools\_wt-izzi-v2-d5` | `izzi-v2/d5-metrics` | `D5.md` |
| PB | `F:\Ai Tools\_wt-izzi-v2-pb` | `izzi-v2/pb-budget-fuses` | `PB.md` |

Ngày 21/11 tài khoản đã chạm giới hạn dùng tuần. Bốn phiên cùng chạy sẽ tiêu nhanh gấp bốn. Nếu cần tiết kiệm, mở D3 và PB trước.

## Luật chung cho mọi phiên

- **Chỉ làm trong worktree của mình.** Không đụng checkout chính `F:\Ai Tools\Tool Starizzi - B2C - Openclaw` (có việc dở của phiên khác) và không đụng worktree của slice khác.
- **Chỉ sửa các file ở mục "Được sửa" trong brief.** Không sửa `PLAN.md`, `TRACKER.md` hay `package.json`: script `test:agent-maturity` đã tự quét `tools/agent-maturity/test/*.test.mjs`, nên test mới chỉ cần đặt đúng thư mục.
- **Không đổi `~/.claude` thật**, gồm `settings.json`, `skills/` và `agent-maturity/`. Test dùng thư mục tạm. Mọi bộ test cài đặt phải assert sha256 của `settings.json` không đổi.
- Code không gọi mạng. Không thêm dependency.
- Viết theo TDD: viết test trước, thấy đỏ, rồi mới sửa. `npm run test:agent-maturity` phải xanh trước khi mở PR (PB dùng vitest, xem brief).
- **Commit thành một lệnh Bash riêng.** Hook chặn mọi lệnh có `git commit` đi cùng một token `-n`, ví dụ `grep -n`. Không dùng backtick trong chuỗi bash có dấu nháy kép. Message theo conventional commit, dòng cuối là `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Review độc lập trước khi mở PR.** Gọi agent `reviewer` trên diff của mình. D4 gọi thêm `socrates`. Sửa hết lỗi HIGH và MEDIUM.
- Push nhánh, mở PR vào `feature/izzi-v2-agent-maturity`, viết mô tả theo "Mẫu mô tả PR" ở cuối `TRACKER.md`. **Không tự merge.** Anh nghiệm thu, root merge.
- Gặp việc ngoài phạm vi, hoặc cần quyết định của anh, thì dừng lại và ghi vào PR. Không tự mở rộng phạm vi.
