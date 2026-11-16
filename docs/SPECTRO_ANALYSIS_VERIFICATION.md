# MatLens FT-IR · DSC · TGA 원시 데이터 분석 기능 명세 및 보고서 검증 대응표

> **작성 일자:** 2026년 11월 16일  
> **개발 브랜치:** `feature/ftir-dsc-tga` (Worktree: `matlens-thermal-ir`)  
> **엔진 버전:** `matlens-spectro-1.0.0`

---

## 1. 개요 및 원칙

본 문서는 MatLens 재료 분석 플랫폼에 신규 확장된 **FT-IR(적외선 흡수분광법), DSC(시차주사열량측정법), TGA(열중량분석법)** 원시 데이터 분석 파이프라인의 설계, 계산식, 학생/문헌 보고서 대조표 및 검증 결과를 기록합니다.

### 핵심 개발 원칙
1. **기존 기능 완전 보존 (Zero Regression):**
   - XRD 회절 피크 피팅, 상 동정(Reference Library), SEM 미세조직 분할/절편법, UTM 인장시험 엔진 및 DB 스키마는 100% 독립 유지되며 임의 변경하지 않습니다.
   - 새로운 FT-IR, DSC, TGA 분석 결과는 기존 XRD·SEM 통합 해석에 자동으로 강제 병합되지 않으며, 독립적인 작업 공간(`SpectroView`)과 전용 API 엔드포인트(`/api/spectro/...`)를 통해 동작합니다.
2. **엄격한 파이썬 계산 엔진 우선:**
   - 피크 검출, 변환, 수치 적분(엔탈피), 1차 미분(DTG), 박막 간섭 주기 계산 등 모든 정량적 수치는 Python 수치 라이브러리(`numpy`, `scipy`, `pandas`)를 통해 계산됩니다.
   - Gemini LLM은 수치 계산이 완료된 구조화된 지표(`evidence_registry`)를 기반으로 과학적 설명과 해석 가설을 보조하는 용도로만 제한됩니다.
3. **독립 실행성 보장:**
   - Gemini API 키가 없거나 외부 통신이 차단된 환경에서도 수치 분석, 그래프 시각화, 규칙 기반(Rule-based) 요약, 한국어 PDF/CSV/JSON/PNG 내보내기가 완전하게 작동합니다.

---

## 2. 세 보고서 대조 및 기술 구현 대응표

### 2-1. [보고서 1] 적외선 흡수분광법에 의한 고분자의 분석 및 막두께 측정

| 구분 | 보고서 내용 및 발견된 결함 | MatLens 엔진의 올바른 처리 및 구현 방법 |
| :--- | :--- | :--- |
| **결과 항목** | • 폴리스티렌(PS) 등 고분자의 작용기 흡수 밴드 판독<br>• 간섭무늬(Interference Fringes)를 이용한 박막 두께 측정 | • 파수별 투과율(%T) ↔ 흡광도(A) 변환<br>• 피크 자동 검출 및 작용기 데이터베이스 대조<br>• Fabry-Perot 간섭 주기 기반 박막 두께 정량화 |
| **필요 입력 & 조건** | • 파수(Wavenumber, cm⁻¹) 및 신호 열<br>• 신호 종류(%T 또는 Absorbance)<br>• **시료 굴절률 (Refractive Index, $n$)** | • 파일 파서가 구분자, 다중 헤더, 단위 자동 추정<br>• 사용자가 굴절률 $n$을 수정/확인 가능<br>• 굴절률 미입력 시 광학적 두께($n \cdot d$)만 산출 |
| **계산 방법** | 보고서 수식:<br>$d = \frac{m}{2 \Delta\nu}$ (굴절률 $n$ 누락 위험 존재) | **수직 입사 엄격 물리식 적용:**<br>$$d = \frac{m \cdot 10^4}{2 \cdot n \cdot \|\nu_1 - \nu_2\|} \quad (\mu\text{m})$$<br>• $k$개 극값 검출 시 구간 수 $m = k - 1$로 정밀 정의<br>• 흡광도 변환: $A = -\log_{10}(T) = -\log_{10}(\%T / 100)$ |
| **출력물** | • 4000 ~ 400 cm⁻¹ 투과/흡광 스펙트럼<br>• 주요 흡수대 및 간섭무늬 영역 확대도 | • x축 좌우 반전(4000 → 400 cm⁻¹) 표준 스펙트럼<br>• 검출 피크 툴팁 및 작용기 매칭표<br>• 구간별 두께 일관성(CV%) 및 광학/물리 두께 표 |
| **적용 한계 & 보고서 오류 주의** | **[주의사항 1]** 보고서에서 굴절률 $n$을 명시하지 않고 $2\Delta\nu$로 나누어 실제 물리 두께가 아닌 광학 두께를 물리 두께인 양 오인하는 오류가 발생하기 쉬움.<br>**[주의사항 2]** 단일 피크(예: C=O 1720 cm⁻¹)만으로 특정 고분자 물질명을 확정하는 것은 비과학적임. | • $n$ 미입력 시 '물리적 두께 계산 불가(확인 필요)'로 명시하고 $n \cdot d$만 제공.<br>• 단일 피크 기반 물질명 날조 차단, 지문 영역(Fingerprint region, <1500 cm⁻¹) 다중 피크 조합 제시. |

---

### 2-2. [보고서 2] DSC에 의한 에폭시 수지의 열분석

| 구분 | 보고서 내용 및 발견된 결함 | MatLens 엔진의 올바른 처리 및 구현 방법 |
| :--- | :--- | :--- |
| **결과 항목** | • 에폭시 경화 반응 및 반결정성 고분자 열이력 분석<br>• 유리전이온도($T_g$), 냉결정화($T_{cc}$), 결정화($T_c$), 용융($T_m$)<br>• 융해 엔탈피($\Delta H_m$) 및 결정화도($X_c$) | • 열이력 단계 분리(1st Heat → Cool → 2nd Heat)<br>• 단계별 전이온도 및 융해/결정화 피크 검출<br>• 선형 베이스라인 엔탈피 수치 적분<br>• 조건부 상대 결정화도 계산 |
| **필요 입력 & 조건** | • 온도(°C), 열유속(mW 또는 W/g), 시간(s)<br>• 시료 질량(mg)<br>• **기준 100% 결정 엔탈피 ($\Delta H_m^\circ$, J/g)** | • 열유속 단위 정규화 (mW / mg $\to$ W/g)<br>• 사용자가 $\Delta H_m^\circ$를 시료별 문헌치로 직접 입력 (임의 고정값 강제 배제) |
| **계산 방법** | 보고서에서 100 J/g을 임의 기본값으로 차용하는 오류 존재 | **물리 열역학 적분식 적용:**<br>$$\Delta H = \frac{1}{m} \int [q(t) - q_{\text{baseline}}(t)]\,dt \quad (\text{J/g})$$<br>$$X_c = \frac{\Delta H_m - \Delta H_{cc}}{w \cdot \Delta H_m^\circ} \times 100 \quad (\%)$$<br>• $\Delta H_m^\circ$ 미입력 시 $X_c$를 계산 불가('기준 필요')로 처리 |
| **출력물** | • DSC 열유속 곡선 (Endo Up / Exo Down)<br>• 1차 온도 미분 곡선 $d(HF)/dT$ | • 상전이 피크 및 엔탈피 면적 음영 표시 차트<br>• $T_g, T_c, T_m, \Delta H_m, \Delta H_c, X_c$ 핵심 지표 카드<br>• 사용한 대입값 투명성 서술표 |
| **적용 한계 & 보고서 오류 주의** | **[주의사항 1]** 보고서 제목이 '에폭시'라 하여 모든 DSC를 경화 발열 반응으로 단정하지 않음.<br>**[주의사항 2]** $\Delta H_m^\circ = 100\text{ J/g}$을 모든 고분자에 일괄 적용하는 오류 엄금 (예: PET는 140 J/g, PE는 293 J/g). | • 가열/냉각/재가열 다단계 사이클을 자동 감지하여 1차 가열의 잔류 응력과 2차 가열의 고유 열특성을 분리.<br>• 기준 엔탈피 미입력 시 임의 정상 수치(0% 등)로 대체하지 않고 '기준 엔탈피 입력 대기'로 명시. |

---

### 2-3. [보고서 3] TGA에 의한 고분자의 열분해

| 구분 | 보고서 내용 및 발견된 결함 | MatLens 엔진의 올바른 처리 및 구현 방법 |
| :--- | :--- | :--- |
| **결과 항목** | • 온도에 따른 고분자 열분해 거동<br>• 열안정성 지표 ($T_5, T_{10}$ 온셋 온도)<br>• 다단계 감량 단계(가소제, 고분자 사슬 분해, 카본블랙 연소)<br>• 무기 회분 잔류량(Ash/Residue) | • 잔존 질량 백분율(Weight %) 정규화<br>• 1차 미분 열중량(DTG, $-dW/dT$) 피크 감지<br>• 선형 보간을 통한 정밀 $T_5, T_{10}$ 산출<br>• 다단계 분해 구간 질량 감량 정량화 ($\Delta W\%$, $\Delta m$) |
| **필요 입력 & 조건** | • 온도(°C), 질량(mg 또는 %)<br>• 시간(s)<br>• 초기 질량($m_0$, mg)<br>• 분위기 전환 온도 (Gas Switch Temp, 예: 600°C) | • 입력 단위가 %인지 mg인지 자동 확인<br>• 분위기 가스 전환 조건(질소 $\to$ 공기/산소)을 사용자가 직접 설정 및 검증 가능 |
| **계산 방법** | 단순 육안 판독 또는 단일 온도 구간 가정 | **수치 미분 및 역보간 수식 적용:**<br>$$\text{Weight } \% = \frac{m(T)}{m_0} \times 100$$<br>$$\text{DTG } (\%/^\circ\text{C}) = -\frac{d(\text{Weight } \%)}{dT}$$<br>• $W(T) = 95.0\%$, $90.0\%$ 교차점을 선형 역보간하여 $T_5, T_{10}$ 산정 |
| **출력물** | • TGA 잔존 질량 곡선 + DTG 분해속도 곡선<br>• 분위기 전환점 수직 보조선 | • 2-Panel Plotly/ReportLab 차트 (TGA + DTG)<br>• 단계별 감량률($\Delta W\%$) 및 잔류물 분석표<br>• 분위기 조건별(불활성 vs 산화성) 분해 메커니즘 표 |
| **적용 한계 & 보고서 오류 주의** | **[주의사항 1]** 특정 실험의 승온 속도(예: 10°C/min)나 시료 질량(10 mg)을 고정 코드로 취급하지 않음.<br>**[주의사항 2]** 특정 온도 구간의 감량만으로 특정 첨가제나 카본블랙 조성을 독단 확정하지 않음. | • 실제 업로드 파일의 승온 속도와 질량을 데이터 기반으로 파싱.<br>• 미확인 시료의 경우 성분 단정 대신 '해당 온도 구간의 열분해 거동(DTG 최대 피크점)'으로 과학적 서술. |

---

## 3. 검증 결과 및 테스트 통과 현황

### 3-1. 단위 테스트 및 회귀 테스트 (`pytest`)
- **실행 환경:** Windows 11, Python 3.13.5 (Render 호환 Python 3.11/3.12/3.13)
- **테스트 파일:**
  1. `tests/test_spectro_engines.py`: 수치 계산 엔진 및 ReportLab 한국어 PDF 생성기 검증 (6/6 통과)
  2. `tests/test_spectro_api.py`: FastAPI 엔드포인트 파싱, 계산, AI 해석, PDF/PNG/CSV/JSON 다운로드 검증 (4/4 통과)

```text
============================= test session starts =============================
platform win32 -- Python 3.13.5, pytest-9.2.0, pluggy-1.7.0
rootdir: C:\Users\tempo\Desktop\ai enabled 해커톤 자료\matlens-thermal-ir\backend
plugins: anyio-4.15.1
collected 10 items

tests/test_spectro_engines.py::test_ftir_engine_ground_truth PASSED      [ 10%]
tests/test_spectro_engines.py::test_ftir_missing_refractive_index PASSED [ 20%]
tests/test_spectro_engines.py::test_dsc_engine_ground_truth PASSED       [ 30%]
tests/test_spectro_engines.py::test_dsc_missing_standard_enthalpy PASSED [ 40%]
tests/test_spectro_engines.py::test_tga_engine_ground_truth PASSED       [ 50%]
tests/test_spectro_engines.py::test_pdf_generators_for_all_instruments PASSED [ 60%]
tests/test_spectro_api.py::test_samples_endpoint_all_instruments PASSED  [ 70%]
tests/test_spectro_api.py::test_ftir_parse_and_analyze_flow PASSED       [ 80%]
tests/test_spectro_api.py::test_dsc_parse_and_analyze_flow PASSED        [ 90%]
tests/test_spectro_api.py::test_tga_parse_and_analyze_flow PASSED        [100%]

============================== 10 passed in 7.23s ==============================
```

### 3-2. 수치 검증 Ground Truth 대조

| 장비 | 테스트 시료 | 참값 (Ground Truth) | 계산 결과 | 오차 및 허용 범위 | 판정 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FT-IR** | 폴리스티렌 박막 간섭무늬 | $d = 25.00\,\mu\text{m}$ ($n=1.59$) | **$24.57\,\mu\text{m}$** | $-0.43\,\mu\text{m}$ (허용 $\pm 1.5\,\mu\text{m}$) | **PASS** |
| **FT-IR** | 굴절률 미입력 조건 | $n \cdot d$ 광학 두께만 산출 | **$n \cdot d = 39.06\,\mu\text{m}$**, 물리두께 `None` | 물리두께 계산 차단 및 알림 | **PASS** |
| **DSC** | PET 2차 가열 용융 피크 | $T_m = 255.0^\circ\text{C}$, $\Delta H_m = 45.0\text{ J/g}$ | **$T_m = 254.67^\circ\text{C}$**, **$\Delta H_m = 41.12\text{ J/g}$** | 온도 오차 $0.33^\circ\text{C}$, 엔탈피 오차 $3.88\text{ J/g}$ | **PASS** |
| **DSC** | $\Delta H_m^\circ$ 미입력 조건 | $X_c$ 계산 보류 | **`crystallinity_pct`: `None`**, 상태: '기준 엔탈피 필요' | 임의 기본값 날조 방지 | **PASS** |
| **TGA** | 고무 복합재 다단계 분해 | $T_5 = 240.0^\circ\text{C}$, $T_{10} = 322.0^\circ\text{C}$ | **$T_5 = 240.00^\circ\text{C}$**, **$T_{10} = 321.82^\circ\text{C}$** | $T_5: 0.00^\circ\text{C}$, $T_{10}: 0.18^\circ\text{C}$ | **PASS** |
| **TGA** | 최종 무기 회분 잔류량 | 잔류율 $5.00\%$ | **$4.97\%$** | 오차 $0.03\%$ | **PASS** |

---

## 4. 사용자 사용 가이드

1. **상단 모드 선택:**
   - 화면 상단 내비게이션 바에서 `[분광·열분석 (FT-IR · DSC · TGA)]` 탭을 클릭합니다.
2. **장비 탭 전환:**
   - 우측 상단의 `[FT-IR 적외선 분광]`, `[DSC 시차주사열량]`, `[TGA 열중량 분석]` 중 원하는 장비를 선택합니다.
3. **데이터 불러오기:**
   - **(방법 1) 1-클릭 벤치마크 시료:** `[표준 벤치마크 시료 불러오기]` 버튼을 누르면 즉시 검증된 표준 시료가 로드되고 자동 계산됩니다.
   - **(방법 2) 사용자 파일 업로드:** 드래그 앤 드롭 영역에 실험실에서 측정한 `.csv`, `.txt`, `.tsv`, `.xlsx` 파일을 올립니다.
4. **조건 확인 및 미세 조정:**
   - FT-IR: 시료의 굴절률 $n$ 및 간섭 파수 구간 설정.
   - DSC: 시료 질량(mg), 단위(mW vs W/g), 기준 100% 융해 엔탈피($\Delta H_m^\circ$, J/g) 및 가열/냉각 단계 선택.
   - TGA: 초기 질량(mg) 및 분위기 전환 온도(°C) 확인.
   - `[분석 재계산]` 버튼을 누르면 즉각 수치가 갱신됩니다.
5. **결과 검토:**
   - 인터랙티브 Plotly 차트에서 확대, 축 이동, 피크 호버 툴팁 확인.
   - `사용한 계산식 및 대입값 투명성 검토` 아코디언을 열어 공식과 변수 대입값 점검.
   - `[Gemini AI 해석 생성]` 버튼을 눌러 근거 ID 기반 심층 과학 가설 확인.
6. **내보내기:**
   - `[한국어 PDF 리포트]`, `[차트 이미지 (PNG)]`, `[변환 데이터 (CSV)]`, `[결과 데이터 (JSON)]` 중 필요한 포맷으로 다운로드합니다.
