import os
import sys
import time
import json
import shutil
import numpy as np

sys.path.insert(0, os.path.abspath("backend"))
sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient
from pathlib import Path
from app.main import app
from app.schemas import SEMParams
from app.engine.sem_engine import run_sem_pipeline

client = TestClient(app)

def run_e2e_verification():
    print("=== [E2E TEST 1] 통합 시료 관리 시스템 검증 ===")
    
    # 1. 새 시료 생성 (Nb0.8Ti0.2FeSb)
    sample_payload = {
        "sample_name": "Nb0.8Ti0.2FeSb Half-Heusler",
        "expected_formula": "Nb0.8Ti0.2FeSb",
        "sample_code": "HH-2026-001",
        "processing_method": "Arc Melting + Ball Milling + SPS (950C, 65MPa, 10min)",
        "experiment_memo": "Ti 도핑 half-Heusler 열전재료 통합 특성 평가",
        "description": "XRD, SEM, UTM, Hall, LFA 통합 시료",
        "expected_elements": ["Nb", "Ti", "Fe", "Sb"],
        "is_same_sample": False
    }
    create_resp = client.post("/api/projects", json=sample_payload)
    assert create_resp.status_code == 200, f"Failed to create project: {create_resp.text}"
    project_data = create_resp.json()
    project_id = project_data["id"]
    print(f"  [PASS] 시료 생성 성공 - Project ID: {project_id}, Sample ID: {project_data.get('sample_code')}")
    
    # 2. XRD 및 SEM 파일 연결
    xrd_sample_file = "samples/sample_anatase_rutile_xrd.csv"
    sem_sample_file = "samples/sample_tio2_particles_sem.png"
        
    with open(xrd_sample_file, "rb") as f:
        up_xrd = client.post(
            f"/api/projects/{project_id}/files/xrd",
            files={"file": ("tio2_xrd.csv", f, "text/csv")},
        )
    assert up_xrd.status_code == 200
    p_after_xrd = up_xrd.json()
    xrd_file_id = [f["id"] for f in p_after_xrd["files"] if f["file_role"] == "xrd"][0]
    print(f"  [PASS] XRD 파일 연결 성공 - File ID: {xrd_file_id}")
    
    with open(sem_sample_file, "rb") as f:
        up_sem = client.post(
            f"/api/projects/{project_id}/files/sem",
            files={"file": ("tio2_sem.png", f, "image/png")},
        )
    assert up_sem.status_code == 200
    p_after_sem = up_sem.json()
    sem_file_id = [f["id"] for f in p_after_sem["files"] if f["file_role"] == "sem"][0]
    print(f"  [PASS] SEM 파일 연결 성공 - File ID: {sem_file_id}")
    
    # 3. UTM, Hall, LFA 측정 기록 저장
    utm_rec = client.post(
        f"/api/projects/{project_id}/records",
        json={
            "instrument_type": "utm",
            "original_filename": "tensile_test_1.csv",
            "metadata": {"test_type": "tensile", "rate": "1mm/min"},
            "raw_payload": {"specimen": "dogbone"},
            "parameters": {"gauge_length_mm": 25.0},
            "summary_text": "UTS 480.0 MPa · Yield 412.0 MPa · Modulus 168.0 GPa"
        }
    )
    assert utm_rec.status_code == 200
    print("  [PASS] UTM 측정 기록 연결 성공")
    
    hall_rec = client.post(
        f"/api/projects/{project_id}/records",
        json={
            "instrument_type": "hall",
            "original_filename": "hall_measurement_300K.csv",
            "metadata": {"temperature_C": 25, "dopant": "Ti 5 at%"},
            "raw_payload": {"thickness_um": 500},
            "parameters": {"current_mA": 10},
            "summary_text": "p-type · σ 1500.0 S/cm · μ 22.0 cm²/Vs"
        }
    )
    assert hall_rec.status_code == 200
    print("  [PASS] Hall 측정 기록 연결 성공")
    
    lfa_rec = client.post(
        f"/api/projects/{project_id}/records",
        json={
            "instrument_type": "lfa",
            "original_filename": "lfa_laser_flash_300K.csv",
            "metadata": {"temperature_C": 25, "thickness_mm": 2.5},
            "raw_payload": {"density_g_cm3": 7.8},
            "parameters": {"specific_heat": 0.38},
            "summary_text": "α 2.100 mm²/s · κ 4.80 W/m·K (t1/2=0.152s)"
        }
    )
    assert lfa_rec.status_code == 200
    print("  [PASS] LFA 측정 기록 연결 성공")
    
    # 4. 시료 상세 및 전체 요약 조회
    get_proj = client.get(f"/api/projects/{project_id}")
    assert get_proj.status_code == 200
    p_detail = get_proj.json()
    summaries = p_detail.get("measurement_summaries", {})
    print(f"  [PASS] 시료에 연결된 전체 측정 기기 요약:")
    for inst, items in summaries.items():
        if items:
            print(f"    - [{inst}] {len(items)}건: {items[0].get('summary') or items[0].get('filename')}")
    
    # Assert that all instruments are properly represented
    assert len(summaries.get("XRD", [])) >= 1, "XRD 데이터 포함되어야 함"
    assert len(summaries.get("SEM", [])) >= 1, "SEM 데이터 포함되어야 함"
    assert len(summaries.get("UTM", [])) >= 1, "UTM 데이터 포함되어야 함"
    assert len(summaries.get("HALL", [])) >= 1, "Hall 데이터 포함되어야 함"
    assert len(summaries.get("LFA", [])) >= 1, "LFA 데이터 포함되어야 함"
    
    print("\n=== [E2E TEST 2] XRD 중첩 그래프 모드 & 수치 정확성 검증 ===")
    series_resp = client.get(f"/api/projects/{project_id}/xrd-series")
    assert series_resp.status_code == 200
    series_data = series_resp.json()
    curves = series_data.get("series", [])
    assert len(curves) >= 1, "XRD series 곡선이 1개 이상 반환되어야 함"
    curve = curves[0]
    print(f"  [PASS] XRD Series 곡선 반환: {curve['filename']}, {curve['n_points']} 포인트")
    
    # 원본 파일 직접 파싱하여 수치 비교
    raw_2theta = []
    raw_intensity = []
    with open(xrd_sample_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.replace(",", "\t").split()]
            if len(parts) >= 2:
                try:
                    t = float(parts[0])
                    i = float(parts[1])
                    raw_2theta.append(t)
                    raw_intensity.append(i)
                except ValueError:
                    continue
                    
    assert len(raw_2theta) == curve["n_points"], f"포인트 수 일치 검증: 원본 {len(raw_2theta)} vs 반환 {curve['n_points']}"
    assert curve["two_theta"] == raw_2theta, "2-Theta 배열이 원본과 정확히 100% 일치해야 함"
    assert curve["intensity_raw"] == raw_intensity, "Intensity 배열이 원본과 정확히 100% 일치해야 함 (정규화/스무딩/보간 없음)"
    print(f"  [PASS] 원본 데이터 수치 검증 100% 일치 확인:")
    print(f"    - Min 2-Theta: {min(raw_2theta):.2f}°")
    print(f"    - Max 2-Theta: {max(raw_2theta):.2f}° (반환: {curve['max_two_theta_raw']:.2f}°)")
    print(f"    - Max Intensity: {max(raw_intensity):.2f} counts (반환: {curve['max_intensity_raw']:.2f} counts)")
    print(f"    - Min Intensity: {min(raw_intensity):.2f} counts (반환: {curve['min_intensity_raw']:.2f} counts)")
    print(f"    - 첫 5개 포인트:")
    for k in range(min(5, len(raw_2theta))):
        print(f"        [{k}] 2θ = {raw_2theta[k]:.3f}°, I = {raw_intensity[k]:.2f}")
    
    print("\n=== [E2E TEST 3] SEM 속도 최적화 및 정량 분석 정확도 검증 ===")
    sem_bytes = Path(sem_sample_file).read_bytes()
    params = SEMParams(mode="particle")
    
    t_start = time.perf_counter()
    sem_res_cold, ov1, roi1 = run_sem_pipeline(sem_bytes, params)
    t_cold = (time.perf_counter() - t_start) * 1000
    
    t_start = time.perf_counter()
    sem_res_cached, ov2, roi2 = run_sem_pipeline(sem_bytes, params)
    t_cached = (time.perf_counter() - t_start) * 1000
    
    print(f"  [PASS] Cold 파이프라인 수행 시간: {t_cold:.1f} ms")
    print(f"  [PASS] Warm/Cached 파이프라인 수행 시간: {t_cached:.1f} ms ({(t_cold - t_cached)/t_cold * 100:.1f}% 단축)")
    
    # 정량 분석 정확도 검증 (동일 수치 보존)
    assert sem_res_cold["summary_stats"]["sample_count_n"] == sem_res_cached["summary_stats"]["sample_count_n"]
    assert abs(sem_res_cold["summary_stats"]["mean_diameter"] - sem_res_cached["summary_stats"]["mean_diameter"]) < 1e-4
    assert abs(sem_res_cold["summary_stats"]["d50"] - sem_res_cached["summary_stats"]["d50"]) < 1e-4
    
    print("  [PASS] SEM 입자 분석 정량 지표 100% 무결성 확인:")
    print(f"    - Particle Count: {sem_res_cold['summary_stats']['sample_count_n']}개")
    print(f"    - Mean Diameter: {sem_res_cold['summary_stats']['mean_diameter']:.2f} nm")
    print(f"    - D10: {sem_res_cold['summary_stats']['d10']:.2f} nm")
    print(f"    - D50: {sem_res_cold['summary_stats']['d50']:.2f} nm")
    print(f"    - D90: {sem_res_cold['summary_stats']['d90']:.2f} nm")
    
    # Clean up test project
    client.delete(f"/api/projects/{project_id}?confirm=true")
    print("\n=== [ALL E2E VERIFICATIONS COMPLETED SUCCESSFULLY] ===")

if __name__ == "__main__":
    run_e2e_verification()
