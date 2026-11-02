"""Generate reference library, CIF files, and documented synthetic/crystallographic sample datasets with known ground truth."""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import SAMPLES_DIR  # noqa: E402
from app.engine.ref_library import CIF_EXPORT_DIR, build_reference_library, project_pattern_to_wavelength  # noqa: E402


def _pvoigt(x: np.ndarray, x0: float, h: float, w: float, eta: float = 0.35) -> np.ndarray:
    g = h * np.exp(-4.0 * math.log(2.0) * ((x - x0) / w) ** 2)
    l = h / (1.0 + 4.0 * ((x - x0) / w) ** 2)
    return eta * l + (1.0 - eta) * g


def make_samples() -> dict:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    lib = build_reference_library(export_cifs=True)
    by_id = {e["id"]: e for e in lib["entries"]}

    rng = np.random.default_rng(42)
    lam = 1.5406
    k_scherrer = 0.90
    inst_deg = 0.08

    # 1. Multiphase TiO2 Powder XRD (Anatase D=24 nm, strain=0.0010 + Rutile D=38 nm)
    x = np.round(np.arange(15.0, 78.001, 0.02), 4)
    y_clean = np.zeros_like(x)

    ana = by_id["REF-TIO2-ANA"]
    rut = by_id["REF-TIO2-RUT"]
    for entry, scale_w, d_true_nm, strain_true in [(ana, 0.80, 24.0, 0.0010), (rut, 0.22, 38.0, 0.0004)]:
        rx, rI, _, _ = project_pattern_to_wavelength(entry, lam)
        for t0, ri in zip(rx, rI):
            if t0 < 15.5 or t0 > 77.5:
                continue
            th_rad = math.radians(t0 / 2.0)
            beta_size_rad = (k_scherrer * (lam / 10.0)) / (d_true_nm * math.cos(th_rad))
            beta_strain_rad = 4.0 * strain_true * math.tan(th_rad)
            beta_sample_deg = math.degrees(beta_size_rad + beta_strain_rad)
            fwhm_tot_deg = math.sqrt(beta_sample_deg**2 + inst_deg**2)
            y_clean += scale_w * (ri / 100.0) * 6500.0 * _pvoigt(x, t0 + 0.02, 1.0, fwhm_tot_deg, eta=0.35)

    bg_true = 240.0 + 950.0 * np.exp(-x / 10.5) + 260.0 * np.exp(-0.5 * ((x - 23.0) / 6.5) ** 2)
    y_noisy = rng.poisson(np.clip(y_clean + bg_true, 1.0, None)).astype(float)

    xrd_path = SAMPLES_DIR / "sample_anatase_rutile_xrd.csv"
    with xrd_path.open("w", encoding="utf-8") as f:
        f.write("# MatLens Synthetic Sample: TiO2 Nanopowder (Anatase + Rutile)\n")
        f.write("# Source: Cu Ka (1.5406 A), Step: 0.02 deg, Inst_FWHM: 0.08 deg\n")
        f.write("2Theta_deg,Intensity_counts\n")
        for xv, yv in zip(x, y_noisy):
            f.write(f"{xv:.4f},{yv:.1f}\n")

    # 2. Silicon NIST SRM 640f crystallographic standard-like XRD pattern (known lattice a=5.43119 A, D=60 nm)
    si_entry = by_id["REF-SI-DIA"]
    x_si = np.round(np.arange(20.0, 95.001, 0.02), 4)
    y_si = np.zeros_like(x_si)
    rx_si, rI_si, hkls_si, _ = project_pattern_to_wavelength(si_entry, lam)
    si_true_peaks = []
    for t0, ri, hkl in zip(rx_si, rI_si, hkls_si):
        if 22.0 <= t0 <= 92.0:
            th_rad = math.radians(t0 / 2.0)
            beta_deg = math.degrees((k_scherrer * (lam / 10.0)) / (55.0 * math.cos(th_rad)))
            fwhm_deg = math.sqrt(beta_deg**2 + 0.06**2)
            y_si += (ri / 100.0) * 9000.0 * _pvoigt(x_si, t0, 1.0, fwhm_deg, eta=0.25)
            si_true_peaks.append({"two_theta": round(float(t0), 4), "hkl": hkl, "fwhm_deg": round(fwhm_deg, 4)})
    y_si_noisy = rng.poisson(np.clip(y_si + 120.0 + 300.0 * np.exp(-x_si / 15.0), 1.0, None)).astype(float)
    si_path = SAMPLES_DIR / "sample_silicon_srm640_xrd.csv"
    with si_path.open("w", encoding="utf-8") as f:
        f.write("# NIST SRM 640f Lattice Standard Reference Calculation (a = 5.43119 A, Cu Ka = 1.5406 A)\n")
        f.write("2Theta,Intensity\n")
        for xv, yv in zip(x_si, y_si_noisy):
            f.write(f"{xv:.4f},{yv:.1f}\n")

    # 3. SEM Nanoparticle Image (1024 x 848, ROI 1024 x 768, scalebar 200 px = 500 nm => 2.5 nm/px)
    W, H, BAR = 1024, 768, 80
    arr = np.full((H + BAR, W), 34.0, dtype=float)
    yy, xx = np.mgrid[0:H, 0:W]
    particles = []
    for _ in range(5000):
        r_px = float(np.clip(rng.normal(24.0, 4.5), 13.0, 38.0))
        cx = float(rng.uniform(48.0, W - 48.0))
        cy = float(rng.uniform(48.0, H - 48.0))
        # Allow gentle touching (~0.92*(r1+r2)) for realistic watershed testing without heavy fusion
        if all((cx - px) ** 2 + (cy - py) ** 2 >= (0.93 * (r_px + pr)) ** 2 for px, py, pr in particles):
            particles.append((cx, cy, r_px))
        if len(particles) >= 145:
            break

    for cx, cy, r_px in particles:
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        m = d2 <= r_px**2
        profile = 148.0 + 82.0 * np.sqrt(np.clip(1.0 - d2 / (r_px**2), 0.0, 1.0))
        arr[:H][m] = np.maximum(arr[:H][m], profile[m])

    arr[:H] += rng.normal(0.0, 8.5, size=(H, W))
    arr[:H] = np.clip(arr[:H], 0, 255)
    arr[H:] = 12.0  # Dark SEM info bar

    im_part = Image.fromarray(arr.astype(np.uint8), mode="L")
    draw = ImageDraw.Draw(im_part)
    draw.rectangle([740, H + 46, 940, H + 52], fill=250)  # Exactly 200 px horizontal scale bar!
    draw.text((810, H + 22), "500 nm", fill=240)
    draw.text((24, H + 30), "MatLens Synthetic SEM | HV: 15.0 kV | WD: 8.2 mm | Scale: 500 nm", fill=225)
    sem_part_path = SAMPLES_DIR / "sample_tio2_particles_sem.png"
    im_part.save(sem_part_path)

    # 4. SEM Sintered Polycrystalline Grain Micrograph (Voronoi tessellation, scalebar 200 px = 5 um => 25 nm/px)
    n_seeds = 95
    seeds_x = rng.uniform(20, W - 20, size=n_seeds)
    seeds_y = rng.uniform(20, H - 20, size=n_seeds)
    dist_stack = (xx[None, :, :] - seeds_x[:, None, None]) ** 2 + (yy[None, :, :] - seeds_y[:, None, None]) ** 2
    sorted_d = np.sort(dist_stack, axis=0)
    nearest_idx = np.argmin(dist_stack, axis=0)
    boundary_metric = np.sqrt(sorted_d[1]) - np.sqrt(sorted_d[0])

    grain_shades = rng.uniform(145.0, 205.0, size=n_seeds)
    g_arr = np.zeros((H + BAR, W), dtype=float)
    g_arr[:H] = grain_shades[nearest_idx]
    # Dark etched grain boundary grooves (~3 px wide)
    groove = np.exp(-0.5 * (boundary_metric / 1.45) ** 2)
    g_arr[:H] = g_arr[:H] * (1.0 - 0.72 * groove) + 25.0 * (0.72 * groove)
    g_arr[:H] = ndi.gaussian_filter(g_arr[:H], sigma=0.7) + rng.normal(0.0, 5.5, size=(H, W))
    g_arr[:H] = np.clip(g_arr[:H], 0, 255)
    g_arr[H:] = 12.0

    im_grain = Image.fromarray(g_arr.astype(np.uint8), mode="L")
    draw_g = ImageDraw.Draw(im_grain)
    draw_g.rectangle([740, H + 46, 940, H + 52], fill=250)  # 200 px = 5 µm
    draw_g.text((818, H + 22), "5 um", fill=240)
    draw_g.text((24, H + 30), "MatLens Synthetic Sintered Ceramic | Etched Section | Scale: 5 um", fill=225)
    sem_grain_path = SAMPLES_DIR / "sample_sintered_grains_sem.png"
    im_grain.save(sem_grain_path)

    # 5. Copy ZnO CIF to samples/ for user CIF upload testing
    zno_cif_src = CIF_EXPORT_DIR / "REF-ZNO-WUR.cif"
    if zno_cif_src.exists():
        shutil.copyfile(zno_cif_src, SAMPLES_DIR / "custom_zno_wurtzite.cif")

    true_diams_nm = [2.0 * r * 2.5 for _, _, r in particles]
    gt = {
        "sample_anatase_rutile_xrd": {
            "phases": ["Anatase (TiO2)", "Rutile (TiO2)"],
            "anatase_crystallite_nm": 24.0,
            "anatase_microstrain": 0.0010,
            "rutile_crystallite_nm": 38.0,
            "inst_fwhm_deg": 0.08,
            "wavelength_A": 1.5406,
        },
        "sample_silicon_srm640_xrd": {
            "phase": "Silicon (Si, NIST SRM 640 기준계)",
            "lattice_a_A": 5.43119,
            "crystallite_nm": 55.0,
            "inst_fwhm_deg": 0.06,
            "true_peaks": si_true_peaks,
        },
        "sample_tio2_particles_sem": {
            "n_particles": len(particles),
            "scale_px": 200.0,
            "scale_nm": 500.0,
            "nm_per_px": 2.5,
            "true_mean_diameter_nm": round(float(np.mean(true_diams_nm)), 2),
            "true_median_diameter_nm": round(float(np.median(true_diams_nm)), 2),
            "true_d10_d50_d90_nm": [round(float(v), 2) for v in np.percentile(true_diams_nm, [10, 50, 90])],
            "true_circularity": 1.0,
        },
        "sample_sintered_grains_sem": {
            "n_voronoi_grains": n_seeds,
            "scale_px": 200.0,
            "scale_um": 5.0,
            "nm_per_px": 25.0,
            "approx_mean_grain_equiv_um": round(math.sqrt((W * H) / n_seeds * (0.025**2) * 4.0 / math.pi), 2),
        },
    }
    (SAMPLES_DIR / "ground_truth.json").write_text(json.dumps(gt, ensure_ascii=False, indent=2), encoding="utf-8")
    return gt


if __name__ == "__main__":
    gt_info = make_samples()
    print(json.dumps(gt_info, ensure_ascii=False, indent=2))
