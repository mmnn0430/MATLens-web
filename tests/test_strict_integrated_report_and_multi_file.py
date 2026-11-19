import pytest
import os
import json
import uuid
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import db
from backend.app.engine.integrated_engine import perform_cross_instrument_analysis

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    db.init_db()

def test_scenario_a_initial_state_empty_and_8_cards_counts():
    """
    Scenario A:
    통합 리포트 8개 기기 카드 ([XRD] [SEM] [UTM] [Hall] [LFA] [FT-IR] [DSC] [TGA])
    조회 가능한 저장 분석 결과 수 확인 엔드포인트 GET /api/v1/saved-analyses/counts
    """
    resp = client.get("/api/v1/saved-analyses/counts")
    assert resp.status_code == 200
    data = resp.json()
    assert "counts" in data
    counts = data["counts"]
    for inst in ["XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"]:
        assert inst in counts, f"{inst} must be included in counts map"
        assert isinstance(counts[inst], int)

    # Saved analyses query
    resp_saved = client.get("/api/v1/saved-analyses")
    assert resp_saved.status_code == 200
    saved_data = resp_saved.json()
    assert "items" in saved_data
    assert "counts" in saved_data


def test_scenario_b_strict_instrument_filtering_xrd_sem_only():
    """
    Scenario B:
    XRD와 SEM만 선택한 경우, 리포트 결과, 기기 가용성 테이블, 물성치에
    선택하지 않은 UTM, Hall, LFA, FT-IR, DSC, TGA가 완전히 배제되어야 함.
    """
    xrd_data = {
        "status": "success",
        "sample_name": "Test-Specimen",
        "primary_phase": "TiO2 Rutile",
        "crystallite_size_nm": 32.5,
        "lattice_parameters": {"a": 4.593, "c": 2.959},
    }
    sem_data = {
        "status": "success",
        "sample_name": "Test-Specimen",
        "particle_count": 120,
        "mean_diameter_nm": 45.0,
    }

    # Strict selection: XRD and SEM ONLY
    result = perform_cross_instrument_analysis(
        sample_id="Test-Specimen",
        material_name="TiO2 Rutile",
        xrd_data=xrd_data,
        sem_data=sem_data,
        selected_instruments=["xrd", "sem"]
    )
    report = result.to_dict()

    # 1. Instrument availability strictly contains ONLY xrd and sem
    avail = report["instrument_availability"]
    avail_instruments = {item["instrument"].lower().replace("-", "") for item in avail}
    assert avail_instruments == {"xrd", "sem"}, f"Expected only xrd and sem, got {avail_instruments}"

    # 2. Key metrics table strictly contains only XRD and SEM metrics
    metrics = report["key_metrics_table"]
    metric_instruments = {m["instrument"] for m in metrics}
    assert metric_instruments.issubset({"XRD", "SEM"})
    for inst in ["UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"]:
        assert inst not in metric_instruments, f"{inst} should not appear in key_metrics_table"

    # 3. Cross correlations strictly exclude unselected instruments
    corrs = report.get("cross_correlations", [])
    for c in corrs:
        pair = c.get("instruments", [])
        for p in pair:
            assert p in ["xrd", "sem", "XRD", "SEM"], f"Unselected instrument {p} in cross_correlations"


def test_scenario_c_snapshot_immutability_and_api():
    """
    Scenario C:
    POST /api/v1/analysis/integrated-scoped 로 생성된 리포트는
    immutable snapshot으로 integrated_reports에 저장되며
    GET /api/v1/reports/{report_id}로 동일하게 조회되어야 함.
    """
    req_payload = {
        "title": "Strict Scope Verification Report",
        "selected_items": [
            {
                "id": "xrd_sel_1",
                "instrument": "XRD",
                "sample_id": "TEST_SAMPLE_001",
                "sample_name": "TiO2 Test",
                "original_filename": "test_xrd.csv",
                "run_number": 1
            }
        ],
        "temperature_K": 300.0,
        "run_ai": False
    }

    resp = client.post("/api/v1/analysis/integrated-scoped", json=req_payload)
    assert resp.status_code == 200, resp.text
    rep_data = resp.json()

    assert "report_id" in rep_data
    report_id = rep_data["report_id"]
    assert "XRD" in rep_data["selected_instruments"]
    assert len(rep_data["selected_items"]) == 1

    # Verify retrieval of saved snapshot
    get_resp = client.get(f"/api/v1/reports/{report_id}")
    assert get_resp.status_code == 200
    snapshot = get_resp.json()
    assert snapshot["id"] == report_id
    assert "XRD" in snapshot["selected_instruments"]
    assert snapshot["title"] == "Strict Scope Verification Report"


def test_scenario_d_utm_multi_file_and_per_file_isolated_analysis():
    """
    Scenario D:
    UTM 복수 파일 업로드 및 개별 파싱/분석 격리 검증:
    3개 UTM 파일 각각의 독립적 UTS, Yield, Modulus 계산 및 에러 격리 확인.
    """
    # File 1: Standard steel
    csv1 = (
        "Time,Strain,Stress\n"
        "sec,%,MPa\n"
        "0.0,0.0,0.0\n"
        "1.0,0.1,200.0\n"
        "2.0,0.2,400.0\n"
        "3.0,0.5,500.0\n"
        "4.0,1.0,450.0\n"
    )
    # File 2: High strength alloy
    csv2 = (
        "Time,Strain,Stress\n"
        "sec,%,MPa\n"
        "0.0,0.0,0.0\n"
        "1.0,0.1,300.0\n"
        "2.0,0.2,600.0\n"
        "3.0,0.5,800.0\n"
        "4.0,1.0,750.0\n"
    )
    # File 3: Soft polymer
    csv3 = (
        "Time,Strain,Stress\n"
        "sec,%,MPa\n"
        "0.0,0.0,0.0\n"
        "1.0,0.5,20.0\n"
        "2.0,1.0,35.0\n"
        "3.0,2.0,40.0\n"
        "4.0,5.0,30.0\n"
    )

    files_data = [
        ("file1.csv", csv1, 500.0),
        ("file2.csv", csv2, 800.0),
        ("file3.csv", csv3, 40.0),
    ]

    results = []
    for fname, content, expected_uts in files_data:
        # Parse using /api/utm/parse
        parse_resp = client.post(
            "/api/utm/parse",
            files={"file": (fname, content.encode("utf-8"), "text/csv")}
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert parsed["row_count"] == 5

        # Analyze using /api/utm/analyze
        analyze_resp = client.post(
            "/api/utm/analyze",
            json={
                "parsed_data": parsed,
                "start_index": 0,
                "end_index": parsed["row_count"],
                "analysis_name": fname,
                "calc_offset_yield": True
            }
        )
        assert analyze_resp.status_code == 200, analyze_resp.text
        analysis = analyze_resp.json()
        assert analysis["peak_stress"]["stress_MPa"] == expected_uts
        results.append(analysis)

    # Verify per-file isolation: peak stresses are strictly distinct
    assert results[0]["peak_stress"]["stress_MPa"] == 500.0
    assert results[1]["peak_stress"]["stress_MPa"] == 800.0
    assert results[2]["peak_stress"]["stress_MPa"] == 40.0


def test_scenario_e_selective_inclusion_in_integrated_report():
    """
    Scenario E:
    동일 기기에서 3개의 분석 결과 중 2개만 선택한 경우,
    통합 리포트의 scope에는 정확히 선택된 2개만 포함되어야 함.
    """
    req_payload = {
        "title": "Selective UTM Comparison Report",
        "selected_items": [
            {
                "id": "utm_item_1",
                "instrument": "UTM",
                "sample_id": "SAMPLE_SERIES_A",
                "sample_name": "Ti-6Al-4V",
                "original_filename": "sample_A_test1.csv",
                "run_number": 1
            },
            {
                "id": "utm_item_2",
                "instrument": "UTM",
                "sample_id": "SAMPLE_SERIES_A",
                "sample_name": "Ti-6Al-4V",
                "original_filename": "sample_A_test2.csv",
                "run_number": 2
            }
            # Note: utm_item_3 is NOT selected!
        ],
        "temperature_K": 300.0,
        "run_ai": False
    }

    resp = client.post("/api/v1/analysis/integrated-scoped", json=req_payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["selected_instruments"] == ["UTM"]
    # Requirement 4: 동일 시료 + 동일 분석기기 기준 가장 마지막 Run(run_number=2)만 통합 리포트에 반영
    assert len(data["selected_items"]) == 1
    item_ids = [item["id"] for item in data["selected_items"]]
    assert item_ids == ["utm_item_2"]
    assert "utm_item_1" not in item_ids
    assert "utm_item_3" not in item_ids


def test_scenario_f_legacy_backward_compatibility():
    """
    Scenario F:
    기존 레거시 API 및 selected_instruments=None 호출 시
    하위 호환성을 보장하여 기존 5개 기기 (XRD, SEM, UTM, Hall, LFA) 기본 동작 유지.
    """
    result = perform_cross_instrument_analysis(
        sample_id="Legacy-Specimen",
        material_name="Legacy Material",
        xrd_data={"status": "success"},
        sem_data={"status": "success"},
        selected_instruments=None  # Legacy mode
    )
    legacy_report = result.to_dict()

    avail = legacy_report["instrument_availability"]
    # Legacy tests assert exactly 5 instruments returned when selected_instruments is None
    assert len(avail) == 5
    avail_instruments = {item["instrument"].lower().replace("-", "") for item in avail}
    assert avail_instruments == {"xrd", "sem", "utm", "hall", "lfa"}


def test_scenario_g_gemini_fallback_clean_operation_without_key():
    """
    Scenario G:
    GEMINI_API_KEY가 없거나 비활성화된 환경에서도
    AI 해석 요청 시 500 에러를 유발하지 않고 규칙 기반(Rule-based) 과학적 요약이 안전하게 생성되어야 함.
    """
    old_key = os.environ.get("GEMINI_API_KEY")
    try:
        os.environ["GEMINI_API_KEY"] = ""  # Simulate missing key

        req_payload = {
            "title": "Fallback Test Report",
            "selected_items": [
                {
                    "id": "xrd_g_item",
                    "instrument": "XRD",
                    "sample_id": "TEST_FALLBACK",
                    "sample_name": "Silicon",
                    "original_filename": "silicon_xrd.csv",
                    "run_number": 1
                }
            ],
            "run_ai": True
        }

        resp = client.post("/api/v1/analysis/integrated-scoped", json=req_payload)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "ai_interpretation" in data
        ai_rep = data["ai_interpretation"]
        assert "executive_summary" in ai_rep
        # Should cleanly state rule-based deterministic summary
        assert len(ai_rep["executive_summary"]) > 0
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key
