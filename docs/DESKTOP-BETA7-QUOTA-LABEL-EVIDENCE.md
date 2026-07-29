# Izzi AI Desktop 1.14.0-beta.7 Quota Label Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Commit: `039fea4a8ea51ac49abe2f95af093ffcd1b55907`
Tag: `v1.14.0-beta.7`

## Closed defect

The Customer Marketing Room header rendered the monthly credit quota as
`/ 80 tháng`, which reads as a duration of 80 months rather than a monthly
credit allowance.

The header now renders `/ 80 credit/tháng` without changing balance, quota, or
billing calculations.

## Verification

- Focused Customer Marketing Room contract: `2/2` passed.
- Full desktop regression: `936/936` passed.
- Production build and TypeScript compilation: passed.
- `git diff --check`: passed.
- Added-secret scan: passed.
- GitHub Actions run `30460620850`: Windows and macOS jobs passed.
- Release `v1.14.0-beta.7`: public, non-draft, and marked prerelease.
- Windows x64 plus macOS x64 and arm64 artifacts are present.
- Packaged Windows runtime reported version `1.14.0-beta.7`.
- Live header text:

  `146,932 credit / 80 credit/tháng`

- The previous `/ 80 tháng` label was absent.
- Desktop header and balance bounds remained contained at `1280x800`.
- Mobile smoke at `390x844` reported document width `390`, scroll width `390`,
  and no horizontal overflow.
- Desktop screenshot SHA-256:
  `93C64D9D4CE3F8881288831468D133D306D0CA37460654E22F88FB3860B7C27B`.
- Mobile screenshot SHA-256:
  `40FD3D79207AF28041BF50FDFD3E3F6D0FCE9CDEE6FD27DE8A819DCDA604DDAE`.

The screenshots remain outside the repository because they contain live
workspace state.

## Safety

- No dependency, billing, quota, integration, publish executor, or external
  marketing action changed.
- Product Marketing Context was not saved because the authenticated account
  name is `FOOD & TRAVEL SHOW`, while the requested reviewer is
  `Nguyễn Nghĩa`. Reviewer authority remains bound to authenticated identity.
