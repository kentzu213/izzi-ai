# Gate — Loop 17 Playwright dependency provenance

Status: `OFFLINE_PROVENANCE_VERIFIED_AWAITING_INSTALL_AUTHORITY`

Decision authority: W0 Control Tower / Codex

## Initial evidence

- `apps/desktop/package.json` declares no `playwright`, `playwright-core` or
  `@playwright/test` dependency.
- `pnpm-lock.yaml` contains no resolved Playwright package or integrity record.
  Its only Playwright text is the optional
  `@vitest/browser-playwright` peer metadata declared by Vitest.
- The canonical root and desktop `node_modules` trees contain no Playwright
  package link.
- Loop 17's managed driver deliberately consumes a structural
  `ManagedPlaywrightPort`; it does not hide or vendor an undeclared production
  dependency.

## Offline provenance discovered

A machine-wide search subsequently found a reproducible Playwright `1.59.1`
chain:

- `F:\Ai Tools\open-design\pnpm-lock.yaml` resolves:
  - `playwright@1.59.1` integrity
    `sha512-C8oWjPR3F81yljW9o5OxcWzfh6avkVwDD2VYdwIGqTkl+OGFISgypqzfu7dOe4QNLL2aqcWBmI3PMtLIK233lw==`
  - `playwright-core@1.59.1` integrity
    `sha512-HBV/RJg81z5BiiZ9yPzIiClYV/QMsDCKUyogwH9p3MCP6IYjUFu/MActgYAvK0oWyV9NlwM3GLBjADyWgydVyg==`
  - `@playwright/test@1.59.1` integrity
    `sha512-PG6q63nQg5c9rIi4/Z5lR5IVF7yU5MqmKaPOe0HSc0O2cX1fPi96sUQu5j7eo4gKCkB2AnNGoWt7y4/Xx3Kcqg==`
- The pnpm content-addressed store contains indexed `playwright`,
  `playwright-core` and `@playwright/test` packages at `1.59.1`.
- The materialized package declares Apache-2.0 and exact
  `playwright-core: 1.59.1`.
- Playwright `1.59.1` `browsers.json` maps Chromium to revision `1217`.
- `ms-playwright/chromium-1217` is marked complete. Its `chrome.exe` SHA-256 is
  `392187401C8583B0312798976FB8D50EDB93F143195F3DCA7CBF64B9BB314697`.

Supporting SHA-256:

- `open-design/pnpm-lock.yaml`:
  `808131EDE25CE8FD585A25D36E76E068F46D839C59101EFEC91A39A853D991DC`
- Playwright `package.json`:
  `F5C873AF32DA3A56849A77A73EB4E6ACF9629D58564BA420077FEEA88800225C`
- Playwright Core `browsers.json`:
  `469F17A82348978F79738981BC8AF9B4E8516AAC5A020018911FFF39B755FE60`

## Revised ruling

Offline provenance is sufficient to propose exact Playwright `1.59.1`.
However, no package/lockfile lease is granted and no production driver is
registered while dependency installation remains unauthorized. The canonical
worktree must not borrow a junction or runtime import from `open-design`.

The implementation gate may reopen when dependency installation/package writes
are authorized. The exact request is recorded at
`change-request-loop-17-playwright-dependency.md`.

After authorization, W0 must grant a single-owner package/lockfile lease and
perform an offline, script-disabled dependency materialization from the verified
store. A separate exact-path lease is still required for production-driver
composition. Browser launch, network access and real install-to-artifact E2E
remain separately authorized external effects.

