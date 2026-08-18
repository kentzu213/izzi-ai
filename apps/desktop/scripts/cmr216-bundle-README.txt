CMR-216 CLEAN-HOST LIFECYCLE

This bundle is for an unused isolated Windows user or a clean Windows VM/machine.
It must not be run from an account with an existing Izzi AI installation or profile.

1. Run START-PREFLIGHT.cmd first.
2. Read C:\CMR216\evidence\preflight.json.
3. Only if preflight status is preflight_pass, run START-LIFECYCLE.cmd.
4. Read C:\CMR216\evidence\lifecycle.json.

The lifecycle installs the baseline, launches it, upgrades to the candidate,
rolls back, uninstalls, reinstalls the candidate, and performs a final uninstall.
The Izzi AI profile is intentionally retained for review.

Do not add, remove, rename, or edit files in this bundle. Verification fails
when the inventory or any SHA-256 changes.

If the extracted bundle is placed in a shared folder, grant the test user
read/execute only and keep write access with the operator/administrator. If
ACLs cannot be checked, use a private local folder on the test user instead.

This bundle does not prove a clean machine by itself. Independent VM/host
provenance review is required before CMR-216 can be closed.

For a clean VM claim, run the PowerShell launcher with EnvironmentClass
CleanMachineClaimed and HostProvenanceSha256 set to the reviewed host receipt
digest. The guest can emit only CleanMachineClaimed candidate evidence and must
observe zero active network adapters throughout the lifecycle. A separate host
collector must recompute and review provenance, observe the VM with zero network
adapters before, during, and after execution, and only then emit
CleanMachineVerified evidence. Failed lifecycle receipts are always Unverified.
