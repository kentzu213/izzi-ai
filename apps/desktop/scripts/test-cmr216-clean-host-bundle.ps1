$ErrorActionPreference = "Stop"
$builder = Join-Path $PSScriptRoot "build-cmr216-clean-host-bundle.ps1"
$verifier = Join-Path $PSScriptRoot "verify-cmr216-clean-host-bundle.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ("cmr216-bundle-contract-" + [Guid]::NewGuid().ToString("N"))
$source = Join-Path $root "source"
$bundle = Join-Path $root "bundle"
$baseline = Join-Path $source "baseline.exe"
$candidate = Join-Path $source "candidate.exe"
$receipt = Join-Path $root "receipt.json"
$appData = Join-Path $root "appdata"
$localAppData = Join-Path $root "localappdata"
$installRoot = Join-Path $root "CMR216-install"
$checks = 0

function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
  $failed = $false
  $observed = ''
  try { & $Action | Out-Null } catch {
    $observed = $_.Exception.Message
    $failed = $observed -match $Pattern
  }
  if (-not $failed) { throw "Expected failure matching '$Pattern'; observed '$observed'." }
  $script:checks += 1
}

try {
  New-Item -ItemType Directory -Force -Path $source, $appData, $localAppData | Out-Null
  [IO.File]::WriteAllBytes($baseline, [byte[]](0x4D, 0x5A, 0x18, 0x18))
  [IO.File]::WriteAllBytes($candidate, [byte[]](0x4D, 0x5A, 0x34, 0x34))
  $baselineHash = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant()
  $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  $buildArguments = @{
    BaselineInstallerPath = $baseline
    BaselineTag = "v1.14.0-beta.18"
    BaselineSha256 = $baselineHash
    CandidateInstallerPath = $candidate
    CandidateTag = "v1.14.0-beta.34"
    CandidateSha256 = $candidateHash
    OutputDirectory = $bundle
    SkipArchive = $true
  }

  $built = & $builder @buildArguments | ConvertFrom-Json
  if (-not $built.ok -or $built.fileCount -ne 11 -or -not (Test-Path -LiteralPath $built.manifestPath)) {
    throw "Bundle build contract mismatch"
  }
  $checks += 1

  $verified = & $verifier -BundleDirectory $bundle | ConvertFrom-Json
  if (-not $verified.ok -or $verified.fileCount -ne 11 -or $verified.baselineTag -ne "v1.14.0-beta.18" -or $verified.candidateTag -ne "v1.14.0-beta.34") {
    throw "Bundle verification contract mismatch"
  }
  $checks += 1

  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $windowsVerifiedProcess = Start-Process -FilePath $windowsPowerShell -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $verifier), '-BundleDirectory', ('"{0}"' -f $bundle)
  ) -WindowStyle Hidden -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $root 'windows-verifier.stdout.log') `
    -RedirectStandardError (Join-Path $root 'windows-verifier.stderr.log')
  $windowsVerifiedOutput = Get-Content -LiteralPath (Join-Path $root 'windows-verifier.stdout.log') -Raw
  if ($windowsVerifiedProcess.ExitCode -ne 0 -or -not ($windowsVerifiedOutput | ConvertFrom-Json).ok) {
    throw "Bundle verifier must run under machine-wide Windows PowerShell 5.1."
  }
  $checks += 1

  $env:CMR216_LIFECYCLE_SELF_TEST = "true"
  $env:CMR214_SIGNING_POLICY_SELF_TEST = "true"
  $launcher = Join-Path $bundle "run-cmr216-clean-host-bundle.ps1"
  $launched = & $launcher `
    -InstallRoot $installRoot `
    -ReceiptPath $receipt `
    -EnvironmentClass WorkstationIsolated `
    -AppDataRoot $appData `
    -LocalAppDataRoot $localAppData `
    -ExpectedUser ([Environment]::UserName) | ConvertFrom-Json
  if (-not $launched.ok -or $launched.verifiedEvidenceTier -ne "ContractOnly") {
    throw "Bundle launcher preflight mismatch"
  }
  $checks += 1

  Remove-Item Env:CMR216_LIFECYCLE_EXECUTE -ErrorAction SilentlyContinue
  Expect-Failure {
    & $launcher -InstallRoot $installRoot -ReceiptPath $receipt -EnvironmentClass WorkstationIsolated `
      -AppDataRoot $appData -LocalAppDataRoot $localAppData -ExpectedUser ([Environment]::UserName) -Execute
  } "CMR216_LIFECYCLE_EXECUTE"

  [IO.File]::WriteAllBytes((Join-Path $bundle "artifacts\candidate.exe"), [byte[]](0x4D, 0x5A, 0x00))
  Expect-Failure { & $verifier -BundleDirectory $bundle } "SHA-256"
  Copy-Item -LiteralPath $candidate -Destination (Join-Path $bundle "artifacts\candidate.exe") -Force

  Set-Content -LiteralPath (Join-Path $bundle "unexpected.txt") -Value "unexpected" -Encoding ASCII
  Expect-Failure { & $verifier -BundleDirectory $bundle } "inventory"
  Remove-Item -LiteralPath (Join-Path $bundle "unexpected.txt") -Force

  $launcherPath = Join-Path $bundle "run-cmr216-clean-host-bundle.ps1"
  $launcherBytes = [IO.File]::ReadAllBytes($launcherPath)
  Remove-Item -LiteralPath $launcherPath -Force
  Expect-Failure { & $verifier -BundleDirectory $bundle } "inventory"
  [IO.File]::WriteAllBytes($launcherPath, $launcherBytes)

  $manifestPath = Join-Path $bundle "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifest.baseline.file = "../baseline.exe"
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Expect-Failure { & $verifier -BundleDirectory $bundle } "relative path"

  $secondBundle = Join-Path $root "second-bundle"
  New-Item -ItemType Directory -Force -Path $secondBundle | Out-Null
  Set-Content -LiteralPath (Join-Path $secondBundle "owned.txt") -Value "owned" -Encoding ASCII
  $nonEmptyArguments = $buildArguments.Clone()
  $nonEmptyArguments.OutputDirectory = $secondBundle
  Expect-Failure { & $builder @nonEmptyArguments } "empty"

  $archiveBundle = Join-Path $root "CMR216-archive-bundle"
  $archiveArguments = $buildArguments.Clone()
  $archiveArguments.OutputDirectory = $archiveBundle
  $archiveArguments.Remove('SkipArchive')
  $archived = & $builder @archiveArguments | ConvertFrom-Json
  if (
    -not $archived.ok -or
    -not (Test-Path -LiteralPath $archived.archivePath -PathType Leaf) -or
    (Get-FileHash -LiteralPath $archived.archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archived.archiveSha256
  ) { throw "Bundle archive contract mismatch" }
  $archiveExtract = Join-Path $root "CMR216-archive-extracted"
  Expand-Archive -LiteralPath $archived.archivePath -DestinationPath $archiveExtract
  $archiveVerified = & (Join-Path $archiveExtract "verify-cmr216-clean-host-bundle.ps1") `
    -BundleDirectory $archiveExtract | ConvertFrom-Json
  if (-not $archiveVerified.ok -or $archiveVerified.manifestSha256 -ne $archived.manifestSha256) {
    throw "Extracted archive verification mismatch"
  }
  $checks += 1

  [pscustomobject]@{ ok = $true; checks = $checks } | ConvertTo-Json -Compress
} finally {
  Remove-Item Env:CMR216_LIFECYCLE_EXECUTE -ErrorAction SilentlyContinue
  Remove-Item Env:CMR216_LIFECYCLE_SELF_TEST -ErrorAction SilentlyContinue
  Remove-Item Env:CMR214_SIGNING_POLICY_SELF_TEST -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
