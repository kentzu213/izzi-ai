# Phase B1: izzi đọc tin nhắn Page và bắt lead (SĐT/Zalo)

Kế hoạch này nối tiếp `CARE-FACEBOOK-PAGE-CONNECT-PLAN.md`. Phase A (kết nối và xác minh Page) đã chạy thật: Page Đồng Thờ Hồng Hưng đã gắn và token hợp lệ.

**Mục tiêu:** khách nhắn vào Page và để lại số điện thoại → Sale thấy ngay trong izzi để gọi hoặc nhắn Zalo tư vấn.

**Phạm vi:** izzi **chỉ đọc**, không gửi gì cho khách. Nhân viên vẫn trả lời trên Pancake như hiện nay, nên izzi không đụng tới Pancake.

---

## 1. Người dùng thấy gì

Trong tab **Chăm sóc khách hàng**:

1. Công tắc **"Nhận tin nhắn từ Page"**, mặc định tắt.
   - Chỉ owner hoặc manager bật được.
   - Khi bật, izzi đăng ký nhận tin của Page với Facebook. Khi tắt, izzi gỡ đăng ký.
2. Danh sách **"Khách để lại số"**, mới nhất ở trên. Mỗi dòng có:
   - tên khách trên Facebook;
   - số điện thoại, kèm nút **Sao chép**;
   - nhãn **"Có nhắc Zalo"** nếu tin của khách có chữ Zalo;
   - lúc khách để lại số, và 1–3 tin gần nhất của khách (cắt ngắn);
   - trạng thái **Mới → Đã liên hệ → Xong**. Ai đổi trạng thái thì izzi ghi lại.
3. Nút **"Soạn trả lời"** đưa tin gần nhất của khách vào khung soạn nháp có sẵn. Nháp chỉ dùng thông tin shop đã duyệt; nhân viên tự copy sang Pancake.
4. **Thông báo Windows** khi có lead mới, lúc app izzi đang mở hoặc chạy dưới khay hệ thống.

izzi chỉ tạo lead khi **chính khách** gõ hoặc gửi số. Tin của nhân viên Page (echo) bị bỏ qua.

---

## 2. Điều kiện của Meta (không đổi so với kế hoạch gốc)

- **Trước App Review:** izzi chỉ nhận tin từ tài khoản có vai trò trên app (admin, developer, tester). Đủ để thử toàn bộ luồng.
- **Khách thật:** cần **Advanced Access** cho `pages_messaging` và `pages_manage_metadata`, tức là qua **App Review**, và thường kèm **Business Verification**.
  - App N8-2-Auto-1 hiện **chưa gắn business portfolio**, nên bạn cần làm việc này ngay, song song với code (mục 6).
- **Pancake và phân luồng hội thoại (Conversation Routing):**
  - Nếu Page chưa đặt app mặc định, mọi app đều nhận tin.
  - Nếu Pancake là app mặc định, izzi có thể chỉ nhận tin dạng `standby`.
  - izzi đăng ký **cả hai** loại (`messages`, `standby`) và xử lý như nhau. Lần thử bằng tài khoản Tester sẽ cho biết Page đang ở trường hợp nào.

---

## 3. Backend (izzi-backend)

Nhánh mới cắt từ bản đang chạy production (`41fc326`), không cắt từ `master`.

### 3.1 Webhook `GET/POST /api/meta/webhook` (công khai, không cần đăng nhập)
- **GET:** xác minh `hub.mode=subscribe` và `hub.verify_token`, so sánh constant-time với env `META_WEBHOOK_VERIFY_TOKEN`. Đúng thì trả `hub.challenge` (chỉ nhận challenge ngắn, gồm chữ và số). Sai thì trả 403.
- **POST:**
  1. Đọc **raw body**, tối đa 256 KB.
  2. Kiểm `X-Hub-Signature-256`: HMAC-SHA256 của raw body bằng App Secret có sẵn trong env, so sánh constant-time. Sai thì trả 401 và không đọc nội dung.
  3. Chỉ nhận `object = "page"`. Duyệt `entry[].messaging[]` và `entry[].standby[]`, bỏ echo.
  4. Tìm workspace qua binding **active** của `page_id`, và chỉ khi chủ shop **đã bật** "Nhận tin nhắn từ Page". Page lạ, hoặc Page chưa bật, thì bỏ và chỉ đếm.
  5. **Ghi bền rồi mới trả 200.** Nếu ghi DB lỗi thì trả 500 để Meta gửi lại.
- Log không bao giờ chứa nội dung tin, SĐT hay PSID.

### 3.2 Bảng `customer_care_inbound_messages`
- Chống trùng theo `(page_id, mid)`. Mỗi dòng gồm:
  - `workspace_id`;
  - PSID khách;
  - thời điểm;
  - kênh (`messages` hoặc `standby`);
  - nội dung **niêm phong** (`ccm1`: AES-256-GCM với khoá HKDF riêng cho từng tin, đủ nhanh để chạy cho mọi tin), tối đa 2.000 ký tự. Ảnh hoặc tệp chỉ ghi "[tệp đính kèm]".
- Giữ **30 ngày**, sau đó tự xoá. Việc xoá chạy theo đồng hồ (một phút sau khi server khởi động, rồi mỗi giờ), không phụ thuộc có tin đến hay không.

### 3.3 Bắt SĐT
Luật cố định, không dùng AI.
- **Số được nhận:** di động Việt Nam 10 số, đầu `03/05/07/08/09`. Chấp nhận dạng `+84`/`84`, có dấu cách, dấu chấm hoặc gạch.
- **Không nhận:** dãy số trong link, mã đơn hay số tiền.
- Nút "Gửi số điện thoại" của Messenger (`quick_reply.payload`) cũng được đọc, để dùng ngay khi tới phase C.

### 3.4 Bảng `customer_care_leads`
- Mỗi khách (PSID) trên một Page có tối đa **một lead**. Cột gồm:
  - SĐT **niêm phong** (`ccm1`), dạng chuẩn `0xxxxxxxxx`;
  - `zalo_mentioned`;
  - `phone_captured_at`, `last_message_at`;
  - `status` (`new` / `contacted` / `closed`), cùng người đổi và thời điểm đổi.
- **Khách gửi số khác:** lead giữ số mới nhất, còn số cũ hiện trong lịch sử tin nhắn.
- Lead giữ **90 ngày** kể từ hoạt động cuối, sau đó tự xoá.

### 3.5 Route cho app (đăng nhập Supabase JWT, giống route Care hiện có)
- `POST /api/marketing/care/facebook/inbox` `{enabled}`: chỉ owner/manager.
  - Bật thì gọi `POST /{page}/subscribed_apps` với `subscribed_fields=messages,standby` và ghi `webhook_subscribed_at`.
  - Tắt thì gọi `DELETE` và xoá mốc đó. Khi ngắt kết nối Page, izzi cũng tự gỡ đăng ký.
- `GET /api/marketing/care/facebook/leads?cursor=`: owner, manager và editor xem được, **viewer thì không**.
  - Trả lead đã giải niêm phong cùng 3 tin gần nhất, tối đa 50 lead mỗi trang.
  - Tên khách lấy qua Graph `/{psid}?fields=first_name,last_name` bằng Page token, tối đa 10 tên mỗi lần, có lưu lại.
- `POST /api/marketing/care/facebook/leads/status` `{workspaceId, leadId, status}`: owner, manager, editor.
- `GET /api/marketing/care/facebook/inbox` trả `inbox: { enabled, subscribedAt, lastEventAt }` để app biết webhook đang chạy.
- Hợp đồng chi tiết: `CARE-FACEBOOK-PHASE-B1-API.md`.

### 3.6 Callback xoá dữ liệu (B1b: làm trước App Review)

> Phần này **chưa** nằm trong bản B1 đầu tiên. Trước App Review, Meta chỉ gửi tin của tài khoản có vai trò trên app, nên chưa có dữ liệu khách thật. B1b sẽ thêm callback này, cùng nút xoá dữ liệu của một khách theo yêu cầu, **trước khi** nộp App Review.
- `POST /api/meta/data-deletion` đọc `signed_request` và kiểm bằng App Secret.
- Callback này dành cho người đã đăng nhập Facebook để cấp quyền (chủ shop/nhân viên), không phải khách nhắn tin.
  - Khi kết nối, izzi lưu ID Facebook của người cấp.
  - Khi có yêu cầu xoá: izzi ngắt kết nối và xoá token Page do người đó cấp. Tin nhắn và lead của Page đó xoá theo.
  - Trả `url` và `confirmation_code` theo chuẩn Meta.
- **Bắt buộc trước App Review.**

---

## 4. App desktop (izzi-ai)

- `care-facebook-client.ts`: client cho `inbox`, `leads` và `leads/:id`, parse chặt theo allowlist như các route Care hiện có.
- `customer-care-service.ts`: snapshot có thêm `inbox`.
  - IPC mới: `setFacebookInbox`, `listLeads`, `setLeadStatus`. Renderer không bao giờ gửi workspace hay token.
- Màn Care có công tắc, danh sách lead và nút Sao chép / Soạn trả lời / đổi trạng thái.
  - Khi tab đang mở, app hỏi lead mới mỗi 30 giây. Thông báo Windows dùng lại cơ chế đang có trong `main/index.ts`.
- SĐT chỉ nằm trong bộ nhớ khi hiển thị. App không lưu SĐT xuống đĩa và không gửi vào analytics.

---

## 5. Kiểm tra, review, ra bản

1. **TDD ở cả hai repo.**
   - Webhook: chữ ký đúng/sai, body quá lớn, echo, Page lạ, trùng `mid`, lỗi DB trả 500.
   - Bắt SĐT: các dạng số hợp lệ và không hợp lệ.
   - Quyền theo role (viewer bị chặn).
   - Bật/tắt nhận tin.
   - Migration có test.
2. **Review độc lập:** socrates, security-reviewer và Codex adversarial, vì đây là webhook công khai và có dữ liệu cá nhân.
3. **Ra bản theo thứ tự, mỗi bước cần bạn OK:**
   - migration;
   - deploy backend: kiểm bản đang chạy production trước để không gỡ nhầm việc của phiên khác;
   - phát hành desktop `1.14.0-beta.111`.
4. **Thử thật bằng tài khoản Tester:**
   - nhắn vào Page Hồng Hưng một tin có SĐT;
   - lead hiện trong izzi, có thông báo Windows;
   - xem DB thấy nội dung đã được niêm phong.

**Xong B1 khi:** bước 4 đạt, review không còn lỗi CRITICAL/HIGH, và Pancake vẫn trả lời khách bình thường.

---

## 6. Việc bạn cần làm

**Ngay bây giờ** (để App Review không thành nút cổ chai):
1. Gắn app **N8-2-Auto-1** vào business portfolio của izzi (Business Settings → Accounts → Apps).
2. Làm **Business Verification** (Business Settings → Security Center).

**Khi backend B1 đã lên** (tôi sẽ đưa sẵn verify token):
3. Thêm sản phẩm **Messenger** (hoặc **Webhooks**) cho app.
   - Object **Page**, callback `https://api.izziapi.com/api/meta/webhook`, kèm verify token.
   - Đăng ký các trường `messages` và `standby`.
4. Điền **User Data Deletion** callback: `https://api.izziapi.com/api/meta/data-deletion`.
5. Mở công tắc "Nhận tin nhắn từ Page" trong izzi, rồi nhắn thử vào Page bằng tài khoản Tester.

**Sau khi thử đạt:** tôi soạn hồ sơ **App Review** cho `pages_messaging` và `pages_manage_metadata` (video luồng sử dụng, mô tả, hướng dẫn cho người duyệt), bạn nộp.

---

## 7. Các quyết định mặc định (duyệt kế hoạch là duyệt các mặc định này)

- izzi **chỉ đọc**, không gửi tin cho khách. Việc gửi để phase C.
- Ai xem được SĐT khách: **owner, manager, editor**. Viewer không xem được.
- Tin nhắn giữ **30 ngày**, lead giữ **90 ngày** kể từ hoạt động cuối.
- Lead mới được báo bằng **thông báo Windows trong app izzi**. Telegram hoặc nhóm Zalo để sau.
- Bắt SĐT bằng **luật cố định**, không dùng AI. Ghi nhận "Có nhắc Zalo" khi tin của khách có chữ Zalo.
- Giữ luật hiện tại: **báo giá mà không bắt khách để số**.
