# D0: tập vàng và baseline (số liệu tổng hợp, không chứa câu lệnh)

Ngày 2026-11-21, bản sửa theo review Socrates (ACCEPT-WITH-FIXES). Nhánh `izzi-v2/d0-gold-set`. Dữ liệu thô nằm riêng ở `F:/Ai Tools/Codex/AgentMaturity/d0/`, ngoài git.

Lệnh tái tạo mọi con số dưới đây:
`node tools/agent-maturity/eval/eval-gold.mjs <prompts.jsonl> <labels.jsonl> <predictions.jsonl> --split all`

## Dữ liệu

- 462 câu lệnh anh gõ trong Claude Code, gồm 112 phiên và 21 thư mục dự án, toàn bộ lịch sử còn lưu. Đã khử trùng theo uuid và theo cặp thời điểm + nội dung.
- Chia theo hash của id: dev 210 câu, test 252 câu. Tập test được giữ riêng: không dùng để chỉnh bộ phân loại.
- Nhãn vàng do một agent gắn **mù** (không xem bộ phân loại), dựa trên nghĩa và ngữ cảnh câu assistant ngay trước đó. **Anh chưa xem lại nhãn**, nên mọi kết luận dưới đây là tạm thời.
  - Phân bố: none 202, approve_decision 108, flow 82, correction 65, clarify 2, praise 1, confirm 1, resignation 1.
  - 118 câu được đánh dấu không chắc.
- Công cụ trích dữ liệu trong repo (`eval/extract-prompts.mjs`) cho cùng tập id và cùng cách chia như bản trích gốc. Từ bản này nó che khoá `sk-`/`izzi-`, Bearer token, JWT và số điện thoại Việt Nam (0/84/+84) trong câu lệnh và ngữ cảnh; id không đổi. Bản `prompts.jsonl` hiện tại được trích trước bước che: 0 câu lệnh và 3 đoạn ngữ cảnh khớp mẫu che.
- Mọi lệnh ghi file chứa câu lệnh thật từ chối ghi vào bất kỳ thư mục git nào, không chỉ repo này.

## Cổng D2 trên tập test (252 câu): **TẠM THỜI** (PROVISIONAL)

| Chỉ số | Giá trị |
|---|---|
| Precision "mốc hoàn tất" (duyệt/khen) | 1,000 (13/13), **khoảng tin cậy 95% (Clopper-Pearson) 0,753–1,000** |
| Recall "mốc hoàn tất" | 0,217 (13/60) |
| Lỗi nghiêm trọng (cam chịu / câu hỏi / phủ định / trì hoãn bị tính là duyệt) | 0 |
| Nhãn "sửa" (correction) | precision 0,375 (3/8), recall 0,083 (3/36) |
| Trục "sửa hoặc hỏi lại" (correction + clarify, đúng cách `decide()` đếm) | precision 0,375 (3/8), recall 0,079 (3/38) |

Cổng chỉ ĐẠT khi precision ≥0,9 **và** cận dưới khoảng tin cậy ≥0,9, lỗi nghiêm trọng = 0, mỗi lớp nguy hiểm có ≥20 ca thật trên test, và anh đã xem lại nhãn. Lần này là TẠM THỜI vì:

1. Chỉ có 1 ca cam chịu thật trên test (cần ≥20). Tập thăm dò tổng hợp của D1 có 27 ca cam chịu và 45 ca câu hỏi/phủ định, lỗi nghiêm trọng 0. Tập tổng hợp **chỉ thay được lớp cam chịu nếu anh chấp nhận**. Lớp câu hỏi/phủ định có 46 ca thật trên test, đủ ngưỡng.
2. 13/13 là mẫu nhỏ: cận dưới khoảng tin cậy 95% là 0,753, dưới 0,9.
3. Anh chưa xem lại nhãn vàng (cờ `--owner-reviewed` chưa bật).

Tập dev: precision 1,000 (7/7, khoảng tin cậy 0,590–1,000), recall 0,143 (7/49), lỗi nghiêm trọng 0; nhãn "sửa" precision 0,333 (1/3), recall 0,034 (1/29).

## Độ chính xác từng luật mốc (ghi rõ tập)

| Luật | test | dev | dev+test |
|---|---|---|---|
| `approve_decision:phat-hanh` | 5/5 | 4/4 | 9/9 |
| `approve_decision:sua-o-day` | 3/3 | 1/1 | 4/4 |
| `approve_decision:dong-y` | 1/1 | 2/2 | 3/3 |
| `approve_decision:duyet-theo` | 2/2 | — | 2/2 |
| `approve_decision:merge` | 2/2 | — | 2/2 |

Mỗi luật bắn rất ít lần, nên "đúng 100%" ở đây chưa nói được nhiều.

## Câu bị sót trên tập test

47 câu nhãn vàng là duyệt/khen mà máy không bắt (37 thành `none`, 5 `abstain`, 4 `flow`, 1 câu khen thành `none`):

- 36/47 câu dài ≤20 ký tự: phần lớn là câu duyệt rất ngắn, nghĩa duyệt phụ thuộc vào ngữ cảnh câu assistant trước đó.
- Chỉ 5/47 câu có thẻ `multi_intent`. Bản báo cáo trước ghi "46 câu `multi_intent`" là **sai** và đã bỏ.
- 15/47 câu người gắn nhãn không chắc.

## Baseline để so ở D6

Có hai bộ baseline, đo trên cùng tập câu. Bộ phân loại hiện bỏ sót phần lớn câu sửa và câu duyệt, nên hai bộ khác nhau rất xa:

| Số đo (test) | Theo nhãn vàng | Theo bộ phân loại |
|---|---|---|
| Số lần sửa trên 100 câu | 14,3 (36/252) | 3,2 (8/252) |
| Duyệt ngay lần đầu | 0,817 (49/60 mốc) | 0,923 (12/13 mốc) |
| Bị mở lại trong 3 câu kế tiếp (ước lượng) | 0,150 (9/60) | 0,077 (1/13) |

| Số đo (dev) | Theo nhãn vàng | Theo bộ phân loại |
|---|---|---|
| Số lần sửa trên 100 câu | 13,8 (29/210) | 1,4 (3/210) |
| Duyệt ngay lần đầu | 0,878 (43/49) | 0,857 (6/7) |
| Bị mở lại trong 3 câu kế tiếp (ước lượng) | 0,245 (12/49) | 0,000 (0/7) |

- "Duyệt ngay lần đầu" = mốc hoàn tất không có câu sửa hoặc hỏi lại (`correction` hoặc `clarify`) nào kể từ mốc trước trong cùng phiên, giống cách `decide()` đếm. Bản trước chỉ đếm `correction`; vì phiên trải qua cả hai tập, số dev đổi từ 0,898 thành 0,878.
- "Bị mở lại" là số đo ngược (PLAN §4.9 mục 6): tỉ lệ mốc hoàn tất có câu sửa hoặc hỏi lại trong 3 câu kế tiếp của cùng phiên. Đây là ước lượng: chưa xét rollback, và chỉ xét câu đã có nhãn.
- **Luật cho D6: so cùng thước đo.** Số đo của pilot do hook ghi bằng bộ phân loại, nên chỉ được so với baseline "theo bộ phân loại". Muốn so với baseline "theo nhãn vàng" thì phải gắn nhãn vàng cho một mẫu câu của pilot theo cùng cách. Không được so số của bộ phân loại với baseline nhãn vàng.

## Rò rỉ giữa dev và test

- 46/112 phiên có câu ở cả hai tập; 210/252 câu test nằm trong những phiên này.
- 49/252 câu test có nội dung (sau chuẩn hoá) trùng một câu ở dev; 25 câu trong số đó dài ≤20 ký tự.
- Trên 203 câu test không trùng dev ("test-unique"): precision mốc 1,000 (8/8, khoảng tin cậy 0,631–1,000), recall 0,157 (8/51), lỗi nghiêm trọng 0; nhãn "sửa" precision 0,375 (3/8), recall 0,120 (3/25).
- Kết luận không đổi, nhưng mẫu nhỏ hơn nên khoảng tin cậy rộng hơn. Khi chỉnh luật trên dev, câu trùng nội dung sẽ làm số test trông tốt hơn thực tế; luôn đọc kèm dòng test-unique.

## Đọc kết quả

- **Bộ phân loại thận trọng.** Khi nó báo "duyệt" thì chưa sai lần nào, nhưng bỏ sót khoảng 4/5 lần duyệt thật, chủ yếu là câu duyệt rất ngắn.
- **Recall nhãn "sửa" rất thấp** (0,083). Vì vậy "nhắc mạnh", vốn cần một lần sửa trước đó, sẽ hiếm khi bắn. Checkpoint sẽ chủ yếu là "nhắc yếu", tối đa 1 lần mỗi phiên.
- Hệ quả khi cài thật: agent hỏi ít, và chưa thấy lần nào hỏi sai lúc trên dữ liệu thật. Muốn học nhanh hơn thì phải chỉnh recall trên tập dev (PLAN §4.9 mục 7) **sau khi** anh xác nhận nhãn vàng, và cổng chỉ ĐẠT khi khoảng tin cậy đủ hẹp.

## Việc còn lại của D0

- Anh xem lại 50 câu ở `F:/Ai Tools/Codex/AgentMaturity/d0/review.md`, đều thuộc tập test:
  - Nhóm 1: 13 câu máy đoán là duyệt (kiểm tra precision).
  - Nhóm 2: 1 câu nhãn vàng là cam chịu.
  - Nhóm 3: 8 câu nhãn vàng là sửa nhưng người gắn nhãn không chắc.
  - Nhóm 4: 28 câu nhãn vàng là duyệt mà máy không bắt.
- Anh quyết định có chấp nhận tập tổng hợp của D1 thay cho lớp cam chịu hay không.
- Root sửa nhãn theo trả lời của anh, rồi chạy lại `eval-gold.mjs --owner-reviewed`.
- Sau đó mới chỉnh recall trên dev, giữ precision ≥0,9 và lỗi nghiêm trọng = 0, rồi mới cài thật (D2).
