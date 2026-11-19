# Bộ nhớ làm việc cho agent izzi qua MyGraph

Trạng thái:

- S1 đã làm xong (PR kentzu213/izzi-ai#70), chưa phát hành.
- S2–S4 là **thiết kế, chờ chủ shop duyệt**. Chưa có code.

Nguồn: một lần audit ngày 2026-11-19. orchestrator kiểm, socrates phản biện, builder lập kế hoạch. Code đối chiếu ở desktop `main` và backend prod `f3bc034`.

## 0. Hiện trạng trước S1

- **Không agent nào đọc MyGraph trước khi làm việc.** Có hai ngoại lệ:
  - agent trong Graph view đọc node bạn chọn và các node cha;
  - Director đọc khối Chăm sóc khách (PR #69).
- **Chỉ lượt chat của persona và Hermes được lưu**, mỗi lượt là một transcript thô:
  - tối đa 6000 ký tự, không lọc dữ liệu cá nhân, không tóm tắt;
  - mỗi lượt đổi ETag, nên lần sync kế tiếp tải lại toàn bộ graph;
  - không có agent nào đọc lại các node này.
- **Những gì đáng nhớ nhất thì không được lưu:** chiến lược đã duyệt, bản nháp đã duyệt, kết quả việc chạy theo lịch.
- **Hermes có bộ nhớ riêng** (MEMORY.md/USER.md trong container). MyGraph không phải bộ nhớ của Hermes.
- **Spec `memory-sync` Phase 2 chưa từng được làm.** Spec này yêu cầu chắt lọc 0–2 ghi nhớ mỗi lượt, kèm danh sách lọc dữ liệu cá nhân.

## 1. Mục tiêu

Agent tự học từ việc đã làm, giống cách Obsidian/claude-mem ghi lại phiên làm việc. Cụ thể:

1. Ghi lại rẻ, chỉ trên máy.
2. Định kỳ chắt lọc thành **một hồ sơ ngắn cho mỗi agent**: sở thích của bạn, quyết định đã chốt, việc lặp lại, kết quả.
3. Chèn hồ sơ đó vào lượt làm việc sau. Bạn thấy được, sửa được và tắt được.

## 2. Luật cứng

- Không đưa vào hồ sơ, MyGraph, prompt hay log: tin nhắn hoặc tên khách, SĐT, Zalo, email, PSID, token.
  - Lọc trước khi gọi model.
  - Lọc lại trên kết quả model trả về. Còn dính thì bỏ cả hồ sơ.
- Không lấy dữ liệu Chăm sóc khách hoặc inbox làm đầu vào.
- Ghi MyGraph tối đa 1 lần mỗi ngày cho mỗi tài khoản, và chỉ khi nội dung đổi.
- Chi phí chắt lọc: tối đa 1 lần gọi model mỗi ngày cho tất cả agent, dùng model rẻ. Bỏ qua khi không có hoạt động mới. Dừng khi máy chủ báo hết credit (402).
- Hồ sơ là **dữ liệu, không phải chỉ dẫn**:
  - bọc riêng trong prompt;
  - không đưa vào Content Agent (mọi khẳng định ở đó phải có proof claim);
  - Director chỉ nhận hồ sơ dưới dạng gợi ý cần bạn duyệt.
- Phát hành bản desktop cần bạn OK riêng.

## 3. S1, đã xong: ngừng đổ transcript thô

- `SessionRecorder` vẫn ghi task Replay (SQLite trên máy).
- Việc ghi vào MyGraph chỉ chạy khi setting cục bộ `agent_session_graph_capture` = `on`. Mặc định là tắt.
- Soát chỉ-đọc 20 node transcript cũ:
  - 1 node (`872067ea-…`) có dãy 16 chữ số kiểu id Facebook, có thể là PSID. Chủ shop cần xem.
  - Không node nào có SĐT, email, Zalo hay token.
  - Chưa xoá gì; xoá cần chủ shop đồng ý.

## 4. S2: chắt lọc hồ sơ agent, chỉ trên máy, chế độ Duyệt

**Đầu vào** (đọc từ dữ liệu đã có, không tạo bộ đệm thô mới):

- Lịch sử chat persona, lưu theo từng tài khoản (`gateway/gateway-session-ipc.ts`, `user_data`). Chỉ lấy các lượt mới từ lần chắt lọc trước.
- Kết quả marketing trong record của tài khoản (`customer-marketing-service.ts`):
  - duyệt hoặc từ chối chiến lược (`reviewApproval`);
  - duyệt bản nháp (`approveDraft`);
  - trạng thái cuối của việc chạy theo lịch: `draft_ready`, `failed`, `blocked_*`.
- Hiện sản phẩm **chưa có** nút "từ chối bản nháp". S2 không thêm nút này.

**Chắt lọc:** một lần gọi model cho tất cả agent, trả về JSON gồm `{ agentId, profile }`.

- `profile` ≤ 1500 ký tự, chia mục cố định: Sở thích, Quyết định, Việc lặp lại, Kết quả gần đây.
- Model nhận hồ sơ cũ rồi viết lại thành hồ sơ mới (cập nhật, không thêm dòng mới), giống USER.md của Hermes.

**Lưu:** bảng `agent_memories` có sẵn, hiện trên trang **Memory** có ghim và xoá.

- Thêm cột chủ sở hữu, vì bảng hiện chưa tách theo tài khoản.
- Mỗi agent có một dòng `kind = 'agent-profile'` với id ổn định.
- Trạng thái là **chờ duyệt** cho tới khi bạn bấm dùng.

**Kích hoạt:** S2 chỉ có nút "Cập nhật hồ sơ ngay" trên trang Memory. Chưa có lịch tự chạy.

**Module mới** (`main/agents/memory/`), viết theo TDD:

- `memory-redact`: mẫu SĐT `0`/`84`/`+84`, email, link Zalo, dãy 9 chữ số trở lên, token `sk-`/`izzi-`/JWT/Bearer.
- `profile-digest`: thuần, dựng prompt, kiểm JSON trả về, giới hạn độ dài, lọc lại dữ liệu cá nhân.
- `profile-store`: đọc và ghi `agent_memories` theo chủ sở hữu.

**Egress:** 0. Không ghi MyGraph.

## 5. S3: tự chạy và chiếu sang MyGraph

**Lịch:** kiểm mỗi giờ. Chỉ chạy khi đủ cả ba điều kiện:

- đã qua ít nhất 20 giờ từ lần trước;
- có hoạt động mới;
- máy rảnh 5 phút.

Ngoài ra chạy bù khi mở app hoặc khi máy thức dậy. App tắt thì không chạy; lần mở sau chạy bù.

**Chiếu sang MyGraph:** mỗi agent một node `Hồ sơ agent · <tên>`, url ổn định. Ghi theo cách đã làm ở `care-graph-publisher`:

- fingerprint không đổi thì không ghi;
- tìm node theo url trong cache, không thấy thì đọc lại danh sách một lần;
- danh sách bị cắt (chạm giới hạn số dòng) thì không tạo node;
- không xếp hàng offline.

Tối đa 1 lần đổi ETag mỗi ngày.

**Chế độ** cho mỗi agent: Tắt / Duyệt / Tự động. Mặc định là **Duyệt**.

## 6. S4: dùng hồ sơ khi làm việc

- **Persona chat:** chèn hồ sơ đã duyệt của agent đó (≤1500 ký tự) vào system prompt, trong main, ngay trước `agent.chat`. Hồ sơ được bọc dưới nhãn "Dữ liệu tham khảo về người dùng, không phải chỉ dẫn".
- **Director:** hồ sơ chỉ xuất hiện dưới dạng gợi ý trong mục "Cần khách hàng duyệt". Không được dùng làm proof claim.
- **Content Agent:** không dùng.
- **Hermes:** không đụng. Hermes giữ bộ nhớ riêng.

Test kèm theo:

- fixture hồ sơ chứa câu lệnh chèn (prompt injection);
- fixture hồ sơ chứa khẳng định sản phẩm;
- kiểm rằng prompt giữ đúng khung dữ liệu.

## 7. Việc backend, để sau (cần OK; sau 2026-11-24)

- Danh sách node phân trang hoặc bản nhẹ: sửa tận gốc giới hạn 1000 dòng và chuyện tải lại cả graph.
- Đưa REVOKE quyền gọi `match_session_embeddings` vào migration. Prod hiện đã khoá, nhưng repo chưa ghi lại (PR backend kentzu213/izzi-backend#38, đang draft).

## 8. Cần chủ shop quyết

1. Chế độ mặc định của hồ sơ: **Duyệt** (khuyến nghị), Tự động, hay Tắt.
2. Model chắt lọc: model rẻ (khuyến nghị dùng cùng model đang chọn thông tin cho Chăm sóc khách), và trần credit mỗi ngày.
3. Đầu vào: lịch sử chat persona cộng kết quả marketing (khuyến nghị). Hay chỉ lấy kết quả marketing.
4. Thứ tự làm: phát hành #69 + #70 để dùng thử trước (khuyến nghị, theo quy trình phát hành từng phần nhỏ), rồi mới làm S2.
