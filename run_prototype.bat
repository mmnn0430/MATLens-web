@echo off
chcp 65001 >nul
echo ========================================================
echo   MatLens PROTOTYPE Launcher (branch: prototype)
echo   URL: http://127.0.0.1:8001
echo   * Production(main) local launcher uses port 8000
echo ========================================================
cd /d "%~dp0backend"
start "" http://127.0.0.1:8001
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
