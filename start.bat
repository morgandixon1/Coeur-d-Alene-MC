@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
echo Open http://localhost:4317 in your browser.
call npm run dev
pause
