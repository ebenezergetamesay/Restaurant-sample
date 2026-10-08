@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Check your internet connection and Node.js installation.
  pause
  exit /b 1
)
echo.
echo Starting Barch Food Zone...
npm run dev
pause
