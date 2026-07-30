# Personal Office Release Gate R2-R4 reconciliation

Date: 2026-07-29

## Outcome

The local reconciliation candidate is ready for platform validation. Stable
release remains blocked and no remote or production action was performed.

Candidate:

- branch: `feature/personal-office-reconciled-20260729`
- accepted source HEAD before this governance record: `0246f19`
- origin/main replayed through `8330b46` (`v1.14.0-beta.9` lineage)

## Accepted changes

- R3 reconciled the four Customer Marketing conflicts while preserving both
  Product Marketing Context authority and the Personal Office reference
  workspace.
- R4 added trusted top-level renderer checks to every `work:*` invoke handler
  and `runtime:listHealth`, before parsing, authorization, or data access.
- R2's independently reviewed release-security patch was applied with matching
  patch-id `0650cca7bc8c8aa3fe93111eedfa30fb66ec1e84`.
- The beta.9 managed HyperFrames feature and evidence commits were replayed
  without conflict.
- A lint-only regex normalization closed two `no-regex-spaces` errors without
  changing release behavior.

## Verification

- full desktop tests: 1,359/1,359 PASS across 122 files;
- focused Customer Marketing/HyperFrames/R4 tests: 233/233 PASS;
- dedicated R4 IPC tests: 34/34 PASS;
- main TypeScript: PASS;
- renderer Vite production build: PASS, with the existing large-chunk advisory;
- lint: 0 errors, 350 warnings, ceiling 358;
- release branding/workflow contract: 5/5 PASS;
- independent R4 security review: PASS;
- conflict-marker, diff-check and secret scans: PASS;
- quarantine: unchanged at `959e2d28`, 119 status entries.

The candidate used read-only dependency aliases to the canonical isolated
toolchain. No package install, junction, symlink, push, tag, publish, deploy,
installer execution, secret retrieval, or quarantine write occurred.

## Remaining gates

- protect the GitHub `desktop-release` environment;
- Windows install/upgrade/uninstall and data-retention validation;
- real signed/notarized macOS x64 and arm64 artifacts plus platform checks;
- approved RC platform run;
- separate explicit admin promotion for a validated draft/prerelease.
