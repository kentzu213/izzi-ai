param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$ReceiptPath,
  [ValidateSet("WorkstationIsolated", "CleanMachineClaimed")]
  [string]$EnvironmentClass = "WorkstationIsolated",
  [string]$AppDataRoot = $env:APPDATA,
  [string]$LocalAppDataRoot = $env:LOCALAPPDATA,
  [string]$ExpectedUser = [Environment]::UserName,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$bundle = $PSScriptRoot
$verification = & (Join-Path $bundle 'verify-cmr216-clean-host-bundle.ps1') -BundleDirectory $bundle |
  ConvertFrom-Json
if (-not $verification.ok) { throw "CMR-216 bundle verification did not pass." }
$manifest = Get-Content -LiteralPath (Join-Path $bundle 'manifest.json') -Raw | ConvertFrom-Json
$arguments = @{
  BaselineInstallerPath = Join-Path $bundle $manifest.baseline.file
  BaselineTag = $manifest.baseline.tag
  BaselineSha256 = $manifest.baseline.sha256
  CandidateInstallerPath = Join-Path $bundle $manifest.candidate.file
  CandidateTag = $manifest.candidate.tag
  CandidateSha256 = $manifest.candidate.sha256
  InstallRoot = $InstallRoot
  AppDataRoot = $AppDataRoot
  LocalAppDataRoot = $LocalAppDataRoot
  ExpectedUser = $ExpectedUser
  EnvironmentClass = $EnvironmentClass
  ReceiptPath = $ReceiptPath
}
if ($Execute) { $arguments.Execute = $true }
& (Join-Path $bundle 'invoke-cmr216-clean-host-lifecycle.ps1') @arguments
