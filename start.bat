@echo off
rem Double-click to start Karaokord on Windows.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, one moment...
  call npm install
)
if not exist config.json call npm run setup
call npm start
pause
