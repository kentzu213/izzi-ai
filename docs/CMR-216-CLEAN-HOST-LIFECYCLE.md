# CMR-216 Clean-Host Lifecycle

CMR-216 has four evidence slices:

- CMR-216A: fail-closed harness and artifact preflight.
- CMR-216B: install, first launch, upgrade, rollback, uninstall, and reinstall on an isolated Windows user.
- CMR-216C: retained-profile and cleanup review on that isolated user.
- CMR-216D: repeat the lifecycle from a clean VM or machine. Only this slice may close CMR-216.

Every non-self-test runner receipt is verified only as `WorkstationIsolated` and says
`same-workstation-isolated-user`; it cannot self-promote to clean-machine evidence. An operator may
record `CleanMachineClaimed`, but only an independent dossier review of VM/host provenance may promote
that receipt and close CMR-216. A clean VM or host has no prior Izzi AI state, source checkout,
developer toolchain, customer credentials, or customer data.

Synthetic CI/self-test receipts are marked `selfTest=true`, `verifiedEvidenceTier=ContractOnly`, and
`claim=synthetic-contract`; they are contract evidence only and cannot be used as host evidence.

## Guardrails

The lifecycle runner defaults to preflight. Mutation requires both `-Execute` and
`CMR216_LIFECYCLE_EXECUTE=true`. It stops before install when the current user differs from
`ExpectedUser`, an artifact digest or signing policy fails, the install root is non-empty, an Izzi AI
profile/uninstall entry/process, per-user or common shortcut, matching service, or matching scheduled
task already exists, or receipt/profile roots are unsafe. Self-test mode cannot execute installers.

Receipts distinguish local system mutation from provider/network activity. Execute mode records
`localSystemMutationPerformed=true` and `providerMutationPerformed=false`; the latter means the harness
does not publish, send, message, or spend. It does not claim network isolation, so
`networkIsolationVerified=false` remains until independent environment evidence proves it. On lifecycle
failure, the runner attempts a silent uninstall from the clearly named CMR216 install root and retains
the profile for investigation. Cleanup is attempted only after the runner itself has performed a local
system mutation; a preflight or confirmation failure cannot execute an unrelated uninstaller.

Receipts contain artifact hashes, bounded status/error codes, and lifecycle facts. They omit the
Windows username, stable user identifier, credential values, and raw path-bearing error messages.

The runner verifies baseline and candidate SHA-256, applies the CMR-214 signing policy, then checks:

1. baseline silent install and first launch;
2. candidate silent upgrade with profile sentinel retention;
3. baseline rollback with retention;
4. uninstall removes app binaries, uninstaller, shortcuts, process, and uninstall entry while retaining profile;
5. candidate reinstall recovers the retained profile;
6. final uninstall repeats the cleanup and retention checks.

It never signs, publishes, sends, spends, or invokes a social/provider action.

## Current preflight artifacts

| Artifact | Bytes | SHA-256 | Authenticode |
|---|---:|---|---|
| beta18 Windows installer | 184572359 | `60660052b4b42a4d626ed35f63e0c9f34bbf7ae2594c2d4ab3aee1c804a4ca2f` | `NotSigned` |
| beta34 Windows installer | 185856383 | `a6e88e9882be0956a7b73f872640e00041ed4ad3264b21d7d07c8cc7b3f84a0d` | `NotSigned` |

Both tags are prereleases, so CMR-214 permits internal evaluation. The test does not authorize broad
distribution. A complete updater-channel proof additionally needs candidate blockmap and update
metadata; the lifecycle runner currently proves installer-over-installer upgrade and rollback.

## Example

Run first without `-Execute` under the clean Windows user. Use absolute paths outside source checkout
for artifacts and receipt. Only after preflight passes, set the one-process execution flag and repeat
with `-Execute`.

The current owner account is not eligible because it already has an Izzi AI profile, installation,
uninstall entry, and running processes. The machine has no usable Windows Sandbox or clean Hyper-V VM
in the current session. Therefore CMR-216 remains open after CMR-216A until an isolated user session
and then a clean VM/machine produce reviewed receipts.
