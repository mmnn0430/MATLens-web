# 다운로드 재점검 — 2026-11-02 (KST)

기준 커밋: 349b986. 수정 브랜치: codex/download-fixes.
운영 사이트: https://matlens-web.onrender.com
수정본 검증: 로컬 빌드 및 127.0.0.1:8011. 운영 반영은 별도 배포가 필요하다.

## 발견 및 수정

- 운영 XRD PNG 요청에서 HTTP 500 재현. xrd_export.py의 Path import 누락을 수정했다.
- XRD PNG의 α, θ, Å 표시를 위해 DejaVu Sans 폰트 대체 경로를 추가했다.
- 리포트/XRD/SEM 다운로드에 응답 검사, 준비 상태, 실패 안내, 중복 클릭 방지를 추가했다.
- UTM을 포함한 다운로드에서 임시 링크를 DOM에 붙여 클릭하고, Blob URL 해제를 60초 늦췄다. 기존 즉시 해제로 생길 수 있는 브라우저별 문제를 예방한다.
- 빈 파일 및 HTML 오류 페이지가 정상 파일로 저장되는 것을 차단했다.

## 개별 클릭 체크리스트

운영 화면과 수정본 로컬 화면에서 아래 18개 위치를 각각 클릭했다.

| 화면 | 클릭한 기능 | 수정본 결과 |
|---|---|---|
| 통합 리포트 | PDF | 브라우저 전달 안내 확인 |
| 통합 리포트 | XRD PNG | 브라우저 전달 안내 확인 |
| 통합 리포트 | XRD CSV | 브라우저 전달 안내 확인 |
| 통합 리포트 | SEM CSV | 브라우저 전달 안내 확인 |
| 통합 리포트 | SEM 오버레이 PNG | 브라우저 전달 안내 확인 |
| 통합 리포트 | 전체 JSON | 브라우저 전달 안내 확인 |
| 통합 리포트 | 본문 XRD 차트 이미지 받기 | 브라우저 전달 안내 확인 |
| XRD | 이미지 다운로드 PNG | 브라우저 전달 안내 확인 |
| XRD | 피크 목록 CSV | 브라우저 전달 안내 확인 |
| XRD | 첫 번째 Plotly 차트 PNG | Plotly 성공 알림 확인 |
| XRD | 두 번째 Plotly 차트 PNG | 클릭 완료, Plotly 내보내기 확인 |
| SEM | 오버레이 저장 | 브라우저 전달 안내 확인 |
| SEM | 객체별 측정값 CSV | 브라우저 전달 안내 확인 |
| SEM | Plotly 분포 차트 PNG | Plotly 성공 알림 확인 |
| UTM | 그래프 PNG | 오류 없이 처리 완료, 버튼 재활성화 |
| UTM | 변환 데이터 CSV | 오류 없이 처리 완료, 버튼 재활성화 |
| UTM | 결과 JSON | 오류 없이 처리 완료, 버튼 재활성화 |
| UTM | 리포트 PDF | 오류 없이 처리 완료, 버튼 재활성화 |

브라우저 클릭 결과와 파일 검증을 구분한다. 자동화 브라우저의 다운로드 이벤트가 파일 경로를 반환하지 않아 각 클릭으로 OS 다운로드 폴더에 저장됐는지까지 확증하지 않았다. 아래 파일은 동일 서버 API에서 별도로 받아 검증했다. 모든 브라우저/입력 조합을 검증한 것은 아니다.

## 파일 내용 검증

증거 파일 위치: output/download-audit/ (로컬, Git 제외).

| 서버 파일 | 결과 |
|---|---|
| 통합 PDF | HTTP 200, PDF 파싱 성공, 2페이지 |
| XRD PNG | HTTP 200, PNG 디코딩 성공, 고해상도 이미지 육안 확인 |
| XRD CSV | HTTP 200, 16개 피크 행 |
| SEM CSV | HTTP 200, 145개 객체 행 |
| SEM PNG | HTTP 200, 1024×814 PNG |
| 전체 JSON | HTTP 200, JSON 파싱 성공 |
| UTM PNG | HTTP 200, PNG 확인 |
| UTM CSV | HTTP 200, 변환 데이터 확인 |
| UTM JSON | HTTP 200, JSON 파싱 및 기준 탄성계수 70 GPa 확인 |
| UTM PDF | HTTP 200, PDF 확인 |

자동 검증: 기존 전체/배포 회귀 테스트 11개 통과. XRD PNG 기본 후보/지정 후보 요청에 상태 코드, MIME, attachment, 이미지 크기 및 PNG 검증을 추가했다. 프런트엔드 TypeScript 및 Vite 빌드 성공.

남은 사항: 촘촘한 XRD 피크 라벨과 범례의 일부 겹침은 시각적 개선 대상으로 남는다. 기존 감사의 인증/접근 통제, AI 해석 타당성, 재배포 시 저장소 보존 문제는 이번 다운로드 수정으로 해결되지 않는다.

## Render 반영

로컬 변경을 확인한 뒤 프로젝트 폴더에서 실행한다. 원격 main에 다른 변경이 있으면 강제 push하지 말고 먼저 변경을 합친다.

```powershell
git switch main
git merge --ff-only codex/download-fixes
git push origin main
```

1. Render의 matlens-web 서비스 연결 브랜치가 main인지 확인한다.
2. 자동 배포 완료를 기다리거나 Manual Deploy → Deploy latest commit을 실행한다.
3. 배포 커밋이 이번 수정 커밋인지 확인한다. Restart service만으로는 새 코드가 반영되지 않는다.
4. Live 후 새로고침하고 새 샘플 분석에서 위 18개 항목을 재확인한다. 특히 XRD PNG가 실제로 열리는지 확인한다.
5. 기존 분석이 재배포 중 사라졌다면 새로운 run을 만든다. 무료 임시 저장소 보존은 별도 해결이 필요하다.

공식 절차: https://render.com/docs/deploys
