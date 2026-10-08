# In-app API keys & usage tracking (desktop) — design

Date: 2026-10-07 · Target release: v1.14.0-beta.90 · Scope: desktop app only (no backend change)

## Goal

Let a signed-in user create, see and revoke izziapi.com API keys, and track balance and API
usage, without leaving Izzi AI Desktop. A key created in the app is shown once and is also wired
into the Custom Provider connection automatically, so the user can chat right away.

## Decisions (approved)

- App only; reuse the existing backend endpoints the izziapi.com dashboard already calls.
- New key: show once in a copy dialog **and** save + enable it as the Custom Provider key.
- New Settings tab **"API & Usage"** (id `apiUsage`), placed after `account`.
- Approach A: every HTTP call happens in the main process with the Supabase session token
  (`AuthManager.getAccessToken()`); the token never crosses IPC.

## Backend endpoints used (Bearer = Supabase access token)

| Call | Endpoint | Response used |
|---|---|---|
| list keys | `GET /api/keys` | `keys[]{id,name,key_prefix,status,last_used_at,created_at}` |
| create key | `POST /api/keys {name}` | 201 `{key,id,name,prefix,created_at}` |
| revoke key | `DELETE /api/keys/:id` | 2xx = revoked (soft) |
| stats | `GET /api/usage/stats` | `summary{totalCost,totalRequests,totalInputTokens,totalOutputTokens}`, `daily[{day,cost}]`, `byModel[{model,cost,requests}]` |
| recent log | `GET /api/usage?limit&offset` | `usage[]{id,key_id,model,input_tokens,output_tokens,cost,duration_ms,status_code,created_at}` |
| balance | `GET /api/billing/balance` | `{balance,plan}` |

## Architecture

### Main process — `main/izzi-account/`

`izzi-account-client.ts` — `IzziAccountClient(auth, secrets, settings)`:

- `getOverview()` → `{ok, balance, plan, stats, keys, inUseKeyId}` (parallel GETs; partial data
  allowed; `ok:false` + `reason` when not signed in / unauthorized / forbidden / network).
- `getRecentUsage(offset)` → page of 20 rows, key name resolved from the key list.
- `createKey(name)` → POST; on success store the raw key in `SecretStore`, save Custom Provider
  config `{baseUrl:'https://api.izziapi.com/v1', authType:'x-api-key', selectedModel: current
  model or 'izzi-smart'}`, enable custom provider, return `{success, key, id}` once.
- `revokeKey(id)` → DELETE; if it was the in-use key, delete the stored key and disable the
  custom provider.
- `inUseKeyId`: the key whose `key_prefix` ends with the last 6 chars of the stored key (prefix
  format `izzi-...<last6>`). Only the id crosses IPC, never the stored key.
- A 401 triggers one `auth.refreshAccessToken()` retry, then `reason:'unauthorized'`.
- Fail-closed like `AffiliateClient`: never throws to the renderer, logs only op + status, user
  messages are fixed Vietnamese text chosen by HTTP status, backend error text is never passed on.

`izzi-account-ipc.ts` registers `izziAccount:overview | recentUsage | createKey | revokeKey |
openDashboard | openTopUp`. Registered in `index.ts` next to the affiliate client, with
`new SecretStore(dbManager)` / `new ProviderSettingsStore(dbManager)` (same pattern as
`customProvider:autoConnectLocal`). Preload exposes `window.electronAPI.izziAccount`; types in
`renderer/types/global.d.ts`.

### Renderer — `renderer/pages/settings/ApiUsageSection.tsx`

- Header cards: balance, 7-day cost, requests, tokens. Buttons: Nạp tiền, Mở dashboard, Làm mới.
- 7-day cost bars (CSS only) and a by-model table.
- Keys table: name, prefix, status, last used, badge "Đang dùng trong app", revoke (confirm).
- "+ Tạo key mới" dialog: name defaults to `Izzi AI Desktop – <date>`. After creation a one-time
  dialog shows the key with a copy button; the key is dropped from state when the dialog closes.
- Recent requests: 20 rows (time, model, key, tokens, cost, latency, status) + "Xem thêm".
- States: not signed in → login hint; 403 → verify-email hint; network error → keep the last
  data and show "chưa cập nhật".

### Custom Provider tab

- Button "Tạo key Izzi mới & dùng ngay" calling the same `createKey` flow, then reloading config.
- Replace the stale `ALLOWED_MODELS_UI` list with the main `ALLOWED_MODELS` list and add
  `gpt-6.1-sol` to it.

## Security

- Supabase token and stored provider key never cross IPC; the raw new key crosses once, only in
  the `createKey` result.
- No key, token or backend error text is logged.
- Revoke requires a confirm dialog.

## Testing

- Vitest `izzi-account-client.test.ts` (mocked fetch + fake stores): create stores + enables +
  returns key once; revoke in-use key disables the provider; revoke other key leaves it alone;
  inUseKeyId match; 401 refresh-once; 403 → forbidden; network → `ok:false`; no secret in logs.
- Vitest `izzi-account-ipc.test.ts`: channels registered and delegated.
- Contract test: Settings tab, section, preload bridge, index registration, global types.
- Manual: install beta.90, open Settings → API & Usage over CDP; user creates the key.

## Out of scope (phase 2, backend)

Per-key usage aggregation, `budget_used` accuracy, key expiry, budget limits in the create dialog.
