# CMR-404 — Starizzi v1.13.2 security hotfix (dependency audit)

Prepared on branch `hotfix/starizzi-v1.13.2-security-20260727`, based **only** on the production
release lineage `v1.13.1` = `c35c8ff781a0ac8387402fd7770e975bfaeacf37`.

Toolchain used for every number below: **Node 22.23.1** (matches `desktop-ci.yml` `node-version: 22`),
**pnpm 10.33.0**, `pnpm-lock.yaml` lockfileVersion `9.0`, 6 workspace projects.

Not in scope for this loop: no tag, no release, no push. Terminal state is a reviewed branch.

## Lineage — verified, not assumed

| Check | Result |
|---|---|
| `v1.13.1` is an annotated tag | `git cat-file -t v1.13.1` = `tag`; `v1.13.1^{commit}` = `c35c8ff` |
| Branches containing `c35c8ff` | `release/starizzi-v1.13.0-scheduled-sessions-20260727`, `origin/main` |
| Base contains Scheduled Sessions | `apps/desktop/src/main/scheduler/{schedule-ipc,schedule-planner,schedule-service}.ts`, `renderer/pages/ScheduledSessions.tsx`, `renderer/store/scheduledSessions.ts` present at `c35c8ff` (landed in `ef10653`, tagged `6b70dae` = v1.13.0) |
| Divergence vs `feature/aibase-my-graph-ui-sync` | `git rev-list --left-right --count` = **8 / 13** — the release has **8 commits the feature branch does not**. Merging or deploying that branch would drop live code. It was used as a *reference only* |

Why `ed188f2` ("harden Starizzi release dependencies") was **not** cherry-picked — read, not trusted
by its commit message:

- bumps `electron` `^34.2.0 → ^39.8.1` and `electron-builder` `^25.1.8 → ^26.15.3` (two majors,
  new native ABI);
- rewrites `linux.desktop` into the electron-builder **26** `entry: {}` schema, which 25.1.8 does not use;
- adds three `brace-expansion` overrides — the form independently recorded as breaking
  `minimatch@3` / ESLint (`TypeError: expand is not a function`);
- and it was already **reverted on the release lineage** by `4669e28`, so re-applying it would undo a
  deliberate production decision.

It also does **not** contain the `builder-util-runtime` fix, which is the actual headline advisory here.

## Audit: before → after

`pnpm audit --prod` from the hotfix worktree on Node 22 with the lockfile installed:

| Stage | Total | High | Moderate | Low |
|---|---:|---:|---:|---:|
| Base `c35c8ff` (v1.13.1, as shipped) | **34** | 8 | 25 | 1 |
| This hotfix | **3** | 2 | 1 | 0 |

Raw evidence retained outside the repo as `audit-before.json` / `audit-after.json`
(`pnpm audit --prod --json`).

## Change table — one row per change

| # | Advisory / security property | Package & version | File changed | Test that protects it | Packaging risk |
|---|---|---|---|---|---|
| 1 | **GHSA-p2f4-r6v6-j797** (high, CWE-200): cross-origin redirect forwards `PRIVATE-TOKEN` and mixed-case `Authorization`. Reachable — `electron-builder.json` publishes via `provider: github` and the release workflow carries `GH_TOKEN` | `builder-util-runtime` pinned **exactly** `9.7.0` (override; `electron-updater@6.8.3` pins `9.5.1` exactly, so an override is the only route) | `package.json`, `pnpm-workspace.yaml` | `updater-dependency-contract.test.ts` — asserts the **behaviour** (`HttpExecutor.prepareRedirectUrlOptions` strips both headers cross-origin, keeps `Authorization` same-origin, keeps `accept`), plus the ≥9.7.0 floor, the declared-range guard, and all 20 exports electron-updater imports | Override also reaches electron-builder's own `builder-util`/`app-builder-lib` chain (was `9.2.10`). Proven by the packaging runs below |
| 2 | **GHSA-52cp-r559-cp3m** (high): js-yaml <4.3.0 — chained YAML merge keys force quadratic CPU. This is the parser `AppUpdater` runs on `latest.yml`, i.e. remote content | `js-yaml` override `4.2.0 → 4.3.0` (inside electron-updater's declared `^4.1.0`; no exemption needed) | `package.json`, `pnpm-workspace.yaml` | same file — ≥4.3.0 floor + a realistic `latest.yml` parse whose `sha512` must survive byte-for-byte | none: same major, same declared range |
| 3 | **GHSA-v2hh-gcrm-f6hx** + **GHSA-4c8g-83qw-93j6** (high ×2): fast-uri host confusion (literal backslash authority, failed IDN canonicalisation) | `fast-uri` override `3.1.2 → 3.1.4` | `package.json`, `pnpm-workspace.yaml` | Floor only — see "What is *not* behaviourally asserted" | none: patch bump. Reached via `electron-store > conf > ajv` (JSON-schema validation of the local config file), not a remote-host trust boundary |
| 4 | **GHSA-r5fr-rjxr-66jc** (high, `_.template` code injection) + **GHSA-f23m-r3pf-42rh** (moderate, prototype pollution in `_.unset`/`_.omit`) | `lodash` override `4.18.1` (new) | `package.json`, `pnpm-workspace.yaml` | Archiver smoke: `archiver-utils@5.0.2` declares `^4.17.15`, resolves `4.18.1` (**inside** the range — a floor, not an exemption), and `archiver@7.0.1` produces a valid zip | Only path is `packages/cli > archiver > archiver-utils`; that is the `.ocx` CLI, not desktop runtime. Desktop's own `.ocx` bundling uses system `tar` (`scripts/before-pack.cjs`), so it is untouched |
| 5 | 8 hono advisories (1 high CORS-wildcard reflection, 6 moderate, 1 low JWT `NumericDate`) | `hono` `^4.7.0 → ^4.12.27` (direct dep), resolves 4.12.32 | `apps/marketplace-api/package.json` | `tsc` build of marketplace-api. See reachability note below | none: caret range, same major |
| 6 | **GHSA-92pp-h63x-v22m** (moderate): `serveStatic` middleware bypass via repeated slashes | `@hono/node-server` `^1.13.0 → ^1.19.13` (direct dep), resolves 1.19.17 — **stays on 1.x** | `apps/marketplace-api/package.json` | `tsc` build | none: minor bump, no major |
| 7 | **GHSA-w5hq-g745-h8pq** (moderate): missing buffer bounds check in uuid v3/v5/v6 when `buf` is supplied | `uuid` `^11.1.0 → ^11.1.1` (direct dep) | `apps/marketplace-api/package.json` | `tsc` build | none: patch bump |

Kept exactly as the release shipped them, deliberately: `form-data 4.0.6`, `shell-quote 1.8.4`,
`ws 8.21.0`. `ws` in particular is **absent** from the feature branch's override list; dropping it
here would have re-opened an advisory the release had already closed.

## Deliberately NOT changed

| Not done | Why |
|---|---|
| `electron` stays `^34.2.0` (resolves 34.5.8), `electron-builder` stays `^25.1.8` | Release-lineage decision (`c35c8ff`). No Electron 39, no new native ABI, artifact naming untouched |
| No `brace-expansion` override | Four `minimatch` majors coexist and need incompatible lines; a workspace-wide pin is recorded as breaking `minimatch@3`/ESLint. Two of the three remaining findings are this package |
| No `@hono/node-server` 2.x | Patch for GHSA-frvp-7c67-39w9 needs a **major**. `git grep` finds no `serveStatic` / `serve-static` anywhere in the workspace, so the vulnerable surface is not mounted |
| No `postcss` override | The feature branch needed it via `hyperframes`; the release lineage has no `hyperframes`, and `pnpm audit --prod` reports no postcss finding at this base. Adding it would be an unmotivated change |
| No ESLint 9 flat-config work | ESLint does not exist at this base and lint is not a gate in either workflow at `c35c8ff`. `apps/desktop`'s own `lint` script cannot run here — pre-existing, unrelated to a security fix, left alone |
| No `apps/desktop/package.json` change | The feature branch's copy is **older** than the release (version `1.12.0` vs `1.13.1`, `axios ^1.15.1` vs the release's newer `^1.16.0`, plus a `hyperframes` dependency). Porting it would have regressed the release |
| No version bump, no tag, no push | Out of scope for this loop |

### Hono reachability, measured

`git grep` over tracked sources: the app imports `hono`, `hono/cors`, `hono/logger`,
`hono/factory` and `@hono/node-server`. It does **not** import `hono/jwt`, `hono/jsx`,
`serveStatic`, `toSSG`, `bodyLimit` or `ipRestriction`.

Consequences, stated rather than assumed:

- The **JWT `NumericDate`** advisory (GHSA-hm8q-7f3q-5f36) is **not on this app's path** — auth is
  `supabase.auth.getUser(token)` in `apps/marketplace-api/src/middleware/auth.ts`, not Hono JWT. No
  JWT contract test was written, because there is no code path to lock. The floor still closes the
  advisory.
- The **high** CORS advisory (GHSA-88fw-hqm2-52qc) fires when `origin` defaults to the wildcard;
  `src/index.ts` passes an explicit origin allowlist, so it was not reachable either. Fixed anyway —
  the floor was free.

## Red → green evidence

The point of the contract test is that it fails on the shipped release. Run at `c35c8ff` **before**
any dependency change, with only the test file added:

```
× resolves a builder-util-runtime that carries the credential-leak fix
    builder-util-runtime resolved to 9.5.1, below the 9.7.0 floor …
× resolves a js-yaml that carries the merge-key CPU-exhaustion fix
    js-yaml resolved to 4.2.0, below the 4.3.0 floor …
× strips credential headers on a cross-origin redirect and keeps them same-origin
    PRIVATE-TOKEN must not follow a cross-origin redirect:
    expected 'must-not-leak' to be undefined
```

The third failure is the one that matters: on v1.13.1 the credential **actually leaks**. This is a
demonstrated behaviour, not an inference from a version string.

Full desktop suite at that moment: **470 passed / 473**, the 3 failures being exactly these.
After the remediation: **473 / 473**, 54 files — no pre-existing test changed behaviour.

## Verification run (all on Node 22.23.1)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0, "Lockfile is up to date" — `package.json` and lockfile agree; `lockfileVersion: '9.0'` unchanged |
| `pnpm build:all` (5 projects: desktop `tsc`+`vite`, marketplace-api, cli, agent-bundle, extension-sdk) | exit 0 |
| `pnpm --filter @openclaw/desktop test` (the CI step) | exit 0 — **473/473**, 54 files |
| Updater dependency contract | 10/10 |
| `pnpm audit --prod` | 34 → **3** |
| `electron-builder --dir` smoke | exit 0 — `electron-builder 25.1.8`, `electronVersion=34.5.8`, `@electron/rebuild` rebuilt `better-sqlite3` against the **Electron 34** ABI (`buildFromSource=false`), 2 bundled `.ocx` packed |
| Windows native packaging `electron-builder --win --publish never` | exit 0 — `Izzi OpenClaw-1.13.1-win-x64.exe` (91.67 MB) + `.blockmap` + `latest.yml`; signing skipped locally (no cert), as expected off a release runner |
| Version read **back out of `app.asar`** | `node_modules/builder-util-runtime/package.json` → **9.7.0**; `node_modules/js-yaml/package.json` → **4.3.0**; one copy of each. (This closes a gap an earlier pass left open) |
| Electron 39 / electron-builder 26 anywhere in `package.json`, `pnpm-workspace.yaml`, `apps/desktop/package.json`, `pnpm-lock.yaml` | none — lockfile resolves `electron@34.5.8`, `electron-builder@25.1.8`, `electron-updater@6.8.3` |
| Secret scan over the whole diff + new test file (GitHub PAT / OpenAI / Slack / AWS / PEM / JWT / `izzi-` key / `service_role` / `DEPLOY_PASS` / `JWT_SECRET` patterns) | no findings. The test's `must-not-leak` strings are synthetic fixtures |
| Feature-branch WIP leakage (`hyperframes`, `eslint.config`, `lint:ci`, `typescript-eslint`, `sharp`, `adm-zip`, `postcss`) | none present |

### `latest.yml` — schema and artifact naming unchanged

`apps/desktop/electron-builder.json` is **byte-identical** to `c35c8ff`
(`git diff --quiet c35c8ff --` exits 0), no `artifactName` override exists, and electron-builder
itself is unchanged at 25.1.8 — so the manifest generator and the naming inputs are all the same.
Produced manifest:

```yaml
version: 1.13.1
files:
  - url: Izzi-OpenClaw-1.13.1-win-x64.exe
    sha512: <base64 sha512>
    size: 91668272
path: Izzi-OpenClaw-1.13.1-win-x64.exe
sha512: <base64 sha512>
releaseDate: '…'
```

Same electron-updater v6 shape the contract test parses: `version`, `files[].{url,sha512,size}`,
`path`, `sha512`, `releaseDate`. `version: 1.13.1` because this loop does **not** bump the version.

## Remaining 3 — triaged, not silenced

| Severity | Package | Patched | Path | Why deferred |
|---|---|---|---|---|
| high | `brace-expansion` | `>=2.1.2` | `packages/cli > archiver > archiver-utils > glob > minimatch` | Workspace-wide override breaks `minimatch@3`/ESLint; explicitly out of scope for this hotfix |
| high | `brace-expansion` | `>=5.0.8` | same | same |
| moderate | `@hono/node-server` | `>=2.0.5` | `apps/marketplace-api` | Needs a 1.x → 2.x **major**; the advisory is `serve-static` path traversal and `serveStatic` is not used anywhere in the workspace |

All three are DoS or path-traversal classes in build/CLI tooling or an unmounted surface. None is
remote code execution and none sits on the auto-update path this hotfix exists to fix.

## What is *not* behaviourally asserted (stated, not glossed)

- **fast-uri**: version floor only. A behavioural assertion was attempted and abandoned rather than
  guessed at — shell-level backslash escaping made the probe unreliable, and the consumer (`ajv`
  validating the local `electron-store` config schema) is not a remote-host trust boundary. Recorded
  as a floor, not claimed as verified behaviour.
- **js-yaml**: the DoS is a CPU-exhaustion class; a timing assertion would be flaky, so the guard is
  the floor plus the existing `latest.yml` parse contract.
- **lodash / uuid / hono**: floors plus build and archiver smokes. No behavioural assertion written;
  none of these advisories is on the auto-update path.
- **macOS packaging**: cannot be produced on a Windows host — `dmg`/`zip` for `x64` + `arm64` and
  notarisation require the `macos-latest` runner. `desktop-ci.yml` covers macOS for
  install + `build:all` + desktop tests, but **packaging** for macOS only runs in
  `release-desktop.yml`. It must go green there before the tag. Not claimed as verified here.
- **End-to-end `checkForUpdates()`** against a published release: needs a signed artifact on a real
  GitHub release, i.e. a release action, not a local test.

### CI runtime mismatch worth knowing before the tag

`desktop-ci.yml` uses Node 22 + pnpm 10; `release-desktop.yml` uses Node **20** + pnpm **9**.
Everything above was measured on the Node 22 / pnpm 10 pair. The lockfile stays at
`lockfileVersion: '9.0'`, which pnpm 9 also reads, so `--frozen-lockfile` should hold on the release
job — but that combination was not executed here. Pre-existing on the release lineage, not
introduced by this hotfix.
