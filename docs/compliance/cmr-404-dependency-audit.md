# CMR-404 — dependency audit triage

Audit date: **2026-07-27**
Command: `pnpm audit --prod` (read-only; `--prod` scopes to what ships, excluding dev/build-only
tooling). Package manager: pnpm 10.33.0, `pnpm-lock.yaml`, 6 workspace projects.

## Result

| Stage | Total | High | Moderate | Low |
|---|---:|---:|---:|---:|
| Baseline (before this pass) | 74 | 26 | 46 | 2 |
| After raising `axios` / `hono` floors | 47 | 16 | 30 | 1 |
| After `pnpm dedupe` | **20** | **14** | **6** | 0 |

The earlier project note of "1 high + 3 moderate" was stale; a fresh audit found substantially
more. Recording the real number here.

## Fixed

Two direct dependencies carried 51 of the 74 findings between them:

| Package | Was | Now | Advisories cleared |
|---|---|---|---:|
| `axios` (`apps/desktop`) | `^1.7.9` → resolved 1.14.0 | `^1.15.1` → resolved 1.18.1 | 28 |
| `hono` (`apps/marketplace-api`) | `^4.7.0` → resolved 4.12.9 | `^4.12.27` → resolved 4.12.32 | 23 |

Both were semver-compatible floor raises inside the existing caret range — no major upgrade, no
`--force`.

`pnpm dedupe` then removed a stale peer resolution (`@hono/node-server@1.19.12(hono@4.12.9)`)
that kept the vulnerable `hono` in the tree even after the floor was raised. Dedupe only
re-resolves within declared ranges, so it widened nothing.

Notable advisories closed: Hono JWT `NumericDate` validation (`exp`/`nbf`/`iat`) —
GHSA-hm8q-7f3q-5f36 — and GHSA-w62v-xxxg-mg59; axios null-byte injection in
`AxiosURLSearchParams` — GHSA-xhjh-pmcv-23jw. The JWT one is directly relevant to the
tenant-isolation posture the backend relies on.

## Verification after the change

- `tsc -p tsconfig.main.json --noEmit`: exit 0
- Full desktop suite `vitest run`: **824/824 pass (65 files)**
- `vite build`: exit 0, max chunk 375.83 kB
- Lockfile diff limited to the two floors plus the dedupe of the stale peer entry.

## Remaining 20 — triaged, not fixed

All remaining findings are **transitive** through the packaging/imaging toolchain rather than
direct runtime dependencies:

`adm-zip`, `brace-expansion`, `builder-util-runtime`, `fast-uri`, `form-data`, `js-yaml`,
`lodash`, `postcss`, `sharp`, `ws`, `uuid`.

Why they are not fixed in this pass:

- They are pulled by `electron-builder` / `sharp` style chains. Closing them needs either a major
  upgrade of the packaging toolchain or `pnpm.overrides` that pin a subdependency against its
  parent's declared range.
- Both approaches can change how the app is packaged and signed, so they need their own change
  with a real packaging smoke test — not a blind `audit fix --force`, which this project's rules
  prohibit.

Recommended next step (own change, own review): add `pnpm.overrides` for the leaf packages that
have drop-in patched versions (`brace-expansion`, `js-yaml`, `lodash`, `ws`, `form-data`,
`fast-uri`, `uuid`), re-run `pnpm audit --prod`, then run a packaging smoke (`pnpm pack`) before
touching `electron-builder`/`sharp` majors.

## ESLint status — open

`eslint` is **not installed at all** in this repo: no `eslint.config.*`, no `.eslintrc*`, and
`eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` and `typescript-eslint`
are all absent from `node_modules`. The `apps/desktop` `lint` script (`eslint src/`) therefore
cannot run today.

This is a green-field ESLint 9 flat-config setup across 6 workspace projects, not a repair. It is
left as the next CMR-404 task rather than half-applied, because a config that silently lints
nothing is worse than an honestly missing one. Type checking (`tsc --noEmit`) is currently the
enforced static gate and it passes.

## Scope note

`--prod` was used deliberately: it separates what ships to users from dev/build-only tooling, in
line with the project rule to distinguish runtime CVEs from devDependency ones. A full
`pnpm audit` (including dev) will report more; those are build-time and lower priority.
