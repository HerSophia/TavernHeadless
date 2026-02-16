@echo off
setlocal
node scripts\dev-select.mjs %*
exit /b %errorlevel%
