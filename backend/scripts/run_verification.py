"""Execute quantitative verification benchmarks and save exact measured outputs to docs/verification_metrics.json."""
from __future__ import annotations

import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import SAMPLES_DIR  # noqa: E402
from app.engine.ref_library import load_reference_library, parse_user_cif  # noqa: E402
from app.engine.sem_engine import run_sem_pipeline  # noqa: E402
from app.engine.xrd_engine import run_xrd_pipeline  # noqa: E402
from app.schemas import SEMParams, XRDParams  # noqa: E402


def main() -> None:
    # Fetch official public-domain CIFs from Crystallography Open Database if reachable
    cod_files = [
        ("cod_9009086_anatase.cif", "https://www.crystallography.net/cod/9009086.cif"),
        ("cod_9004141_rutile.cif", "https://www.crystallography.net/cod/9004141.cif"),
    ]
    downloaded_cod: list[str] = []
    for fname, url in cod_files:
        dest = SAMPLES_DIR / fname
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                raw = resp.read()
                if len(raw) > 500:
                    dest.write_bytes(raw)
                    downloaded_cod.append(fname)
        except Exception:
            pass

    ref_entries = load_reference_library()["entries"]
    gt = json.loads((SAMPLES_DIR / "ground_truth.json").read_text(encoding="utf-8"))

    # 1. NIST SRM 640f Silicon benchmark
    si_raw = (SAMPLES_DIR / "sample_silicon_srm640_xrd.csv").read_bytes()
    si_res = run_xrd_pipeline(si_raw, XRDParams(inst_fwhm_deg=0.06), ref_entries, ["Si"])
    si_peak_comparisons = []
    for tp in gt["sample_silicon_srm640_xrd"]["true_peaks"]:
        nearest = min(si_res["peaks"], key=lambda p: abs(p["two_theta"] - tp["two_theta"]))
        si_peak_comparisons.append(
            {
                "hkl": tp["hkl"],
                "true_2theta": tp["two_theta"],
                "meas_2theta": nearest["two_theta"],
                "abs_err_2theta": round(abs(nearest["two_theta"] - tp["two_theta"]), 4),
                "true_fwhm": tp["fwhm_deg"],
                "meas_fwhm": nearest["fwhm_deg"],
                "abs_err_fwhm": round(abs(nearest["fwhm_deg"] - tp["fwhm_deg"]), 4),
            }
        )

    # 2. TiO2 Multiphase XRD benchmark
    tio2_xrd_raw = (SAMPLES_DIR / "sample_anatase_rutile_xrd.csv").read_bytes()
    tio2_xrd_corr = run_xrd_pipeline(tio2_xrd_raw, XRDParams(inst_fwhm_deg=0.08), ref_entries, ["Ti", "O"])
    tio2_xrd_uncorr = run_xrd_pipeline(tio2_xrd_raw, XRDParams(inst_fwhm_deg=None), ref_entries, ["Ti", "O"])

    # 3. Official COD CIF live parsing & matching test
    cod_cif_result = None
    cod_ana_path = SAMPLES_DIR / "cod_9009086_anatase.cif"
    if cod_ana_path.exists():
        cod_entry = parse_user_cif(cod_ana_path.read_bytes(), cod_ana_path.name, ref_index=1)
        cod_match = run_xrd_pipeline(tio2_xrd_raw, XRDParams(inst_fwhm_deg=0.08), [cod_entry], ["Ti", "O"])
        cod_cif_result = {
            "cif_file": cod_ana_path.name,
            "parsed_formula": cod_entry["formula"],
            "parsed_spacegroup": cod_entry["spacegroup"],
            "top_match_score": cod_match["phase_matching"]["candidates"][0]["score"],
        }

    # 4. TiO2 Nanoparticle SEM benchmark
    sem_part_raw = (SAMPLES_DIR / "sample_tio2_particles_sem.png").read_bytes()
    sem_part_res, _, _ = run_sem_pipeline(
        sem_part_raw,
        SEMParams(
            mode="particle",
            scale_confirmed=True,
            scale_length_px=200.0,
            scale_real_value=500.0,
            scale_unit="nm",
            segmentation_confirmed=True,
        ),
    )

    # 5. Exact uniform synthetic circle benchmark (6 circles, r = 25 px => D_true = 100.0 nm at 2 nm/px)
    im = Image.new("L", (600, 500), 20)
    dr = ImageDraw.Draw(im)
    for cx, cy in [(120, 120), (280, 120), (440, 120), (120, 300), (280, 300), (440, 300)]:
        dr.ellipse([cx - 25, cy - 25, cx + 25, cy + 25], fill=220)
    bio = io.BytesIO()
    im.save(bio, format="PNG")
    unif_sem_res, _, _ = run_sem_pipeline(
        bio.getvalue(),
        SEMParams(scale_confirmed=True, scale_length_px=100.0, scale_real_value=200.0, scale_unit="nm", segmentation_confirmed=True),
    )

    # 6. Sintered Grain Linear Intercept benchmark
    sem_grain_raw = (SAMPLES_DIR / "sample_sintered_grains_sem.png").read_bytes()
    sem_grain_res, _, _ = run_sem_pipeline(
        sem_grain_raw,
        SEMParams(
            mode="grain",
            grain_boundary_confirmed=True,
            scale_confirmed=True,
            scale_length_px=200.0,
            scale_real_value=5.0,
            scale_unit="µm",
        ),
    )

    metrics = {
        "downloaded_cod_cifs": downloaded_cod,
        "cod_cif_verification": cod_cif_result,
        "xrd_silicon_srm640": {
            "true_crystallite_nm": 55.0,
            "measured_scherrer_mean_nm": si_res["scherrer"]["mean_nm"],
            "top_candidate": si_res["phase_matching"]["candidates"][0]["name"],
            "match_score": si_res["phase_matching"]["candidates"][0]["score"],
            "peak_comparisons": si_peak_comparisons,
        },
        "xrd_tio2_multiphase": {
            "true_anatase_nm": 24.0,
            "true_anatase_strain": 0.0010,
            "scherrer_corrected_mean_nm": tio2_xrd_corr["scherrer"]["mean_nm"],
            "scherrer_uncorrected_mean_nm": tio2_xrd_uncorr["scherrer"]["mean_nm"],
            "scherrer_uncorrected_badge": tio2_xrd_uncorr["scherrer"]["status_badge"],
            "wh_size_nm": tio2_xrd_corr["williamson_hall"]["crystallite_size_nm"],
            "wh_microstrain": tio2_xrd_corr["williamson_hall"]["microstrain"],
            "wh_r2": tio2_xrd_corr["williamson_hall"]["r2"],
            "single_phase_r_pat": tio2_xrd_corr["phase_matching"]["multiphase_comparison"]["single_phase_baseline"]["residual_r_pat"],
            "two_phase_r_pat": tio2_xrd_corr["phase_matching"]["multiphase_comparison"]["combinations"][0]["residual_r_pat"],
            "two_phase_names": tio2_xrd_corr["phase_matching"]["multiphase_comparison"]["combinations"][0]["phases"],
        },
        "sem_uniform_circles": {
            "true_count": 6,
            "measured_count": unif_sem_res["n_valid_objects"],
            "true_diameter_nm": 100.0,
            "measured_mean_nm": unif_sem_res["summary_stats"]["mean_diameter"],
            "measured_circularity": unif_sem_res["summary_stats"]["median_circularity"],
        },
        "sem_tio2_polydisperse": {
            "true_generated_total": gt["sample_tio2_particles_sem"]["n_particles"],
            "measured_non_border_count": sem_part_res["n_valid_objects"],
            "true_mean_nm": gt["sample_tio2_particles_sem"]["true_mean_diameter_nm"],
            "measured_mean_nm": sem_part_res["summary_stats"]["mean_diameter"],
            "true_d50_nm": gt["sample_tio2_particles_sem"]["true_d10_d50_d90_nm"][1],
            "measured_d50_nm": sem_part_res["summary_stats"]["d50"],
            "measured_area_weighted_d50_nm": sem_part_res["summary_stats"]["area_weighted"]["d50"],
            "measured_median_circularity": sem_part_res["summary_stats"]["median_circularity"],
        },
        "sem_sintered_grains": {
            "effective_intersections": sem_grain_res["grain_intercept"]["effective_intersections"],
            "total_line_length_um": sem_grain_res["grain_intercept"]["total_line_length"],
            "mean_intercept_length_um": sem_grain_res["grain_intercept"]["mean_intercept_length"],
        },
    }

    docs_dir = ROOT_DIR / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    out_file = docs_dir / "verification_metrics.json"
    out_file.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
