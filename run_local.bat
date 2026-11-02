@echo off
chcp 65001 >nul
echo ========================================================
echo   MatLens Local Launcher (FastAPI + Built React SPA)
echo   URL: http://127.0.0.1:8000
echo ========================================================
cd /d "%~dp0backend"
start "" http://127.0.0.1:8000
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
