# Izzi AI Desktop beta.27 Customer Marketing Evidence

Date: 2026-08-11 ICT

Status: local Windows release candidate verified. Public release and installed-app dogfood are
recorded separately after the tag workflow completes.

## Scope

- Send a main-process-owned idempotency key for retry-safe and concurrent workspace invitations.
- Upgrade the Electron/build/native SQLite toolchain and patch audited transitive dependencies.
- Package the executable HyperFrames runtime closure without unpacking updater, Supabase, or
  electron-store dependencies.
- Preserve pinned-browser discovery, F5-TTS preview evidence, and the non-commercial render gate.

## Verification

- TypeScript/Vite production build: passed with Electron `39.8.10` and Vite `6.4.3`.
- ESLint: passed.
- Vitest: 87 files and 1,260 tests passed.
- Root lint-config contract: 4 tests passed.
- Socrates Tier-1 integrity contract: 4 tests passed.
- Frozen offline pnpm install: lockfile current.
- `pnpm audit --audit-level low`: zero known vulnerabilities.
- GitNexus staged impact: low, three changed symbols, zero affected execution flows.
- Correctness reviewer: READY.
- Security reviewer: READY after replacing broad `node_modules/**/*` unpacking with a selective
  HyperFrames runtime closure.

## Packaged Windows Proof

- Installer: `Izzi AI-1.14.0-beta.27-win-x64.exe`, 191,138,713 bytes.
- Local installer SHA-256: `E6ABB4CA53C16DC5A4152C7E3712D39D8513D91276E56A87FA7706525514DA4E`.
- Local blockmap SHA-256: `124EA9AF870ECD7ED3B78DC05D2F5DDB60AA251FF090DE52032C564EDCB8DFA9`.
- Update metadata version: `1.14.0-beta.27`; SHA-512 and byte size match the local installer.
- Packaged runtime: Electron `39.8.10`, Node `22.22.1`, HyperFrames `0.7.57`.
- Packaged SQLite opened a file, created a table, inserted `42`, and read `42` back.
- HyperFrames used the pinned Chrome Headless Shell and FFmpeg `8.1.1` to produce a verified
  60-second 1080x1920 MP4 at 30 fps from eight retained F5-TTS WAV clips.
- MP4 SHA-256: `07068ff5a54c29580d028cf156b4373659f868b44b5d6038d4b331a50bc7f06a`.
- Runtime scratch cleanup passed; no upload, publish, spend, or other external marketing action ran.
- Commercial render remained disabled because the retained F5 model is non-commercial.

## Release Boundaries

- The local Windows installer is not Authenticode-signed. The updater still verifies the release
  artifact with the SHA-512 digest in `latest.yml`; Windows reputation warnings remain possible.
- CI rebuilds release assets from the public tag, so public asset digests can differ from the local
  candidate above and must be verified after download.
- Backend CMR-108 is pushed at `c3df027` on
  `feature/cmr-108-profile-sync-20260811`; its migrations and invitation HMAC secret are not
  deployed to staging or production by this desktop release.
