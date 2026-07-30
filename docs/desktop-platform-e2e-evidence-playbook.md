# Desktop platform E2E evidence playbook

Status: Release Gate R8 evidence preparation

R8 validates the structure and internal binding of records from a separately
authorized platform run. It does not authenticate who produced those records,
and it does not install, launch, upgrade, uninstall, sign, notarize, publish or
promote anything.

## Evidence chain

1. R7 produces `SIGNED_PLATFORM_EVIDENCE_PASS` for the exact artifact.
2. An authorized operator performs the platform run and creates one strict E2E
   evidence JSON.
3. R8 binds both inputs and emits
   `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS`.
4. An external trust step must authenticate the immutable R7 and operator
   evidence before W0 can consider release-gate advancement. R8 output sets
   `evidenceAuthenticated: false`, `releaseGateAdvanceAllowed: false` and
   `stableReleaseAccepted: false`.

## Shared required checks

Each platform run must record exactly one `PASS` result and SHA-256 evidence
digest for:

- login boundary;
- Tasks;
- Memory;
- Status;
- Overview;
- Marketplace;
- Extensions;
- Settings.

Do not place screenshots, logs, user names, credentials or tokens inside the
JSON. Store the binary/log evidence separately and include only its SHA-256.

## Windows requirements

- fresh NSIS install;
- first launch;
- upgrade from a supported prior version;
- post-upgrade launch;
- uninstall;
- app-data retained according to the current `deleteAppDataOnUninstall: false`
  policy.

The run must use a clean profile and declare a prior version different from the
candidate version.

## macOS requirements

- DMG opens;
- app copies to `/Applications`;
- first launch succeeds;
- Gatekeeper accepts the app;
- application removal succeeds.

The signed R7 verification target and the E2E artifact must be the same DMG.

## Safe validation

Create separate canonical input and output directories. Neither directory may
be a symlink or junction, and the output directory must already exist.

```powershell
node apps/desktop/scripts/platform-e2e-evidence-validator.mjs `
  --input-root "C:\release-evidence\input" `
  --platform-evidence "windows-signed.json" `
  --e2e-evidence "windows-e2e.json" `
  --output-root "C:\release-evidence\output" `
  --output "windows-validated.json"
```

Expected decision: `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS`.

This decision validates evidence structure and internal binding only. A forged
but self-consistent JSON bundle is not authenticated by R8 and cannot advance
the release gate.

## Failure handling

- Preserve failed input files and their external evidence blobs unchanged.
- Never overwrite a prior validation result.
- Correct the platform run or evidence source, not the validator output.
- Any missing, duplicate, unknown or failed check leaves stable release
  blocked.
- Do not retrieve signing secrets or personal operator identity for the
  evidence JSON.
