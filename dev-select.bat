@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_NODE=%SCRIPT_DIR%.limcode\tmp\node-v22.22.2-win-x64\node.exe"

if exist "%LOCAL_NODE%" (
  "%LOCAL_NODE%" "%SCRIPT_DIR%scripts\dev-select.mjs" %*
) else (
  node "%SCRIPT_DIR%scripts\dev-select.mjs" %*
)

exit /b %errorlevel%
