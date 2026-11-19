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


def test_deduplicate_latest_run_only_per_sample_instrument():
    """
    요구사항 4: 동일 시료 + 동일 분석기기 기준 가장 마지막에 정상 완료된 Run 결과 하나만 통합 리포트에 반영.
    동일 시료에서 XRD Run 1, XRD Run 2, XRD Run 3이 있을 때 Run 3만 채택되고 이전 Run은 제외.
    """
    req_payload = {
        "title": "Latest Run Deduplication Test",
        "selected_items": [
            {
                "id": "xrd_item_run1",
                "instrument": "XRD",
                "sample_id": "SAMPLE_DEDUP_001",
                "sample_name": "Perovskite TiO2",
                "original_filename": "xrd_run1.csv",
                "run_number": 1,
            },
            {
                "id": "xrd_item_run2",
                "instrument": "XRD",
                "sample_id": "SAMPLE_DEDUP_001",
                "sample_name": "Perovskite TiO2",
                "original_filename": "xrd_run2.csv",
                "run_number": 2,
            },
            {
                "id": "xrd_item_run3",
                "instrument": "XRD",
                "sample_id": "SAMPLE_DEDUP_001",
                "sample_name": "Perovskite TiO2",
                "original_filename": "xrd_run3.csv",
                "run_number": 3,
            },
            {
                "id": "sem_item_run1",
                "instrument": "SEM",
                "sample_id": "SAMPLE_DEDUP_001",
                "sample_name": "Perovskite TiO2",
                "original_filename": "sem_run1.png",
                "run_number": 1,
            },
            {
                "id": "sem_item_run2",
                "instrument": "SEM",
                "sample_id": "SAMPLE_DEDUP_001",
                "sample_name": "Perovskite TiO2",
                "original_filename": "sem_run2.png",
                "run_number": 2,
            },
        ],
        "temperature_K": 300.0,
        "run_ai": False,
    }

    resp = client.post("/api/v1/analysis/integrated-scoped", json=req_payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Verify that only 2 items are included: XRD Run 3 and SEM Run 2
    selected_items = data["selected_items"]
    assert len(selected_items) == 2, f"Expected 2 deduplicated items, got {len(selected_items)}"

    xrd_items = [it for it in selected_items if it["instrument"] == "XRD"]
    assert len(xrd_items) == 1
    assert xrd_items[0]["run_number"] == 3
    assert xrd_items[0]["id"] == "xrd_item_run3"

    sem_items = [it for it in selected_items if it["instrument"] == "SEM"]
    assert len(sem_items) == 1
    assert sem_items[0]["run_number"] == 2
    assert sem_items[0]["id"] == "sem_item_run2"


def test_saved_analyses_latest_only_filtering():
    """
    요구사항 4.3: GET /api/v1/saved-analyses?latest_only=true 조회 시
    (sample_id, instrument) 별 최신 completed Run만 필터링되어 반환.
    """
    resp = client.get("/api/v1/saved-analyses?latest_only=true")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    items = data["items"]

    # Verify no duplicate (sample_id, instrument) exists in latest_only=true
    seen_keys = set()
    for it in items:
        key = (it["sample_id"], it["instrument"].upper().replace("-", "").strip())
        assert key not in seen_keys, f"Duplicate (sample_id, instrument) {key} found in latest_only query!"
        seen_keys.add(key)
        assert it.get("status") == "completed", "Only completed runs should be returned in latest_only"


def test_unselected_instruments_strictly_excluded():
    """
    요구사항 6 (최우선 필수사항):
    XRD와 SEM만 선택한 경우, 타 기기(UTM, Hall, LFA, FT-IR, DSC, TGA)의 측정값이나 해석은
    리포트, 물성 표, 다중 곡선, AI 해석에서 완전 배제되어야 함.
    """
    xrd_sample = {
        "primary_phase": "ZnO Wurtzite",
        "space_group": "P6_3mc",
        "crystallite_size_nm": 28.4,
        "lattice_parameters": {"a": 3.250, "c": 5.207},
        "peaks": [{"two_theta": 36.25, "fwhm": 0.28, "intensity": 1000}],
    }
    sem_sample = {
        "grain_size_um": 1.45,
        "porosity_pct": 2.1,
        "summary_stats": {"mean_diameter": 1.45, "d50": 1.38, "d10": 0.85, "d90": 2.10, "total_count": 85},
    }
    unselected_utm = {
        "tensile_strength_MPa": 450.0,
        "yield_strength_MPa": 320.0,
        "elastic_modulus_GPa": 110.0,
    }
    unselected_hall = {
        "carrier_concentration_cm3": 1.5e18,
        "hall_mobility_cm2_Vs": 120.0,
    }

    result = perform_cross_instrument_analysis(
        sample_id="SAMPLE_STRICT_001",
        material_name="ZnO Wurtzite",
        xrd_data=xrd_sample,
        sem_data=sem_sample,
        utm_data=unselected_utm,  # passed into engine but NOT in selected_instruments
        hall_data=unselected_hall, # passed into engine but NOT in selected_instruments
        selected_instruments=["XRD", "SEM"],
    )
    rep = result.to_dict()

    # 1. Included instruments must strictly be only XRD and SEM
    assert set(rep["instruments_included"]) == {"XRD", "SEM"}

    # 2. Key metrics table must ONLY contain XRD and SEM metrics
    for row in rep["key_metrics_table"]:
        assert row["instrument"] in ["XRD", "SEM"], f"Unselected instrument {row['instrument']} found in metrics!"

    # 3. Cross correlations must NOT reference UTM or Hall
    for corr in rep.get("cross_correlations", []):
        for inst in corr.get("instruments", []):
            assert inst in ["XRD", "SEM", "xrd", "sem"], f"Unselected instrument {inst} in cross_correlations"


def test_key_quantitative_metrics_comprehensive():
    """
    요구사항 2.2: 각 분석기기에서 실제 계산 및 검증된 정량 지표와 단위, 조건이 정상 출력되는지 검증.
    """
    xrd_data = {
        "primary_phase": "SrTiO3 Cubic",
        "space_group": "Pm-3m",
        "crystallite_size_nm": 42.0,
        "lattice_parameters": {"a": 3.905},
        "peaks": [{"two_theta": 32.4, "fwhm": 0.18, "intensity": 2500}],
    }
    sem_data = {
        "grain_size_um": 2.8,
        "porosity_pct": 1.2,
        "summary_stats": {"mean_diameter": 2.8, "d50": 2.7, "d10": 1.6, "d90": 4.1, "total_count": 140},
        "grain_intercept": {"astm_grain_size_number": 8.5},
    }
    utm_data = {
        "tensile_strength_MPa": 620.0,
        "yield_strength_MPa": 480.0,
        "elastic_modulus_GPa": 210.0,
        "elongation_pct": 18.5,
    }
    hall_data = {
        "carrier_concentration_cm3": 3.2e19,
        "hall_mobility_cm2_Vs": 45.0,
        "electrical_conductivity_S_cm": 230.4,
        "carrier_type": "n-type",
    }
    lfa_data = {
        "thermal_diffusivity_mm2_s": 3.45,
        "thermal_conductivity_W_mK": 9.85,
        "density_g_cm3": 5.12,
        "specific_heat_J_gK": 0.56,
    }
    ftir_data = {
        "detected_peaks": [
            {"wavenumber": 580.0, "assignment": "Ti-O stretch"},
            {"wavenumber": 1420.0, "assignment": "Sr-O vibration"},
        ]
    }
    dsc_data = {
        "melting_temp_C": 1420.0,
        "enthalpy_change_J_g": 85.4,
    }
    tga_data = {
        "onset_temp_C": 780.0,
        "t5_C": 820.0,
        "t10_C": 910.0,
        "final_residue_pct": 98.2,
    }

    result = perform_cross_instrument_analysis(
        sample_id="SAMPLE_ALL_001",
        material_name="SrTiO3 Ceramic",
        xrd_data=xrd_data,
        sem_data=sem_data,
        utm_data=utm_data,
        hall_data=hall_data,
        lfa_data=lfa_data,
        ftir_data=ftir_data,
        dsc_data=dsc_data,
        tga_data=tga_data,
        selected_instruments=["XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"],
    )
    rep = result.to_dict()
    metrics = rep["key_metrics_table"]

    # Verify that all 8 instruments have verified metrics present
    inst_set = {m["instrument"] for m in metrics}
    for expected_inst in ["XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"]:
        assert expected_inst in inst_set, f"Expected {expected_inst} in key_metrics_table"

    # Verify specific metrics values and units
    xrd_metrics = {m["metric_name"]: m for m in metrics if m["instrument"] == "XRD"}
    assert any("Scherrer" in k for k in xrd_metrics)
    assert any(m["unit"] == "nm" for m in xrd_metrics.values())

    sem_metrics = {m["metric_name"]: m for m in metrics if m["instrument"] == "SEM"}
    assert any("결정립" in k or "입자" in k for k in sem_metrics)
    assert any("기공률" in k for k in sem_metrics)

    utm_metrics = {m["metric_name"]: m for m in metrics if m["instrument"] == "UTM"}
    assert any("인장강도" in k for k in utm_metrics)
    assert any(m["unit"] == "MPa" for m in utm_metrics.values())


def test_ai_interpretation_seven_sections_structure():
    """
    요구사항 5.3: AI 학술 연구 보고서가 A~G의 7개 표준 섹션 구조로 완성도 있게 생성되는지 검증.
    """
    req_payload = {
        "title": "Full Academic 7-Section Report Test",
        "selected_items": [
            {
                "id": "xrd_sec_1",
                "instrument": "XRD",
                "sample_id": "TEST_RAG_SAMPLE",
                "sample_name": "Silicon (Si)",
                "original_filename": "si_xrd.csv",
                "run_number": 1,
            },
            {
                "id": "sem_sec_1",
                "instrument": "SEM",
                "sample_id": "TEST_RAG_SAMPLE",
                "sample_name": "Silicon (Si)",
                "original_filename": "si_sem.png",
                "run_number": 1,
            },
        ],
        "temperature_K": 300.0,
        "run_ai": True,
    }

    resp = client.post("/api/v1/analysis/integrated-scoped", json=req_payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "ai_interpretation" in data
    ai_rep = data["ai_interpretation"]

    # Verify 7 Sections (A~G)
    assert "executive_summary" in ai_rep, "Section A missing"
    assert len(ai_rep["executive_summary"]) > 0

    assert "sample_information" in ai_rep, "Section B missing"
    assert ai_rep["sample_information"]["sample_name"] == "Silicon (Si)"

    assert "individual_interpretations" in ai_rep, "Section C missing"
    assert len(ai_rep["individual_interpretations"]) >= 1

    assert "cross_technique_correlations" in ai_rep, "Section D missing"

    assert "literature_discussion" in ai_rep, "Section E missing"
    assert "key_findings" in ai_rep["literature_discussion"]

    assert "limitations_and_future_work" in ai_rep, "Section F missing"
    assert "suggested_next_experiments" in ai_rep["limitations_and_future_work"]

    assert "references" in data, "Section G references missing in report data"
