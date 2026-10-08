@echo off
title Reset owner password
cd /d "%~dp0"
echo.
echo  This creates a temporary password for the system OWNER account.
echo  Use it only if the owner forgot the password.
echo.
pause
node server.js --reset-owner
pause
