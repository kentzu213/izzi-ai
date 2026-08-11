# CMR-404 Dependency And Security Evidence

Date: 2026-08-11

Scope: local verification of the exact `origin/main` commit
`b8dc36d6961ff9d186fb701e376e463a6aa0fac7`. This record does not claim remote
staging, production deployment, code signing, or clean-machine installation.

## Security Gate

`dependency supply chain - lockfile install and registry audit checked - local gate passed`

No dependency or product source change was required. The current lockfile already pins Electron
`39.8.10`, electron-builder `26.15.3`, and overrides `tar` to `7.5.22`.

## Verification

All commands ran from a clean worktree created from the commit above.

| Gate | Command | Result |
|---|---|---|
| Reproducible install | `pnpm install --frozen-lockfile` | PASS, 729 packages restored from the existing lockfile |
| Full dependency audit | `pnpm audit --audit-level low` | PASS, no known vulnerability reported |
| Production dependency audit | `pnpm audit --prod --audit-level low` | PASS, no known vulnerability reported |
| Workspace build | `pnpm build:all` | PASS, Desktop production build transformed 1,139 modules |
| Workspace lint | `pnpm lint` | PASS |
| Lint contract | `pnpm test:lint-config` | PASS, 4/4 tests |
| Desktop suite | `pnpm --filter @openclaw/desktop test -- --reporter=dot` | PASS, 87/87 files and 1,262/1,262 tests |
| Evidence guard | `pnpm test:socrates` | PASS, 4/4 tests |
| Installed tool versions | `pnpm --filter @openclaw/desktop exec electron --version` and `pnpm --filter @openclaw/desktop exec electron-builder --version` | PASS, Electron `39.8.10` and electron-builder `26.15.3` |

The install and verification commands warned that `NODE_AUTH_TOKEN` was not set. No token value
was read or printed, and the frozen-lockfile install completed. pnpm also kept the
`electron-winstaller@5.4.0` dependency build script blocked by its build-script policy.

## Decision

CMR-404 can close as `done_local` for dependency audit, lint, build, and automated security-test
scope. The prior report of 89 advisories described an older dependency graph and is not evidence
for this commit.

The renderer build still reports a chunk-size warning for the generated JavaScript bundle. Treat
that as a separate performance slice. Code signing, clean-machine install/upgrade/uninstall,
remote staging, and production sign-off remain open gates.
