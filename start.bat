@echo off
title Chicken Field System
cd /d "%~dp0"

:loop
echo ========================================
echo Starting server...
echo ========================================
node backend\server.js
echo.
echo Server stopped. Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto loop
