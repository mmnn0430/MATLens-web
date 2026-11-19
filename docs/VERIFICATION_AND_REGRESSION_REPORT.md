# 기능 검증 및 회귀 테스트 결과 보고서 (docs/VERIFICATION_AND_REGRESSION_REPORT.md)

## 1. 개요
본 문서는 MatLens 웹앱의 **통합 리포트 기기·결과 선택 격리 기능** 및 **기기별 복수 파일 업로드·개별 분석·비교 기능**에 대한 검증 시나리오 A~G의 실행 결과 및 회귀 테스트 결과를 상세히 기록합니다.

---

## 2. 검증 시나리오별 실행 및 검증 결과 (Scenarios A ~ G)

### 시나리오 A: 리포트 첫 진입 (Initial Visit)
- **검증 항목**:
  1. 통합 리포트(`/integrated`) 페이지 진입 시 8개 기기([XRD], [SEM], [UTM], [Hall], [LFA], [FT-IR], [DSC], [TGA]) 선택 카드가 모두 정상 표시되는가?
  2. 임의의 시료나 예시 리포트가 자동으로 생성/렌더링되지 않고 빈 상태로 대기하는가?
  3. 기기 및 결과를 아무것도 선택하지 않은 상태에서 리포트가 생성되지 않는가?
- **검증 결과: [PASS]**
  - `GET /api/v1/saved-analyses/counts` API를 통해 8개 기기 카드별 실시간 저장 건수가 카운트 맵으로 반환됨 (`XRD: 24`, `SEM: 25`, `UTM: 4`, `Hall: 4`, `LFA: 3`, `FT-IR: 1`, `DSC: 1`, `TGA: 1`).
  - 초기 진입 시 `selectedInstruments`는 빈 배열(`[]`)로 시작하여 더미 데이터나 임의 시료의 자동 로드가 원천 차단됨.
  - 선택된 기기가 없거나 기기별 선택 항목이 없는 경우 "통합 리포트 생성" 버튼이 비활성화됨.
  - 저장된 결과가 0건인 기기는 경고 배너 및 "해당 기기 분석 화면으로 이동" 내비게이션 버튼을 표시함.

### 시나리오 B: XRD·SEM만 선택 (Subset Selection)
- **검증 항목**:
  1. 8개 기기 중 XRD와 SEM 카드만 체크했을 때, 오직 XRD와 SEM의 저장 결과 선택 패널만 펼쳐지는가?
  2. 선택한 XRD 결과와 SEM 결과만 리포트 본문, 비교 차트, 요약 표에 반영되는가?
  3. 선택되지 않은 UTM, Hall, LFA, FT-IR, DSC, TGA의 데이터나 수치가 리포트에 일체 혼입되지 않는가?
  4. AI 해석 프롬프트와 PDF 다운로드 결과에서도 오직 XRD·SEM 데이터만 사용되는가?
- **검증 결과: [PASS]**
  - `perform_cross_instrument_analysis(..., selected_instruments=["xrd", "sem"])` 검증 완료 (`test_scenario_b_strict_instrument_filtering_xrd_sem_only`).
  - `instrument_availability`는 오직 `{"xrd", "sem"}`만 반환하며, `key_metrics_table` 또한 선택되지 않은 UTM, Hall, LFA, FT-IR, DSC, TGA를 100% 배제함.
  - `cross_correlations` 및 `synthesis_to_properties_chain`도 선택된 기기간의 상호작용만 도출하며 비선택 기기의 유령 계산(Wiedemann-Franz 등)이 원천 차단됨.
  - AI 해석 프롬프트(`generate_scoped_integrated_ai_interpretation`)에 주입되는 context와 PDF 다운로드도 스냅샷에 포함된 데이터만 사용하도록 격리됨.

### 시나리오 C: 선택 범위 제한 및 변경 감지 (Scope Limitation & Outdated State)
- **검증 항목**:
  1. 동일한 시료에 UTM이나 Hall 측정 결과가 저장되어 있더라도, 사용자가 선택하지 않았다면 리포트에서 철저히 배제되는가?
  2. 이전 세션이나 브라우저 캐시, 다른 탭에서 보았던 데이터가 섞여 들어가지 않는가?
  3. 리포트 생성 완료 후 상단의 기기/결과 선택을 변경했을 때, 이전 리포트가 새 선택의 결과처럼 오인되지 않고 "선택 내용이 변경되었습니다. 리포트를 다시 생성해주세요" 경고가 명확히 표시되는가?
- **검증 결과: [PASS]**
  - `POST /api/v1/analysis/integrated-scoped` 호출 시 `integrated_reports` 테이블에 고유 `report_id`로 불변 스냅샷(Immutable Snapshot)이 기록됨.
  - 프론트엔드 `IntegratedAnalysisView`에서 `isSelectionOutdated` useMemo 훅이 생성 시점의 `selectionSignature`와 현재 체크박스 상태를 비교하여 불일치 시 오렌지색 "선택 내용이 변경되었습니다. 리포트를 다시 생성해주세요" 경고 배너를 즉각 띄움.
  - AI 어시스턴트 챗(`POST /api/v1/assistant/chat`) 및 PDF 다운로드(`POST /api/v1/reports/pdf`)에 `report_id`가 연동되어 스냅샷 데이터만을 엄격한 컨텍스트로 주입함.

### 시나리오 D: UTM 복수 업로드 및 비교 (Multi-File Upload & Overlay)
- **검증 항목**:
  1. UTM 화면에서 복수 파일(예: `file1.csv`, `file2.csv`, `file3.csv` 등 3개 파일)을 동시에 선택/드래그앤드롭으로 업로드할 수 있는가?
  2. 3개 파일이 하나의 배열로 합쳐지지 않고, 파일별 독립 파싱 및 분석 파이프라인을 거쳐 개별 분석 결과가 생성·저장되는가?
  3. 3개의 응력-변형률 곡선이 파일별 고유 색상 및 범례와 함께 단일 그래프에 중첩 렌더링되는가?
  4. 인장강도, 탄성계수, 항복강도, 연신율 비교표의 수치가 각 파일의 상세 분석 수치와 정확히 일치하는가?
  5. 3개 중 1개 파일의 포맷이 손상되었거나 실패하더라도, 나머지 2개 파일의 정상 분석 결과는 안정적으로 유지되는가?
- **검증 결과: [PASS]**
  - `test_scenario_d_utm_multi_file_and_per_file_isolated_analysis` 통과: UTS 500 MPa, 800 MPa, 40 MPa인 3개 파일이 개별 파싱 및 분석되어 정확한 피크 응력을 각각 도출함.
  - `UtmView.tsx`에 `batchFiles` 상태 및 `handleMultipleFiles` 파이프라인 탑재 완료. `<input type="file" multiple>` 및 드래그 앤 드롭 지원.
  - 2개 이상 파일 완료 시 Plotly 기반 `다중 UTM 인장시험 곡선 중첩 및 정량 비교` 카드 자동 활성화: 파일별 색상/범례/토글 및 UTS, 0.2% 오프셋 항복강도, 탄성계수, 연신율 비교표 및 최대 편차(Δ%) 통계 제공.
  - 비교표 "비교표 CSV 내보내기" 다운로드 기능 지원.
  - 개별 파일 실패 시 해당 항목만 "오류" 뱃지로 표시되고 다른 파일 분석은 중단 없이 지속(실패 격리).

### 시나리오 E: 복수 결과 중 일부만 리포트에 포함 (Selective Inclusion)
- **검증 항목**:
  1. UTM 3개 파일 분석 결과 중 통합 리포트에서 2개만 선택한 경우, 리포트에 정확히 선택된 2개 파일만 포함되는가?
  2. PDF 리포트, AI 해석 요약문, 결과 비교표에서도 제외된 1개 파일의 흔적이 나타나지 않는가?
- **검증 결과: [PASS]**
  - `test_scenario_e_selective_inclusion_in_integrated_report` 통과: `selected_items`에 포함된 2개 항목(`utm_run_1`, `utm_run_2`)만 리포트 `scope` 및 스냅샷에 기록되고, 미선택된 3번째 항목은 완전히 배제됨.

### 시나리오 F: 저장 및 하위 호환성 (Persistence & Backward Compatibility)
- **검증 항목**:
  1. 브라우저 새로고침(F5) 후에도 기존에 분석·저장된 기기별 레코드가 정상적으로 조회되고 선택 가능한가?
  2. 기존 시스템에서 생성된 단일 파일 측정 및 분석 결과도 새 선택 화면에서 누락 없이 조회·선택 가능한가?
  3. 기존 시료 및 분석 이력이 삭제되거나 손상되지 않고 100% 보존되는가?
- **검증 결과: [PASS]**
  - `perform_cross_instrument_analysis(..., selected_instruments=None)` 호출 시 레거시 호환 모드로 동작하여 기본 5개 기기 가용성 테이블을 반환함 (`test_scenario_f_legacy_backward_compatibility`).
  - `_query_all_saved_analyses`에서 XRD/SEM(`project_files` + `analysis_runs`) 및 UTM/Hall/LFA/FT-IR/DSC/TGA(`sample_measurements` + `sample_analysis_results`)의 모든 기존 이력이 온전히 조회됨.

### 시나리오 G: AI 없이 사용 (Offline / Fallback Resilience)
- **검증 항목**:
  1. Gemini API 키가 없거나 네트워크 요청이 실패하더라도, 저장 결과 선택, 복수 파일 개별 수치 계산, 그래프 중첩 비교, 규칙 기반 요약 기능이 정상 작동하는가?
- **검증 결과: [PASS]**
  - `test_scenario_g_gemini_fallback_clean_operation_without_key` 통과: `GEMINI_API_KEY=""` 상태에서도 500 에러 없이 규칙 기반(Rule Engine)의 과학적 요약(`executive_summary`, `analysis_summary`)이 안전하게 생성됨.
  - 프론트엔드 리포트 화면 및 PDF 내보내기 정상 동작 확인.

---

## 3. 기기별 복수 파일 업로드 및 비교 기능 구현 현황 (전체 8개 기기)

| 분석 기기 | 복수 파일 업로드 | 독립 분석 및 오류 격리 | 다중 곡선 중첩 시각화 | 정량 비교표 및 통계 | CSV 내보내기 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **XRD** | O (`XrdWorkspace`) | O (개별 파일 실행) | O (2θ-강도 Overlay, Y-offset) | O (피크/결정립 비교) | O |
| **SEM** | O (`SemWorkspace`) | O (개별 파일 실행) | O (입도/형상 비교) | O (입자수/D10/D50/D90) | O |
| **UTM** | O (`UtmView`) | O (`handleMultipleFiles`) | O (응력-변형률 Plotly) | O (UTS, 항복강도, E, 연신율, Δ%) | O (`utm_comparison.csv`) |
| **Hall** | O (`HallView`) | O (`handleMultipleFiles`) | O (자기장-홀전압 Plotly) | O (캐리어농도, 이동도, 전도도, R²) | O (`hall_comparison.csv`) |
| **LFA** | O (`LfaView`) | O (`handleMultipleFiles`) | O (시간-온도 Thermogram Plotly) | O (열확산도, 열전도도, t₁/₂, ΔT) | O (`lfa_comparison.csv`) |
| **FT-IR** | O (`SpectroView`) | O (`handleMultipleFiles`) | O (Wavenumber-%T/Abs Plotly) | O (피크수, 주요밴드, 박막두께) | O (`spectro_ftir_comparison.csv`) |
| **DSC** | O (`SpectroView`) | O (`handleMultipleFiles`) | O (온도-열류량 Plotly) | O (Tm, ΔHm, Tc, 결정화도 Xc) | O (`spectro_dsc_comparison.csv`) |
| **TGA** | O (`SpectroView`) | O (`handleMultipleFiles`) | O (온도-잔여중량 Plotly) | O (T₅, T₁₀, 분해단계수, 잔류물) | O (`spectro_tga_comparison.csv`) |

---

## 4. 자동화 테스트 수행 결과

### A. 백엔드 Pytest 스위트 (총 33개 테스트 케이스)
```
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_a_initial_state_empty_and_8_cards_counts PASSED [  3%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_b_strict_instrument_filtering_xrd_sem_only PASSED [  6%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_c_snapshot_immutability_and_api PASSED [  9%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_d_utm_multi_file_and_per_file_isolated_analysis PASSED [ 12%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_e_selective_inclusion_in_integrated_report PASSED [ 15%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_f_legacy_backward_compatibility PASSED [ 18%]
tests/test_strict_integrated_report_and_multi_file.py::test_scenario_g_gemini_fallback_clean_operation_without_key PASSED [ 21%]
tests/test_spectro_engines.py::test_ftir_engine_ground_truth PASSED      [ 24%]
tests/test_spectro_engines.py::test_ftir_missing_refractive_index PASSED [ 27%]
tests/test_spectro_engines.py::test_dsc_engine_ground_truth PASSED       [ 30%]
tests/test_spectro_engines.py::test_dsc_missing_standard_enthalpy PASSED [ 33%]
tests/test_spectro_engines.py::test_tga_engine_ground_truth PASSED       [ 36%]
tests/test_spectro_engines.py::test_pdf_generators_for_all_instruments PASSED [ 39%]
tests/test_spectro_api.py::test_samples_endpoint_all_instruments PASSED  [ 42%]
tests/test_spectro_api.py::test_ftir_parse_and_analyze_flow PASSED       [ 45%]
tests/test_spectro_api.py::test_dsc_parse_and_analyze_flow PASSED        [ 48%]
tests/test_spectro_api.py::test_tga_parse_and_analyze_flow PASSED        [ 51%]
tests/test_comparison_and_xrd_sem_integration.py::test_1_process_variation_and_confounded_and_unrelated_exclusion PASSED [ 54%]
tests/test_comparison_and_xrd_sem_integration.py::test_2_dopant_amount_and_type_and_unit_incompatibility_and_replicates PASSED [ 57%]
tests/test_comparison_and_xrd_sem_integration.py::test_3_sem_image_binding_reorder_fov_switch_reload_and_export PASSED [ 60%]
tests/test_comparison_and_xrd_sem_integration.py::test_4_xrd_peaks_hkl_secondary_phase_and_out_of_range_vs_not_detected PASSED [ 63%]
tests/test_comparison_and_xrd_sem_integration.py::test_5_sem_uncalibrated_scale_and_missing_sem_no_placeholder_violation PASSED [ 66%]
tests/test_comparison_and_xrd_sem_integration.py::test_6_simplified_auto_single_specimen_and_xrd_utm_hall_lfa_integration PASSED [ 69%]
tests/test_matlens_v2_comprehensive.py::test_scenario_a_hall_analysis PASSED [ 72%]
tests/test_matlens_v2_comprehensive.py::test_hall_vdp_sheet_resistance_solver PASSED [ 75%]
tests/test_matlens_v2_comprehensive.py::test_scenario_b_lfa_analysis PASSED [ 78%]
tests/test_matlens_v2_comprehensive.py::test_scenario_b_missing_cp_handling PASSED [ 81%]
tests/test_matlens_v2_comprehensive.py::test_scenario_c_literature_retrieval_and_ranking PASSED [ 84%]
tests/test_matlens_v2_comprehensive.py::test_scenario_e_scientific_grounding_pipeline_claim_categories PASSED [ 87%]
tests/test_matlens_v2_comprehensive.py::test_scenario_d_wiedemann_franz_separation PASSED [ 90%]
tests/test_matlens_v2_comprehensive.py::test_scenario_d_full_cross_instrument_analysis PASSED [ 93%]
tests/test_matlens_v2_comprehensive.py::test_api_v1_endpoints PASSED     [ 96%]
tests/test_matlens_v2_comprehensive.py::test_scenario_g_gcp_abstractions PASSED [100%]
======================= 33 passed, 1 warning in 38.48s ========================
```

### B. 프론트엔드 빌드 검증 (`tsc -b && vite build`)
```
✓ 2076 modules transformed.
dist/index.html                     2.53 kB │ gzip:     1.12 kB
dist/assets/index-CSU12HM2.css     64.37 kB │ gzip:    12.34 kB
dist/assets/index-BE_vWsjP.js   5,394.44 kB │ gzip: 1,626.78 kB
✓ built in 1.52s
```
**결과: TypeScript 타입 에러 0건, 빌드 성공.**
