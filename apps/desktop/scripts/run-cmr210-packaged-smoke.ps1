param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [Parameter(Mandatory = $true)]
  [string]$AppRoot,
  [Parameter(Mandatory = $true)]
  [string]$HarnessPath,
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath,
  [Parameter(Mandatory = $true)]
  [string]$BrowserPath,
  [Parameter(Mandatory = $true)]
  [string]$ProofParent,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

function Get-TreeState {
  param(
    [string[]]$Paths,
    [string[]]$ExcludeRoots = @()
  )
  $normalizedExcludes = @(
    $ExcludeRoots |
      Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
      ForEach-Object { (Resolve-Path -LiteralPath $_).Path.TrimEnd('\') }
  )
  $rows = foreach ($watchPath in $Paths) {
    if (Test-Path -LiteralPath $watchPath) {
      Get-ChildItem -LiteralPath $watchPath -Recurse -Force -File -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        Where-Object {
          $candidate = $_.FullName
          -not (
            $normalizedExcludes |
              Where-Object {
                $candidate -eq $_ -or
                $candidate.StartsWith($_ + '\', [System.StringComparison]::OrdinalIgnoreCase)
              }
          )
        } |
        ForEach-Object {
          [pscustomobject]@{
            Path = $_.FullName
            Length = $_.Length
            LastWriteUtc = $_.LastWriteTimeUtc.Ticks
          }
        }
    }
  }
  return @($rows)
}

function Get-ProjectState {
  param([string]$Root)
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -Force -File |
      Sort-Object FullName |
      ForEach-Object {
        [pscustomobject]@{
          Path = $_.FullName.Substring($Root.Length).TrimStart('\')
          Length = $_.Length
          Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
        }
      }
  )
}

function Quote-Argument {
  param([string]$Value)
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Get-FileEvidence {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path
  if (
    $item.PSIsContainer -or
    (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  ) {
    throw "Smoke input is not a regular file: $Path"
  }
  return [ordered]@{
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
    sizeBytes = $item.Length
  }
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedAppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$resolvedHarness = (Resolve-Path -LiteralPath $HarnessPath).Path
$resolvedProject = (Resolve-Path -LiteralPath $ProjectPath).Path
$resolvedBrowser = (Resolve-Path -LiteralPath $BrowserPath).Path
$inputEvidenceBefore = [ordered]@{
  executable = Get-FileEvidence -Path $resolvedExecutable
  appRoot = Get-FileEvidence -Path $resolvedAppRoot
  harness = Get-FileEvidence -Path $resolvedHarness
  browser = Get-FileEvidence -Path $resolvedBrowser
}
New-Item -ItemType Directory -Path $ProofParent -Force | Out-Null
$resolvedProofParent = (Resolve-Path -LiteralPath $ProofParent).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runtimeRoot = Join-Path $resolvedProofParent "CMR-210 Đường dẫn có dấu $stamp"
$receiptPath = Join-Path $resolvedProofParent "cmr210-packaged-smoke-$stamp.json"
$errorPath = Join-Path $resolvedProofParent "cmr210-packaged-smoke-$stamp.stderr.txt"
if (Test-Path -LiteralPath $runtimeRoot) {
  throw "Proof root already exists: $runtimeRoot"
}

$watchPaths = @(
  (Join-Path $env:USERPROFILE '.cache\hyperframes'),
  (Join-Path $env:USERPROFILE '.config\hyperframes'),
  (Join-Path $env:USERPROFILE '.hyperframes'),
  (Join-Path $env:APPDATA 'hyperframes'),
  (Join-Path $env:LOCALAPPDATA 'hyperframes')
)
$browserRoot = Split-Path -Parent $resolvedBrowser
$profileBefore = @(Get-TreeState -Paths $watchPaths -ExcludeRoots @($browserRoot))
$projectBefore = @(Get-ProjectState -Root $resolvedProject)
$chromeBefore = @(
  Get-CimInstance Win32_Process -Filter "Name='chrome-headless-shell.exe'" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ProcessId
)

$originalEnvironment = @{
  PATH = $env:PATH
  ELECTRON_RUN_AS_NODE = $env:ELECTRON_RUN_AS_NODE
  STARIZZI_HYPERFRAMES_BROWSER = $env:STARIZZI_HYPERFRAMES_BROWSER
  STARIZZI_HYPERFRAMES_NODE = $env:STARIZZI_HYPERFRAMES_NODE
  IZZI_API_KEY = $env:IZZI_API_KEY
}

$smokeExit = -1
$externalToolHits = @()
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  $env:STARIZZI_HYPERFRAMES_BROWSER = $resolvedBrowser
  $env:STARIZZI_HYPERFRAMES_NODE = $null
  $env:IZZI_API_KEY = 'cmr210-synthetic-secret'
  $where = Join-Path $env:SystemRoot 'System32\where.exe'
  foreach ($tool in @('node.exe', 'python.exe', 'git.exe', 'ffmpeg.exe')) {
    $matches = @()
    $whereExit = 1
    try {
      $matches = @(& $where $tool 2>$null)
      $whereExit = $LASTEXITCODE
    } catch {
      $whereExit = 1
    }
    if ($whereExit -eq 0) {
      $externalToolHits += $matches
    }
  }
  $argumentString = @(
    (Quote-Argument -Value $resolvedHarness),
    (Quote-Argument -Value $resolvedAppRoot),
    (Quote-Argument -Value $resolvedProject),
    (Quote-Argument -Value $runtimeRoot),
    (Quote-Argument -Value $resolvedBrowser)
  ) -join ' '
  $process = Start-Process `
    -FilePath $resolvedExecutable `
    -ArgumentList $argumentString `
    -Wait `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $receiptPath `
    -RedirectStandardError $errorPath
  $smokeExit = $process.ExitCode
} finally {
  $env:PATH = $originalEnvironment.PATH
  $env:ELECTRON_RUN_AS_NODE = $originalEnvironment.ELECTRON_RUN_AS_NODE
  $env:STARIZZI_HYPERFRAMES_BROWSER = $originalEnvironment.STARIZZI_HYPERFRAMES_BROWSER
  $env:STARIZZI_HYPERFRAMES_NODE = $originalEnvironment.STARIZZI_HYPERFRAMES_NODE
  $env:IZZI_API_KEY = $originalEnvironment.IZZI_API_KEY
}

Start-Sleep -Milliseconds 750
$profileAfter = @(Get-TreeState -Paths $watchPaths -ExcludeRoots @($browserRoot))
$projectAfter = @(Get-ProjectState -Root $resolvedProject)
$chromeAfter = @(
  Get-CimInstance Win32_Process -Filter "Name='chrome-headless-shell.exe'" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ProcessId
)
$profileDelta = @(
  Compare-Object `
    -ReferenceObject $profileBefore `
    -DifferenceObject $profileAfter `
    -Property Path, Length, LastWriteUtc
)
$projectDelta = @(
  Compare-Object `
    -ReferenceObject $projectBefore `
    -DifferenceObject $projectAfter `
    -Property Path, Length, Sha256
)
$secretHits = @()
if (Test-Path -LiteralPath $runtimeRoot) {
  $secretHits = @(
    Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Force -File |
      Select-String -SimpleMatch 'cmr210-synthetic-secret' -ErrorAction SilentlyContinue
  )
}
$newChromePids = @($chromeAfter | Where-Object { $_ -notin $chromeBefore })
$inputEvidenceAfter = [ordered]@{
  executable = Get-FileEvidence -Path $resolvedExecutable
  appRoot = Get-FileEvidence -Path $resolvedAppRoot
  harness = Get-FileEvidence -Path $resolvedHarness
  browser = Get-FileEvidence -Path $resolvedBrowser
}
$inputArtifactMutationCount = @(
  foreach ($artifactName in $inputEvidenceBefore.Keys) {
    if (
      $inputEvidenceBefore[$artifactName].sha256 -ne $inputEvidenceAfter[$artifactName].sha256 -or
      $inputEvidenceBefore[$artifactName].sizeBytes -ne $inputEvidenceAfter[$artifactName].sizeBytes
    ) {
      $artifactName
    }
  }
).Count
$stderrText = if (Test-Path -LiteralPath $errorPath) {
  Get-Content -LiteralPath $errorPath -Raw
} else {
  ''
}
$receipt = $null
$receiptParseError = ''
if (
  (Test-Path -LiteralPath $receiptPath) -and
  ((Get-Item -LiteralPath $receiptPath).Length -gt 0)
) {
  try {
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  } catch {
    $receiptParseError = $_.Exception.Message
  }
}
$receiptDetails = if ($null -ne $receipt) { $receipt.receipt } else { $null }
$receiptArtifactMismatchCount = 0
if ($null -ne $receipt -and $null -ne $receipt.inputArtifacts) {
  foreach ($artifactName in $inputEvidenceBefore.Keys) {
    $receiptProperty = $receipt.inputArtifacts.PSObject.Properties[$artifactName]
    $receiptEvidence = if ($null -ne $receiptProperty) { $receiptProperty.Value } else { $null }
    if (
      $null -eq $receiptEvidence -or
      [string]$receiptEvidence.sha256 -ne [string]$inputEvidenceBefore[$artifactName].sha256 -or
      [long]$receiptEvidence.sizeBytes -ne [long]$inputEvidenceBefore[$artifactName].sizeBytes
    ) {
      $receiptArtifactMismatchCount += 1
    }
  }
} else {
  $receiptArtifactMismatchCount = $inputEvidenceBefore.Count
}
$summary = [ordered]@{
  exitCode = $smokeExit
  receiptPath = $receiptPath
  stderrPath = $errorPath
  runtimeRoot = $runtimeRoot
  receiptPresent = $null -ne $receipt
  receiptParseError = $receiptParseError
  receiptStatus = if ($null -ne $receipt) { $receipt.status } else { $null }
  expectedVersion = $ExpectedVersion
  appVersion = if ($null -ne $receipt) { $receipt.appVersion } else { $null }
  electronVersion = if ($null -ne $receipt) { $receipt.electronVersion } else { $null }
  nodeVersion = if ($null -ne $receipt) { $receipt.nodeVersion } else { $null }
  hyperframesVersion = if ($null -ne $receipt) { $receipt.hyperframesVersion } else { $null }
  snapshotCount = if ($null -ne $receiptDetails) { $receiptDetails.snapshotCount } else { $null }
  snapshotFrames = if ($null -ne $receipt) { @($receipt.snapshotFrames | ForEach-Object { $_.name }) } else { @() }
  outputFileCount = if ($null -ne $receipt) { @($receipt.outputFiles).Count } else { 0 }
  commercialRenderAvailable = if ($null -ne $receipt) { $receipt.commercialRenderAvailable } else { $null }
  externalActionsPerformed = if ($null -ne $receipt) { $receipt.externalActionsPerformed } else { $null }
  hostPathEntries = if ($null -ne $receipt) { $receipt.hostPathEntries } else { $null }
  externalToolHitCount = $externalToolHits.Count
  profileDeltaCount = $profileDelta.Count
  projectDeltaCount = $projectDelta.Count
  syntheticSecretHitCount = $secretHits.Count
  newChromeProcessCount = $newChromePids.Count
  inputArtifacts = $inputEvidenceBefore
  inputArtifactMutationCount = $inputArtifactMutationCount
  receiptArtifactMismatchCount = $receiptArtifactMismatchCount
  stderr = if ([string]::IsNullOrWhiteSpace([string]$stderrText)) { '' } else { ([string]$stderrText).Trim() }
}
$summary | ConvertTo-Json -Depth 5

if ($smokeExit -ne 0) {
  exit $smokeExit
}
if ($null -eq $receipt -or [string]$receipt.status -ne 'pass') {
  exit 8
}
if (
  [string]$receipt.appVersion -ne $ExpectedVersion -or
  $inputArtifactMutationCount -ne 0 -or
  $receiptArtifactMismatchCount -ne 0 -or
  $externalToolHits.Count -ne 0 -or
  $profileDelta.Count -ne 0 -or
  $projectDelta.Count -ne 0 -or
  $secretHits.Count -ne 0 -or
  $newChromePids.Count -ne 0
) {
  exit 9
}
