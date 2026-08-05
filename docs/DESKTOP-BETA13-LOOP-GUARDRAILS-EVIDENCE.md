# Izzi AI Desktop Beta.13 Loop Guardrails Evidence

Date: 2026-08-05
Repository: `kentzu213/izzi-ai`
Product commit: `606798e`
Public tag: `v1.14.0-beta.13`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.13

## Release slice

CMR-222 adds an operator halt and product spend/volume caps in front of the
existing CMR-402 external action gate. The design follows the two-tier action
model published in the MIT-licensed `coreyhaines31/marketingskills` loop
guardrails reference: read, analyse, draft, and stage stay autonomous, while
spend, send, publish, and destructive actions are gated and must be haltable.

- Release workflow run `30989930214` succeeded.
- Release is public, non-draft, prerelease, 12 assets.
- Windows publish artifacts are exactly three and all matched the GitHub
  digests: installer
  `11aba886c472910f6c96d67ed11536a33865b76798b36a2f1d5109af099bfdf7`
  at `184558172` bytes, its blockmap
  `af5aba27f3847c7d5ed777fb4cc703d513b035a08bb0b240b39166bf52252f7c`, and
  `latest.yml`
  `5fe1c6aeee256e6ef734d34156dece3ba9356187dab19250c155e092d46b44da`.
- `latest.yml` bound version `1.14.0-beta.13` and a SHA-512 that matched the
  installer bytes recomputed locally.
- Installed over `1.14.0-beta.12` at `F:\IzziAI`; `FileVersion` after install
  was `1.14.0-beta.13`.

## What the change does

Two checks with deliberately different placement in
`CustomerMarketingService.checkExternalActionGate`:

1. **Operator halt** — read before request preflight and before any authority,
   database, or gateway access, so an incident stop costs no I/O and outranks a
   valid approval. Engaged by a flag file in the user data directory or by the
   `IZZI_MARKETING_KILL_SWITCH` environment variable. Denies with the new public
   reason `kill_switch_engaged`.
2. **Spend and volume caps** — read only after the caller's authority is
   established, and denied with the gate's existing `policy_denied` reason.
   Defaults: 500,000 VND per run, a 2,000,000 VND window ceiling, 500 recipients
   per run, 50 items per run. All are far below the structural request maxima.

Fail-closed behaviour: an unreadable halt flag engages the halt; a spend with no
usable window figure is refused rather than treated as zero spend; a guardrail
read failure denies as a policy decision.

## Packaged proof on the installed build

The real gate was called through the renderer bridge
(`window.electronAPI.customerMarketing.checkExternalActionGate`) in the installed
app, for three gated shapes: publish, spend inside the cap, and bulk email. The
gate still has no enabled executor, so every call denies; the denial reason is
what is under test. All three runs used the same app process, with no restart.

| Halt state | Reason returned for all three probes | Evidence |
|---|---|---|
| No flag, no env | `approval_invalid` | `cmr222-halt-off.json` |
| Flag file created | `kill_switch_engaged` | `cmr222-halt-on-file.json` |
| Flag file deleted | `approval_invalid` | `cmr222-halt-released.json` |

`allowed` and `executed` were false in every result. Artifacts are kept outside
Git under `artifacts/starizzi-marketing-room/cmr-222`.

A UI smoke on the same build recorded the Customer Marketing Room and the Video
Studio toolchain with zero console errors, zero runtime exceptions, zero network
failures, zero HTTP responses at or above 400, zero external requests, and no
layout overflow at `1280x800` or `390x844`.

## Issue found by running the packaged build

The first halt attempt did not engage. The runbook had been written against
`%APPDATA%\Izzi AI`, but Electron derives the user data directory from the
package name, so the real path is `%APPDATA%\@openclaw\desktop`. The halt worked
immediately once the flag was written there. The runbook now carries the correct
path for all three platforms plus a way to confirm it — the directory that
already contains `marketing-room.json`.

## Review findings closed before release

An independent behavioural review of the diff raised three blocking findings,
all accepted and fixed before the tag:

- The window ceiling could never fire, because no ledger was wired and a missing
  ledger read as zero spend. A missing or throwing ledger now refuses spend.
- The cap denials were a pre-authority oracle: distinct reasons plus a check
  before authority let an unauthorised caller bisect the exact configured caps.
  The two cap-specific reasons were removed, caps now reuse `policy_denied`, and
  the cap check moved to after the authority lookup.
- The halt read its environment flag from an allowlist, so a plausible operator
  value such as `STOP` was ignored. Any non-empty value now engages the halt
  except the explicit off values.

Also corrected: a comment claiming the caps were re-read per request (they are
fixed per process), a guardrail crash reported as an operator halt (now
`policy_denied`), unguarded metadata reads in the exported evaluator, and a halt
test that did not actually hold a valid approval.

## Automated checks

- Focused guardrail suite: 24 tests. Full desktop suite: 75 files, 1005 tests
  passed, Vitest `4.1.2`.
- Main process typecheck: exit 0. Production build: exit 0, 1136 modules.
- CI ran `Build desktop app` and `Run desktop tests` in the `build-windows` job
  before `Package and Publish` produced the artifact under test.
- Scoped secret scan over the new and changed files: clean.

## Limits of this evidence

- No spend ledger exists yet, so the window ceiling is not yet exercised against
  real spend; today it refuses spend rather than measuring it.
- The per-run budget-shift limit from the reference model is not implemented,
  because this product has no budget-shift surface.
- The caps are read once per process, so changing them requires a restart.
- The flag file lives in a directory the signed-in user can write, so anything
  running as that user can delete it. The environment flag is the stronger
  control, at the cost of needing a restart.
- The service constructor still defaults to an environment-only reader. The one
  production construction site passes the flag path; a future site could omit it.
- Installer remains `NotSigned`, and clean-machine install, upgrade, and
  uninstall proof stays open under CMR-214 and CMR-216.
- Status: `local_verified_only`. No staging or production deploy was performed,
  and no external action was executed.
