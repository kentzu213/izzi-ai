#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Izzi AI Desktop — Local Windows Build (PowerShell)
.DESCRIPTION
  Double-click or run from terminal to build a local installer.
  Publishing is restricted to the protected GitHub Actions release workflow.
.EXAMPLE
  .\release-win.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===== Izzi AI Desktop Local Build (Windows) =====" -ForegroundColor Cyan
Write-Host ""

# Navigate to desktop app root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")
Write-Host "[1/5] Working directory: $PWD"
Write-Host ""

# Check prerequisites
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node: $(node -v)"

if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] pnpm not found." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] pnpm: $(pnpm -v)"
Write-Host ""

# Tests
Write-Host "[2/5] Running tests..."
pnpm test
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Tests failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] All tests passed." -ForegroundColor Green
Write-Host ""

# Build
Write-Host "[3/5] Building renderer + main..."
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build successful." -ForegroundColor Green
Write-Host ""

# Publishing is intentionally unavailable from local scripts.
Write-Host "[4/5] Publishing disabled — building a LOCAL installer only." -ForegroundColor Gray
Write-Host ""

# Package
Write-Host "[5/5] Packaging with electron-builder..."
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] electron-builder failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "===== BUILD COMPLETE =====" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $PWD\release\"
Write-Host ""

if (Test-Path "release") {
    Get-ChildItem release -Filter "*.exe" | ForEach-Object { Write-Host "  $_" }
    Get-ChildItem release -Filter "*.yml" | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "Done. Press any key to close." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
