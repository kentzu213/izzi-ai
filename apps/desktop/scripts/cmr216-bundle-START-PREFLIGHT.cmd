@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-cmr216-clean-host-bundle.ps1" -InstallRoot "C:\CMR216\IzziAI" -ReceiptPath "C:\CMR216\evidence\preflight.json" -EnvironmentClass WorkstationIsolated
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Preflight stopped. Review C:\CMR216\evidence\preflight.json
if "%RESULT%"=="0" echo Preflight passed. Review C:\CMR216\evidence\preflight.json before lifecycle execution.
pause
exit /b %RESULT%
