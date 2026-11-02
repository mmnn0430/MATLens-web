# MatLens 계산식, 물리적 가정 및 한계 명세서

본 문서는 MatLens Python 수치 분석 엔진(`backend/app/engine/`)이 사용하는 모든 수식, 전처리 규칙, 물리적 가정 및 계산 제한(제외) 기준을 투명하게 공개합니다.

---

## 1. XRD 수치 분석

### 1.1 전처리 및 불균일 각도 간격 처리
1. **원본 보존 및 이상치 점검**: 업로드된 CSV 원본 바이트와 SHA-256 해시는 변형 없이 보존됩니다. 결측치(`NaN`), 물리 범위 밖 각도(`<0.2°` 또는 `>179.5°`)는 제외 후 건수를 고지하며, 중복된 $2\theta$ 각도는 평균 강도로 병합합니다.
2. **불균일 각도 간격($\Delta 2\theta$) 처리**:
   - 인접 각도 간격의 중앙값 $\Delta_{\text{med}}$ 대비 최대 편차가 $8\%$를 초과하면 **불균일 간격**으로 판정합니다.
   - **정량 피크 피팅**과 배경 추정은 보간 왜곡을 피하기 위해 **원본 불균일 $2\theta$ 좌표 $(x_i, y_i)$에서 직접 수행**합니다.
   - 균일 격자 조건이 필요한 **Savitzky–Golay 평활화**에 한해서만 임시 균일 격자로 선형 내삽한 뒤 다시 원래 좌표로 복원하며, 이 신호는 오직 **초기 피크 위치 후보 탐지 전용**으로만 사용됩니다.
3. **ALS 배경 추정 (Asymmetric Least Squares, Eilers & Boelens, 2005)**:
   $$\min_{z} \sum_{i} w_i (y_i - z_i)^2 + \lambda \sum_{i} (\Delta^2 z_i)^2, \quad w_i = \begin{cases} p & (y_i > z_i) \\ 1 - p & (y_i \le z_i) \end{cases}$$
   기본값 $\lambda = 10^5$, $p = 0.01$이며 12회 반복 수렴합니다.

### 1.2 검출 신호와 정량 피팅 신호의 분리 및 피크 프로파일 피팅
- **핵심 원칙**: 평활화 필터는 피크 높이를 낮추고 반가폭(FWHM)을 인위적으로 넓히는 왜곡을 유발합니다. 따라서 MatLens는 **검출용 신호** $y_{\text{detect}} = \max(\text{SG}(y_{\text{raw}}) - y_{\text{bg}}, 0)$에서는 피크 초기 인덱스만 찾고, **실제 높이·면적·FWHM 피팅은 평활화하지 않은 $y_{\text{quant}} = y_{\text{raw}} - y_{\text{bg}}$에서 수행**합니다.
- **프로파일 함수**: 기본값은 가우시안 $G$와 로렌치안 $L$의 선형 결합인 **Pseudo-Voigt** 함수입니다($\eta \in [0, 1]$):
  $$I(2\theta) = c_0 + H \left[ \eta \frac{1}{1 + 4\left(\frac{2\theta - 2\theta_0}{w}\right)^2} + (1 - \eta) \exp\!\left(-4\ln 2 \left(\frac{2\theta - 2\theta_0}{w}\right)^2\right) \right]$$
  여기서 $w$가 직접적인 $\text{FWHM}$(단위: deg)입니다.
- **겹침 피크 클러스터링**: 인접 피크 중심 간격이 $2.2 \times \overline{w}_{\text{init}}$ 미만이면 다중 프로파일 합산 모델로 동시 비선형 최소제곱 피팅(`scipy.optimize.curve_fit`)하며 `겹침 피크(overlapping)`로 표시합니다.
- **피팅 실패 처리**: 수렴 실패, 결정계수 $R^2 < 0.40$, 또는 비물리적 폭($w < 0.016^\circ$ 또는 $w > 5.8^\circ$)인 경우 `0`으로 대체하지 않고 `fwhm_deg = null`, `fit_status = "fit_failed"`로 기록합니다.

### 1.3 기준 라이브러리 상 후보 매칭 및 다상 잔차 비교
- **파장 변환**: 기준 패턴의 면간격 $d_{hkl}$로부터 사용자 파장 $\lambda$에 대해 브래그 법칙 $2d_{hkl}\sin\theta = \lambda$로 $2\theta_{\text{ref}} = 2\arcsin(\lambda / 2d_{hkl})$를 계산합니다.
- **매칭 점수 산식 ($0 \sim 100$ 스케일, 확률 아님)**:
  $$S = 100 \times \left( 0.50 \, C_{\text{ref}} + 0.30 \, C_{\text{meas}} + 0.20 \, S_{\text{int}} \right)$$
  - $C_{\text{ref}} = \frac{\sum_{k \in \text{matched}} I_{\text{ref}, k}\left(1 - 0.5 \frac{|\Delta 2\theta_k|}{\text{tol}}\right)}{\sum_{k} I_{\text{ref}, k}}$: 각도 오차 가중 기준 피크 재현율
  - $C_{\text{meas}} = \frac{\sum_{j \in \text{explained}} I_{\text{meas}, j}}{\sum_{j} I_{\text{meas}, j}}$: 실측 피크 강도 설명 비율
  - $S_{\text{int}} = \frac{\mathbf{I}_{\text{meas}} \cdot \mathbf{I}_{\text{ref}}}{\|\mathbf{I}_{\text{meas}}\|_2 \|\mathbf{I}_{\text{ref}}\|_2}$: 일치 피크 상대강도 코사인 유사도
  - **중요**: $S$는 활성 기준 라이브러리(내장 32종 + 사용자 업로드 CIF) 내부에서의 상대 부합 지표이며 **정답 확률(%)이 아닙니다**.
- **다상 후보 조합 비교 (확장)**: 1순위 상 단독 엔벨로프와 2상 조합 엔벨로프에 대해 비음수 최소제곱(`NNLS`)을 풀어 패턴 정규화 잔차 $R_{\text{pat}} = \|y_+ - \hat{y}\|_2 / \|y_+\|_2$ 감소율과 추가 설명 피크를 비교합니다. 이때 피팅 스케일 비율은 RIR(Reference Intensity Ratio) 및 미소흡수 보정이 없으므로 **질량분율(wt%)로 표시하지 않습니다**.

### 1.4 조건부 Scherrer 결정자 크기 추정
- **수식 및 단위**:
  $$D_{\text{nm}} = \frac{K \cdot (\lambda_{\text{\AA}} / 10)}{\beta_{\text{rad}} \cos\theta_{\text{rad}}}, \quad \theta_{\text{rad}} = \frac{\pi}{180}\left(\frac{2\theta_{\text{deg}}}{2}\right)$$
- **기기 선폭 보정**:
  - 사용자가 표준시료 기기 선폭 $\text{FWHM}_{\text{inst}}$를 입력한 경우, 피팅 프로파일에 일관되게 보정합니다:
    $$\beta_{\text{corr}} = (1 - \eta)\sqrt{\beta_{\text{obs}}^2 - \beta_{\text{inst}}^2} + \eta(\beta_{\text{obs}} - \beta_{\text{inst}})$$
    단, $\text{FWHM}_{\text{obs}} \le 1.05 \times \text{FWHM}_{\text{inst}}$이면 분해능 한계에 도달한 것으로 판정하여 무리하게 계산하지 않고 제외합니다.
  - 미입력 시 $\beta_{\text{corr}} = \beta_{\text{obs}}$로 계산하되 반드시 **`기기 선폭 미보정 추정값`**(하한 추정치)으로 표시합니다.
- **자동 제외 조건**: 사용자 제외 피크, 피팅 실패, 겹침 피크(`overlapping`), 낮은 신호 품질($\text{SNR} < 6$), 고각 영역($2\theta > 65^\circ$, $K\alpha_1/K\alpha_2$ 분리 영향), 또는 유효 상한($>150\,\text{nm}$) 초과 피크는 제외 사유와 함께 표기합니다.

### 1.5 Williamson–Hall 분석 및 조건부 상대 결정성 지표 (확장)
- **Williamson–Hall (UDM)**: 동일 주 결정상에 귀속된 비겹침 유효 피크가 **최소 3개 이상**일 때만 수행합니다:
  $$\beta \cos\theta = \frac{K\lambda}{D_{\text{WH}}} + 4\varepsilon \sin\theta$$
  기울기가 음수($\varepsilon < 0$, 비물리적)이면 미세변형률을 확정 수치로 출력하지 않고 제한 사유를 표시하며, $R^2 < 0.60$이면 낮은 적합도 경고를 표시합니다.
- **조건부 상대 결정성 지표**: 모든 시료에 보편적인 절대 결정화도는 물리적으로 존재하지 않으므로 기본값은 **비활성(`null`)**입니다. 사용자가 **적용 시료군**과 평가 $2\theta$ 구간을 명시한 경우에만 동일 조건 내 상대 비교 지표를 산출합니다.

---

## 2. SEM 미세구조 분석

### 2.1 스케일 보정 및 ROI 원칙
- 하단 장비 정보 바(data bar)와 스케일바 수평 선분 후보를 자동 탐지하되, 사용자가 양 끝점과 실제 길이·단위(`nm`, `µm`, `mm`)를 확인하도록 합니다.
- **스케일 미확인 시**: 임의 배율을 추정하지 않고 모든 길이·면적을 **`px` / `px²`** 단위로만 계산·표시합니다.

### 2.2 입자 분석 모드 (Mode A)
- CLAHE 국소 명암 보정 $\rightarrow$ 가우시안 노이즈 완화 $\rightarrow$ Otsu(또는 수동) 이진화 $\rightarrow$ 유클리드 거리 변환(`EDT`) + 국소 극대 마커 기반 **Marker-Controlled Watershed** 분할을 수행합니다.
- **객체별 측정식** ($u = \text{unit/px}$):
  - 면적 $A = N_{\text{px}} \cdot u^2$
  - 등가원 직경 $d_{\text{eq}} = \sqrt{4A / \pi}$
  - 타원 모멘트 기반 장축 $L_{\text{maj}}$, 단축 $L_{\text{min}}$, 종횡비 $\text{AR} = L_{\text{maj}} / L_{\text{min}}$
  - 원형도 $\text{Circularity} = \min\!\left(1, \frac{4\pi A}{P^2}\right)$
- **분포 통계 구분**: 기본 히스토그램과 $D_{10}, D_{50}, D_{90}$은 **개수 기준 분포(Number-weighted)**로 제공하며, 큰 입자 비중을 반영하는 **면적 가중(Area-weighted) $D_{50}$**은 별도 항목으로 명확히 구분해 표기합니다.

### 2.3 결정립 경계 및 선형교차법 모드 (Mode B, 확장)
- 분말 입자 분할 결과를 결정립으로 오인하지 않도록 **경계가 관찰되는 이미지임을 사용자가 확인한 경우에만 활성화**됩니다.
- 적응형 임계값 및 골격화(`skeletonize`)로 결정립계를 추출하고 수평($0^\circ$)·수직($90^\circ$)·대각($\pm 45^\circ$) 시험선을 배치합니다:
  $$\bar{L} = \frac{L_{\text{total}}}{P_{\text{eff}}}$$
  교차점 수동 추가·제외를 지원하며, 명암 대비 부족이나 교차 수 미달 시 정량 산출을 제한합니다. 공식 시험 인증이 아닌 **`선형교차법 기반 추정`**으로 표기합니다.

---

## 3. 생성형 AI 통합 해석 규칙 및 검증
1. 수치 계산이 끝난 뒤 먼저 **결정론적 규칙 기반 요약**을 생성합니다(API 키 불필요).
2. Gemini 호출 시 `response_schema=AIReportSchema`로 JSON 구조화 출력을 강제하고, 서버에서 별도로 **(a) 인용된 Evidence ID의 실제 존재 여부**, **(b) 본문 내 단위 부착 수치와 엔진 결과의 일치 여부**, **(c) 금지된 숫자형 AI 신뢰도(`신뢰도 98%` 등) 포함 여부**, **(d) 동일 시료 미확인 시 통합 가설 차단 여부**를 검증합니다.
3. XRD 결정자 크기(회절 도메인)와 SEM 2D 입자 크기(투영 외형)의 차이를 고정 비율 임계값으로 단정하지 않으며, 대안 가설과 후속 검증 실험(TEM/SAED, EDS, 표준시료 보정 등)을 함께 제시합니다.
