@echo off
rem Double-click to get the latest version and open Planet Maps.
cd /d "%~dp0"
echo Getting the latest version...
git pull --ff-only --quiet
echo Checking dependencies...
call node tools/install-if-needed.mjs
echo Starting Planet Maps (close this window to stop it)...
call npm run dev
pause
