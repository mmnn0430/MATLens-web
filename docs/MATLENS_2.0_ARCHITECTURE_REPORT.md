# MatLens 2.0 — AI 기반 재료 분석 플랫폼 고도화 프로젝트 아키텍처 및 검증 보고서

## 1. 현재 MatLens 시스템 분석 보고서

### 1.1 기술 스택 및 구조
- **Frontend Framework**: React 18, Vite 7, TypeScript, Tailwind CSS, Radix UI Primitives, Plotly.js, Lucide Icons.
- **Backend Framework**: Python 3.11/3.13, FastAPI, Uvicorn, NumPy, SciPy, ReportLab (PDF), OpenCV (Headless).
- **데이터베이스 & 스토리지**: SQLite (`matlens.db`), 로컬 파일시스템 스토리지 (`storage/projects/`).
- **기존 분석 모듈**:
  - **XRD (X-ray Diffraction)**: 비대칭 최소제곱 배경 보정(Asymmetric Least Squares, ALS), Pseudo-Voigt 피크 검출, Materials Project 연계 상 탐색(Phase Identification), Williamson-Hall 격자 변형률/Scherrer 결정립 크기 계산.
  - **SEM (Scanning Electron Microscopy)**: CLAHE 전처리, Otsu/Manual 이진화, 입자(Particle) 직경 분포 및 분율 계산, 절편법(Intercept Method) 기반 결정립경(Grain Size) 분석.
  - **UTM (Universal Testing Machine)**: 응력-변형률 곡선, 탄성계수(Young's Modulus), 0.2% 오프셋 항복강도, 인장강도(UTS), 파단 거동 분석.
- **기존 배포 및 환경 설정**:
  - Docker multi-stage build (Node.js 빌더 + Python slim 런타임).
  - 환경변수: `GEMINI_API_KEY`, `MP_API_KEY`, `PORT`, `MATLENS_STORAGE_DIR`.

---

## 2. 기능별 요구사항 명세서

| 모듈 | 핵심 입력 | 정량적 계산식 및 물리 모델 | AI 및 학술 검증 역할 |
|---|---|---|---|
| **Hall Effect** | B (T), V_H (mV), I (mA), t (µm), R_s (Ω/sq) | • ±B 비대칭화: $V_{anti} = \frac{V(+B)-V(-B)}{2}$<br>• Hall 계수: $R_H = \frac{t}{I}\frac{dV_H}{dB}$<br>• 캐리어 농도: $n_H = \frac{1}{e\|R_H\|}$<br>• 이동도: $\mu_H = \frac{\|R_H\|}{\rho_e}$<br>• vdP 수치해석: $e^{-\pi R_A/R_s} + e^{-\pi R_B/R_s} = 1$ | • 음향 포논 격자 산란 vs 이온화 불순물 산란 식별<br>• 결정립계 전위 장벽 산란(Petritz 가설) 구분<br>• 실측 문헌 대조 (Prince et al., 1954 Si 벤치마크) |
| **LFA (Laser Flash)** | t (s), T_rear (°C), L (mm), ρ (g/cm³), Cp (J/g·K) | • Parker 반상승 모델: $\alpha = 0.1388 \frac{L^2}{t_{1/2}}$<br>• 열전도도: $\kappa = \alpha \cdot \rho_m \cdot C_p$<br>• SI 단위 자동 변환 ($\text{mm}^2/\text{s} \to 10^{-6}\text{m}^2/\text{s}$)<br>• 후면 냉각 열손실 비율 진단 | • 포논-포논 Umklapp 산란 고찰<br>• Cp/밀도 미입력 시 열전도도 계산 보류 및 문헌 추정치 플래그<br>• 표준 시편 검증 (Taylor & Groot, 1980 Pyroceram 9606) |
| **Scientific RAG** | 화학 조성, 도펀트, 분석기기, 온도 | • 다요소 적합성 스코어링 (조성 40%, 기기 25%, 도펀트 15%, 온도 10%, OA 10%)<br>• 4단계 범주화 (직접 비교, 유사 공정, 간접 근거, 이론 배경) | • OpenAlex / Crossref / Europe PMC 실시간 연동<br>• DOI 검증을 통한 AI 할루시네이션 방지<br>• 5단계 주장 분류 (`[Measured Fact]`, `[Calculated Result]`, `[Literature-Supported]`, `[Hypothesis]`, `[Insufficient Evidence]`) |
| **Integrated Analysis** | Sample ID 기준 XRD + SEM + Hall + LFA | • Wiedemann–Franz Law: $\kappa_e = L\sigma T$, $\kappa_L = \kappa_{total} - \kappa_e$<br>• Sommerfeld Lorenz 수: $L_0 = 2.44 \times 10^{-8}\,\text{W}\Omega/\text{K}^2$<br>• Scherrer 코히런트 영역 크기 vs SEM 물리적 결정립경 비교<br>• Maxwell-Eucken 기공률 열전도 보정 | • Processing → Structure → Transport → Mechanics 전주기 연결<br>• NbFeSb 하프-호이슬러 실측 논문 (Fu et al., PNAS 2015) 근거 검증 |

---

## 3. 변경 전후 시스템 아키텍처

```
[ MatLens 1.0 ]
Client (Browser) ---> FastAPI ---> SQLite / Local Storage
                      ├── XRD Engine (ALS, Pseudo-Voigt)
                      ├── SEM Engine (CLAHE, Watershed)
                      └── UTM Engine (Stress-Strain Curve)
                      └── Gemini Prompt (비정형 요약)

[ MatLens 2.0 고도화 아키텍처 ]
Client (SPA) <==== RESTful API v1 ====> Google Cloud Run (Container)
  ├── Hall View                           ├── Deterministic Physics Engines
  ├── LFA View                            │    ├── Hall Engine (Antisym, vdP solver, R_H, n, mu)
  ├── Integrated Dashboard                │    ├── LFA Engine (Parker half-rise, alpha, kappa)
  ├── Literature RAG Panel                │    ├── Wiedemann-Franz & Correlation Engine
  └── XRD / SEM / UTM Views               │    └── Legacy XRD, SEM, UTM Engines
                                          ├── Scientific Literature RAG
                                          │    ├── OpenAlex API / Crossref REST API
                                          │    ├── Europe PMC OA XML Provider
                                          │    ├── Curated Peer-Reviewed Benchmark DB
                                          │    └── 7-Step Grounding & Citation Verifier
                                          ├── Vertex AI & Gemini Integration
                                          │    ├── 12-Section Structured JSON Engine
                                          │    └── Deterministic Offline Rule Fallback
                                          └── GCP Cloud Services
                                               ├── Cloud Storage (GCS Provider)
                                               ├── Cloud Firestore / SQLite
                                               ├── Secret Manager Provider
                                               └── Cloud Logging & Token Budget Telemetry
```

---

## 4. Hall 및 LFA 데이터 처리 설계

### 4.1 Hall Effect 처리 상세
1. **입력 파서**: 자동 컬럼 인식 (`MagneticField_T`, `TransverseVoltage_mV`, `AppliedCurrent`, `Thickness`).
2. **비대칭화**:
   $$V_H(B) = \frac{V(+B) - V(-B)}{2}, \quad V_{long}(B) = \frac{V(+B) + V(-B)}{2}$$
   종방향 오프셋 비율(Offset Ratio %) 및 신호 대 잡음비(SNR)를 자동 진단합니다.
3. **선형 회귀**: $\frac{dV_H}{dB}$ 기울기와 결정계수 $R^2$ 계산 ($R^2 < 0.98$ 시 다중 밴드 또는 이상 홀 효과 경고 발생).
4. **van der Pauw Solver**: Newton-Raphson 기법으로 초월함수 $\exp(-\pi R_A/R_s) + \exp(-\pi R_B/R_s) = 1$을 엄밀 수치해석합니다.

### 4.2 LFA 처리 상세
1. **Parker 모델**:
   $$\alpha = 0.1388 \frac{L^2}{t_{1/2}}$$
   선형 보간법으로 정확한 $T_0 + 0.5 \Delta T_{max}$ 교차점을 탐색합니다.
2. **열전도도 결측 처리**:
   - 밀도($\rho_m$) 또는 비열($C_p$) 누락 시: 열확산도($\alpha$) 분석은 정상 제공하되, 열전도도($\kappa$) 계산은 보류(`None`)하고 안내 배너를 출력합니다.
   - 문헌 추정값 적용 시: 사용자의 명시적 동의와 함께 "Literature-Assumed Value" 플래그를 표기합니다.

---

## 5. Scientific Literature RAG 및 Citation Verification 설계

### 5.1 7-Step Grounding Protocol
- **Step 1 (Measurement Validation)**: 원시 신호의 물리적 한계 및 노이즈 검증.
- **Step 2 (Quantitative Analysis)**: Python 결정론적 엔진 수치 계산.
- **Step 3 (Literature Retrieval)**: OpenAlex 및 피어 리뷰 벤치마크 DB 탐색.
- **Step 4 (Literature Verification)**: Crossref DOI 실재성 확인 및 실험 조건 매칭.
- **Step 5 (Evidence-Based Reasoning)**: 실측값과 문헌값 간 정량 대조.
- **Step 6 (Citation Verification)**: 검증된 Source ID가 연결되지 않은 임의 인용 차단.
- **Step 7 (Final Scientific Report)**: 모든 주장을 5대 과학적 범주로 분류하여 리포트 생성.

---

## 6. Vertex AI & Gemini 연동

12개 섹션 Structured Output JSON 스키마를 준수합니다:
1. `analysis_summary` (분석 요약)
2. `input_data_summary` (입력 데이터 요약)
3. `data_quality_assessment` (데이터 품질 평가)
4. `calculated_properties` (계산된 물성치)
5. `graph_interpretation` (그래프 해석)
6. `composition_processing_interpretation` (조성 및 공정 영향)
7. `literature_comparison` (문헌 정량 비교)
8. `mechanism_discussion` (물리 메커니즘 고찰)
9. `alternative_explanations` (대체 가설)
10. `limitations_and_uncertainty` (한계 및 불확도)
11. `suggested_additional_experiments` (후속 추천 실험)
12. `references` (검증된 DOI 문헌 목록)

*API 키가 없거나 네트워크 단절 시에도 결정론적 과학 추론 엔진(Deterministic Rule Engine)이 동일한 12개 섹션을 생성하여 서비스가 중단되지 않습니다.*

---

## 7. Cloud Run Backend Code 및 Dockerfile

- **다단계 컨테이너 빌드**: Node 20 알파인에서 Vite 프로덕션 빌드 후, Python 3.11-slim 런타임으로 산출물을 복사하여 이미지 크기를 최소화.
- **동적 포트 바인딩**: Cloud Run 표준 `${PORT:-10000}` 환경변수 자동 대응.
- **원클릭 배포 스크립트**: `scripts/deploy_gcp.sh` 제공.

---

## 8. API Documentation (RESTful v1)

- `GET /api/v1/health`: Cloud Run 및 텔레메트리 상태 반환
- `POST /api/v1/files/upload`: 파일 업로드 및 기기 자동 식별
- `POST /api/v1/analysis/hall`: Hall 정량 계산, 논문 매칭 및 AI 해석
- `POST /api/v1/analysis/lfa`: LFA 열물성 분석 및 Parker 모델링
- `POST /api/v1/analysis/integrated`: 다종 기기 연계 및 Wiedemann–Franz 분리
- `POST /api/v1/literature/search`: 학술 API 및 벤치마크 DB 검색
- `POST /api/v1/literature/verify`: Crossref DOI 검증

---

## 9. Frontend Component Code

- `frontend/src/components/HallView.tsx`: Hall 데이터 입력, 반전 비대칭화 그래프, 물성치 표, AI 리포트.
- `frontend/src/components/LfaView.tsx`: LFA 과도 응답 곡선, 반상승점 검출, Parker 이론선 오버레이.
- `frontend/src/components/IntegratedAnalysisView.tsx`: 다종 기기 연계 및 파이차트 기반 열수송 기전 분리.
- `frontend/src/components/LiteratureEvidencePanel.tsx`: DOI 링크, 적합성 배지, 대화형 연구 어시스턴트 Q&A.

---

## 10. 테스트 검증 및 Acceptance Criteria 충족 결과

`tests/test_matlens_v2_comprehensive.py` 포함 **총 37개 테스트 100% 통과**:

- **Scenario A (Hall Analysis)**: n-Si 벤치마크 데이터 검증
  - 캐리어 농도: $1.000 \times 10^{16}\,\text{cm}^{-3}$ (기준값 일치)
  - Hall 이동도: $1379.2\,\text{cm}^2/\text{V}\cdot\text{s}$ (물리적 기준 부합)
  - 선형 결정계수: $R^2 = 0.99982$
- **Scenario B (LFA Analysis)**: Pyroceram 9606 표준 시편 검증
  - 반상승 시간: $t_{1/2} = 0.4500\,\text{s}$ (기준 $0.45\,\text{s}$ 일치)
  - 열확산도: $\alpha = 1.928\,\text{mm}^2/\text{s}$ (기준 $1.93\,\text{mm}^2/\text{s}$ 일치)
  - 열전도도: $\kappa = 4.110\,\text{W}/\text{m}\cdot\text{K}$ (기준 $4.11\,\text{W}/\text{m}\cdot\text{K}$ 일치)
  - 비열/밀도 누락 시 열전도도 보류 플래그 정상 동작 확인.
- **Scenario C (Literature Analysis)**: OpenAlex 및 피어 리뷰 DB 연계, Crossref DOI 검증 완료.
- **Scenario D (Integrated Analysis)**: Wiedemann–Franz Law 격자 포논 열전도도($\kappa_L$) 및 전자 열전도도($\kappa_e$) 정확히 분리.
- **Scenario E (Unsupported Claim)**: 근거 부족 시 `[Insufficient Evidence]` 및 `[Hypothesis]`로 명확히 격리.
- **Scenario F (Existing Features)**: 기존 XRD, SEM, UTM 회귀 테스트 27건 100% 통과.
- **Scenario G (GCP Deployment)**: Cloud Storage 로컬/GCS 추상화, 토큰 사용량 제어 텔레메트리 검증 완료.

---

## 11. 예상 비용 및 비용 절감 방안

1. **Cloud Run Scale-to-Zero**: 트래픽이 없을 때 컨테이너 인스턴스를 0으로 축소하여 유휴 서버 비용 $0 유지.
2. **Concurrency 80 설정**: 단일 인스턴스에서 최대 80개 동시 요청을 처리하여 인스턴스 증설 최소화.
3. **수치 계산 엔진 Python 처리**: 고비용 LLM에 단순 사칙연산을 위임하지 않고 로컬 CPU에서 0ms로 처리하여 토큰 비용 90% 이상 절감.
4. **Daily Token Budget Guard**: 일일 500,000 토큰 초과 시 경고 및 제한을 걸어 해커톤/연구비 초과 방지.
5. **학술 문헌 캐싱**: 중복 쿼리에 대해 피어 리뷰 로컬 캐시를 우선 활용하여 외부 API 호출량 절감.

---

## 12. 남아 있는 기능적 한계 및 연구자 판단 권고사항

1. **단일 밴드 가정**: Hall 계산은 $r_H = 1.0$ 단일 밴드를 기본 가정하므로, 반금속 또는 강하게 축퇴된 다중 캐리어 계에서는 온도 의존적 보정이 필요합니다.
2. **Parker 단열 가정**: LFA는 1차원 단열 모델을 적용하므로, 고온(> 600°C) 측정 시 방사 열손실 보정(Cowan 기법)을 병행해야 합니다.
3. **문헌 밀도 차이**: 문헌 밀도는 이론적 단결정 밀도일 수 있으므로, 실제 소결 시료의 기공률에 따라 아르키메데스 실측 밀도를 입력해야 정확한 열전도도가 산출됩니다.
