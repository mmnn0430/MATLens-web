"""Comprehensive Verification Suite for MatLens (Scientific Engine + Edge Cases + FastAPI End-to-End)."""
from __future__ import annotations

import io
import json
import math
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import PROJECTS_STORAGE_DIR, SAMPLES_DIR
from app.engine.ref_library import load_reference_library, parse_user_cif
from app.engine.report_engine import validate_ai_report_against_evidence
from app.engine.sem_engine import run_sem_pipeline
from app.engine.xrd_engine import run_xrd_pipeline
from app.main import app
from app.schemas import AIReportSchema, Point2D, SEMParams, XRDParams


@pytest.fixture(scope="module")
def ref_entries():
    return load_reference_library()["entries"]


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------------- #
# 1. Synthetic XRD Ground-Truth & Crystallographic Standard Verification
# --------------------------------------------------------------------------- #
def test_xrd_synthetic_peak_position_width_and_smoothing_invariance(ref_entries):
    """Verify exact peak position, FWHM, Scherrer size, and that Savitzky-Golay smoothing does NOT distort fitted FWHM."""
    x = np.arange(20.0, 70.01, 0.02)
    lam = 1.5406
    true_d_nm = 30.0
    inst_fwhm = 0.08
    true_pos = 28.441  # Si (111)
    th_rad = math.radians(true_pos / 2.0)
    beta_sample_deg = math.degrees((0.90 * (lam / 10.0)) / (true_d_nm * math.cos(th_rad)))
    true_fwhm_deg = math.sqrt(beta_sample_deg**2 + inst_fwhm**2)

    # Pure Gaussian peak + baseline
    y = 200.0 + 4000.0 * np.exp(-4.0 * math.log(2.0) * ((x - true_pos) / true_fwhm_deg) ** 2)
    csv_bytes = ("2Theta,Intensity\n" + "\n".join(f"{xv:.4f},{yv:.3f}" for xv, yv in zip(x, y))).encode("utf-8")

    res_smooth = run_xrd_pipeline(
        csv_bytes,
        XRDParams(use_smoothing=True, smooth_window=15, fit_profile="gaussian", inst_fwhm_deg=inst_fwhm),
        ref_entries,
        ["Si"],
    )
    res_nosmooth = run_xrd_pipeline(
        csv_bytes,
        XRDParams(use_smoothing=False, fit_profile="gaussian", inst_fwhm_deg=inst_fwhm),
        ref_entries,
        ["Si"],
    )

    assert len(res_smooth["peaks"]) == 1
    p_s = res_smooth["peaks"][0]
    p_ns = res_nosmooth["peaks"][0]

    assert abs(p_s["two_theta"] - true_pos) < 0.005
    assert abs(p_s["fwhm_deg"] - true_fwhm_deg) < 0.01
    # Quantitative FWHM must be identical regardless of detection smoothing!
    assert abs(p_s["fwhm_deg"] - p_ns["fwhm_deg"]) < 1e-4

    # Scherrer recovery with instrumental broadening correction
    sch = res_smooth["scherrer"]
    assert sch["is_instrument_corrected"] is True
    assert abs(sch["mean_nm"] - true_d_nm) < 1.5

    # Without instrumental broadening -> explicitly marked '기기 선폭 미보정 추정값' and smaller lower-bound D
    res_uncorr = run_xrd_pipeline(
        csv_bytes,
        XRDParams(fit_profile="gaussian", inst_fwhm_deg=None),
        ref_entries,
        ["Si"],
    )
    assert res_uncorr["scherrer"]["status_badge"] == "기기 선폭 미보정 추정값"
    assert res_uncorr["scherrer"]["mean_nm"] < sch["mean_nm"]


def test_xrd_silicon_srm640_and_multiphase_tio2(ref_entries):
    """Verify NIST SRM 640f reference pattern and Anatase+Rutile multiphase sample."""
    si_raw = (SAMPLES_DIR / "sample_silicon_srm640_xrd.csv").read_bytes()
    gt = json.loads((SAMPLES_DIR / "ground_truth.json").read_text(encoding="utf-8"))
    si_res = run_xrd_pipeline(si_raw, XRDParams(inst_fwhm_deg=0.06), ref_entries, ["Si"])

    assert si_res["phase_matching"]["candidates"][0]["phase_id"] == "REF-SI-DIA"
    assert si_res["phase_matching"]["candidates"][0]["score"] > 85.0
    # Check all 6 reflections recovered within 0.02 deg
    meas_positions = [p["two_theta"] for p in si_res["peaks"]]
    for tp in gt["sample_silicon_srm640_xrd"]["true_peaks"]:
        closest = min(abs(mp - tp["two_theta"]) for mp in meas_positions)
        assert closest < 0.02

    # Multiphase TiO2 sample
    tio2_raw = (SAMPLES_DIR / "sample_anatase_rutile_xrd.csv").read_bytes()
    tio2_res = run_xrd_pipeline(tio2_raw, XRDParams(inst_fwhm_deg=0.08), ref_entries, ["Ti", "O"])
    top1 = tio2_res["phase_matching"]["candidates"][0]
    assert top1["phase_id"] == "REF-TIO2-ANA"
    mp = tio2_res["phase_matching"]["multiphase_comparison"]
    assert mp is not None
    assert "Rutile (TiO2)" in mp["combinations"][0]["phases"]
    assert mp["combinations"][0]["residual_r_pat"] < mp["single_phase_baseline"]["residual_r_pat"]
    # Anatase crystallite size recovery (true = 24 nm with slight microstrain 0.001)
    assert 19.0 <= tio2_res["scherrer"]["mean_nm"] <= 28.0
    # Williamson-Hall active on Anatase
    assert tio2_res["williamson_hall"]["n_peaks"] >= 4


def test_user_cif_upload_parsing():
    cif_bytes = (SAMPLES_DIR / "custom_zno_wurtzite.cif").read_bytes()
    entry = parse_user_cif(cif_bytes, "custom_zno_wurtzite.cif")
    assert entry["formula"] == "ZnO"
    assert entry["is_user_cif"] is True
    assert len(entry["d_A"]) >= 5


# --------------------------------------------------------------------------- #
# 2. Synthetic Known-Geometry SEM & Scale Recalibration Verification
# --------------------------------------------------------------------------- #
def test_sem_known_disks_and_scale_recalibration():
    """Create non-overlapping known circles (r = 25 px => diameter = 50 px) and verify px vs calibrated nm/um stats."""
    w, h = 600, 500
    img = Image.new("L", (w, h), 20)
    draw = ImageDraw.Draw(img)
    centers = [(120, 120), (280, 120), (440, 120), (120, 300), (280, 300), (440, 300)]
    r_px = 25
    for cx, cy in centers:
        draw.ellipse([cx - r_px, cy - r_px, cx + r_px, cy + r_px], fill=220)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_png = buf.getvalue()

    # Case A: Unconfirmed scale -> MUST report in 'px'
    res_px, _, _ = run_sem_pipeline(raw_png, SEMParams(scale_confirmed=False))
    assert res_px["scale"]["is_calibrated"] is False
    assert res_px["scale"]["display_unit"] == "px"
    assert res_px["n_valid_objects"] == 6
    # True equivalent diameter of r=25 circle is ~50.0 px
    assert 48.5 <= res_px["summary_stats"]["mean_diameter"] <= 51.8
    assert res_px["summary_stats"]["median_circularity"] > 0.85

    # Case B: Calibrated 100 px = 200 nm (2 nm/px) -> diameter ~100 nm
    res_nm1, _, _ = run_sem_pipeline(
        raw_png,
        SEMParams(scale_confirmed=True, scale_length_px=100.0, scale_real_value=200.0, scale_unit="nm", segmentation_confirmed=True),
    )
    assert res_nm1["scale"]["display_unit"] == "nm"
    assert 97.0 <= res_nm1["summary_stats"]["mean_diameter"] <= 103.6

    # Case C: Scale modified to 100 px = 400 nm (4 nm/px) -> diameter ~200 nm (exact 2x!)
    res_nm2, _, _ = run_sem_pipeline(
        raw_png,
        SEMParams(scale_confirmed=True, scale_length_px=100.0, scale_real_value=400.0, scale_unit="nm", segmentation_confirmed=True),
    )
    ratio = res_nm2["summary_stats"]["mean_diameter"] / res_nm1["summary_stats"]["mean_diameter"]
    assert abs(ratio - 2.0) < 0.01


def test_sem_grain_linear_intercept_and_manual_edit():
    raw_grain = (SAMPLES_DIR / "sample_sintered_grains_sem.png").read_bytes()
    # Must refuse if grain_boundary_confirmed is False
    res_blocked, _, _ = run_sem_pipeline(raw_grain, SEMParams(mode="grain", grain_boundary_confirmed=False))
    assert res_blocked["status"] == "계산 불가"
    assert res_blocked["grain_intercept"] is None

    # Active grain intercept mode
    res_grain, _, _ = run_sem_pipeline(
        raw_grain,
        SEMParams(
            mode="grain",
            grain_boundary_confirmed=True,
            scale_confirmed=True,
            scale_length_px=200.0,
            scale_real_value=5.0,
            scale_unit="µm",
        ),
    )
    gi = res_grain["grain_intercept"]
    assert gi is not None
    assert gi["effective_intersections"] >= 20
    assert gi["mean_intercept_length"] is not None

    # Manual add 5 intersections -> effective count increases by 5 and mean intercept decreases
    res_edited, _, _ = run_sem_pipeline(
        raw_grain,
        SEMParams(
            mode="grain",
            grain_boundary_confirmed=True,
            scale_confirmed=True,
            scale_length_px=200.0,
            scale_real_value=5.0,
            scale_unit="µm",
            added_intersections=[Point2D(x=100 + i * 20, y=100) for i in range(5)],
        ),
    )
    assert res_edited["grain_intercept"]["effective_intersections"] == gi["effective_intersections"] + 5
    assert res_edited["grain_intercept"]["mean_intercept_length"] < gi["mean_intercept_length"]


# --------------------------------------------------------------------------- #
# 3. Failure & Edge Cases (Never substitute 0 or fake normal values!)
# --------------------------------------------------------------------------- #
def test_edge_cases_constant_signal_overlapping_peaks_zero_objects_and_ai_validator(ref_entries):
    # 1) Constant XRD signal -> status '계산 불가', mean_nm is None (NOT 0!)
    x = np.arange(10.0, 60.0, 0.05)
    y_const = np.full_like(x, 350.0)
    const_csv = ("2Theta,Intensity\n" + "\n".join(f"{xv:.3f},{yv:.1f}" for xv, yv in zip(x, y_const))).encode("utf-8")
    res_const = run_xrd_pipeline(const_csv, XRDParams(), ref_entries, [])
    assert res_const["status"] == "계산 불가"
    assert res_const["peaks"] == []
    assert res_const["scherrer"]["mean_nm"] is None

    # 2) Overlapping XRD doublet (0.36 deg separation with FWHM=0.28 deg -> resolved saddle dip, < 2.2*FWHM overlap)
    x_fine = np.arange(10.0, 60.0, 0.02)
    y_dbl = (
        100.0
        + 2000.0 * np.exp(-4.0 * math.log(2.0) * ((x_fine - 30.00) / 0.28) ** 2)
        + 1700.0 * np.exp(-4.0 * math.log(2.0) * ((x_fine - 30.36) / 0.28) ** 2)
    )
    dbl_csv = ("2Theta,Intensity\n" + "\n".join(f"{xv:.3f},{yv:.2f}" for xv, yv in zip(x_fine, y_dbl))).encode("utf-8")
    res_dbl = run_xrd_pipeline(dbl_csv, XRDParams(min_distance_deg=0.12, prominence_rel=0.015), ref_entries, [])
    assert len(res_dbl["peaks"]) == 2
    assert all(p["is_overlapping"] is True for p in res_dbl["peaks"])
    assert all(p["fit_status"] == "overlapping" for p in res_dbl["peaks"])
    assert res_dbl["scherrer"]["n_used_peaks"] == 0
    assert res_dbl["scherrer"]["mean_nm"] is None
    # Insufficient peaks for W-H as well
    assert res_dbl["williamson_hall"]["status"] == "계산 불가"

    # 3) Conditional crystallinity without sample_family -> None
    res_cryst = run_xrd_pipeline(
        dbl_csv,
        XRDParams(crystallinity={"enabled": True, "sample_family": ""}),
        ref_entries,
        [],
    )
    assert res_cryst["crystallinity"]["index_pct"] is None

    # 4) SEM zero objects (blank dark image) -> status '계산 불가', summary_stats is None (NOT 0!)
    blank_img = Image.new("L", (300, 300), 25)
    b_io = io.BytesIO()
    blank_img.save(b_io, format="PNG")
    res_zero, _, _ = run_sem_pipeline(b_io.getvalue(), SEMParams(threshold_mode="manual", manual_threshold=200))
    assert res_zero["status"] == "계산 불가"
    assert res_zero["n_valid_objects"] == 0
    assert res_zero["summary_stats"] is None

    # 5) SEM low-contrast grain failure -> '계산 불가', mean_intercept_length is None
    res_bad_grain, _, _ = run_sem_pipeline(
        b_io.getvalue(),
        SEMParams(mode="grain", grain_boundary_confirmed=True),
    )
    assert res_bad_grain["status"] == "계산 불가"
    assert res_bad_grain["grain_intercept"]["mean_intercept_length"] is None

    # 6) AI Validator catches fabricated numbers, unknown Evidence IDs, and banned '신뢰도 98%'
    mock_ai = AIReportSchema(
        executive_summary="이 결과의 신뢰도 98%로 Anatase입니다.",
        xrd_observed_facts=[{"statement": "결정자 크기는 999.9 nm입니다.", "evidence_ids": ["FAKE-ID-1"]}],
        sem_observed_facts=[],
        integrated_hypotheses=[],
        discrepancies_and_checks=[],
        next_experiments=[{"experiment": "TEM", "purpose": "일차입자 확인"}],
        limitations=["2D 투영 한계"],
    )
    check = validate_ai_report_against_evidence(
        mock_ai,
        {"XRD-SCHERRER": {"source_type": "계산값", "label": "Scherrer", "value": {"mean_nm": 24.1}}},
        can_integrate=True,
    )
    assert check["has_banned_confidence_score"] is True
    assert "FAKE-ID-1" in check["invalid_evidence_ids"]
    assert 999.9 in check["unmatched_unit_numbers"]
    assert check["passed_all_checks"] is False


# --------------------------------------------------------------------------- #
# 4. End-to-End API Flow: Sample Demo, Re-runs, Downloads, Error Handling & Delete Cleanup
# --------------------------------------------------------------------------- #
def test_e2e_api_workflow_downloads_and_cleanup(client: TestClient):
    # 1) Health check
    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    assert h["ref_phase_count"] >= 30

    # 2) Sample Demo Project creation
    proj = client.post("/api/projects/sample-demo?preset=tio2_powder").json()
    pid = proj["id"]
    assert proj["is_sample_demo"] is True
    assert len(proj["files"]) == 2

    # 3) Invalid upload rejection (wrong extension & corrupted CSV)
    bad_ext = client.post(
        f"/api/projects/{pid}/files/xrd",
        files={"file": ("bad.exe", b"MZ...", "application/octet-stream")},
    )
    assert bad_ext.status_code == 400

    bad_csv = client.post(
        f"/api/projects/{pid}/files/xrd",
        files={"file": ("broken.csv", b"not,numbers\na,b\nc,d\n", "text/csv")},
    )
    assert bad_csv.status_code == 400
    assert "수치 데이터" in bad_csv.json()["detail"]

    # 4) Start Run #1 (AI disabled -> works without API key)
    run_req = {
        "xrd_params": proj["current_conditions"]["xrd_params"],
        "sem_params": proj["current_conditions"]["sem_params"],
        "run_ai_interpretation": False,
    }
    started = client.post(f"/api/projects/{pid}/runs", json=run_req).json()
    run_id = started["run_id"]
    assert started["run_number"] == 1

    # Poll until completed
    for _ in range(40):
        r_data = client.get(f"/api/runs/{run_id}").json()
        if r_data["status"] in ("completed", "failed"):
            break
        time.sleep(0.15)
    assert r_data["status"] == "completed"
    assert r_data["xrd_result"]["scherrer"]["mean_nm"] is not None
    assert r_data["sem_result"]["summary_stats"]["d50"] > 0

    # 5) Verify all 5 downloads (PDF, XRD CSV, SEM CSV, JSON, Overlay PNG)
    pdf_res = client.get(f"/api/runs/{run_id}/download/pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.content[:4] == b"%PDF"
    assert len(pdf_res.content) > 5000

    xrd_csv = client.get(f"/api/runs/{run_id}/download/xrd-peaks.csv")
    assert xrd_csv.status_code == 200
    assert "two_theta_deg" in xrd_csv.content.decode("utf-8-sig")

    sem_csv = client.get(f"/api/runs/{run_id}/download/sem-objects.csv")
    assert sem_csv.status_code == 200
    assert "circularity_4piA_P2" in sem_csv.content.decode("utf-8-sig")

    json_res = client.get(f"/api/runs/{run_id}/download/result.json")
    assert json_res.status_code == 200
    assert json_res.json()["run"]["id"] == run_id

    ov_res = client.get(f"/api/runs/{run_id}/download/overlay.png")
    assert ov_res.status_code == 200
    assert ov_res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # 6) Same-sample restriction check: uncheck is_same_sample and run Run #2
    client.patch(f"/api/projects/{pid}", json={"is_same_sample": False})
    started2 = client.post(f"/api/projects/{pid}/runs", json=run_req).json()
    run2_id = started2["run_id"]
    assert started2["run_number"] == 2
    for _ in range(40):
        r2_data = client.get(f"/api/runs/{run2_id}").json()
        if r2_data["status"] in ("completed", "failed"):
            break
        time.sleep(0.15)
    assert r2_data["rule_summary"]["can_integrate"] is False
    assert "제한" in r2_data["rule_summary"]["cross_status"]

    # 7) Delete project -> verify DB record and disk folder are completely removed
    proj_folder = PROJECTS_STORAGE_DIR / pid
    assert proj_folder.exists()
    del_res = client.delete(f"/api/projects/{pid}")
    assert del_res.status_code == 200
    assert not proj_folder.exists()
    assert client.get(f"/api/projects/{pid}").status_code == 404
