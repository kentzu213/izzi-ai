# izzi 2.0 agent maturity: theo dõi tiến độ

Kế hoạch ở `PLAN.md`; báo cáo nghiên cứu ở `AGENT-MATURITY-RESEARCH.md`. Nhánh epic: `feature/izzi-v2-agent-maturity`.

Cập nhật lần cuối: 2026-11-21, root. Trạng thái kế hoạch: anh đã chốt 6 quyết định ngày 20/11; `PLAN.md` §5 còn 4 câu hỏi nhỏ.

## Cách đọc

- Mỗi dòng là một slice. Mỗi slice có một nhánh, một worktree, một phiên Claude Code và một PR vào nhánh epic.
- **Trạng thái:**
  - `chưa làm`;
  - `sẵn sàng`: đã có nhánh, worktree và brief; chờ anh mở phiên;
  - `đang làm`: phiên đã mở, đã có session id;
  - `chờ review`: PR đã mở, có bằng chứng test;
  - `chờ anh nghiệm thu`: review độc lập đạt và root đã tự kiểm lại; chờ anh xem PR rồi cho merge vào nhánh epic;
  - `xong`: phải có đủ ba thứ ở cột Bằng chứng/Review: merge sha vào nhánh epic, lệnh root đã tự chạy lại kèm kết quả, verdict review độc lập (ACCEPT hoặc ACCEPT-WITH-FIXES đã sửa xong). Thiếu một thứ thì chưa được ghi `xong`.
  - Cột **Anh nghiệm thu**: anh ghi "đạt" / "chưa đạt" sau khi xem PR hoặc dùng thử. Đây là cách anh biết phiên đó làm tốt hay chưa.

  Slice bị chặn thì giữ nguyên trạng thái và ghi lý do ở cột Bằng chứng.
- **Tìm lại phiên:** session id là tên file `.jsonl` trong `~/.claude/projects/<thư mục của worktree>/`. Câu lệnh đầu của phiên bắt đầu bằng `[<id slice>]`.
- **Ai cập nhật:**
  - Phiên slice không sửa file này, để tránh xung đột giữa các nhánh. Phiên ghi bằng chứng vào mô tả PR theo mẫu ở cuối file.
  - Root chép bằng chứng sang đây trên nhánh epic.
  - Chỉ root đánh `xong`.

## D-track: pilot trên phiên dev (làm trước)

| Slice | Nhánh | PR | Phiên Claude Code | Trạng thái | Xong khi | Bằng chứng | Review độc lập | Anh nghiệm thu |
|---|---|---|---|---|---|---|---|---|
| D0 | `izzi-v2/d0-gold-set` | [#75](https://github.com/kentzu213/izzi-ai/pull/75) | subagent builder + agent gắn nhãn mù trong phiên root `38d4ca41` (21/11); root hoàn tất sau khi 2 agent dừng vì giới hạn tuần | **chờ anh xem lại 50 câu** (`F:/Ai Tools/Codex/AgentMaturity/d0/review.md`) | ≥200 câu có nhãn, chia dev/test; anh đã xem lại các câu duyệt, khen, cam chịu và không chắc; có baseline | 76a059e: 143/143 test; 462 câu có nhãn; cổng D2 TẠM THỜI (precision 13/13, khoảng tin cậy 95% 0,753–1,000; lỗi nghiêm trọng 0); baseline metrics@1 (test): bộ phân loại 3,17 lần sửa/100 câu, duyệt ngay 0,923, bị mở lại 0,077 | nhãn vàng 15,08 lần sửa/100 câu, duyệt ngay 0,817, bị mở lại 0,133; 0 câu lọt vào repo | socrates ACCEPT-WITH-FIXES, đã sửa đủ 7 điểm (root kiểm lại) | — |
| D1 | `izzi-v2/d1-checkpoint-hook` | [#74](https://github.com/kentzu213/izzi-ai/pull/74) | subagent builder trong phiên root `38d4ca41` (20/11) | **xong** | `pnpm run test:agent-maturity` xanh; lỗi nghiêm trọng = 0; chưa đụng `~/.claude` thật (PLAN §4.8) | merge `03b794c` vào nhánh epic (21/11); CI PR xanh macOS + Windows; root chạy lại sau merge: 93/93 test, thăm dò giấu 46 câu 0 lỗi nghiêm trọng; settings.json thật không đổi | socrates (spec) ACCEPT-WITH-FIXES; reviewer APPROVE-WITH-FIXES, đã sửa ở 9a8fe0c + e884744 | ok (21/11) |
| D2 | `izzi-v2/d2-live-install` | — | — | chưa làm | Đạt cổng D0 (precision ≥0,9; cam chịu bị tính là duyệt = 0); hook chạy trong phiên thật; 0 câu lệnh bị chặn; chạy 7 ngày | — | — | — |
| D3 | `izzi-v2/d3-standards-store` | — | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-d3` | **đang làm** | Vòng capture → promote → export → supersede chạy trên kho tạm; khối chèn ≤1200 ký tự; kho thật không đổi | — | — | — |
| D4 | `izzi-v2/d4-critic-research` | — | subagent orchestrator trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-d4`; root chạy 3 lần thử socrates | **đang làm** | 3 lần chạy thử có verdict; lần phản biện thứ 3 bị chặn | — | — | — |
| D5 | `izzi-v2/d5-metrics` | [#77](https://github.com/kentzu213/izzi-ai/pull/77) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-d5` | **chờ anh nghiệm thu** (phần 1; phần 2 cần ≥7 ngày log sau D2) | Có báo cáo trên ≥7 ngày log; checker precision ≥0,8 trên ≥30 cặp | 7a217a5: 152/152 test; report đọc baseline@1, chỉ tính chênh lệch khi cùng thước đo, nhãn vàng không có chênh lệch; báo động mỏi, bị mở lại, cổng checker (≥30 cặp, cận dưới ≥0,8) | reviewer APPROVE-WITH-FIXES (1 HIGH cùng thước đo, 3 MEDIUM, 4 LOW), đã sửa ở 7a217a5, root kiểm lại | — |
| D6 | `izzi-v2/d6-pilot-review` | — | — | chưa làm | Bản ghi quyết định có số trước/sau; socrates review; anh duyệt | — | — | — |

## P-track: sản phẩm izzi 2.0 (sau D-track)

| Slice | Nhánh | PR | Phiên Claude Code | Trạng thái | Xong khi | Bằng chứng | Review độc lập | Anh nghiệm thu |
|---|---|---|---|---|---|---|---|---|
| P-1 | — (không code) | — | — | chưa làm | Anh bấm Dùng ≥1 hồ sơ; có 3 lượt chat trước/sau; 0 lộ dữ liệu; 0 câu trả lời hỏng | — | — | — |
| P0 | `izzi-v2/p0-product-gold` | — | — | chưa làm | Đếm đủ 5 loại sự kiện; precision ≥0,9 trên tập giữ riêng; cam chịu bị tính là duyệt = 0 | — | — | — |
| PB | `izzi-v2/pb-budget-fuses` | [#76](https://github.com/kentzu213/izzi-ai/pull/76) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-pb` | **chờ anh nghiệm thu** (không phát hành) | Bỏ trần 3/6; có test cho từng cầu chì (402, 90 giây, một lượt mỗi lúc, không có việc thì 0 gọi, phát hiện vòng lặp, lần anh bấm không bị chặn) | 0d26f5f: vitest 140/140; tsc main 0; bỏ trần 3/6; 402 dừng + tạm dừng chạy nền; 90 s không dự phòng; Idempotency-Key theo tài khoản+đầu vào+model; còn rủi ro: lỗi mạng sau khi máy chủ nhận vẫn thử dự phòng | reviewer APPROVE-WITH-FIXES (1 MEDIUM trả tiền 2 lần sau timeout + 5 LOW), đã sửa ở 0d26f5f, root kiểm lại | — |
| P2 | `izzi-v2/p2-itemized-store` | — | — | chưa làm | 0 mục mất qua 10 lần chạy; khối chèn ≤1000 ký tự | — | — | — |
| P1 | `izzi-v2/p1-feedback-ledger` | — | — | chưa làm | Đủ 5 loại sự kiện, có vai trò người duyệt; lọc PII 100% | — | — | — |
| P3 | `izzi-v2/p3-candidates-critic` | — | — | chưa làm | Mọi ứng viên có cặp đối chứng và verdict | — | — | — |
| P4 | `izzi-v2/p4-apply-checker` | — | — | chưa làm | Đo được tỉ lệ vi phạm chuẩn | — | — | — |
| P5 | `izzi-v2/p5-nightly-job` | — | — | chưa làm | Lỗi bị nhắc lại giảm so với baseline P0 | — | — | — |
| P6 | `izzi-v2/p6-auto-low-risk` | — | — | chưa làm | Tỉ lệ duyệt lần đầu tăng và giữ ≥2 tháng | — | — | — |

## Mẫu mô tả PR của mỗi slice

    Slice: <id> · Phiên: <session id> · Worktree: <đường dẫn>
    Xong khi: <chép từ bảng>
    Bằng chứng: <lệnh đã chạy> → <kết quả, số test, số đo>
    Chưa làm / rủi ro còn lại: <…>
    Đề xuất ghi nhớ (nếu có): <claim, phạm vi, nguồn>
