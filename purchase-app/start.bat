@echo off
title Purchase Requests
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo  Install the LTS version from https://nodejs.org then run this file again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\mssql" (
  echo Installing required files - one time only...
  call npm install --omit=dev --no-audit --no-fund
)

set OPEN_APP=1
node server.js
echo.
echo  The app has stopped.
pause
