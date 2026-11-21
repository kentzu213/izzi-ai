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
| D3 | `izzi-v2/d3-standards-store` | [#78](https://github.com/kentzu213/izzi-ai/pull/78) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-d3` | **xong** | Vòng capture → promote → export → supersede chạy trên kho tạm; khối chèn ≤1200 ký tự; kho thật không đổi | ac66205: 166/166 test; ESLint sạch; CI xanh macOS + Windows; kho chuẩn duy nhất (KnowledgeMemory); chèn ≤1200 ký tự ở mọi phiên; chống thoát khung; note auto-memory không bao giờ tự thành chuẩn; D2 phải đăng ký job refresh hằng ngày; merge `d0f6b98` vào nhánh epic; root chạy lại trên nhánh epic sau merge (aec53ba): 402/402 test công cụ, eslint sạch, 140/140 vitest bộ nhớ agent, tsc main + renderer sạch | reviewer BLOCK → sửa 8c19f24 → APPROVE-WITH-FIXES → root sửa MEDIUM ở 7703dab; còn 3 LOW ghi trong PR | ok (21/11) |
| D4 | `izzi-v2/d4-critic-research` | [#79](https://github.com/kentzu213/izzi-ai/pull/79) | subagent orchestrator (bản đầu) + builder (3 vòng sửa) trong phiên root `38d4ca41` (21/11); root chạy 3 lần thử socrates | **xong** | 3 lần chạy thử có verdict; lần phản biện thứ 3 bị chặn | 9804dc1: 270/270 test; ESLint sạch; 'qua' cần từ văn phong ở mọi vế + không hành động; mọi chuẩn gắn với đúng tin nhắn anh chọn Nâng cấp (có sổ ghi, chống dùng lại); thăm dò reviewer 0/207 + 0/63 lọt, root 0/16 lọt; chủ đề công bố AI (Luật 134/2025); merge `aec53ba` vào nhánh epic; root chạy lại trên nhánh epic sau merge (aec53ba): 402/402 test công cụ, eslint sạch, 140/140 vitest bộ nhớ agent, tsc main + renderer sạch | BLOCK → APPROVE-WITH-FIXES → BLOCK → vòng 4–5 → review cuối APPROVE-WITH-FIXES (không HIGH) → 3 MEDIUM sửa ở 9804dc1, root kiểm lại | ok (21/11) |
| DI | `izzi-v2/di-d3-d4-wiring` | [#80](https://github.com/kentzu213/izzi-ai/pull/80) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-di` | **chờ CI** rồi chờ anh nghiệm thu | Một cửa duy nhất lưu chuẩn: cổng D4 → đối chiếu tin nhắn duyệt với log hook D1 → KnowledgeMemory → export; gọi `promote` thẳng vào `dev-standard/` bị từ chối; test đầu-cuối trên kho tạm (sessions/DI.md) | 5477966: 437/437 test; eslint sạch; hook <50 ms; cửa duy nhất (log hook D1 + transcript thật → cổng D4 → KnowledgeMemory → export); file xuất là ranh giới; chỉ đúng chữ 'Nâng cấp' cho đúng câu đề xuất mới là duyệt; một câu không thành hai chuẩn; --supersedes; kho/settings thật không đổi | APPROVE-WITH-FIXES (2 HIGH) → sửa → review lại APPROVE-WITH-FIXES (lỗi cũ kín, 5 điểm mới ≤MEDIUM) → sửa cả 5 + đối chiếu transcript thật; root kiểm lại | — |
| D5 | `izzi-v2/d5-metrics` | [#77](https://github.com/kentzu213/izzi-ai/pull/77) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-d5` | **xong** | Có báo cáo trên ≥7 ngày log; checker precision ≥0,8 trên ≥30 cặp | 7a217a5: 152/152 test; report đọc baseline@1, chỉ tính chênh lệch khi cùng thước đo, nhãn vàng không có chênh lệch; báo động mỏi, bị mở lại, cổng checker (≥30 cặp, cận dưới ≥0,8); merge `3c497a6` vào nhánh epic; root chạy lại trên nhánh epic sau merge (aec53ba): 402/402 test công cụ, eslint sạch, 140/140 vitest bộ nhớ agent, tsc main + renderer sạch | reviewer APPROVE-WITH-FIXES (1 HIGH cùng thước đo, 3 MEDIUM, 4 LOW), đã sửa ở 7a217a5, root kiểm lại | ok (21/11) |
| D6 | `izzi-v2/d6-pilot-review` | — | — | chưa làm | Bản ghi quyết định có số trước/sau; socrates review; anh duyệt | — | — | — |

## P-track: sản phẩm izzi 2.0 (sau D-track)

| Slice | Nhánh | PR | Phiên Claude Code | Trạng thái | Xong khi | Bằng chứng | Review độc lập | Anh nghiệm thu |
|---|---|---|---|---|---|---|---|---|
| P-1 | — (không code) | — | — | chưa làm | Anh bấm Dùng ≥1 hồ sơ; có 3 lượt chat trước/sau; 0 lộ dữ liệu; 0 câu trả lời hỏng | — | — | — |
| P0 | `izzi-v2/p0-product-gold` | — | — | chưa làm | Đếm đủ 5 loại sự kiện; precision ≥0,9 trên tập giữ riêng; cam chịu bị tính là duyệt = 0 | — | — | — |
| PB | `izzi-v2/pb-budget-fuses` | [#76](https://github.com/kentzu213/izzi-ai/pull/76) | subagent builder trong phiên root `38d4ca41` (21/11), worktree `F:/Ai Tools/_wt-izzi-v2-pb` | **xong** | Bỏ trần 3/6; có test cho từng cầu chì (402, 90 giây, một lượt mỗi lúc, không có việc thì 0 gọi, phát hiện vòng lặp, lần anh bấm không bị chặn) | 0d26f5f: vitest 140/140; tsc main 0; bỏ trần 3/6; 402 dừng + tạm dừng chạy nền; 90 s không dự phòng; Idempotency-Key theo tài khoản+đầu vào+model; còn rủi ro: lỗi mạng sau khi máy chủ nhận vẫn thử dự phòng; merge `c8f3b4d` vào nhánh epic; root chạy lại trên nhánh epic sau merge (aec53ba): 402/402 test công cụ, eslint sạch, 140/140 vitest bộ nhớ agent, tsc main + renderer sạch | reviewer APPROVE-WITH-FIXES (1 MEDIUM trả tiền 2 lần sau timeout + 5 LOW), đã sửa ở 0d26f5f, root kiểm lại | ok (21/11) |
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
