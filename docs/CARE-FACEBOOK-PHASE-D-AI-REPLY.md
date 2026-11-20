# Customer Care Phase D: izzi hiểu hội thoại bằng AI, trả lời bằng thông tin đã duyệt

Trạng thái: **thiết kế v2 đã duyệt** (chủ shop, 2026-11-19: "Duyệt theo đề xuất"). Đã sửa theo review độc lập (socrates: ACCEPT WITH FIXES).

**Tiến độ (2026-11-20):** D1 đã chạy trên prod (`rc-395d26e`). Echo của nhân viên/Pancake và quảng cáo đã về thật lúc 12:06 UTC. D2 backend đã code xong, chưa migration, chưa deploy, chưa bật (xem "D2 backend" bên dưới).

**Thay đổi so với thiết kế (sau security review D2):** AI **không còn viết câu dẫn tự do** (`ack`). Nó chọn một câu mở đầu có sẵn của máy chủ (`opener`). Lý do: reviewer lách được bộ lọc câu tự do bằng nhiều cách: chữ không dấu ("muoi sau trieu"), ký tự tách dấu hoặc vô hình, chữ Cyrillic giả chữ Latin, "bit.ly", câu "Dạ có ạ" (ngầm khẳng định còn hàng hoặc có ship), và token `[TÊN]` lọt ra cho khách. Danh sách từ cấm không bao giờ đủ. Giờ **mọi chữ khách đọc** chỉ có thể là câu của máy chủ hoặc nguyên văn thông tin đã duyệt.

**Quyết định đã chốt (mục 10):**
1. izzi chịu chi phí AI trong giai đoạn thử.
2. Đồng ý gửi tin khách tới nhà cung cấp AI ở nước ngoài qua OpenRouter, với ZDR và đã che SĐT, Zalo, tên.
3. Nhân viên hoặc Pancake trả lời thì izzi dừng hẳn với khách đó (phương án A).
4. AI lỗi từ tin thứ hai thì izzi im lặng.
5. Giữ tối đa 3 tin mỗi khách trong 24 giờ.
6. Chưa đặt giờ làm việc: câu chuyển nhân viên không nhắc giờ.

**D1 (backend, chưa đổi cách trả lời), 2026-11-19, chưa deploy:**
- Migration `20261122_customer_care_conversation_context.sql`:
  - bảng `customer_care_page_messages` (tin Page gửi khách, niêm phong);
  - bảng `customer_care_customer_referrals` (quảng cáo khách bấm vào);
  - cột `customer_care_outbound_messages.echoed_at`;
  - hàm `customer_care_record_page_message`, `customer_care_record_referral`, `customer_care_flag_missing_echoes`.
- Trigger xoá theo khách được mở rộng sang hai bảng mới. Hai bảng cũng được dọn sau 30 ngày.
- Chỉ lưu cho khách đã có tin nhắn. Tin của chính izzi chỉ đánh dấu `echoed_at`.
- Page được đăng ký `messages,standby,message_echoes,messaging_referrals` mỗi khi bật "Nhận tin nhắn". Tắt trả lời tự động không còn đổi danh sách field.
- Kiểm tra: PGlite 52/52 cho D1 và 81/81 cho Phase C (đã áp D1). Security review: không có CRITICAL/HIGH; đã sửa 2 MEDIUM (echo về sớm hơn lúc ghi `mid`; một mục lỗi làm hỏng cả lượt) và các LOW (index, ký tự vô hình, kết quả quảng cáo cũ).

**D2 backend (2026-11-20, chưa migration, chưa deploy, chưa bật):**
- **Chạy AI ở đâu:** `CUSTOMER_CARE_AI_ENABLED=true` cộng key OpenRouter **riêng** (`CUSTOMER_CARE_AI_OPENROUTER_KEY`), `CUSTOMER_CARE_AI_MODEL`, tùy chọn `CUSTOMER_CARE_AI_FALLBACK_MODEL`. Thiếu bất kỳ cái nào thì luật Phase C trả lời như cũ.
  - Key trùng với pool bán lại (`OPENROUTER_API_KEYS`) bị từ chối.
  - Model có hậu tố `:online` hoặc `:nitro`, hay `openrouter/auto`, bị từ chối.
- **Gọi AI:** mỗi lần đều có `provider: { zdr: true, data_collection: "deny", require_parameters: true }` và JSON schema strict. Không ghi log key, prompt hay câu trả lời.
- **Che dữ liệu trước khi gửi:**
  - số điện thoại thành `[SĐT]`, kể cả dạng có ngoặc, có (+84), số cố định, chữ số toàn bề rộng, số đọc bằng chữ;
  - dãy 9–15 chữ số khác (số tài khoản, CCCD) thành `[SỐ]`;
  - email thành `[EMAIL]`, link và @handle thành `[LINK]`;
  - tên sau "anh/chị/ông/…" hoặc "tên là…" thành `[TÊN]`; tên viết hoa toàn bộ cũng che;
  - tin dài hơn 2000 ký tự bị cắt trước khi che.
- **AI trả về:** `intent`, `factIds` (tối đa 3, chỉ thông tin chưa gửi), `opener` (id câu mở đầu), `askContact`, `handoff`, `factGap`. Có câu báo trợ lý tự động.
  - Câu mở đầu phải khớp loại thông tin đi sau ("Dạ về giá…" chỉ khi có thông tin giá), sai thì dùng câu chung.
  - Không xin số khi tin trước của izzi hoặc tin gần nhất của nhân viên/Pancake đã xin.
- **Thời gian:**
  - chờ khách ngừng gõ 4 giây (tối đa 8 giây); hạn chót = lúc khách gửi + 25 giây;
  - mỗi lần gọi AI tối đa min(8 giây, thời gian còn lại − 5 giây); model dự phòng chỉ chạy khi còn hơn 10 giây;
  - có `typing_on`, không `mark_seen`;
  - khách nhắn thêm trong lúc izzi soạn: bỏ lượt đang soạn (`superseded`), và lượt mới chạy ngay sau đó.
- **Khi AI lỗi:** tin thứ nhất dùng luật Phase C kèm câu báo trợ lý; từ tin thứ hai im lặng (`ai_unavailable`). Chuyển nhân viên thì dừng hội thoại (`handoff`).
- **Migration `20261123_customer_care_ai_reply.sql`:**
  - cột cách viết tin (`composer`, `disclosed`, `asked_contact`, `ai_intent`, `fact_gap_sealed` niêm phong);
  - lý do dừng `handoff`;
  - các hàm `customer_care_auto_reply_context`, `customer_care_note_ai_reply`, `customer_care_auto_reply_superseded`;
  - thống kê không tính `nothing_to_say` hay `superseded` là sự cố.
- **Bộ chấm:** 44 tình huống, nhân thành 205 biến thể. Lệnh chạy: `npx tsx scripts/care-ai-eval.ts`. Mọi dòng không phải câu máy chủ hoặc nguyên văn thông tin đã duyệt đều tính là lỗi nghiêm trọng.
- **Kiểm tra:**
  - tsc sạch; 2373 test vitest qua;
  - PGlite: D2 32/32, D1 52/52 và Phase C 81/81 khi đã áp D2;
  - security review 2 vòng: vòng 1 có 3 HIGH, đã sửa và vòng 2 xác nhận; vòng 2 có 3 MEDIUM, đã sửa.
- **Còn lại trước khi bật:**
  - chủ shop tạo key OpenRouter riêng, bật ZDR cho cả tài khoản;
  - chạy bộ chấm, chọn model;
  - công cụ chạy lại trên hội thoại thật;
  - chủ shop xem kết quả rồi mới bật.

Công tắc "Tự động trả lời khách" vẫn tắt.

## 1. Vì sao cần Phase D

Ngày 2026-11-19 lần đầu chạy với khách thật trên Page Hồng Hưng (khách vào từ quảng cáo "Cội nguồn quê hương"). Chủ shop đánh giá: "rất tệ, cứng nhắc, không đọc tin, không học được gì".

| Khách nhắn | izzi Phase C trả lời | Nguyên nhân gốc |
|---|---|---|
| "Tôi muốn mua Tranh 'Quê Hương'?" | "Về câu hỏi của anh/chị, nhân viên sẽ kiểm tra…" | So từ khoá: 2 thông tin "Cội nguồn quê hương" (khung đồng, khung gỗ lim) hoà nhau nên không chọn cái nào. Không biết khách đến từ quảng cáo nào. |
| "bao tiền vậy" | "Về giá, nhân viên…" | Thông tin giá không trùng từ khoá (đã vá trong `f7bd66e`). |
| "tôi xem rồi" / "đang hỏi giá bao nhiêu" | Lặp y nguyên tin trước | Không nhớ đã gửi gì; mọi tin đều kết thúc bằng câu xin số. |
| Tin mẫu Pancake "A cho em xin số zalo nhé…" chen giữa | Xin số lần nữa | Echo chưa từng về prod. Vì vậy luật Phase C "nhân viên trả lời thì izzi dừng" **chưa bao giờ thật sự chạy**. |

## 2. Hướng thiết kế (đã đổi sau review)

**AI hiểu, máy chủ viết.** AI không tự viết nội dung tin; nó chỉ:
1. hiểu khách hỏi gì, dựa trên cả hội thoại và quảng cáo khách bấm vào;
2. chọn đúng các thông tin đã duyệt cần gửi;
3. viết một câu dẫn ngắn tự nhiên, không chứa số hay liên hệ;
4. quyết định có xin số hay không, và có cần nhờ nhân viên không.

Máy chủ ghép tin từ câu dẫn, **nguyên văn** thông tin đã duyệt, và câu xin số cố định.

Lý do bỏ hướng "AI viết tự do + kiểm tra sau": kiểm tra không bắt được số viết bằng chữ ("mười sáu triệu", "16 củ"), số sai đơn vị ("120x80cm" lọt thành "120 triệu"), hay các khẳng định không có số ("còn hàng", "miễn phí lắp đặt", "mai giao"). Bản nháp desktop đã làm đúng cách này (`customer-care-service.ts`: model chỉ trả `factIds`).

Ví dụ ca "Quân Già" sau Phase D:

> Dạ em là trợ lý tự động của Đồng Thờ Hồng Hưng ạ. Mẫu Cội nguồn quê hương bên em có loại khung đồng và loại khung gỗ lim ạ.
> *(nguyên văn thông tin khung đồng)*
> *(nguyên văn thông tin khung gỗ lim)*
> Anh/chị để lại số điện thoại hoặc Zalo, nhân viên tư vấn sẽ gửi ảnh, video mẫu và báo giá theo kích thước ạ.

Khách hỏi tiếp "bao tiền vậy": izzi gửi câu dẫn cùng nguyên văn thông tin giá, và **không** xin số lại.

## 3. Bắt buộc theo luật và Meta

- **Báo là trợ lý tự động (bắt buộc).** Luật Trí tuệ nhân tạo 134/2025/QH15, Điều 11 khoản 1, hiệu lực 1/3/2026, yêu cầu người dùng nhận biết khi đang tương tác với hệ thống AI. Phase D là hệ thống mới nên không hưởng ân hạn của Điều 35. Chính sách Meta cũng bắt buộc báo ở nơi luật yêu cầu.
  - Tin AI đầu tiên của mỗi hội thoại mở đầu bằng "Dạ em là trợ lý tự động của [tên Page] ạ."
  - Báo lại sau 24 giờ im lặng, và khi khách hỏi.
  - Quyết định "không báo" của Phase C không áp dụng cho Phase D. Nên nhờ luật sư xác nhận cách diễn đạt.
- **Phản hồi trong 30 giây** (chính sách Meta): xem mục 5.
- **Echo phải về trước khi bật** (mục 9, bước 0).

## 4. AI làm gì: đầu vào và đầu ra

**Nhà cung cấp:** OpenRouter, với:
- **key riêng** cho Chăm sóc khách hàng, không dùng chung pool key bán lại của izzi API;
- tắt ghi log ở cấp tài khoản;
- bật zero data retention bằng `provider: { zdr: true }` (không phải `data_collection: deny`).

codex-lb **không dùng**: nó chạy trên tài khoản ChatGPT cá nhân, không được đưa dữ liệu khách vào.

Model chọn bằng bộ chấm offline có bật ZDR (mục 8).

**Đầu vào:**
- Thông tin đã duyệt: id, chủ đề, nguyên văn.
- Quảng cáo khách bấm vào: tiêu đề, và các thông tin chủ shop gắn với quảng cáo đó.
- Tối đa 20 tin gần nhất, ghi rõ ai nói: khách, izzi, nhân viên/Pancake.
- Trạng thái: thông tin nào đã gửi, đã xin số chưa, đã báo là trợ lý chưa.
- SĐT, Zalo, email và tên được **che** trước khi gửi cho AI.
- Tin của khách và tin echo được bọc là dữ liệu, không phải lệnh.

**Đầu ra JSON, máy chủ kiểm nghiêm:**

```json
{
  "intent": "price|catalog|quality|policy|contact|buy|complaint|chitchat|other",
  "factIds": ["…"],            // chỉ id có trong danh sách, chưa từng gửi trong hội thoại này, tối đa 3
  "ack": "…",                  // 0–160 ký tự, không chữ số, không số viết bằng chữ, không SĐT/Zalo/email/link
  "askContact": true,          // máy chủ chỉ cho xin khi tin trước của izzi và tin gần nhất của nhân viên/Pancake chưa xin
  "handoff": false,            // khách muốn mua ngay, bực, hoặc hỏi ngoài thông tin đã duyệt
  "factGap": "kích thước tranh" // điều khách hỏi mà shop chưa có thông tin duyệt (chỉ dùng để đếm)
}
```

Sai định dạng hoặc vi phạm bất kỳ ràng buộc nào thì coi như AI lỗi (mục 6).

## 5. Thời gian: một hạn chót duy nhất

- **Hạn chót** = lúc khách gửi tin (`sent_at`) + 25 giây.
- Chờ khách ngừng gõ: 4 giây, tối đa 8 giây kể từ tin đầu chưa trả lời.
- Gọi AI: tối đa 8 giây, hoặc thời gian còn lại trừ 5 giây nếu ít hơn. Model dự phòng chỉ chạy khi còn hơn 10 giây.
- `typing_on` chỉ gửi **sau khi** nhận việc thành công, tức là đã qua mọi điều kiện gửi. Không gửi `mark_seen`, để Pancake không coi tin là đã đọc.
- **Tranh chấp:**
  - Khách nhắn thêm trong lúc izzi đang soạn: lượt đang soạn không bị bỏ. Nó hẹn lại chính nó thay vì trả `busy`.
  - Ngay trước khi gửi, máy chủ kiểm tin mới nhất của khách. Có tin mới thì soạn lại một lần nếu còn hạn; hết hạn thì bỏ lượt.
  - Không bao giờ có hai tin izzi gửi cùng lúc cho một khách.

## 6. Khi AI lỗi hoặc quá giờ

- **Tin thứ nhất của hội thoại:** gửi tin luật cứng Phase C, đã kèm câu báo trợ lý tự động.
- **Từ tin thứ hai trở đi:** **không gửi gì**, ghi `skipped (ai_unavailable)` và tăng số đếm trong app. Không lặp lại tin mẫu mà chủ shop đã chê.

## 7. Nhân viên và Pancake

Đây là quy tắc chủ shop phải chốt (mục 10).

- **Phương án A (đề xuất):** giữ quy tắc Phase C.
  - Echo của nhân viên hoặc Pancake đến hơn 10 giây sau tin khách thì izzi dừng hẳn với khách đó.
  - Echo đến trong vòng 10 giây được coi là tin tự động, izzi đọc làm ngữ cảnh và không xin số lại.
- **Phương án B:** echo chỉ là ngữ cảnh, izzi trả lời tiếp. Nhưng izzi chen ngang nhân viên, khó kiểm soát.
- **Tự kiểm tra:** izzi gửi một tin mà trong 2 phút không thấy echo của chính nó (so `mid` Send API trả về với `mid` của echo), nghĩa là echo đang hỏng. Khi đó công tắc tự tắt, tin đó được ghi `echo_missing`, và app báo lý do. Như vậy luật dừng không bao giờ chạy mù nữa. Đã làm trong D1.
- **Handoff:** izzi không hứa "gọi lại ngay". Câu chuẩn: "Dạ em chuyển câu hỏi cho nhân viên tư vấn; anh/chị để lại số điện thoại hoặc Zalo để nhân viên liên hệ ạ." Sau đó izzi dừng, và app đếm số lần chuyển nhân viên.

## 8. Đo chất lượng trước khi gửi thật

**Bộ chấm offline:**
- Từ 150 biến thể trở lên, dựng từ ca thật của Hồng Hưng. Gồm: hỏi giá không nêu mẫu, hỏi đúng mẫu trong quảng cáo, số viết bằng chữ, khách sốt ruột, khách từ chối, gửi ảnh, Pancake chen vào, prompt injection.
- **Ngưỡng bật:** 0 lỗi gửi sai thông tin hoặc lộ liên hệ; ≥ 90% chọn đúng thông tin; p95 dưới 8 giây (có ZDR).

**Chạy lại trên hội thoại thật:** sau D1, máy chủ đã lưu được hội thoại thật (đọc echo và referral). Lấy các hội thoại đó chạy lại offline, rồi cho chủ shop xem "izzi sẽ trả lời gì" bên cạnh "nhân viên đã trả lời gì".

Cách này thay cho chế độ nháp trực tiếp. Lý do: nhân viên luôn trả lời và echo làm hội thoại dừng, nên chế độ nháp chỉ thu được nháp cho tin đầu tiên.

## 9. Các bước làm (mỗi migration, deploy, phát hành cần chủ shop đồng ý riêng)

0. **Chủ shop:**
   - Tick `message_echoes` và `messaging_referrals` trong Meta Dashboard (Webhooks → Page).
   - Mình kiểm echo về thật trong log trước mọi bước khác.
   - Không bật lại Phase C trước bước này.
1. **Backend D1, chưa đổi cách trả lời:**
   - Đọc chữ echo, lưu niêm phong. Chỉ lưu echo của khách đã có tin nhắn.
   - Đọc `referral` từ `messages`, `messaging_referrals` và postback.
   - Có migration. Bảng mới phải nằm trong trigger xoá theo khách, `customer_care_purge_customer`, `customer_care_delete_facebook_grants`, lệnh dọn 30 ngày, và tôn trọng dấu đã-xoá của B1b.
   - Thêm tự kiểm tra echo (mục 7).
2. **Desktop D1:** gắn quảng cáo với thông tin đã duyệt (tuỳ chọn); hiện số đếm `factGap` ("khách hay hỏi điều shop chưa có thông tin").
3. **Backend D2:**
   - Bộ "AI hiểu, máy chủ viết": key OpenRouter riêng, ZDR, che dữ liệu.
   - Áp hạn chót, xử lý tranh chấp, xử lý khi AI lỗi.
   - Câu báo trợ lý tự động.
   - Bộ chấm offline và công cụ chạy lại.
4. **Chạy bộ chấm và chạy lại trên hội thoại thật** → chủ shop xem và duyệt.
5. **Bật gửi thật trên Hồng Hưng**, theo dõi log.
6. **Cập nhật tài liệu pháp lý:**
   - Chính sách quyền riêng tư: nêu OpenRouter và nhà cung cấp model là bên xử lý; chuyển dữ liệu ra nước ngoài.
   - Gói App Review: các dòng nói "không dùng AI", "không gửi tin" và "không báo bot" không còn đúng.
   - Kiểm tra nghĩa vụ theo luật bảo vệ dữ liệu cá nhân của Việt Nam (chưa xác minh).

**Để sau Phase D:** học từ câu trả lời của nhân viên. Rủi ro là lời hứa riêng với một khách bị biến thành "thông tin chung của shop". Trong Phase D, việc học đi qua `factGap`: izzi cho chủ shop biết khách hay hỏi gì mà shop chưa có thông tin, chủ shop tự thêm.

## 10. Cần chủ shop chốt

1. **Chi phí AI:** izzi chịu trong giai đoạn thử, hay trừ credit của shop. Chi phí mỗi tin rất nhỏ; con số cụ thể có sau bộ chấm.
2. **Đồng ý gửi tin khách tới nhà cung cấp AI ở nước ngoài** qua OpenRouter, có ZDR và đã che SĐT, Zalo, tên.
3. **Nhân viên hoặc Pancake trả lời thì izzi làm gì:** dừng hẳn (A, đề xuất) hay chỉ lấy làm ngữ cảnh (B).
4. **AI lỗi từ tin thứ hai:** im lặng (đề xuất) hay gửi tin mẫu.
5. **Số tin tối đa mỗi khách trong 24 giờ:** giữ 3 (đề xuất) cho tới khi có số liệu.
6. **Giờ làm việc của nhân viên** cho câu chuyển nhân viên, nếu muốn izzi nói "nhân viên sẽ liên hệ trong giờ làm việc".

Không còn là lựa chọn:
- Báo "trợ lý tự động": bắt buộc theo luật (mục 3).
- Dùng codex-lb: không được dùng cho dữ liệu khách (mục 4).
