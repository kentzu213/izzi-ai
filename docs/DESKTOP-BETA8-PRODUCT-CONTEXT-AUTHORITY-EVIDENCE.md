# Izzi AI Desktop 1.14.0-beta.8 Product Context Authority Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Commit: `17d3e8595dc2d6bf9f8473a49c40521b4c1cfd90`
Tag: `v1.14.0-beta.8`
GitHub Actions run: `30465599108`

## Closed release slice

- Product Marketing Context save authority is derived in Electron main from
  the authenticated identity, current workspace, role, and context revision.
- The renderer must return the signed authority token supplied by the current
  snapshot. Main revalidates authority before writing.
- Backend-unavailable and reviewer/viewer states fail closed.
- A tenant-scoped HMAC token remounts Brand Center when identity or workspace
  changes, preventing a dirty draft from crossing account boundaries.
- Brand Center exposes a direct account-settings action so the operator can
  correct an unexpected signer identity without bypassing authority checks.

## Verification before release

- Focused authority, IPC, shared-contract, and renderer tests: `121/121`
  passed.
- Full desktop regression: `947/947` passed across 73 test files.
- Main and renderer TypeScript checks: passed.
- Production build: passed.
- `git diff --check`: passed.
- Added-secret scan: passed.
- Final reviewer result: no findings; release ready.

## Published release

- Commit `17d3e8595dc2d6bf9f8473a49c40521b4c1cfd90` was fast-forwarded
  to `origin/main`.
- Release workflow `30465599108` passed for Windows and macOS.
- Release `v1.14.0-beta.8` is public, non-draft, and marked prerelease.
- All 12 expected assets are uploaded, including Windows x64 and macOS x64
  plus arm64 packages.
- Published Windows installer SHA-256:
  `6b68bb5845e8312515193784c9cd277f020b854ea426c4cb3c99da92944d4e9b`.

## Packaged runtime smoke

- The local packaged executable reported
  `@openclaw/desktop/1.14.0-beta.8`.
- Local packaged executable SHA-256:
  `90EF1506A991950900A390F0A7BB8BF4CF5A847CEF1ED7EB2AB3BF7340155179`.
- Updater state was `idle` with current version `1.14.0-beta.8`.
- Live workspace was `IzziAPI Marketing`, role `owner`, plan `pro`.
- Live signer was `FOOD & TRAVEL SHOW`.
- IzziAPI authority confirmation was unavailable, so the snapshot correctly
  returned `canSave: false`, no authority token, a tenant scope token, and
  `externalActionsAllowed: false`.
- Brand Center rendered `Mở cài đặt tài khoản` and the disabled
  `Không có quyền lưu` action.
- Product Marketing Context was not saved because the requested reviewer is
  `Nguyễn Nghĩa`, not the currently authenticated signer.
- Desktop smoke at `1280x800` had document width `1280`, scroll width `1280`,
  contained authority controls, and no settings/save overlap.
- Mobile smoke at `390x844` had document width `390`, scroll width `390`, no
  overflowing visible buttons, and both authority actions above the fixed
  mobile navigation.
- Reload, navigation, and responsive checks recorded zero console errors and
  zero page errors.

Screenshot SHA-256 values:

- Desktop Brand Center:
  `5C563BB705B8951D51C49BADEF63096DF474F7575ED56A29D01EAE2393592369`
- Desktop authority panel:
  `A92033E9D19AB9853D3F5A5047281A5C4160968737E15416A289B73A38871D69`
- Mobile Brand Center:
  `70DC95319BD02240036AFA6F4E197040363C1C4F7CE1C12AAC0879751E8F4B4A`
- Mobile authority panel:
  `690A9B1FD465F9B74A9E1EDCE3D6E6A6FFC81964BDCCD1D739F7A7FA83555480`

The screenshots remain outside the repository because they contain live
workspace state.

## Safety and remaining gates

- No marketing publish, advertising spend, integration mutation, credential
  change, or Product Marketing Context save was performed.
- ESLint 9 still has no repository flat config.
- The existing dependency audit remains at one moderate and two high
  advisories; this release added no dependencies.
- Windows packages remain unsigned in this phase.
- GitHub Actions emitted the existing Node.js action-runtime deprecation
  warning and a non-blocking post-checkout Git annotation; both jobs completed
  successfully.

No new product-context defect was reproduced in packaged smoke. The next
runtime gate is operational: authenticate the intended `Nguyễn Nghĩa` account
and restore confirmed IzziAPI workspace authority, then rerun the save flow
without weakening the fail-closed boundary.
