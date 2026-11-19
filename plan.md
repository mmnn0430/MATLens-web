# MatLens 기능 개선 및 안정화 구현 계획 (plan.md)

## 1. 개발 목표 및 개요
1. **사용자가 선택한 기기와 저장된 분석 결과만 사용하는 통합 리포트 (Strictly Scoped Integrated Report)**
   - 초기 진입 시 임의의 시료나 예시 리포트 자동 로드 금지.
   - 1단계: 8개 기기([XRD], [SEM], [UTM], [Hall], [LFA], [FT-IR], [DSC], [TGA]) 선택 카드(저장 건수 표시, 선택 시만 다음 단계 활성화).
   - 2단계: 선택된 기기에 저장된 분석 결과 목록 조회 및 세부 항목 선택 (시료명, 파일명, 실행 번호, 상태, 주요 결과 미리보기, 검색/필터).
   - 3단계: 선택 내용 및 시료 연결 관계(동일 시료 여부) 확인 후 리포트 생성.
   - 백엔드, 프론트엔드, AI 프롬프트, 어시스턴트, PDF 다운로드 전체에서 **명시적으로 선택된 분석 결과만 엄격히 격리 전달** (어떠한 폴백이나 선택 안 된 기기 수치 생성 금지).
   - 리포트 스냅샷 불변 저장 및 선택 변경 시 재생성 안내.

2. **각 기기 화면의 복수 파일 업로드·개별 분석·비교 기능 (Multi-File Batch Upload & Comparative Analysis)**
   - 8개 기기 화면(XRD, SEM, UTM, Hall, LFA, FT-IR, DSC, TGA) 전체에서 복수 파일 동시 선택/드래그앤드롭 업로드 지원.
   - 파일별 독립 분석 및 개별 파라미터 관리 (하나의 긴 데이터로 합치지 않음, 개별 파일 실패 시 정상 파일 보존).
   - 중첩 그래프(색상/범례/토글/툴팁/다운로드) 및 주요 수치 비교표 제공.
   - 각 파일의 분석 결과는 독립 레코드로 저장되어 통합 리포트에서 개별 선택 가능.

---

## 2. 세부 구현 단계 및 작업 순서

### Phase 1: 현행 코드 정밀 분석 및 기술 설계 문서 작성
- `docs/INTEGRATED_REPORT_STRICT_SELECTION_SPEC.md`: 통합 리포트 선택 흐름, 데이터 격리 규칙, AI 프롬프트 제약 및 스냅샷 구조 설계.
- `docs/MULTI_FILE_UPLOAD_AND_COMPARISON_SPEC.md`: 8개 기기 복수 파일 업로드, 개별 분석 파이프라인, 비교 시각화 및 비교표 설계.
- `docs/VERIFICATION_AND_REGRESSION_REPORT.md`: 검증 시나리오 A~G 정의 및 테스트 계획 수립.

### Phase 2: 백엔드 데이터 모델 및 API 확장
1. **저장 분석 결과 통합 조회 API**:
   - `GET /api/v1/saved-analyses`: 8개 기기 전체에 대해 저장된 측정·분석 결과 목록(시료명, 파일명, 기기, 실행 시각, 실행 ID, 상태, 요약 수치)을 조회하는 엔드포인트 구현.
   - `GET /api/v1/saved-analyses/counts`: 8개 기기별 저장 건수 집계 엔드포인트 구현.
2. **엄격한 통합 리포트 생성 및 스냅샷 API**:
   - `POST /api/v1/analysis/integrated-scoped`: 사용자가 명시적으로 선택한 분석 ID 목록(`selected_items: [{ instrument, measurement_id, analysis_id, run_id, sample_id }]`)만 전달받아 검증.
   - 선택되지 않은 기기는 `None`으로 완전 배제하며, 복합 연산(Wiedemann-Franz 등)은 필수 기기(Hall+LFA)가 모두 포함된 경우에만 실행.
   - 불변 리포트 스냅샷(`report_id`, 생성 시각, 선택 목록, 계산 결과) 저장 및 조회 API (`GET /api/v1/reports/{report_id}`).
3. **AI 프롬프트 및 어시스턴트 범위 격리**:
   - `backend/app/services/ai/vertex_gemini.py` 및 `backend/app/api_v1.py` `/assistant/chat`:
   - 선택된 기기와 결과의 수치만을 컨텍스트로 전달하고, 선택되지 않은 기기의 수치나 가설을 임의 생성하지 못하도록 가드레일 프롬프트 적용.
4. **선택 결과 전용 PDF 리포트 생성**:
   - `backend/app/engine/pdf_report_v2.py`: 선택된 기기 및 데이터 세트만 렌더링하도록 템플릿 제약.
5. **기기별 복수 파일 일괄 분석 엔드포인트 보완**:
   - UTM, Hall, LFA, FT-IR, DSC, TGA의 복수 파일 개별 파싱 및 분석 처리 엔드포인트 확인 및 보강.

### Phase 3: 프론트엔드 기기별 복수 파일 업로드 및 비교 화면 구현
1. **UTM (`frontend/src/components/UtmView.tsx`)**:
   - 복수 파일 업로드 드래그앤드롭 및 리스트 관리.
   - 파일별 개별 시험편 치수($A_0, L_0$) 및 분석 파라미터 적용.
   - 다중 응력-변형률 곡선 중첩 Plotly 차트 (색상, 범례, 토글).
   - 인장강도, 탄성계수, 항복강도, 연신율 비교표.
2. **Hall Effect (`frontend/src/components/HallView.tsx`)**:
   - 복수 파일 업로드 및 개별 조건(두께, 전류, 온도).
   - $B$ vs $V_H$ 다중 곡선 중첩 및 전자/정공 수송 특성($n, \mu, \sigma$) 비교표.
3. **LFA (`frontend/src/components/LfaView.tsx`)**:
   - 복수 파일 업로드 및 개별 시편 두께/밀도/비열 설정.
   - 과도 온도 응답 곡선($t$ vs $\Delta T$) 다중 중첩 및 열확산도/열전도도 비교표.
4. **FT-IR / DSC / TGA (`frontend/src/components/SpectroView.tsx`)**:
   - 복수 파일 동시 업로드 및 큐 관리.
   - 파일별 독립 분석 및 스펙트럼/열분석 곡선 중첩 Plotly 차트.
   - FT-IR (피크/간섭무늬 두께), DSC ($T_g, T_c, T_m, \Delta H$), TGA (단계별 감량, $T_{onset}$, 잔류율) 비교표.
5. **XRD & SEM (`frontend/src/components/XrdWorkspace.tsx`, `SemWorkspace.tsx`)**:
   - 복수 파일 업로드 및 개별 런 관리 유지·강화, SEM 시야별/샘플별 비교 뷰 보완.

### Phase 4: 프론트엔드 통합 리포트 신규 사용자 흐름 구현
1. **`frontend/src/components/IntegratedAnalysisView.tsx` 전면 개선**:
   - 초기 진입 시 임의의 시료 및 예시 리포트 자동 로드 완전 차단.
   - **1단계 기기 선택 카드**: 8개 기기 카드 그리드, 저장된 분석 건수 배지, 체크박스 선택 UI.
   - **2단계 저장 분석 결과 선택**: 선택된 기기에 대한 아코디언/패널, 시료명·파일명·실행시각·결과요약 카드, 다중 선택 체크박스, 검색/필터.
   - **3단계 선택 요약 및 시료 연결성 검증**: 선택된 기기 및 결과 수 요약, 동일 시료 연결 여부(Same Specimen vs Series vs Unverified) 안내, 필수 결과 누락 시 안내.
   - **4단계 엄격한 통합 리포트 렌더링**:
     - 선택된 기기의 데이터만 렌더링 (선택 안 된 기기 섹션 완전 배제).
     - 선택된 결과들의 비교 그래프, 표, 연계 메커니즘 분석.
     - 대화형 어시스턴트: 선택된 데이터만 질문/답변하도록 연계.
     - PDF 다운로드: 선택된 데이터만 포함된 보고서 다운로드.
     - 선택 변경 감지 시 "선택 내용이 변경되었습니다. 리포트를 다시 생성해주세요" 안내 표시.

### Phase 5: 전체 검증 및 회귀 테스트 (Verification & Regression)
- 검증 시나리오 A~G 전체 자동화 테스트 및 수동 검증:
  - Scenario A: 초기 진입 시 8개 기기 표시, 자동 로드 없음.
  - Scenario B: XRD·SEM만 선택 시 두 기기 결과만 사용, 타 기기 완전 배제.
  - Scenario C: 같은 시료라도 선택하지 않은 UTM 등 배제, 변경 시 오래된 상태 표시.
  - Scenario D: UTM 복수 파일(3개) 업로드, 독립 분석, 곡선 중첩, 비교표 일치, 개별 실패 격리.
  - Scenario E: 복수 결과 중 2개만 선택 시 PDF/AI/표에서 미선택 파일 완전 제외.
  - Scenario F: 새로고침 후에도 저장 결과 정상 조회/선택, 기존 데이터 보존.
  - Scenario G: AI API 키 없이도 규칙 기반 요약 및 비교 기능 정상 동작.
- 백엔드 pytest 전체 통과 확인.
- 프론트엔드 TypeScript 빌드 (`tsc -b && vite build`) 무오류 통과.

### Phase 6: 배포 준비 및 로컬 최종 검증 완료 (운영 배포 대기)
- 운영 서비스 자동 배포 금지 원칙 준수: 원격 운영 서비스에 자동 푸시/배포하지 않고 로컬 검증 및 스테이징/배포 준비 완료 상태 유지.
- Git 변경사항 검토 및 로컬 커밋 생성 준비 완료.
- 사용자 확인 후 필요 시 배포 명령을 실행할 수 있도록 배포 가이드 문서화.
- 최종 상세 보고서 작성.
