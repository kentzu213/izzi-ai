# D0: tập vàng và baseline (số liệu tổng hợp, không chứa câu lệnh)

Ngày 2026-11-21. Nhánh `izzi-v2/d0-gold-set`. Dữ liệu thô nằm riêng ở `F:/Ai Tools/Codex/AgentMaturity/d0/`, ngoài git.

## Dữ liệu

- 462 câu lệnh anh gõ trong Claude Code, gồm 112 phiên và 21 thư mục dự án, toàn bộ lịch sử còn lưu. Đã khử trùng theo uuid và theo cặp thời điểm + nội dung.
- Chia theo hash của id: dev 210 câu, test 252 câu. Tập test được giữ riêng: không dùng để chỉnh bộ phân loại.
- Nhãn vàng do một agent gắn **mù** (không xem bộ phân loại), dựa trên nghĩa và ngữ cảnh câu assistant ngay trước đó.
  - Phân bố: none 202, approve_decision 108, flow 82, correction 65, clarify 2, praise 1, confirm 1, resignation 1.
  - 118 câu được đánh dấu không chắc.
- Công cụ trích dữ liệu trong repo (`eval/extract-prompts.mjs`) cho cùng tập id và cùng cách chia như bản trích gốc. Lần chạy lại thấy thêm 10 câu, đều được gõ sau thời điểm trích.

## Kết quả bộ phân loại D1 (tập test, 252 câu)

| Chỉ số | Giá trị |
|---|---|
| Precision "mốc hoàn tất" (duyệt/khen) | **1,000** (13/13) |
| Recall "mốc hoàn tất" | **0,217** (13/60) |
| Lỗi nghiêm trọng (cam chịu / câu hỏi / phủ định / trì hoãn bị tính là duyệt) | **0** |
| Recall nhãn "sửa" (correction) | 0,083 (3/36) |
| Cổng D2 (precision ≥0,9 và lỗi nghiêm trọng = 0) | **ĐẠT** |

- Tập dev: precision 1,000 (7/7), recall 0,143, lỗi nghiêm trọng 0.
- Tập thăm dò tổng hợp của D1 có 93 câu (27 cam chịu, 45 câu hỏi/phủ định): lỗi nghiêm trọng 0. Dữ liệu thật quá ít ca cam chịu (1 câu), nên lớp này dựa vào tập tổng hợp.
- Các luật mốc đều đúng 100% khi đã bắn: `phat-hanh` 9/9, `sua-o-day` 4/4, `dong-y` 3/3, `duyet-theo` 2/2, `merge` 2/2.

## Baseline để so ở D6

- Số lần sửa: **14,3 trên 100 câu** (test), 13,8 (dev).
- Tỉ lệ duyệt ngay lần đầu, tức mốc hoàn tất không có lần sửa nào kể từ mốc trước trong cùng phiên: **0,817** (test), 0,898 (dev).

## Đọc kết quả

- **Bộ phân loại thận trọng.** Khi nó báo "duyệt" thì luôn đúng, nhưng bỏ sót khoảng 4/5 lần duyệt thật. Chỗ hụt chủ yếu là câu duyệt kèm việc mới, dài hơn ngưỡng 60 ký tự (46 câu có thẻ `multi_intent`), và câu duyệt không dùng động từ quen thuộc.
- **Recall nhãn "sửa" rất thấp.** Vì vậy "nhắc mạnh", vốn cần một lần sửa trước đó, sẽ hiếm khi bắn. Checkpoint sẽ chủ yếu là "nhắc yếu", tối đa 1 lần mỗi phiên.
- Hệ quả khi cài thật: agent hỏi ít, nhưng gần như không hỏi sai lúc. Đây là hướng an toàn. Muốn học nhanh hơn thì phải chỉnh recall trên tập dev (PLAN §4.9 mục 7) **sau khi** anh xác nhận nhãn vàng.

## Việc còn lại của D0

- Anh xem lại 50 câu ở `F:/Ai Tools/Codex/AgentMaturity/d0/review.md`. Cả 50 đều là câu người gắn nhãn cho là duyệt mà máy không bắt.
- Root sửa nhãn theo trả lời của anh, rồi chạy lại `eval-gold.mjs`.
- Nếu anh xác nhận phần lớn là duyệt thật: chỉnh recall trên tập dev, giữ precision ≥0,9 và lỗi nghiêm trọng = 0, rồi mới cài thật (D2).
