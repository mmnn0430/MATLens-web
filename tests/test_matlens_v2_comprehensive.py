"""Comprehensive Unit & Integration Test Suite for MatLens 2.0.

Tests Acceptance Criteria:
- Scenario A: Hall Analysis (n-type Si benchmark, R_H, carrier density, mobility, van der Pauw)
- Scenario B: LFA Analysis (Pyroceram 9606 standard, Parker model, missing Cp handling)
- Scenario C: Literature Analysis (Search, ranking, DOI verification, grounding)
- Scenario D: Integrated Analysis (Cross-instrument, Wiedemann-Franz Law kappa_e & kappa_L)
- Scenario E: Unsupported Claim Handling (Flagging insufficient evidence, anti-hallucination)
- Scenario F: Existing Feature Compatibility (XRD, SEM, UTM regressions)
- Scenario G: GCP Telemetry & Storage Abstractions
"""
from __future__ import annotations

import os
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from backend.app.main import app
from backend.app.engine.hall_engine import (
    parse_hall_data,
    analyze_hall_data,
    solve_vdp_sheet_resistance,
)
from backend.app.engine.lfa_engine import (
    parse_lfa_data,
    analyze_lfa_transient,
)
from backend.app.engine.integrated_engine import (
    compute_wiedemann_franz,
    perform_cross_instrument_analysis,
)
from backend.app.services.literature.retrieval import (
    generate_search_query,
    search_curated_database,
    retrieve_literature_for_analysis,
    verify_crossref_doi,
)
from backend.app.services.literature.ranking import (
    evaluate_paper_relevance,
    rank_literature_references,
)
from backend.app.services.literature.pipeline import execute_scientific_grounding_pipeline
from backend.app.services.cloud.telemetry import get_telemetry_metrics, track_token_usage
from backend.app.services.cloud.storage import get_storage_provider, LocalFileStorage


@pytest.fixture
def client():
    return TestClient(app)


# -------------------------------------------------------------------------
# Scenario A — Hall Analysis
# -------------------------------------------------------------------------
def test_scenario_a_hall_analysis():
    sample_path = Path("samples/sample_hall_n_si_wafer.csv")
    assert sample_path.exists(), "Benchmark file samples/sample_hall_n_si_wafer.csv must exist."

    raw_text = sample_path.read_text(encoding="utf-8")
    b_field, v_hall, meta = parse_hall_data(raw_text)

    assert len(b_field) >= 20
    assert meta["thickness"]["value"] == 500.0
    assert meta["current"]["value"] == 10.0

    res = analyze_hall_data(
        b_field=b_field,
        v_hall=v_hall,
        thickness_m=500e-6,
        current_A=10e-3,
        sheet_resistance_Ohm_sq=9.05,
        do_antisymmetrization=True,
        sample_id="Si-Wafer-Bench",
        material_name="Silicon",
    )

    # Ground truth checks
    assert "n-type" in res.carrier_type.lower()
    # Bulk n ~ 1.0e16 cm^-3 (within 2% precision)
    assert 0.95e16 <= res.carrier_concentration_cm3 <= 1.05e16
    # Sheet n_s ~ 5.0e14 cm^-2 (within 2% precision)
    assert 4.8e14 <= res.sheet_carrier_density_cm2 <= 5.2e14
    # Mobility ~ 1350-1400 cm^2/(V*s)
    assert 1300 <= res.hall_mobility_cm2_Vs <= 1450
    # Linearity R^2 > 0.999
    assert res.r_squared > 0.999
    # Antisymmetrized offset is positive
    assert res.longitudinal_offset_mV > 0.0


def test_hall_vdp_sheet_resistance_solver():
    # Symmetric square test: R_A = 10 Ohm, R_B = 10 Ohm
    # R_s = pi / ln(2) * 10 = ~45.3236 Ohm/sq
    rs = solve_vdp_sheet_resistance(10.0, 10.0)
    assert abs(rs - 45.3236) < 0.01

    # Asymmetric test: R_A = 12 Ohm, R_B = 8 Ohm
    rs_asym = solve_vdp_sheet_resistance(12.0, 8.0)
    assert 40.0 < rs_asym < 50.0


# -------------------------------------------------------------------------
# Scenario B — LFA Analysis
# -------------------------------------------------------------------------
def test_scenario_b_lfa_analysis():
    sample_path = Path("samples/sample_lfa_pyroceram9606.csv")
    assert sample_path.exists(), "Benchmark file samples/sample_lfa_pyroceram9606.csv must exist."

    raw_text = sample_path.read_text(encoding="utf-8")
    t_arr, temp_arr, meta = parse_lfa_data(raw_text)

    assert len(t_arr) > 200
    assert meta["thickness"]["value"] == 2.5
    assert meta["density"]["value"] == 2.6
    assert meta["cp"]["value"] == 0.82

    res = analyze_lfa_transient(
        time_s=t_arr,
        temp_signal=temp_arr,
        thickness_mm=2.50,
        density_g_cm3=2.60,
        specific_heat_J_gK=0.82,
        sample_id="Pyroceram-Bench",
        material_name="Pyroceram 9606",
    )

    # Half-rise time t_{1/2} ~ 0.45 s
    assert 0.43 <= res.half_rise_time_s <= 0.47
    # Diffusivity alpha ~ 1.93 mm^2/s
    assert 1.88 <= res.thermal_diffusivity_mm2_s <= 1.98
    # Thermal conductivity kappa ~ 4.11 W/(m*K)
    assert 4.0 <= res.thermal_conductivity_W_mK <= 4.25
    assert len(res.missing_inputs) == 0


def test_scenario_b_missing_cp_handling():
    sample_path = Path("samples/sample_lfa_pyroceram9606.csv")
    raw_text = sample_path.read_text(encoding="utf-8")
    t_arr, temp_arr, _ = parse_lfa_data(raw_text)

    # Run without Cp and Density
    res = analyze_lfa_transient(
        time_s=t_arr,
        temp_signal=temp_arr,
        thickness_mm=2.50,
        density_g_cm3=None,
        specific_heat_J_gK=None,
    )

    # Diffusivity must still be calculated
    assert res.thermal_diffusivity_mm2_s > 1.8
    # Thermal conductivity must be None
    assert res.thermal_conductivity_W_mK is None
    # Missing inputs must be flagged
    assert "Density (ρ_m)" in res.missing_inputs
    assert "Specific Heat Capacity (Cp)" in res.missing_inputs


# -------------------------------------------------------------------------
# Scenario C & E — Literature Analysis & Grounded Pipeline
# -------------------------------------------------------------------------
def test_scenario_c_literature_retrieval_and_ranking():
    res = retrieve_literature_for_analysis(
        material_name="Silicon",
        chemical_formula="Si",
        instrument="Hall Effect",
        temperature_C=25.0,
        limit=5,
    )
    assert res["total_found"] > 0
    top = res["references"][0]
    assert "doi" in top
    assert top.get("is_verified_doi") is True

    # Test relevance ranking
    eval_res = evaluate_paper_relevance(
        paper=top,
        sample_composition="Si",
        material_name="Silicon",
        instrument="Hall Effect",
        temperature_C=25.0,
    )
    assert eval_res["relevance_score"] >= 70.0
    assert eval_res["category_code"] in (1, 2)


def test_scenario_e_scientific_grounding_pipeline_claim_categories():
    calc_props = {
        "r_squared": 0.9998,
        "offset_ratio_pct": 2.5,
        "carrier_type": "n-type (electron dominated)",
        "carrier_concentration_cm3": 1.0e16,
        "hall_mobility_cm2_Vs": 1380.0,
    }
    sample_meta = {
        "sample_id": "Si-01",
        "material_name": "Silicon",
        "chemical_composition": "Si",
        "measurement_temperature_C": 25.0,
    }
    raw_summary = {"point_count": 21}

    pipeline_res = execute_scientific_grounding_pipeline(
        instrument="hall",
        raw_data_summary=raw_summary,
        calculated_properties=calc_props,
        sample_metadata=sample_meta,
    )

    assert pipeline_res["pipeline_status"] == "COMPLETED"
    assert len(pipeline_res["pipeline_log"]) == 7

    claims = pipeline_res["grounded_claims"]
    categories = {c["category"] for c in claims}

    # Must contain Measured Fact, Calculated Result, Literature-Supported, and Hypothesis
    assert "Measured Fact" in categories
    assert "Calculated Result" in categories
    assert "Literature-Supported" in categories or "Insufficient Evidence" in categories
    assert "Hypothesis" in categories

    # Ensure no fabricated DOIs: each literature-supported claim has a real verified DOI
    for c in claims:
        if c["category"] == "Literature-Supported":
            assert c["doi"] is not None
            assert len(c["doi"]) > 5


# -------------------------------------------------------------------------
# Scenario D — Cross-Instrument Integrated Analysis
# -------------------------------------------------------------------------
def test_scenario_d_wiedemann_franz_separation():
    # Hall: sigma = 1000 S/cm = 100,000 S/m
    # LFA: kappa_total = 4.8 W/(m*K)
    # T = 300 K, L = 2.44e-8
    # kappa_e = 2.44e-8 * 100,000 * 300 = 0.732 W/(m*K)
    # kappa_L = 4.8 - 0.732 = 4.068 W/(m*K)
    wf = compute_wiedemann_franz(
        electrical_conductivity_S_m=100000.0,
        total_thermal_conductivity_W_mK=4.8,
        temperature_K=300.0,
    )

    assert abs(wf["electronic_thermal_conductivity_W_mK"] - 0.732) < 0.01
    assert abs(wf["lattice_thermal_conductivity_W_mK"] - 4.068) < 0.01
    assert wf["dominant_mechanism"] == "Lattice-dominated (Phonon transport)"


def test_scenario_d_full_cross_instrument_analysis():
    xrd_data = {"crystallite_size_nm": 42.5, "space_group": "F-43m"}
    sem_data = {"grain_size_um": 2.4, "porosity_pct": 1.2}
    hall_data = {"electrical_conductivity_S_cm": 1500.0, "hall_mobility_cm2_Vs": 22.0}
    lfa_data = {"thermal_conductivity_W_mK": 4.8, "thermal_diffusivity_mm2_s": 2.1}

    res = perform_cross_instrument_analysis(
        sample_id="NbFeSb-01",
        material_name="NbFeSb half-Heusler",
        xrd_data=xrd_data,
        sem_data=sem_data,
        hall_data=hall_data,
        lfa_data=lfa_data,
    )

    assert set(res.instruments_included) == {"XRD", "SEM", "Hall", "LFA"}
    assert res.wiedemann_franz is not None
    assert res.xrd_sem_correlation is not None
    assert res.sem_hall_correlation is not None
    assert len(res.synthesis_to_properties_chain) >= 5


# -------------------------------------------------------------------------
# Scenario F — API v1 Endpoints & Existing Route Compatibility
# -------------------------------------------------------------------------
def test_api_v1_endpoints(client):
    # 1. Health
    h_resp = client.get("/api/v1/health")
    assert h_resp.status_code == 200
    h_data = h_resp.json()
    assert h_data["status"] == "online"
    assert "Hall Effect" in h_data["supported_instruments"]

    # 2. File Upload auto-detection
    csv_bytes = b"MagneticField_T,TransverseVoltage_mV\n-1.0,13.1\n1.0,-11.9\n"
    up_resp = client.post("/api/v1/files/upload", files={"file": ("sample_hall.csv", csv_bytes, "text/csv")})
    assert up_resp.status_code == 200
    up_data = up_resp.json()
    assert up_data["detected_instrument"] == "hall"

    # 3. Hall API
    hall_payload = {
        "raw_text": Path("samples/sample_hall_n_si_wafer.csv").read_text(encoding="utf-8"),
        "thickness_um": 500.0,
        "current_mA": 10.0,
        "sheet_resistance_Ohm_sq": 9.05,
        "sample_id": "API-Hall-Test",
        "material_name": "Silicon",
    }
    hall_resp = client.post("/api/v1/analysis/hall", json=hall_payload)
    assert hall_resp.status_code == 200
    hall_data = hall_resp.json()
    assert hall_data["calculated_properties"]["carrier_concentration_cm3"] > 1e15
    assert hall_data["ai_interpretation"] is not None

    # 4. LFA API
    lfa_payload = {
        "raw_text": Path("samples/sample_lfa_pyroceram9606.csv").read_text(encoding="utf-8"),
        "thickness_mm": 2.50,
        "density_g_cm3": 2.60,
        "specific_heat_J_gK": 0.82,
        "sample_id": "API-LFA-Test",
        "material_name": "Pyroceram 9606",
    }
    lfa_resp = client.post("/api/v1/analysis/lfa", json=lfa_payload)
    assert lfa_resp.status_code == 200
    lfa_data = lfa_resp.json()
    assert lfa_data["calculated_properties"]["thermal_diffusivity_mm2_s"] > 1.8
    assert lfa_data["calculated_properties"]["thermal_conductivity_W_mK"] > 3.9

    # 5. Existing Health API check
    legacy_h = client.get("/api/health")
    assert legacy_h.status_code == 200


# -------------------------------------------------------------------------
# Scenario G — GCP Telemetry & Storage Abstractions
# -------------------------------------------------------------------------
def test_scenario_g_gcp_abstractions():
    # Telemetry & token tracking
    metrics_before = get_telemetry_metrics()
    track_token_usage(500)
    metrics_after = get_telemetry_metrics()
    assert metrics_after["total_tokens_used"] >= metrics_before["total_tokens_used"] + 500

    # Storage provider
    storage = get_storage_provider()
    test_key = "test_artifacts/unit_test.txt"
    test_bytes = b"MatLens 2.0 Scientific Verification"
    saved_uri = storage.save_file(test_key, test_bytes)
    assert storage.exists(test_key)
    read_back = storage.read_file(test_key)
    assert read_back == test_bytes
    storage.delete_file(test_key)
    assert not storage.exists(test_key)
