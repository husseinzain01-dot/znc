@echo off
rem Starts the Lawhat Al-Mahal helper and opens the program in the browser.
rem Keep the window that opens; closing it stops saving.
cd /d "%~dp0"
start "Lawhat Al-Mahal" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
