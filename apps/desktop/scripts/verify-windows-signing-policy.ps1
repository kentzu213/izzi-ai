param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$Tag,
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [ValidateSet("Auto", "Valid", "NotSigned", "HashMismatch", "NotTrusted", "UnknownError")]
  [string]$ObservedStatus = "Auto",
  # Explicit opt-in for publishing an unsigned prerelease. Only the literal
  # "true" opts in; every other value keeps the release a draft.
  [string]$UnsignedPrereleaseOptIn = ""
)

$ErrorActionPreference = "Stop"
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$selfTest = $env:CMR214_SIGNING_POLICY_SELF_TEST -eq "true"
if ($ObservedStatus -ne "Auto" -and -not $selfTest) {
  throw "ObservedStatus override is restricted to the signing-policy self-test."
}
$status = if ($ObservedStatus -eq "Auto") {
  (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
} else {
  $ObservedStatus
}
$isPrerelease = $Tag.Contains('-')
$unsignedPublishOptIn = $UnsignedPrereleaseOptIn.Trim() -eq "true"

if ($status -eq "Valid") {
  [pscustomobject]@{
    ok = $true
    tag = $Tag
    channel = $(if ($isPrerelease) { "prerelease" } else { "stable" })
    signature = $status
    broadDistributionAllowed = $true
    unsignedPublishOptIn = $unsignedPublishOptIn
    publishAllowed = $true
  } |
    ConvertTo-Json -Compress
  exit 0
}
if (-not $isPrerelease) {
  throw "Stable Windows release $Tag requires Authenticode status Valid; observed $status."
}
if ($status -ne "NotSigned") {
  throw "Prerelease Windows installer has an invalid signature state: $status."
}

$warning = if ($unsignedPublishOptIn) {
  "Unsigned prerelease published under an explicit opt-in; internal evaluation only."
} else {
  "Unsigned prerelease; internal evaluation only."
}

[pscustomobject]@{
  ok = $true
  tag = $Tag
  channel = "prerelease-internal"
  signature = "NotSigned"
  broadDistributionAllowed = $false
  unsignedPublishOptIn = $unsignedPublishOptIn
  publishAllowed = $unsignedPublishOptIn
  warning = $warning
} | ConvertTo-Json -Compress
