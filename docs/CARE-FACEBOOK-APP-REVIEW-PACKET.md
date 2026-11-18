# Hồ sơ Meta App Review: Chăm sóc khách hàng ← Page Facebook

Hồ sơ này dùng để nộp **App Review** cho app Meta **N8-2-Auto-1** (App ID `960313042869972`), để izzi nhận tin nhắn Page của **khách thật**, không chỉ của tài khoản có vai trò trên app.

- Phần tiếng Việt dành cho bạn.
- Các khối **English** dán thẳng vào form của Meta, vì người duyệt đọc tiếng Anh.

Liên quan: `CARE-FACEBOOK-PHASE-B1-LEADS.md` (kế hoạch B1 và B1b), `CARE-FACEBOOK-PHASE-B1-API.md` (hợp đồng API).

---

## 0. Điều kiện trước khi bấm Submit

Mọi mục dưới đây phải xong. Thiếu mục nào thì Meta gần như chắc chắn từ chối.

| # | Việc | Ai làm | Trạng thái |
|---|---|---|---|
| 1 | Backend B1b (callback xoá dữ liệu + xoá dữ liệu một khách) chạy trên production. **Thứ tự bắt buộc:** chạy migration `20261120`, kiểm tra các hàm mới đã có, rồi mới deploy backend. Deploy backend trước migration sẽ làm hỏng việc chọn Page và màn Care. | tôi, khi bạn OK migration và deploy | chưa |
| 2 | Bản desktop có nút **"Xoá dữ liệu khách"** đã phát hành | tôi, khi bạn OK release | chưa |
| 3 | Gắn app vào **business portfolio** của izzi (Business Settings → Accounts → Apps) | bạn | chưa |
| 4 | Hoàn tất **Business Verification** (Business Settings → Security Center) | bạn | chưa |
| 5 | Cập nhật **Chính sách bảo mật** `https://izziapi.com/privacy` thêm phần dữ liệu Facebook (mục 6). Trang hiện tại, cập nhật 31/3/2026, chưa nhắc tới Facebook, Messenger hay Fanpage. | bạn duyệt nội dung; sửa ở repo izzi-web | chưa |
| 6 | Điền các URL trong App Dashboard (mục 1) | bạn | chưa |
| 7 | Quay screencast theo mục 3 | bạn | chưa |
| 8 | Tạo một tài khoản izzi dành cho người duyệt, kèm workspace có quyền owner | bạn. Mật khẩu chỉ điền vào ô "test credentials" của Meta, không ghi vào file này. | chưa |
| 9 | Kiểm tra **không còn kết nối Page nào thiếu ID người cấp**: `select count(*) from customer_care_page_bindings where status <> 'disconnected' and granted_by_facebook_user_id is null` phải bằng 0 | tôi, qua SQL Editor | chưa |
| 10 | Quyết định về dữ liệu **Marketing** (mục 7) | bạn | chưa |

---

## 1. Cài đặt trong App Dashboard

**App settings → Basic:**

| Ô | Giá trị |
|---|---|
| Privacy Policy URL | `https://izziapi.com/privacy` |
| Terms of Service URL | `https://izziapi.com/terms` |
| User data deletion | chọn **Data deletion callback URL**, điền `https://api.izziapi.com/api/meta/data-deletion` |
| App icon, Category | dùng logo izzi; Category: *Business and Pages* |

**Kiểm tra callback sau khi backend B1b đã deploy:**
1. Vào Facebook bằng tài khoản Tester → **Settings & Privacy → Settings → Apps and Websites**.
2. Gỡ app, bấm **View removed apps**, rồi **Send request**.
3. Meta hiển thị một đường link và mã xác nhận. Mở link phải ra trang **"Yêu cầu xoá dữ liệu Facebook"** với dòng *"Đã xoá xong lúc …"*.
4. Sau bước này binding Page trong izzi đã bị ngắt. Kết nối lại Page trước khi quay video.

**Deauthorize callback URL:** để trống (không bắt buộc).

---

## 2. Quyền và tính năng cần xin

Ở **App Review → Permissions and Features**, xin **Advanced Access** cho:

| Quyền / tính năng | izzi dùng để | Gọi API nào |
|---|---|---|
| `pages_show_list` | Liệt kê các Page người dùng quản lý để họ chọn đúng Page | `GET /me/accounts` |
| `pages_manage_metadata` | Đăng ký và huỷ đăng ký webhook tin nhắn cho Page | `POST` / `DELETE /{page-id}/subscribed_apps` |
| `pages_messaging` | Nhận tin nhắn khách gửi tới Page (webhook `messages`, `standby`) | Webhook `https://api.izziapi.com/api/meta/webhook` |
| **Business Asset User Profile Access** (feature) | Hiện tên khách (họ, tên) cạnh số điện thoại để Sale nhận ra khách | `GET /{psid}?fields=first_name,last_name` |

izzi **không gửi** tin nhắn nào cho khách: không có lệnh gọi Send API. Nhân viên shop vẫn trả lời trên công cụ hiện có (ví dụ Pancake). Hãy nói rõ điều này với người duyệt; các khối English bên dưới đã ghi sẵn.

### 2.1 `pages_show_list` (English, paste into "How will your app use this permission?")

```text
izzi is a Windows/macOS desktop app that helps small Vietnamese shops follow up with customers who message their Facebook Page. A shop owner or manager signs in to izzi, opens "Customer Care" (Chăm sóc khách hàng) and clicks "Connect Page" (Kết nối Page). After Facebook Login, izzi calls GET /me/accounts with pages_show_list to show the Pages this person manages, so they can pick the one Page whose messages izzi should read. izzi stores only the chosen Page's id, name and Page access token (encrypted, AES-256-GCM, server side). The list of Pages is cleared as soon as one is chosen, and otherwise expires after 15 minutes and is then deleted.
```

### 2.2 `pages_manage_metadata`

```text
After the shop owner picks a Page, they turn on "Receive messages from the Page" (Nhận tin nhắn từ Page) inside izzi. izzi then calls POST /{page-id}/subscribed_apps with subscribed_fields=messages,standby so that Messenger delivers this Page's customer messages to izzi's webhook. Turning the switch off, disconnecting the Page, or a Facebook data deletion request calls DELETE /{page-id}/subscribed_apps. izzi uses pages_manage_metadata only for this subscription; it does not change any other Page setting.
```

### 2.3 `pages_messaging`

```text
izzi uses pages_messaging only to RECEIVE messages that customers send to the shop's Page (webhook fields "messages" and "standby"); izzi never sends a message to a customer. When a customer writes their Vietnamese mobile number in a message, izzi lists that customer in "Customers who left a phone number" (Khách để lại số) so the shop's sales staff can call them or contact them on Zalo. Messages are stored encrypted (AES-256-GCM) for 30 days and leads for 90 days after the last message, then deleted automatically. A shop owner/manager can delete any single customer's data at any time ("Delete customer data" / Xoá dữ liệu khách). Messages written by the Page itself (echoes) are ignored.
```

### 2.4 Business Asset User Profile Access

```text
When a customer leaves a phone number, izzi shows the customer's first and last name next to it so that sales staff can recognise the person they are calling. izzi reads only first_name and last_name with GET /{psid}?fields=first_name,last_name using the Page access token, at most 10 names per list load, and caches the name with the lead. The name is shown only to the shop's owner, manager and editor roles inside izzi and is deleted together with the lead (after 90 days of inactivity, when the shop deletes the customer's data, or when the Page is disconnected through a Facebook data deletion request).
```

---

## 3. Kịch bản quay screencast (khoảng 3–4 phút)

**Yêu cầu chung:**
- Quay màn hình Windows, độ phân giải 1080p, không cắt ghép giữa các bước chính.
- Giao diện izzi bằng tiếng Việt, nên **thêm phụ đề tiếng Anh** cho từng bước (gợi ý nằm trong cột "Caption").
- Dùng **tài khoản Facebook Tester** và Page thử (ví dụ Đồng Thờ Hồng Hưng). Khách nhắn tin là một tài khoản Tester thứ hai.
- Che hoặc làm mờ số điện thoại thật nếu có; tốt nhất dùng số giả hợp lệ như `0912 345 678`.

| # | Màn hình | Thao tác | Caption (English) |
|---|---|---|---|
| 1 | izzi desktop | Mở izzi, đăng nhập, vào **Marketing → Chăm sóc khách hàng** | "The shop owner opens izzi → Customer Care." |
| 2 | Khối "Kết nối Page cho Chăm sóc khách hàng" | Bấm **Kết nối Page** | "Connect the shop's Facebook Page." |
| 3 | Hộp thoại Facebook Login | Để **rõ toàn bộ danh sách quyền** (pages_show_list, pages_manage_metadata, pages_messaging), rồi bấm Continue | "Facebook Login asks for pages_show_list, pages_manage_metadata and pages_messaging." |
| 4 | izzi: "Chọn Page dùng cho Chăm sóc khách hàng" | Chọn Page, bấm xác nhận; izzi hiện Page đã kết nối | "pages_show_list: the owner picks one Page from the Pages they manage." |
| 5 | Khối "Khách để lại số" | Bật **Nhận tin nhắn từ Page**, đồng ý hộp xác nhận | "pages_manage_metadata: izzi subscribes the Page to message webhooks. izzi only reads; it never sends." |
| 6 | Messenger (tài khoản khách) | Khách nhắn vào Page: *"Shop ơi, tư vấn giúp mình, số mình 0912 345 678, có Zalo"* | "A customer messages the Page and leaves a phone number." |
| 7 | izzi | Trong ≤ 30 giây, khách hiện trong **Khách để lại số**: tên khách, số, nhãn "Có nhắc Zalo", tin gần nhất; có thông báo Windows | "pages_messaging: the message arrives through the webhook; the customer becomes a lead. Business Asset User Profile Access: the customer's name is shown." |
| 8 | izzi | Bấm **Sao chép**, đổi trạng thái **Mới → Đã liên hệ**, bấm **Soạn trả lời** để thấy nháp | "Sales staff copy the number and track the follow-up. Nothing is sent from izzi." |
| 9 | izzi | Bấm **Xoá dữ liệu khách**, đọc hộp xác nhận, bấm OK; khách biến khỏi danh sách | "On request, the owner deletes this customer's phone and messages." |
| 10 | izzi | Tắt **Nhận tin nhắn từ Page**, rồi **Ngắt kết nối** Page | "Turning off removes the webhook subscription; disconnecting deletes the stored Page token." |
| 11 | Facebook Settings → Apps and Websites (tuỳ chọn) | Gỡ app, **Send request**, mở link trạng thái | "Facebook data deletion callback: izzi confirms the deletion with a status page." |

Mẹo: quay bước 11 riêng ở cuối, vì sau bước này binding bị ngắt.

---

## 4. Hướng dẫn cho người duyệt (English, paste into "Reviewer instructions")

```text
izzi is a desktop app (Windows 10/11 x64, macOS). Download the installer from:
https://github.com/kentzu213/izzi-ai/releases (latest release, "Izzi-AI-<version>-win-x64.exe" or the macOS .dmg).

1. Install and open izzi. Sign in with the izzi test account provided in the test credentials field.
2. Open Marketing → "Chăm sóc khách hàng" (Customer Care).
3. Under "Kết nối Page cho Chăm sóc khách hàng" (Connect a Page for Customer Care) click "Kết nối Page" (Connect Page). Your browser opens Facebook Login; grant the requested permissions for a Page you administer, then return to izzi and pick that Page.
4. In "Khách để lại số" (Customers who left a phone number), turn on "Nhận tin nhắn từ Page" (Receive messages from the Page) and confirm.
5. From another Facebook account, send the Page a message containing a Vietnamese mobile number, for example: "Hi, my number is 0912345678".
6. Within about 30 seconds the customer appears in the list with their name, the phone number and the latest message. You can copy the number, change the status, or delete this customer's data with "Xoá dữ liệu khách".
7. izzi never sends messages to customers; there is no send action in the app.
8. To finish, turn the switch off and click "Ngắt kết nối" (Disconnect). Data deletion requests from Facebook settings are handled at https://api.izziapi.com/api/meta/data-deletion.

The screencast shows the complete flow with English captions.
```

---

## 5. Câu hỏi về xử lý dữ liệu (Data Handling) mà Meta hay hỏi

| Câu hỏi | Trả lời gợi ý (English) |
|---|---|
| Data processors / service providers | Supabase (database hosting), Vultr (backend server). No data is sold or shared for advertising. |
| Where is data stored | Encrypted at rest in Supabase Postgres (Singapore region; xác nhận lại vùng trước khi nộp); Page tokens and message text additionally encrypted with AES-256-GCM by the backend. |
| Retention | Messages 30 days, leads 90 days after the customer's last message, Page token until the Page is disconnected. |
| Deletion | Data deletion callback (Section 1), in-app "Delete customer data", disconnecting the Page, or email support@izziapi.com. |
| Who can access | Only the shop's izzi workspace members with owner, manager or editor roles; viewers never see phone numbers. |

> Hai thông tin cần bạn xác nhận lại trước khi nộp: **vùng lưu trữ** của Supabase và nhà cung cấp server.

---

## 6. Đoạn bổ sung cho Chính sách bảo mật (`https://izziapi.com/privacy`)

Trang này nằm ở repo **izzi-web**. Thêm một mục mới, song ngữ như phần còn lại của trang:

```markdown
## Dữ liệu từ Facebook (Chăm sóc khách hàng) / Facebook data (Customer Care)

Khi bạn kết nối một Fanpage với tính năng Chăm sóc khách hàng của izzi, izzi nhận và lưu:
- ID Facebook (theo ứng dụng) của người cấp quyền, ID và tên Page, mã truy cập (token) của Page (mã hoá AES-256-GCM);
- tin nhắn khách gửi tới Page (mã hoá, giữ 30 ngày);
- số điện thoại khách tự gửi trong tin nhắn, tên Facebook của khách (giữ 90 ngày kể từ tin nhắn cuối).
izzi chỉ đọc tin nhắn để liệt kê khách để lại số cho nhân viên của bạn; izzi không gửi tin cho khách, không bán hay chia sẻ dữ liệu này.

Xoá dữ liệu: chủ shop có thể xoá dữ liệu của từng khách ngay trong app (nút "Xoá dữ liệu khách"), ngắt kết nối Page, hoặc gỡ ứng dụng trong Cài đặt Facebook → Ứng dụng và trang web → Gửi yêu cầu xoá. Bạn cũng có thể email support@izziapi.com.

When you connect a Facebook Page to izzi Customer Care, izzi receives and stores: the app-scoped Facebook ID of the person who granted access, the Page ID, name and Page access token (encrypted with AES-256-GCM); messages customers send to the Page (encrypted, kept 30 days); phone numbers customers send in those messages and the customer's Facebook name (kept 90 days after their last message). izzi only reads messages to list customers who left a phone number for your staff; izzi does not message customers and does not sell or share this data.

Deletion: shop owners can delete any customer's data in the app ("Delete customer data"), disconnect the Page, or remove the app in Facebook Settings → Apps and Websites → Send deletion request. You can also email support@izziapi.com.
```

---

## 7. Giới hạn đã biết (nói thật với người duyệt nếu được hỏi)

- **Phạm vi callback (cần bạn quyết định):** callback xoá dữ liệu bao phủ phần **Chăm sóc khách hàng**. Phần **Marketing** của izzi cũng dùng app Meta này để đăng bài lên Page, nhưng hiện chưa lưu ID Facebook của người cấp quyền, nên callback chưa tự xoá được kết nối Marketing.
  - Trang trạng thái đã ghi rõ điều này và hướng dẫn người dùng tự ngắt kết nối hoặc email hỗ trợ.
  - Meta yêu cầu chính app phải khởi động việc xoá, nên người duyệt có thể không chấp nhận cách hướng dẫn người dùng tự làm.
  - Bước đầu tiên: đếm trên prod số kết nối Marketing Facebook còn token (`marketing_social_accounts` với platform facebook, instagram hoặc threads và `access_token` khác null). Nếu bằng 0 thì đây chỉ là lý thuyết.
  - Nếu khác 0, hướng sửa: ghi ID người cấp cho kết nối Marketing và đưa vào cùng callback. Đây là việc riêng.
- **Kết nối có từ trước B1b:** binding Page tạo trước bản này chưa có ID người cấp. izzi bổ sung ID đó, làm được thì làm (best-effort), vào các thời điểm:
  - 1 phút sau khi server khởi động, rồi mỗi giờ, trong lúc token còn sống;
  - ở lần kiểm tra token 6 giờ một lần;
  - khi kết nối lại Page;
  - ngay đầu mỗi yêu cầu xoá dữ liệu.
  - Lúc yêu cầu xoá tới, token thường đã chết vì người dùng đã gỡ app. izzi vẫn đọc `user_id` từ debug_token nếu Facebook còn trả, nhưng điều này **chưa kiểm chứng**.
  - Vì vậy bắt buộc làm mục 0.9 trước khi nộp.
  - Cách xử lý một yêu cầu xoá:
    - izzi xoá ngay phần dữ liệu đã biết là của người đó;
    - ghi yêu cầu ở trạng thái **"Đang xử lý"**, chỉ giữ SHA-256 của ID người đó;
    - cũng trong request đó, database tự "settle": nếu không còn binding sống nào chưa rõ người cấp thì đánh dấu **"Đã xoá xong"** và xoá luôn hash. Thường xảy ra ngay lập tức.
  - Nếu vẫn còn binding chưa rõ người cấp:
    - job chạy mỗi giờ: binding nào được xác định là của người đó thì xoá nốt;
    - chỉ đánh dấu xong khi không còn binding sống nào chưa rõ người cấp;
    - mỗi lần settle là một transaction, lỗi giữa chừng thì không đánh dấu xong;
    - log ghi `CUSTOMER_CARE_DATA_DELETION_PENDING` với số yêu cầu, không có ID.
  - **Cách xử lý tay khi yêu cầu treo quá 24 giờ:**
    - Liệt kê các binding sống chưa có người cấp (chỉ lấy `id` và `workspace_id`).
    - Nhờ chủ shop kết nối lại Page (izzi sẽ ghi người cấp) hoặc ngắt kết nối.
    - Lần settle kế tiếp sẽ đóng yêu cầu.
  - **Binding cũ đã ngắt kết nối mà chưa có người cấp:** không thể quy về ai, vì token đã bị xoá. Tin nhắn và lead của chúng tự xoá theo hạn 30/90 ngày. Sau khi deploy, tôi kiểm tra trên prod xem có dòng nào như vậy không (chỉ có thể là dữ liệu thử trước App Review) và xoá tay nếu có.
- **Xoá dữ liệu một khách:** chỉ áp dụng cho khách đã để lại số (có lead). Tin nhắn của khách chưa để số tự xoá sau 30 ngày.
  - Sau khi xoá, izzi giữ 8 ngày một dấu đã băm (không phải PSID) để Meta gửi lại tin cũ thì không phục hồi khách.
  - Tin **mới** khách gửi sau đó được lưu như bình thường.
- **Rủi ro đã chấp nhận (review B1b):**
  - Một `signed_request` cũ bị bắt được và phát lại sẽ xoá lại dữ liệu của chính người đó. Muốn làm vậy phải lấy được payload qua TLS.
  - Lệnh gỡ webhook chạy sau khi đã commit. Nếu Page được kết nối lại đúng lúc đó, webhook mới có thể bị gỡ; izzi tự phát hiện trong vòng 10 phút và màn Care báo "đang tắt".
  - Phiên chọn Page chưa hết hạn (tối đa 15 phút) vẫn giữ token đã niêm phong của người đó. Token này Facebook đã thu hồi khi người dùng gỡ app.

---

## 8. Sau khi được duyệt

1. Chuyển app sang **Live mode**, nếu chưa.
2. Thử lại luồng ở mục 3 bằng một tài khoản **không** có vai trò trên app.
3. Theo dõi log backend (`CUSTOMER_CARE_WEBHOOK`, `CUSTOMER_CARE_DATA_DELETION`). Log chỉ có số đếm, không có nội dung tin nhắn.
