$ErrorActionPreference = 'Stop'
$resolver = Join-Path $PSScriptRoot 'resolve-cmr216d-host-attestation.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('cmr216e-attestation-' + [Guid]::NewGuid().ToString('N'))
$provenancePath = Join-Path $root 'host-provenance.json'
$provenanceShaPath = Join-Path $root 'host-provenance.sha256'
$lifecyclePath = Join-Path $root 'lifecycle.json'
$reviewPath = Join-Path $root 'cleanup-review.json'
$sourceCommit = 'd7e1533430d05f64b50dd90f07e37099dc086ac9'
$isoSha256 = 'a61adeab895ef5a4db436e0a7011c92a2ff17bb0357f58b13bbc4062e535e7b9'
$bundleSha256 = 'd265e412bca7c59fd0b7167075d0889e167851dc7aed60e8c9f46e114b20780c'
$checks = 0

function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
  $observed = ''
  try { & $Action | Out-Null } catch { $observed = $_.Exception.Message }
  if ($observed -notmatch $Pattern) {
    throw "Expected failure matching '$Pattern'; observed '$observed'."
  }
  $script:checks += 1
}

function Write-Json([string]$Path, $Value) {
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $provenance = [ordered]@{
    schemaVersion = 1
    task = 'CMR-216D'
    createdAt = '2026-08-18T00:00:00.0000000Z'
    vmName = 'IzziAI-CMR216D-Clean'
    vmGeneration = 2
    vmNetworkAdapterCount = 0
    secureBootEnabled = $true
    tpmEnabled = $true
    vhdCreatedFresh = $true
    windowsImage = 'Windows 11 Enterprise Evaluation'
    windowsImageIndex = 1
    isoSha256 = $isoSha256
    bundleManifestSha256 = $bundleSha256
    sourceCommit = $sourceCommit
  }
  Write-Json $provenancePath $provenance
  $provenanceSha256 = (Get-FileHash -LiteralPath $provenancePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $provenanceShaPath -Value $provenanceSha256 -Encoding ASCII
  $lifecycle = [ordered]@{
    status = 'pass'
    verifiedEvidenceTier = 'CleanMachineClaimed'
    claim = 'host-attestation-required'
    networkIsolationVerified = $false
    hostProvenanceSha256 = $provenanceSha256
    providerMutationPerformed = $false
  }
  $review = [ordered]@{
    lifecycleStatus = 'pass'
    verifiedEvidenceTier = 'CleanMachineClaimed'
    claim = 'host-attestation-required'
    activeNetworkAdapterCount = 0
    hostProvenanceSha256 = $provenanceSha256
    providerMutationPerformed = $false
  }
  Write-Json $lifecyclePath $lifecycle
  Write-Json $reviewPath $review

  $common = @{
    ProvenancePath = $provenancePath
    ProvenanceSha256Path = $provenanceShaPath
    LifecyclePath = $lifecyclePath
    CleanupReviewPath = $reviewPath
    ExpectedVmName = 'IzziAI-CMR216D-Clean'
    ExpectedIsoSha256 = $isoSha256
    ExpectedBundleManifestSha256 = $bundleSha256
    ExpectedSourceCommit = $sourceCommit
    ObservedVmGeneration = 2
    ObservedSecureBootEnabled = $true
    ObservedTpmEnabled = $true
    NetworkAdapterSamples = @(0, 0, 0)
  }
  $result = & $resolver @common | ConvertFrom-Json
  if (
    -not $result.ok -or
    $result.verifiedEvidenceTier -ne 'CleanMachineVerified' -or
    $result.claim -ne 'independent-clean-vm' -or
    -not $result.networkIsolationVerified -or
    $result.hostProvenanceSha256 -ne $provenanceSha256 -or
    $result.networkObservationCount -ne 3
  ) { throw 'Host attestation success contract mismatch.' }
  $checks += 1

  Set-Content -LiteralPath $provenanceShaPath -Value ('0' * 64) -Encoding ASCII
  Expect-Failure { & $resolver @common } 'digest mismatch'
  Set-Content -LiteralPath $provenanceShaPath -Value $provenanceSha256 -Encoding ASCII

  $lifecycle.verifiedEvidenceTier = 'CleanMachineVerified'
  Write-Json $lifecyclePath $lifecycle
  Expect-Failure { & $resolver @common } 'candidate tier'
  $lifecycle.verifiedEvidenceTier = 'CleanMachineClaimed'
  Write-Json $lifecyclePath $lifecycle

  $lifecycle.status = 'fail'
  Write-Json $lifecyclePath $lifecycle
  Expect-Failure { & $resolver @common } 'lifecycle status'
  $lifecycle.status = 'pass'
  Write-Json $lifecyclePath $lifecycle

  $networkChanged = $common.Clone()
  $networkChanged.NetworkAdapterSamples = @(0, 1, 0)
  Expect-Failure { & $resolver @networkChanged } 'network isolation'

  $wrongSource = $common.Clone()
  $wrongSource.ExpectedSourceCommit = '0' * 40
  Expect-Failure { & $resolver @wrongSource } 'source commit'

  [pscustomobject]@{ ok = $true; checks = $checks } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
