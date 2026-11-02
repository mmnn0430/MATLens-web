# MatLens Render 배포 가이드

이 문서는 **MatLens(XRD · SEM · UTM 재료 분석 통합 솔루션)** 웹앱을 [Render(render.com)](https://render.com)에 무료로 영구 배포하기 위한 공식 매뉴얼입니다.

---

## 1. 배포 아키텍처 및 특징

* **단일 컨테이너 풀스택 서빙 (Multi-stage Docker)**
  * **Frontend**: React 19 + Vite + TypeScript 정적 빌드
  * **Backend**: FastAPI + Python 3.11 수치 계산 엔진
  * **동작 방식**: FastAPI가 React 빌드 결과물(`/frontend/dist`)과 REST API(`/api/*`)를 동일 오리진에서 단일 포트(`$PORT`, 기본 10000)로 직접 서빙합니다.
* **비용 및 운영 장점**:
  * Render **Free Web Service 1개($0/월)**로 전체 앱이 완결 동작합니다.
  * 별도의 프론트-백 분리 배포 시 발생하는 CORS 설정 및 도메인 동기화 문제가 원천 차단됩니다.
  * OpenCV, SciPy, Pymatgen 등 필수 C 라이브러리가 Docker 환경(`libgl1`, `libglib2.0-0`)에서 100% 보장됩니다.

---

## 2. 배포 단계별 상세 안내

### 1단계: GitHub에 코드 푸시 (최초 1회)
로컬 터미널에서 `matlens-web` 디렉토리로 이동한 후 GitHub 리포지토리에 푸시합니다:

```bash
cd "c:\Users\tempo\Desktop\ai enabled 해커톤 자료\matlens-web"
git remote add origin https://github.com/<사용자ID>/matlens-web.git
git branch -M main
git push -u origin main
```

---

### 2단계: Render 웹 대시보드에서 서비스 생성

1. [Render(render.com)](https://render.com)에 로그인 후 우측 상단 **[New +]** → **[Web Service]** 클릭
2. **Build and deploy from a Git repository** 선택 → 방금 올린 `matlens-web` 리포지토리 **Connect**
3. 설정 입력:
   * **Name**: `matlens-web` (원하는 이름)
   * **Region**: `Oregon (US West)` 또는 `Singapore`
   * **Branch**: `main`
   * **Runtime**: **`Docker`** (프로젝트 내 Dockerfile을 자동 인식)
   * **Instance Type**: **`Free`** ($0/월)
4. 고급 설정 (**Advanced**):
   * **Health Check Path**: `/api/health` 입력 (Render가 서비스 정상 여부를 실시간 감시)
   * **Auto-Deploy**: `Yes` (GitHub에 새 커밋이 올라올 때마다 자동 재배포)
5. **[Deploy Web Service]** 클릭!

---

## 3. 환경변수(Environment Variables) 설정

Render 대시보드의 **Environment** 탭에서 필요에 따라 변수를 추가할 수 있습니다:

| 환경변수 이름 | 필수 여부 | 기본값 / 권장값 | 용도 및 설명 |
| :--- | :---: | :--- | :--- |
| `PORT` | 자동 | `10000` | Render가 컨테이너에 자동 주입하는 포트 번호 |
| `GEMINI_API_KEY` | 선택 | *(공백)* | Google Gemini AI 해석 기능 활성화용 키 (미설정 시에도 모든 수치 분석 및 리포트는 100% 정상 작동) |
| `GEMINI_MODEL` | 선택 | `gemini-2.5-flash` | Gemini 모델 버전 (auto, gemini-2.5-flash, gemini-3.5-flash 등) |
| `MP_API_KEY` | 선택 | *(공백)* | Materials Project 실시간 상평형 조회용 키 (미설정 시 내장 기준 라이브러리 사용) |
| `MATLENS_STORAGE_DIR` | 선택 | `/app/backend/storage` | SQLite DB 및 업로드 파일 저장 경로 |

> **보안 주의사항**: API 키와 비밀 값은 코드나 GitHub 저장소에 커밋하지 마시고, 반드시 Render 대시보드의 **Environment** 메뉴에서 등록하세요. 브라우저 클라이언트에는 API 키 문자열이 일절 전송되지 않습니다.

---

## 4. 데이터베이스 및 스토리지 지속성 안내

* **기본 Free Plan 동작 (추가 비용 $0)**:
  * 컨테이너 재시작 시 SQLite DB(`matlens.db`) 및 사용자 업로드 파일은 초기 상태로 리셋(Ephemeral)됩니다.
  * 출처가 보증된 **기본 샘플 데이터(`samples/`)와 기준 결정상 라이브러리**는 이미지 자체에 내장되어 있어 재시작 후에도 영구 유지되며, 실시간 분석 및 PDF/CSV 다운로드는 완벽하게 동작합니다.
* **영구 보존 디스크(Persistent Disk) 옵션**:
  * 사용자가 웹에서 등록한 신규 프로젝트와 업로드 파일을 영구 보존하려면 Render 유료 플랜(Starter $7/월 이상)에서 Persistent Disk($0.25/GB/월, 1GB 기준 약 $1/월)를 생성하고 마운트 경로를 `/var/data`로 설정한 뒤 `MATLENS_STORAGE_DIR=/var/data` 환경변수를 입력하시면 됩니다.

---

## 5. 배포 후 정상 동작 확인 체크리스트

1. **헬스체크 및 메인 화면**:
   * 발급된 주소(`https://matlens-web-xxxx.onrender.com/`) 접속 시 MatLens 메인 대시보드가 정상 표시되는지 확인
   * `https://matlens-web-xxxx.onrender.com/api/health` 호출 시 `{"status": "ok", ...}` 반환 확인
2. **XRD · SEM 통합 분석 흐름**:
   * 메인 화면의 **`[샘플 분석 시작 (TiO2 분말)]`** 클릭 후 분석 실행
   * XRD 피크 검출, SEM 입도 통계(D50), 한국어 PDF 리포트 다운로드 검증
3. **UTM 데이터 분석 흐름**:
   * 상단 헤더의 **`[UTM 데이터 분석]`** 탭 클릭
   * UTM 파일 업로드 후 응력-변형률 곡선, 최대 응력(MPa), 탄성계수, 3패널 차트 및 PDF 다운로드 검증

---

## 6. 오류 발생 시 트러블슈팅 가이드

* **배포 중 빌드 실패 시**:
  * Render 대시보드의 **Logs** 탭에서 에러 로그 확인
  * Dockerfile 빌드 중 `npm run build` 단계나 `pip install` 단계에서 누락된 패키지가 있는지 확인
* **첫 요청 시 50초 지연 (Cold Start)**:
  * Render Free Plan은 15분 동안 접속이 없으면 인스턴스가 대기 상태(Sleep)로 전환됩니다.
  * 15분 후 첫 접속 시 서버가 깨어나는 데 약 30~50초 정도 걸릴 수 있으며, 이는 정상적인 무료 티어 동작입니다.
