# Phase C: izzi tự trả lời khách nhắn Page và xin SĐT/Zalo

Nối tiếp `CARE-FACEBOOK-PHASE-B1-LEADS.md`. Kế hoạch gốc (`CARE-FACEBOOK-PAGE-CONNECT-PLAN.md`, mục Phase C) dự định "gửi sau khi người duyệt". Ngày 2026-11-18, chủ shop chọn khác:

- **Tự động tới khi có số.** Mỗi khách nhận tối đa 3 tin tự động trong 24 giờ. izzi dừng khi khách để SĐT/Zalo, khi khách từ chối, hoặc khi nhân viên/ứng dụng khác trả lời.
- **Chạy trên máy chủ izzi**, không phụ thuộc máy tính của shop. Khi bật, app desktop gửi lên máy chủ bộ thông tin đã duyệt.
- **Không có câu báo** "đây là trợ lý tự động". Chính sách Meta chỉ bắt buộc câu này ở nơi luật yêu cầu (ví dụ người dùng ở California, Đức) và khuyến nghị dùng ở mọi nơi.

---

## 1. Người dùng thấy gì

Màn **Chăm sóc khách hàng**, khi Page đã kết nối, có thêm khối **"Tự động trả lời khách"** nằm trên "Khách để lại số":

- Công tắc **"Trả lời và xin SĐT/Zalo"**, mặc định tắt.
  - Chỉ owner hoặc manager bật/tắt được. Editor chỉ xem được trạng thái. Viewer không thấy khối này.
- Trước khi bật, app hỏi xác nhận. App cũng chặn bật nếu chưa lưu thiết lập, chưa bật "Nhận tin nhắn từ Page", hoặc Page chưa cấp `pages_messaging`.
- Dòng trạng thái gồm:
  - bật từ lúc nào;
  - đang trả lời bằng bao nhiêu thông tin đã duyệt, cập nhật lúc nào;
  - 24 giờ qua đã gửi bao nhiêu tin và đã dừng với bao nhiêu khách;
  - lý do lần gần nhất không gửi (ví dụ "Page đang để Pancake điều khiển hội thoại").
- Lưu thiết lập khi tính năng đang bật thì app gửi lại thông tin đã duyệt mới lên máy chủ ngay, rồi báo đã cập nhật hay chưa.
- Đầu màn hình hiện "Tự trả lời · Bật" thay cho "Shadow · Gửi tắt". Phần "Soạn trả lời" (bản nháp) vẫn không gửi gì.

## 2. Nội dung tin

Mỗi tin chỉ ghép từ **câu tiếng Việt cố định** và **nguyên văn thông tin shop đã duyệt**. Máy chủ chọn thông tin bằng luật cố định, cùng bộ luật với bản nháp desktop. Không có AI viết chữ, và tin không bao giờ lặp lại chữ của khách.

- **Tin 1:** "Dạ, shop cảm ơn anh/chị đã nhắn tin ạ.", rồi thông tin đã duyệt khớp câu hỏi, rồi lời xin SĐT/Zalo.
- **Tin 2 và 3:** mở đầu "Dạ vâng ạ.", phần sau giống tin 1.
- **Câu hỏi chưa có thông tin đã duyệt** (ví dụ giá): "Về giá, nhân viên tư vấn của shop sẽ kiểm tra và báo lại chính xác cho anh/chị ạ.", kèm lời xin SĐT/Zalo.
- **Câu hỏi chung chung về giá, sản phẩm hoặc chất lượng** (ví dụ "Giá bao nhiêu?", "bao nhiêu tiền bức đấy em") khi shop chỉ có đúng **một** thông tin đã duyệt cho chủ đề đó: izzi dùng thông tin ấy. Ngoại lệ: khách nêu tên một sản phẩm khác có trong danh mục, vì giá đó có thể là của sản phẩm khác. Liên hệ và chính sách không áp dụng luật này: một thông tin (ví dụ địa chỉ) không trả lời được mọi câu hỏi cùng chủ đề (ví dụ hotline). Luật này chỉ có ở máy chủ (backend `f7bd66e`), bản nháp desktop chưa có. Lý do: ngày 2026-11-19, ba tin trả lời một khách thật không dùng thông tin nào, vì câu hỏi giá không trùng từ cụ thể nào.
- **Khách vừa gửi số:** một tin chốt "Shop đã nhận được số của anh/chị. Nhân viên tư vấn sẽ liên hệ anh/chị sớm qua điện thoại hoặc Zalo ạ.", rồi dừng.
- **Khách từ chối** ("đừng nhắn", "không để số", "stop"…): izzi không gửi gì và dừng.
- **Khách nhắn nhiều tin liên tiếp:** izzi đợi khách ngừng gõ 8 giây (tối đa 30 giây kể từ tin đầu chưa trả lời), rồi trả lời một lần cho cả cụm.

## 3. Luật gửi (máy chủ kiểm tất cả, dưới khoá theo Page và theo khách)

izzi chỉ gửi khi **đủ tất cả** các điều kiện sau:

1. Env `CUSTOMER_CARE_AUTO_REPLY_ENABLED=true` trên máy chủ.
2. Công tắc của Page đang bật, và Page còn đủ các điều kiện:
   - kết nối `active`;
   - "Nhận tin nhắn từ Page" đang bật;
   - token còn;
   - có quyền `pages_messaging`.
3. Tin của khách đến sau lúc bật công tắc. Khách đã nhắn trong 24 giờ trước lúc bật thì để nhân viên xử lý (lý do `ongoing`).
4. Tin mới nhất về kênh `messages`. Tin `standby` nghĩa là ứng dụng khác (ví dụ Pancake) đang điều khiển hội thoại, nên izzi không trả lời.
5. Tin mới nhất chưa quá 23 giờ (cửa sổ 24 giờ của Messenger, chừa 1 giờ an toàn).
6. Chưa đủ 3 tin cho khách này trong 24 giờ. Tin đã gửi, đang gửi, hoặc lỗi hết giờ chờ (có thể Meta vẫn đã giao) đều được tính.
7. Page chưa vượt **60 lần gửi/giờ** (cầu chì an toàn). Khi vượt, tin được để lại và thử sau 5 phút.
8. Chưa dừng với khách này. izzi dừng khi gặp một trong các trường hợp:
   - khách để số (sau một tin chốt);
   - khách từ chối;
   - Page trả lời khách bằng đường khác izzi, tức là có echo với `app_id` khác izzi. Ngoại lệ: echo đến trong 10 giây sau tin khách được coi là trả lời tự động (Trả lời nhanh của Facebook, lời chào của Pancake), không phải người tiếp quản;
   - Send API báo 10/2018300 (ứng dụng khác điều khiển hội thoại).
9. Ngay trước khi gửi, izzi kiểm lại: tin còn ở trạng thái "đang gửi" (khách chưa bị xoá dữ liệu) và Page vẫn bật.

**Chống gửi trùng:** mỗi tin của khách chỉ được trả lời tối đa một lần (`unique (page_id, reply_to_message_id)`). Nếu máy chủ sập giữa lúc nhận việc và lúc gửi, tin đó không gửi lại, không bao giờ gửi hai lần.

**Tự tắt:** Send API báo token hỏng (`token_invalid`) hoặc mất quyền (`permission_missing`) thì công tắc của Page tự tắt. Chủ shop cần kết nối lại Page rồi bật lại.

**Tắt Inbox** ("Nhận tin nhắn từ Page") cũng tắt luôn trả lời tự động.

## 4. Dữ liệu

Migration `izzi-backend/migrations/20261121_customer_care_auto_reply.sql`. Mọi bảng chỉ cho `service_role`, có RLS.

| Bảng / cột | Nội dung | Giữ |
|---|---|---|
| `customer_care_page_bindings.outbound_enabled` + `auto_reply_enabled_at`, `auto_reply_changed_by` | Công tắc theo Page, bật lúc nào, ai đổi gần nhất | theo binding |
| `customer_care_reply_scripts` | Thông tin đã duyệt shop gửi lên (id, chủ đề, nguyên văn, hiệu lực). Không có nguồn. | đến khi shop gửi bản mới |
| `customer_care_conversations` | Mỗi khách: khi nào cần trả lời, vì sao đã dừng. Không có nội dung. | 30 ngày từ lần cập nhật cuối |
| `customer_care_outbound_messages` | Mỗi lần trả lời: trạng thái, nội dung **niêm phong `ccm1`**, ID thông tin đã dùng, mã lý do, `mid` Meta trả về | 30 ngày |

**Xoá dữ liệu:** một trigger trên `customer_care_inbound_messages` xoá hội thoại và các tin izzi đã gửi của một khách ngay khi tin cuối cùng của khách đó bị xoá. Trigger chạy trong cùng transaction và dưới cùng khoá. Nhờ vậy các đường xoá sau đều tự xoá luôn tin izzi đã gửi, mà các hàm B1/B1b không phải sửa:

- "Xoá dữ liệu khách" (`customer_care_purge_customer`);
- callback xoá dữ liệu của Meta (`customer_care_delete_facebook_grants`);
- xoá theo hạn 30 ngày.

**Giới hạn đã biết:**

- "Dừng vĩnh viễn" thực tế kéo dài tới khi khách im lặng 30 ngày (dòng hội thoại hết hạn cùng tin nhắn). Riêng khách đã để số thì vẫn dừng chừng nào lead còn (90 ngày): izzi không gửi lại tin chốt.
- Câu từ chối được nhận diện bằng từ khoá tiếng Việt và vài từ tiếng Anh. Tin của khách không mở được thì izzi không trả lời.

## 5. API (backend ↔ desktop)

Cùng xác thực, envelope và rate limit với các route Care khác (`CARE-FACEBOOK-PHASE-B1-API.md`).

| Method & path | Body / query | Ai | Trả về |
|---|---|---|---|
| `GET /api/marketing/care/facebook/auto-reply` | `?workspaceId=` | owner, manager, editor | `autoReply: CareAutoReplyState \| null` |
| `POST /api/marketing/care/facebook/auto-reply` | `{ workspaceId, enabled, script? }` (bật thì bắt buộc có `script`; body tối đa 128 KB) | owner, manager | `autoReply: CareAutoReplyState` |

```ts
type CareAutoReplyState = {
  enabled: boolean; enabledAt: string | null;
  available: boolean;              // env CUSTOMER_CARE_AUTO_REPLY_ENABLED
  scriptUpdatedAt: string | null; factCount: number;
  sentLast24h: number; lastSentAt: string | null; stoppedLast24h: number;
  lastProblem: { reason: string; at: string } | null;  // standby, outside_window, other_app, recipient_not_allowed, ...
};
type Script = { facts: { id; topic: 'catalog'|'price'|'quality'|'policy'|'contact'; text; approvedAt; expiresAt: string|null }[] }; // ≤ 50 facts, ≤ 500 chars
```

Mã lỗi 422 mới: `inbox_off`, `permission_missing`. Bật khi env tắt trả về 503 `not_configured`. Tắt thì lúc nào cũng làm được.

**Webhook:** khi bật, izzi đăng ký lại Page với `subscribed_fields=messages,standby,message_echoes`. Ở **App Dashboard → Messenger → Webhooks** cũng phải tick field `message_echoes`.

**Log:**

- `CUSTOMER_CARE_AUTO_REPLY` (kết quả, mã lý do)
- `CUSTOMER_CARE_AUTO_REPLY_SWITCH`
- `CUSTOMER_CARE_PAGE_ECHOES` (đếm echo của izzi, echo lạ, số lần dừng, số echo tự động)

Log chỉ có workspace và số đếm. Không bao giờ có PSID, Page ID, số điện thoại hay nội dung.

## 6. Kiểm tra và review

- **Backend:**
  - 2244 test pass (100 skip cần Docker), `tsc` 0 lỗi.
  - Migration chạy thử trên PGlite (Postgres 17): 81/81 kiểm tra pass. Script ở `%TEMP%\izzi-care-c\check-c.mjs`.
- **Review độc lập:**
  - security-reviewer: không có CRITICAL/HIGH.
  - socrates: ACCEPT WITH FIXES, có 1 HIGH (Instant Reply/Pancake làm izzi dừng).
  - Mọi mục HIGH/MEDIUM đã sửa trong commit `f3bc034`.
- **Desktop:** test, `tsc` và eslint ghi trong commit desktop.

## 7. Ra bản (mỗi bước cần bạn OK riêng)

1. **Migration** `20261121` qua Supabase SQL Editor: kiểm trước, chạy, kiểm sau.
2. **Backend:**
   - Nhánh `feat/care-fb-auto-reply` cắt từ bản đang chạy `14291a9`. Kiểm `/version` và tag trên VPS ngay trước khi deploy.
   - Đặt env `CUSTOMER_CARE_AUTO_REPLY_ENABLED=true`.
   - Chạy `deploy-auto.mjs --apply`.
3. **Meta Dashboard:** tick `message_echoes` trong Webhooks (Page).
4. **Desktop:** phát hành `1.14.0-beta.113`.
5. **Thử thật với tài khoản Tester:**
   - Trên Page thử, tắt Trả lời nhanh và lời chào tự động của Pancake.
   - Tester chưa nhắn Page trong 24 giờ qua, hoặc đã được "Xoá dữ liệu khách".
   - Bật "Tự động trả lời khách".
   - Tester nhắn "Shop ơi tư vấn giúp mình": izzi trả lời và xin SĐT/Zalo.
   - Tester gửi số: izzi gửi tin chốt, rồi lead hiện trong "Khách để lại số".
   - Kiểm log: có `CUSTOMER_CARE_PAGE_ECHOES` với `own ≥ 1`, chứng tỏ echo đã về.
