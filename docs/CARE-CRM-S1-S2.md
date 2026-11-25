# Care CRM S1 + S2: customer profiles and a call list

Approved by the owner on 2026-11-24 ("Duyệt, làm S1+S2"). That approval covers building S1 and S2 only. A migration, a deploy, a merge or a release each needs its own explicit OK from the owner.

Related: `CARE-FACEBOOK-PHASE-B1-API.md` (the lead routes this builds on) and `CARE-FACEBOOK-APP-REVIEW-PACKET.md` (updated: the customer name is stored sealed).

## Scope

- **Backend S1** (izzi-backend): a sealed CRM profile per Care lead, two routes, and sealing of the customer name.
- **Desktop S2** (this repo): MyGraph gets two tabs. "Memory doanh nghiệp" is the existing graph view, unchanged. "CRM" is a native table where staff fill in profiles by hand and work a call list. Nothing from the CRM is written to MyGraph nodes, `graph_nodes`, SQLite, settings, logs or files.

## Non-goals (later slices)

AI extraction; consent capture; hashed-phone or CSV export; remarketing queues; MyGraph segment nodes for the Director; purge by PSID for customers without a lead; retention past the lead's 90 days; keeping post or link attachments; graph filtering or grouping in the Memory tab. Marital status, religion, health and AI-inferred gender are never collected, in any slice.

> **Superseded in part by Care CRM S3 (2026-11-25), see `CARE-CRM-S3-IDENTITY.md`:** AI extraction, consent capture and link capture are now built. S3 keeps an AI-estimated age band (never an exact age, always labelled "ước tính") and who a purchase is for, in the customer's own quoted words, and only after the customer agreed. There is still no gender, marital-status, religion or health field, and no profile is ever read.

## Fixed decisions

1. **CRM rows are Care leads** (customers who left a phone or Zalo). One profile per lead, removed with its lead by a foreign key `ON DELETE CASCADE`, so every existing deletion path reaches it: `customer_care_purge_customer`, `customer_care_delete_facebook_grants` (and the user-data and settle paths that use it), the 90-day lead prune, and workspace deletion if it cascades.
2. **Plain columns only for sorting and counting:** `stage`, `owner_user_id`, `next_step_due_at`, `needed_by`, `purchased_at`, `updated_at`, `updated_by`. Everything else (address form, occasion, product fact ids, next-step text, lost reason, note) is one sealed JSON, `sealed_details`, with AAD bound to `workspace_id` + `lead_id`. Altar-item purchases may count as belief data, so all of it is treated as sensitive.
3. **Vault:** a new envelope prefix `ccm2` with AAD sits next to `ccm1` in the backend message vault; `ccm1` is unchanged. An envelope sealed for lead A must fail to open as lead B.
4. **`customer_name` stops being stored in plaintext.** A new `sealed_customer_name` (`ccm2`, AAD = workspace + lead) holds it. The migration clears existing plaintext names and their `name_checked_at`, then adds `CHECK (customer_name IS NULL)`. Old code running between migration and deploy degrades: its `saveCustomerName` failure is already caught, so the name shows that time and is looked up again next time.
5. **Stage syncs one way into the lead status**, in the same transaction: `has_phone` → `new`; `consulting` → `contacted`; `deposit`, `delivered`, `lost`, `do_not_contact` → `closed`. Changing the lead status in the Care panel does not change the stage.
6. **Roles:** owner, manager and editor read and edit profiles; a viewer gets 403 on both routes; deleting stays the existing `/leads/purge` (owner and manager). `owner_user_id` must be an active owner, manager or editor of the workspace.
7. **Concurrency:** a save carries `expectedUpdatedAt` (null for a first save). A mismatch answers 409 `profile_conflict` with the current row, and nothing is overwritten.
8. **SQL hardening:** the new table has RLS enabled and forced, no policies, and `revoke all` from public, anon and authenticated. Every new or replaced function revokes execute from public, anon and authenticated, grants it to `service_role`, and sets an explicit `search_path`. The migration is one transaction, named 20261125_customer_care_crm_profiles.sql in the backend repo.

## API contract

Both routes live in the existing Care Facebook router, mounted at `/api/marketing/care/facebook`, with the same auth, per-user rate limit (30 requests a minute, shared with the other Care routes) and error envelope `{ success:false, error, reason }`. The default body limit stays 4 KB; only `/crm/profile` gets 16 KB, the same way `/auto-reply` has its own limit.

### `GET /crm?workspaceId=<uuid>&cursor=<opaque|empty>`

Paged like `/leads`: 50 rows, newest phone first, keyset cursor.

```ts
// 200
{ success: true, workspaceId, role: "owner" | "manager" | "editor", canDelete: boolean,
  rows: CrmRow[], nextCursor: string | null,
  assignees: { userId: string, label: string }[] }
```

`assignees` lists the active owner, manager and editor members. `label` is the member's display name if the schema has one, otherwise a non-secret identifier; never another user's email unless the members UI already shows emails.

Errors: 400 `invalid_request`, 403 `forbidden`, 503 `not_configured` (vault broken or not configured).

### `POST /crm/profile`

Body `{ workspaceId, leadId, expectedUpdatedAt: string | null, profile: CrmProfileInput }`: a full replace of the editable fields, never a patch. Answers 200 `{ success: true, workspaceId, row: CrmRow }`.

Errors: 400 `invalid_request` (any field fails validation); 403 `forbidden` (a viewer, or an owner who is not an eligible member); 409 `profile_conflict` with `{ row: CrmRow }` holding the current state; 422 `lead_not_found` (the lead is not in this workspace); 503 `not_configured`.

### Types

```ts
type CrmStage = "has_phone" | "consulting" | "deposit" | "delivered" | "lost" | "do_not_contact";
type CrmOccasion = "new_home" | "tet" | "anniversary" | "gift" | "replacement" | "other";
type CrmAddressForm = "anh" | "chi" | "co" | "chu" | "ban";
type CrmLostReason = "price" | "bought_elsewhere" | "no_reply" | "not_needed" | "other";

interface CrmProfileInput {
  stage: CrmStage;                    // default for a lead with no profile: "has_phone"
  ownerUserId: string | null;         // uuid of an eligible member
  addressForm: CrmAddressForm | null; // chosen by staff; never inferred
  occasion: CrmOccasion | null;
  neededBy: string | null;            // "YYYY-MM-DD"
  productFactIds: string[];           // <= 8, each <= 64 chars, /^[A-Za-z0-9_.:-]+$/
  nextStep: string | null;            // trimmed, 1..200 chars, or null
  nextStepDueAt: string | null;       // ISO timestamp
  lostReason: CrmLostReason | null;   // only when stage === "lost"
  purchasedAt: string | null;         // "YYYY-MM-DD", only when stage is deposit | delivered
  note: string | null;                // trimmed, 1..1000 chars, or null
}

interface CrmRow {
  leadId: string; pageId: string;
  customerName: string | null;        // opened from sealed_customer_name (or a Graph lookup)
  phone: string; zaloMentioned: boolean;
  leadStatus: "new" | "contacted" | "closed";
  phoneCapturedAt: string; lastMessageAt: string;
  recentMessages: { text: string; at: string }[];   // same as /leads (<= 3)
  profile: CrmProfileInput & { updatedAt: string | null; updatedBy: string | null };
}
```

Validation: dates are real calendar dates; `neededBy`, `purchasedAt` and `nextStepDueAt` fall within two years before or after now; strings are rejected if they hold control characters (a `note` may keep newlines); unknown keys are rejected. Logs never carry a phone, name, PSID, note or next step: only the event, `workspaceId`, `actorUserId` and counts.

### Details fixed by the backend S1 build (2026-11-24)

- **Save body:** all 11 profile keys plus `expectedUpdatedAt` are required; an empty field is `null`, never a missing key. An empty or whitespace-only `nextStep` or `note` answers 400, so the desktop sends `null`. A `\r` in `note` answers 400, so the desktop turns line breaks into `\n` first. The server trims text and returns the trimmed value. Length is counted in characters (code points): an emoji counts as one.
- **Timestamps:** `nextStepDueAt` and `expectedUpdatedAt` carry a zone (`Z` or `±hh:mm`, at most 6 fractional digits). The desktop builds `nextStepDueAt` with `toISOString()` and sends `profile.updatedAt` back exactly as received.
- **Responses:** an owner who is no longer an eligible member comes back as `ownerUserId: null`. Each assignee `label` is a display name (at most 80 characters, never containing `@`) or `Thành viên <8 chars>`, ordered owner, manager, editor. A profile whose sealed details cannot be opened comes back with its plain fields, empty details and `profile.detailsUnreadable: true` (absent otherwise, never `false`); a save on it answers 503 `not_configured`, so the desktop shows that row's plain fields read-only with "Không đọc được chi tiết khách này." and never sends a save for it.
- **Errors:** read by `reason`, never by `error`: `invalid_request` 400, `forbidden` 403 (a viewer), `owner_not_eligible` 403 (the chosen owner left), `profile_conflict` 409 (with `row`, and no `workspaceId`; a stale save naming an ineligible owner also gets 409), `rate_limited` 429, `lead_not_found` 422 (its `error` text is a generic Page message, so the desktop shows its own Vietnamese text), `not_configured` 503. The body is validated before the role, so a viewer sending a bad body gets 400.
- **Save answers (final backend S1 build, izzi-backend branch feat/care-crm-s1):** after the database step commits, the 200 (and the 409) row may come back without its presentation: `phone: ""`, empty times, no messages, or fields left out. Main relaxes only this path and hands back the profile; the screen merges it into the row it shows and keeps that row's phone, messages and times. The POSTed `profile` holds the 11 editable keys only, never `updatedAt`, `updatedBy` or `detailsUnreadable` (unknown keys answer 400).
- **Text:** `nextStep` and `note` may not hold a control character (a note keeps line breaks), any format character (Cf) except the zero-width joiner (so ZWJ emoji work), U+2028 or U+2029. Main checks this exactly as the server does, on the value before trimming; the screen strips those format characters and turns the separators into line breaks before a save.
- **Load and rate budget:** `GET /crm` has no ETag or 304, each page costs several DB queries plus sealed messages, and all Care routes share 30 requests a minute per user. The 60 s tick (only while the tab is visible) reads page 1 only and merges it by `leadId`. Every page (up to 10) is read only when the tab opens (at most once per refresh period), on "Làm mới", and after a 409. A 429 (`rate_limited` on the desktop) or a 503 skips the next tick; a save that hit either waits for the user.

## Desktop S2

- **Main:** `apps/desktop/src/main/customer-care/care-crm.ts` holds the role rule (`canUseCareCrm`), the strict IPC-input parsers and the answer parsers; `apps/desktop/src/main/customer-care/care-crm-client.ts` calls the two routes (token only in the Authorization header, logs only a route label and status). `CustomerCareService.listCrm` and `saveCrmProfile` resolve the live marketing-workspace authority, exactly as the Care leads panel does, re-check it after the call, and hand back copies. IPC channels: `customerCare:listCrm` (`{ cursor }`) and `customerCare:saveCrmProfile` (`{ leadId, expectedUpdatedAt, profile }`). The workspace never comes from the renderer.
- **Renderer:** `apps/desktop/src/renderer/pages/CustomerCrmPanel.tsx` (state and IPC), `apps/desktop/src/renderer/pages/CustomerCrmRow.tsx` (row and form) and the pure `apps/desktop/src/renderer/pages/customer-crm-flow.ts`, plus the per-row `apps/desktop/src/renderer/pages/customer-crm-save-queue.ts`. The tab strip is in `apps/desktop/src/renderer/components/v2/MyGraphWorkspaceV2.tsx`; the legacy (non-V2) MyGraph page is unchanged.
- **Call list:** "Cần gọi hôm nay" holds rows whose next step is due today or overdue, plus `has_phone` rows with no next step. A `lost` or `do_not_contact` row is never on it and never counts as due, even with an old due date; a `delivered` follow-up stays. "Today", "overdue", the date pickers and due times use Vietnamese time (Asia/Ho_Chi_Minh, UTC+7) whatever zone the PC is set to. "Tất cả" holds everything; a stage filter narrows either view. Sort: overdue, then due today, then stage (`has_phone`, `consulting`, `deposit`, `delivered`, then `lost` and `do_not_contact`), then newest phone. Up to `CRM_MAX_PAGES` = 10 pages (500 rows) load.
- **Editing:** stage, owner (from `assignees`), address form, occasion, needed-by date, products (the shop's approved `catalog` and `price` Care facts on this machine; hidden when there are none), next step with a due date and time, lost reason (only for `lost`), purchase date (only for `deposit` and `delivered`), note. A row saves on "Lưu" or after a pause of `CRM_SAVE_DEBOUNCE_MS` = 1500 ms; one save per row at a time, and a failed save is never retried by itself.
- **Conflict:** an edit keeps the `updatedAt` of the version it started from (`baseUpdatedAt`) and every save sends that, so a refresh that swaps in someone else's newer row cannot turn an open draft into a silent overwrite. A 409 shows "Có người vừa cập nhật khách này", loads the server profile, reloads every page and lists the user's unsaved values with "Dùng lại thay đổi của tôi". A 400, 429 or 503 keeps the draft and the row editable; `owner_not_eligible` shows "Người phụ trách này không còn trong dự án." and re-reads page 1 for the assignees.
- **Other actions:** "Sao chép" copies the phone. "Xoá dữ liệu khách" runs the existing purge behind a confirm, shown only when `canDelete`. A viewer or a 403 shows "Bạn không có quyền xem CRM của dự án này." Every `CRM_REFRESH_MS` = 60000 ms while visible, page 1 is read again and merged; the tick pauses while hidden. "Làm mới" reads every page and then rests for 15 s. Leaving MyGraph sends any waiting save at once, and one final save for a row changed while its save was running. The Memory tab stays mounted (only hidden) while CRM is shown. Notifications are unchanged.
- **Graph view ("Bảng | Sơ đồ", 2026-11-25):** the CRM tab can show the same in-memory rows as a graph drawn with the Memory tab's engine (`react-force-graph-2d`) and canvas style; the packaged `MyGraphView` is not reused because it is an aibase editor (its node click opens its own edit panel, its toolbar adds, links, deletes and exports JSON/PNG) with no hook for a customer card. Customers (colored by stage, labelled by name or "Khách ·<last 3 digits>", never a phone) link to their stage, approved products, occasion and owner; once rows carry S3 identity and the customer agreed (consent `granted`, checked on the desktop as a second guard), also to persona P1–P4, the source ad title and shared-link domains; low-confidence fields are hidden and no label keeps a run of 9 or more digits. Only the stage filter applies. Clicking a customer opens a read-only card (phone with "Sao chép", stage, owner, next step, products, occasion, one "Dịp mua" where the staff value wins over an AI suggestion, identity with a consent chip and AI/"Đã duyệt" badges, the profile layer only after consent, family only with a customer quote); "Mở hồ sơ" returns to the table with that row's editor open. No extra IPC call, and nothing is persisted. The graph lives in `CustomerCrmGraph.tsx` (lazy-loaded), `CustomerCrmCard.tsx` and the pure `customer-crm-graph.ts`.
