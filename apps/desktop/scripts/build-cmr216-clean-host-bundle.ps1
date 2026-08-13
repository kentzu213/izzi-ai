param(
  [Parameter(Mandatory = $true)]
  [string]$BaselineInstallerPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$BaselineTag,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string]$BaselineSha256,
  [Parameter(Mandatory = $true)]
  [string]$CandidateInstallerPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$CandidateTag,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string]$CandidateSha256,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [switch]$SkipArchive
)

$ErrorActionPreference = "Stop"
$baseline = (Resolve-Path -LiteralPath $BaselineInstallerPath).Path
$candidate = (Resolve-Path -LiteralPath $CandidateInstallerPath).Path
$output = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($output -notmatch '(?i)(^|[\\/])cmr216(?:[^\\/]*)?([\\/]|$)') {
  throw "OutputDirectory must be under a clearly named CMR216 directory."
}
if (Test-Path -LiteralPath $output) {
  if ((Get-Item -LiteralPath $output).PSIsContainer -ne $true) { throw "OutputDirectory must be a directory." }
  if (Get-ChildItem -LiteralPath $output -Force | Select-Object -First 1) {
    throw "OutputDirectory must be empty."
  }
} else {
  New-Item -ItemType Directory -Path $output | Out-Null
}

$baselineObserved = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant()
$candidateObserved = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
if ($baselineObserved -ne $BaselineSha256.ToLowerInvariant()) { throw "Baseline installer SHA-256 mismatch." }
if ($candidateObserved -ne $CandidateSha256.ToLowerInvariant()) { throw "Candidate installer SHA-256 mismatch." }
if ($baselineObserved -eq $candidateObserved -or $BaselineTag -eq $CandidateTag) {
  throw "Baseline and candidate artifacts must differ."
}

$artifactDirectory = Join-Path $output 'artifacts'
New-Item -ItemType Directory -Path $artifactDirectory | Out-Null
Copy-Item -LiteralPath $baseline -Destination (Join-Path $artifactDirectory 'baseline.exe')
Copy-Item -LiteralPath $candidate -Destination (Join-Path $artifactDirectory 'candidate.exe')
foreach ($name in @(
  'cmr216-bundle-README.txt',
  'cmr216-bundle-START-LIFECYCLE.cmd',
  'cmr216-bundle-START-PREFLIGHT.cmd',
  'invoke-cmr216-clean-host-lifecycle.ps1',
  'resolve-cmr216-evidence-classification.ps1',
  'run-cmr216-clean-host-bundle.ps1',
  'verify-cmr216-clean-host-bundle.ps1',
  'verify-windows-signing-policy.ps1'
)) {
  $destinationName = $name -replace '^cmr216-bundle-', ''
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $output $destinationName)
}

$inventoryPaths = @(
  'artifacts/baseline.exe',
  'artifacts/candidate.exe',
  'README.txt',
  'START-LIFECYCLE.cmd',
  'START-PREFLIGHT.cmd',
  'invoke-cmr216-clean-host-lifecycle.ps1',
  'resolve-cmr216-evidence-classification.ps1',
  'run-cmr216-clean-host-bundle.ps1',
  'verify-cmr216-clean-host-bundle.ps1',
  'verify-windows-signing-policy.ps1'
)
$fileRows = @($inventoryPaths | ForEach-Object {
  $fullPath = Join-Path $output ($_ -replace '/', [IO.Path]::DirectorySeparatorChar)
  [ordered]@{
    path = $_
    sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
})
$manifest = [ordered]@{
  schemaVersion = 1
  task = 'CMR-216'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  baseline = [ordered]@{ tag = $BaselineTag; file = 'artifacts/baseline.exe'; sha256 = $baselineObserved }
  candidate = [ordered]@{ tag = $CandidateTag; file = 'artifacts/candidate.exe'; sha256 = $candidateObserved }
  files = $fileRows
}
$manifestPath = Join-Path $output 'manifest.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$verification = & (Join-Path $output 'verify-cmr216-clean-host-bundle.ps1') -BundleDirectory $output |
  ConvertFrom-Json
if (-not $verification.ok) { throw "Generated CMR-216 bundle did not verify." }

$archivePath = $null
if (-not $SkipArchive) {
  $archivePath = "$output.zip"
  if (Test-Path -LiteralPath $archivePath) { throw "Bundle archive path already exists." }
  Compress-Archive -Path (Join-Path $output '*') -DestinationPath $archivePath -CompressionLevel Optimal
}
[pscustomobject]@{
  ok = $true
  bundleDirectory = $output
  manifestPath = $manifestPath
  manifestSha256 = $verification.manifestSha256
  archivePath = $archivePath
  archiveSha256 = $(if ($archivePath) { (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
  fileCount = $verification.fileCount
} | ConvertTo-Json -Compress
