"""Verification Series Seeder & Synchronized Comparison Export Generators (PNG, CSV, JSON, PDF).

Ensures:
1. Distinct, reproducible synthetic verification specimens (clearly badged as synthetic demo)
   covering all 5 mandatory verification scenarios:
   - Process variation series (500 °C -> 700 °C -> 850 °C/4h confounded)
   - Multiple distinct SEM fields of view per specimen (A1 vs A2 with distinct pixel content, watermarks & SHA-256)
   - Doping content series (0 -> 2 -> 5 at% Nb, plus 5 wt% unit mismatch)
   - Dopant type series (Undoped vs Nb 2 at% vs Fe 2 at%)
   - Unrelated material exclusion (Si standard in workspace)
   - Uncalibrated SEM scale & restricted XRD 2theta range cases
2. Synchronized exports (Stacked XRD PNG, Peaks CSV, Bundle JSON, Unified PDF)
   that strictly reflect the user's current specimen ordering and selected SEM FOVs (e.g. B -> A with A2).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Any

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from xml.sax.saxutils import escape

from ..config import PROJECTS_STORAGE_DIR
from ..db import get_conn, new_id, record_history, utc_now_iso
from ..schemas import ROIRect, SEMParams, XRDParams
from .pdf_export import _register_korean_font
from .ref_library import load_reference_library
from .report_engine import build_rule_summary
from .sem_engine import inspect_sem_bytes, run_sem_pipeline
from .xrd_engine import inspect_and_parse_xrd, run_xrd_pipeline


def _configure_matplotlib_korean() -> None:
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["font.family"] = "sans-serif"
    plt.rcParams["font.sans-serif"] = ["Malgun Gothic", "NanumGothic", "AppleGothic", "DejaVu Sans"]


def _synth_xrd_csv_bytes(
    two_theta_min: float,
    two_theta_max: float,
    step_deg: float,
    peaks_spec: list[tuple[float, float, float]],  # (center_2theta, height, fwhm)
    seed: int = 42,
) -> bytes:
    """Generate realistic 2theta-intensity CSV bytes with background and Poisson-like noise."""
    rng = np.random.default_rng(seed)
    x = np.arange(two_theta_min, two_theta_max + 1e-6, step_deg)
    # Smooth low-angle scattering background
    bg = 45.0 + 110.0 * np.exp(-(x - 15.0) / 18.0)
    y = bg.copy()
    for c_tt, h_val, fwhm in peaks_spec:
        sigma = fwhm / 2.3548
        gamma = fwhm / 2.0
        gauss = np.exp(-0.5 * ((x - c_tt) / max(sigma, 1e-4)) ** 2)
        lorentz = 1.0 / (1.0 + ((x - c_tt) / max(gamma, 1e-4)) ** 2)
        y += h_val * (0.65 * gauss + 0.35 * lorentz)
    noise = rng.normal(0.0, 4.2, size=len(x))
    y = np.clip(y + noise, 5.0, None)

    buf = io.StringIO()
    buf.write("# Synthetic Verification XRD Pattern\n")
    buf.write("two_theta_deg,intensity_counts\n")
    for xv, yv in zip(x, y):
        buf.write(f"{xv:.4f},{yv:.2f}\n")
    return buf.getvalue().encode("utf-8")


def _synth_sem_image_bytes(
    label_tag: str,
    particle_radii_px: list[int],
    positions: list[tuple[int, int]],
    draw_scalebar: bool = True,
    scale_text: str = "500 nm",
    scale_len_px: int = 200,
    bg_level: int = 38,
    seed: int = 101,
) -> bytes:
    """Generate a visually distinct, deterministic grayscale SEM microstructure PNG
    with a databar, fiducial tag (e.g., 'FOV-A1', 'FOV-A2', 'FOV-B1'), and optional scalebar.
    """
    rng = np.random.default_rng(seed)
    h, w = 520, 640
    img = np.full((h, w), bg_level, dtype=np.float32)

    # Subtle background texture
    img += rng.normal(0.0, 3.0, size=(h, w))

    yy, xx = np.ogrid[:h, :w]
    for (cx, cy), r in zip(positions, particle_radii_px):
        if cy + r >= 445:
            continue
        dist2 = (xx - cx) ** 2 + (yy - cy) ** 2
        mask = dist2 <= r**2
        if not np.any(mask):
            continue
        # 3D-like spherical shading for SE look
        rel_r = np.sqrt(dist2[mask]) / max(float(r), 1.0)
        shade = 155.0 + 65.0 * (1.0 - 0.55 * rel_r**2)
        img[mask] = np.maximum(img[mask], shade)

    img_u8 = np.clip(img, 0, 255).astype(np.uint8)
    rgb = cv2.cvtColor(img_u8, cv2.COLOR_GRAY2BGR)

    # Top-left fiducial marker box inside ROI so visually unmistakable in both ROI and raw views
    cv2.rectangle(rgb, (10, 10), (195, 42), (22, 22, 22), -1)
    cv2.rectangle(rgb, (10, 10), (195, 42), (210, 210, 210), 1)
    cv2.putText(rgb, label_tag, (18, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (245, 245, 245), 2, cv2.LINE_AA)

    # Bottom databar (y: 450..520)
    cv2.rectangle(rgb, (0, 450), (w, h), (15, 15, 15), -1)
    cv2.line(rgb, (0, 450), (w, 450), (180, 180, 180), 1)
    cv2.putText(rgb, f"MATLENS SEM | {label_tag}", (16, 488), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (230, 230, 230), 1, cv2.LINE_AA)

    if draw_scalebar:
        sb_x0 = w - scale_len_px - 30
        sb_x1 = w - 30
        sb_y = 480
        cv2.line(rgb, (sb_x0, sb_y), (sb_x1, sb_y), (255, 255, 255), 4)
        cv2.line(rgb, (sb_x0, sb_y - 6), (sb_x0, sb_y + 6), (255, 255, 255), 2)
        cv2.line(rgb, (sb_x1, sb_y - 6), (sb_x1, sb_y + 6), (255, 255, 255), 2)
        cv2.putText(rgb, scale_text, (sb_x0 + 40, sb_y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    else:
        cv2.putText(rgb, "NO SCALE BAR", (w - 180, 488), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (180, 180, 180), 1, cv2.LINE_AA)

    ok, enc = cv2.imencode(".png", rgb)
    if not ok:
        raise RuntimeError("Failed to encode synthetic SEM PNG")
    return enc.tobytes()


def _create_seeded_project_with_run(
    sample_name: str,
    description: str,
    expected_elements: list[str],
    expected_formula: str,
    experiment_meta: dict[str, Any],
    xrd_file_tuple: tuple[str, bytes, XRDParams] | None,
    sem_files_list: list[tuple[str, bytes, dict[str, Any], SEMParams]],
) -> dict[str, Any]:
    """Create a project, attach XRD and 1+ SEM files, and run synchronous analysis so results are immediately ready."""
    pid = new_id("proj")
    now = utc_now_iso()
    proj_dir = PROJECTS_STORAGE_DIR / pid
    (proj_dir / "uploads").mkdir(parents=True, exist_ok=True)

    xp_default = xrd_file_tuple[2] if xrd_file_tuple else XRDParams()
    sp_default = sem_files_list[0][3] if sem_files_list else SEMParams()

    cond_obj = {
        "xrd_params": xp_default.model_dump(),
        "sem_params": sp_default.model_dump(),
        "experiment_meta": {**experiment_meta, "is_synthetic_demo": True},
    }

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO projects (
                id, sample_name, description, expected_elements_json, expected_formula,
                is_same_sample, is_sample_demo, current_conditions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
            """,
            (
                pid,
                sample_name,
                description,
                json.dumps(expected_elements, ensure_ascii=False),
                expected_formula,
                json.dumps(cond_obj, ensure_ascii=False),
                now,
                now,
            ),
        )

    lib_data = load_reference_library()
    ref_entries = list(lib_data["entries"])

    xrd_res = None
    xrd_fid = None
    file_hashes: dict[str, str] = {}

    if xrd_file_tuple is not None:
        x_fname, x_bytes, x_params = xrd_file_tuple
        x_sha = hashlib.sha256(x_bytes).hexdigest()
        xrd_fid = new_id("file")
        x_rel = f"uploads/{xrd_fid}_{x_fname}"
        (proj_dir / x_rel).write_bytes(x_bytes)
        x_insp = inspect_and_parse_xrd(x_bytes)["inspection"]
        file_hashes[f"xrd:{x_fname}"] = x_sha

        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO project_files (
                    id, project_id, file_role, original_filename, stored_relpath,
                    sha256, size_bytes, mime_type, inspection_json, is_sample, created_at
                ) VALUES (?, ?, 'xrd', ?, ?, ?, ?, 'text/csv', ?, 1, ?)
                """,
                (xrd_fid, pid, x_fname, x_rel, x_sha, len(x_bytes), json.dumps(x_insp, ensure_ascii=False), now),
            )

        xrd_res = run_xrd_pipeline(
            x_bytes,
            x_params,
            ref_entries,
            expected_elements,
            sample_name=sample_name,
            sample_description=description,
            expected_formula=expected_formula,
        )
        xrd_res["source_file_id"] = xrd_fid
        xrd_res["source_filename"] = x_fname
        xrd_res["source_sha256"] = x_sha

    # Attach all SEM files (e.g. A1, A2) and create a run for each SEM file so switching A1 <-> A2 has full analysis!
    created_run_ids: list[str] = []
    for idx_s, (s_fname, s_bytes, s_meta_extra, s_params) in enumerate(sem_files_list):
        s_sha = hashlib.sha256(s_bytes).hexdigest()
        s_fid = new_id("file")
        s_rel = f"uploads/{s_fid}_{s_fname}"
        (proj_dir / s_rel).write_bytes(s_bytes)
        s_insp = inspect_sem_bytes(s_bytes)
        s_insp.update(s_meta_extra)
        if s_params.scale_confirmed and s_params.scale_real_value:
            s_insp["scale_override"] = {
                "scale_confirmed": True,
                "real_length": s_params.scale_real_value,
                "unit": s_params.scale_unit,
                "length_px": s_params.scale_length_px or 200.0,
            }
        file_hashes[f"sem:{s_fname}"] = s_sha

        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO project_files (
                    id, project_id, file_role, original_filename, stored_relpath,
                    sha256, size_bytes, mime_type, inspection_json, is_sample, created_at
                ) VALUES (?, ?, 'sem', ?, ?, ?, ?, 'image/png', ?, 1, ?)
                """,
                (s_fid, pid, s_fname, s_rel, s_sha, len(s_bytes), json.dumps(s_insp, ensure_ascii=False), now),
            )

        run_id = new_id("run")
        run_num = idx_s + 1
        run_dir = proj_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        sem_res, ov_bytes, roi_bytes = run_sem_pipeline(
            s_bytes,
            s_params,
            xrd_result=xrd_res,
            expected_formula=expected_formula,
        )
        sem_res["source_file_id"] = s_fid
        sem_res["source_filename"] = s_fname
        sem_res["source_sha256"] = s_sha
        sem_res["fov_label"] = s_meta_extra.get("fov_label") or s_fname
        sem_res["imaging_mode"] = s_meta_extra.get("imaging_mode", "SE")
        sem_res["magnification"] = s_meta_extra.get("magnification", "50,000x")

        (run_dir / "overlay.png").write_bytes(ov_bytes)
        (run_dir / "roi.png").write_bytes(roi_bytes)

        rule_summary = build_rule_summary(
            {
                "id": pid,
                "sample_name": sample_name,
                "description": description,
                "expected_elements": expected_elements,
                "expected_formula": expected_formula,
                "is_same_sample": True,
                "is_sample_demo": True,
            },
            xrd_res,
            sem_res,
        )

        params_dump = {
            "xrd_params": xp_default.model_dump(),
            "sem_params": s_params.model_dump(),
            "run_ai_interpretation": False,
            "selected_xrd_file_id": xrd_fid,
            "selected_sem_file_id": s_fid,
        }

        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO analysis_runs (
                    id, project_id, run_number, status, progress_pct, stage_message,
                    params_json, file_hashes_json, ref_library_version, algo_versions_json,
                    xrd_result_json, sem_result_json, rule_summary_json,
                    overlay_relpath, roi_relpath, created_at, completed_at
                ) VALUES (?, ?, ?, 'completed', 100, '분석 완료', ?, ?, '1.1.0', '{}', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    pid,
                    run_num,
                    json.dumps(params_dump, ensure_ascii=False),
                    json.dumps(file_hashes, ensure_ascii=False),
                    json.dumps(xrd_res, ensure_ascii=False) if xrd_res else None,
                    json.dumps(sem_res, ensure_ascii=False),
                    json.dumps(rule_summary, ensure_ascii=False),
                    f"runs/{run_id}/overlay.png",
                    f"runs/{run_id}/roi.png",
                    now,
                    now,
                ),
            )
        created_run_ids.append(run_id)

    return {"project_id": pid, "sample_name": sample_name, "run_ids": created_run_ids}


def ensure_verification_series_seeded(force_reseed: bool = False) -> dict[str, Any]:
    """Seed the multi-specimen verification series if not already present in the database."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id, sample_name FROM projects WHERE sample_name LIKE '[검증시리즈]%'"
        ).fetchall()
        if len(existing) == 9 and not force_reseed:
            return {
                "seeded": False,
                "message": "기존 검증 시리즈 시편들이 이미 준비되어 있습니다.",
                "project_ids": [r["id"] for r in existing],
            }
        if existing:
            for r in existing:
                conn.execute("DELETE FROM projects WHERE id = ?", (r["id"],))

    rng = np.random.default_rng(2026)

    # Helper to generate non-overlapping particle centers
    def _grid_centers(nx: int, ny: int, jitter: int, seed_val: int) -> list[tuple[int, int]]:
        r_local = np.random.default_rng(seed_val)
        pts = []
        xs = np.linspace(55, 585, nx)
        ys = np.linspace(65, 395, ny)
        for x0 in xs:
            for y0 in ys:
                dx = int(r_local.integers(-jitter, jitter + 1))
                dy = int(r_local.integers(-jitter, jitter + 1))
                pts.append((int(x0 + dx), int(y0 + dy)))
        return pts

    default_xp = XRDParams(inst_fwhm_deg=0.08, wavelength_confirmed=True, use_mp_live=False)
    default_sp_500nm = SEMParams(
        mode="particle",
        roi=ROIRect(x=0, y=0, w=640, h=445),
        scale_confirmed=True,
        scale_x0=410,
        scale_y0=480,
        scale_x1=610,
        scale_y1=480,
        scale_length_px=200.0,
        scale_real_value=500.0,
        scale_unit="nm",
        segmentation_confirmed=True,
    )
    default_sp_250nm = SEMParams(
        mode="particle",
        roi=ROIRect(x=0, y=0, w=640, h=445),
        scale_confirmed=True,
        scale_x0=410,
        scale_y0=480,
        scale_x1=610,
        scale_y1=480,
        scale_length_px=200.0,
        scale_real_value=250.0,
        scale_unit="nm",
        segmentation_confirmed=True,
    )
    unscaled_sp = SEMParams(
        mode="particle",
        roi=ROIRect(x=0, y=0, w=640, h=445),
        scale_confirmed=False,
        segmentation_confirmed=False,
    )

    # 1. Specimen A: TiO2 500°C 2h Air (Pure Anatase, 2 distinct SEM FOVs: A1 and A2)
    xrd_a = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.28, 1000.0, 0.42),  # Anatase (101)
            (36.95, 110.0, 0.44),   # Anatase (103)
            (37.80, 240.0, 0.44),   # Anatase (004)
            (38.58, 90.0, 0.45),    # Anatase (112)
            (48.05, 340.0, 0.46),   # Anatase (200)
            (53.89, 210.0, 0.48),   # Anatase (105)
            (55.06, 205.0, 0.48),   # Anatase (211)
            (62.69, 165.0, 0.51),   # Anatase (204)
            (68.76, 85.0, 0.53),    # Anatase (116)
            (70.31, 80.0, 0.54),    # Anatase (220)
            (75.03, 115.0, 0.56),   # Anatase (215)
        ],
        seed=101,
    )
    pts_a1 = _grid_centers(8, 5, 8, 101)
    radii_a1 = [int(r) for r in rng.normal(7.5, 1.2, size=len(pts_a1)).clip(5, 11)]  # ~37 nm diameter
    sem_a1 = _synth_sem_image_bytes("SPEC-A | FOV-A1 (50kX)", radii_a1, pts_a1, True, "500 nm", 200, seed=101)

    pts_a2 = _grid_centers(6, 4, 6, 102)
    radii_a2 = [int(r) for r in rng.normal(14.5, 1.8, size=len(pts_a2)).clip(10, 20)]  # High-mag 100kX (250nm bar -> ~36 nm diameter)
    sem_a2 = _synth_sem_image_bytes("SPEC-A | FOV-A2 (100kX)", radii_a2, pts_a2, True, "250 nm", 200, seed=102)

    proj_a = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2-500C (시편 A: 500°C, 2h, Air)",
        description="동일 모재(TiO2) 무도핑 열처리 시리즈 기준 시편 (500 °C, 2 h, Air 하소). 단일상 Anatase 및 2개의 독립 SEM 촬영 시야(A1 저배율, A2 고배율) 포함.",
        expected_elements=["Ti", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "TiO2",
            "dopant_element": "",
            "dopant_amount": 0.0,
            "dopant_unit": "at%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_500C_2h_Air_xrd.csv", xrd_a, default_xp),
        sem_files_list=[
            (
                "TiO2_500C_FOV_A1_50kX.png",
                sem_a1,
                {"fov_label": "시야 A1 (50,000x 표준 시야)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
            (
                "TiO2_500C_FOV_A2_100kX.png",
                sem_a2,
                {"fov_label": "시야 A2 (100,000x 고배율 시야)", "imaging_mode": "SE", "magnification": "100,000x"},
                default_sp_250nm,
            ),
        ],
    )

    # 2. Specimen B: TiO2 700°C 2h Air (Anatase + Rutile secondary phase emergence, coarsened SEM B1)
    xrd_b = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.28, 860.0, 0.28),   # Anatase (101) narrower FWHM
            (27.45, 340.0, 0.25),   # Rutile (110) - Secondary phase strong peak #1
            (36.08, 165.0, 0.26),   # Rutile (101) - Secondary phase strong peak #2
            (37.80, 195.0, 0.29),   # Anatase (004)
            (41.23, 85.0, 0.27),    # Rutile (111) - Secondary phase peak #3
            (48.05, 280.0, 0.30),   # Anatase (200)
            (53.89, 175.0, 0.31),   # Anatase (105)
            (54.32, 215.0, 0.28),   # Rutile (211) - Secondary phase strong peak #4
            (55.06, 170.0, 0.31),   # Anatase (211)
            (56.63, 72.0, 0.29),    # Rutile (220)
            (62.69, 140.0, 0.33),   # Anatase (204)
            (69.01, 95.0, 0.31),    # Rutile (301)
        ],
        seed=103,
    )
    pts_b1 = _grid_centers(6, 4, 8, 103)
    radii_b1 = [int(r) for r in rng.normal(13.5, 2.0, size=len(pts_b1)).clip(9, 19)]  # ~68 nm diameter coarsened
    sem_b1 = _synth_sem_image_bytes("SPEC-B | FOV-B1 (50kX)", radii_b1, pts_b1, True, "500 nm", 200, seed=103)

    proj_b = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2-700C (시편 B: 700°C, 2h, Air)",
        description="동일 모재(TiO2) 무도핑 열처리 700 °C, 2 h, Air 시편. Anatase 결정립 성장 및 Rutile 이차상 다중 반사 출현, SEM 입자 조대화 관찰.",
        expected_elements=["Ti", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "TiO2",
            "dopant_element": "",
            "dopant_amount": 0.0,
            "dopant_unit": "at%",
            "process_temp_c": 700.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_700C_2h_Air_xrd.csv", xrd_b, default_xp),
        sem_files_list=[
            (
                "TiO2_700C_FOV_B1_50kX.png",
                sem_b1,
                {"fov_label": "시야 B1 (50,000x 조대화 시야)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
        ],
    )

    # 3. Specimen C: TiO2 850°C 4h Air (Confounded temp+time, restricted 2theta 20..58 deg, uncalibrated SEM)
    xrd_c = _synth_xrd_csv_bytes(
        20.0,
        58.0,  # Restricted range! Peaks > 58 deg are out_of_range!
        0.03,
        [
            (25.28, 120.0, 0.24),   # Trace residual Anatase (101)
            (27.45, 1150.0, 0.21),  # Rutile (110) dominant
            (31.65, 95.0, 0.23),    # Unassigned trace peak!
            (36.08, 520.0, 0.22),   # Rutile (101)
            (39.19, 90.0, 0.22),    # Rutile (200)
            (41.23, 260.0, 0.23),   # Rutile (111)
            (44.05, 105.0, 0.23),   # Rutile (210)
            (54.32, 640.0, 0.30),   # Rutile (211)
            (54.68, 380.0, 0.30),   # Overlapping shoulder peak (sep 0.36 deg < 2.2 * 0.30 deg)!
            (56.63, 210.0, 0.24),   # Rutile (220)
        ],
        seed=104,
    )
    pts_c1 = _grid_centers(5, 3, 10, 104)
    radii_c1 = [int(r) for r in rng.normal(22.0, 3.0, size=len(pts_c1)).clip(16, 28)]
    sem_c1 = _synth_sem_image_bytes("SPEC-C | FOV-C1 (NO SCALE)", radii_c1, pts_c1, False, "", 200, seed=104)

    proj_c = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2-850C-4h (시편 C: 850°C, 4h, Air — 복합변수/제한범위)",
        description="열처리 온도(850 °C)와 유지 시간(4 h)이 동시에 변경된 시편. 측정 각도 범위가 20°~58°로 제한되어 고각 반사는 범위 밖이며, SEM은 스케일 미보정 상태임.",
        expected_elements=["Ti", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "TiO2",
            "dopant_element": "",
            "dopant_amount": 0.0,
            "dopant_unit": "at%",
            "process_temp_c": 850.0,
            "process_time_h": 4.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_850C_4h_20to58deg_xrd.csv", xrd_c, default_xp),
        sem_files_list=[
            (
                "TiO2_850C_FOV_C1_Unscaled.png",
                sem_c1,
                {"fov_label": "시야 C1 (스케일바 미지정 영상)", "imaging_mode": "SE", "magnification": "배율 미기재"},
                unscaled_sp,
            ),
        ],
    )

    # 4. Dopant Series: D1 (Nb 2 at%), D2 (Nb 5 at%), D3 (Nb 5 wt% unit mismatch), D4 (Fe 2 at% different dopant)
    # All at 500°C, 2h, Air so Specimen A (TiO2-500C, 0 at%) serves as the exact Undoped Control!
    xrd_d1 = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.16, 950.0, 0.46),   # Shifted -0.12 deg due to Nb5+ doping
            (37.65, 225.0, 0.48),
            (47.88, 320.0, 0.50),
            (53.70, 195.0, 0.52),
            (54.88, 190.0, 0.52),
            (62.48, 150.0, 0.55),
        ],
        seed=201,
    )
    pts_d1 = _grid_centers(8, 5, 7, 201)
    radii_d1 = [int(r) for r in rng.normal(7.0, 1.1, size=len(pts_d1)).clip(5, 10)]
    sem_d1 = _synth_sem_image_bytes("SPEC-D1 | Nb 2at% (50kX)", radii_d1, pts_d1, True, "500 nm", 200, seed=201)

    proj_d1 = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2:Nb-2at% (시편 D1: Nb 2 at% #1, 500°C, 2h)",
        description="TiO2 모재에 Nb 2 at% 도핑 후 500 °C, 2 h, Air 열처리한 시편 (반복시편 Rep-1). 격자 팽창에 따른 Anatase 주피크 저각 이동(Δ2θ ≈ -0.12°) 관찰.",
        expected_elements=["Ti", "Nb", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "Ti0.98Nb0.02O2",
            "dopant_element": "Nb",
            "dopant_amount": 2.0,
            "dopant_unit": "at%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_Nb_2atpct_Rep1_500C_xrd.csv", xrd_d1, default_xp),
        sem_files_list=[
            (
                "TiO2_Nb_2atpct_Rep1_FOV_D1.png",
                sem_d1,
                {"fov_label": "시야 D1-Rep1 (Nb 2 at% #1 SE)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
        ],
    )

    xrd_d1_r2 = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.18, 940.0, 0.45),   # Replicate #2 at 2 at% Nb (slight experimental scatter vs 25.16)
            (37.67, 220.0, 0.47),
            (47.90, 315.0, 0.49),
            (53.72, 190.0, 0.51),
            (54.90, 188.0, 0.51),
            (62.50, 148.0, 0.54),
        ],
        seed=205,
    )
    pts_d1_r2 = _grid_centers(8, 5, 7, 205)
    radii_d1_r2 = [int(r) for r in rng.normal(7.2, 1.1, size=len(pts_d1_r2)).clip(5, 10)]
    sem_d1_r2 = _synth_sem_image_bytes("SPEC-D1-R2 | Nb 2at% #2", radii_d1_r2, pts_d1_r2, True, "500 nm", 200, seed=205)

    proj_d1_r2 = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2:Nb-2at%-Rep2 (시편 D1-R2: Nb 2 at% #2 반복시편, 500°C, 2h)",
        description="TiO2 모재에 Nb 2 at% 도핑 후 동일 공정(500 °C, 2 h, Air)으로 제조한 반복 시편(Rep-2). 함량별 추세 분석 시 반복 시편 간 편차(재현성) 산출용.",
        expected_elements=["Ti", "Nb", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "Ti0.98Nb0.02O2",
            "dopant_element": "Nb",
            "dopant_amount": 2.0,
            "dopant_unit": "at%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-2",
        },
        xrd_file_tuple=("TiO2_Nb_2atpct_Rep2_500C_xrd.csv", xrd_d1_r2, default_xp),
        sem_files_list=[
            (
                "TiO2_Nb_2atpct_Rep2_FOV_D1R2.png",
                sem_d1_r2,
                {"fov_label": "시야 D1-Rep2 (Nb 2 at% #2 SE)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
        ],
    )

    xrd_d2 = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.03, 880.0, 0.54),   # Shifted -0.25 deg, broader FWHM (finer crystallite / strain)
            (29.12, 68.0, 0.35),    # Single weak unassigned peak!
            (37.50, 200.0, 0.56),
            (47.70, 290.0, 0.58),
            (53.52, 175.0, 0.60),
            (54.68, 170.0, 0.60),
            (62.28, 135.0, 0.63),
        ],
        seed=202,
    )
    pts_d2 = _grid_centers(9, 5, 6, 202)
    radii_d2 = [int(r) for r in rng.normal(6.2, 1.0, size=len(pts_d2)).clip(4, 9)]  # Solute drag suppresses grain growth
    sem_d2 = _synth_sem_image_bytes("SPEC-D2 | Nb 5at% (50kX)", radii_d2, pts_d2, True, "500 nm", 200, seed=202)

    proj_d2 = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2:Nb-5at% (시편 D2: Nb 5 at%, 500°C, 2h)",
        description="TiO2 모재에 Nb 5 at% 도핑 후 500 °C, 2 h, Air 열처리한 시편. 저각 이동(Δ2θ ≈ -0.25°), 선폭 증가 및 29.12° 단일 약피크(이차상 미확정) 관찰.",
        expected_elements=["Ti", "Nb", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "Ti0.95Nb0.05O2",
            "dopant_element": "Nb",
            "dopant_amount": 5.0,
            "dopant_unit": "at%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_Nb_5atpct_500C_xrd.csv", xrd_d2, default_xp),
        sem_files_list=[
            (
                "TiO2_Nb_5atpct_FOV_D2.png",
                sem_d2,
                {"fov_label": "시야 D2 (Nb 5 at% SE)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
        ],
    )

    # D3: Nb 5 wt% (Unit mismatch: wt% vs at%)
    proj_d3 = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2:Nb-5wt% (시편 D3: Nb 5 wt% — 단위 불일치)",
        description="TiO2 모재에 Nb 5 wt%(질량분율) 첨가 시편. at% 기준 시편들과 분모·단위가 달라 환산 근거 없이 동일 함량 축에 배치하지 않는 검증 사례.",
        expected_elements=["Ti", "Nb", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "TiO2:Nb (5 wt%)",
            "dopant_element": "Nb",
            "dopant_amount": 5.0,
            "dopant_unit": "wt%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_Nb_5wtpct_500C_xrd.csv", xrd_d1, default_xp),
        sem_files_list=[],  # Also tests XRD-only specimen without SEM image!
    )

    # D4: Fe 2 at% (Different dopant element at same 500°C, 2h, Air for Question 2: Dopant Type comparison)
    xrd_d4 = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (25.35, 890.0, 0.39),   # Slight high-angle shift +0.07 deg (Fe3+ smaller radius)
            (27.46, 150.0, 0.30),   # Fe doping promotes early Rutile (110)
            (36.09, 75.0, 0.31),    # Rutile (101)
            (37.86, 210.0, 0.40),
            (48.12, 310.0, 0.41),
            (54.33, 95.0, 0.32),    # Rutile (211)
            (55.12, 185.0, 0.42),
        ],
        seed=204,
    )
    pts_d4 = _grid_centers(7, 4, 8, 204)
    radii_d4 = [int(r) for r in rng.normal(9.5, 1.4, size=len(pts_d4)).clip(6, 14)]
    sem_d4 = _synth_sem_image_bytes("SPEC-D4 | Fe 2at% (50kX)", radii_d4, pts_d4, True, "500 nm", 200, seed=204)

    proj_d4 = _create_seeded_project_with_run(
        sample_name="[검증시리즈] TiO2:Fe-2at% (시편 D4: Fe 2 at%, 500°C, 2h)",
        description="TiO2 모재에 Fe 2 at% 도핑 후 500 °C, 2 h, Air 열처리한 시편. Nb 도핑과 달리 고각 이동 및 저온 Rutile 전이 촉진 현상 비교용.",
        expected_elements=["Ti", "Fe", "O"],
        expected_formula="TiO2",
        experiment_meta={
            "base_matrix": "TiO2",
            "nominal_composition": "Ti0.98Fe0.02O2",
            "dopant_element": "Fe",
            "dopant_amount": 2.0,
            "dopant_unit": "at%",
            "process_temp_c": 500.0,
            "process_time_h": 2.0,
            "atmosphere": "Air",
            "process_method": "하소(Calcination)",
            "replicate_id": "Rep-1",
        },
        xrd_file_tuple=("TiO2_Fe_2atpct_500C_xrd.csv", xrd_d4, default_xp),
        sem_files_list=[
            (
                "TiO2_Fe_2atpct_FOV_D4.png",
                sem_d4,
                {"fov_label": "시야 D4 (Fe 2 at% SE)", "imaging_mode": "SE", "magnification": "50,000x"},
                default_sp_500nm,
            ),
        ],
    )

    # 5. Unrelated Material Specimen U: Si SRM640 (Must be excluded when comparing TiO2 series!)
    xrd_u = _synth_xrd_csv_bytes(
        20.0,
        80.0,
        0.03,
        [
            (28.44, 1200.0, 0.14),  # Si (111)
            (47.30, 680.0, 0.15),   # Si (220)
            (56.12, 390.0, 0.16),   # Si (311)
            (69.13, 120.0, 0.17),   # Si (400)
            (76.38, 190.0, 0.18),   # Si (331)
        ],
        seed=301,
    )
    proj_u = _create_seeded_project_with_run(
        sample_name="[검증시리즈] Si-SRM640 (무관 재료 시편 U: 단결정 규소 표준분말)",
        description="무관한 모재(Si)가 같은 워크스페이스에 있을 때 TiO2 비교군에서 자동 제외되는지 검증하기 위한 표준 시편.",
        expected_elements=["Si"],
        expected_formula="Si",
        experiment_meta={
            "base_matrix": "Si",
            "nominal_composition": "Si",
            "dopant_element": "",
            "dopant_amount": 0.0,
            "dopant_unit": "at%",
            "process_temp_c": 25.0,
            "process_time_h": 0.0,
            "atmosphere": "Air",
            "process_method": "Standard Reference",
            "replicate_id": "SRM-640",
        },
        xrd_file_tuple=("Si_SRM640_standard_xrd.csv", xrd_u, default_xp),
        sem_files_list=[],
    )

    created_ids = [
        proj_a["project_id"],
        proj_b["project_id"],
        proj_c["project_id"],
        proj_d1["project_id"],
        proj_d1_r2["project_id"],
        proj_d2["project_id"],
        proj_d3["project_id"],
        proj_d4["project_id"],
        proj_u["project_id"],
    ]
    return {
        "seeded": True,
        "message": "검증용 다종 시편 시리즈(열처리 시리즈 A/B/C, 도핑 시리즈 D1/D2/D3/D4, 무관 재료 U)가 생성되었습니다.",
        "project_ids": created_ids,
    }


def generate_comparison_stacked_xrd_png(
    comp_data: dict[str, Any],
    dpi: int = 300,
) -> bytes:
    """Render a publication-grade (300 DPI) stacked XRD comparison chart with:
    - Common 2theta axis
    - Vertically offset curves in the exact slot order
    - Distinct markers for each phase (● Primary, ◆ Secondary candidate, ? Unassigned)
    - (hkl) labels only on reference-verified reflections
    """
    _configure_matplotlib_korean()
    traces = comp_data.get("stacked_traces") or []
    norm_info = comp_data.get("normalization_info") or {}

    fig, ax = plt.subplots(figsize=(9.2, max(4.2, 1.35 * len(traces) + 1.8)), dpi=dpi)

    if not traces:
        ax.text(0.5, 0.5, "표시할 XRD 비교 데이터가 없습니다.", ha="center", va="center", fontsize=12)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        plt.close(fig)
        return buf.getvalue()

    phase_marker_map = {
        "circle": ("o", "주상 (Primary)"),
        "diamond": ("D", "이차상 후보 (다중반사 지지)"),
        "triangle-up": ("^", "단일 약피크 (확정 보류)"),
        "x": ("x", "미할당 피크 (Unassigned)"),
    }
    plotted_phase_Wait_labels: set[str] = set()

    for tr in traces:
        tt = np.asarray(tr["two_theta"], dtype=float)
        yy = np.asarray(tr["stacked_intensity"], dtype=float)
        col = tr.get("color", "#1D4ED8")
        lbl = tr.get("legend_label", tr["sample_name"])

        ax.plot(tt, yy, color=col, lw=1.45, label=lbl, zorder=3)

        # Annotate peaks with phase markers and verified (hkl)
        pks = tr.get("peaks") or []
        # Sort by intensity descending to label top reflections cleanly without clutter
        pks_sorted = sorted(pks, key=lambda p: p.get("rel_intensity_pct", 0.0), reverse=True)
        labeled_positions: list[float] = []

        for pk in pks_sorted:
            px = float(pk["two_theta"])
            py = float(pk["y_on_stacked_curve"])
            msym_key = pk.get("marker_symbol", "circle")
            mpl_marker, phase_cat_lbl = phase_marker_map.get(msym_key, ("o", "피크"))

            m_color = "#1E40AF" if msym_key == "circle" else ("#DC2626" if msym_key == "diamond" else ("#D97706" if msym_key == "triangle-up" else "#64748B"))
            legend_entry = f"마커: {phase_cat_lbl}" if phase_cat_lbl not in plotted_phase_Wait_labels else "_nolegend_"
            plotted_phase_Wait_labels.add(phase_cat_lbl)

            ax.scatter([px], [py + 4.0], marker=mpl_marker, s=34, color=m_color, zorder=5, label=legend_entry)

            hkl = pk.get("assigned_hkl")
            phase_short = pk.get("assigned_phase") or ""
            # Only attach (hkl) to reference-matched reflections, avoiding horizontal collision
            if hkl and all(abs(px - prev_x) > 1.8 for prev_x in labeled_positions[:8]):
                labeled_positions.append(px)
                tag_txt = f"{pk.get('marker_label', '●')} {hkl}"
                ax.annotate(
                    tag_txt,
                    xy=(px, py + 5.5),
                    xytext=(px, py + 14.0),
                    ha="center",
                    va="bottom",
                    fontsize=7.5,
                    fontweight="bold",
                    color=m_color,
                    arrowprops=dict(arrowstyle="-", color=m_color, lw=0.6, alpha=0.6),
                )

    q_title = (comp_data.get("question") or {}).get("question", "다종 시편 XRD 비교")
    ax.set_title(f"{q_title}\nStacked XRD Diffractograms (세로 오프셋 적층 비교)", fontsize=11, fontweight="bold", pad=10)
    ax.set_xlabel("회절각 2-Theta (deg)", fontsize=10, fontweight="bold")
    ax.set_ylabel(
        f"Intensity ({norm_info.get('mode_label', 'Normalized + Offset')})",
        fontsize=9.5,
        fontweight="bold",
    )
    ax.grid(True, linestyle=":", alpha=0.55, color="#CBD5E1")
    ax.legend(loc="upper right", fontsize=8, framealpha=0.92)

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def generate_comparison_peaks_csv(comp_data: dict[str, Any]) -> bytes:
    """Export synchronized CSV containing all detected peaks and cross-specimen reflection evolution
    in the exact selected specimen order.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow(["# MatLens Multi-Specimen Comparison XRD Peaks & Phase Attribution Export"])
    writer.writerow(["# Experimental Question", (comp_data.get("question") or {}).get("question", "")])
    writer.writerow(["# Normalization", (comp_data.get("normalization_info") or {}).get("mode_label", "")])
    writer.writerow([])

    writer.writerow(
        [
            "slot_order",
            "project_id",
            "sample_name",
            "peak_id",
            "measured_two_theta_deg",
            "reference_two_theta_deg",
            "delta_ref_deg",
            "d_spacing_A",
            "rel_intensity_pct",
            "integrated_area",
            "fwhm_deg",
            "snr",
            "is_overlapping",
            "fit_quality_badge",
            "assigned_phase",
            "assigned_hkl",
            "phase_role",
            "reference_source",
            "reference_id",
        ]
    )

    for pk in comp_data.get("all_peaks_table") or []:
        writer.writerow(
            [
                pk.get("slot_index"),
                pk.get("project_id"),
                pk.get("sample_name"),
                pk.get("peak_id"),
                pk.get("two_theta"),
                pk.get("ref_two_theta") if pk.get("ref_two_theta") is not None else "",
                pk.get("delta_ref_deg") if pk.get("delta_ref_deg") is not None else "",
                pk.get("d_spacing_A") if pk.get("d_spacing_A") is not None else "",
                pk.get("rel_intensity_pct"),
                pk.get("area") if pk.get("area") is not None else "",
                pk.get("fwhm_deg") if pk.get("fwhm_deg") is not None else "",
                pk.get("snr"),
                pk.get("is_overlapping"),
                pk.get("fit_quality_badge"),
                pk.get("assigned_phase"),
                pk.get("assigned_hkl") or "",
                pk.get("phase_role"),
                pk.get("reference_source"),
                pk.get("reference_id"),
            ]
        )

    return buf.getvalue().encode("utf-8-sig")


def generate_comparison_pdf_report(
    comp_data: dict[str, Any],
    report_title: str | None = None,
) -> bytes:
    """Generate the Korean PDF Unified Comparison Report in the strict 5-stage scientific structure:
    1. 비교 질문과 통제·변경·교란 조건 (Experimental Question & Controlled/Changed/Confounded Conditions)
    2. 시편별 측정자료 매핑 (Specimen -> XRD Run/File -> Representative SEM FOV/File Inventory)
    3. XRD 중첩 그래프와 피크·이차상·반사 이동 표 (Stacked XRD Figure + Peak/Secondary Phase/Evolution Tables)
    4. 같은 순서의 SEM 병렬 이미지 (Parallel Original SEM Images in the Exact Slot Order, with Explicit Status if Missing)
    5. 두 측정을 근거로 한 4단계 교차 해석 (XRD Clue -> SEM Target -> Actual Observation -> Limitations)
    """
    font_reg, font_bold, _ = _register_korean_font()
    buf = io.BytesIO()

    q_obj = comp_data.get("question") or {}
    title_str = report_title or f"MatLens 비교 분석 통합 리포트 — {q_obj.get('question', '')}"

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=title_str,
        author="MatLens Scientific Comparison Engine",
    )

    styles = getSampleStyleSheet()
    st_title = ParagraphStyle("CompTitle", parent=styles["Title"], fontName=font_bold, fontSize=15, leading=21, textColor=colors.HexColor("#0F172A"), alignment=0, spaceAfter=4)
    st_sub = ParagraphStyle("CompSub", parent=styles["Normal"], fontName=font_reg, fontSize=9, leading=13.5, textColor=colors.HexColor("#475569"), spaceAfter=6)
    st_h1 = ParagraphStyle("CompH1", parent=styles["Heading2"], fontName=font_bold, fontSize=11.5, leading=16, textColor=colors.HexColor("#1E3A8A"), spaceBefore=10, spaceAfter=5)
    st_h2 = ParagraphStyle("CompH2", parent=styles["Heading3"], fontName=font_bold, fontSize=10, leading=14, textColor=colors.HexColor("#1E293B"), spaceBefore=6, spaceAfter=3)
    st_body = ParagraphStyle("CompBody", parent=styles["Normal"], fontName=font_reg, fontSize=8.5, leading=13.5, textColor=colors.HexColor("#1E293B"), spaceAfter=3)
    st_small = ParagraphStyle("CompSmall", parent=styles["Normal"], fontName=font_reg, fontSize=7.8, leading=11.5, textColor=colors.HexColor("#475569"))
    st_warn = ParagraphStyle("CompWarn", parent=st_body, textColor=colors.HexColor("#92400E"), backColor=colors.HexColor("#FEF3C7"), borderPadding=5, spaceAfter=4)
    st_fact = ParagraphStyle("CompFact", parent=st_body, textColor=colors.HexColor("#065F46"), backColor=colors.HexColor("#ECFDF5"), borderPadding=5, spaceAfter=4)

    story: list[Any] = []

    # Header
    story.append(Paragraph(escape(title_str), st_title))
    story.append(
        Paragraph(
            f"<b>실험 질문:</b> {escape(q_obj.get('question', '-'))}<br/>"
            f"<b>비교군 구성 기준:</b> {escape(q_obj.get('criteria_summary', '-'))}",
            st_sub,
        )
    )
    story.append(HRFlowable(width="100%", thickness=1.0, color=colors.HexColor("#2563EB"), spaceAfter=6))

    slots = comp_data.get("slots") or []

    # Section 1: 비교 질문과 통제 조건
    story.append(Paragraph("1. 비교 질문과 시편별 통제·변경·확인 필요 조건", st_h1))
    cond_rows = [
        [
            Paragraph("<b>순서 / 시편명</b>", st_body),
            Paragraph("<b>구분 (실측/예시)</b>", st_body),
            Paragraph("<b>같은 조건 (통제 변수)</b>", st_body),
            Paragraph("<b>바뀐 조건 (실험 변수)</b>", st_body),
            Paragraph("<b>교란 경고 / 확인 필요 조건</b>", st_body),
        ]
    ]
    for sl in slots:
        cc = sl.get("condition_comparison") or {}
        kind_str = "합성 검증 시편" if sl.get("is_synthetic_demo") else "실제 업로드 시편"
        same_s = "<br/>".join(escape(x) for x in (cc.get("same_conditions") or ["-"]))
        chg_s = "<br/>".join(escape(x) for x in (cc.get("changed_conditions") or ["-"]))
        warn_items = (cc.get("confounded_warnings") or []) + (cc.get("needs_check_conditions") or [])
        warn_s = "<br/>".join(escape(x) for x in warn_items) if warn_items else "단일 변수 통제 양호"
        cond_rows.append(
            [
                Paragraph(f"<b>[{sl['slot_index']}] {escape(sl['sample_name'])}</b>", st_small),
                Paragraph(kind_str, st_small),
                Paragraph(same_s, st_small),
                Paragraph(chg_s, st_small),
                Paragraph(warn_s, st_small),
            ]
        )
    t_cond = Table(cond_rows, colWidths=[36 * mm, 22 * mm, 40 * mm, 40 * mm, 44 * mm])
    t_cond.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t_cond)
    story.append(Spacer(1, 3 * mm))

    # Section 2: 시편별 측정자료 매핑 (Specimen -> XRD -> SEM FOV)
    story.append(Paragraph("2. 시편별 선택된 측정자료 식별표 (XRD 측정 & SEM 대표 시야 매핑)", st_h1))
    map_rows = [
        [
            Paragraph("<b>순서 / 시편 ID</b>", st_body),
            Paragraph("<b>선택된 XRD 파일 (파장 / 범위)</b>", st_body),
            Paragraph("<b>선택된 대표 SEM 시야 / 원본 파일명</b>", st_body),
            Paragraph("<b>SEM 스케일 상태 / SHA-256</b>", st_body),
        ]
    ]
    for sl in slots:
        xrd_i = sl.get("selected_xrd")
        sem_i = sl.get("selected_sem") or {}
        if xrd_i:
            xrd_txt = (
                f"{escape(str(xrd_i.get('original_filename')))} (Run #{xrd_i.get('run_number')})<br/>"
                f"λ={xrd_i.get('wavelength_A')} Å, {xrd_i.get('two_theta_min'):.1f}°~{xrd_i.get('two_theta_max'):.1f}°"
            )
        else:
            xrd_txt = "XRD 측정 없음"

        if sem_i.get("has_image"):
            sem_txt = (
                f"<b>{escape(str(sem_i.get('fov_label')))}</b><br/>"
                f"파일: {escape(str(sem_i.get('original_filename')))} ({sem_i.get('imaging_mode')}, {escape(str(sem_i.get('magnification')))})"
            )
            sc_txt = f"{escape(str(sem_i.get('scale_summary')))}<br/>SHA: {(sem_i.get('sha256') or '')[:12]}"
        else:
            sem_txt = "업로드된 SEM 이미지 없음"
            sc_txt = "해당 시편 SEM 미보유 (대체 이미지 미사용)"

        map_rows.append(
            [
                Paragraph(f"[{sl['slot_index']}] {escape(sl['sample_name'])}<br/>ID: {escape(sl['project_id'])}", st_small),
                Paragraph(xrd_txt, st_small),
                Paragraph(sem_txt, st_small),
                Paragraph(sc_txt, st_small),
            ]
        )
    t_map = Table(map_rows, colWidths=[42 * mm, 46 * mm, 48 * mm, 46 * mm])
    t_map.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t_map)
    story.append(Spacer(1, 3 * mm))

    # Section 3: XRD 중첩 그래프와 피크·상 표
    story.append(Paragraph("3. XRD 세로 오프셋 중첩 그래프 및 반사별 변화·이차상 검증 표", st_h1))
    try:
        xrd_png_bytes = generate_comparison_stacked_xrd_png(comp_data, dpi=220)
        story.append(RLImage(io.BytesIO(xrd_png_bytes), width=178 * mm, height=82 * mm))
    except Exception as exc:
        story.append(Paragraph(f"XRD 그래프 렌더링 오류: {escape(str(exc))}", st_warn))

    norm_info = comp_data.get("normalization_info") or {}
    story.append(Paragraph(escape(norm_info.get("mass_fraction_warning", "")), st_warn))

    # Reflection Evolution Table
    evo = comp_data.get("reflection_evolution") or []
    if evo and slots:
        story.append(Paragraph("3.1 대응 반사별 시편 간 위치 이동(Δ2θ)·선폭(FWHM)·출현 여부 비교", st_h2))
        header_row = [Paragraph("<b>기준 반사 / 상 (hkl)</b>", st_small)]
        for sl in slots:
            header_row.append(Paragraph(f"<b>[{sl['slot_index']}] {escape(sl['sample_name'][:18])}</b>", st_small))
        evo_rows = [header_row]
        col_w = [38 * mm] + [int(144 / max(len(slots), 1)) * mm for _ in slots]

        for row in evo[:14]:
            hkl_lbl = f"{row.get('marker_label', '●')} {row.get('phase') or '미할당'} {row.get('hkl') or ''}<br/>(~{row['anchor_two_theta']:.2f}°)"
            r_cells = [Paragraph(hkl_lbl, st_small)]
            for ps in row.get("per_specimen") or []:
                st_code = ps.get("status")
                if st_code == "detected":
                    cell_txt = (
                        f"<b>{ps['two_theta']:.2f}°</b> (Δ={ps['delta_vs_baseline_deg']:+.2f}°)<br/>"
                        f"FWHM: {ps.get('fwhm_deg') or '-'}° | I: {ps.get('rel_intensity_pct')}%"
                    )
                else:
                    cell_txt = f"<i>{escape(str(ps.get('status_label')))}</i>"
                r_cells.append(Paragraph(cell_txt, st_small))
            evo_rows.append(r_cells)

        t_evo = Table(evo_rows, colWidths=col_w)
        t_evo.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("PADDING", (0, 0), (-1, -1), 3.5),
                ]
            )
        )
        story.append(t_evo)
        story.append(Spacer(1, 3 * mm))

    # Section 4: 같은 순서의 SEM 병렬 이미지
    story.append(Paragraph("4. 시편 정렬 순서와 동기화된 SEM 병렬 원본 이미지 및 메타데이터", st_h1))
    sem_cells_row: list[Any] = []
    for sl in slots:
        sem_i = sl.get("selected_sem") or {}
        cell_elems: list[Any] = [
            Paragraph(f"<b>[{sl['slot_index']}] {escape(sl['sample_name'])}</b>", st_small),
        ]
        if sem_i.get("has_image") and sem_i.get("file_id"):
            # Load exact raw file bytes from disk for this project_id and file_id!
            pid = sl["project_id"]
            fid = sem_i["file_id"]
            raw_bytes_loaded = None
            with get_conn() as conn:
                frow = conn.execute(
                    "SELECT stored_relpath FROM project_files WHERE id = ? AND project_id = ?",
                    (fid, pid),
                ).fetchone()
            if frow:
                fpath = PROJECTS_STORAGE_DIR / pid / frow["stored_relpath"]
                if fpath.exists():
                    raw_bytes_loaded = fpath.read_bytes()

            if raw_bytes_loaded:
                img_w = min(82, int(172 / max(len(slots), 1))) * mm
                img_h = img_w * 0.78
                cell_elems.append(RLImage(io.BytesIO(raw_bytes_loaded), width=img_w, height=img_h))
                cell_elems.append(
                    Paragraph(
                        f"<b>시야:</b> {escape(str(sem_i.get('fov_label')))}<br/>"
                        f"<b>원본파일:</b> {escape(str(sem_i.get('original_filename')))}<br/>"
                        f"<b>모드/배율:</b> {escape(str(sem_i.get('imaging_mode')))} / {escape(str(sem_i.get('magnification')))}<br/>"
                        f"<b>스케일:</b> {escape(str(sem_i.get('scale_summary')))}",
                        st_small,
                    )
                )
            else:
                cell_elems.append(Paragraph("원본 이미지 파일을 디스크에서 찾을 수 없음 (대체 이미지 미사용)", st_warn))
        else:
            cell_elems.append(
                Paragraph(
                    f"<b>[SEM 이미지 없음]</b><br/>{escape(str(sem_i.get('status_message', 'SEM 미업로드 시편')))}",
                    st_warn,
                )
            )
        sem_cells_row.append(cell_elems)

    if sem_cells_row:
        col_w_sem = [int(180 / len(sem_cells_row)) * mm for _ in sem_cells_row]
        t_sem_par = Table([sem_cells_row], colWidths=col_w_sem)
        t_sem_par.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("PADDING", (0, 0), (-1, -1), 4),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ]
            )
        )
        story.append(t_sem_par)
        story.append(Spacer(1, 3 * mm))

    # Section 5: 두 측정을 근거로 한 4단계 교차 해석
    story.append(Paragraph("5. XRD 단서 기반 동일 시편 SEM 4단계 교차 해석 (관찰 사실 · 가능한 해석 · 추가 확인 구분)", st_h1))
    for card in comp_data.get("cross_analysis_cards") or []:
        story.append(
            Paragraph(
                f"<b>[{card['slot_index']}] {escape(card['sample_name'])}</b> — {escape(str(card.get('condition_summary') or ''))}",
                st_h2,
            )
        )
        story.append(Paragraph(f"<b>① XRD에서 얻은 단서:</b> {escape(card['step1_xrd_clue'])}", st_body))
        story.append(Paragraph(f"<b>② 같은 시편의 SEM에서 확인할 특징:</b> {escape(card['step2_sem_target'])}", st_body))
        story.append(Paragraph(f"<b>③ 실제 관찰 결과:</b> {escape(card['step3_actual_observation'])}", st_body))
        story.append(Paragraph(f"<b>④ 해석의 한계:</b> {escape(card['step4_limitations'])}", st_small))

        facts_txt = "<br/>".join(escape(f) for f in (card.get("observed_facts") or []))
        interps_txt = "<br/>".join(escape(i) for i in (card.get("possible_interpretations") or []))
        verifs_txt = "<br/>".join(escape(v) for v in (card.get("verification_methods") or []))
        if facts_txt:
            story.append(Paragraph(f"<b>[확보된 관찰 사실]</b><br/>{facts_txt}", st_fact))
        if interps_txt:
            story.append(Paragraph(f"<b>[가능한 해석 (가설)]</b><br/>{interps_txt}", st_body))
        if verifs_txt:
            story.append(Paragraph(f"<b>[권장 추가 확인 방법]</b><br/>{verifs_txt}", st_warn))
        story.append(Spacer(1, 2 * mm))

    doc.build(story)
    return buf.getvalue()
