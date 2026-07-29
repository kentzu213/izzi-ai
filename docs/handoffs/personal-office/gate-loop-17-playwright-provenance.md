# Gate — Loop 17 Playwright dependency provenance

Status: `BLOCKED_NO_OFFLINE_PROVENANCE`

Decision authority: W0 Control Tower / Codex

## Evidence

- `apps/desktop/package.json` declares no `playwright`, `playwright-core` or
  `@playwright/test` dependency.
- `pnpm-lock.yaml` contains no resolved Playwright package or integrity record.
  Its only Playwright text is the optional
  `@vitest/browser-playwright` peer metadata declared by Vitest.
- The canonical root and desktop `node_modules` trees contain no Playwright
  package, and the canonical `.pnpm` store contains no Playwright package
  directory.
- Loop 17's managed driver deliberately consumes a structural
  `ManagedPlaywrightPort`; it does not hide or vendor an undeclared production
  dependency.

## Ruling

No package/lockfile lease is granted and no production driver is registered.
Inventing a lockfile entry, relying on an undeclared transitive package, or
loading an unverified executable would violate reproducibility and the
operational-runtime security gate.

The gate may reopen only when one of these inputs is authorized:

1. Networked package resolution plus install, with registry provenance and
   lockfile integrity review; or
2. A verified offline package/tarball and browser artifact with version,
   SHA-256, source and licensing records sufficient to reproduce the install.

After provenance exists, W0 must grant a single-owner package/lockfile lease,
then a separate exact-path production-driver composition lease. Browser launch,
network access and real install-to-artifact E2E remain separately authorized
external effects.

