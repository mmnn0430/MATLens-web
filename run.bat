@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup first: python -m venv .venv
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8018"
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8018
