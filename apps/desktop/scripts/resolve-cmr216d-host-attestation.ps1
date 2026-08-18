param(
  [Parameter(Mandatory = $true)]
  [string]$ProvenancePath,
  [Parameter(Mandatory = $true)]
  [string]$ProvenanceSha256Path,
  [Parameter(Mandatory = $true)]
  [string]$LifecyclePath,
  [Parameter(Mandatory = $true)]
  [string]$CleanupReviewPath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVmName,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string]$ExpectedIsoSha256,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string]$ExpectedBundleManifestSha256,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{40}$')]
  [string]$ExpectedSourceCommit,
  [Parameter(Mandatory = $true)]
  [int]$ObservedVmGeneration,
  [Parameter(Mandatory = $true)]
  [bool]$ObservedSecureBootEnabled,
  [Parameter(Mandatory = $true)]
  [bool]$ObservedTpmEnabled,
  [Parameter(Mandatory = $true)]
  [int[]]$NetworkAdapterSamples
)

$ErrorActionPreference = 'Stop'

function Read-JsonFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing." }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch {
    throw "$Label is not valid JSON."
  }
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) { throw "$Label mismatch." }
}

$provenance = Read-JsonFile $ProvenancePath 'Host provenance'
$declaredProvenanceSha256 = (Get-Content -LiteralPath $ProvenanceSha256Path -Raw).Trim().ToLowerInvariant()
if ($declaredProvenanceSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'Host provenance digest is invalid.'
}
$observedProvenanceSha256 = (Get-FileHash -LiteralPath $ProvenancePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($declaredProvenanceSha256 -ne $observedProvenanceSha256) {
  throw 'Host provenance digest mismatch.'
}

Assert-Equal $provenance.schemaVersion 1 'Host provenance schema version'
Assert-Equal $provenance.task 'CMR-216D' 'Host provenance task'
Assert-Equal $provenance.vmName $ExpectedVmName 'Host provenance VM name'
Assert-Equal $provenance.vmGeneration $ObservedVmGeneration 'Host provenance VM generation'
Assert-Equal $provenance.vmNetworkAdapterCount 0 'Host provenance network adapter count'
Assert-Equal $provenance.secureBootEnabled $ObservedSecureBootEnabled 'Host provenance Secure Boot state'
Assert-Equal $provenance.tpmEnabled $ObservedTpmEnabled 'Host provenance TPM state'
Assert-Equal $provenance.vhdCreatedFresh $true 'Host provenance fresh VHD state'
Assert-Equal ([string]$provenance.isoSha256).ToLowerInvariant() $ExpectedIsoSha256.ToLowerInvariant() 'Host provenance ISO digest'
Assert-Equal ([string]$provenance.bundleManifestSha256).ToLowerInvariant() $ExpectedBundleManifestSha256.ToLowerInvariant() 'Host provenance bundle digest'
if ([string]$provenance.sourceCommit -ne $ExpectedSourceCommit.ToLowerInvariant()) {
  throw 'Host provenance source commit mismatch.'
}

if ($NetworkAdapterSamples.Count -lt 2 -or @($NetworkAdapterSamples | Where-Object { $_ -ne 0 }).Count -ne 0) {
  throw 'Host network isolation was not continuously observed.'
}

$lifecycle = Read-JsonFile $LifecyclePath 'Guest lifecycle receipt'
$review = Read-JsonFile $CleanupReviewPath 'Guest cleanup review'
if ($lifecycle.status -ne 'pass') { throw 'Guest lifecycle status is not pass.' }
if ($lifecycle.verifiedEvidenceTier -ne 'CleanMachineClaimed') { throw 'Guest lifecycle candidate tier is invalid.' }
if ($lifecycle.claim -ne 'host-attestation-required') { throw 'Guest lifecycle claim is invalid.' }
if ($lifecycle.networkIsolationVerified -ne $false) { throw 'Guest lifecycle cannot self-verify network isolation.' }
if ($lifecycle.hostProvenanceSha256 -ne $observedProvenanceSha256) { throw 'Guest lifecycle provenance binding mismatch.' }
if ($lifecycle.providerMutationPerformed -ne $false) { throw 'Guest lifecycle reported provider mutation.' }

if ($review.lifecycleStatus -ne 'pass') { throw 'Guest cleanup lifecycle status is not pass.' }
if ($review.verifiedEvidenceTier -ne 'CleanMachineClaimed') { throw 'Guest cleanup candidate tier is invalid.' }
if ($review.claim -ne 'host-attestation-required') { throw 'Guest cleanup claim is invalid.' }
if ($review.activeNetworkAdapterCount -ne 0) { throw 'Guest cleanup network isolation check failed.' }
if ($review.hostProvenanceSha256 -ne $observedProvenanceSha256) { throw 'Guest cleanup provenance binding mismatch.' }
if ($review.providerMutationPerformed -ne $false) { throw 'Guest cleanup reported provider mutation.' }

[pscustomobject]@{
  ok = $true
  verifiedEvidenceTier = 'CleanMachineVerified'
  claim = 'independent-clean-vm'
  networkIsolationVerified = $true
  hostProvenanceSha256 = $observedProvenanceSha256
  networkObservationCount = $NetworkAdapterSamples.Count
} | ConvertTo-Json -Compress
