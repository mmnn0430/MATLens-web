# 통합 리포트 기기 및 저장 분석 결과 선택 격리 사양서 (docs/INTEGRATED_REPORT_STRICT_SELECTION_SPEC.md)

## 1. 개요 및 설계 원칙

본 문서는 MatLens의 **통합 리포트(Integrated Report)**가 사용자가 명시적으로 선택한 기기와 분석 결과만을 사용하여 리포트, 계산, 요약, AI 입력, 그래프, 표, 대화형 연구 어시스턴트 및 PDF 다운로드를 수행하도록 제한하는 사양을 정의합니다.

### 핵심 설계 원칙
1. **임의 자동 로드 원천 차단 (No Auto-Loading)**:
   - 통합 리포트 화면(`/integrated`) 첫 진입 시 임의의 예시 데이터나 기본 시료를 자동으로 분석/렌더링하지 않는다.
   - 브라우저 로컬 스토리지에 남아있는 이전 탭의 잔여 데이터가 무단 주입되지 않도록 격리한다.
2. **단계별 선택 흐름 (3-Stage Workflow)**:
   - **1단계**: 사용할 기기 선택 (8개 기기 카드 체크박스)
   - **2단계**: 선택된 기기의 저장된 구체적 분석 결과 선택 (기기별 다중 선택, 파일/실행 번호/상태/요약 표시)
   - **3단계**: 선택 요약 및 시료 연결성 확인 (동일 시료 여부 검증) → 리포트 생성
3. **엄격한 데이터 범위 격리 (Strict Scope Isolation)**:
   - 백엔드와 프론트엔드, AI 컨텍스트, PDF 생성 파이프라인 모두 사용자가 선택한 결과 ID만 조회 및 전달한다.
   - 선택되지 않은 기기의 계산(예: Hall과 LFA가 모두 선택되지 않은 경우 Wiedemann-Franz 전자/격자 열전도도 분리 계산)을 아예 수행하지 않는다.
   - "선택된 결과가 없으면 전체 조회"와 같은 암묵적 fallback을 전면 금지한다.
4. **리포트 스냅샷 불변성 (Report Snapshot Immutability)**:
   - 생성된 리포트는 고유 `report_id`, 생성 시각, 선택된 분석 결과 ID 목록과 함께 스냅샷으로 보존된다.
   - 사용자가 상단 선택을 변경할 경우 즉시 "선택 내용이 변경되었습니다. 리포트를 다시 생성해주세요" 안내를 표시하고 이전 리포트와 혼동되지 않도록 분리한다.

---

## 2. 사용자 인터페이스 (UI/UX) 흐름 설계

### 2.1 1단계: 사용할 기기 선택 카드 (8개 기기)
- 화면 상단에 8개 분석 기기가 카드 형태로 나열됨:
  1. `XRD` (X-ray Diffraction)
  2. `SEM` (Scanning Electron Microscopy)
  3. `UTM` (Universal Testing Machine)
  4. `Hall` (Hall Effect Measurement)
  5. `LFA` (Laser Flash Analysis)
  6. `FT-IR` (Fourier-Transform Infrared Spectroscopy)
  7. `DSC` (Differential Scanning Calorimetry)
  8. `TGA` (Thermogravimetric Analysis)
- 각 카드 구성:
  - 기기 아이콘 및 한글/영문 기기명
  - 저장된 분석 결과 수 배지 (예: `2건 저장됨` 또는 `저장된 분석 결과 없음`)
  - 체크박스 토글
- 기기 선택 해제 시: 해당 기기 아래 선택되어 있던 모든 분석 결과 체크도 즉시 자동 해제.
- 저장된 결과가 없는 기기 선택 시: "선택된 기기에 저장된 분석 결과가 없습니다. 해당 기기 화면에서 먼저 파일을 업로드하고 분석해 주세요." 안내 및 바로가기 버튼 제공.

### 2.2 2단계: 선택한 기기의 저장된 분석 결과 선택
- 1단계에서 체크된 기기들에 한해서만 선택 패널이 펼쳐짐 (미선택 기기는 DOM 및 UI에서 완전히 숨김).
- 각 저장된 결과 항목 카드:
  - 시료명 / 시료 코드 (`sample_name`, `sample_code`)
  - 원본 파일명 (`original_filename`)
  - 분석 실행 시각 (`created_at`)
  - 실행 번호 / 버전 (`run_number` 또는 `measurement_id`)
  - 상태 배지 (`완료`, `확인 필요`, `계산 불가`, `분석 필요`)
  - 대표 결과 요약 텍스트 (예: `UTS 480.0 MPa · E 168.0 GPa`, `α 2.10 mm²/s`, `D50 45.5 nm` 등)
- 상단 편의 기능:
  - 시료명 / 파일명 검색 입력창
  - 시료별 필터 드롭다운
  - 선택 항목 전체 해제 버튼

### 2.3 3단계: 선택 요약 및 시료 연결성 검증
- 요약 헤더: 예) **"2개 기기 · 3개 분석 결과 선택됨"**
- 검증 기준:
  - 선택한 모든 기기에 대해 최소 1개 이상의 분석 결과가 선택되어 있어야 "통합 리포트 생성" 버튼 활성화.
  - 선택되지 않은 기기가 남아있을 경우 비활성화 상태로 안내 텍스트 표시 (예: "SEM 분석 결과를 1개 이상 선택해 주세요").
- 시료 연결 관계 판별 (Linkage Assessment):
  - **동일 시료 (Same Specimen)**: 선택된 모든 결과의 `sample_id`가 일치할 때 → "동일 시료 [시료명] 연결 확인"
  - **동일 시리즈 (Connected Series)**: 모재/조성은 같으나 시편 번호가 다른 경우 → "동일 재료 시리즈 시편 비교로 처리"
  - **이종 시료 (Unverified / Different Samples)**: 시료가 다른 경우 → "주의: 서로 다른 시료([시료A], [시료B])가 포함되었습니다. 단일 시료 특성으로 합치지 않고 비교 분석 대상으로 분리 처리합니다."

---

## 3. 백엔드 데이터 모델 및 API 사양

### 3.1 저장된 분석 결과 통합 조회 API
- **Endpoint**: `GET /api/v1/saved-analyses`
- **Query Params**:
  - `instrument` (optional): `xrd | sem | utm | hall | lfa | ftir | dsc | tga`
  - `sample_id` (optional): 특정 시료 ID 필터
- **Response**:
```json
{
  "total_count": 12,
  "counts_by_instrument": {
    "xrd": 2, "sem": 3, "utm": 2, "hall": 1,
    "lfa": 1, "ftir": 1, "dsc": 1, "tga": 1
  },
  "items": [
    {
      "id": "ares_1a2b3c",
      "measurement_id": "meas_01",
      "instrument": "utm",
      "sample_id": "proj_123",
      "sample_name": "Nb0.8Ti0.2FeSb",
      "original_filename": "tensile_01.csv",
      "run_id": null,
      "run_number": 1,
      "status": "completed",
      "summary_text": "UTS 480.0 MPa · Yield 412.0 MPa · Modulus 168.0 GPa",
      "created_at": "2026-11-19T14:30:00Z",
      "results_preview": { ... }
    }
  ]
}
```

### 3.2 격리된 통합 리포트 실행 API
- **Endpoint**: `POST /api/v1/analysis/integrated-scoped`
- **Request Body**:
```json
{
  "selected_items": [
    {
      "instrument": "xrd",
      "file_id": "file_111",
      "run_id": "run_222",
      "sample_id": "proj_123"
    },
    {
      "instrument": "sem",
      "file_id": "file_333",
      "run_id": "run_444",
      "sample_id": "proj_123"
    }
  ],
  "temperature_K": 300.0,
  "include_ai_interpretation": true
}
```
- **서버 검증 로직**:
  1. 전달받은 `selected_items` 외의 다른 기기 데이터(`utm_data`, `hall_data`, `lfa_data` 등)는 무조건 `None`으로 설정.
  2. DB에서 각 ID의 실재성 및 무결성 검증.
  3. `instruments_included` 목록을 전달된 기기로만 엄격 제한.
  4. Wiedemann-Franz 연산은 `hall`과 `lfa`가 둘 다 선택되고 LFA에 유효한 밀도/비열이 존재할 때만 수행. 미충족 시 해당 필드 `null`.
  5. 고유 `report_id` 발급 및 스냅샷 DB 저장.

### 3.3 리포트 스냅샷 조회 API
- **Endpoint**: `GET /api/v1/reports/{report_id}`
- 생성 시점의 선택 목록, 계산 결과, AI 해석, 메타데이터를 그대로 반환하여 원본 분석이 재실행되더라도 기존 리포트의 불변성을 보장.

---

## 4. AI 해석 및 다운로드 연동

1. **AI 프롬프트 가드레일**:
   - 프롬프트에 "현재 리포트에는 사용자가 선택한 [선택 기기 목록]의 결과만 포함되어 있습니다. 선택되지 않은 기기에 대해 가상의 측정값이나 결론을 도출하지 마십시오." 시스템 가드 주입.
2. **대화형 어시스턴트 (`/api/v1/assistant/chat`)**:
   - `report_id` 또는 선택된 결과 요약만을 프롬프트 컨텍스트로 전달.
3. **PDF 다운로드 (`/api/v1/reports/pdf`)**:
   - 선택된 기기와 데이터만 포함된 전용 템플릿 렌더링. 미선택 기기 섹션 완전 제거.
