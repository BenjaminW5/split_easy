@echo off
setlocal
cd /d "%~dp0frontend"
set "VITE_LOCAL_MODE=true"
set "VITE_API_URL="
call npm.cmd run build
if errorlevel 1 exit /b 1
cd /d "%~dp0backend"
.venv\Scripts\python.exe -m pip install pyinstaller==6.22.3
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile --name SplitEase --add-data "../frontend/dist;web" --collect-all psycopg_binary --distpath ../../ --workpath ../../../work/pyinstaller --specpath . desktop.py
