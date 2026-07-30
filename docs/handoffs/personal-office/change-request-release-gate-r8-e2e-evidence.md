# CHANGE_REQUEST — Release Gate R8 unauthenticated E2E evidence structure validator

Status: `APPROVED_FOR_ISOLATED_PRODUCER`

Gate: `RELEASE-GATE-R8-E2E-EVIDENCE`

Decision authority: W0 Control Tower / Codex

Canonical base: `95a645d8ab49a6e40834e77a4aead4d2b61b1f7d`

## Purpose

R7 can produce immutable static or signed artifact evidence, but stable release
still requires separately authorized Windows/macOS install and product-flow
checks. R8 adds a dependency-free structural and internal-binding validator for
the resulting operator evidence. It cannot authenticate who produced a
self-consistent JSON bundle and cannot advance the release gate. It prepares a
fail-closed review record without executing an installer, application,
workflow, browser or network action.

## Exact producer paths

- `apps/desktop/scripts/platform-e2e-evidence-validator.mjs`
- `apps/desktop/scripts/platform-e2e-evidence-validator.test.mjs`
- `docs/desktop-platform-e2e-evidence-playbook.md`
- `docs/handoffs/personal-office/release-gate-r8-e2e-evidence.json`
- `worklogs/personal-office-release-gate-r8-e2e-evidence.md`

All five paths are new. No existing hot file is included.

## Authorized implementation

1. Validate one R7 signed-platform evidence JSON and one platform E2E evidence
   JSON using exact schemas and no new dependency. Require the exact R7
   verifier command and argv arrays for macOS; for Windows, require the exact
   fixed flags and SHA-256 of the complete embedded Authenticode script.
2. Bind platform, architecture, version, source commit, artifact path, SHA-256
   and byte size across both evidence inputs.
3. Require every platform-specific install, launch, upgrade/uninstall or DMG,
   Gatekeeper and product-flow check exactly once with `PASS`.
4. Require bounded timestamps, a clean-profile assertion, public operator-role
   attestation digest and Windows data-retention policy evidence.
5. Reject unknown fields, duplicate checks, secret-like fields/values,
   symlink/junction inputs, mismatched artifacts and mutable output paths.
6. Emit deterministic create-only structure evidence with decision
   `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS`,
   `evidenceAuthenticated: false`, `releaseGateAdvanceAllowed: false` and
   `stableReleaseAccepted: false`.
7. Require a separate trust step to authenticate immutable R7 and operator
   evidence before W0 may consider release-gate advancement.

## Constraints

- Do not modify package manifests, lockfiles, workflows, release configuration,
  product source, DB/schema, auth, preload or renderer paths.
- Do not install dependencies or execute any workflow, installer, application,
  browser, connector, platform verifier or network action.
- Do not retrieve signing secrets or personal operator identity.
- Do not claim evidence authenticity, release-gate acceptance or stable
  acceptance from structural validation alone.
- Do not push, tag, publish, deploy, mutate GitHub or promote stable.
- Do not write, reset, stash, clean or commit the quarantine worktree.
- The producer may write only the five exact paths above.

## Required proof

- built-in Node tests cover both platforms and all fail-closed branches;
- deterministic output and create-only/canonical containment pass;
- independent correctness and security review pass;
- full canonical tests, TypeScript, build and lint pass before acceptance.
