$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "invoke-cmr216-clean-host-lifecycle.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ("cmr216-contract-" + [Guid]::NewGuid().ToString("N"))
$artifacts = Join-Path $root "artifacts"
$appData = Join-Path $root "appdata"
$localAppData = Join-Path $root "localappdata"
$installRoot = Join-Path $root "install"
$receipt = Join-Path $root "receipt.json"
$baseline = Join-Path $artifacts "Izzi-AI-1.14.0-beta.18-win-x64.exe"
$candidate = Join-Path $artifacts "Izzi-AI-1.14.0-beta.34-win-x64.exe"
$checks = 0

function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $_.Exception.Message -match $Pattern }
  if (-not $failed) { throw "Expected failure matching: $Pattern" }
  $script:checks += 1
}

try {
  $env:CMR216_LIFECYCLE_SELF_TEST = "true"
  $env:CMR214_SIGNING_POLICY_SELF_TEST = "true"
  New-Item -ItemType Directory -Force -Path $artifacts, $appData, $localAppData | Out-Null
  [IO.File]::WriteAllBytes($baseline, [byte[]](0x4D, 0x5A, 0x12, 0x18))
  [IO.File]::WriteAllBytes($candidate, [byte[]](0x4D, 0x5A, 0x34, 0x34))
  $baselineHash = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant()
  $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  $common = @{
    BaselineInstallerPath = $baseline
    BaselineTag = "v1.14.0-beta.18"
    BaselineSha256 = $baselineHash
    CandidateInstallerPath = $candidate
    CandidateTag = "v1.14.0-beta.34"
    CandidateSha256 = $candidateHash
    InstallRoot = $installRoot
    AppDataRoot = $appData
    LocalAppDataRoot = $localAppData
    ExpectedUser = [Environment]::UserName
    EnvironmentClass = "WorkstationIsolated"
    ReceiptPath = $receipt
  }

  $result = & $runner @common | ConvertFrom-Json
  if (
    -not $result.ok -or
    $result.mode -ne "preflight" -or
    $result.verifiedEvidenceTier -ne "ContractOnly" -or
    $result.claim -ne "synthetic-contract" -or
    $result.selfTest -ne $true
  ) {
    throw "Valid preflight contract mismatch"
  }
  $resultReceipt = Get-Content -LiteralPath $result.receiptPath -Raw | ConvertFrom-Json
  if (
    $resultReceipt.verifiedEvidenceTier -ne "ContractOnly" -or
    $resultReceipt.claim -ne "synthetic-contract" -or
    $resultReceipt.selfTest -ne $true -or
    $resultReceipt.localSystemMutationPerformed -ne $false -or
    $resultReceipt.cleanupAttempted -ne $false -or
    $resultReceipt.providerMutationPerformed -ne $false -or
    $resultReceipt.networkIsolationVerified -ne $false -or
    $null -ne $resultReceipt.userHash -or
    $null -ne $resultReceipt.error
  ) { throw "Synthetic receipt schema mismatch" }
  $checks += 1

  $claimedArguments = $common.Clone()
  $claimedArguments.EnvironmentClass = "CleanMachineClaimed"
  $claimed = & $runner @claimedArguments | ConvertFrom-Json
  if ($claimed.environmentClass -ne "CleanMachineClaimed" -or $claimed.verifiedEvidenceTier -ne "ContractOnly" -or $claimed.claim -ne "synthetic-contract") {
    throw "Runner elevated an operator environment claim"
  }
  $checks += 1

  Expect-Failure { & $runner @common -ExpectedUser "cmr216-not-current-user" } "ExpectedUser"
  Expect-Failure { & $runner @common -CandidateSha256 ("0" * 64) } "SHA-256"
  Expect-Failure { & $runner @common -CandidateInstallerPath $baseline -CandidateTag "v1.14.0-beta.34" -CandidateSha256 $baselineHash } "must differ"
  Expect-Failure { & $runner @common -CandidateTag "v1.14.0" } "Stable Windows"
  $unmarkedInstallRoot = Join-Path ([IO.Path]::GetTempPath()) ("izzi-lifecycle-" + [Guid]::NewGuid().ToString("N"))
  Expect-Failure { & $runner @common -InstallRoot $unmarkedInstallRoot } "CMR216 test directory"
  Expect-Failure { & $runner @common -ReceiptPath (Join-Path $localAppData "receipt.json") } "outside mutable"

  $profile = Join-Path $appData "@openclaw"
  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  Expect-Failure { & $runner @common } "pre-existing profile"
  Remove-Item -LiteralPath $profile -Recurse -Force

  Remove-Item Env:CMR216_LIFECYCLE_EXECUTE -ErrorAction SilentlyContinue
  Expect-Failure { & $runner @common -Execute } "CMR216_LIFECYCLE_EXECUTE"

  $unrelatedExecutable = Join-Path $installRoot "Izzi AI.exe"
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\ping.exe') -Destination $unrelatedExecutable
  $unrelatedProcess = Start-Process -FilePath $unrelatedExecutable `
    -ArgumentList @('-t', '127.0.0.1') -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 500
  $env:CMR216_LIFECYCLE_EXECUTE = "true"
  Expect-Failure { & $runner @common -Execute } "Self-test cannot execute"
  $executeDeniedReceipt = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($executeDeniedReceipt.cleanupAttempted -ne $false -or $executeDeniedReceipt.localSystemMutationPerformed -ne $false) {
    throw "Execute denial attempted cleanup without runner mutation"
  }
  if ($unrelatedProcess.HasExited) { throw "Execute denial stopped an unrelated process" }
  Stop-Process -Id $unrelatedProcess.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installRoot -Recurse -Force
  $checks += 1

  [pscustomobject]@{ ok = $true; checks = $checks } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $unrelatedProcess -and -not $unrelatedProcess.HasExited) {
    Stop-Process -Id $unrelatedProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:CMR216_LIFECYCLE_EXECUTE -ErrorAction SilentlyContinue
  Remove-Item Env:CMR216_LIFECYCLE_SELF_TEST -ErrorAction SilentlyContinue
  Remove-Item Env:CMR214_SIGNING_POLICY_SELF_TEST -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
