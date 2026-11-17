# Kế hoạch: Chủ shop cấp phép → Page Facebook chạy trong Chăm sóc khách hàng (izzi Care)

Ngày: 2026-11-17 · Trạng thái: **CHỜ DUYỆT** — chưa viết dòng code nào.
Pilot: Đồng Thờ Hồng Hưng, Page `105252511858057` (Care đã lưu 8 thông tin, chuyển Sale, đang ở chế độ thử).

Không đẩy code, không deploy, không gọi Meta bằng token thật và không nhắn khách thật nếu bạn chưa đồng ý rõ ràng.

---

## 1. Hiện trạng (đã kiểm lại code ngày 17/11)

| Hạng mục | Thực tế | Vị trí |
|---|---|---|
| App Meta + OAuth | Đã có trong backend, module Native Marketing, cấu hình qua `MARKETING_FACEBOOK_*` | `izzi-backend/src/services/nativeMarketingProviders.ts` |
| Quyền đang xin | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (chỉ để **đăng bài**) | `nativeMarketingProviders.ts:176` |
| Chọn Page | Lấy **Page đầu tiên** trong `/me/accounts`, hoặc một Page ghim cứng cho toàn hệ thống | `nativeMarketingProviders.ts:437-440` |
| Token | Không đổi sang token dài hạn; nếu Meta không trả `scope` thì ghi đại danh sách quyền đã xin, không kiểm quyền thật | `nativeMarketingProviders.ts:681` |
| Ai được kết nối | Chỉ **owner** của workspace | `routes/marketing.ts:76-88` |
| Care | Cho **owner/manager** sửa, cùng bảng `marketing_workspaces` | `customer-care-service.ts:98-99` |
| Care: chế độ | `mode:'shadow'`, `outboundEnabled:false` viết cứng; Page ID gõ tay, chưa xác minh | `customer-care-service.ts:927, 941-942` |
| Messenger | **Chưa có gì**: không webhook, không `subscribed_apps`, không đọc/gửi tin | — |
| Graph API | Đang dùng **v21.0, Meta chỉ hỗ trợ tới 21/01/2027** (còn ~2 tháng) | changelog Meta |
| Redirect relay | Route GET `/api/marketing/oauth/callback` **bắt buộc có `?platform=`**, nhưng `.env.example` ghi redirect không có tham số này → cần kiểm env prod | `routes/marketing.ts:449-469` |
| Deploy backend | Đang bị chặn (pool codex-lb ở gói free). Prod chạy từ nhánh hotfix `d8b5bc4`, `master` có 38 commit chưa deploy | memory |

### Có phải lấy lại token không? **Có, chủ shop phải cấp phép lại một lần.**
Token Marketing đang lưu không dùng được cho Care vì ba lý do:
1. Token chỉ có quyền đăng bài, không có quyền đọc hoặc gửi tin nhắn.
2. Token gắn với Page đầu tiên của người cấp, không chắc là Page của shop.
3. Token chưa được đổi sang dài hạn nên có thể đã hết hạn.

Care sẽ có kết nối riêng. Nếu duyệt **Lựa chọn S1** (mục 4), shop chỉ phải bấm cấp phép **một lần** cho cả ba phase.

---

## 2. Điều Meta bắt buộc (đã đối chiếu tài liệu Meta hiện hành)

- Nhận webhook tin nhắn cần **`pages_messaging` + `pages_manage_metadata`**. Page token phải đến từ người có quyền **MODERATE** trên Page.
- **Standard Access** (chưa qua review) chỉ nhận tin từ **người có vai trò trên app** (admin/developer/tester). Muốn nhận tin của **khách thật** phải có **Advanced Access**, tức là **qua App Review**. Thông thường Meta còn đòi **Business Verification**.
- Webhook phải trả `200 OK` trong **≤ 5 giây**. Nếu lỗi liên tục **1 giờ**, Meta tắt webhook và gỡ đăng ký. Meta có gửi lặp nên phải chống trùng. Mỗi request ký `X-Hub-Signature-256` (HMAC-SHA256 bằng App Secret).
- Chỉ được trả lời trong **24 giờ** kể từ tin cuối của khách. Tag **HUMAN_AGENT** cho phép trả lời thủ công thêm 7 ngày, nhưng đó là tính năng xin riêng.
- Chính sách Meta khuyến nghị báo cho khách biết khi họ đang nói chuyện với hệ thống tự động. Ở đây người duyệt rồi mới gửi, nhưng nội dung do AI soạn, nên bạn cần quyết câu chữ (mục 7).

**Hệ quả cho pilot Hồng Hưng:** trước khi App Review được duyệt, phase A (kết nối/xác minh) làm được ngay nếu tài khoản Facebook quản trị Page được thêm làm **Tester** của app. Phase B chỉ test được bằng tin nhắn từ tài khoản có vai trò trên app; tin khách thật chỉ về sau khi có Advanced Access.

---

## 3. Các phase

### Phase A — Kết nối & xác minh Page (chỉ code, không cần App Review) ← làm trước
Mục tiêu: owner/manager bấm **"Kết nối Page Facebook"** → đăng nhập Facebook → **chọn Page** → izzi xác minh người cấp quản trị đúng Page đó và token hợp lệ → Care hiện "Đã kết nối: <tên Page>". Care **vẫn ở chế độ thử**, chưa nhận và chưa gửi tin.

Backend (`izzi-backend`):
1. Migration mới: bảng `customer_care_page_bindings`, bảng `customer_care_facebook_page_choices` (tạm, 15 phút), bảng state OAuth riêng `customer_care_oauth_states` (xem mục 5). Không sửa bảng nào đang có. *(Cập nhật 17/11 sau review: ban đầu định thêm cột vào `marketing_oauth_states`; tách bảng riêng để route Marketing không bao giờ đụng state của Care và không phụ thuộc thứ tự deploy.)*
2. Route mới `/api/marketing/care/facebook/*`, tách khỏi route Marketing. Route Marketing giữ nguyên hành vi:
   - `POST /connect`: kiểm vai trò owner/manager qua `marketing_workspace_members`, tạo state một lần dùng trong bảng state của Care, gắn người bấm, trả về authorize URL có bộ quyền Care và `auth_type=rerequest`.
   - `POST /callback`: tiêu state (phải đúng workspace + người bấm), đổi code lấy token, đổi sang **token dài hạn** (`fb_exchange_token`), đọc `/me/accounts?fields=id,name,access_token,tasks` (tối đa 25 Page), đánh dấu Page đủ điều kiện (có task `MODERATE`), niêm phong token từng Page, lưu vào lựa chọn tạm. Trả danh sách `{pageId, name, eligible, reason}` (không có token) cùng `choiceId`.
   - `POST /select`: kiểm lại vai trò, lựa chọn tạm phải còn hạn và đúng người, rồi **xác minh bằng `debug_token`**: `is_valid`, `app_id` khớp, `type=PAGE`, `profile_id == pageId`, có đủ quyền cần, `granular_scopes.target_ids` chứa pageId. Đạt thì ghi binding; Page đang gắn với workspace khác thì **từ chối** (không lộ là workspace nào).
   - `GET /status`: trạng thái kết nối, không có token. Kiểm lại `debug_token` tối đa 6 giờ/lần; token chết thì chuyển `needs_reauth`.
   - `DELETE /`: ngắt kết nối và xoá token.
   - Mọi lệnh gọi Graph của Care kèm `appsecret_proof`.
3. Nâng Graph API **v21.0 → v26.0** (bản mới nhất) cho cả Marketing. Endpoint dùng ở đây không đổi.
4. Kiểm cấu hình: nếu redirect URI Facebook không chứa `platform=facebook`, route Care báo `not_configured` (fail-closed) thay vì để Meta trả về rồi relay báo 400.

Desktop (`izzi-ai`):
1. `care-facebook-client.ts`: client cho các route trên, parse chặt theo allowlist giống `native-marketing-client.ts`.
2. `customer-care-service.ts`: snapshot có thêm `pageConnection`. Blocker Page tính từ kết nối thật: chưa kết nối / cần kết nối lại / Page đã kết nối khác Page trong thiết lập / OK. Thay `mode`/`outboundEnabled` viết cứng bằng hàm thuần `deriveCareMode()`. Ở phase A hàm này luôn trả `shadow` kèm lý do.
3. IPC `customerCare:connectFacebookPage | selectFacebookPage | disconnectFacebookPage`. Deep link `openclaw://marketing/oauth/callback` dùng chung, phân luồng theo state đang chờ của Care.
4. Màn Care: thay ô Page ID gõ tay bằng nút kết nối + hộp chọn Page + trạng thái. Nếu backend chưa có route (404), hiện "Máy chủ chưa bật kết nối Page", nút vô hiệu.

Ra bản: desktop có thể phát hành trước (fail-closed khi backend chưa có). Backend cần migration + deploy prod, **cắt từ nhánh hotfix của prod, không từ `master`**, và chỉ chạy khi bạn OK cùng khi deploy hết bị chặn.

**Xong phase A khi:** test xanh. Review độc lập không còn lỗi CRITICAL/HIGH. Trên app thật, bạn (Tester) kết nối được Page Hồng Hưng, Care hiện đúng tên Page, blocker "Page chưa kết nối" mất, chế độ vẫn là "thử".

### Phase B — Nhận tin nhắn vào izzi (cần `pages_messaging`, `pages_manage_metadata`)
- Backend: `GET/POST /api/meta/webhook` có xác minh `hub.challenge` bằng verify token trong env và kiểm chữ ký HMAC trên **raw body**, so sánh constant-time, giới hạn kích thước. Request được **ghi bền rồi mới trả 200**.
- Bảng `customer_care_inbound_events`: chống trùng theo `mid`, tìm workspace qua `page_id → binding đang active`, Page lạ thì bỏ và chỉ đếm. Nội dung tin được niêm phong, giữ 30 ngày.
- Khi gắn Page: `POST /{page}/subscribed_apps` (messages, messaging_postbacks). Khi ngắt: gỡ đăng ký. Có job kiểm đăng ký định kỳ để tự đăng ký lại nếu Meta đã tắt webhook.
- Desktop: hộp thư Care kéo tin theo con trỏ (poll); mỗi hội thoại có nút "Soạn nháp" dùng `assist()` hiện có (chỉ trả lời bằng thông tin đã duyệt). **Vẫn không gửi.**
- Meta: cần callback xoá dữ liệu (Data Deletion) trước khi app Live.

### Phase C — Gửi trả lời sau khi người duyệt (cần `pages_messaging`)
- Bảng `customer_care_outbound_messages` lưu nháp, fact IDs, người duyệt, thời điểm duyệt, idempotency key, trạng thái, `mid` khi gửi xong.
- Backend chỉ gửi khi **đủ tất cả** điều kiện:
  - Binding đang active và có đủ quyền.
  - Còn trong cửa sổ 24 giờ, tính **trên server** từ tin khách cuối cùng.
  - Người duyệt là owner hoặc manager.
  - Nội dung gửi **đúng nguyên văn** bản đã duyệt.
  - Công tắc `outbound_enabled` của Page đang bật. Mặc định tắt, owner tự bật.
  - Công tắc tổng trong env đang bật.
- Gửi bằng Send API với `messaging_type=RESPONSE` và ghi audit.
- `deriveCareMode()` trả `assisted` khi đủ điều kiện, ngược lại trả `shadow` kèm lý do.
- HUMAN_AGENT (7 ngày) để làm sau, cần review riêng.

---

## 4. Quyền Meta theo phase

| Phase | Quyền | Dùng để | Khách thật dùng được khi |
|---|---|---|---|
| A | `pages_show_list` | Liệt kê Page + lấy Page token | Có Advanced Access (review). Trước đó chỉ Tester. |
| B | `pages_manage_metadata` | `subscribed_apps` (bật webhook cho Page) | App Review + Business Verification |
| B, C | `pages_messaging` | Nhận và gửi tin Messenger | App Review + Business Verification |
| (nếu cần) | `business_management` | Page thuộc Business Manager không hiện trong `/me/accounts` | App Review |
| sau C | Human Agent | Trả lời thủ công tới 7 ngày | Review riêng |

**Lựa chọn S1 (đề xuất):** phase A xin ngay đủ bộ `pages_show_list + pages_manage_metadata + pages_messaging` để chủ shop chỉ cấp phép **một lần**. Trước review chỉ Tester mới cấp được nên không có rủi ro lộ quyền. Token chưa dùng cho tin nhắn cho tới khi code B/C có và công tắc được bật.
**S2:** phase A chỉ xin `pages_show_list` (tối thiểu quyền), đến phase B shop cấp thêm một lần. App tự phát hiện thiếu quyền và hiện nút "Cấp thêm quyền".

---

## 5. Mô hình dữ liệu (phase A)

```sql
-- State OAuth riêng của Care: hash, dùng một lần, gắn người bấm, ≤ 1 giờ
create table public.customer_care_oauth_states (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.marketing_workspaces (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  state_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);

-- Lựa chọn Page tạm thời sau OAuth (≤ 15 phút, dùng một lần)
create table public.customer_care_facebook_page_choices (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.marketing_workspaces (id) on delete cascade,
  actor_user_id  uuid not null references public.profiles (id),
  pages          jsonb not null,          -- [{pageId,name,tasks,eligible,reason,sealedPageToken}] ≤ 25
  granted_scopes text[] not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

-- Page đang gắn với Care của một workspace
create table public.customer_care_page_bindings (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.marketing_workspaces (id) on delete cascade,
  platform               text not null default 'facebook' check (platform = 'facebook'),
  page_id                text not null check (page_id ~ '^[0-9]{5,30}$'),
  page_name              text,
  page_access_token      text,           -- phong bì mkt1 AES-256-GCM; null khi đã ngắt
  granted_scopes         text[] not null default '{}',
  token_expires_at       timestamptz,    -- null = Page token không hết hạn
  status                 text not null check (status in ('active','needs_reauth','disconnected')),
  bound_by               uuid not null references public.profiles (id),
  verified_at            timestamptz not null,
  webhook_subscribed_at  timestamptz,    -- phase B
  outbound_enabled       boolean not null default false,  -- phase C, mặc định TẮT
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- Một Page chỉ thuộc một workspace (để webhook định tuyến không mơ hồ)
create unique index customer_care_page_bindings_page_uq
  on public.customer_care_page_bindings (page_id) where status <> 'disconnected';
-- Phase A: mỗi workspace một Page Care
create unique index customer_care_page_bindings_workspace_uq
  on public.customer_care_page_bindings (workspace_id) where status <> 'disconnected';
-- RLS bật, KHÔNG cấp cho anon/authenticated; chỉ service_role của backend đọc/ghi.
```

Token Care **tách khỏi** `marketing_social_accounts` để kết nối Care không ghi đè token đăng bài của Marketing và ngược lại. Phần dùng lại: cấu hình app (`MARKETING_FACEBOOK_*`), relay OAuth, bảng state, kho mã hoá token `mkt1`, hàm fetch có giới hạn.

---

## 6. Mô hình bảo mật

- **Cách ly tenant:** workspace luôn suy ra từ JWT + bảng thành viên. `workspaceId` gửi lên chỉ dùng để chọn trong các workspace người gọi đã thuộc. Vai trò được kiểm lại ở **mỗi** request trên server; desktop chỉ hiển thị, không quyết định quyền.
- **Vai trò:** kết nối, ngắt kết nối, chọn Page và bật gửi: owner + manager, khớp quyền sửa của Care. Xem trạng thái: mọi thành viên. Route đăng bài Marketing vẫn chỉ owner.
- **OAuth state:** CSPRNG 32 byte, DB chỉ lưu hash, dùng một lần (claim trong DB), có hạn, nằm trong bảng riêng của Care, gắn workspace và người bấm.
- **Chứng minh sở hữu Page:** người cấp phải có task MODERATE trên Page. `debug_token` phải khớp app, loại PAGE, đúng `profile_id`, đúng quyền và đúng target. Lệnh gọi Care kèm `appsecret_proof`. Token và app secret không bao giờ nằm trên URL.
- **Token:** không bao giờ rời backend; niêm phong `mkt1`; log chỉ chứa mã lý do có giới hạn (theo mẫu sẵn có); ngắt kết nối thì xoá token.
- **Một Page một tenant:** unique index. Page đang gắn chỗ khác thì từ chối bằng thông báo chung và xử lý qua hỗ trợ.
- **Fail-closed:** thiếu cấu hình, thiếu khoá vault, Meta lỗi hoặc backend chưa có route đều dẫn tới không kết nối và vẫn ở chế độ thử.
- **Phase B/C:** webhook kiểm chữ ký, chống trùng, có rate limit. Tin khách được niêm phong và có hạn lưu. Gửi chỉ qua cổng server, có idempotency, cửa sổ 24 giờ, hai lớp công tắc tắt và audit.

---

## 7. Rủi ro

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| 1 | App Review + Business Verification mất nhiều ngày tới vài tuần, có thể bị từ chối. Trước đó khách thật không nhắn được vào izzi. | Nộp sớm, song song với code B. Pilot bằng tài khoản Tester. |
| 2 | Graph v21.0 hết hỗ trợ ngày 21/01/2027 | Nâng lên v26.0 ngay trong phase A |
| 3 | Redirect URI trên prod có thể thiếu `?platform=facebook` | Bạn kiểm env + dashboard (mục 8). Code báo `not_configured` rõ ràng. |
| 4 | Deploy backend đang bị chặn; `master` có 38 commit/migration chưa lên prod | Cắt nhánh từ hotfix prod; chỉ deploy khi bạn OK |
| 5 | Hồng Hưng đang dùng công cụ inbox khác (Pancake, Business Suite…). Theo Conversation Routing, izzi có thể chỉ nhận sự kiện `standby` hoặc gửi đụng nhau. | Cần bạn cho biết Page đang dùng công cụ nào (trước phase B) |
| 6 | Page thuộc Business Manager có thể không hiện nếu thiếu `business_management` | Phase A báo rõ "không thấy Page"; thêm quyền nếu gặp |
| 7 | Token chết khi người cấp đổi mật khẩu, mất vai trò hoặc gỡ app | `debug_token` định kỳ → `needs_reauth` → nút "Kết nối lại" |
| 8 | Webhook lỗi 1 giờ (từng có sự cố Supabase) thì Meta tắt webhook | Ghi bền rồi mới trả 200; job tự đăng ký lại; cảnh báo |
| 9 | Dữ liệu cá nhân của khách (Nghị định 13/2023) | Niêm phong, lưu 30 ngày, cập nhật chính sách quyền riêng tư, callback xoá dữ liệu |
| 10 | Câu chữ báo "đang trò chuyện với hệ thống tự động" | Bạn quyết khi tới phase C |

---

## 8. Việc bạn cần làm trên Meta Developer Dashboard

**Ngay (để thử phase A):**
1. Xác nhận App ID mà backend prod dùng (`MARKETING_FACEBOOK_CLIENT_ID`) đúng là app "Marketing" bạn nói, và app thuộc Business của izzi.
2. Facebook Login → **Valid OAuth Redirect URIs**: thêm đúng chuỗi `https://api.izziapi.com/api/marketing/oauth/callback?platform=facebook`. Env `MARKETING_FACEBOOK_REDIRECT_URI` trên prod phải giống **từng ký tự**.
3. App Roles → thêm tài khoản Facebook đang quản trị Page Hồng Hưng làm **Tester** (người đó phải chấp nhận lời mời).
4. **Chưa** bật "Require App Secret". Lệnh gọi Graph của Care sẽ kèm `appsecret_proof`, nhưng luồng đăng bài Marketing hiện tại thì chưa, nên bật lúc này sẽ làm hỏng Marketing. Để sau khi cả hai luồng cùng gửi proof.
5. Settings → Basic: điền Privacy Policy URL, Terms URL, User Data Deletion, icon, category (bắt buộc khi lên Live/nộp review).

**Phase B:**
6. Thêm sản phẩm **Messenger**. Webhook callback `https://api.izziapi.com/api/meta/webhook` với verify token tôi sẽ đưa qua env; đăng ký `messages`, `messaging_postbacks`.
7. **Business Verification** (Business Settings → Security Center).
8. **App Review**: xin Advanced Access cho `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, kèm video quay luồng kết nối → hộp thư → nháp → người duyệt gửi, và tài khoản test cho reviewer.

**Phase C (tuỳ chọn):** 9. Xin tính năng Human Agent nếu cần trả lời quá 24 giờ.

---

## 9. Các quyết định mặc định (duyệt kế hoạch là duyệt các mặc định này, trừ khi bạn ghi khác)

- **S1**: xin đủ quyền một lần ngay từ phase A.
- Owner + manager được kết nối Page cho Care.
- Mỗi workspace một Page Care. Một Page chỉ gắn một workspace.
- Nâng Graph lên v26.0 trong phase A.
- Desktop có thể phát hành trước backend (fail-closed). Backend deploy chờ bạn OK.
- Sau khi duyệt, tôi viết kế hoạch chi tiết TDD cho phase A (từng task, file, test) rồi mới code. Code xong cho review độc lập (socrates + security-reviewer).
