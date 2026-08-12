@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Izzi AI Desktop — Windows Build ^& Release Script
REM  
REM  Usage:
REM    1. Double-click to BUILD LOCAL only (no publish)
REM    2. Publishing is intentionally unavailable here; push a reviewed tag so CI can enforce signing and inventory gates.
REM
REM  Output: apps\desktop\release\
REM ============================================================

echo.
echo ===== Izzi AI Desktop Release (Windows) =====
echo.

REM — Navigate to desktop app root
cd /d "%~dp0\.."
if errorlevel 1 (
    echo [ERROR] Cannot navigate to desktop app directory.
    pause
    exit /b 1
)

echo [1/5] Working directory: %CD%
echo.

REM — Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo [OK] Node: %%i

REM — Check pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found. Run: npm install -g pnpm
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('pnpm -v') do echo [OK] pnpm: %%i
echo.

REM — Run tests first (verification-loop)
echo [2/5] Running tests...
call pnpm test
if errorlevel 1 (
    echo.
    echo [ERROR] Tests failed! Fix tests before releasing.
    pause
    exit /b 1
)
echo [OK] All tests passed.
echo.

REM — Build TypeScript + Vite
echo [3/5] Building renderer + main...
call pnpm build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo [OK] Build successful.
echo.

echo [4/5] Local build only. Publishing requires the GitHub release workflow.
echo.

REM — Run electron-builder
echo [5/5] Packaging with electron-builder...
echo.

call npx electron-builder --win --publish never

if errorlevel 1 (
    echo.
    echo [ERROR] electron-builder failed!
    pause
    exit /b 1
)

echo.
echo ===== BUILD COMPLETE =====
echo.
echo Output files are in: %CD%\release\
echo.

REM — List output files
if exist "release" (
    echo Files created:
    dir /b release\*.exe 2>nul
    dir /b release\*.yml 2>nul
    echo.
)

echo [LOCAL ONLY] Install the .exe from release\ folder.
echo To publish, push a reviewed version tag and wait for Release Desktop CI.

echo.
pause
