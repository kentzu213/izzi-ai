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
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$AppDataRoot,
  [Parameter(Mandatory = $true)]
  [string]$LocalAppDataRoot,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedUser,
  [Parameter(Mandatory = $true)]
  [ValidateSet("WorkstationIsolated", "CleanMachineClaimed")]
  [string]$EnvironmentClass,
  [string]$HostProvenanceSha256 = '',
  [Parameter(Mandatory = $true)]
  [string]$ReceiptPath,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$selfTest = $env:CMR216_LIFECYCLE_SELF_TEST -eq "true"
$steps = New-Object System.Collections.Generic.List[object]
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$localSystemMutationPerformed = $false
$cleanupAttempted = $false
$evidenceClassification = $null

function Get-FullPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Test-PathWithin([string]$Parent, [string]$Child) {
  $parentPath = (Get-FullPath $Parent) + [IO.Path]::DirectorySeparatorChar
  $childPath = Get-FullPath $Child
  return $childPath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)
}

function Add-Step([string]$Name, [string]$Status, [hashtable]$Details = @{}) {
  $steps.Add([pscustomobject]@{ name = $Name; status = $Status; details = $Details }) | Out-Null
}

function Get-ActiveNetworkAdapterCount {
  if ($selfTest) {
    $sample = [string]$env:CMR216_NETWORK_ADAPTER_COUNT_SELF_TEST
    if ($sample -notmatch '^\d+$') { throw 'Network adapter self-test sample is invalid.' }
    return [int]$sample
  }
  return @(NetAdapter\Get-NetAdapter -ErrorAction Stop | Where-Object Status -eq 'Up').Count
}

function Assert-NetworkIsolationCheckpoint([string]$Name, [switch]$Record) {
  if ($EnvironmentClass -ne 'CleanMachineClaimed') { return }
  $activeNetworkAdapterCount = Get-ActiveNetworkAdapterCount
  if ($activeNetworkAdapterCount -ne 0) {
    throw "Network isolation changed during lifecycle checkpoint '$Name'."
  }
  if ($Record) {
    Add-Step "network-isolation-$Name" "pass" @{ activeNetworkAdapterCount = 0 }
  }
}

function Get-ErrorCode([string]$Message) {
  switch -Regex ($Message) {
    'ExpectedUser' { return 'user_mismatch' }
    'SHA-256' { return 'artifact_digest_mismatch' }
    'must differ' { return 'artifact_identity_collision' }
    'Stable Windows|signature state' { return 'signing_policy_denied' }
    'pre-existing profile' { return 'existing_profile' }
    'non-empty install root' { return 'existing_install' }
    'uninstall entry' { return 'existing_uninstall_entry' }
    'running Izzi AI process' { return 'existing_process' }
    'machine residue' { return 'machine_residue' }
    'CMR216_LIFECYCLE_EXECUTE' { return 'execute_confirmation_missing' }
    'Self-test cannot execute' { return 'self_test_execute_denied' }
    'CMR216 test directory' { return 'unsafe_install_root' }
    'Network isolation|network adapter self-test' { return 'network_isolation_changed' }
    'Evidence classification' { return 'evidence_classification_invalid' }
    default { return 'lifecycle_failed' }
  }
}

function Write-Receipt([string]$Status, [string]$ErrorMessage = "") {
  $receiptFullPath = Get-FullPath $ReceiptPath
  $parent = Split-Path -Parent $receiptFullPath
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $receiptEvidence = if ($Status -eq 'fail') { $null } else { $evidenceClassification }
  [pscustomobject]@{
    schemaVersion = 1
    task = "CMR-216"
    status = $Status
    environmentClass = $EnvironmentClass
    verifiedEvidenceTier = $(if ($receiptEvidence) { $receiptEvidence.verifiedEvidenceTier } else { 'Unverified' })
    claim = $(if ($receiptEvidence) { $receiptEvidence.claim } else { 'unverified' })
    selfTest = $selfTest
    mode = $(if ($Execute) { "execute" } else { "preflight" })
    startedAt = $startedAt
    finishedAt = (Get-Date).ToUniversalTime().ToString("o")
    baseline = @{ tag = $BaselineTag; sha256 = $BaselineSha256.ToLowerInvariant() }
    candidate = @{ tag = $CandidateTag; sha256 = $CandidateSha256.ToLowerInvariant() }
    providerMutationPerformed = $false
    networkIsolationVerified = $(if ($receiptEvidence) { $receiptEvidence.networkIsolationVerified } else { $false })
    hostProvenanceSha256 = $(if ($receiptEvidence) { $receiptEvidence.hostProvenanceSha256 } else { $null })
    localSystemMutationPerformed = $localSystemMutationPerformed
    cleanupAttempted = $cleanupAttempted
    errorCode = $(if ($ErrorMessage) { Get-ErrorCode $ErrorMessage } else { "" })
    steps = @($steps | ForEach-Object { $_ })
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFullPath -Encoding UTF8
}

function Get-UninstallEntries {
  return @(Get-ItemProperty `
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', `
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', `
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'Izzi AI*' })
}

function Get-MachineResidue {
  $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like '*Izzi*' -or $_.DisplayName -like '*Izzi AI*'
  })
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.TaskName -like '*Izzi AI*' -or $_.TaskPath -like '*Izzi AI*'
  })
  return [pscustomobject]@{ services = $services.Count; scheduledTasks = $tasks.Count }
}

function Get-IzziProcesses {
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and ($_.Path -like '*\Izzi AI.exe') } catch { $false }
  })
}

function Invoke-Installer([string]$Path, [string]$Label) {
  $script:localSystemMutationPerformed = $true
  $process = Start-Process -FilePath $Path -ArgumentList @('/S', "/D=$InstallRoot") `
    -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes(5)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    [void]$process.WaitForExit(1000)
    Assert-NetworkIsolationCheckpoint "$Label-installer-running"
  }
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "$Label installer timed out."
  }
  if ($process.ExitCode -ne 0) { throw "$Label installer exited $($process.ExitCode)." }
}

function Get-InstalledExecutable {
  $executables = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Izzi AI.exe' -File -Recurse -ErrorAction SilentlyContinue)
  if ($executables.Count -ne 1) { throw "Expected exactly one installed Izzi AI executable; observed $($executables.Count)." }
  return $executables[0].FullName
}

function Assert-InstalledVersion([string]$ExpectedVersion) {
  $entries = Get-UninstallEntries
  $entry = $entries | Where-Object { $_.DisplayVersion -eq $ExpectedVersion } | Select-Object -First 1
  if (-not $entry) { throw "Installed version $ExpectedVersion was not registered for the current user." }
  $executable = Get-InstalledExecutable
  if (-not (Test-PathWithin $InstallRoot $executable)) { throw "Installed executable escaped InstallRoot." }
  return $executable
}

function Stop-InstalledProcesses {
  foreach ($process in Get-IzziProcesses) {
    try {
      if (Test-PathWithin $InstallRoot $process.Path) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
}

function Invoke-LaunchSmoke([string]$ExpectedVersion) {
  $executable = Assert-InstalledVersion $ExpectedVersion
  $before = @(Get-IzziProcesses | ForEach-Object Id)
  Start-Process -FilePath $executable -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(45)
  $running = @()
  do {
    Start-Sleep -Milliseconds 500
    Assert-NetworkIsolationCheckpoint "launch-smoke-running"
    $running = @(Get-IzziProcesses | Where-Object { $_.Id -notin $before })
  } while ($running.Count -eq 0 -and (Get-Date) -lt $deadline)
  if ($running.Count -eq 0) { throw "Installed app did not remain running during launch smoke." }
  $profilePath = Join-Path $AppDataRoot '@openclaw'
  do {
    if (Test-Path -LiteralPath $profilePath) { break }
    Start-Sleep -Milliseconds 500
    Assert-NetworkIsolationCheckpoint "profile-seed-running"
  } while ((Get-Date) -lt $deadline)
  if (-not (Test-Path -LiteralPath $profilePath)) { throw "First launch did not create the expected profile." }
  Stop-InstalledProcesses
}

function Get-CurrentUserShortcutPaths {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $programs = [Environment]::GetFolderPath('Programs')
  return @(
    (Join-Path $desktop 'Izzi AI.lnk'),
    (Join-Path $programs 'Izzi AI.lnk')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Get-CommonShortcutPaths {
  $commonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $commonPrograms = [Environment]::GetFolderPath('CommonPrograms')
  return @(
    (Join-Path $commonDesktop 'Izzi AI.lnk'),
    (Join-Path $commonPrograms 'Izzi AI.lnk')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Assert-ShortcutGroup([string[]]$Paths, [bool]$Expected) {
  foreach ($path in $Paths) {
    if ((Test-Path -LiteralPath $path) -ne $Expected) {
      throw "Shortcut state mismatch for $path."
    }
  }
}

function Assert-ShortcutPolicy([bool]$Installed) {
  Assert-ShortcutGroup @(Get-CurrentUserShortcutPaths) $Installed
  Assert-ShortcutGroup @(Get-CommonShortcutPaths) $false
}

function Assert-NoInstalledResidue {
  if ((Get-IzziProcesses).Count -ne 0) { throw "Izzi AI process remained after uninstall." }
  if ((Get-UninstallEntries).Count -ne 0) { throw "Uninstall entry remained after uninstall." }
  if (@(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Izzi AI.exe' -File -Recurse -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Installed executable remained after uninstall."
  }
  if (@(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Uninstaller remained after uninstall."
  }
  Assert-ShortcutPolicy $false
  $machineResidue = Get-MachineResidue
  if ($machineResidue.services -ne 0 -or $machineResidue.scheduledTasks -ne 0) {
    throw "Machine residue remained after uninstall."
  }
}

function Invoke-Uninstall {
  $script:localSystemMutationPerformed = $true
  Stop-InstalledProcesses
  $uninstallers = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse -ErrorAction SilentlyContinue)
  if ($uninstallers.Count -ne 1) { throw "Expected exactly one uninstaller; observed $($uninstallers.Count)." }
  $process = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes(5)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    [void]$process.WaitForExit(1000)
    Assert-NetworkIsolationCheckpoint "uninstaller-running"
  }
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Uninstaller timed out."
  }
  if ($process.ExitCode -ne 0) { throw "Uninstaller exited $($process.ExitCode)." }
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $remainingExecutable = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Izzi AI.exe' -File -Recurse -ErrorAction SilentlyContinue)
    $remainingUninstaller = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse -ErrorAction SilentlyContinue)
    if ((Get-UninstallEntries).Count -eq 0 -and $remainingExecutable.Count -eq 0 -and $remainingUninstaller.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
    Assert-NetworkIsolationCheckpoint "uninstall-cleanup-running"
  } while ((Get-Date) -lt $deadline)
  Assert-NoInstalledResidue
}

try {
  if ([Environment]::UserName -ne $ExpectedUser) {
    throw "ExpectedUser '$ExpectedUser' does not match the current Windows user."
  }
  if ($Execute -and $env:CMR216_LIFECYCLE_EXECUTE -ne "true") {
    throw "Execute requires CMR216_LIFECYCLE_EXECUTE=true."
  }
  if ($Execute -and $selfTest) { throw "Self-test cannot execute the lifecycle." }

  $baselineInstaller = (Resolve-Path -LiteralPath $BaselineInstallerPath).Path
  $candidateInstaller = (Resolve-Path -LiteralPath $CandidateInstallerPath).Path
  $installFullPath = Get-FullPath $InstallRoot
  $appDataFullPath = Get-FullPath $AppDataRoot
  $localAppDataFullPath = Get-FullPath $LocalAppDataRoot
  $receiptFullPath = Get-FullPath $ReceiptPath
  if ($installFullPath -eq [IO.Path]::GetPathRoot($installFullPath)) { throw "InstallRoot cannot be a drive root." }
  if ($installFullPath -notmatch '(?i)(^|[\\/])cmr216(?:[^\\/]*)?([\\/]|$)') {
    throw "InstallRoot must be under a clearly named CMR216 test directory."
  }
  if (
    (Test-PathWithin $installFullPath $receiptFullPath) -or
    (Test-PathWithin $appDataFullPath $receiptFullPath) -or
    (Test-PathWithin $localAppDataFullPath $receiptFullPath)
  ) {
    throw "ReceiptPath must remain outside mutable install and profile roots."
  }
  if (-not $selfTest) {
    if ($appDataFullPath -ne (Get-FullPath $env:APPDATA) -or $localAppDataFullPath -ne (Get-FullPath $env:LOCALAPPDATA)) {
      throw "AppDataRoot and LocalAppDataRoot must match the current clean Windows user."
    }
  }

  if ($selfTest) {
    $evidenceClassification = [pscustomobject]@{
      verifiedEvidenceTier = 'ContractOnly'
      claim = 'synthetic-contract'
      networkIsolationVerified = $false
      hostProvenanceSha256 = $null
    }
  } else {
    $activeNetworkAdapterCount = Get-ActiveNetworkAdapterCount
    $evidenceClassification = & (Join-Path $PSScriptRoot 'resolve-cmr216-evidence-classification.ps1') `
      -EnvironmentClass $EnvironmentClass `
      -HostProvenanceSha256 $HostProvenanceSha256 `
      -ActiveNetworkAdapterCount $activeNetworkAdapterCount | ConvertFrom-Json
    if (-not $evidenceClassification) { throw 'Evidence classification returned no result.' }
    $expectedTier = if ($EnvironmentClass -eq 'CleanMachineClaimed') { 'CleanMachineClaimed' } else { 'WorkstationIsolated' }
    if ($evidenceClassification.verifiedEvidenceTier -ne $expectedTier) {
      throw 'Evidence classification returned an unexpected tier.'
    }
  }
  Assert-NetworkIsolationCheckpoint "preflight" -Record

  $baselineObserved = (Get-FileHash -LiteralPath $baselineInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  $candidateObserved = (Get-FileHash -LiteralPath $candidateInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($baselineObserved -ne $BaselineSha256.ToLowerInvariant()) { throw "Baseline installer SHA-256 mismatch." }
  if ($candidateObserved -ne $CandidateSha256.ToLowerInvariant()) { throw "Candidate installer SHA-256 mismatch." }
  if ($baselineObserved -eq $candidateObserved) { throw "Baseline and candidate installers must differ." }
  Add-Step "artifact-integrity" "pass" @{ baseline = $baselineObserved; candidate = $candidateObserved }

  $signingPolicy = Join-Path $PSScriptRoot 'verify-windows-signing-policy.ps1'
  $signingArguments = if ($selfTest) { @{ ObservedStatus = 'NotSigned' } } else { @{} }
  & $signingPolicy -Tag $BaselineTag -InstallerPath $baselineInstaller @signingArguments | Out-Null
  & $signingPolicy -Tag $CandidateTag -InstallerPath $candidateInstaller @signingArguments | Out-Null
  Add-Step "signing-policy" "pass"

  $profilePath = Join-Path $appDataFullPath '@openclaw'
  if (Test-Path -LiteralPath $profilePath) { throw "Clean-host preflight found a pre-existing profile." }
  if ((Test-Path -LiteralPath $installFullPath) -and (Get-ChildItem -LiteralPath $installFullPath -Force | Select-Object -First 1)) {
    throw "Clean-host preflight found a non-empty install root."
  }
  if (-not $selfTest -and (Get-UninstallEntries).Count -ne 0) {
    throw "Clean-host preflight found a pre-existing Izzi AI uninstall entry."
  }
  if (-not $selfTest -and (Get-IzziProcesses).Count -ne 0) {
    throw "Clean-host preflight found a running Izzi AI process."
  }
  if (-not $selfTest) {
    $machineResidue = Get-MachineResidue
    if ($machineResidue.services -ne 0 -or $machineResidue.scheduledTasks -ne 0) {
      throw "Clean-host preflight found machine residue."
    }
    Assert-ShortcutPolicy $false
  }
  Add-Step "clean-baseline" "pass" @{ existingProfile = $false; existingInstall = $false }

  if (-not $Execute) {
    Write-Receipt "preflight_pass"
    [pscustomobject]@{
      ok = $true
      mode = "preflight"
      environmentClass = $EnvironmentClass
      verifiedEvidenceTier = $evidenceClassification.verifiedEvidenceTier
      claim = $evidenceClassification.claim
      selfTest = $selfTest
      receiptPath = $receiptFullPath
    } | ConvertTo-Json -Compress
    exit 0
  }

  $baselineVersion = $BaselineTag.TrimStart('v')
  $candidateVersion = $CandidateTag.TrimStart('v')
  Invoke-Installer $baselineInstaller "Baseline"
  Assert-ShortcutPolicy $true
  Invoke-LaunchSmoke $baselineVersion
  Assert-NetworkIsolationCheckpoint "baseline-install-launch" -Record
  Add-Step "baseline-install-launch" "pass" @{ version = $baselineVersion }

  $sentinel = Join-Path $profilePath 'cmr216-retention-sentinel.txt'
  $sentinelValue = [Guid]::NewGuid().ToString('N')
  Set-Content -LiteralPath $sentinel -Value $sentinelValue -Encoding ASCII

  Invoke-Installer $candidateInstaller "Candidate"
  Assert-ShortcutPolicy $true
  Invoke-LaunchSmoke $candidateVersion
  Assert-NetworkIsolationCheckpoint "candidate-upgrade" -Record
  if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne $sentinelValue) { throw "Profile sentinel changed during upgrade." }
  Add-Step "candidate-upgrade" "pass" @{ version = $candidateVersion; profileRetained = $true }

  Invoke-Installer $baselineInstaller "Rollback"
  Invoke-LaunchSmoke $baselineVersion
  Assert-NetworkIsolationCheckpoint "baseline-rollback" -Record
  if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne $sentinelValue) { throw "Profile sentinel changed during rollback." }
  Add-Step "baseline-rollback" "pass" @{ version = $baselineVersion; profileRetained = $true }

  Invoke-Uninstall
  Assert-NetworkIsolationCheckpoint "uninstall" -Record
  if (-not (Test-Path -LiteralPath $sentinel)) { throw "Profile was removed by uninstall despite retention policy." }
  Add-Step "uninstall" "pass" @{ profileRetained = $true }

  Invoke-Installer $candidateInstaller "Reinstall"
  Invoke-LaunchSmoke $candidateVersion
  Assert-NetworkIsolationCheckpoint "candidate-reinstall" -Record
  if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne $sentinelValue) { throw "Profile sentinel changed during reinstall." }
  Add-Step "candidate-reinstall" "pass" @{ version = $candidateVersion; profileRetained = $true }

  Invoke-Uninstall
  Assert-NetworkIsolationCheckpoint "final-uninstall" -Record
  if (-not (Test-Path -LiteralPath $sentinel)) { throw "Profile was removed by final uninstall." }
  Add-Step "final-uninstall" "pass" @{ profileRetained = $true }

  Write-Receipt "pass"
  [pscustomobject]@{
    ok = $true
    mode = "execute"
    verifiedEvidenceTier = $evidenceClassification.verifiedEvidenceTier
    receiptPath = $receiptFullPath
  } |
    ConvertTo-Json -Compress
} catch {
  $failureMessage = $_.Exception.Message
  Add-Step "failure" "fail" @{ errorCode = Get-ErrorCode $failureMessage }
  if ($Execute -and -not $selfTest -and $localSystemMutationPerformed) {
    $cleanupAttempted = $true
    try {
      Stop-InstalledProcesses
      $cleanupUninstallers = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse -ErrorAction SilentlyContinue)
      if ($cleanupUninstallers.Count -eq 1) {
        $cleanup = Start-Process -FilePath $cleanupUninstallers[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru
        if (-not $cleanup.WaitForExit(300000)) {
          Stop-Process -Id $cleanup.Id -Force -ErrorAction SilentlyContinue
          throw "Cleanup uninstaller timed out."
        }
        if ($cleanup.ExitCode -ne 0) { throw "Cleanup uninstaller exited $($cleanup.ExitCode)." }
        $cleanupDeadline = (Get-Date).AddSeconds(30)
        do {
          try {
            Assert-NoInstalledResidue
            break
          } catch {
            if ((Get-Date) -ge $cleanupDeadline) { throw }
            Start-Sleep -Milliseconds 500
          }
        } while ($true)
        Add-Step "failure-cleanup" "pass" @{ profileRetained = $true }
      } else {
        Add-Step "failure-cleanup" "not_available" @{ uninstallerCount = $cleanupUninstallers.Count }
      }
    } catch {
      Add-Step "failure-cleanup" "fail" @{ errorCode = "cleanup_failed" }
    }
  }
  Write-Receipt "fail" $failureMessage
  throw $failureMessage
} finally {
  if ($Execute -and $localSystemMutationPerformed) { Stop-InstalledProcesses }
}
