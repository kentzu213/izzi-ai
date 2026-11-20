# izzi AI 2.0: agent trưởng thành theo tiêu chuẩn của người dùng

Báo cáo nghiên cứu, viết **trước khi xử lý**. Ngày 2026-11-20. Nhánh dài hạn: `feature/izzi-v2-agent-maturity`, tách từ `origin/main` 85b6fc1.

Chưa có dòng code sản phẩm nào đổi. Mọi đề xuất bên dưới chờ anh duyệt.

## 0. Tóm tắt

1. **MyGraph hiện ở mức L4 "đã xây, chưa chạy thật"** theo thang đề xuất ở mục 2. Agent đã biết đọc hồ sơ đã duyệt (S4, beta.117–118). Nhưng 4 hồ sơ vẫn đang chờ duyệt, nên **chưa agent nào dùng hồ sơ học được**. Director thì đã đọc khối Chăm sóc khách. **L5 (tự học tiêu chuẩn từ tín hiệu) chưa bắt đầu.**
2. **Bước rẻ nhất phải làm trước mọi thứ: cho L4 chạy thật.** Anh duyệt 1–4 hồ sơ đang chờ. Sau đó quan sát S4 chèn hồ sơ trong lượt làm việc thật, và đo trước/sau. CLAUDE.md (Small Release Loop) cũng yêu cầu bản đã phát hành phải được chạy thử rồi mới xây tiếp.
3. **"Được rồi / ổn rồi" rất hiếm trong câu lệnh của anh.** Chỉ quét các phiên Claude Code, không quét Codex. Có 290 câu lệnh thật (đã khử trùng, lọc theo thời điểm tin nhắn) trong khoảng 20/09–20/11, và hai câu này mỗi câu xuất hiện 1 lần. "Tiếp tục" (37 lần) chủ yếu là lệnh điều khiển luồng, không phải lời duyệt. Tín hiệu duyệt rõ nhất là các câu quyết định ngắn: "phát hành", "merge", "sửa ở đây", "đồng ý", "duyệt theo" (~24 câu ≤40 ký tự), và các nút duyệt trên UI.
4. **Nghiên cứu không ủng hộ biến một câu khen thành luật.** Tín hiệu mạnh nhất là *sửa hoặc từ chối, rồi mới duyệt* (cặp đối chứng). Câu khen đơn lẻ dễ làm agent nịnh. Trong tiếng Việt, "thôi được rồi" còn có thể là lời từ chối mềm.
5. **Bộ chắt lọc S2 có một rủi ro sẽ thành lỗi khi bật chế độ Tự động (S3).** Mỗi lần chạy, nó viết lại *toàn bộ* hồ sơ. Hiện rủi ro đã được giảm vì ba lẽ: nền viết lại chỉ là bản đã duyệt, chủ shop thấy diff, và hồ sơ ngắn. Nhưng ACE đo được kiểu viết lại toàn khối này làm bộ nhớ sụp, có ca độ chính xác rơi xuống dưới mức không có bộ nhớ (đây là một case study). Cách sửa: lưu từng mục có ID, mỗi lần chỉ thêm, sửa hoặc vô hiệu hoá từng mục.
6. **Đề xuất "Sổ tiêu chuẩn"**, đi qua các bước: tín hiệu → cặp đối chứng → tiêu chuẩn ứng viên → Socrates phản biện → research theo tầng → chủ shop duyệt → áp dụng và kiểm tra → đo kết quả → giữ hoặc loại. Phân vai theo kiểu JCC: code quyết định, bộ phân loại nhỏ chấm điểm, LLM viết, người chịu trách nhiệm.

## 1. Thống kê hành trình MyGraph (từ git `origin/main` và các memory đã kiểm chứng)

| Ngày | Mốc | Bản |
|---|---|---|
| 26/06 | Agent workspace + đồng bộ graph với backend (Phase 1+2); nhúng graph izziapi.com; AI Branching Graph Workspace | v1.1.2–1.1.3 |
| 30/06 | Knowledge Universe native (react-force-graph-2d) | — |
| 04–06/07 | Tách gói dùng chung `@kentzu213/graph-view` | — |
| 07/07 | Ghi phiên làm việc của agent vào MyGraph; lưu lịch sử chat gateway | v1.5.0 "second-brain cohesion" |
| 09/07 | Memory Phase 1: bộ não chung izzi hiện trong Recall library | v1.7.5 |
| 05–09/08 | Trace unit + Live.md (người vận hành đọc/sửa từ MyGraph), lưu phiên bản mã hoá | beta.16–17 |
| 28/10 | Graph View 0.2.0: Local Graph Lens, tìm kiếm, lỗi phục hồi được. Socrates ACCEPT | beta.104 (nội bộ) |
| 28/10 | Trí nhớ dự án phía Codex: kho SQLite chuẩn + vault Obsidian, vòng đời candidate → active → superseded/retracted | công cụ dev |
| 17/11 | Đồng bộ graph có điều kiện (ETag), giảm egress Supabase | beta.110 |
| 19/11 | Care → MyGraph Slice 1: Director đọc khối Chăm sóc khách | beta.115 |
| 19/11 | Audit: **không agent nào đọc MyGraph**. S1 ngừng đổ transcript thô | beta.115 |
| 19/11 | S2: chắt lọc hồ sơ agent, chế độ Duyệt | beta.116 |
| 19–20/11 | S4: agent dùng hồ sơ đã duyệt, cùng các bản vá theo review | beta.117–118 |

Số liệu hiện tại:

- Cache cục bộ: 339 node, trong đó 20 node transcript cũ. Smoke ngày 28/10: 272 node, 789 cạnh.
- Hồ sơ agent: 4 bản **chờ duyệt** (Director, Designer, Hermes, Socrates). 0 bản đang dùng.
- Test desktop lúc phát hành S4: 3509/3509.
- Còn mở:
  - S3 (tự chạy + chiếu sang MyGraph) chưa có code.
  - `memory-sync` Phase 2 (ghi lên `kb_memory_nodes`) chưa từng làm.
  - Bộ lọc chủ sở hữu cho `match_session_embeddings` chưa làm.
  - `GET /api/aibase/nodes` bị cắt ở 1000 dòng.
- Trí nhớ chuyên gia phía công cụ dev (vault `KnowledgeVault`, 36 dự án):
  - 193 ghi nhớ: 160 active, 6 candidate, 17 superseded, 10 retracted.
  - Theo loại: 53 quy trình, 44 bẫy, 42 bài học, 28 sở thích, 16 dữ kiện, 10 quyết định.
  - Vòng đời có nguồn gốc rõ. Nhưng việc ghi vẫn do root làm tay, và tìm kiếm dựa trên trùng từ, không theo ngữ nghĩa.

## 2. Thang trưởng thành L0–L6 (đề xuất, cần anh xác nhận)

Tôi **không tìm thấy** tài liệu nào định nghĩa "Lv5/Lv6". Đã tìm trong repo, `.kiro/specs`, Codex skills, vault Obsidian và transcript. Tài liệu ngoài cũng không có thang chuẩn: Morris et al. (2311.02462) chỉ có các mức tự chủ 0–5. Vì vậy thang dưới đây là thiết kế của tôi. Mỗi mức có điều kiện kiểm chứng được.

| Mức | Tên | Điều kiện đạt (đo được) | izzi sản phẩm | Công cụ dev |
|---|---|---|---|---|
| L0 | Không nhớ | — | — | — |
| L1 | Ghi | Lưu lại hoạt động | 07/07 (S1 đã tắt vì lẫn PII và nhiễu) | ✔ |
| L2 | Tra cứu | Người xem, tìm, sửa được | ✔ Recall library, Live.md, Graph lens | ✔ vault |
| L3 | Chắt lọc có kiểm soát | Tóm tắt định kỳ, lọc PII, người duyệt | ✔ S2 | ✔ capture/promote |
| L4 | Dùng khi làm việc | Agent đọc mục đã duyệt, coi là dữ liệu chứ không phải lệnh | **Đã xây, chưa chạy thật** (0 hồ sơ được duyệt) | ✔ recall top-3 |
| **L5** | Tự học tiêu chuẩn | Tự bắt tín hiệu → cặp đối chứng → tiêu chuẩn ứng viên có bằng chứng → phản biện → duyệt → áp dụng. **Số lần anh phải nhắc lại cùng một lỗi giảm đo được** | Chưa bắt đầu | Một phần: có vòng đời nhưng chưa tự bắt tín hiệu |
| **L6** | Tự quản trị chuyên gia | Mỗi tiêu chuẩn có bộ đếm hữu ích/có hại, loại bỏ theo giá trị thực, có bộ test hồi quy, có job hợp nhất ban đêm, rollback. Mục rủi ro thấp được tự động áp dụng sau N lần xác nhận. **Duyệt ngay lần đầu tăng, số vòng sửa giảm, giữ được qua nhiều tháng** | Chưa | Chưa |

"Tiệm cận L6" nghĩa là L5 chạy ổn định, và đã có số đo chứng minh agent tốt lên theo thời gian. Có tính năng thôi thì chưa đủ.

**Định nghĩa vận hành của "lỗi bị nhắc lại"** (thước đo của L5): một sự kiện sửa/từ chối mà checker xác định là trùng phạm vi và trùng nội dung với một tiêu chuẩn đã có (đang dùng hoặc ứng viên) được tạo trước đó. Đo theo số lần trên 100 việc của mỗi agent. Checker này phải được chấm trên tập vàng ở V0 trước khi dùng số của nó.

## 3. Tín hiệu nâng cấp tiêu chuẩn

### 3.1 Dữ liệu thật của anh

Quét các câu lệnh anh gõ trong Claude Code, 20/09–20/11. Cách đếm:

- lọc theo thời điểm của từng tin nhắn, khử trùng theo uuid và theo cặp thời điểm + nội dung (phiên resume chép lại lịch sử cũ);
- còn 290 câu, trong đó 158 câu ≤40 ký tự;
- khớp chuỗi đơn giản, chỉ mang tính chỉ báo.

| Nhóm | Cụm từ (tổng / trong câu ≤40 ký tự) | Đọc thế nào |
|---|---|---|
| Quyết định ngắn | "phát hành" 10/9, "merge" 8/6, "sửa ở đây" 4/4, "đồng ý" 6/3, "duyệt theo" 2/2 | Tín hiệu duyệt rõ nhất: đây là quyết định có hệ quả |
| Điều khiển luồng | "tiếp tục" 37/15, "làm tiếp" 4/1 | Chủ yếu là "chạy tiếp", không phải "đạt chuẩn" |
| Sửa / cấm | "đừng" 12, "làm lại" 3, "chưa được" 3, "vẫn chưa" 3, "không phải" 1 | "Đừng" phần lớn nằm trong chỉ dẫn dài được dán lại: 18 lần trước khử trùng nhưng chỉ có 8 nội dung khác nhau |
| Khen trực tiếp | "được rồi" 1, "ổn rồi" 1 | Rất hiếm. "Được rồi" duy nhất nằm trong một câu dài |
| Cam chịu | "cũng được" 2 | — |

Giới hạn: chưa quét 1.035 phiên Codex cùng kỳ. Các lần duyệt bằng nút trên UI (ví dụ duyệt plan) không có trong số đếm.

Hệ quả:

- Nếu chỉ dò "được rồi", hệ thống gần như không học được gì.
- Tín hiệu đáng tin là **quyết định có hệ quả** (nút duyệt, "phát hành", "merge") và **lời sửa có nội dung**.
- Tiêu chuẩn cũng lộ ra khi anh **nhắc lại cùng một lỗi**.

Đây là phiên anh làm việc với agent dev. Chủ shop dùng izzi có thể nói khác, nên cần đo lại trên dữ liệu sản phẩm (V0). Tập 290 câu chỉ dùng làm tập đánh giá riêng.

### 3.2 Phân loại tín hiệu (theo tài liệu, trọng số là tổng hợp của tôi)

| Tín hiệu | Ví dụ | Dùng để | Nguồn |
|---|---|---|---|
| Sửa có nội dung / sửa bản nháp | "không phải A, mà B", owner sửa chữ trước khi duyệt | **tạo** tiêu chuẩn ứng viên | PRELUDE/CIPHER 2404.15269: chi phí sửa giảm 31–73%. Người dùng trong thí nghiệm là GPT-4 mô phỏng |
| Từ chối / làm lại | từ chối chiến lược kèm ghi chú; "làm lại" | tạo mục "bẫy" (pitfall) | ReSpect 2410.13852; WildFeedback 2408.15549 |
| Duyệt **sau** một lần bị từ chối cùng việc | sửa 2 lần rồi "duyệt" | **xác nhận** tiêu chuẩn (cặp đối chứng) | ExpeL 2308.10144; ReasoningBank 2509.25140 |
| Duyệt / tiến tiếp không có đối chứng | "tiếp tục", "ok", "được rồi" | chỉ cộng điểm "hữu ích" cho mục đã được dùng; **không tạo luật** | Don-Yehiya 2407.10944 (khen hiếm, ồn) |
| Cam chịu | "thôi được rồi", "cũng được", "tạm được" | coi là **chưa biết hoặc tiêu cực**; không tăng điểm | các luận văn ngữ dụng tiếng Việt (Griffith, ANU; mới đọc trích đoạn) |

### 3.3 Năm luật cứng khi gặp một câu "được rồi"

1. **Không có cặp đối chứng thì không có luật.** Phải có một lần bị sửa hoặc từ chối, rồi một lần được duyệt, trên cùng loại việc.
2. **Luật luôn có phạm vi**: agent, loại việc, kênh. Ở tác vụ tóm tắt, CIPHER đo được sở thích không gắn ngữ cảnh còn tệ hơn không học gì. Ở tác vụ email thì nó vẫn tốt hơn, nên đây là rủi ro chứ không phải quy luật.
3. **Luật mới chỉ là ứng viên, có bộ đếm.** ExpeL cho mục mới bắt đầu ở 2 điểm và xoá khi về 0. Bị phản bác thì hạ điểm. Sở thích có trôi theo thời gian (2504.14225, 2502.09597).
4. **Chủ shop xem, sửa và duyệt trước khi luật có hiệu lực. Không bao giờ tối ưu agent theo lời khen.** OpenAI ghi nhận phần thưởng 👍/👎 và trí nhớ đã làm sycophancy nặng hơn (openai.com/index/expanding-on-sycophancy).
5. **Chỉ người có quyền duyệt trong workspace mới tạo được luật.** Vai trò owner, manager và reviewer đều duyệt được. Mỗi luật ghi rõ vai trò của người tạo, và phạm vi của luật không vượt quá vai trò đó. Không dùng output của chính agent làm bằng chứng. Socrates kiểm bằng artifact và cặp đối chứng đã ghi, không dựa vào ý kiến, và chạy trên họ model khác với agent tạo nội dung. Tấn công MINJA (2503.03704) cấy được trí nhớ độc chỉ qua câu hỏi thường. Tỉ lệ cấy thành công trên 95%; tỉ lệ tấn công đạt mục đích thấp hơn, khoảng 60 đến trên 90% tuỳ thiết lập.

## 4. Vòng nâng cấp: "Sổ tiêu chuẩn"

```mermaid
flowchart LR
  A[Tín hiệu: duyệt / từ chối / sửa / "đừng…"] --> B{Bộ phân loại nhỏ + luật<br/>có ngưỡng, được phép bỏ qua}
  B -- yếu / cam chịu --> C[Chỉ cập nhật bộ đếm]
  B -- mạnh --> D[Ghép cặp đối chứng<br/>bản bị sửa ↔ bản được duyệt]
  D --> E[LLM rẻ, 1 lần/ngày:<br/>ADD / UPDATE / INVALIDATE / NOOP theo ID mục]
  E --> F[Socrates phản biện bằng bằng chứng<br/>ACCEPT / NARROW / NEED-MORE / REJECT]
  F --> G{Tầng research R0/R1/R2}
  G --> H[Chủ shop: xem diff, sửa, duyệt]
  H --> I[Áp dụng: chèn mục active S4<br/>+ kiểm tra sau khi tạo, mở rộng Brand Guardian]
  I --> J[Đo: duyệt lần đầu, số vòng sửa, lỗi bị nhắc lại]
  J --> K[Job ban đêm: tăng/giảm điểm, đánh dấu cũ, thay thế, snapshot]
  K --> E
```

### 4.1 Ai làm gì (theo kiểu JCC)

| Bước | Ai làm | Vì sao |
|---|---|---|
| Bắt và phân loại tín hiệu | Code (luật) + bộ phân loại nhỏ có ngưỡng, được trả "không chắc" | Lặp rất nhiều lần, cần ổn định và rẻ. Sai thì chỉ bỏ sót, không tạo luật |
| Ghép cặp đối chứng, merge mục, dedup | Code | Xác định, test được |
| Viết tiêu chuẩn ứng viên | LLM rẻ, gom 1 lần/ngày (khung S2 sẵn có) | Cần viết chữ. Delta theo ID thay vì viết lại toàn bộ (ACE) |
| Phản biện | Socrates, khác họ model | Tự sửa không có phản hồi ngoài thì thất bại (2310.01798) |
| Research | Chỉ cho "quy trình" và "cổng chất lượng" có tác động | Tiết kiệm. Sở thích văn phong không cần research |
| Duyệt | Chủ shop | Chịu trách nhiệm; chống nịnh |
| Áp dụng và kiểm tra | Code chèn mục + checker sau khi tạo | Checker chỉ cảnh báo, không tự chặn nếu chủ shop chưa bật |
| Đo và tuyển chọn | Code (bộ đếm) + job ban đêm | Giữ hay bỏ dựa trên giá trị đo được, không dựa trên tuổi |

**Ngân sách gọi model (cần anh quyết).** Luật hiện tại cho phép 1 lần gọi/ngày cho việc chắt lọc của mọi agent. Socrates và research là các lần gọi *thêm*. Có hai phương án:

- **A (đề xuất):** trong sản phẩm, thêm tối đa 1 lần gọi phản biện mỗi ngày, gom mọi ứng viên, chạy trên họ model khác. Research R1/R2 chỉ chạy khi chủ shop bấm "Tra cứu thêm", có trần theo ngày. Cũng dừng khi gặp 402.
- **B:** giữ đúng 1 lần/ngày. Phản biện chỉ là kiểm tra bằng luật trong code: đủ cặp đối chứng, không mâu thuẫn, đúng phạm vi. Socrates và research chỉ chạy phía công cụ dev.

**Tầng research.** R0: sở thích thuần ("câu ngắn hơn") thì không research. R1: tiêu chuẩn về nội dung marketing, quảng cáo hoặc tuyên bố thì tra 1–2 nguồn. R2: quy trình đổi cách làm việc (như cổng Jev, như vẽ sơ đồ rồi chia việc) hoặc chạm luật (ví dụ Luật AI 134/2025 bắt công bố AI) thì research sâu nhiều nguồn, kèm Socrates.

**Ba loại tiêu chuẩn.** Đây là cách hiểu ý "như JEV hay vẽ sơ đồ và phân bổ công việc":

- *Sở thích*: văn phong, độ dài, giọng.
- *Quy trình*: cách làm một việc. Ví dụ: gác cổng bằng một con số đã hiệu chỉnh; vẽ sơ đồ trước rồi mới chia việc.
- *Cổng chất lượng*: điều kiện kiểm tra được trước khi giao.

Loại quy trình có giá trị cao nhất. Nó giống "thư viện kỹ năng" (Voyager 2305.16291, AWM 2409.07429): chỉ thêm vào sau khi đã kiểm chứng.

## 5. Bộ nhớ chuyên gia: giữ gì, bỏ gì

### 5.1 Tám nguyên tắc (mỗi nguyên tắc có nguồn)

1. **Lưu mục, không lưu một khối hồ sơ.** Mỗi lần chỉ gửi thay đổi theo ID mục. Code merge. Màn duyệt hiện diff từng mục. ACE (2510.04618), trong một case study: viết lại toàn khối làm bộ nhớ co từ 18.282 xuống 122 token, độ chính xác rơi 66,7 → 57,1, thấp hơn mức không có bộ nhớ (63,7).
2. **Vô hiệu hoá, không xoá.** Mục mâu thuẫn được gắn `invalid_at` và `superseded_by`, lịch sử vẫn giữ (Graphiti/Zep 2501.13956). Chỉ xoá cứng khi dính PII hoặc khi chủ shop yêu cầu.
3. **Nhận mục mới dựa trên kết quả, không dựa trên lời chat.** Xiong et al. (2505.16067), Table 1: thêm tất cả thì 2.411 mục và 13,05%; chỉ thêm qua bộ lọc chặt thì 1.012 mục và 38,50%. Lưu ý: "bộ lọc chặt" ở đây là oracle mô phỏng người duyệt. Thêm tất cả thì lỗi cộng dồn.
4. **Giữ thất bại thành mục "bẫy", có giới hạn.** Tối đa 3 mục mỗi sự kiện, có dedup. ReasoningBank: thêm thất bại thì 46,5 → 49,7.
5. **Loại bỏ theo giá trị, không theo tuổi.** Mỗi mục có bộ đếm hữu ích/có hại. Chỉ loại khi đã được dùng ≥n lần mà giá trị thấp. Độ mới chỉ dùng để xếp hạng (ExpeL, ACE). Xiong et al., Table 2 (EHRAgent): cùng bộ lọc thêm chặt, có xoá theo giá trị thì từ 1.012 mục / 38,67% lên 248 mục / 42,34%. Cũng bài này: để GPT-4o-mini tự quyết xoá thì làm hỏng một agent khác. Đường quên Ebbinghaus chưa có bằng chứng tách riêng.
6. **Ghi nguồn và độ tin.** Lời chủ shop > kết quả thật > suy luận của agent. Không nạp lại output của chính agent làm bằng chứng. Mục chưa kiểm chứng thì hết hạn. Snapshot trước mỗi lần chạy (OWASP Agentic ASI06, MemOS 2507.03724).
7. **Trí nhớ là dữ liệu.** Lọc PII bằng code trước khi ghi, không chỉ trông vào LLM. Riêng về tiêm độc: MINJA (2503.03704, Table 5, RAP) cho thấy dò bằng LLM không tin được. Prompt dò nhắm đích chỉ phát hiện 0/135 ca; prompt chung phát hiện 53/135. Vì vậy chặn từ gốc: chỉ người có quyền duyệt mới tạo được luật.
8. **Một lần gọi nền mỗi ngày.** Merge và dedup bằng code (LightMem 2510.18866; Letta sleep-time 2504.13171). Khớp luật chi phí hiện có của izzi.

### 5.2 Vòng đời và schema mục

`quan sát (thô, trên máy, hết hạn sau 30 ngày)` → `ứng viên` → `đang dùng` → `cũ (đến hạn xem lại)` → `bị thay thế` / `rút lại` (giữ lịch sử). Vòng đời này khớp với kho Codex đang chạy, nên hai phía dùng chung một ngôn ngữ.

```
StandardItem {
  id, agentId, scope { taskType, channel? },
  kind: preference | procedure | quality_gate | pitfall,
  statement (≤200 ký tự), check (cách kiểm tra tuân thủ),
  evidence: [{ eventId, type: edit|reject|approve_after_reject|correction|outcome, at }],
  counters { helpful, harmful, uses }, trust: owner | outcome | inference,
  status, validFrom, invalidAt?, supersededBy?,
  critic { verdict, model, at }, research { tier, refs[] }
}
```

**Kho mục tách khỏi khối chèn.** S4 chỉ chèn ≤1000 ký tự, tức khoảng 5 mục. Vì vậy:

- kho giữ mọi mục;
- khối chèn chọn top-k mục đang dùng *đúng phạm vi* của việc hiện tại, theo thứ tự: điểm hữu ích, độ tin, độ mới;
- mục không được chọn vẫn nằm trong kho, không bị mất.

Trên MyGraph: mỗi agent có 1 node "Tiêu chuẩn · <agent>". Node này là *hình chiếu* của các mục đang dùng, ghi tối đa 1 lần/ngày khi fingerprint đổi (giống `care-graph-publisher`). Nguồn sự thật vẫn nằm trên máy.

## 6. Luật cứng mang theo (giữ nguyên từ S1–S4)

- Không PII (tên/tin nhắn khách, SĐT, Zalo, email, PSID, token) trong mục, prompt, log hay MyGraph. Không lấy dữ liệu Chăm sóc khách hoặc inbox làm đầu vào.
- Mục là dữ liệu, không phải lệnh. Không bao giờ cho phép gọi tool. Content Agent không dùng. Director chỉ nhận dưới dạng gợi ý. Hermes giữ bộ nhớ riêng.
- Chi phí: 1 lần gọi model/ngày cho mọi agent. Dừng khi gặp 402. Ghi MyGraph ≤1 lần/ngày.
- **Bộ phân loại trong sản phẩm chạy trên máy** (luật + model rẻ đã có). Jev (TypeSafe) là API bên ngoài: chỉ dùng ở phía công cụ dev, hoặc khi chủ shop đồng ý gửi dữ liệu ra ngoài.
- Phát hành bản desktop cần anh OK riêng.

## 7. Lộ trình trên nhánh `feature/izzi-v2-agent-maturity`

Mỗi slice là một PR vào nhánh dài hạn. Viết theo TDD, cờ tắt mặc định. Mỗi tuần merge `main` vào nhánh để không trôi xa. Chỉ lên `main` và phát hành khi cả một mức đạt cổng và anh OK.

| Slice | Nội dung | Cổng ra (đo được) | Mức |
|---|---|---|---|
| **V-1** | **Cho L4 chạy thật**, không viết code. Anh duyệt 1–4 hồ sơ đang chờ. Quan sát S4 chèn hồ sơ trong lượt làm việc thật. Ghi lại chất lượng câu trả lời trước và sau | Có bằng chứng S4 chèn đúng, không lộ PII, không làm hỏng câu trả lời. Nếu lộ lỗi thì vá nhỏ trước | xác nhận L4 |
| **V0** | Bộ dữ liệu vàng + baseline, chỉ đọc. **Đếm số sự kiện sản phẩm có thật trước** (duyệt/từ chối chiến lược, duyệt bản nháp, duyệt/từ chối Marketing Resources, câu sửa trong chat), rồi mới chốt cỡ tập nhãn. 290 câu lệnh dev là tập đánh giá **riêng**, không trộn. Đo baseline: duyệt lần đầu, số vòng sửa | Phân loại "mạnh" có precision ≥0,9 trên tập giữ riêng. **0 lỗi nghiêm trọng** (cam chịu không bao giờ bị tính là duyệt) | nền |
| **V1** | Sổ sự kiện phản hồi trên máy: SQLite theo tài khoản, đã lọc PII, hết hạn sau 30 ngày. Hai thay đổi đầu vào:<br/>- UI duyệt/từ chối chiến lược hiện **không gửi ghi chú**, nên thêm ô lý do (tuỳ chọn) khi từ chối;<br/>- bản nháp hiện chỉ có nút duyệt: **dùng lại** luồng submit/approve/reject có revision của Marketing Resources thay vì làm nút mới, nếu hợp | Đủ 5 loại sự kiện, mỗi sự kiện ghi vai trò người duyệt. Lọc PII 100% trên tập test | L5 |
| **V2** | Chuyển S2 từ "viết lại toàn khối" sang kho mục có ID + delta. Tách kho mục khỏi khối chèn top-k. Màn duyệt hiện diff từng mục. Phải xong **trước khi** S3 bật chế độ Tự động | Không mất mục nào trong kho qua 10 lần chạy. Khối chèn luôn ≤1000 ký tự. Mục bị loại khỏi khối chèn có ghi lý do | sửa L3–L4 |
| **V3** | Tiêu chuẩn ứng viên từ cặp đối chứng, bộ đếm kiểu ExpeL, Socrates phản biện, tầng research | Mọi ứng viên đều có ≥1 cặp đối chứng và có verdict | L5 |
| **V4** | Áp dụng mục đang dùng + checker tuân thủ sau khi tạo (mở rộng Brand Guardian, chỉ cảnh báo) | Đo được tỉ lệ vi phạm tiêu chuẩn | L5 |
| **V5** | Job ban đêm (S3): giá trị/điểm, cũ, thay thế, snapshot/rollback. Chiếu sang MyGraph. Bảng số đo | **Lỗi bị nhắc lại giảm** so với baseline V0 | L5 → L6 |
| **V6** | Tự động áp dụng mục sở thích rủi ro thấp sau ≥3 lần xác nhận. Chia sẻ quy trình giữa các agent. Test hồi quy cho từng tiêu chuẩn. Báo cáo trưởng thành hằng tháng | Duyệt lần đầu tăng và giữ được ≥2 tháng | tiệm cận L6 |

Thứ tự đề xuất:

1. **V-1** trước tiên: rẻ nhất, và đúng Small Release Loop.
2. Sau đó **V0 + V2**. V0 cho dữ liệu thật để thiết kế không đoán mò. V2 gỡ rủi ro trước khi bật chế độ Tự động.

## 8. Quyết định cần anh chốt

1. Thang L0–L6 ở mục 2 có đúng ý "Lv5/Lv6" của anh không? Nếu anh đã có định nghĩa riêng, gửi để tôi khớp lại.
2. Làm cho sản phẩm izzi 2.0 trước, dùng phiên dev của anh làm dữ liệu dogfood (đề xuất)? Hay áp vòng này cho agent dev (Claude/Codex) trước?
3. Có thêm tín hiệu "sửa / từ chối" cho bản nháp, kèm ô lý do khi từ chối chiến lược không? Theo nghiên cứu, đây là tín hiệu mạnh nhất. Đây là thay đổi UI; ưu tiên dùng lại luồng review của Marketing Resources.
4. Anh duyệt 1–4 hồ sơ đang chờ để chạy V-1 ngay? Sau đó làm V0 + V2?
5. Ngân sách gọi model: phương án A hay B ở mục 4.1?
6. Cách làm nhánh: nhánh dài hạn, mỗi tuần merge `main` vào, chỉ phát hành khi đạt mức. Cách này lệch với "Small Release Operating Loop" trong CLAUDE.md, vốn đẩy từng slice lên `main`. Phương án thay thế: mỗi slice lên `main` sau cờ tắt.

## 9. Nguồn chính

Học từ người dùng:
- PRELUDE/CIPHER https://arxiv.org/abs/2404.15269
- Naturally occurring feedback https://arxiv.org/abs/2407.10944
- WildFeedback https://arxiv.org/abs/2408.15549
- ReSpect https://arxiv.org/abs/2410.13852
- Sở thích trôi theo thời gian: https://arxiv.org/abs/2504.14225 và https://arxiv.org/abs/2502.09597

Kinh nghiệm và chọn lọc:
- ExpeL https://arxiv.org/abs/2308.10144
- ReasoningBank https://arxiv.org/abs/2509.25140
- ACE https://arxiv.org/abs/2510.04618
- Xiong et al. https://arxiv.org/abs/2505.16067
- Mem0 https://arxiv.org/abs/2504.19413 (số liệu do chính nhà cung cấp công bố)
- Zep/Graphiti https://arxiv.org/abs/2501.13956 (số liệu do chính nhà cung cấp công bố)
- Voyager https://arxiv.org/abs/2305.16291
- AWM https://arxiv.org/abs/2409.07429
- Generative Agents https://arxiv.org/abs/2304.03442
- MemOS https://arxiv.org/abs/2507.03724
- LightMem https://arxiv.org/abs/2510.18866
- Letta sleep-time https://arxiv.org/abs/2504.13171

Rủi ro:
- Sycophancy, OpenAI https://openai.com/index/expanding-on-sycophancy/
- Sycophancy https://arxiv.org/abs/2310.13548
- MINJA https://arxiv.org/abs/2503.03704
- AgentPoison https://arxiv.org/abs/2407.12784
- OWASP Agentic ASI06 https://genai.owasp.org/download/52117/
- Tự sửa không có phản hồi ngoài: https://arxiv.org/abs/2310.01798
- Debate so với bỏ phiếu đa số: https://arxiv.org/abs/2508.17536

Chưa kiểm chứng được:
- Nghiên cứu LLM về câu duyệt hoặc cam chịu trong tiếng Việt.
- Socrates có làm tiêu chuẩn cá nhân tốt hơn hay không.
- Bộ phân loại nhỏ đã hiệu chỉnh có dùng được để dò câu duyệt hay không.
- Hiệu quả riêng của đường quên Ebbinghaus.
- Số liệu Mem0 và Zep được bên độc lập lặp lại.
- Kết quả trên benchmark có chuyển sang marketing SME Việt Nam hay không.
- Trạng thái hồ sơ hôm nay, cùng số node (339/272) và số test (3509): lấy từ ghi chép phiên trước, chưa đo lại hôm nay.

Phản biện: Socrates đã review bản nháp đầu, verdict ACCEPT-WITH-FIXES (3 HIGH, 5 MEDIUM, 2 LOW). Bản này đã sửa cả 10 điểm. Số liệu mục 3.1 đã chạy lại bằng script đã sửa, và khớp với số Socrates tự đếm (290 so với 289 câu).
