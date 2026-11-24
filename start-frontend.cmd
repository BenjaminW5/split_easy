@echo off
setlocal
cd /d "%~dp0frontend"
if not exist "node_modules\vite\bin\vite.js" (
  echo Frontend dependencies missing. Run npm.cmd ci in frontend first.
  pause
  exit /b 1
)
set "VITE_LOCAL_MODE=true"
set "VITE_API_URL=http://127.0.0.1:8000"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
if errorlevel 1 pause
