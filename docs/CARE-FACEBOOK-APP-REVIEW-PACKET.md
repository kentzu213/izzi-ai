# Hồ sơ Meta App Review: Chăm sóc khách hàng ← Page Facebook

Hồ sơ này dùng để nộp **App Review** cho app Meta **N8-2-Auto-1** (App ID `960313042869972`), để izzi **nhận tin nhắn Page và tự trả lời khách thật** (Phase C), không chỉ tài khoản có vai trò trên app.

- Phần tiếng Việt dành cho bạn.
- Các khối **English** dán thẳng vào form của Meta, vì người duyệt đọc tiếng Anh.

Liên quan: `CARE-FACEBOOK-PHASE-B1-LEADS.md` (kế hoạch B1 và B1b), `CARE-FACEBOOK-PHASE-B1-API.md` (hợp đồng API), `CARE-FACEBOOK-PHASE-C-AUTO-REPLY.md` (Phase C: tự trả lời khách).

> **Cập nhật 2026-11-18 (Phase C):** izzi giờ **gửi** tin trả lời tự động cho khách qua Send API. Mọi đoạn trước đây nói "izzi không gửi tin nào cho khách" đã được thay bằng mô tả việc gửi. Screencast phải quay cả cảnh izzi tự trả lời (mục 3, bước 7–9).
>
> **Cập nhật 2026-11-25 (Care CRM S3, thẻ nhận diện AI):** sau khi bật (cờ `CUSTOMER_CARE_PROFILE_AI_ENABLED`, chỉ cho workspace trong danh sách), izzi:
> - **hỏi khách có đồng ý cho lưu hồ sơ không**, bằng một tin kèm câu báo "trợ lý tự động" và 2 nút trả lời nhanh [Đồng ý] [Không], chỉ trong cửa sổ 24 giờ, tối đa 2 lần mỗi khách, cách nhau 7 ngày, không hỏi lại khách đã từ chối trong 24 tháng;
> - dùng AI đọc hội thoại **trên chính Page** để ghi dịp mua, thời điểm cần và sản phẩm quan tâm; chỉ sau khi khách bấm Đồng ý mới ghi thêm cách xưng hô, **nhóm tuổi ước tính**, người được mua cho (kèm nguyên văn lời khách), quảng cáo khách đã bấm, link khách gửi và mức ngân sách. Không có giới tính, tôn giáo, sức khoẻ;
> - **giữ tiêu đề và tên miền của bài/link khách gửi vào hộp thư** (Meta gửi sẵn trong webhook), không bao giờ mở link; link tới mạng xã hội chỉ giữ tên miền;
> - khách bấm Không hoặc nhắn KHÔNG: xoá các thông tin AI, không gửi ưu đãi; nhắn XOÁ: xoá toàn bộ dữ liệu của khách.
>
> Các đoạn ở mục 2.3, 5, 6 và 7 đã thêm phần này. Chỉ đúng sau khi migration `20261126`, backend I2 và bản desktop I4 lên production và cờ được bật; xem `CARE-CRM-S3-IDENTITY.md`. Trước khi bật cho người ngoài danh sách thử, phải khai báo phạm vi xử lý mới này trong App Review (Platform Terms 3.a).
>
> **Cập nhật 2026-11-24 (Care CRM S1):** tên khách không còn lưu dạng chữ thường. Tên được mã hoá (AES-256-GCM, gắn với đúng workspace và đúng khách) và xoá cùng khách. Hồ sơ CRM do nhân viên tự nhập (kể cả ghi chú) cũng được mã hoá trên máy chủ izzi, giữ cùng khách (90 ngày kể từ tin nhắn cuối) và xoá cùng khách. Các đoạn về tên ở mục 2.4 và mục chính sách đã sửa theo. Điều này chỉ đúng sau khi migration `20261125` và backend S1 lên production; xem `CARE-CRM-S1-S2.md`.

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
| 11 | **Phase C chạy trên production**: migration `20261121`, deploy backend (env `CUSTOMER_CARE_AUTO_REPLY_ENABLED=true`), phát hành desktop có khối "Tự động trả lời khách" | tôi, khi bạn OK từng bước | chưa |
| 12 | App Dashboard → **Messenger → Webhooks** (Page): tick thêm field `message_echoes` (izzi dùng để biết nhân viên đã trả lời và dừng lại) | bạn, hoặc tôi khi bạn OK | chưa |
| 13 | Chính sách bảo mật: thay đoạn "izzi không gửi tin cho khách" bằng đoạn mới ở mục 6 (izzi tự trả lời khi chủ shop bật) | bạn duyệt nội dung; sửa ở repo izzi-web | chưa |
| 14 | Trước khi quay: trên Page thử **tắt Trả lời nhanh (Instant Reply)** của Facebook và lời chào tự động của Pancake, để video chỉ có tin của izzi | bạn | chưa |

> Trạng thái các mục 1–10 theo ghi chú phiên B1b (18/11): mục 1, 2, 6 đã xong; mục 3 (app thuộc portfolio "Đồng Thờ Hồng Hưng") đã xong; mục 9 bằng 0; mục 10 đếm được 0 kết nối Marketing có token. Mục 5: PR chính sách đã merge nhưng bản deploy izzi-web còn chờ PR sửa CI. Hãy kiểm lại trước khi nộp.

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
| `pages_manage_metadata` | Đăng ký và huỷ đăng ký webhook tin nhắn cho Page (`messages`, `standby`, `message_echoes`) | `POST` / `DELETE /{page-id}/subscribed_apps` |
| `pages_messaging` | Nhận tin nhắn khách gửi tới Page (webhook `messages`, `standby`, `message_echoes`) **và tự trả lời khách** trong cửa sổ 24 giờ | Webhook `https://api.izziapi.com/api/meta/webhook`; Send API `POST /{page-id}/messages` (`messaging_type=RESPONSE`) |
| **Business Asset User Profile Access** (feature) | Hiện tên khách (họ, tên) cạnh số điện thoại để Sale nhận ra khách | `GET /{psid}?fields=first_name,last_name` |

izzi **gửi** tin nhắn cho khách chỉ khi chủ shop bật "Tự động trả lời khách" (mặc định tắt): tối đa 3 tin mỗi khách trong 24 giờ, chỉ trong cửa sổ 24 giờ của Messenger, nội dung chỉ gồm câu cố định và thông tin shop đã duyệt, mục đích là xin số điện thoại/Zalo để nhân viên tư vấn. izzi dừng khi khách để số, khi khách từ chối, hoặc khi nhân viên trả lời (Page Inbox, Pancake). Các khối English bên dưới đã ghi sẵn.

### 2.1 `pages_show_list` (English, paste into "How will your app use this permission?")

```text
izzi is a Windows/macOS desktop app that helps small Vietnamese shops follow up with customers who message their Facebook Page. A shop owner or manager signs in to izzi, opens "Customer Care" (Chăm sóc khách hàng) and clicks "Connect Page" (Kết nối Page). After Facebook Login, izzi calls GET /me/accounts with pages_show_list to show the Pages this person manages, so they can pick the one Page whose messages izzi should read. izzi stores only the chosen Page's id, name and Page access token (encrypted, AES-256-GCM, server side). The list of Pages is cleared as soon as one is chosen, and otherwise expires after 15 minutes and is then deleted.
```

### 2.2 `pages_manage_metadata`

```text
After the shop owner picks a Page, they turn on "Receive messages from the Page" (Nhận tin nhắn từ Page) inside izzi. izzi then calls POST /{page-id}/subscribed_apps with subscribed_fields=messages,standby so that Messenger delivers this Page's customer messages to izzi's webhook. When the owner also turns on "Automatic replies" (Tự động trả lời khách), izzi subscribes the same Page to message_echoes as well, only to notice when the shop's staff (or another inbox app) answered a customer, so that izzi stops replying to that customer. Turning the switches off, disconnecting the Page, or a Facebook data deletion request calls DELETE /{page-id}/subscribed_apps or re-subscribes without echoes. izzi uses pages_manage_metadata only for this subscription; it does not change any other Page setting.
```

### 2.3 `pages_messaging`

```text
izzi uses pages_messaging to RECEIVE the messages customers send to the shop's Page and to ANSWER them automatically on the shop's behalf.

Receiving: customer messages arrive through the webhook (fields "messages" and "standby"). When a customer writes their Vietnamese mobile number, izzi lists that customer in "Customers who left a phone number" (Khách để lại số) so the shop's sales staff can call them or contact them on Zalo.

Answering: only after the shop owner or manager turns on "Automatic replies" (Tự động trả lời khách, off by default), izzi replies to a customer's new messages with the Send API (POST /{page-id}/messages, messaging_type=RESPONSE), always within 23 hours of the customer's latest message. Each reply is built only from fixed courteous phrases and facts the shop approved in izzi (prices, delivery and return policies, store address); customer text is never repeated and no AI writes free text. The reply answers what it can and asks whether the customer would like to leave a phone number or Zalo so a sales person can advise them. izzi sends at most 3 automatic replies per customer in 24 hours and stops for that customer as soon as they leave a phone number (after one short confirmation), decline to be contacted, or a person or another inbox app answers from the Page (detected through message echoes). Messages arriving as "standby" (another app controls the conversation) are never answered.

Data: messages and izzi's replies are stored encrypted (AES-256-GCM) for 30 days, leads for 90 days after the last message, then deleted automatically. A shop owner/manager can delete any single customer's data, including the replies izzi sent, at any time ("Delete customer data" / Xoá dữ liệu khách).

Asking for consent (customer profile): before izzi keeps anything about a customer beyond their order (occasion, timing, products asked about), it asks them in Messenger, in a message that says it comes from an automated assistant, with two quick replies [Đồng ý] (Agree) and [Không] (No). The question is sent within the 24-hour window only (messaging_type=RESPONSE), at most twice per customer and 7 days apart, never again to someone who refused in the last 24 months, either together with an automatic reply or when a staff member presses "Ask the customer" (Xin phép khách). Only after "Đồng ý" does izzi keep the form of address, an estimated age band, who the purchase is for (with the customer's own words), the ad they came from, the titles and domains of links they sent, and a budget band. "Không", or a later "KHÔNG", deletes that data and stops offers; "XOÁ" deletes everything izzi holds about the customer. izzi never reads a person's Facebook profile and never opens the links customers send: it keeps the title and domain that arrive in the webhook, and only the domain for links to social networks.
```

### 2.4 Business Asset User Profile Access

```text
When a customer leaves a phone number, izzi shows the customer's first and last name next to it so that sales staff can recognise the person they are calling. izzi reads only first_name and last_name with GET /{psid}?fields=first_name,last_name using the Page access token, at most 10 names per list load, and stores the name with the lead, encrypted with AES-256-GCM and bound to that lead and the shop's workspace. The name is shown only to the shop's owner, manager and editor roles inside izzi and is deleted together with the lead (after 90 days of inactivity, when the shop deletes the customer's data, or when the Page is disconnected through a Facebook data deletion request).
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
| 5 | Khối "Khách để lại số" | Bật **Nhận tin nhắn từ Page**, đồng ý hộp xác nhận | "pages_manage_metadata: izzi subscribes the Page to message webhooks." |
| 6 | Khối "Tự động trả lời khách" | Bật **Trả lời và xin SĐT/Zalo**, đọc rõ hộp xác nhận (tối đa 3 tin/khách/24 giờ, dừng khi khách để số/từ chối/nhân viên trả lời), bấm OK | "The owner turns on automatic replies. izzi will answer only with facts the shop approved, at most 3 replies per customer in 24 hours." |
| 7 | Messenger (tài khoản khách, đặt cạnh izzi) | Khách nhắn vào Page: *"Shop ơi, bộ đồ thờ 60cm giá bao nhiêu?"* | "A customer messages the Page." |
| 8 | Messenger (tài khoản khách) | Trong khoảng 10–30 giây, khách nhận tin tự động: lời cảm ơn, giá đã duyệt (nếu có), lời mời để lại số điện thoại hoặc Zalo | "pages_messaging: izzi replies within the 24-hour window with the shop's approved price and asks for a phone number or Zalo." |
| 9 | Messenger (tài khoản khách) | Khách trả lời: *"Số mình 0912 345 678, có Zalo"*; khách nhận tin chốt "Shop đã nhận được số của anh/chị…"; izzi không gửi thêm | "The customer leaves a number; izzi confirms once and stops replying to this customer." |
| 10 | izzi | Trong ≤ 30 giây, khách hiện trong **Khách để lại số**: tên khách, số, nhãn "Có nhắc Zalo", tin gần nhất; có thông báo Windows. Khối "Tự động trả lời khách" hiện "đã gửi 2 tin" | "The customer becomes a lead for the shop's sales staff. Business Asset User Profile Access: the customer's name is shown." |
| 11 | izzi | Bấm **Sao chép**, đổi trạng thái **Mới → Đã liên hệ** | "Sales staff copy the number and track the follow-up." |
| 12 | izzi | Bấm **Xoá dữ liệu khách**, đọc hộp xác nhận, bấm OK; khách biến khỏi danh sách | "On request, the owner deletes this customer's phone, messages and the replies izzi sent." |
| 13 | izzi | Tắt **Trả lời và xin SĐT/Zalo**, tắt **Nhận tin nhắn từ Page**, rồi **Ngắt kết nối** Page | "Turning off stops automatic replies and removes the webhook subscription; disconnecting deletes the stored Page token." |
| 14 | Facebook Settings → Apps and Websites (tuỳ chọn) | Gỡ app, **Send request**, mở link trạng thái | "Facebook data deletion callback: izzi confirms the deletion with a status page." |

Mẹo:
- Bước 14 quay riêng ở cuối, vì sau bước này binding bị ngắt. **Không** làm bước này trên Page Hồng Hưng đang dùng thật; bỏ qua cũng được.
- Tài khoản khách dùng để quay phải là **Tester** (trước khi được duyệt, Facebook chỉ cho gửi tới tài khoản có vai trò trên app), chưa nhắn Page trong 24 giờ trước lúc bật công tắc, và chưa có lead cũ (nếu có, bấm "Xoá dữ liệu khách" trước).
- Tắt Trả lời nhanh của Facebook và lời chào tự động của Pancake trên Page thử (mục 0.14).

---

## 4. Hướng dẫn cho người duyệt (English, paste into "Reviewer instructions")

```text
izzi is a desktop app (Windows 10/11 x64, macOS). Download the installer from:
https://github.com/kentzu213/izzi-ai/releases (latest release, "Izzi-AI-<version>-win-x64.exe" or the macOS .dmg).

1. Install and open izzi. Sign in with the izzi test account provided in the test credentials field.
2. Open Marketing → "Chăm sóc khách hàng" (Customer Care).
3. Under "Kết nối Page cho Chăm sóc khách hàng" (Connect a Page for Customer Care) click "Kết nối Page" (Connect Page). Your browser opens Facebook Login; grant the requested permissions for a Page you administer, then return to izzi and pick that Page.
4. In "Khách để lại số" (Customers who left a phone number), turn on "Nhận tin nhắn từ Page" (Receive messages from the Page) and confirm.
5. In "Tự động trả lời khách" (Automatic replies), turn on "Trả lời và xin SĐT/Zalo" (Reply and ask for a phone number / Zalo) and confirm. The answers use only the facts saved under the Customer Care setup of the test workspace.
6. From another Facebook account, send the Page a message, for example: "Hi shop, how much is it?". Within about 10–30 seconds that account receives an automatic reply that answers with an approved fact when one matches and asks whether they would like to leave a phone number or Zalo.
7. Reply with a Vietnamese mobile number, for example: "My number is 0912345678". The account receives one short confirmation and no further automatic messages. Within about 30 seconds the customer appears in "Khách để lại số" with their name, the phone number and the latest message. You can copy the number, change the status, or delete this customer's data (including izzi's replies) with "Xoá dữ liệu khách".
8. If someone answers the customer from the Page Inbox, izzi stops replying to that customer. At most 3 automatic replies are sent per customer in 24 hours, and only within the 24-hour messaging window.
9. To finish, turn both switches off and click "Ngắt kết nối" (Disconnect). Data deletion requests from Facebook settings are handled at https://api.izziapi.com/api/meta/data-deletion.

The screencast shows the complete flow with English captions.
```

---

## 5. Câu hỏi về xử lý dữ liệu (Data Handling) mà Meta hay hỏi

| Câu hỏi | Trả lời gợi ý (English) |
|---|---|
| Data processors / service providers | Supabase (database hosting), Vultr (backend server). No data is sold or shared for advertising. |
| Where is data stored | Encrypted at rest in Supabase Postgres (Singapore region; xác nhận lại vùng trước khi nộp); Page tokens and message text additionally encrypted with AES-256-GCM by the backend. |
| Retention | Messages and izzi's automatic replies 30 days, leads 90 days after the customer's last message, the shop's approved reply facts until the shop replaces them, Page token until the Page is disconnected. |
| Deletion | Data deletion callback (Section 1), in-app "Delete customer data", disconnecting the Page, or email support@izziapi.com. |
| Who can access | Only the shop's izzi workspace members with owner, manager or editor roles; viewers never see phone numbers. |
| Customer profile (CRM S3) | Built only from the customer's conversation with the shop's own Page. The profile part is kept only after the customer tapped "Đồng ý" (logged with a keyed hash of the customer, the time and the copy version); it is encrypted, kept with the lead (90 days after the last message), and deleted on "Không"/"KHÔNG" (AI fields) or "XOÁ" (everything). No profile reading, no link fetching, no gender, religion or health field; never used for pricing or for ad targeting by age or family. The AI model provider receives masked conversation text only (no name, PSID, phone or ids). |

> Hai thông tin cần bạn xác nhận lại trước khi nộp: **vùng lưu trữ** của Supabase và nhà cung cấp server.

---

## 6. Đoạn bổ sung cho Chính sách bảo mật (`https://izziapi.com/privacy`)

Trang này nằm ở repo **izzi-web**. Thêm một mục mới, song ngữ như phần còn lại của trang:

```markdown
## Dữ liệu từ Facebook (Chăm sóc khách hàng) / Facebook data (Customer Care)

Khi bạn kết nối một Fanpage với tính năng Chăm sóc khách hàng của izzi, izzi nhận và lưu:
- ID Facebook (theo ứng dụng) của người cấp quyền, ID và tên Page, mã truy cập (token) của Page (mã hoá AES-256-GCM);
- tin nhắn khách gửi tới Page (mã hoá, giữ 30 ngày);
- số điện thoại khách tự gửi trong tin nhắn, tên Facebook của khách (tên được mã hoá; giữ 90 ngày kể từ tin nhắn cuối);
- hồ sơ khách do nhân viên của bạn tự nhập trong CRM (giai đoạn, người phụ trách, ngày hẹn, sản phẩm quan tâm, việc tiếp theo, ghi chú): mã hoá trên máy chủ izzi, giữ cùng khách (90 ngày kể từ tin nhắn cuối) và xoá cùng khách.
izzi đọc tin nhắn để liệt kê khách để lại số cho nhân viên của bạn. Khi bạn bật "Tự động trả lời khách", izzi gửi thay Page tối đa 3 tin trả lời mỗi khách trong 24 giờ, chỉ dùng thông tin bạn đã duyệt, để xin số điện thoại hoặc Zalo; các tin đó được mã hoá và giữ 30 ngày. izzi không bán hay chia sẻ dữ liệu này.

(Thêm khi bật thẻ nhận diện AI, CRM S3; chủ shop duyệt câu chữ trước:) izzi hỏi khách qua Messenger có đồng ý cho shop lưu thông tin không. Chỉ khi khách bấm Đồng ý, izzi mới dùng AI ghi lại từ hội thoại với Page: cách xưng hô, nhóm tuổi ước tính, người được mua cho (theo lời khách), quảng cáo khách đã bấm, tiêu đề và tên miền của link khách gửi, mức ngân sách. izzi không xem trang cá nhân, không mở link, không ghi giới tính, tôn giáo hay sức khoẻ. Khách nhắn KHÔNG để rút đồng ý, XOÁ để xoá toàn bộ dữ liệu.

Xoá dữ liệu: chủ shop có thể xoá dữ liệu của từng khách ngay trong app (nút "Xoá dữ liệu khách"), ngắt kết nối Page, hoặc gỡ ứng dụng trong Cài đặt Facebook → Ứng dụng và trang web → Gửi yêu cầu xoá. Bạn cũng có thể email support@izziapi.com.

When you connect a Facebook Page to izzi Customer Care, izzi receives and stores: the app-scoped Facebook ID of the person who granted access, the Page ID, name and Page access token (encrypted with AES-256-GCM); messages customers send to the Page (encrypted, kept 30 days); phone numbers customers send in those messages and the customer's Facebook name (the name encrypted; kept 90 days after their last message); and the customer profile your staff enter by hand in the CRM (stage, owner, dates, products of interest, next step, notes), stored encrypted on the izzi server, kept with the customer (90 days after their last message) and deleted with them. izzi reads messages to list customers who left a phone number for your staff. When you turn on "Automatic replies", izzi sends up to 3 replies per customer in 24 hours on the Page's behalf, using only information you approved, to ask for a phone number or Zalo; those replies are stored encrypted for 30 days. izzi does not sell or share this data.

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

- **CRM S3 (thẻ nhận diện AI):**
  - Lớp đơn hàng (dịp mua, thời điểm, sản phẩm) được ghi trước khi khách trả lời. Nếu luật sư coi đó là lập hồ sơ (Platform Terms 3.a), tắt phần này.
  - izzi chỉ hỏi xin phép khi đã đặt `CUSTOMER_CARE_PROFILE_PRIVACY_URL`: câu hỏi luôn kèm đường dẫn "(chi tiết: …)", chưa đặt thì nút "Xin phép khách" không hiện. Trang chính sách phải nói thời hạn lưu khớp với 90 ngày của lead.
  - Khách nhắn "XOÁ" khi chưa được báo trước: izzi không tự xoá, thẻ khách hiện "Khách yêu cầu xoá dữ liệu" để chủ shop hoặc quản lý xoá bằng "Xoá dữ liệu khách".
  - Mở rộng ra ngoài danh sách workspace thử cần khai báo trong App Review trước.

- **Phase C (tự trả lời):**
  - Không có câu báo "trợ lý tự động" trong tin (quyết định của chủ shop, 18/11). Chính sách Meta chỉ bắt buộc ở nơi luật yêu cầu (ví dụ người dùng ở California, Đức) và khuyến nghị ở mọi nơi. Nếu người duyệt hỏi, trả lời rằng shop bán cho khách ở Việt Nam và có thể bật câu báo sau.
  - Nếu Page đặt ứng dụng khác (Pancake) làm ứng dụng mặc định trong Phân luồng hội thoại, tin về izzi ở dạng `standby` và izzi không trả lời; màn Care báo lý do.
  - Một echo đến trong 10 giây sau tin khách được coi là trả lời tự động (Trả lời nhanh, lời chào), không làm izzi dừng; khách có thể nhận hai lời chào nếu chưa tắt các tính năng đó.

## 8. Sau khi được duyệt

1. Chuyển app sang **Live mode**, nếu chưa.
2. Thử lại luồng ở mục 3 bằng một tài khoản **không** có vai trò trên app.
3. Theo dõi log backend (`CUSTOMER_CARE_WEBHOOK`, `CUSTOMER_CARE_AUTO_REPLY`, `CUSTOMER_CARE_PAGE_ECHOES`, `CUSTOMER_CARE_DATA_DELETION`). Log chỉ có số đếm và mã lý do, không có nội dung tin nhắn.
