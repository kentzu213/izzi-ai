param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('WorkstationIsolated', 'CleanMachineClaimed')]
  [string]$EnvironmentClass,
  [string]$HostProvenanceSha256 = '',
  [Parameter(Mandatory = $true)]
  [ValidateRange(0, 2147483647)]
  [int]$ActiveNetworkAdapterCount
)

$ErrorActionPreference = 'Stop'
$provenance = $HostProvenanceSha256.Trim().ToLowerInvariant()

if ($EnvironmentClass -eq 'WorkstationIsolated') {
  if (-not [string]::IsNullOrWhiteSpace($provenance)) {
    throw 'Workstation evidence cannot include clean-machine provenance.'
  }
  [pscustomobject]@{
    verifiedEvidenceTier = 'WorkstationIsolated'
    claim = 'same-workstation-isolated-user'
    networkIsolationVerified = $false
    hostProvenanceSha256 = $null
  } | ConvertTo-Json -Compress
  exit 0
}

if ($provenance -notmatch '^[a-f0-9]{64}$') {
  throw 'Clean-machine evidence requires a valid host provenance SHA-256.'
}
if ($ActiveNetworkAdapterCount -ne 0) {
  throw 'Clean-machine evidence requires verified network isolation with zero active adapters.'
}

[pscustomobject]@{
  verifiedEvidenceTier = 'CleanMachineClaimed'
  claim = 'host-attestation-required'
  networkIsolationVerified = $false
  hostProvenanceSha256 = $provenance
} | ConvertTo-Json -Compress
