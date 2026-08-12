param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$Tag,
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [ValidateSet("Auto", "Valid", "NotSigned", "HashMismatch", "NotTrusted", "UnknownError")]
  [string]$ObservedStatus = "Auto"
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

if ($status -eq "Valid") {
  [pscustomobject]@{
    ok = $true
    tag = $Tag
    channel = $(if ($isPrerelease) { "prerelease" } else { "stable" })
    signature = $status
    broadDistributionAllowed = $true
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

[pscustomobject]@{
  ok = $true
  tag = $Tag
  channel = "prerelease-internal"
  signature = "NotSigned"
  broadDistributionAllowed = $false
  warning = "Unsigned prerelease; internal evaluation only."
} | ConvertTo-Json -Compress
