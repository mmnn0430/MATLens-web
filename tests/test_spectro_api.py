"""Integration test suite for Spectro & Thermal Analysis FastAPI Endpoints."""
import io
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_samples_endpoint_all_instruments():
    for inst in ("ftir", "dsc", "tga"):
        res = client.get(f"/api/spectro/samples/{inst}")
        assert res.status_code == 200, f"Failed for {inst}: {res.text}"
        data = res.json()
        assert data["instrument"] == inst
        assert "csv_content" in data
        assert len(data["csv_content"]) > 100
        assert "recommended_conditions" in data


def test_ftir_parse_and_analyze_flow():
    # 1. Fetch sample CSV
    samp_res = client.get("/api/spectro/samples/ftir")
    csv_bytes = samp_res.json()["csv_content"].encode("utf-8")

    # 2. Upload and parse
    parse_res = client.post(
        "/api/spectro/ftir/parse",
        files={"file": ("test_ps.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert parse_res.status_code == 200
    parsed = parse_res.json()
    assert parsed["status"] == "success"
    assert len(parsed["columns"]) == 2
    assert len(parsed["column_data"]) == 2

    # 3. Analyze
    analyze_payload = {
        "instrument": "ftir",
        "filename": "test_ps.csv",
        "columns": parsed["columns"],
        "column_data": parsed["column_data"],
        "conditions": {
            "signal_type": "transmittance",
            "refractive_index": 1.59,
            "fringe_min_wn": 2400.0,
            "fringe_max_wn": 2750.0,
            "fringe_prominence": 1.5,
        },
    }
    an_res = client.post("/api/spectro/ftir/analyze", json=analyze_payload)
    assert an_res.status_code == 200
    an_data = an_res.json()["analysis"]
    assert "absorbance" in an_data
    assert "detected_peaks" in an_data
    fringes = an_data["fringes"]
    assert fringes["status"] == "분석 완료"
    assert abs(fringes["physical_thickness_um"] - 25.0) < 1.5

    # 4. AI interpretation (rule-based fallback when no api key)
    ai_res = client.post(
        "/api/spectro/ftir/ai",
        json={"instrument": "ftir", "analysis_result": an_data, "user_notes": "표준 박막 검증"},
    )
    assert ai_res.status_code == 200
    ai_report = ai_res.json()["report"]
    assert "executive_summary" in ai_report
    assert len(ai_report["observed_facts"]) > 0

    # 5. Downloads: PDF, PNG, CSV, JSON
    dl_payload = {
        "instrument": "ftir",
        "analysis_result": an_data,
        "filename": "test_ps.csv",
        "ai_report": ai_report,
    }
    pdf_res = client.post("/api/spectro/ftir/download/pdf", json=dl_payload)
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert len(pdf_res.content) > 1000

    png_res = client.post("/api/spectro/ftir/download/chart", json=dl_payload)
    assert png_res.status_code == 200
    assert png_res.headers["content-type"] == "image/png"

    csv_res = client.post("/api/spectro/ftir/download/csv", json=dl_payload)
    assert csv_res.status_code == 200
    assert "Wavenumber_cm-1" in csv_res.text

    json_res = client.post("/api/spectro/ftir/download/json", json=dl_payload)
    assert json_res.status_code == 200
    assert "generator" in json_res.json()


def test_dsc_parse_and_analyze_flow():
    samp_res = client.get("/api/spectro/samples/dsc")
    csv_bytes = samp_res.json()["csv_content"].encode("utf-8")

    parse_res = client.post(
        "/api/spectro/dsc/parse",
        files={"file": ("test_pet.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert parse_res.status_code == 200
    parsed = parse_res.json()

    an_res = client.post(
        "/api/spectro/dsc/analyze",
        json={
            "instrument": "dsc",
            "filename": "test_pet.csv",
            "columns": parsed["columns"],
            "column_data": parsed["column_data"],
            "conditions": {
                "sample_mass_mg": 8.5,
                "heat_flow_unit": "mW",
                "standard_melting_enthalpy_J_per_g": 140.0,
            },
        },
    )
    assert an_res.status_code == 200
    an_data = an_res.json()["analysis"]
    assert an_data["status"] == "분석 완료"
    tm = an_data["transitions"]["melting"]
    assert tm["status"] == "검출 완료"
    assert abs(tm["tm_peak_c"] - 255.0) < 3.0
    assert abs(tm["delta_h_m_J_per_g"] - 45.0) < 6.0


def test_tga_parse_and_analyze_flow():
    samp_res = client.get("/api/spectro/samples/tga")
    csv_bytes = samp_res.json()["csv_content"].encode("utf-8")

    parse_res = client.post(
        "/api/spectro/tga/parse",
        files={"file": ("test_rubber.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert parse_res.status_code == 200
    parsed = parse_res.json()

    an_res = client.post(
        "/api/spectro/tga/analyze",
        json={
            "instrument": "tga",
            "filename": "test_rubber.csv",
            "columns": parsed["columns"],
            "column_data": parsed["column_data"],
            "conditions": {
                "initial_mass_mg": 10.0,
                "gas_switch_temp_c": 600.0,
                "input_is_percent": True,
            },
        },
    )
    assert an_res.status_code == 200
    an_data = an_res.json()["analysis"]
    assert an_data["status"] == "분석 완료"
    decomp = an_data["decomposition_characteristics"]
    assert abs(decomp["T5_c"] - 240.0) < 4.0
    assert abs(decomp["T10_c"] - 322.0) < 4.0
