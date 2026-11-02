# MatLens Materials Project 연결

대상: `run.bat`으로 실행하는 루트 `src/` + `backend/main.py` 앱, http://127.0.0.1:8018.

## 사용 방법

1. 시료를 열고 XRD 탭의 분석 설정에서 **기준 데이터 → 기본·CIF + Materials Project** 또는 **Materials Project만 비교**를 선택합니다.
2. **API 키 연결**을 누르고 https://materialsproject.org/dashboard 에서 발급한 키를 입력합니다. 인증에 성공한 키만 서버의 `runtime/.mp.env`에 저장합니다. 키를 채팅에 보낼 필요가 없습니다.
3. 화학식 `TiO2` 또는 원소계 `Ti-O`를 검색합니다. 검색 결과 중 비교할 후보를 1~20개 선택합니다. 처음에는 앞쪽 최대 20개가 선택됩니다.
4. 실험 파장을 확인하고 분석을 실행합니다. 후보 카드에서 이론 패턴, MP ID, 공간군, 격자 및 참고 계산 물성을 확인합니다.

서버 환경변수 `MP_API_KEY` 또는 루트 `.env` 설정도 지원합니다. 앱에서 저장한 키가 환경변수보다 우선합니다. 로컬 단일 사용자 앱을 위한 설정이며 공개 서비스 배포에는 별도 인증·권한 관리가 필요합니다. 브라우저 저장소, 결과 JSON, PDF에는 API 키를 기록하지 않습니다.

## 조회와 재현성

- 공식 REST `/materials/summary/`를 서버에서 호출합니다. 실험 CSV·SEM 이미지는 MP로 전송하지 않습니다.
- 화학식 검색은 조성을, 원소계 검색은 정확히 해당 원소계를 대상으로 합니다. `Ti-O` 조회가 순수 Ti 또는 O의 하위 원소계를 포함하지 않습니다.
- 검색 최대 50개, 실제 비교 최대 20개로 제한하며 MP ID 순으로 조회합니다. 전체 데이터베이스에서 최적 후보를 보장하지 않습니다. 화면 순서는 상의 존재 확률이나 안정성 순위가 아닙니다.
- 비활성 자료는 제외하고 BY-C 자료를 조회합니다. 준안정상을 안정성만으로 제외하지 않습니다. 무질서 구조 및 300원자를 넘는 구조는 제외하며 개수를 표시합니다.
- 검색 캐시는 24시간입니다. 새로 조회해도 기존 구조 스냅샷은 보존합니다. 패턴은 구조 해시·파장·각도 범위·pymatgen 버전별로 캐시합니다.
- 분석 결과에는 검색 조건, 조회 시각, MP ID, 구조 해시, 제공되는 DB 버전과 자료 수정 시각, 비교·제외 후보가 기록됩니다.
- 키 또는 검색 실패 시 기존 결과를 유지합니다. 저장된 구조만으로 분석하므로 분석 실행 중에는 MP 네트워크 요청이 필요하지 않습니다.

## 해석 범위

MP 구조는 계산에 기반한 참고 자료입니다. 이론 XRD와 실측의 격자·피크 위치·강도에는 차이가 생길 수 있습니다. 매칭 점수는 후보 간 상대 점수이며 상 확정 확률, 정량 상분율, Rietveld 정련 결과가 아닙니다. MP 밴드갭·밀도·Hull 위 에너지를 업로드한 시료의 측정 물성으로 취급하지 않습니다. AI 입력에서도 이를 명시합니다.

## 구현 및 검증

- `backend/materials_project.py`: 인증, 제한된 검색, 구조 스냅샷, 이론 패턴 캐시.
- `src/MaterialsProject.tsx`: 키 연결, 후보 검색·선택, MP 물성 표시.
- `tests/test_materials_project.py`: 응답 모의 테스트, 오류 정보 제거, 인증 실패 시 기존 키 보존, 캐시·이력 보존, 선택 검증, 파장 변화 및 실제 XRD 계산과의 연결, API 검증.
- 2026-10-31: `python -m pytest tests/test_analysis.py tests/test_materials_project.py -q`에서 27개 테스트 통과. MP 응답은 모의 데이터이며 실제 계정 인증 성공을 의미하지 않습니다. 유효한 API 키가 아직 설정되지 않아 실제 계정으로의 인증·검색은 미검증입니다.
- 공식 OpenAPI 계약: https://api.materialsproject.org/openapi.json
- 공식 사용 안내: https://docs.materialsproject.org/downloading-data/using-the-api/getting-started

Docker는 `compose.yaml`을 명시해 `docker compose -f compose.yaml up --build`로 실행합니다. 키와 캐시는 runtime 볼륨에 보존됩니다. 이 환경에는 Docker가 없어 컨테이너 실행은 검증하지 않았습니다.
