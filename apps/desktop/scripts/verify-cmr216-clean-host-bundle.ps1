param(
  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory
)

$ErrorActionPreference = "Stop"
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$manifestPath = Join-Path $bundle "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "CMR-216 bundle inventory is missing manifest.json."
}

function Assert-ExactKeys([hashtable]$Value, [string[]]$Expected, [string]$Label) {
  $actual = @($Value.Keys | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (($actual -join "`n") -ne ($wanted -join "`n")) {
    throw "$Label keys do not match the bundle schema."
  }
}

function ConvertTo-Hashtable($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) { $table[[string]$key] = ConvertTo-Hashtable $Value[$key] }
    return $table
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-Hashtable $property.Value
    }
    return $table
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    return @($Value | ForEach-Object { ConvertTo-Hashtable $_ })
  }
  return $Value
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = $algorithm.ComputeHash($stream) } finally { $algorithm.Dispose() }
  } finally {
    $stream.Dispose()
  }
  return [BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()
}

function Resolve-BundleFile([string]$RelativePath) {
  if (
    [string]::IsNullOrWhiteSpace($RelativePath) -or
    [IO.Path]::IsPathRooted($RelativePath) -or
    $RelativePath.Contains('..') -or
    $RelativePath.Contains('\')
  ) {
    throw "Bundle file must use a contained forward-slash relative path."
  }
  $candidate = [IO.Path]::GetFullPath((Join-Path $bundle ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)))
  $prefix = $bundle + [IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Bundle file escaped the bundle directory."
  }
  return $candidate
}

$manifest = ConvertTo-Hashtable (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
Assert-ExactKeys $manifest @('schemaVersion', 'task', 'generatedAt', 'baseline', 'candidate', 'files') "Manifest"
if ($manifest.schemaVersion -ne 1 -or $manifest.task -ne 'CMR-216') {
  throw "Bundle manifest identity is invalid."
}
foreach ($name in @('baseline', 'candidate')) {
  Assert-ExactKeys $manifest[$name] @('tag', 'file', 'sha256') "$name artifact"
  if ([string]$manifest[$name].tag -notmatch '^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "$name tag is invalid."
  }
  if ([string]$manifest[$name].sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "$name SHA-256 is invalid."
  }
}
if ($manifest.baseline.tag -eq $manifest.candidate.tag -or $manifest.baseline.sha256 -eq $manifest.candidate.sha256) {
  throw "Baseline and candidate bundle artifacts must differ."
}
if ($manifest.baseline.file -ne 'artifacts/baseline.exe' -or $manifest.candidate.file -ne 'artifacts/candidate.exe') {
  throw "Artifact relative path does not match the fixed bundle contract."
}

$expectedFiles = @(
  'artifacts/baseline.exe',
  'artifacts/candidate.exe',
  'README.txt',
  'START-LIFECYCLE.cmd',
  'START-PREFLIGHT.cmd',
  'invoke-cmr216-clean-host-lifecycle.ps1',
  'resolve-cmr216-evidence-classification.ps1',
  'manifest.json',
  'run-cmr216-clean-host-bundle.ps1',
  'verify-cmr216-clean-host-bundle.ps1',
  'verify-windows-signing-policy.ps1'
)
$actualFiles = @(Get-ChildItem -LiteralPath $bundle -Recurse -File | ForEach-Object {
  $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')
} | Sort-Object)
if (($actualFiles -join "`n") -ne (($expectedFiles | Sort-Object) -join "`n")) {
  throw "CMR-216 bundle inventory has missing or unexpected files."
}

$fileRows = @($manifest.files)
if ($fileRows.Count -ne 10) { throw "Manifest file inventory count is invalid." }
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($row in $fileRows) {
  if ($row -isnot [hashtable]) { throw "Manifest file inventory row is invalid." }
  Assert-ExactKeys $row @('path', 'sha256') "Manifest file row"
  $relativePath = [string]$row.path
  if ($relativePath -eq 'manifest.json' -or $relativePath -notin $expectedFiles) {
    throw "Manifest file inventory path is invalid."
  }
  if (-not $seen.Add($relativePath)) { throw "Manifest file inventory contains a duplicate path." }
  if ([string]$row.sha256 -notmatch '^[a-f0-9]{64}$') { throw "Manifest file SHA-256 is invalid." }
  $fullPath = Resolve-BundleFile $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Bundle inventory file is missing." }
  $observed = Get-Sha256 $fullPath
  if ($observed -ne [string]$row.sha256) { throw "Bundle file SHA-256 mismatch: $relativePath" }
}
if ($seen.Count -ne 10) { throw "Manifest file inventory is incomplete." }
if ($manifest.baseline.sha256 -ne ($fileRows | Where-Object path -eq $manifest.baseline.file).sha256) {
  throw "Baseline SHA-256 is not bound to the file inventory."
}
if ($manifest.candidate.sha256 -ne ($fileRows | Where-Object path -eq $manifest.candidate.file).sha256) {
  throw "Candidate SHA-256 is not bound to the file inventory."
}

[pscustomobject]@{
  ok = $true
  task = 'CMR-216'
  fileCount = $actualFiles.Count
  baselineTag = $manifest.baseline.tag
  candidateTag = $manifest.candidate.tag
  manifestSha256 = Get-Sha256 $manifestPath
} | ConvertTo-Json -Compress
