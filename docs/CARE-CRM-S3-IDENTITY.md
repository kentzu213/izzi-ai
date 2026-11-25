# Care CRM S3: the AI customer identity card

The owner approved building slice I4 (desktop) on 2026-11-25. That covers code and tests only: a merge, a release, the backend deploy, the migration and switching the flag on each need their own explicit OK from the owner.

Related: `CARE-CRM-S1-S2.md` (the staff profile and call list this builds on) and `CARE-FACEBOOK-APP-REVIEW-PACKET.md` (updated for the identity card, the consent question and link capture).

Backend: izzi-backend `feat/care-crm-identity` at `bae6259` (I0 + I1) plus the review fixes in `84c2523`. Desktop: this slice (I4).

## What the card holds

The identity has two layers.

- **Order layer**, allowed before the customer answers: the occasion, when they need it (`timeline`: this week, this month, before Tết, later) and the shop's products they asked about.
- **Profile layer**, only after the customer tapped "Đồng ý": the form of address, an age band, who the purchase is for, interests (the ad they came from, links they shared, a budget band) and a persona (P1 Bàn thờ nhà mới, P2 Tết/giỗ, P3 Tranh/quà biếu, P4 Hỏi giá).

Fixed rules, enforced on the server and shown the same way on the desktop:

- **Age is an estimated band, never an age.** One band or two adjacent ones (18–24, 25–34, 35–44, 45–54, 55+), always labelled "ước tính". It comes only from how the customer writes (the forms of address they use, "mua cho bố mẹ", a stated age), never from a photo or a name.
- **Family is only what the customer said.** The value is who the purchase is for (self, spouse, parents, children, household, gift), and it is kept only with a verbatim quote of the customer's own words. Death, illness and conflict are never recorded. There is no marital-status field.
- **There is no gender.** The form of address (anh, chị, cô, chú, bạn) is what staff use; what the customer calls themselves counts, the Facebook name is only a weak hint. No religion or health field exists either, by type.
- **Consent gates the profile layer.** Without "Đồng ý" the server keeps and returns the order layer only, and the desktop checks this a second time before it shows anything else.
- **There is never any profile scraping.** izzi does not read a person's Facebook profile, does not open the links customers send, and does not look anyone up elsewhere. A shared link keeps its title and domain only; a link to a social network (Facebook, Messenger, Instagram, Threads, Zalo, TikTok, a YouTube channel) keeps its domain only, without a title.
- Each field carries a confidence computed by the server (the customer said it = high, two or more signals = medium, one signal = low). Low-confidence fields are never shown. Interests expire after 90 days.
- Staff decisions win. A confirmed or corrected field is never overwritten by the AI, and a rejected value is never proposed again. The staff form of address and occasion lock the AI fields of the same name.
- The identity is never used for pricing, refusing service, or targeting ads by age or family.

## Consent

- **Chip:** Chưa hỏi (unknown), Đã hỏi (asked), Đồng ý (granted), Từ chối (declined or withdrawn).
- **"Xin phép khách"** (staff send the question): enabled only when the server says `consent.canAsk`. That needs the AI profile on for the workspace, a state of unknown or asked, fewer than 2 questions so far, the last one at least 7 days ago, the customer's last message less than 23 hours old, and no refusal or erasure in the last 24 months. Before sending, the desktop shows the exact message in a confirm dialog:

  > Dạ em là trợ lý tự động của {Page} ạ.
  > Dạ, để tư vấn đúng và báo ưu đãi hợp với nhà mình, {Page} xin phép lưu thông tin anh/chị nhắn tại đây. Anh/chị bấm Đồng ý nhé; không muốn thì bấm Không hoặc nhắn KHÔNG bất cứ lúc nào, shop vẫn tư vấn bình thường ạ.

  with the quick replies [Đồng ý] [Không] (copy version 1). When `CUSTOMER_CARE_PROFILE_PRIVACY_URL` is set, the server adds " (chi tiết: {link})" after "tại đây"; the desktop cannot see that setting yet, so the dialog shows the text without it (it is not set today).
- **The customer's answer:** the "Không" button always counts as a refusal. An exact "KHÔNG" counts after a grant or within 30 days of a question; a lowercase "không" within 7 days of a question. An exact "XOÁ"/"XÓA" always erases the customer. A refusal wipes the AI fields, marks the customer as not wanting offers and excludes them from every export; izzi answers "(Trợ lý tự động) Dạ shop đã ghi nhận ạ". Silence is never consent.
- **"Khách rút đồng ý"** (staff record a withdrawal, after a confirm): offered when the customer agreed or was asked. It works even while the AI profile is off, because it protects the customer.
- The consent log keeps a keyed hash of the customer, never the PSID.

## API (Care Facebook router; owner, manager and editor; 30 requests a minute per user across every Care route)

- `GET /crm?workspaceId=…&include=identity`: the S1 answer plus `identityEnabled` on the envelope and `identity` on every row. Without `include` the answer is S1's, byte for byte, and a server without S3 ignores the parameter.
- `POST /crm/identity`: `{ workspaceId, leadId, action, … }`. `confirm`, `correct` and `reject` carry `field` and `expectedVersion` (the identity `version` the card opened with); `correct` adds `value`, a shared link adds `index` (0–2). `ask_consent` and `withdraw_consent` carry nothing else. A 200 returns the identity after the action; a 409 `identity_conflict` returns the current identity and writes nothing.
- `POST /crm/identity/refresh`: `{ workspaceId, leadId }`. The model runs synchronously (about 30 s at most); a 200 returns the identity and `outcome` (`updated` or `no_change`).

Errors are read by `reason` and shown in short Vietnamese:

| Status | Reason | Shown |
|---|---|---|
| 400 | `invalid_request` | Giá trị không hợp lệ. Hãy tải lại rồi thử lại. |
| 403 | `forbidden` | the CRM's lost-access text; the rows are dropped |
| 409 | `identity_conflict` | Hồ sơ vừa được cập nhật. Hãy xem lại rồi thao tác tiếp. (the card reloads) |
| 409 | `identity_running` | AI đang cập nhật hồ sơ này. Chờ một lát rồi thử lại. |
| 422 | `consent_required` | Khách chưa đồng ý lưu hồ sơ. |
| 422 | `outside_window` | Đã quá 24 giờ từ tin cuối của khách nên Messenger không cho gửi. Chờ khách nhắn lại. |
| 422 | `ask_limit` | Chưa xin phép được lúc này: đã hỏi đủ 2 lần (cách nhau 7 ngày), đang có lời xin phép đang gửi, hoặc khách đã từ chối trong 24 tháng. |
| 422 | `page_not_connected` | Page chưa kết nối với izzi nên chưa gửi được. |
| 422 | `permission_missing` | Page chưa cho izzi quyền gửi tin nhắn. Kết nối lại Page để cấp quyền. |
| 422 | `lead_not_found` | on a field action or refresh: the customer left the list (the row is removed); on a consent action: no stored conversation (messages are kept 30 days), the row stays |
| 429 | `refresh_too_soon` | Thử lại sau N phút. (`retryAfterSec`, rounded up) |
| 429 | `daily_cap` | Hôm nay đã hết lượt cập nhật hồ sơ. Mai thử lại nhé. |
| 429 | `rate_limited` | Đang có nhiều yêu cầu. Chờ ít phút rồi thử lại. |
| 502 | `ai_unavailable` | AI đang bận. Thử lại sau ít phút. |
| 502 | `provider_rejected` / `provider_timeout` / `provider_unavailable` | Facebook did not take the question; try again later |
| 503 | `profile_ai_off` | AI hồ sơ khách chưa bật. |
| 503 | `not_configured` | Máy chủ izzi chưa sẵn sàng cho hồ sơ AI. Hãy liên hệ hỗ trợ izzi. |

## Desktop I4

- **Main:** `apps/desktop/src/main/customer-care/care-crm-identity.ts` parses the identity block, both route answers and the renderer's input against exact allowlists (an unknown key anywhere rejects it) and maps every reason. `care-crm.ts` accepts a list answer either with `identityEnabled` and an `identity` on every row, or with neither (identity unavailable); a mix is rejected. `care-crm-client.ts` sends `include=identity` and calls the two routes; the refresh waits 45 s, the other calls keep 8 s. IPC channels `customerCare:identityAction` (`{ leadId, action, field?, value?, index?, expectedVersion? }`, the exact keys of each action) and `customerCare:refreshIdentity` (`{ leadId }`). The workspace always comes from main's live authority, and an answer that arrives after an account or workspace change is dropped.
- **Renderer:** `CustomerCrmIdentity.tsx` is the card section, shown in the table editor and on the graph card; `customer-crm-identity.ts` holds its pure rules. Each shown field has its value, an "AI" or "Đã duyệt" badge, the confidence, a short evidence quote (the customer's words, or another source named, e.g. "Shop:"; family shows only the customer's words), and Duyệt (AI suggestions only) / Sửa / Bỏ. The source ad takes no action. Links are plain text, never clickable. On the graph card the AI occasion is acted on in its single "Dịp mua" row.
- **Concurrency:** the card sends the identity `version` from when it opened; the 60 s list refresh does not move it, an answer (a 409 included) does. A 409 shows "Hồ sơ vừa được cập nhật" with the current identity. One action runs at a time per card.
- **Refresh:** "Cập nhật hồ sơ" shows a spinner for up to 45 s; a timeout or a lost connection ends it with a notice.
- **Rate budget:** every identity request is started by a person. Nothing polls beyond the existing page-1 refresh, which now carries the identity in the same request. A 429 or a server problem skips the next tick.
- **AI profile off** (`identityEnabled: false`): "AI hồ sơ khách chưa bật"; the values stay visible read-only and only "Khách rút đồng ý" remains.
- **Nothing is persisted:** identities live in the panel's memory with the rows. They never reach SQLite, settings, `graph_nodes`, files or logs; the client logs only a route label and a status.

## Open items

- The desktop cannot show the "(chi tiết: …)" privacy link in the consent preview until the server exposes whether it is set.
- A `daily_cap` answer carries no `retryAfterSec`; the desktop says "mai thử lại".
- Before the flag goes on (I5): the consent copy, the privacy policy (its retention must match the 90-day lead life) and the App Review packet need the owner's approval.
