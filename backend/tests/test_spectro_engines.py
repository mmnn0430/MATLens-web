"""Unit and Ground-Truth Tests for FT-IR, DSC, and TGA Analytical Engines."""
from __future__ import annotations

import pytest
from app.spectro.sample_data import (
    generate_ftir_synthetic_csv,
    generate_dsc_synthetic_csv,
    generate_tga_synthetic_csv,
)
from app.spectro.data_parser import parse_raw_file_bytes
from app.spectro.ftir_engine import (
    convert_ftir_signals,
    preprocess_and_detect_peaks,
    calculate_film_thickness_interference,
)
from app.spectro.dsc_engine import run_dsc_analysis
from app.spectro.tga_engine import run_tga_analysis
from app.spectro.pdf_generator import generate_spectro_pdf_report
from app.spectro.ai_engine import generate_rule_based_fallback_summary


def test_ftir_engine_ground_truth():
    # 1. Generate known Polystyrene thin film (25.0 um thickness, n=1.59)
    csv_text = generate_ftir_synthetic_csv(film_thickness_um=25.0, refractive_index=1.59)
    parsed = parse_raw_file_bytes(csv_text.encode("utf-8"), "test_ps.csv")

    assert len(parsed["columns"]) == 2
    wn = parsed["column_data"][0]
    t_pct = parsed["column_data"][1]

    # %T to Absorbance conversion
    conv = convert_ftir_signals(wn, t_pct, "transmittance")
    assert len(conv["absorbance"]) == len(wn)
    assert conv["wavenumbers"][0] > conv["wavenumbers"][-1]  # Decreasing order

    # Preprocessing and peak detection
    proc = preprocess_and_detect_peaks(conv["wavenumbers"], conv["absorbance"], conv["transmittance_pct"])
    assert proc["peak_count"] >= 5

    # Check characteristic PS peaks detected
    peak_wns = [p["wavenumber"] for p in proc["detected_peaks"]]
    assert any(abs(w - 3026.0) < 6.0 for w in peak_wns)
    assert any(abs(w - 1601.0) < 6.0 for w in peak_wns)
    assert any(abs(w - 698.0) < 6.0 for w in peak_wns)

    # Interference fringe thickness (tested in high-transmission window 2400 ~ 2750 cm⁻¹)
    fringes = calculate_film_thickness_interference(
        conv["wavenumbers"], conv["transmittance_pct"], refractive_index=1.59, wavenumber_range=(2400.0, 2750.0), min_prominence=1.5
    )
    assert fringes["status"] == "분석 완료"
    assert fringes["physical_thickness_um"] is not None
    # Tolerance within 1.5 um of 25.0 um
    assert abs(fringes["physical_thickness_um"] - 25.0) < 1.5
    assert fringes["m_interval_count"] == fringes["k_extrema_count"] - 1


def test_ftir_missing_refractive_index():
    csv_text = generate_ftir_synthetic_csv()
    parsed = parse_raw_file_bytes(csv_text.encode("utf-8"), "test_ps.csv")
    conv = convert_ftir_signals(parsed["column_data"][0], parsed["column_data"][1], "transmittance")
    fringes = calculate_film_thickness_interference(
        conv["wavenumbers"], conv["transmittance_pct"], refractive_index=None
    )
    assert fringes["status"] == "확인 필요"
    assert fringes["physical_thickness_um"] is None
    assert fringes["optical_thickness_um"] is not None


def test_dsc_engine_ground_truth():
    # 2. Generate known multi-step PET thermal profile
    csv_text = generate_dsc_synthetic_csv(sample_mass_mg=8.5, heating_rate_c_min=10.0)
    parsed = parse_raw_file_bytes(csv_text.encode("utf-8"), "test_pet.csv")

    t_s = parsed["column_data"][0]
    temp = parsed["column_data"][1]
    hf_mw = parsed["column_data"][2]

    # Run DSC with known ΔHm° = 140.0 J/g
    dsc_res = run_dsc_analysis(
        temp, hf_mw, time_s=t_s, sample_mass_mg=8.5, heat_flow_unit="mW", standard_melting_enthalpy_J_per_g=140.0
    )
    assert dsc_res["status"] == "분석 완료"
    assert len(dsc_res["segments"]) >= 3  # 1st Heating, Cooling, 2nd Heating

    # Verify Melting Tm
    tm = dsc_res["transitions"]["melting"]
    assert tm["status"] == "검출 완료"
    assert abs(tm["tm_peak_c"] - 255.0) < 3.0
    assert abs(tm["delta_h_m_J_per_g"] - 45.0) < 6.0

    # Verify Crystallinity
    xc = dsc_res["transitions"]["crystallinity"]
    assert xc["status"] == "분석 완료"
    assert 20.0 <= xc["crystallinity_pct"] <= 40.0


def test_dsc_missing_standard_enthalpy():
    csv_text = generate_dsc_synthetic_csv()
    parsed = parse_raw_file_bytes(csv_text.encode("utf-8"), "test_pet.csv")
    dsc_res = run_dsc_analysis(
        parsed["column_data"][1], parsed["column_data"][2], standard_melting_enthalpy_J_per_g=None
    )
    xc = dsc_res["transitions"]["crystallinity"]
    assert xc["status"] == "기준 엔탈피 입력 필요"
    assert xc["crystallinity_pct"] is None


def test_tga_engine_ground_truth():
    # 3. Generate Rubber composite with N2 -> Air switch at 600°C
    csv_text = generate_tga_synthetic_csv(initial_mass_mg=10.0, heating_rate_c_min=10.0)
    parsed = parse_raw_file_bytes(csv_text.encode("utf-8"), "test_rubber.csv")

    t_s = parsed["column_data"][0]
    temp = parsed["column_data"][1]
    mass_mg = parsed["column_data"][2]
    r_pct = parsed["column_data"][3]

    tga_res = run_tga_analysis(
        temp, r_pct, time_s=t_s, initial_mass_mg=10.0, input_is_percent=True, gas_switch_temp_c=600.0
    )
    assert tga_res["status"] == "분석 완료"

    decomp = tga_res["decomposition_characteristics"]
    assert abs(decomp["T5_c"] - 240.0) < 4.0
    assert abs(decomp["T10_c"] - 322.0) < 4.0

    # Stepwise verification: 3 distinct steps
    assert len(tga_res["steps"]) >= 2
    # Final residual around 5%
    res = tga_res["residual"]
    assert abs(res["final_residual_pct"] - 5.0) < 1.0


def test_pdf_generators_for_all_instruments():
    # FT-IR PDF
    ftir_csv = generate_ftir_synthetic_csv()
    p_ftir = parse_raw_file_bytes(ftir_csv.encode("utf-8"), "sample.csv")
    c_ftir = convert_ftir_signals(p_ftir["column_data"][0], p_ftir["column_data"][1])
    pr_ftir = preprocess_and_detect_peaks(c_ftir["wavenumbers"], c_ftir["absorbance"], c_ftir["transmittance_pct"])
    fr_ftir = calculate_film_thickness_interference(c_ftir["wavenumbers"], c_ftir["transmittance_pct"])
    analysis_ftir = {**c_ftir, "peaks": pr_ftir["detected_peaks"], "fringes": fr_ftir}
    pdf_ftir = generate_spectro_pdf_report("ftir", analysis_ftir, "ftir.csv")
    assert len(pdf_ftir) > 10000

    # DSC PDF
    dsc_csv = generate_dsc_synthetic_csv()
    p_dsc = parse_raw_file_bytes(dsc_csv.encode("utf-8"), "sample.csv")
    analysis_dsc = run_dsc_analysis(p_dsc["column_data"][1], p_dsc["column_data"][2], time_s=p_dsc["column_data"][0], sample_mass_mg=8.5)
    pdf_dsc = generate_spectro_pdf_report("dsc", analysis_dsc, "dsc.csv")
    assert len(pdf_dsc) > 10000

    # TGA PDF
    tga_csv = generate_tga_synthetic_csv()
    p_tga = parse_raw_file_bytes(tga_csv.encode("utf-8"), "sample.csv")
    analysis_tga = run_tga_analysis(p_tga["column_data"][1], p_tga["column_data"][3], time_s=p_tga["column_data"][0], initial_mass_mg=10.0, input_is_percent=True)
    pdf_tga = generate_spectro_pdf_report("tga", analysis_tga, "tga.csv")
    assert len(pdf_tga) > 10000
