# M6 — Affiliate V2 migration

## Status

**UNVERIFIED.** The code and tests are written, but none of them have been run. Runtime evidence has to come from Codex (see "Required before verified"). Source-only wiring tests do not count as runtime evidence.

| Check | Result |
|---|---|
| GitNexus `impact(AffiliatePage, upstream)` | LOW. Only direct caller: `App.tsx` |
| vitest (5 files below) | UNVERIFIED (not run) |
| renderer `tsc --noEmit` | UNVERIFIED. Expect only the existing TS2339 baseline |
| lint | UNVERIFIED |
| build | UNVERIFIED |
| Browser, flag ON/OFF at 1440 / 960 / 720 | UNVERIFIED |
| Isolated Electron run (no real profile) | UNVERIFIED |

## Scope

- A V2 presentation of the Affiliate page, gated behind `uiShellV2`. The flag stays **OFF** by default.
- Unchanged: the IPC channels, auth, and the referral / commission / withdrawal semantics.
- `main/affiliate/affiliate-client.ts` gains boundary guards in `withdraw` only. The exported DTO, `WithdrawInput` and `MutationResult` types are unchanged.
  - The IPC payload is read through own-property checks, so a null or malformed payload fails closed with no token read and no backend call.
  - `method` must be `bank_transfer` or `credit_convert`.
  - For bank transfer, `bankInfoError` requires non-blank fields, a 6–20 digit account number, and a bank / holder name of at most 100 characters.
  - The POSTed `bankInfo` is trimmed and is only sent for `bank_transfer`.
- The legacy JSX is unchanged. With the flag OFF, the success-path render output is the same as before. The only deliberate exception is the failure-path fixes in `loadAll` / `submitWithdraw` (see "Fixed in M6"), which apply to both paths.

## Mapping

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/v2/affiliateFormat.ts` | New pure helpers: `MIN_WITHDRAW_VND`, `fmtVnd`, `fmtDate`, `statusLabel` (guarded with `hasOwnProperty`), `methodLabel`. |
| `apps/desktop/src/renderer/components/v2/AffiliateWorkspaceV2.tsx` | New presentational component: header, notice, referral card, 4 stat tiles, withdraw panel, commission list, withdrawal list. It has no IPC and does not use `window` or `navigator`. |
| `apps/desktop/src/renderer/pages/Affiliate.tsx` | Adds `{ v2 = false }`. `if (v2) return <AffiliateWorkspaceV2 …/>` is placed after every hook and before `if (loading)`. The legacy JSX is untouched. |
| `apps/desktop/src/renderer/App.tsx` | Changed to `<AffiliatePage v2={isShellV2} />`. |
| `apps/desktop/src/renderer/styles/v2/shell.css` | New M6 block. Every selector is scoped under `.izzi-v2 .v2-affiliate*`, and only existing `--v2-*` tokens are used. Each text colour is `var(--v2-…) !important` plus `-webkit-text-fill-color: currentColor !important`. At ≤720px the tiles drop to 2 columns and rows wrap. |

## Guards kept

- **IPC stays in the page.** `window.electronAPI?.affiliate`, `getStats` / `getCommissions` / `getWithdrawals`, `convertCredit` and `withdraw` are still called only from `Affiliate.tsx`. V2 receives values and callbacks.
- **Auth fails closed.** Without `stats.referralLink`, the copy button is disabled and the sign-in hint is shown. V2 invents no data.
- **Withdrawal validation.** The page's `submitWithdraw` still checks only the minimum and the available balance before it calls IPC. The main process re-checks the amount and validates the method and the bank fields (see Scope). V2 only forwards `onSubmit`, and it renders no `<form>` or `type="submit"`, so pressing Enter cannot submit.
- **The main process is the authority on the minimum.** `affiliate-client.ts` enforces its own check. The `MIN_WITHDRAW_VND` in V2 is used for display and the input `min` only.
- **Double submit.** The submit button is disabled while `submitting`. This matches legacy.
- **Status labels.** Unknown statuses are rendered raw. Inherited keys such as `toString` and `__proto__` are not resolved to labels.

## Behaviour difference (flag ON only)

- With V2 ON, the loading state renders the V2 busy status (`aria-busy`, `role="status"`) and not the legacy spinner, because the `v2` branch comes before `if (loading)`. With the flag OFF, legacy loading is unchanged.

## Fixed in M6 (pre-existing, legacy and V2 alike)

1. `loadAll` now has `catch` plus `finally { setLoading(false) }`, so a rejected IPC call no longer leaves the page loading forever.
2. `submitWithdraw` now has `try/catch/finally`. `setSubmitting(false)` runs exactly once, in `finally`.
3. The main-process `withdraw` boundary guards (see Scope).
4. `affiliate-client.ts` now has tests.
5. **Ledger #25 (UNVERIFIED):** a failed `withdraw` / `convertCredit` no longer forwards the backend `error` text to the renderer. That text can carry HTML, stack traces or echoed bank data. `mutationErrorMessage(status)` in `affiliate-client.ts` picks a fixed Vietnamese message by HTTP status only: 401/403 → session expired, 429 → too fast, 400/409/422 → rejected (check amount, balance and payout details), anything else → `Yêu cầu thất bại`. The main log line is `POST <path>: request failed (status N)`, never the backend text. The renderer catch blocks already showed fixed text. Validation, the minimum and success detection are unchanged. Tests: three new cases in `affiliate-client.test.ts`.
6. **Ledger #25 full error-path audit (static, UNVERIFIED: no test was run because Bash fails with `ENAMETOOLONG`).**
   - Root cause of the remaining leak: `shortError` logged `err.message`. On a 200 response with an HTML body, the unguarded `res.json()` in `get()` throws a `SyntaxError` that quotes the body. A network error quotes the host. `shortError` now logs `err.name` only. It is used by the catch blocks of all five calls: getStats, listCommissions, listWithdrawals, withdraw and convertCredit.
   - `getAccessToken()` is called outside those `try` blocks, but it cannot throw: `refreshAccessToken` catches every error and returns null.
   - `affiliate:openWeb` (`affiliate-ipc.ts`) had no catch. A rejected `shell.openExternal` went through IPC to a renderer that calls it as `void api?.openWeb()`, which is an unhandled rejection. It now resolves `{ ok: false }`, which matches the preload type, and logs `[AffiliateIpc] openWeb: <ErrorName>`. The renderer still ignores the result, so there is no UI message for this case.
   - Tests, not yet run:
     - `affiliate-client.test.ts`:
       - Every status goes through `it.each` (401/403/429/400/409/422/404/500/502/0).
       - Withdraw never returns the `RAW-BACKEND` text.
       - A 200 response that is not JSON logs no body.
       - A thrown request logs exactly `affiliate.getStats: TypeError`.
       - The fail-closed log contains neither `network down` nor `bad json`.
     - New `affiliate-ipc.test.ts`:
       - Success returns `{ ok: true, url }`.
       - A rejection returns `{ ok: false }`.
       - The log is exactly the error class.
       - A non-Error rejection logs `error`.
   - **typescript-reviewer (static, 2026-09-28): no CRITICAL, HIGH or MEDIUM.** LOW: the
     "log only `err.name`" expression was copied in `affiliate-ipc.ts` and `affiliate-client.ts`.
     **Fixed statically, UNVERIFIED (not run):** `shortError` is now exported from `affiliate-client.ts`,
     and `affiliate-ipc.ts` imports it. The log text and the IPC contract are unchanged. Grep shows no other
     caller of the affiliate `shortError` (the one in `graph-client.ts` is a separate private function).
     GitNexus impact could not run ("auto mode classifier gave no verdict"). Regression tests: the existing
     exact-log cases in `affiliate-ipc.test.ts` (`[AffiliateIpc] openWeb: <ErrorName>` and `error` for a
     non-Error). That file mocks only `electron`, so the real `shortError` is exercised.

## Owner decision pending (not changed)

1. **Single source for `MIN_WITHDRAW_VND`.** It is duplicated in three places: `pages/Affiliate.tsx:12`, `main/affiliate/affiliate-client.ts:58` and `components/v2/affiliateFormat.ts`. All three are 500,000 today. No single source was picked.
2. **Balance check authority.** The available-balance check exists only in the renderer, and the main process does not re-check it. The backend is assumed to be the authority. This needs owner or backend confirmation.
3. **Backend error-code contract (#25).** If the product wants specific messages such as "insufficient balance", the backend must return a stable `code` field (for example `INSUFFICIENT_BALANCE`), and main must map it to fixed text. Until then the UI shows only the status-based messages. Free-text backend errors are never shown.
4. **Duplicated display helpers** (`fmtVnd`, `fmtDate`, the status labels) between the legacy page and `affiliateFormat.ts`. They are left as they are so the legacy path stays byte-identical.

## Reviews

- **security-reviewer** (Affiliate financial IPC): 4 MEDIUM fixed (null or malformed IPC input, the method enum, `submitWithdraw` finally, `loadAll` catch). Of the 2 LOW: the bank format guard is fixed, and the renderer-only balance check is deferred to the owner (above).
- **typescript-reviewer**: no CRITICAL or HIGH. One misleading test comment is fixed. Approve pending real runs.

## Tests added (not yet run)

- `components/v2/affiliateFormat.test.ts`: the minimum, VND formatting with 0 and NaN, dates (empty, invalid, valid), all 6 status labels plus the raw fallback, the inherited-key guard, and method labels.
- `components/v2/AffiliateWorkspaceV2.test.ts`:
  - **Render tests:**
    - loading state only
    - copy disabled with the sign-in hint when there is no link
    - link, code and copied state
    - both empty states
    - bank fields only for bank transfer, plus `aria-pressed`
    - no `<form>` or `type="submit"`, and the input `min` / `step`
    - the 3 submit labels, and the button disabled while submitting
    - notice `alert` vs `status`
    - rows, anonymous email, admin note and raw unknown status
  - **Wiring tests (source only):**
    - the App flag is passed through
    - the page defaults to legacy
    - every hook runs before `if (v2)`, and `if (v2)` comes before `if (loading)`
    - IPC stays in the page
    - the component contains no `window.` / `electronAPI` / `ipcRenderer` / `invoke(` / `navigator.`
    - `loadAll` has `try`, `catch` and `finally { setLoading(false) }`
    - `submitWithdraw` resets `submitting` only in `finally`, and sets it `true` before the `try`
- `main/affiliate/affiliate-client.test.ts` (fetch is stubbed; no network):
  - `bankInfoError`: trimmed input, missing / blank / non-string fields, 6–20 digits, the 100-character cap, and inherited properties
  - `withdraw`: every invalid input returns an error without reading the token or calling fetch; no token; the exact URL, method, headers and trimmed body; no `bankInfo` for `credit_convert`; backend errors pass through; a 502 with bad JSON and a fetch throw both fail closed; the log never contains the token or the account number
  - `convertCredit`: below the minimum makes no call; numeric `creditsAdded` is copied and a string one is ignored
  - reads: the stats merge, `success !== true`, no token or 401 gives empty results, the commission / withdrawal mapping, and the status-only log line on a 500
- `styles/v2/shell.test.ts`, block "v2 Affiliate workspace (M6)": `.izzi-v2` scoping, token-only colours with `!important` and `-webkit-text-fill-color`, and danger tokens on the error notice and the rejected badge.

## Required before verified (Codex)

1. `vitest run` on `affiliateFormat.test.ts`, `AffiliateWorkspaceV2.test.ts`, `styles/v2/shell.test.ts`, `uiShellV2.test.ts` and `main/affiliate/affiliate-client.test.ts`. Main `tsc` must also cover the `affiliate-client.ts` change.
2. Renderer `tsc --noEmit`. The only allowed failure is the existing TS2339 baseline.
3. Lint on the changed files, and a desktop build.
4. Browser check with the flag OFF: the Affiliate page looks the same as before. With the flag ON, check 1440 / 960 / 720 for overflow and contrast, and that the tiles drop to 2 columns at ≤720.
5. Isolated Electron run with a temporary `userData` and **no real profile or credentials**: the page loads, copy works, method switching shows and hides the bank fields, and the submit path reaches the page validation. **Do not** submit a real withdrawal.
