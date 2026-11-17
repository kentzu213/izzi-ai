# Care ← Facebook Page connect — Phase A implementation plan

> For agentic workers: implement task-by-task, test first (RED → GREEN), no commits/pushes/deploys,
> no real Meta calls. Parent plan (approved 2026-11-17, defaults incl. S1): `docs/CARE-FACEBOOK-PAGE-CONNECT-PLAN.md`.

**Goal:** an owner/manager connects their own Facebook Page to izzi Customer Care through Facebook Login,
picks the Page, the backend proves the grant (MODERATE task + `debug_token`) and stores a sealed Page
token; Care shows the verified Page but stays in shadow mode (no inbound, no outbound).

**Architecture:** new backend route family `/api/marketing/care/facebook/*` reusing the existing Meta app
config (`MARKETING_FACEBOOK_*`), OAuth state table + GET relay, `mkt1` token vault and bounded fetch.
Pure rules in a contract module, I/O behind injected interfaces, Supabase store + one atomic RPC.
Desktop gets a Care Facebook client, service methods, IPC, deep-link routing and a picker UI.

**Repos / branches:**
- Backend: `F:\Ai Tools\Codex\Temp\izzi-backend-care-fb-20261117`, branch `feat/care-facebook-page-connect` from prod `d8b5bc4` (`origin/hotfix/gpt61-sol-tools`). Tests: `npx vitest run <files>`, `npx tsc --noEmit`.
- Desktop: this worktree, `apps/desktop`. Tests: `npx vitest run <files>` from `apps/desktop`; typecheck `npx tsc -p tsconfig.main.json --noEmit` and the renderer tsconfig.

## Global constraints
- Care scopes (S1): `pages_show_list`, `pages_manage_metadata`, `pages_messaging`.
- Graph API version: `v26.0` (v21.0 sunsets 2027-01-21).
- Roles: connect / callback / select / disconnect = `owner` | `manager` (active member of `marketing_workspace_members`); status = any active member.
- Phase A never subscribes webhooks, never reads or sends messages. Care `mode` stays `'shadow'`, `outboundEnabled` stays `false`.
- Tokens, codes, app secret never in responses, logs, Error messages or renderer; logs carry bounded reason enums only.
- Fail closed everywhere: missing config / vault key / table / provider error ⇒ not connected.
- Vietnamese UI strings with full diacritics.

## API contract (backend ↔ desktop)

Base `/api/marketing/care/facebook`. `Authorization: Bearer <Supabase JWT>`. Responses carry
`Cache-Control: private, no-store`. Error envelope: `{ success: false, error: <fixed English string>, reason?: <enum> }`.

```ts
type CareFacebookConnection = {
  pageId: string;               // digits, 5-30
  pageName: string | null;
  status: 'active' | 'needs_reauth';
  grantedScopes: string[];
  missingScopes: string[];      // CARE_FACEBOOK_SCOPES not granted for this Page
  verifiedAt: string;           // ISO
  tokenExpiresAt: string | null;
};
type CareFacebookPageChoice = {
  pageId: string; name: string | null; eligible: boolean;
  reason: 'eligible' | 'missing_moderate_task' | 'missing_page_token';
};
```

| Route | Body / query | 2xx | Errors (status: reason) |
|---|---|---|---|
| `POST /connect` | `{ workspaceId }` | 201 `{ success, workspaceId, state, expiresAt, authorizeUrl }` | 400 `invalid_request` · 401 · 403 `forbidden` · 503 `not_configured` \| `redirect_relay_incompatible` · 500 |
| `POST /callback` | `{ workspaceId, state, code }` | 200 `{ success, workspaceId, choiceId, expiresAt, grantedScopes, missingScopes, pages: CareFacebookPageChoice[] }` | 400 `invalid_request` \| `invalid_code` \| `not_found` \| `replayed` \| `expired` \| `tenant_mismatch` \| `platform_mismatch` \| `actor_mismatch` · 403 · 422 `no_pages` · 502 `provider_rejected` \| `provider_unavailable` \| `provider_timeout` \| `invalid_response` · 503 `not_configured` \| `not_persisted` · 500 |
| `POST /select` | `{ workspaceId, choiceId, pageId }` | 200 `{ success, workspaceId, connection }` | 400 `invalid_request` \| `choice_not_found` \| `choice_expired` \| `choice_consumed` \| `page_not_eligible` · 403 · 409 `page_bound_elsewhere` · 502 provider reasons \| `token_invalid` \| `token_app_mismatch` \| `token_page_mismatch` · 503 `not_configured` \| `not_persisted` · 500 |
| `GET /status` | `?workspaceId=` | 200 `{ success, workspaceId, requiredScopes, connection: CareFacebookConnection \| null }` | 400 · 401 · 403 · 500 |
| `DELETE /` | `?workspaceId=` | 200 `{ success, workspaceId, connection: null }` | 400 · 401 · 403 · 500 |

`403` for non-member, suspended member and insufficient role all use the single message `"Workspace not accessible"`.
A route that does not exist yet (backend not deployed) answers 404 — desktop treats 404 as `unsupported`.

**Deep link:** Meta → `GET /api/marketing/oauth/callback?platform=facebook&state&code` (existing relay)
→ `openclaw://marketing/oauth/callback?platform=facebook&state=…&code=…` (or `&error=…`).
Desktop routes the deep link to Care when `state` is in the Care pending map, otherwise to the existing
Native Marketing handler.

## Backend tasks (izzi-backend)

### B1 — Migration `migrations/20261117_customer_care_facebook_pages.sql`
- `customer_care_oauth_states` (own table; no existing table is altered — changed after review so the Marketing callback can never see a Care state and deploy order cannot break Marketing).
- `customer_care_facebook_page_choices` (see parent plan §5): `pages jsonb` holds `[{pageId,name,tasks,eligible,reason,sealedPageToken|null}]` ≤ 25, `expires_at <= created_at + 15 min`, RLS on, no grants to anon/authenticated.
- `customer_care_page_bindings` (parent plan §5) + partial unique indexes on `page_id` and on `workspace_id` where `status <> 'disconnected'`, `updated_at` trigger via `public.marketing_set_updated_at()`, RLS on, revoke anon/authenticated.
- RPC `customer_care_bind_facebook_page(p_workspace_id uuid, p_page_id text, p_page_name text, p_page_access_token text, p_granted_scopes text[], p_token_expires_at timestamptz, p_bound_by uuid, p_verified_at timestamptz) returns text` — `security definer`, `set search_path = public, pg_temp`; advisory xact locks (workspace then page); returns `'page_bound_elsewhere'` if a live binding for the page belongs to another workspace; retires the workspace's other live binding (status `disconnected`, token null); updates the same-page live row in place or inserts; `exception when unique_violation then return 'page_bound_elsewhere'`; execute granted to `service_role` only.
- Standalone post-cutover migration (like master's 20260830/20260904 at first): NOT added to the 24-file cutover bundle lists. Real-Postgres test: `src/tests/customer-care-facebook.postgres.test.ts` via `scripts/test-customer-care-facebook-db.mjs`.
- Static test `src/tests/customer-care-facebook-migration.test.ts` (pattern of `native-marketing-publish-claims-migration.test.ts`): columns/checks/indexes/RLS/revokes/RPC grants present; listed last in all three orders.

### B2 — Pure contract `src/services/customerCareFacebookContract.ts` (+ test)
Exports: `CARE_FACEBOOK_SCOPES`, `CARE_CHOICE_TTL_MS = 15 min`, `CARE_REVERIFY_INTERVAL_MS = 6 h`, `MAX_CARE_PAGES = 25`,
`canManageCarePage(role)`, `isCareMemberRole(role)`, `isUuid`, `isFacebookPageId`, `isFacebookRelayRedirect(uri)`
(query `platform=facebook`), `buildCareAuthorizeUrl(config, state)` (Care scopes comma-joined, `auth_type=rerequest`),
`computeAppSecretProof(token, secret)`, `normalizeManagedPages(payload)` (eligible ⇔ tasks include `MODERATE` and token present),
`normalizeGrantedPermissions(payload)` (status `granted` only), `missingCareScopes(granted)`,
`evaluatePageTokenDebug(payload, { appId, pageId })` → `{ ok: true, scopes, expiresAt } | { ok: false, reason }`
(is_valid, app_id, type `PAGE`, profile_id, granular target_ids narrowing, expires_at 0 ⇒ null),
`toPublicCareConnection(row)`, `needsReverify(verifiedAt, now)`.

### B3 — Graph I/O `src/services/customerCareFacebookGraph.ts` (+ test with fake fetch)
`exchangeCodeForUserToken`, `exchangeForLongLivedUserToken` (`grant_type=fb_exchange_token`, POST form),
`listManagedPages` (`/me/accounts?fields=id,name,access_token,tasks&limit=25` + `appsecret_proof`),
`listGrantedPermissions` (`/me/permissions` + proof), `debugPageToken` (`/debug_token?input_token=…`, bearer app token `id|secret`).
Graph base derived from `config.tokenUrl` (`new URL('../', tokenUrl)`). Reuse `requestProviderJson`/`ProviderFailure`
exported from `nativeMarketingProviders.ts` (export only; no behaviour change). Bump Facebook defaults to `v26.0`.

### B4 — Service `src/services/customerCareFacebookService.ts` (+ test with in-memory store/graph/vault/clock)
`connect`, `callback`, `select`, `status`, `disconnect` per contract above; store interface
`CareFacebookStore` (member role, Care OAuth state insert/find/claim, choice purge/insert/find/consume
(consume clears `pages` to `[]`), `bindPage` RPC, `findLiveBinding`, `updateBindingVerification`, `disconnect`, `audit`).
Audit reuses existing actions (`oauth.state.issued|consumed|rejected`, `account.linked|unlinked`) with `detail.purpose = 'care'`.

### B5 — Store + routes
`src/services/customerCareFacebookStore.ts` (Supabase, service role), `src/routes/customerCareFacebook.ts`
`createCustomerCareFacebookRoutes({ resolveUserId, service })` + production export; mount
`app.route("/api/marketing/care/facebook", …)` before `/api/marketing`. Route test with injected fakes.
`routes/marketing.ts` is not changed: Care states live in their own table (isolation test asserts Care code never queries Marketing OAuth/social-account tables).

## Desktop tasks (izzi-ai `apps/desktop`)

### D1 — Client `src/main/customer-care/care-facebook-client.ts` (+ test)
Class `CareFacebookClient(auth: NativeMarketingTokenProvider, options: NativeMarketingClientOptions)` using
`resolveNativeMarketingBaseUrl` like `NativeMarketingClient`; methods `startConnect`, `completeCallback`, `selectPage`,
`getStatus`, `disconnect`. Strict allowlist parsing of every response (exact keys, UUID/page-id patterns, scope
strings `^[a-z_]{3,64}$`, ≤ 25 pages, ISO dates, `authorizeUrl` must be `https://www.facebook.com/` dialog URL).
Result type `{ ok: true, value } | { ok: false, error: CareFacebookClientError }` where errors are
`'unsupported' (404) | 'forbidden' (401/403) | 'unavailable' (network/timeout/5xx except 503 not_configured) | 'not_configured' | 'rejected' (4xx with reason) | 'page_bound_elsewhere' | 'no_pages' | 'invalid-response'`, plus `reason` for `rejected`.

### D2 — Service + types
`shared/customer-care-types.ts`: `CustomerCarePageConnection` = `{ state: 'connected', pageId, pageName, status, missingScopes, verifiedAt } | { state: 'not_connected' } | { state: 'unavailable' } | { state: 'unsupported' }`;
`CustomerCareSnapshot.pageConnection`, `CustomerCareSnapshot.modeReasons: string[]`; choice/result types for IPC.
`customer-care-service.ts`: optional dependency `facebook?: CareFacebookClient-like`; `getSnapshot()` fetches status
(bounded; failure ⇒ `unavailable`; no dependency ⇒ `unsupported`); Page blockers derived from connection
(not connected / needs re-auth / missing scopes / setup Page ID ≠ connected Page ID / unavailable / unsupported);
pure `deriveCareMode()` → `{ mode: 'shadow', outboundEnabled: false, reasons }`; new methods
`beginFacebookConnect()` (owner/manager), `completeFacebookConnect(state, code)`, `selectFacebookPage(input)`,
`disconnectFacebookPage()` — each re-resolves authority (renderer IDs never trusted) and re-checks role.

### D3 — IPC, preload, deep link (`customer-care-ipc.ts`, preload, `index.ts`)
IPC `customerCare:connectFacebookPage | selectFacebookPage | disconnectFacebookPage`; main keeps a Care pending map
`state → { workspaceId, identityId, expiresAt }`, opens `authorizeUrl` with `shell.openExternal`; deep link handler
checks the Care map first; result pushed to renderer as `customerCare:facebookPageChoices`
(`{ ok: true, choiceId, expiresAt, pages, missingScopes } | { ok: false, error }`). Provider `error` param ⇒ `{ ok:false, error:'declined' }`.

### D4 — Renderer `CustomerCareWorkspace.tsx` (+ test)
Replace the free-text Page ID input with: connection status line, "Kết nối Page Facebook" / "Kết nối lại" /
"Ngắt kết nối" buttons (owner/manager only), and a Page picker listing eligible Pages (ineligible ones shown
disabled with the reason). On save, `pageId`/`pageName` come from the connected Page. 404 ⇒ "Máy chủ chưa bật kết nối Page Facebook." with the button disabled.

## Done
All new + existing related tests green; backend `tsc` clean; desktop typecheck clean; independent review
(socrates + security-reviewer) has no open CRITICAL/HIGH; nothing pushed/deployed; release steps listed for the user.
