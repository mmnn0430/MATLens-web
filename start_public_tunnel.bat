@echo off
chcp 65001 > nul
echo =======================================================
echo [MatLens] 외부 접속용 공용 배포 터널 실행 스크립트
echo =======================================================
echo.

cd /d "%~dp0"

echo 1. MatLens 백엔드 서버 확인 중...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3; Write-Host '   -> 로컬 서버 실행 중 확인됨' } catch { Write-Host '   -> 백엔드 서버를 먼저 백그라운드로 실행합니다...'; Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000' -WindowStyle Minimized }"

echo.
echo 2. Cloudflare 공용 보안 터널(HTTPS) 연결 중...
echo.
echo *******************************************************
echo 아래에 생성되는 'https://....trycloudflare.com' 주소를
echo 팀원이나 외부 사용자에게 공유하시면 어디서든 바로 접속됩니다!
echo *******************************************************
echo.

"..\matlens\cloudflared.exe" tunnel --url http://127.0.0.1:8000 --no-autoupdate
pause
