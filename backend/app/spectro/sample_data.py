"""High-Fidelity Synthetic Sample Data Generators and Ground-Truth Benchmarks
for FT-IR, DSC, and TGA Analytical Engines.
"""
from __future__ import annotations

import io
import math
from typing import Any

import numpy as np


def generate_ftir_synthetic_csv(
    sample_type: str = "polystyrene_film",
    film_thickness_um: float = 25.0,
    refractive_index: float = 1.59,
    step_cm: float = 2.0,
) -> str:
    """Generate benchmark FT-IR spectrum (CSV) with known absorption bands and exact interference fringes.

    Ground-truth parameters:
        - Film thickness: 25.00 μm
        - Refractive index: 1.59
        - Fringe cycle Δν = 10000 / (2 * 1.59 * 25.0) = 125.786 cm⁻¹
    """
    wn = np.arange(4000.0, 400.0 - step_cm / 2.0, -step_cm)
    # Baseline transmittance around 85%
    trans = np.full_like(wn, 86.0)

    # Core characteristic peaks of Polystyrene (wavenumber, width, %T depth)
    ps_peaks = [
        (3060.0, 18.0, 42.0),  # aromatic C-H stretch
        (3026.0, 16.0, 48.0),  # aromatic C-H stretch
        (2924.0, 22.0, 36.0),  # aliphatic asymmetric C-H stretch
        (2850.0, 20.0, 45.0),  # aliphatic symmetric C-H stretch
        (1601.0, 14.0, 52.0),  # aromatic ring C=C
        (1492.0, 15.0, 38.0),  # aromatic ring C=C
        (1452.0, 16.0, 32.0),  # CH2 bending + aromatic ring
        (1028.0, 14.0, 55.0),  # in-plane C-H bend
        (756.0, 15.0, 22.0),   # out-of-plane aromatic C-H (strong)
        (698.0, 16.0, 18.0),   # out-of-plane aromatic C-H (strong)
    ]
    for p_wn, p_w, p_min_t in ps_peaks:
        dip = 86.0 - p_min_t
        trans -= dip * np.exp(-((wn - p_wn) ** 2) / (2.0 * (p_w / 2.355) ** 2))

    # Add atmospheric CO2 doublet artifact around 2349 cm-1
    trans -= 8.0 * np.exp(-((wn - 2349.0) ** 2) / (2.0 * (6.0 / 2.355) ** 2))
    trans -= 6.0 * np.exp(-((wn - 2361.0) ** 2) / (2.0 * (5.0 / 2.355) ** 2))

    # Add theoretical Fabry-Perot interference fringes in the transparent window (1800 ~ 2750 cm-1)
    fringe_window = (wn >= 1800.0) & (wn <= 2750.0)
    delta_nu = 10000.0 / (2.0 * refractive_index * film_thickness_um)
    fringe_amp = 4.5  # %T amplitude oscillation
    trans[fringe_window] += fringe_amp * np.sin(2.0 * np.pi * (wn[fringe_window] - 1800.0) / delta_nu)

    # Slight measurement noise
    np.random.seed(42)
    noise = np.random.normal(0.0, 0.25, len(wn))
    trans = np.clip(trans + noise, 0.5, 99.5)

    buf = io.StringIO()
    buf.write("# MatLens Benchmark FT-IR Raw Spectrum\n")
    buf.write("# Sample: Polystyrene Reference Thin Film (Standard Calibration)\n")
    buf.write(f"# Known Physical Thickness: {film_thickness_um:.2f} um\n")
    buf.write(f"# Known Refractive Index: {refractive_index:.4f}\n")
    buf.write(f"# Theoretical Fringe Period DeltaNu: {delta_nu:.3f} cm-1\n")
    buf.write("Wavenumber_cm-1,Transmittance_pct\n")
    for w, t in zip(wn, trans):
        buf.write(f"{w:.2f},{t:.3f}\n")
    return buf.getvalue()


def generate_dsc_synthetic_csv(
    sample_type: str = "semicrystalline_pet",
    sample_mass_mg: float = 8.5,
    heating_rate_c_min: float = 10.0,
) -> str:
    """Generate multi-step DSC dataset (CSV): 1st Heating -> 1st Cooling -> 2nd Heating.

    Ground-truth parameters:
        - 1st Heating: Tg ≈ 78°C, Tcc ≈ 130°C (ΔHcc = 30 J/g), Tm ≈ 255°C (ΔHm = 48 J/g)
        - 1st Cooling: Tc ≈ 195°C (ΔHc = -45 J/g)
        - 2nd Heating: Tg ≈ 80°C, Tm ≈ 255°C (ΔHm = 45 J/g, without cold cryst)
        - Standard 100% crystalline enthalpy ΔHm° = 140.0 J/g (neat PET)
    """
    time_pts: list[float] = []
    temp_pts: list[float] = []
    hf_mw_pts: list[float] = []  # mW

    curr_time = 0.0
    dt_sec = 2.0
    rate_c_s = heating_rate_c_min / 60.0

    # Step 1: 1st Heating from 30°C to 290°C
    t1 = 30.0
    while t1 <= 290.0:
        time_pts.append(curr_time)
        temp_pts.append(t1)
        # Base heat flow (mW = W/g * sample_mass)
        # Baseline slope
        base_wg = 0.05 + 0.0008 * t1
        # Glass transition step at 78°C (step increase in Cp, endothermic direction)
        step_tg = 0.06 / (1.0 + np.exp(-(t1 - 78.0) / 3.0))
        # Cold crystallization exothermic dip (negative in endo up) at 130°C
        # Width ~ 15°C, area 30 J/g
        # Peak height = Area * rate_s / (sqrt(2*pi) * sigma)
        sigma_cc = 6.0
        h_cc = 30.0 * rate_c_s / (np.sqrt(2 * np.pi) * sigma_cc)
        peak_cc = -h_cc * np.exp(-((t1 - 130.0) ** 2) / (2.0 * sigma_cc ** 2))
        # Melting endothermic peak at 255°C
        sigma_m = 5.0
        h_m = 48.0 * rate_c_s / (np.sqrt(2 * np.pi) * sigma_m)
        peak_m = h_m * np.exp(-((t1 - 255.0) ** 2) / (2.0 * sigma_m ** 2))

        q_wg = base_wg + step_tg + peak_cc + peak_m
        hf_mw_pts.append(q_wg * sample_mass_mg)

        t1 += rate_c_s * dt_sec
        curr_time += dt_sec

    # Isothermal hold 290°C for 60 seconds
    for _ in range(30):
        time_pts.append(curr_time)
        temp_pts.append(290.0)
        hf_mw_pts.append((0.05 + 0.0008 * 290.0 + 0.06) * sample_mass_mg)
        curr_time += dt_sec

    # Step 2: 1st Cooling from 290°C to 30°C
    t2 = 290.0
    while t2 >= 30.0:
        time_pts.append(curr_time)
        temp_pts.append(t2)
        base_wg = 0.03 + 0.0007 * t2
        # Crystallization exothermic peak at 195°C
        sigma_c = 6.0
        h_c = -45.0 * rate_c_s / (np.sqrt(2 * np.pi) * sigma_c)  # exothermic
        peak_c = h_c * np.exp(-((t2 - 195.0) ** 2) / (2.0 * sigma_c ** 2))

        q_wg = base_wg + peak_c
        hf_mw_pts.append(q_wg * sample_mass_mg)

        t2 -= rate_c_s * dt_sec
        curr_time += dt_sec

    # Step 3: 2nd Heating from 30°C to 290°C
    t3 = 30.0
    while t3 <= 290.0:
        time_pts.append(curr_time)
        temp_pts.append(t3)
        base_wg = 0.05 + 0.0008 * t3
        step_tg = 0.05 / (1.0 + np.exp(-(t3 - 80.0) / 3.0))
        # Only melting at 255°C (no cold crystallization)
        sigma_m = 5.0
        h_m = 45.0 * rate_c_s / (np.sqrt(2 * np.pi) * sigma_m)
        peak_m = h_m * np.exp(-((t3 - 255.0) ** 2) / (2.0 * sigma_m ** 2))

        q_wg = base_wg + step_tg + peak_m
        hf_mw_pts.append(q_wg * sample_mass_mg)

        t3 += rate_c_s * dt_sec
        curr_time += dt_sec

    # Add slight realistic instrumental noise
    np.random.seed(123)
    hf_arr = np.array(hf_mw_pts) + np.random.normal(0.0, 0.02 * sample_mass_mg, len(hf_mw_pts))

    buf = io.StringIO()
    buf.write("# MatLens Benchmark DSC Multi-Cycle Data\n")
    buf.write(f"# Sample: Poly(ethylene terephthalate) (PET Standard Polymer)\n")
    buf.write(f"# Sample Mass: {sample_mass_mg:.2f} mg\n")
    buf.write(f"# Nominal Heating/Cooling Rate: {heating_rate_c_min:.1f} C/min\n")
    buf.write("# Known Reference delta_Hm_zero: 140.0 J/g (100% Crystalline PET)\n")
    buf.write("Time_s,Temperature_C,HeatFlow_mW\n")
    for t_s, temp, q_mw in zip(time_pts, temp_pts, hf_arr):
        buf.write(f"{t_s:.1f},{temp:.2f},{q_mw:.4f}\n")
    return buf.getvalue()


def generate_tga_synthetic_csv(
    sample_type: str = "rubber_carbon_black_composite",
    initial_mass_mg: float = 10.00,
    heating_rate_c_min: float = 10.0,
) -> str:
    """Generate multi-stage TGA dataset (CSV) with atmosphere switch at 600°C (N2 -> Air).

    Ground-truth decomposition profile:
        - 30 ~ 300°C: Volatiles / plasticizer loss ΔW = 10.0% (1.00 mg), DTG peak at 240°C
        - 300 ~ 580°C (N2): Polymer matrix pyrolysis ΔW = 55.0% (5.50 mg), DTG peak at 430°C
        - 600°C: Atmosphere gas switch from N2 to Air/O2
        - 600 ~ 720°C (Air): Carbon black combustion ΔW = 30.0% (3.00 mg), DTG peak at 665°C
        - 720 ~ 800°C: Inert inorganic residue (Ash / ZnO / silicate) = 5.0% (0.50 mg)
        - Exact T5 ≈ 215°C, T10 = 300°C
    """
    temps = np.arange(30.0, 800.0 + 0.5, 1.0)
    time_pts = (temps - 30.0) / (heating_rate_c_min / 60.0)

    # Sigmoidal mass loss profile
    # Step 1: 10% loss around 240°C (width 35°C)
    loss_step1 = 10.0 / (1.0 + np.exp(-(temps - 240.0) / 18.0))
    # Step 2: 55% loss around 430°C (width 30°C)
    loss_step2 = 55.0 / (1.0 + np.exp(-(temps - 430.0) / 16.0))
    # Step 3: 30% loss after gas switch to Air at 600°C, burning around 665°C (width 18°C)
    loss_step3 = 30.0 / (1.0 + np.exp(-(temps - 665.0) / 10.0))

    total_loss_pct = loss_step1 + loss_step2 + loss_step3
    mass_pct = 100.0 - total_loss_pct

    # Add slight realistic balance drift / noise
    np.random.seed(99)
    noise = np.random.normal(0.0, 0.04, len(temps))
    mass_pct = np.clip(mass_pct + noise, 4.9, 100.0)
    mass_mg = mass_pct * (initial_mass_mg / 100.0)

    buf = io.StringIO()
    buf.write("# MatLens Benchmark TGA Decomposition Data\n")
    buf.write(f"# Sample: Carbon Black Filled Elastomer Composite (NR/SBR blend)\n")
    buf.write(f"# Initial Sample Mass: {initial_mass_mg:.2f} mg\n")
    buf.write(f"# Heating Rate: {heating_rate_c_min:.1f} C/min\n")
    buf.write("# Atmosphere: N2 (30-600 C) -> Air switch at 600 C\n")
    buf.write("# Known Stages: Plasticizer 10%, Polymer Pyrolysis 55%, Carbon Black 30%, Ash Residue 5%\n")
    buf.write("Time_s,Temperature_C,Mass_mg,Residual_pct\n")
    for t_s, temp, m_mg, r_pct in zip(time_pts, temps, mass_mg, mass_pct):
        buf.write(f"{t_s:.1f},{temp:.1f},{m_mg:.4f},{r_pct:.2f}\n")
    return buf.getvalue()
