# Change request — Loop 17 verified Playwright dependency

Status: `REQUESTED_AWAITING_INSTALL_AUTHORITY`

Gate: `PO-PRODUCT-OPERATIONAL-RUNTIME`

Requested package: `playwright@1.59.1`

Offline security review:
`docs/handoffs/personal-office/gate-loop-17-playwright-security-review.md`

## Exact paths

- `apps/desktop/package.json`
- `pnpm-lock.yaml`

No source, main composition or browser artifact path is included in this
request.

## Intended operation

1. Grant one single-owner package/lockfile lease.
2. Add exact `playwright: "1.59.1"` to desktop dependencies.
3. Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, then materialize and update the
   lockfile offline from the verified pnpm store with lifecycle scripts
   disabled.
4. Verify the resulting lock resolution matches the recorded Playwright and
   Playwright Core integrity values exactly.
5. Confirm that only Playwright Core `1.59.1` plus the platform-applicable
   optional dependency closure was introduced. Do not add `@playwright/test`.
6. Run an approved vulnerability/advisory check, desktop TypeScript, full
   tests, lint and production build.
7. Revoke the lease before opening a separate production-driver composition
   request.

## Prohibitions

- No network or registry request.
- No browser download or launch.
- No postinstall/browser-install script.
- No fallback from offline mode to a registry request.
- No import from another repository's `node_modules`.
- No main/preload/renderer/runtime source change.
- No push, publish, deploy, secret retrieval or quarantine write.

## Authorization still required

The current programme restriction prohibits dependency installation. This
change request records the exact reproducible operation but does not grant or
execute it.

The offline payload review verified 133/133 Playwright files and 465/465
Playwright Core files against their pnpm store SHA-512 and size metadata, with
zero failures or extra payload files. Both packages declare no lifecycle
scripts and require no build. Vulnerability-advisory freshness remains a
post-authority gate because no advisory network access was permitted.
