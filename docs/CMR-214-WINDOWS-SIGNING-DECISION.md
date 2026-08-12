# CMR-214 Windows Signing Decision

Date: 2026-08-12
Decision: `DEFER_CERTIFICATE_INTERNAL_PRERELEASE_ONLY`

The installed beta34 executable and public Windows installer are `NotSigned`. No Windows signing
certificate is configured. To preserve the low-cost beta loop without presenting unsigned bytes as
trusted distribution, Izzi AI applies this policy:

- Hyphenated prerelease tags may build an unsigned Windows installer for internal evaluation, but
  the GitHub release remains a collaborator-only draft and is not published from the public repo.
- The GitHub Release notes record the signing channel, Authenticode status, and
  `broadDistributionAllowed=false` for an unsigned prerelease without changing the 12-asset contract.
- Stable tags require Authenticode status `Valid`; unsigned or invalid signature states stop CI.
- CI runs the five-case signing-policy self-test before packaging, then evaluates the actual installer.
- Local batch and PowerShell scripts build with `--publish never` and cannot bypass the GitHub release gate.
- Purchasing/importing a certificate remains a separate owner/billing action.

CMR-214 closes the decision and enforcement scope. It does not claim the current installer is signed,
does not waive SmartScreen warnings, and does not replace CMR-216 clean-machine lifecycle proof.

## Beta34 containment receipt

Before containment on 2026-08-12, GitHub reported `v1.14.0-beta.34` as a published prerelease.
The Windows installer was `NotSigned`; its observed download count was 1 and `latest.yml` was 9.
These counts describe asset requests, not unique users.

The release was then changed in place to a collaborator-only draft without deleting its tag or 12
assets. Its notes now record `channel=prerelease-internal`, `signature=NotSigned`, and
`broadDistributionAllowed=false`. Anonymous checks after containment established:

- `GET /repos/kentzu213/izzi-ai/releases/tags/v1.14.0-beta.34` returned `404`.
- The original public Windows installer URL returned `404`.
- The original public `latest.yml` updater URL returned `404`.
- The historical tag page returned `200` but exposed neither installer nor `latest.yml` links.

The installed beta34 remains available on the owner machine for internal evaluation. This receipt
does not treat it as signed or broadly distributable.
