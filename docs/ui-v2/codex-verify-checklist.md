# Codex verify checklist — checkpoint #25 / #11 / #23 / DeveloperUpload / GraphWorkspace

**Status (Codex run, 2026-09-28):**

| Section | Result |
|---|---|
| §1 Vitest | 329/329 PASS (scope not checked against the full suite) |
| §2 Type check | main PASS; renderer FAIL (baseline TS2339 only) |
| §3 Build | PASS |
| §3 Lint | BLOCKED |
| §4 Browser | PASS in dev mode (`localhost:5199`, MOCK and NO BRIDGE only, no real API). DeveloperUpload 422 not tested |
| §5 Electron | BLOCKED (local shell `ENAMETOOLONG`). The V2 MyGraph alert was seen in the browser only |
| §6 GitNexus | UNVERIFIED |

The code changes were written statically, because Bash failed with `ENAMETOOLONG`/`EPERM`. The
typescript-reviewer and security-reviewer passes were static (Read/Grep only) and found nothing.

Run everything in `F:\izzi-desktop-p10-integrate`. Do not use `F:\IzziAI` or the real user profile.

## 1. Vitest (focused)

```bash
pnpm --filter @openclaw/desktop exec vitest run \
  src/renderer/lib/open-my-graph-web.test.ts \
  src/renderer/lib/api-client.test.ts \
  src/main/extensions/marketplace-url.test.ts \
  src/main/affiliate/affiliate-client.test.ts \
  src/renderer/components/v2/MyGraphWorkspaceV2.test.ts
```

Some assertions read source files (`readFileSync` + `toContain`). They check wiring only and are
not runtime evidence.

**Result: 329/329 PASS** (Codex). It has not been checked whether that run covered the full desktop
suite or only a subset, so do not call it a full-suite result yet.

## 2. Type check

```bash
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit
```

Known baseline: one pre-existing TS2339 at `CustomerMarketingChannels.tsx:370`. Any other error is new.

**Result:**
- main: **PASS**.
- renderer: **FAIL, baseline only**. The only error is that TS2339. No new error.

## 3. Lint and build

```bash
pnpm --filter @openclaw/desktop lint
pnpm lint
pnpm build
```

**Result:**
- Desktop build: **PASS**.
- Lint: **BLOCKED**. ESLint fails on stale entries in `eslint-suppressions.json`, which list more
  suppressed violations than the code still has. As a result, there is no lint result for the
  changed files yet.

**Stale suppressions (not pruned, not edited):**
- Which entries are stale can only be settled from ESLint output. A local run failed once with
  `ENAMETOOLONG: uv_spawn` and was not retried.
- Unconfirmed candidates, taken from a static read of lines 1–80 of `eslint-suppressions.json`
  against the files this checkpoint touched:
  - `renderer/pages/DeveloperDashboard.tsx`, `no-unused-vars`, 1
  - `renderer/pages/ExtensionDetail.tsx`, `exhaustive-deps`, 1
  - `renderer/pages/Marketplace.tsx`, `exhaustive-deps`, 3. The file still has 3 hooks with deps
    (lines 76, 197, 206), so this count may still be valid.
  - `renderer/pages/CustomerMarketingRoom.tsx`, `exhaustive-deps`, 1. This file is modified in the
    working tree.
- **Next step for Codex:** run `pnpm exec eslint apps/desktop/src` and list the entries it reports
  as unused.
- **Owner decision:** either run `eslint --prune-suppressions` or fix the code so each count still
  matches. Neither is done here. `--pass-on-unpruned-suppressions` only hides the problem and does
  not count as a lint PASS.

## 4. Browser (dev mode, API :8788 offline or returning errors)

Run 2026-09-28 in Playwright. `:8788` was not reachable, so every error below was **mocked** by
routing the request. No real API was called. Screenshots are in
`f:\Ai Tools\Tool Starizzi - B2C - Openclaw\.playwright-mcp\izzi-demo\`.

- [x] A failed Marketplace call shows only the fixed Vietnamese copy, with no backend `error` text.
      MOCK 500 → `API Error: Yêu cầu thất bại`; MOCK 401 → session-expired copy; no `RAW-` text
      (`02-off-marketplace-500.png`, `02-off-marketplace-401-fixed-copy.png`).
      Unmocked, the page falls back to the demo banner with 19 demo items (`01-off-marketplace-demo.png`).
- [x] A failed DeveloperUpload shows the fixed copy, and the progress bar stops (timer cleared).
      MOCK register 200 + upload 500 → `⚠️ Yêu cầu thất bại`, progress stopped
      (`03-off-upload-500-fixed-copy.png`). The 422 case was not tested.
- [x] The DeveloperUpload request carries no `Content-Type` override, so multipart still works.
      Observed: `multipart/form-data; boundary=…`, `Authorization` null, as expected until the owner
      decides the token source.

Also seen, flag OFF and ON:
- The chat draft is kept across tab switches (`06-off-chat-draft-kept.png`).
- Affiliate renders with NO BRIDGE: zero balances and 0 external requests (`04-off-affiliate-nobridge.png`).
- **Defect, LOW, not fixed (code frozen):** with the flag ON at 720 px, Affiliate V2 is clipped on
  the right (the "Sao chép" button, the "Số tài khoản" input and the tiles; `section.v2-affiliate`
  right edge 757 px). `main` stays 720 px wide next to the 60 px rail. It renders fine at 960, which is
  the Electron `minWidth`, so this only affects the dev browser (`08-on-affiliate-720.png` vs
  `08-on-affiliate-960.png`). Proposed fix: make the content column subtract the rail
  (`min-width:0; max-width:100%` on the grid child) and use a single-column form at ≤720.

## 5. Electron, isolated profile

**Blocked locally:** the only shell attempt failed with `ENAMETOOLONG: uv_spawn`. Codex should run:

```bash
pnpm --filter @openclaw/desktop build
node "F:\Ai Tools\Codex\Temp\izzi-v2-preview\launch.cjs"
```

Then check that `launch-summary.json` reports the registry and `~/.openclaw` unchanged.

- [ ] V2 KnowledgeUniverse: an "Open on web" failure shows the `role="alert"` message.
      The browser (NO BRIDGE) already shows it (`07-on-mygraph-openweb-alert.png`); Electron is still unchecked.
- [ ] Legacy GraphWorkspace (not routed; mount it manually if needed): same alert on failure.
- [ ] Affiliate: withdraw/mutation errors show fixed copy only.
- [ ] Main-process logs contain only the op name and status, with no raw backend text,
      token or bank data.

## 6. GitNexus

- `impact` on: `marketplaceErrorMessage`, `normalizeMarketplaceUrl`, `resolveMarketplaceUrl`,
  `openMyGraphWebSafely`, `createOpenWebGuard`, `mutationErrorMessage`, and the page component
  exported from `pages/GraphWorkspace.tsx`.
- `detect_changes({ scope: "compare", base_ref: "main" })`.
