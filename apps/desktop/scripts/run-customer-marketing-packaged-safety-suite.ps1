param(
  [Parameter(Mandatory = $true)]
  [string]$PackagedAppRoot,
  [string]$ElectronPath = '',
  [string]$ProofDirectory = '',
  [string]$ReceiptPath = ''
)

$ErrorActionPreference = 'Stop'
$suiteVersion = 'mkt-04.v1'
$desktopRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$desktopNodeModules = (Resolve-Path -LiteralPath (Join-Path $desktopRoot 'node_modules')).Path

function Assert-Safety {
  param([bool]$Condition, [string]$Code)
  if (-not $Condition) { throw $Code }
}

function Get-Sha256 {
  param([string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Invoke-SafetyProcess {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [bool]$RunAsNode,
    [int]$TimeoutSeconds
  )
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in $Arguments) { [void]$start.ArgumentList.Add($argument) }
  foreach ($key in @($start.Environment.Keys)) {
    if ($key -match '(?i)(token|secret|password|api_key|authorization|cookie)') {
      [void]$start.Environment.Remove($key)
    }
  }
  if ($RunAsNode) {
    $start.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $start.Environment['NODE_PATH'] = $desktopNodeModules
  } else {
    [void]$start.Environment.Remove('ELECTRON_RUN_AS_NODE')
    [void]$start.Environment.Remove('NODE_PATH')
  }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  Assert-Safety -Condition $process.Start() -Code 'mkt04-process-start-failed'
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill($true) } catch { }
    throw 'mkt04-process-timeout'
  }
  return [ordered]@{
    exitCode = $process.ExitCode
    stdout = $stdoutTask.GetAwaiter().GetResult()
    stderr = $stderrTask.GetAwaiter().GetResult()
  }
}

function ConvertFrom-SafetyReceipt {
  param([string]$Output, [string]$Code)
  try {
    $lines = @($Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    Assert-Safety -Condition ($lines.Count -gt 0) -Code $Code
    return $lines[-1] | ConvertFrom-Json
  } catch {
    throw $Code
  }
}

$failureCode = 'mkt04-runner-failed'
$resolvedReceipt = $null
$observedExternalActions = $null
$observedNetworkAttempts = $null
$observedSecretLeakCount = $null
try {
  $resolvedPackagedRoot = (Resolve-Path -LiteralPath $PackagedAppRoot).Path
  $packagedExecutable = Join-Path $resolvedPackagedRoot 'Izzi AI.exe'
  $appAsar = Join-Path $resolvedPackagedRoot 'resources\app.asar'
  $coreHarness = Join-Path $PSScriptRoot 'customer-marketing-packaged-safety-harness.cjs'
  $uiHarness = Join-Path $PSScriptRoot 'customer-marketing-packaged-ui-smoke.cjs'
  $uiPreload = Join-Path $PSScriptRoot 'customer-marketing-packaged-ui-preload.cjs'
  if ([string]::IsNullOrWhiteSpace($ElectronPath)) {
    $ElectronPath = Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'
  }
  $resolvedElectron = (Resolve-Path -LiteralPath $ElectronPath).Path
  foreach ($requiredPath in @($packagedExecutable, $appAsar, $coreHarness, $uiHarness, $uiPreload)) {
    Assert-Safety -Condition (Test-Path -LiteralPath $requiredPath -PathType Leaf) -Code 'mkt04-required-input-missing'
  }
  if ([string]::IsNullOrWhiteSpace($ProofDirectory)) {
    $ProofDirectory = Join-Path ([System.IO.Path]::GetTempPath()) 'izzi-mkt04-packaged-safety'
  }
  New-Item -ItemType Directory -Path $ProofDirectory -Force | Out-Null
  $resolvedProof = (Resolve-Path -LiteralPath $ProofDirectory).Path
  $proofVolumeRoot = [System.IO.Path]::GetPathRoot($resolvedProof).TrimEnd('\')
  Assert-Safety -Condition ($resolvedProof.TrimEnd('\') -ne $proofVolumeRoot) -Code 'mkt04-proof-root-invalid'
  if ([string]::IsNullOrWhiteSpace($ReceiptPath)) {
    $ReceiptPath = Join-Path $resolvedProof 'customer-marketing-packaged-safety-receipt.json'
  }
  $receiptParent = Split-Path -Parent $ReceiptPath
  if (-not [string]::IsNullOrWhiteSpace($receiptParent)) {
    New-Item -ItemType Directory -Path $receiptParent -Force | Out-Null
  }
  $resolvedReceipt = [System.IO.Path]::GetFullPath($ReceiptPath)
  Assert-Safety `
    -Condition ($resolvedReceipt.StartsWith($resolvedProof + '\', [System.StringComparison]::OrdinalIgnoreCase)) `
    -Code 'mkt04-receipt-path-invalid'
  $snapshotPath = Join-Path $resolvedProof 'customer-marketing-synthetic-snapshot.json'
  $profilePath = Join-Path $resolvedProof 'profile'
  foreach ($generatedPath in @($snapshotPath, $resolvedReceipt)) {
    if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Force }
  }
  foreach ($screenshot in Get-ChildItem -LiteralPath $resolvedProof -Filter 'mkt04-*.png' -File -ErrorAction SilentlyContinue) {
    Remove-Item -LiteralPath $screenshot.FullName -Force
  }
  if (Test-Path -LiteralPath $profilePath) {
    $resolvedProfile = (Resolve-Path -LiteralPath $profilePath).Path
    Assert-Safety -Condition ($resolvedProfile.StartsWith($resolvedProof + '\', [System.StringComparison]::OrdinalIgnoreCase)) -Code 'mkt04-profile-path-invalid'
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
  }

  $coreProcess = Invoke-SafetyProcess `
    -Executable $resolvedElectron `
    -Arguments @($coreHarness, $appAsar, $snapshotPath) `
    -RunAsNode $true `
    -TimeoutSeconds 90
  $core = ConvertFrom-SafetyReceipt -Output $coreProcess.stdout -Code 'mkt04-core-receipt-invalid'
  $observedExternalActions = [int]$core.externalActionsPerformed
  $observedNetworkAttempts = if ($null -ne $core.checks) { [int]$core.checks.externalNetworkAttempts } else { $null }
  $observedSecretLeakCount = if ($null -ne $core.checks) { [int]$core.checks.secretLeakCount } else { [int]$core.secretLeakCount }
  Assert-Safety -Condition ($coreProcess.exitCode -eq 0) -Code 'mkt04-core-process-failed'
  Assert-Safety -Condition ($core.status -eq 'pass') -Code 'mkt04-core-suite-failed'
  Assert-Safety -Condition ($core.checks.secretLeakCount -eq 0) -Code 'mkt04-core-secret-leak'
  Assert-Safety -Condition ($core.checks.externalNetworkAttempts -eq 0) -Code 'mkt04-core-network-attempt'
  Assert-Safety -Condition ($core.externalActionsPerformed -eq 0) -Code 'mkt04-core-external-action'
  Assert-Safety -Condition (Test-Path -LiteralPath $snapshotPath -PathType Leaf) -Code 'mkt04-snapshot-missing'

  $uiProcess = Invoke-SafetyProcess `
    -Executable $resolvedElectron `
    -Arguments @($uiHarness, $appAsar, $uiPreload, $snapshotPath, $resolvedProof) `
    -RunAsNode $false `
    -TimeoutSeconds 120
  $ui = ConvertFrom-SafetyReceipt -Output $uiProcess.stdout -Code 'mkt04-ui-receipt-invalid'
  $observedExternalActions += [int]$ui.externalActionsPerformed
  $observedNetworkAttempts += if ($null -ne $ui.checks) { [int]$ui.checks.networkAttemptCount } else { [int]$ui.networkAttemptCount }
  $observedSecretLeakCount += if ($null -ne $ui.checks) { [int]$ui.checks.secretLeakCount } else { [int]$ui.secretLeakCount }
  Assert-Safety -Condition ($uiProcess.exitCode -eq 0) -Code 'mkt04-ui-process-failed'
  Assert-Safety -Condition ($ui.status -eq 'pass') -Code 'mkt04-ui-suite-failed'
  Assert-Safety -Condition ($ui.appVersion -eq $core.appVersion) -Code 'mkt04-version-mismatch'
  Assert-Safety -Condition ($ui.checks.secretLeakCount -eq 0) -Code 'mkt04-ui-secret-leak'
  Assert-Safety -Condition ($ui.checks.networkAttemptCount -eq 0) -Code 'mkt04-ui-network-attempt'
  Assert-Safety -Condition ($ui.checks.consoleErrorCount -eq 0) -Code 'mkt04-ui-console-error'
  Assert-Safety -Condition ($ui.externalActionsPerformed -eq 0) -Code 'mkt04-ui-external-action'
  Assert-Safety -Condition (@($ui.checks.viewports).Count -eq 2) -Code 'mkt04-ui-viewport-count-invalid'

  if (Test-Path -LiteralPath $profilePath) {
    $resolvedProfile = (Resolve-Path -LiteralPath $profilePath).Path
    Assert-Safety -Condition ($resolvedProfile.StartsWith($resolvedProof + '\', [System.StringComparison]::OrdinalIgnoreCase)) -Code 'mkt04-profile-path-invalid'
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
  }
  $secretLeakCount = @(
    Get-ChildItem -LiteralPath $resolvedProof -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in @('.json', '.txt') } |
      Select-String -SimpleMatch 'synthetic-secret-must-not-leak' -ErrorAction SilentlyContinue
  ).Count
  Assert-Safety -Condition ($secretLeakCount -eq 0) -Code 'mkt04-proof-secret-leak'
  $externalActionsPerformed = [int]$core.externalActionsPerformed + [int]$ui.externalActionsPerformed
  Assert-Safety -Condition ($externalActionsPerformed -eq 0) -Code 'mkt04-external-action-total'

  $receipt = [ordered]@{
    schemaVersion = 1
    suite = 'customer-marketing-packaged-safety'
    suiteVersion = $suiteVersion
    appVersion = [string]$core.appVersion
    status = 'pass'
    checks = [ordered]@{
      coreStatus = [string]$core.status
      uiStatus = [string]$ui.status
      viewportCount = @($ui.checks.viewports).Count
      consoleErrorCount = [int]$ui.checks.consoleErrorCount
      loadErrorCount = [int]$ui.checks.loadErrorCount
      renderProcessGoneCount = [int]$ui.checks.renderProcessGoneCount
      networkAttemptCount = [int]$ui.checks.networkAttemptCount + [int]$core.checks.externalNetworkAttempts
      secretLeakCount = $secretLeakCount
      screenshots = @($ui.checks.viewports | ForEach-Object {
        [ordered]@{
          width = [int]$_.width
          height = [int]$_.height
          sha256 = [string]$_.screenshot.sha256
          sizeBytes = [long]$_.screenshot.sizeBytes
        }
      })
      packagedArtifacts = [ordered]@{
        executableSha256 = Get-Sha256 -Path $packagedExecutable
        appAsarSha256 = Get-Sha256 -Path $appAsar
      }
    }
    externalActionsPerformed = $externalActionsPerformed
  }
  $json = $receipt | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($resolvedReceipt, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Output $json
} catch {
  $candidate = [string]$_.Exception.Message
  if ($candidate -match '^mkt04-[a-z0-9-]+$') { $failureCode = $candidate }
  $failure = [ordered]@{
    schemaVersion = 1
    suite = 'customer-marketing-packaged-safety'
    suiteVersion = $suiteVersion
    status = 'fail'
    failureCode = $failureCode
    secretLeakCount = $observedSecretLeakCount
    networkAttemptCount = $observedNetworkAttempts
    externalActionsPerformed = $observedExternalActions
  } | ConvertTo-Json -Depth 4
  if ($resolvedReceipt) {
    [System.IO.File]::WriteAllText($resolvedReceipt, $failure + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  }
  Write-Output $failure
  Write-Error "MKT-04 packaged safety suite failed: $failureCode"
  exit 12
}
