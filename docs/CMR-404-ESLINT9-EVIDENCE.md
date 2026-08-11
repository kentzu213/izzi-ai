# CMR-404 ESLint 9 Workspace Gate Evidence

Date: 2026-08-11 ICT

This post-beta26 continuation closes the lint-infrastructure half of CMR-404 without changing an
application source file or runtime dependency. The implementation is rooted in `eslint.config.mjs`,
`eslint-suppressions.json`, `package.json`, and `tools/eslint-config-contract.test.mjs`.

## Workspace Policy

The root command `pnpm lint` applies ESLint 9.39.4, `@eslint/js` 9.39.4,
typescript-eslint 8.67.0, and React Hooks 7.1.1 across the workspace. Node/Electron `require()`
interop is permitted only in Node-scoped files; renderer files receive browser globals and the
Rules of Hooks plus exhaustive-dependency rules. The desktop package command resolves the same
root config and baseline rather than maintaining a second policy.

The initial command `pnpm exec eslint . --format json` checked 310 files. ESLint bulk suppression
records exactly 34 pre-existing errors in `eslint-suppressions.json`: 27 unused local/import
findings and 7 exhaustive-dependency findings. Both rules remain configured as errors, so a new
finding outside that baseline still fails. Explicit `any` remains deferred because the source
inventory command `rg -n '\bany\b' apps packages tools -g '*.{ts,tsx}'` found 427 legacy lines;
unused API arguments and caught errors are also outside this first migration gate.

The deterministic contract command `pnpm test:lint-config` passes 4/4 tests. It asserts exact
toolchain versions and scripts, Node/renderer rule separation, the 27 + 7 suppression ceiling,
and a negative lint probe whose new unused variable must exit 1 with
`@typescript-eslint/no-unused-vars`. The normal `pnpm lint` and
`pnpm --filter @openclaw/desktop lint` commands both exit 0 with zero reported errors or warnings.

## Continuous Enforcement

`.github/workflows/desktop-ci.yml` runs both lint and the contract on Windows and macOS.
`.github/workflows/release-desktop.yml` runs them in the Windows gate before packaging; the macOS
release job depends on that Windows job. Both workflow files parse successfully through the
lockfile-resolved `js-yaml` package.

## Lint Dependency Audit

The first full `pnpm audit --json` exposed eight advisory paths through the newly rooted lint
toolchain. Same-major overrides now resolve `brace-expansion` 1.x to 1.1.18,
`brace-expansion` 5.x to 5.0.9, and `@babel/core` 7.x to 7.29.6. The contract test pins those
floors. After `pnpm install --frozen-lockfile`, `pnpm audit --prod --json` reports zero
vulnerabilities across 424 production dependencies, while a parsed full-audit path inventory
reports zero advisory path through ESLint, typescript-eslint, React Hooks, globals, or
`@eslint/js`.

The full developer-tool audit is not claimed clean: `pnpm audit --json` reports 70 existing
advisories across 885 dependencies (9 low, 31 moderate, 29 high, and 1 critical), concentrated in
Electron 34 and its packaging chain. That is the next dependency-remediation slice; it is not
silenced by the lint baseline and is not on the production dependency audit reported above.

## Verification Commands

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm --filter @openclaw/desktop lint
pnpm test:lint-config
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit
pnpm --filter @openclaw/desktop test
pnpm build:all
pnpm test:socrates
pnpm audit --prod --json
pnpm audit --json
node tools/socrates-tier1.mjs --changed
```

No desktop version is bumped for this slice because it changes quality tooling, CI, tests, and
documentation only; `apps/desktop/src` and runtime dependencies are unchanged.
