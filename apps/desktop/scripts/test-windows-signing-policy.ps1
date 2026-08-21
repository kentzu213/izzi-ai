$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "verify-windows-signing-policy.ps1"
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("izzi-signing-policy-" + [Guid]::NewGuid().ToString("N") + ".exe")
$checks = 0
try {
  [IO.File]::WriteAllBytes($fixture, [byte[]](0x4D, 0x5A, 0x00, 0x00))
  $overrideRejected = $false
  try { & $script -Tag "v1.14.0" -InstallerPath $fixture -ObservedStatus Valid | Out-Null } catch { $overrideRejected = $_.Exception.Message -match "restricted" }
  if (-not $overrideRejected) { throw "ObservedStatus override was not restricted" }
  $checks += 1
  $env:CMR214_SIGNING_POLICY_SELF_TEST = "true"
  $pre = & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus NotSigned | ConvertFrom-Json
  if (-not $pre.ok -or $pre.broadDistributionAllowed -ne $false) { throw "Unsigned prerelease policy mismatch" }
  $checks += 1
  # Default (no opt-in): an unsigned prerelease stays a draft.
  if ($pre.publishAllowed -ne $false -or $pre.unsignedPublishOptIn -ne $false) { throw "Unsigned prerelease publish default mismatch" }
  $checks += 1
  $optIn = & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus NotSigned -UnsignedPrereleaseOptIn "true" | ConvertFrom-Json
  if (-not $optIn.ok -or $optIn.publishAllowed -ne $true -or $optIn.unsignedPublishOptIn -ne $true) { throw "Unsigned prerelease opt-in publish mismatch" }
  if ($optIn.channel -ne "prerelease-internal") { throw "Unsigned prerelease opt-in channel mismatch" }
  if ($optIn.broadDistributionAllowed -ne $false) { throw "Unsigned prerelease opt-in must not allow broad distribution" }
  $checks += 1
  foreach ($value in @("", "false", "maybe", "1")) {
    $notOptedIn = & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus NotSigned -UnsignedPrereleaseOptIn $value | ConvertFrom-Json
    if ($notOptedIn.publishAllowed -ne $false) { throw "Opt-in value '$value' must not enable publication" }
  }
  $checks += 1
  $signedStable = & $script -Tag "v1.14.0" -InstallerPath $fixture -ObservedStatus Valid | ConvertFrom-Json
  if (-not $signedStable.ok -or $signedStable.channel -ne "stable" -or $signedStable.broadDistributionAllowed -ne $true) { throw "Signed stable policy mismatch" }
  if ($signedStable.publishAllowed -ne $true) { throw "Signed stable release must publish" }
  $checks += 1
  $signedPre = & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus Valid | ConvertFrom-Json
  if ($signedPre.channel -ne "prerelease" -or $signedPre.publishAllowed -ne $true) { throw "Signed prerelease policy mismatch" }
  $checks += 1
  $stableRejected = $false
  try { & $script -Tag "v1.14.0" -InstallerPath $fixture -ObservedStatus NotSigned | Out-Null } catch { $stableRejected = $_.Exception.Message -match "requires Authenticode" }
  if (-not $stableRejected) { throw "Unsigned stable release was not rejected" }
  $checks += 1
  # The opt-in is prerelease-only: it must never bypass stable Authenticode.
  $stableOptInRejected = $false
  try { & $script -Tag "v1.14.0" -InstallerPath $fixture -ObservedStatus NotSigned -UnsignedPrereleaseOptIn "true" | Out-Null } catch { $stableOptInRejected = $_.Exception.Message -match "requires Authenticode" }
  if (-not $stableOptInRejected) { throw "Unsigned stable release was not rejected under opt-in" }
  $checks += 1
  $invalidRejected = $false
  try { & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus HashMismatch | Out-Null } catch { $invalidRejected = $_.Exception.Message -match "invalid signature state" }
  if (-not $invalidRejected) { throw "Invalid prerelease signature was not rejected" }
  $checks += 1
  $invalidOptInRejected = $false
  try { & $script -Tag "v1.14.0-beta.35" -InstallerPath $fixture -ObservedStatus NotTrusted -UnsignedPrereleaseOptIn "true" | Out-Null } catch { $invalidOptInRejected = $_.Exception.Message -match "invalid signature state" }
  if (-not $invalidOptInRejected) { throw "Invalid prerelease signature was not rejected under opt-in" }
  $checks += 1
  [pscustomobject]@{ ok = $true; checks = $checks } | ConvertTo-Json -Compress
} finally {
  Remove-Item Env:CMR214_SIGNING_POLICY_SELF_TEST -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
}
