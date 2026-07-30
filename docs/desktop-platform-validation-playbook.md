# Desktop platform validation playbook

Status: Release Gate R7 non-publishing harness

This playbook separates three claims that must never be collapsed:

1. **Static preflight** — artifact paths, identity, size and SHA-256 are valid.
2. **Signed platform evidence** — the target operating system accepts the
   signature/notarization evidence.
3. **Stable release acceptance** — install/upgrade/uninstall and product flows
   passed under a separately authorized platform run.

Static preflight is useful evidence, but it is never stable-release approval.

## Safety boundary

The harness:

- reads files under one canonical release root;
- rejects traversal, symlinks/junctions and non-file artifacts;
- binds every signature probe to an artifact already hashed by static preflight;
- never executes an installer or application;
- calls only fixed platform verifier programs with `shell: false`;
- writes a new evidence JSON and refuses to overwrite it;
- never uploads or publishes a GitHub release.

The R7 workflow is manual-only, has read-only repository/package permissions,
packages with `--publish never` and retains only evidence JSON as an internal
workflow artifact. Checkout uses the workflow's scoped `contents: read` token
inside `actions/checkout`, with `persist-credentials: false`; no token or secret
is passed to install, build, package or validation shell commands.

## Static Windows preflight

After a local or CI package has been produced without publishing:

```powershell
$version = node -p "require('./apps/desktop/package.json').version"
$commit = git rev-parse HEAD
$releaseRoot = (Resolve-Path 'apps/desktop/release').Path
New-Item -ItemType Directory -Path "$PWD/platform-evidence" -ErrorAction Stop
node apps/desktop/scripts/platform-validation-harness.mjs `
  --platform windows `
  --arch x64 `
  --version $version `
  --source-commit $commit `
  --release-root $releaseRoot `
  --artifact "Izzi AI-$version-win-x64.exe" `
  --output "$PWD/platform-evidence/windows-x64.json"
```

Expected decision: `STATIC_PREFLIGHT_ONLY`.

Do not run the installer during this phase.

## Signed Windows evidence

Only after signing and platform-run authority are explicitly granted, add:

```powershell
  --application "Izzi AI-$version-win-x64.exe" `
  --expected-signer-id "<EXPECTED_CERTIFICATE_SHA1_THUMBPRINT>" `
  --probe-signatures
```

The harness invokes `Get-AuthenticodeSignature` through a fixed PowerShell
program. `Status` must be `Valid`. It still does not execute the installer.

This does not replace fresh install, launch, prior-version upgrade, uninstall
or application-data retention checks.

## Static macOS preflight

For each architecture:

```bash
version="$(node -p "require('./apps/desktop/package.json').version")"
commit="$(git rev-parse HEAD)"
mkdir platform-evidence
node apps/desktop/scripts/platform-validation-harness.mjs \
  --platform macos \
  --arch arm64 \
  --version "$version" \
  --source-commit "$commit" \
  --release-root "$(pwd)/apps/desktop/release" \
  --artifact "Izzi AI-${version}-mac-arm64.dmg" \
  --output "$(pwd)/platform-evidence/macos-arm64.json"
```

Repeat for `x64`. Expected decision: `STATIC_PREFLIGHT_ONLY`.

## Signed/notarized macOS evidence

Only on the matching macOS runner after signing/notarization authority:

```bash
node apps/desktop/scripts/platform-validation-harness.mjs \
  --platform macos \
  --arch arm64 \
  --version "$version" \
  --source-commit "$commit" \
  --release-root "$(pwd)/apps/desktop/release" \
  --artifact "Izzi AI-${version}-mac-arm64.dmg" \
  --application "Izzi AI-${version}-mac-arm64.dmg" \
  --expected-signer-id "<EXPECTED_APPLE_TEAM_ID>" \
  --probe-signatures \
  --output "$(pwd)/platform-evidence/macos-arm64-signed.json"
```

All three probes must pass:

- `codesign --verify --strict`;
- `xcrun stapler validate`;
- `spctl --assess --type open --context context:primary-signature`.

Expected decision: `SIGNED_PLATFORM_EVIDENCE_PASS`. This still does not prove
DMG open/copy behavior or product workflows.

The expected certificate thumbprint or Apple Team ID is public signer metadata,
not a signing secret. The harness records both expected and observed identity
and fails closed on a mismatch.

## Stable platform acceptance

A separately authorized run must record:

- exact commit, version and RC tag;
- Windows fresh install, launch, supported-version upgrade and uninstall;
- explicit expected app-data retention after uninstall;
- macOS DMG open, copy to `/Applications`, first launch and Gatekeeper result;
- login boundary plus Tasks, Memory, Status, Overview, Marketplace,
  Extensions and Settings rendering;
- updater available → downloaded → restart CTA behavior;
- immutable artifact/evidence SHA-256 values.

Do not retrieve or print signing secrets. Record secret names and presence
checks only. Do not push, tag, publish or promote stable without separate user
authorization.

## Failure and rollback

- Preserve failed evidence JSON and CI logs; never replace a failed artifact.
- Revoke the platform-validation lease before opening a correction lease.
- Rebuild from the same source commit only after the failure is understood.
- A failed signed/platform check leaves stable release `BLOCKED`.
