# Izzi AI Desktop Beta.21 Read-Only Skill Adapter Evidence

Date: 2026-08-09
Repository: `kentzu213/izzi-ai`
Feature commit: `2cfeb8a`
Release commit: `3358672`
Public tag: `v1.14.0-beta.21`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.21

## Closed release slice

CMR-223 adds a bounded knowledge adapter for five MIT `SKILL.md` packs:
`video`, `ai-seo`, `social`, `content-strategy`, and `marketing-ideas`. The
adapter loads them as reference text only. It does not register executable
tools, expose their local paths, or grant permission for an external action.

Knowledge is attached only to a capability returned by a server-synced catalog.
The local and unavailable catalog paths remain fail-closed. AI Director selects
at most one entitled pack for a request, wraps it as
`read_only_untrusted_reference`, keeps `enableTools=false`, and preserves
`externalActionsAllowed=false`.

The public capability snapshot exposes only kind, mode, skill id, version,
license, source repository, source revision, and SHA-256. The packaged Node
harness inspected all public knowledge objects and measured `body=0`,
`relativePath=0`, and `matchTerms=0` exposed properties.

## Integrity boundary

The compiled loader pins the registry, MIT license, each vendored file, and each
normalized body digest. Registry-plus-skill co-tampering, a forged in-memory
body, malformed front matter, control characters, command interpolation, script
markup, oversized input, path escape, duplicate capability mapping, and an
unentitled capability all fail closed.

`node --test tools/socrates-tier1.test.mjs` passed 4 tests. The regressions read
the actual Git index, require mode `100644`, compare the staged blob with the
worktree bytes, reject a symlinked path, reject a coordinated registry and skill
rewrite, and reject staged/worktree divergence.

## Source verification

- `pnpm --filter @openclaw/desktop test -- src/main/customer-marketing/customer-marketing-knowledge-skills.test.ts src/main/customer-marketing/customer-marketing-service.test.ts src/renderer/pages/CustomerMarketingRoom.contract.test.ts`
  passed 3 files and 147 tests.
- `pnpm --filter @openclaw/desktop test` passed 83 files and 1,100 tests.
- `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit`
  and `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit`
  both exited zero.
- `pnpm --filter @openclaw/desktop build` transformed 1,139 renderer modules
  and exited zero.
- A `git show --format= --unified=0 2cfeb8a` changed-line scan reported
  `HIGH_CONFIDENCE_SECRET_ADDITIONS=0` and `ASSIGNED_SECRET_ADDITIONS=0`.

`pnpm --filter @openclaw/desktop lint` remains a repository residual and exited
2 because ESLint 9 cannot find an `eslint.config.*` file. `pnpm audit --prod
--audit-level high` reported 11 production advisories: 6 high, 4 moderate, and
1 low. CMR-223 adds no npm dependency.

## Public release

- `gh run view 31297240415 --repo kentzu213/izzi-ai --json status,conclusion,headSha,jobs,url`
  reported successful Desktop CI jobs on Windows and macOS for `3358672`.
- `gh run view 31297249212 --repo kentzu213/izzi-ai --json status,conclusion,headSha,jobs,url`
  reported successful Windows and macOS release jobs for `3358672`.
- `gh release view v1.14.0-beta.21 --repo kentzu213/izzi-ai --json assets,isDraft,isPrerelease,url`
  reported a public, non-draft prerelease with 12 uploaded assets.
- `Get-Item`, `Get-FileHash -Algorithm SHA256`, and a PyYAML plus `hashlib`
  check measured the public Windows installer at 184,610,844 bytes with SHA-256
  `9738c43c0e5d62e00985805a29a7795ef05a953f91c0baaf30ee7a7ad0d9c414`.
  Its path, size, version, and SHA-512 match `latest.yml`, and its first two
  bytes are `MZ`.
- `Get-AuthenticodeSignature` returned `NotSigned`, the known beta residual.

## Installed package proof

The public NSIS installer exited zero when installed at `F:\IzziAI`. The
installed ASAR package reports version `1.14.0-beta.21`. `Get-FileHash
-Algorithm SHA256` measured `F:\IzziAI\Izzi AI.exe` at 190,635,008 bytes with
SHA-256 `dc666527a2e4a2317e119e9604fa7fe1f67cc19ed7c599ccc7a8fa0df18c66f1`,
and `F:\IzziAI\resources\app.asar` at 114,185,435 bytes with SHA-256
`ca2e304c5a2d861af6cf07f2fc4f83c4a4a463a1b4c946075e45778ecc934c8c`.

`Get-FileHash -Algorithm SHA256` over
`F:\IzziAI\resources\customer-marketing-skills` confirmed the installed
registry, license, and all five `SKILL.md` files match their compiled pins. An
extracted-ASAR inspection also found the exact registry and body pins, the
untrusted-reference wrapper, and `enableTools:false` in the installed code.

## Packaged smoke

The installed app ran from `F:\IzziAI\Izzi AI.exe` with local CDP on port 9228.
The actual local catalog reported `status=local`, `knowledge=0`,
`externalActionsAllowed=false`, and `commercialRenderAvailable=false`.
HyperFrames, Node, and FFmpeg reported ready; F5-TTS and Voice Studio reported
`needs_setup`. CDP checks at desktop 1280x800 and mobile 390x844 measured zero
horizontal overflow and zero console, page, network, or mutation errors.

A renderer fixture loaded directly from the installed ASAR supplied a synthetic
server-synced catalog. It rendered all five `SKILL.md · chỉ đọc` labels and all
five `Nguồn ngoài chỉ đọc; không phải công cụ và không tự chạy.` warnings at
desktop 1280x800 and mobile 390x844. The Node CDP harness measured
`noteFits=true`, valid `aria-describedby` links, zero executable knowledge
controls, and zero console, page, network, or mutation errors.

The local evidence remains outside Git under
`F:\3 AI-Automation\izziAi Marketing\artifacts\starizzi-marketing-room\cmr-223-beta21`.
It contains the actual local-catalog screenshots, the synthetic synced-catalog
screenshots, and the installed-ASAR extraction used by the smoke harness.

## Safety and limits

- The adapter supplies bounded, untrusted reference text only. It performs no
  publish, send, spend, render, TTS, credential mutation, or external request.
- The local catalog has zero attached knowledge packs because server entitlement
  is unavailable; this is the expected fail-closed state.
- F5-TTS remains non-commercial and unavailable for advertising output.
- The Windows installer remains unsigned. macOS artifacts were built and
  published but were not installed or exercised on this Windows workstation.
- Status is `local_verified_only`. Staging and production deploy counts remain
  zero.

## Rollback

`v1.14.0-beta.20` remains the previous public prerelease. Reinstalling its
Windows installer returns the desktop binaries to the previous adapter-free
package while the per-user profile and local media remain outside the
installation directory.
