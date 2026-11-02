# MatLens 샘플 데이터 출처 및 생성 명세

UI에서 예시 데이터를 불러올 때 항상 **`[샘플]`** 배지가 표시되며, 모든 샘플 파일은 재현 가능한 스크립트(`backend/scripts/build_samples_and_refs.py`, 난수 시드 `42`)와 공개 결정학 데이터베이스(COD)로부터 생성되었습니다.

| 파일명 | 종류 | 출처 / 생성 방식 | 기준 참값 (Ground Truth) |
|---|---|---|---|
| `sample_anatase_rutile_xrd.csv` | 합성 다상 XRD | `pymatgen` 계산 기준선(Cu Kα `1.5406 Å`, 간격 `0.02°`) + Pseudo-Voigt 프로파일(기기 선폭 `0.08°`) + 지수·비정질 배경(`23°` hump) + 포아송 계수 노이즈 | 주상 Anatase(`D = 24.0 nm`, `ε = 0.0010`) + 부상 Rutile(`D = 38.0 nm`), 영점 이동 `+0.02°` |
| `sample_silicon_srm640_xrd.csv` | 기준계 합성 XRD | NIST SRM 640f 인증 실리콘 격자상수(`a = 5.43119 Å`, 공간군 `Fd-3m` / `F-43m`) 기반 Cu Kα 회절선 + `D = 55.0 nm`, 기기 선폭 `0.06°` + 포아송 노이즈 | `(111) 28.4411°`, `(220) 47.3004°`, `(311) 56.1195°`, `(400) 69.1264°`, `(331) 76.3723°`, `(422) 88.0250°` |
| `sample_tio2_particles_sem.png` | 합성 입자 SEM | `1024 × 848 px` (분석 영역 `1024 × 768 px` + 하단 `80 px` 장비 정보 바), 구형 음영 모델 + 가우시안 전자빔 노이즈, 부분 접촉 허용(`0.93(r1+r2)`) | 스케일바 `200 px = 500 nm` (`2.5 nm/px`), 입자 `N = 145`, 참값 평균 직경 `116.30 nm`, 참값 `D50 = 116.98 nm` |
| `sample_sintered_grains_sem.png` | 합성 결정립 SEM | `1024 × 848 px` 보로노이(Voronoi) 다결정 조직(종자 `95개`) + 어두운 식각 결정립계 홈(groove) 모델 | 스케일바 `200 px = 5 µm` (`25.0 nm/px`), 등가 결정립 직경 약 `2.57 µm` |
| `cod_9009086_anatase.cif` | 공개 결정구조 CIF | Crystallography Open Database 공개 엔트리 `COD 9009086` (Horn et al., *Z. Kristallogr.* 136, 273, 1972) | `TiO2` (Anatase, 공간군 `I4_1/amd`) |
| `cod_9004141_rutile.cif` | 공개 결정구조 CIF | Crystallography Open Database 공개 엔트리 `COD 9004141` (Swope et al., *Am. Mineral.* 80, 448, 1995) | `TiO2` (Rutile, 공간군 `P4_2/mnm`) |
| `custom_zno_wurtzite.cif` | 사용자 업로드 테스트용 CIF | Wurtzite `ZnO` (`P6_3mc`, Albertsson et al., 1989) `pymatgen` 생성 CIF | `ZnO` (`a = 3.2498 Å`, `c = 5.2066 Å`) |

재생성이 필요한 경우:
```bash
cd backend
python scripts/build_samples_and_refs.py
```
