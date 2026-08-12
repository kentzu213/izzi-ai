@echo off
setlocal
set "CMR216_LIFECYCLE_EXECUTE=true"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-cmr216-clean-host-bundle.ps1" -InstallRoot "C:\CMR216\IzziAI" -ReceiptPath "C:\CMR216\evidence\lifecycle.json" -EnvironmentClass WorkstationIsolated -Execute
set "RESULT=%ERRORLEVEL%"
set "CMR216_LIFECYCLE_EXECUTE="
echo.
if not "%RESULT%"=="0" echo Lifecycle stopped. Review C:\CMR216\evidence\lifecycle.json
if "%RESULT%"=="0" echo Lifecycle passed. Review C:\CMR216\evidence\lifecycle.json
pause
exit /b %RESULT%
