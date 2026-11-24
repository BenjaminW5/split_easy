@echo off
setlocal
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. Follow README_LOCAL.md to install dependencies first.
  pause
  exit /b 1
)
set "SPLITEASE_SQLITE_PATH=%~dp0backend\splitease.db"
if not defined OCR_PROVIDER set "OCR_PROVIDER=mock"
".venv\Scripts\python.exe" -m uvicorn app.local:app --host 127.0.0.1 --port 8000
if errorlevel 1 pause
