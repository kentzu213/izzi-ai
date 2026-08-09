# Izzi AI Desktop Beta.20 Voice Studio Repair Evidence

Date: 2026-08-09
Repository: `kentzu213/izzi-ai`
Feature commit: `7f5075a`
Release commit: `8dd0e1d`
Public tag: `v1.14.0-beta.20`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.20

## Closed release slice

CMR-221 closes the bounded local Voice Studio start/repair path from the public
packaged application. The path accepts no renderer-controlled extension id,
path, service selector, or payload. It derives the one trusted extension in the
main process, revalidates workspace authority, role, and Pro plan, checks the
Docker daemon, starts only the declared local service, and waits for stable
readiness.

The beta.19 public package reproduced a race: Docker and the managed service
could be healthy while the Customer Marketing snapshot still returned
`needs_setup` from the 15-second media toolchain cache. Beta.20 adds an explicit
cache bypass to `getToolchain` and invokes it only when the bounded runtime
reports `ready` while the first snapshot remains stale. A snapshot that is
already ready keeps the fast path and does not rerun runtime inspection.

## Source verification

- `pnpm --filter @openclaw/desktop test -- src/main/customer-marketing/customer-video-studio-service.test.ts src/main/customer-marketing/customer-marketing-service.test.ts`
  passed 2 files and 165 tests. The new regressions prove both cache retention
  and the conditional refresh after runtime readiness.
- `pnpm --filter @openclaw/desktop test` passed 82 files and 1,088 tests.
- `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit`
  and `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit`
  both exited zero.
- `pnpm --filter @openclaw/desktop build` transformed 1,139 renderer modules
  and exited zero.
- The scoped changed-file secret pattern scan reported zero matches across 4
  changed files. `git diff --check` also exited zero.

ESLint remains a pre-existing repository residual: `pnpm --filter
@openclaw/desktop lint` cannot find an `eslint.config.*` file. The production
dependency audit is unchanged by this dependency-free patch: `pnpm audit
--prod --audit-level high` reported 11 advisories, split into 6 high, 4
moderate, and 1 low.

## Public release

- `gh run view 31290645270 --json status,conclusion,jobs` reported successful
  Desktop CI jobs on Windows and macOS.
- `gh run view 31290652911 --attempt 3 --json status,conclusion,jobs` reported
  successful `build-windows` and `build-mac` jobs. Attempt 1 hit a transient
  `hdiutil detach` exit 16. Attempt 2 built the missing DMGs but met duplicate
  ZIP assets. The 8 zero-download macOS assets were removed, the failed macOS
  job was rerun once more, and attempt 3 published a coherent set.
- `gh release view v1.14.0-beta.20 --json assets,isDraft,isPrerelease` reported
  a public, non-draft prerelease with 12 uploaded assets.
- The public Windows installer measured 184,572,637 bytes and SHA-256
  `a2d83a4e4e8bcc784b34c3f8d19883c8b88b3fb49d4960b593ff83c412245451`.
  A PyYAML plus `hashlib` verification parsed `latest.yml` and confirmed exact
  version, path, size, and SHA-512 against the downloaded bytes. Its first two
  bytes were `MZ`.
- `Get-AuthenticodeSignature` returned `NotSigned`, the known beta residual.

## Installed package proof

The downloaded NSIS installer exited zero when installed over beta.19 at
`F:\IzziAI`. Reading the installed ASAR through `@electron/asar` returned
version `1.14.0-beta.20`; the compiled main files contained both the
conditional `{ refresh: true }` call and the cache invalidation branch.

`Get-FileHash` measured the installed executable SHA-256 as
`ddc426484ae1aa0d506658af04d0a15c218cbfcc5a94230a85802e784afb2294`
at 190,635,008 bytes, and the installed ASAR SHA-256 as
`be641150c2680f1ba1f07ec511442b7f24e1e663f2a415045db30b9aea805ac6`
at 114,145,018 bytes.

## Packaged cold-start smoke

The installed beta.20 app was launched with local CDP after the exact Docker
Compose project was brought down without `-v`. The local CMR-221 harness drove
the rendered UI at desktop 1280x800 and mobile 390x844.

The `node` harness report measured:

- initial Voice Studio state `needs_setup`;
- first repair settled `ready` in 25,458 ms;
- repeated repair returned `ready` in 233 ms;
- no horizontal overflow at either viewport;
- zero console/runtime issues and zero network loading failures;
- zero renderer external requests and zero renderer mutation requests;
- `commercialRenderAvailable=false` and `externalActionsAllowed=false` before
  and after repair.

The local report and screenshots remain outside Git under
F:/3 AI-Automation/izziAi Marketing/artifacts/starizzi-marketing-room/cmr-221-beta20-cold.
They contain no rendered customer prompt or secret value.

## Safety and limits

- The repair path starts local preview infrastructure only. It performs no TTS
  inference, media render, publish, spend, bulk email, credential mutation, or
  other external action.
- F5 ViVoice remains `CC-BY-NC-SA-4.0`, reports `needs_setup`, and is not
  eligible for commercial advertising render.
- The Voice Studio card reports local readiness, not commercial license
  approval. The commercial gate remains false without verified evidence.
- The Windows installer remains unsigned. macOS artifacts were built and
  published but were not installed or exercised on this Windows workstation.
- Status is `local_verified_only`. No staging or production deploy was
  performed.

## Rollback

`v1.14.0-beta.19` remains the previous public prerelease. Reinstalling its
Windows installer returns the desktop binaries to the prior package while the
per-user profile and Docker model volume remain outside the installation
directory.
