# Gate — Loop 17 Playwright offline package security review

Status: `OFFLINE_PACKAGE_PAYLOAD_VERIFIED_AWAITING_INSTALL_AUTHORITY`

Decision authority: W0 Control Tower / Codex

Candidate: `playwright@1.59.1`

## Result

The exact offline package payload is reproducible and internally consistent
enough to enter a future single-owner package lease. This review does not grant
that lease and does not authorize installation.

The production dependency is `playwright@1.59.1`. `@playwright/test` is not
required by the desktop runtime and must not be added.

## Verified dependency closure

`playwright@1.59.1` declares:

- `playwright-core: 1.59.1`;
- optional `fsevents: 2.3.2`, which is not selected on Windows;
- Node engine `>=18`;
- Apache-2.0 license;
- no package lifecycle scripts.

`playwright-core@1.59.1` declares:

- no runtime dependencies;
- Node engine `>=18`;
- Apache-2.0 license;
- no package lifecycle scripts.

The project requires Node `>=20`; the inspected local runtime is Node
`24.13.0`, so the package engine requirement is narrower than the project
requirement.

## Payload integrity

The materialized packages under the read-only `open-design` package store view
were checked file-by-file against the pnpm v10 content-addressed store indexes.

| Package | Indexed files | Bytes | SHA-512/size failures | Extra payload files | Build/side effects |
| --- | ---: | ---: | ---: | ---: | --- |
| `playwright@1.59.1` | 133 | 3,327,038 | 0 | 0 | none |
| `playwright-core@1.59.1` | 465 | 10,466,611 | 0 | 0 | none |

“Extra payload files” excludes three pnpm-generated
`node_modules/.bin/playwright-core` command shims in the materialized
Playwright view. Those shims are dependency-link infrastructure, not package
payload entries, and are not proposed as provenance inputs.

Pnpm store index SHA-256:

- Playwright:
  `14E09ED9FC11A1D1A84991E25ED1E0891CDFF8530146C85DA33B774871C20F76`
- Playwright Core:
  `7D0356DA48B9238ACA8B75E503FFDC7B8D949D08CD3FB5034934EB09CEBBDE91`

The source lockfile remains:

`808131EDE25CE8FD585A25D36E76E068F46D839C59101EFEC91A39A853D991DC`

The package-integrity values remain:

- Playwright:
  `sha512-C8oWjPR3F81yljW9o5OxcWzfh6avkVwDD2VYdwIGqTkl+OGFISgypqzfu7dOe4QNLL2aqcWBmI3PMtLIK233lw==`
- Playwright Core:
  `sha512-HBV/RJg81z5BiiZ9yPzIiClYV/QMsDCKUyogwH9p3MCP6IYjUFu/MActgYAvK0oWyV9NlwM3GLBjADyWgydVyg==`

## Browser provenance

Playwright Core `browsers.json` hash:

`469F17A82348978F79738981BC8AF9B4E8516AAC5A020018911FFF39B755FE60`

It maps Chromium revision `1217` to Chrome for Testing
`147.0.7727.15`. The existing complete Windows executable is:

`C:\Users\NgNghia213\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`

Executable SHA-256:

`392187401C8583B0312798976FB8D50EDB93F143195F3DCA7CBF64B9BB314697`

The empty `INSTALLATION_COMPLETE` marker has SHA-256:

`E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`

The executable must still be re-hashed immediately before each production
driver open. Presence of this machine-local browser is not installation
authority and is not permission to launch it.

## Future materialization constraints

After explicit user authority and a W0 single-owner package lease:

1. set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`;
2. use pnpm offline mode with lifecycle scripts disabled;
3. add exact `playwright: "1.59.1"` to desktop production dependencies;
4. require the resulting lock entries to match the two integrity values above;
5. verify no package other than the expected closure was introduced;
6. do not import or junction another repository's `node_modules`;
7. revoke the package lease before any production source-registration lease.

## Residual security gate

No registry/advisory network query was performed because network operations are
not authorized. Therefore this is not a claim that current vulnerability
databases contain zero advisories for Playwright, Playwright Core or Chromium.

After materialization, the dependency gate must additionally run an approved
vulnerability/advisory check, full desktop tests, both TypeScript profiles,
lint, production build, package/lockfile diff audit and secret scan before the
package lease can be revoked.

No package, lockfile, dependency link, browser, network, secret, source,
database, renderer, preload or quarantine byte was changed during this review.
