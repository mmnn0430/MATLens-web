# MatLens — XRD와 SEM, 함께 보면 더 명확해집니다

**MatLens**는 X선 회절(XRD) 패턴과 주사전자현미경(SEM) 이미지를 함께 정량 분석하여 **결정상 후보, 미세구조 크기·형상 통계, 두 결과의 물리적 관계**를 한 화면에서 검토하고 재현 가능한 한국어 리포트로 내려받는 재료 연구용 분석 보조 웹앱입니다.

---

## 1. 제품 원칙 및 주요 특징

- **수치 엔진과 생성형 AI의 엄격한 역할 분리**: 모든 수치 계산(배경 제거, 비평활 피크 프로파일 피팅, 상 매칭, 조건부 Scherrer, Williamson–Hall, Watershed 입자 분할, 선형교차법)은 Python 과학 수치 엔진이 수행하며, Google Gemini는 검증된 결과 ID(`XRD-PHASE-1`, `SEM-STAT-SIZE` 등)와 ROI 이미지만 참조해 설명과 실험 가설을 작성합니다.
- **데이터 출처 투명 구분**: 화면과 PDF 리포트 전체에서 `[측정값]`, `[계산값]`, `[사용자 입력]`, `[규칙 요약]`, `[AI 해석]`, `[샘플]` 배지를 명확히 구분합니다.
- **안전한 실패 처리**: 상수 신호, 피크 겹침, 피크 부족, 스케일 미확인(`px` 유지), 객체 `0개` 등의 상황에서 `0`이나 임의의 정상 수치를 만들어내지 않고 **`계산 불가`** 또는 **`확인 필요`**와 구체적 원인을 표시합니다.
- **API 키 없이도 완결 동작**: `GEMINI_API_KEY`가 없거나 AI 해석을 끈 상태에서도 모든 XRD·SEM 정량 분석, 인터랙티브 차트, 규칙 기반 통합 요약, 한국어 PDF/CSV/JSON 다운로드가 100% 동작합니다.

---

## 2. 프로젝트 구조

```text
matlens-web/
├── .env.example                 # 서버 환경변수 설정 예시 (GEMINI_API_KEY, GEMINI_MODEL 등)
├── docker-compose.yml           # 프런트엔드(Nginx) + 백엔드(FastAPI) 컨테이너 실행 설정
├── run_local.bat                # Windows 로컬 원클릭 실행 스크립트
├── samples/                     # 출처 및 참값(ground_truth.json)이 문서화된 샘플 데이터
├── docs/
│   ├── METHODS_AND_LIMITATIONS.md  # 전체 계산식, 매칭 점수 산식, 물리적 가정 및 한계
│   ├── VERIFICATION_REPORT.md      # 실제 수행한 합성/표준 검증 수치 및 구현 목록
│   └── verification_metrics.json   # 벤치마크 스크립트 실측 출력본
├── backend/                     # Python 3.13 + FastAPI + SciPy + pymatgen + scikit-image + ReportLab
│   ├── requirements.txt         # 호환 검증된 고정 의존성 버전
│   ├── app/
│   │   ├── main.py              # REST API, 파일 검증, 다운로드, SPA 정적 서빙
│   │   ├── jobs.py              # 웹 요청과 분리된 비동기 백그라운드 분석 워커
│   │   ├── db.py                # SQLite 영구 저장소 (프로젝트, 파일 해시, 수정 이력, Run 버전)
│   │   └── engine/              # xrd_engine, sem_engine, ref_library, report_engine, pdf_export
│   ├── scripts/                 # 샘플/기준 DB 생성 및 정량 검증 실행 스크립트
│   └── tests/                   # pytest 자동 검증 테스트 스위트
└── frontend/                    # React 19 + TypeScript + Tailwind CSS + Radix(shadcn/ui) + Plotly.js
```

---

## 3. 설치 및 실행 방법

### 방법 A: Docker Compose 실행 (권장)

1. 환경변수 파일 준비 (선택):
   ```bash
   cp .env.example .env
   # Gemini AI 통합 해석을 사용하려면 .env 파일에 GEMINI_API_KEY=... 를 입력하세요.
   ```
2. 컨테이너 빌드 및 실행:
   ```bash
   docker compose up --build
   ```
3. 브라우저에서 접속:
   - 웹앱 UI: `http://localhost:5173`
   - 백엔드 API 문서(OpenAPI): `http://localhost:8000/docs`

### 방법 B: 로컬 Python + Node 환경 직접 실행 (Windows / macOS / Linux)

1. **백엔드 설치 및 기준 데이터 준비**:
   ```bash
   cd backend
   python -m venv .venv
   # Windows: .\.venv\Scripts\activate  |  macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   python scripts/build_samples_and_refs.py
   ```
2. **프런트엔드 빌드 (또는 개발 서버 실행)**:
   ```bash
   cd ../frontend
   npm install
   npm run build
   ```
   *(프런트엔드를 `npm run build` 해두면 FastAPI 서버가 `http://127.0.0.1:8000` 단일 포트에서 UI와 API를 함께 서빙합니다. 개발 중 HMR을 원하면 별도 터미널에서 `npm run dev`로 `http://localhost:5173`을 열 수 있습니다.)*
3. **서버 실행**:
   - Windows에서는 루트 폴더의 **`run_local.bat`** 실행 또는:
   ```bash
   cd backend
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   - 브라우저에서 `http://127.0.0.1:8000` 접속

---

## 4. 사용 순서 안내

1. **샘플 체험 또는 시료 등록**: 시작 화면에서 **`샘플 분석 시작 (TiO2 분말)`** 버튼을 누르면 전체 흐름을 즉시 체험할 수 있습니다. 직접 분석할 때는 시료명, 예상 원소(선택), **XRD·SEM 동일 시료 여부**를 입력해 시료를 등록합니다.
2. **파일 업로드 및 조건 확인**:
   - **XRD**: CSV 업로드 후 자동 추정된 `2θ` / `Intensity` 열, 파장 프리셋(`Cu Kα 1.5406 Å` 등), 선택적 기기 선폭(`FWHM_inst`)을 확인합니다. 필요 시 사용자 `.cif` 파일도 추가할 수 있습니다.
   - **SEM**: JPG/PNG 업로드 후 캔버스에서 자동 감지된 스케일바 양 끝점과 정보 바 제외 ROI를 확인하고 실제 길이·단위(`nm`, `µm`)를 입력합니다.
3. **분석 실행**: 외부 AI 전송 데이터 범위를 확인하고(AI 해석 스위치 ON/OFF 가능) **`분석 실행`**을 클릭합니다.
4. **결과 검토 및 파라미터 재실행**:
   - **`[XRD]` 탭**: 원본·배경·비평활 정량 신호 비교, 상 후보별 일치/미설명 피크 시각화, 다상 조합 잔차, 조건부 Scherrer 표, Williamson–Hall 회귀를 확인하고 불순물 피크 제외 및 재분석이 가능합니다.
   - **`[SEM]` 탭**: 분할 경계 오버레이 위에서 잘못 분리된 객체를 클릭해 제외하거나 스케일바 길이를 수정해 새 실행(`Run #2`, `Run #3`...)으로 통계를 즉시 재계산합니다.
   - **`[통합 리포트]` 탭**: 규칙 기반 요약과 Gemini AI 가설(근거 ID 툴팁 포함)을 비교 검토하고 **한국어 PDF 리포트, XRD 피크 CSV, SEM 측정 CSV, 전체 JSON, 오버레이 PNG**를 내려받습니다.

---

## 5. 자동 검증 테스트 실행

```bash
cd backend
pytest tests/test_matlens_full.py -v
python scripts/run_verification.py
```

상세한 수식·가정·한계는 [`docs/METHODS_AND_LIMITATIONS.md`](./docs/METHODS_AND_LIMITATIONS.md), 실측 검증 결과는 [`docs/VERIFICATION_REPORT.md`](./docs/VERIFICATION_REPORT.md)를 참고하세요.
