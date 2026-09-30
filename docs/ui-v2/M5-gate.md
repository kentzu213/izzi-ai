# M5 — Knowlead Market (gate note)

Status: **BLOCKED at the contract gate.** No code was written for M5. There are no mocks, no
placeholder data, and the Marketplace page was not repurposed.

## What exists (read-only evidence)

| Area | Finding |
|---|---|
| Main IPC | No `knowlead` handler anywhere in `apps/desktop/src/main`. |
| Preload bridge | `apps/desktop/src/main/preload.ts` exposes only `extensions:marketplace` (line 176) and `extensions:runtime:installFromMarketplace` (194–195). Both belong to the extension catalog. |
| Shared types | `apps/desktop/src/shared` has no Knowlead or marketplace listing type. |
| Backend | The only market-like API is the extension catalog: `MARKETPLACE_API_URL` / `OPENCLAW_MARKETPLACE_URL`, which defaults to `http://localhost:8788` (`extensions/manager.ts:7`, `marketplace-download.ts:20`, `update-checker.ts:15`). M0 recorded it as "demo data; API :8788 offline". |
| Renderer | V2 `navModel.ts:88` has `knowlead-market` as a disabled placeholder with `placeholderHint`. It is deliberately **not** mapped to `marketplace`. There is also a `GlobalRail.tsx` icon, the legacy `Sidebar.tsx` label "Knowleadmarket" for the extension Marketplace page, and a CSS comment in `index.css:8339`. |
| Spec | The design handoff `spec/05` only names `knowlead-market` as an adapter key. The repo has no data or API contract. |

## Why this is a gate, not a gap to fill

Building M5 now would mean either:
- relabelling the extension Marketplace as Knowlead Market, which is forbidden; or
- inventing listings, prices, ownership or purchase flows, which is also forbidden.

The legacy Sidebar label "Knowleadmarket" → Marketplace is a naming overlap only. It is not
evidence that the two are the same product.

## Decisions required from the project owner

1. **Product identity.** Is Knowlead Market a separate product, or is it the extension
   Marketplace renamed? If it is separate, what happens to the legacy "Knowleadmarket" Sidebar
   label?
2. **API.** Base URL and environment variable, auth model (izzi session token? API key?), and
   whether the calls go through main IPC (required for the current security model) or elsewhere.
3. **Data schema.** Listing (id, title, author, type of knowledge asset, preview), pricing, and
   ownership/entitlement. Pagination and search parameters.
4. **Transactions.** Purchase or unlock semantics: credits vs money, refunds, and which approval
   or role gate applies. Is there any external action, and does it respect
   `externalActionsAllowed`?
5. **Delivery.** Where a purchased asset lands (Knowledge view? Files?) and in what format.
6. **Offline/empty behaviour.** The copy and state to show when the API is unreachable.

## Once unblocked

- Add shared types and main IPC with focused contract tests first. Then add the renderer
  surface behind `uiShellV2`, keeping the flag OFF by default.
- Enable the `knowlead-market` nav item only when the IPC exists. Update
  `navModel.test.ts` accordingly.

## Consequence for the loop

Re-checked in the M4→M8 loop (2026-09-28): a search for `knowlead` across `apps/desktop/src`
finds only renderer labels, the disabled nav placeholder and tests. There is still no main
handler, no preload channel and no shared type. **M5 stays BLOCKED.**

The latest owner instruction allows independent work while M5 is blocked, so M6 (Affiliate),
M7 (MyGraph) and M8 (CSS cleanup) proceed. None of them touch Marketplace naming, listings,
prices, purchases or ownership. The six owner questions above remain open.

## Side finding: inconsistent Marketplace env var

The extension catalog reads two different variables for the same service:
- `extensions/manager.ts:7` reads `OPENCLAW_MARKETPLACE_URL`.
- `extensions/marketplace-download.ts:20` and `extensions/update-checker.ts:15` read
  `MARKETPLACE_API_URL`.

Setting only one of them points listing and download/update at different hosts. This is logged,
not fixed: it is extension-catalog code, outside M5 scope, and the right name is an owner call.

**Update (ledger #11, fixed statically, UNVERIFIED — Codex has not run the tests):** all three
files now call `resolveMarketplaceUrl()` in `extensions/marketplace-url.ts`. Precedence:
`OPENCLAW_MARKETPLACE_URL` → `MARKETPLACE_API_URL` (legacy) → `http://localhost:8788`. Blank or
whitespace-only values count as unset, and the chosen value is trimmed.
- Canonical name picked to match the other `OPENCLAW_*` endpoints in `public-config.ts`. If the owner
  prefers `MARKETPLACE_API_URL`, swap the two lines in the resolver; no caller changes.
- Behaviour change: when both variables are set to different hosts, download and update-check now
  follow `OPENCLAW_MARKETPLACE_URL` (they used to follow `MARKETPLACE_API_URL`).
- **Renderer follow-up (static, UNVERIFIED — Bash fails with `ENAMETOOLONG`, no test was run):**
  `renderer/lib/api-client.ts` no longer hard-codes `http://localhost:8788`. The default and the
  trailing-slash rule now live in the Node-free `src/shared/marketplace-url.ts`
  (`DEFAULT_MARKETPLACE_URL`, `normalizeMarketplaceUrl`). Both the main resolver and the renderer
  import it. Main re-exports `DEFAULT_MARKETPLACE_URL`, so existing imports keep working. There is no
  IPC or preload change. Test: `renderer/lib/api-client.test.ts` covers the list, detail and health
  URLs (one slash before `/api`), trailing-slash / blank / slash-only normalisation, and a source
  check that is not runtime evidence.
- **Still open (owner decision):** the renderer still ignores `OPENCLAW_MARKETPLACE_URL` /
  `MARKETPLACE_API_URL`, because it cannot read main's env. Honouring them needs a new IPC or
  preload channel. Per its header comment, `api-client.ts` is the browser dev-mode client.
- Test: `extensions/marketplace-url.test.ts`.
- **typescript-reviewer (static): HIGH, fixed, UNVERIFIED.** A trailing slash in either variable made
  every caller build `…//api/...`. The resolver now drops trailing slashes; a slash-only value counts
  as unset. Regression test: "drops trailing slashes so callers never build `//api/...`".
- **Second security review (static): no regression.** Like the old inline reads, `resolveMarketplaceUrl`
  does not check the scheme or host, so an env var can point marketplace, download and update-check at
  any host, including plain `http:`. Pre-existing MEDIUM, not fixed here; follow-up suggested
  (`https:` only outside dev, plus a host allow-list).
- **Third security review, 2026-09-28 (static, UNVERIFIED): MEDIUM, pre-existing, not fixed.** The
  private `fetch` in `renderer/lib/api-client.ts` turns the backend body field `error` into
  `Error.message`. `Marketplace.tsx` shows it verbatim (`API Error: ${err.message}` and the install
  toast `❌ Lỗi: ${err.message}`). React escapes the text, so this is not XSS, but it is the same
  class of leak as ledger #25: backend-chosen text reaches the UI. It is outside this #11 slice
  (URL only), so it was not changed. Suggested fix: map `res.status` to fixed Vietnamese copy, as
  `affiliate-client.ts` `mutationErrorMessage` does. This changes the Marketplace error copy, so it
  is left for a separate slice with its own test.
- **Follow-up slice, 2026-09-28 (static, UNVERIFIED: no test was run because Bash fails with
  `ENAMETOOLONG`; GitNexus impact was not run).**
  - **Scheme (second review):** `normalizeMarketplaceUrl` in `shared/marketplace-url.ts` now keeps only
    absolute `http:` / `https:` URLs. `file:`, `javascript:`, `ftp:` and unparsable values become `''`,
    so the existing resolver falls through to the next variable and then to the default. `http://localhost`
    stays valid for dev. **The host allow-list and "`https:` only outside dev" are still an owner
    decision and were not added.** Tests: the new scheme case in `main/extensions/marketplace-url.test.ts`
    and in `renderer/lib/api-client.test.ts`.
  - **Error text (third review): fixed.** The api-client `fetch` no longer reads the error body. It throws
    `marketplaceErrorMessage(res.status)`: 401/403 → session expired, 429 → too fast, 400/409/422 →
    rejected, 404 → not found, anything else → `Yêu cầu thất bại`. `Marketplace.tsx`,
    `DeveloperDashboard.tsx`, `ExtensionDetail.tsx` and `DeveloperUpload.tsx` keep their display code and
    now receive only this fixed text. The copy changes for failed Marketplace calls in browser dev mode,
    and for the `IZZI_API` calls that share the same private `fetch`. Tests: `it.each` over
    401/403/429/400/409/422/404/500/502 (the thrown message never contains `RAW-`).
  - **Hard-coded endpoint:** `pages/DeveloperUpload.tsx` posted to a literal `http://localhost:8788` and
    showed `data.error?.message`. It now uses the exported `MARKETPLACE_API` and
    `marketplaceErrorMessage`. Test: a source check (not runtime evidence).
  - **DeveloperUpload auth and timer: fixed statically, UNVERIFIED.** The upload now sends
    `headers: apiClient.authHeaders()`, which is the same bearer token the private `fetch` uses. It has no
    `Content-Type`, so the browser still sets the multipart boundary. `progressTimer` is hoisted, and
    `clearInterval` also runs in a `finally`. The timer therefore stops when `fetch` or `res.json()`
    rejects. Tests: `apiClient.authHeaders` unit tests plus a source check in
    `renderer/lib/api-client.test.ts` (the source check is not runtime evidence). **Owner note:** nothing
    in the renderer calls `apiClient.setAccessToken`, so at runtime the header is empty until the owner
    decides how the renderer gets the token. No new IPC was added.
  - **`IZZI_API` (owner decision, code not changed):** the official base exists, but only in main:
    `OPENCLAW_API_URL` in `main/config/public-config.ts`, default `https://api.izziapi.com`, which reads
    `fs` and `process.env`. The renderer cannot import it without a new IPC or a new shared module. The
    four methods that use `IZZI_API` (`getProfile`, `getApiKeys`, `getUsage`, `getBilling`) have no
    renderer callers. Main already serves these endpoints through `IZZI_API_BASE`. The owner has to
    choose between a shared default like `shared/marketplace-url` and removing the four unused methods.
    Only the comment was corrected.
  - **Needs Codex:** vitest on both test files, renderer and main `tsc --noEmit`, lint, and a browser
    dev-mode check that a failed Marketplace call shows the fixed copy.
