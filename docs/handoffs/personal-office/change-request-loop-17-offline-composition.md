# CHANGE_REQUEST — Loop 17 offline production composition

Status: `REQUESTED`

Requester: Loop 17 / Codex control tower
Decision authority: W0

## Purpose

The reviewed authoritative receipt and operational evidence stores are present
on canonical, but the production composition root still constructs
`MarketplaceOperationService` without its completed-receipt sink. This request
allows one bounded, fail-closed composition step without registering a browser
driver or performing any external effect.

## Exact requested paths

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/runtime/operational-runtime-composition.ts`
- `apps/desktop/src/main/runtime/operational-runtime-composition.test.ts`

## Intended patch

1. Add a small composition module that receives a trusted root directory and a
   `RuntimeEncryptionProvider`.
2. Construct one shared `EncryptedAuthoritativeOperationReceiptStore`, one
   `EncryptedOperationalEvidenceStore` and one
   `AuthoritativeOperationalEvidencePort`.
3. Inject Electron `safeStorage` through
   `SafeStorageRuntimeEncryptionProvider` in `main/index.ts`.
4. Supply only the authoritative Marketplace completed-receipt sink to the
   existing fail-closed Marketplace service.
5. Expose the grant evidence sink and runtime evidence port only as internal
   composition outputs for later separately leased registration.

## Required tests

- The composition joins Marketplace and grant receipts into exact runtime
  evidence using encrypted stores.
- Unavailable OS-backed encryption prevents receipt persistence and creates no
  authority directory.
- Main and renderer TypeScript, focused runtime tests, full desktop tests,
  production build and lint ceiling pass.
- Exact ownership, prohibited-path, secret and quarantine-isolation checks
  pass.

## Explicit prohibitions

- No package manifest, lockfile or dependency installation.
- No Playwright/Puppeteer import, browser executable lookup or browser launch.
- No network request, connector call, Marketplace install or external effect.
- No IntegrationGrant connector/repository registration.
- No preload, renderer, DB/schema, auth, secret retrieval or quarantine write.
- No push, main merge, deployment, publish or release action.
