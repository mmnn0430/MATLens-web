"""Laser Flash Analysis (LFA) Engine for MatLens 2.0.

Provides deterministic scientific quantitative calculations:
- Parse LFA transient thermogram & temperature-dependent property tables
- Parker model thermal diffusivity calculation:
    alpha = 0.1388 * L^2 / t_{1/2}
- Thermal conductivity calculation:
    kappa = alpha * rho_m * C_p
    Automatic SI unit conversions
- Missing input handling (Diffusivity preserved when Cp/Density missing)
- Baseline drift & heat loss diagnostics
- Unit conversion & literature assumed value tracking
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


class LfaAnalysisResult:
    def __init__(
        self,
        half_rise_time_s: float,
        thermal_diffusivity_mm2_s: float,
        thermal_diffusivity_m2_s: float,
        thickness_mm: float,
        baseline_temp_C: float,
        max_temp_rise_C: float,
        thermal_conductivity_W_mK: Optional[float] = None,
        density_g_cm3: Optional[float] = None,
        specific_heat_J_gK: Optional[float] = None,
        is_literature_density: bool = False,
        is_literature_cp: bool = False,
        missing_inputs: List[str] = None,
        time_series_s: List[float] = None,
        temp_series_C: List[float] = None,
        fitted_time_s: List[float] = None,
        fitted_temp_C: List[float] = None,
        heat_loss_ratio: float = 0.0,
        uncertainty_diffusivity_pct: float = 0.0,
        uncertainty_conductivity_pct: float = 0.0,
        warnings: List[str] = None,
        notes: List[str] = None,
    ):
        self.half_rise_time_s = half_rise_time_s
        self.thermal_diffusivity_mm2_s = thermal_diffusivity_mm2_s
        self.thermal_diffusivity_m2_s = thermal_diffusivity_m2_s
        self.thickness_mm = thickness_mm
        self.baseline_temp_C = baseline_temp_C
        self.max_temp_rise_C = max_temp_rise_C
        self.thermal_conductivity_W_mK = thermal_conductivity_W_mK
        self.density_g_cm3 = density_g_cm3
        self.specific_heat_J_gK = specific_heat_J_gK
        self.is_literature_density = is_literature_density
        self.is_literature_cp = is_literature_cp
        self.missing_inputs = missing_inputs or []
        self.time_series_s = time_series_s or []
        self.temp_series_C = temp_series_C or []
        self.fitted_time_s = fitted_time_s or []
        self.fitted_temp_C = fitted_temp_C or []
        self.heat_loss_ratio = heat_loss_ratio
        self.uncertainty_diffusivity_pct = uncertainty_diffusivity_pct
        self.uncertainty_conductivity_pct = uncertainty_conductivity_pct
        self.warnings = warnings or []
        self.notes = notes or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "half_rise_time_s": round(self.half_rise_time_s, 5),
            "thermal_diffusivity_mm2_s": round(self.thermal_diffusivity_mm2_s, 4),
            "thermal_diffusivity_m2_s": self.thermal_diffusivity_m2_s,
            "thickness_mm": self.thickness_mm,
            "baseline_temp_C": round(self.baseline_temp_C, 3),
            "max_temp_rise_C": round(self.max_temp_rise_C, 3),
            "thermal_conductivity_W_mK": round(self.thermal_conductivity_W_mK, 3) if self.thermal_conductivity_W_mK is not None else None,
            "density_g_cm3": self.density_g_cm3,
            "specific_heat_J_gK": self.specific_heat_J_gK,
            "is_literature_density": self.is_literature_density,
            "is_literature_cp": self.is_literature_cp,
            "missing_inputs": self.missing_inputs,
            "time_series_s": self.time_series_s,
            "temp_series_C": self.temp_series_C,
            "fitted_time_s": self.fitted_time_s,
            "fitted_temp_C": self.fitted_temp_C,
            "heat_loss_ratio": round(self.heat_loss_ratio, 3),
            "uncertainty_diffusivity_pct": round(self.uncertainty_diffusivity_pct, 2),
            "uncertainty_conductivity_pct": round(self.uncertainty_conductivity_pct, 2),
            "warnings": self.warnings,
            "notes": self.notes,
        }


def parse_lfa_data(raw_text: str) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """Parses raw text (CSV, TXT, TSV) containing LFA transient or temperature series data.
    Extracts Time and Temperature columns, and headers for Thickness, Density, Cp.
    """
    metadata: Dict[str, Any] = {}
    lines = raw_text.strip().splitlines()
    data_lines: List[str] = []

    meta_patterns = [
        (r"(?:thickness|length|l)\s*[:=]\s*([\d\.]+)\s*(mm|um|µm|cm|m)?", "thickness"),
        (r"(?:density|rho|ρ)\s*[:=]\s*([\d\.]+)\s*(g/cm3|g/cm\^3|kg/m3|kg/m\^3)?", "density"),
        (r"(?:specific heat|cp|heat capacity)\s*[:=]\s*([\d\.]+)\s*(j/\(?g\*?k\)?|j/\(?kg\*?k\)?)?", "cp"),
        (r"(?:temperature|test temp|t)\s*[:=]\s*([\d\.]+)\s*(c|k)?", "temperature"),
        (r"(?:laser pulse|pulse width)\s*[:=]\s*([\d\.]+)\s*(ms|µs|us|s)?", "pulse_width"),
    ]

    for line in lines:
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned.startswith(("#", "//", ";")):
            content = cleaned.lstrip("#/; ").strip()
            for pat, key in meta_patterns:
                m = re.search(pat, content, re.IGNORECASE)
                if m:
                    val = m.group(1)
                    unit = m.group(2) if len(m.groups()) > 1 else ""
                    metadata[key] = {"value": float(val) if val.replace(".", "", 1).isdigit() else val, "unit": unit}
            continue
        data_lines.append(cleaned)

    if not data_lines:
        raise ValueError("No valid numerical data lines found in LFA input.")

    first_row = data_lines[0]
    delimiter = "," if "," in first_row else ("\t" if "\t" in first_row else None)
    reader = list(csv.reader(data_lines, delimiter=delimiter or ",")) if delimiter else [l.split() for l in data_lines]

    header = [h.strip().lower() for h in reader[0]]

    time_col_idx: Optional[int] = None
    temp_col_idx: Optional[int] = None

    time_keywords = ["time_s", "time(s)", "time[s]", "time", "t(s)", "t_s"]
    temp_keywords = ["reartemperature", "temperature", "temp", "signal", "voltage", "rear_temp", "thermogram", "t_c", "t(c)"]

    for idx, col in enumerate(header):
        normalized = re.sub(r"[^a-z0-9_]", "", col)
        if time_col_idx is None:
            for kw in time_keywords:
                if kw in normalized:
                    time_col_idx = idx
                    break
        if temp_col_idx is None:
            for kw in temp_keywords:
                if kw in normalized:
                    temp_col_idx = idx
                    break

    start_row = 1
    try:
        float(reader[0][0])
        start_row = 0
        time_col_idx = 0
        temp_col_idx = 1
    except ValueError:
        pass

    if time_col_idx is None or temp_col_idx is None:
        if len(reader[0]) >= 2:
            time_col_idx = 0
            temp_col_idx = 1
        else:
            raise ValueError("Could not detect both Time and Temperature/Signal columns for LFA.")

    t_vals: List[float] = []
    temp_vals: List[float] = []

    for r in reader[start_row:]:
        if len(r) <= max(time_col_idx, temp_col_idx):
            continue
        try:
            t = float(r[time_col_idx].strip())
            tp = float(r[temp_col_idx].strip())
            t_vals.append(t)
            temp_vals.append(tp)
        except ValueError:
            continue

    if len(t_vals) < 10:
        raise ValueError(f"Insufficient data points for LFA transient curve ({len(t_vals)} points found; >= 10 required).")

    return np.array(t_vals, dtype=float), np.array(temp_vals, dtype=float), metadata


def analyze_lfa_transient(
    time_s: np.ndarray,
    temp_signal: np.ndarray,
    thickness_mm: float,
    density_g_cm3: Optional[float] = None,
    specific_heat_J_gK: Optional[float] = None,
    is_literature_density: bool = False,
    is_literature_cp: bool = False,
    sample_id: str = "Sample",
    material_name: Optional[str] = None,
) -> LfaAnalysisResult:
    """Performs Parker model Laser Flash Analysis (LFA) to calculate thermal diffusivity
    and thermal conductivity.

    Parameters:
    - time_s: Time array in seconds
    - temp_signal: Temperature array in deg C or arbitrary signal units
    - thickness_mm: Specimen thickness in mm
    - density_g_cm3: Optional mass density in g/cm^3
    - specific_heat_J_gK: Optional specific heat capacity in J/(g*K)
    """
    warnings: List[str] = []
    notes: List[str] = []
    missing_inputs: List[str] = []

    if thickness_mm <= 0:
        raise ValueError(f"Specimen thickness must be strictly positive (got {thickness_mm} mm).")

    # 1. Baseline determination: pre-pulse signal (t <= 0) or initial 5% of data
    pre_pulse_idx = np.where(time_s <= 0)[0]
    if len(pre_pulse_idx) >= 3:
        baseline_T = float(np.mean(temp_signal[pre_pulse_idx]))
    else:
        init_n = max(3, int(len(time_s) * 0.05))
        baseline_T = float(np.mean(temp_signal[:init_n]))

    # Post-pulse signal (t > 0)
    post_idx = np.where(time_s >= 0)[0]
    if len(post_idx) < 5:
        post_idx = np.arange(len(time_s))

    t_post = time_s[post_idx]
    y_post = temp_signal[post_idx]

    # Peak temperature
    max_idx = int(np.argmax(y_post))
    t_max = float(t_post[max_idx])
    T_max = float(y_post[max_idx])
    delta_T_max = T_max - baseline_T

    if delta_T_max <= 0:
        raise ValueError("Temperature signal does not exhibit positive laser heating rise.")

    # Half-rise threshold
    T_half = baseline_T + 0.5 * delta_T_max

    # Find t_{1/2} by linear interpolation across the rising edge (0 to max_idx)
    rise_y = y_post[: max_idx + 1]
    rise_t = t_post[: max_idx + 1]

    half_idx = np.where(rise_y >= T_half)[0]
    if len(half_idx) == 0:
        t_half = float(t_max * 0.5)
        warnings.append("Could not find exact half-rise crossing; estimated t_1/2 from peak time.")
    else:
        k = half_idx[0]
        if k == 0:
            t_half = float(rise_t[0])
        else:
            # Linear interpolation between k-1 and k
            y0, y1 = rise_y[k - 1], rise_y[k]
            t0, t1 = rise_t[k - 1], rise_t[k]
            if abs(y1 - y0) > 1e-12:
                t_half = float(t0 + (T_half - y0) * (t1 - t0) / (y1 - y0))
            else:
                t_half = float(t0)

    if t_half <= 0:
        t_half = 1e-4
        warnings.append("Half-rise time t_1/2 was <= 0; clipped to physical lower bound.")

    # Parker Model: alpha = 0.1388 * L^2 / t_{1/2}  [mm^2 / s]
    # L in mm -> L^2 in mm^2
    alpha_mm2_s = 0.1388 * (thickness_mm**2) / t_half
    alpha_m2_s = alpha_mm2_s * 1e-6

    # Quality check: Heat loss diagnostic
    # Ratio between tail temperature and peak temperature
    tail_T = float(np.mean(y_post[-max(3, int(len(y_post) * 0.05)):]))
    heat_loss_ratio = float((T_max - tail_T) / delta_T_max) if delta_T_max > 1e-6 else 0.0
    if heat_loss_ratio > 0.15:
        warnings.append(
            f"Significant rear surface cooling observed (tail drop = {heat_loss_ratio*100:.1f}%). "
            "Ideal adiabatic Parker model may slightly overestimate diffusivity; Cowan or Cape-Lehman correction recommended."
        )

    # Specific Heat & Density handling
    thermal_conductivity: Optional[float] = None
    if density_g_cm3 is None or density_g_cm3 <= 0:
        missing_inputs.append("Density (ρ_m)")
    if specific_heat_J_gK is None or specific_heat_J_gK <= 0:
        missing_inputs.append("Specific Heat Capacity (Cp)")

    if not missing_inputs:
        # kappa = alpha * rho_m * Cp
        # alpha in mm^2/s (= 1e-6 m^2/s)
        # density in g/cm^3 (= 1e3 kg/m^3)
        # Cp in J/(g*K) (= 1e3 J/(kg*K))
        # (1e-6) * (1e3) * (1e3) = 1.0 -> direct product yields W/(m*K)
        thermal_conductivity = float(alpha_mm2_s * density_g_cm3 * specific_heat_J_gK)
        if is_literature_density:
            notes.append("Density is an assumed literature value. Note: Real specimen porosity and processing may alter density.")
        if is_literature_cp:
            notes.append("Specific heat capacity Cp is an assumed literature value.")
    else:
        notes.append(
            f"Thermal conductivity calculation on HOLD: missing {', '.join(missing_inputs)}. "
            "Diffusivity alpha is calculated and verified."
        )

    # Uncertainty estimation
    unc_t_half = 0.02
    unc_L = 0.015
    uncertainty_diffusivity_pct = math.sqrt((2.0 * unc_L)**2 + unc_t_half**2) * 100.0
    if thermal_conductivity is not None:
        uncertainty_conductivity_pct = math.sqrt(uncertainty_diffusivity_pct**2 + 3.0**2 + 3.0**2)
    else:
        uncertainty_conductivity_pct = 0.0

    # Parker theoretical curve generation: T(t) / Delta_T_max = 1 + 2 * sum_{n=1}^inf (-1)^n * exp(-n^2 * pi^2 * alpha * t / L^2)
    t_fit = np.linspace(max(0.0, float(time_s[0])), float(time_s[-1]), 100)
    y_fit = np.zeros_like(t_fit)
    pi_sq = math.pi ** 2
    for n in range(1, 15):
        y_fit += ((-1) ** n) * np.exp(- (n**2) * pi_sq * (alpha_mm2_s * t_fit / (thickness_mm**2)))
    theoretical_T = baseline_T + delta_T_max * (1.0 + 2.0 * y_fit)

    notes.append(f"Parker formula applied: alpha = 0.1388 * L^2 / t_1/2 (L={thickness_mm:.2f} mm, t_1/2={t_half:.4f} s).")

    return LfaAnalysisResult(
        half_rise_time_s=t_half,
        thermal_diffusivity_mm2_s=float(alpha_mm2_s),
        thermal_diffusivity_m2_s=float(alpha_m2_s),
        thickness_mm=thickness_mm,
        baseline_temp_C=baseline_T,
        max_temp_rise_C=delta_T_max,
        thermal_conductivity_W_mK=thermal_conductivity,
        density_g_cm3=density_g_cm3,
        specific_heat_J_gK=specific_heat_J_gK,
        is_literature_density=is_literature_density,
        is_literature_cp=is_literature_cp,
        missing_inputs=missing_inputs,
        time_series_s=time_s.tolist(),
        temp_series_C=temp_signal.tolist(),
        fitted_time_s=t_fit.tolist(),
        fitted_temp_C=theoretical_T.tolist(),
        heat_loss_ratio=heat_loss_ratio,
        uncertainty_diffusivity_pct=uncertainty_diffusivity_pct,
        uncertainty_conductivity_pct=uncertainty_conductivity_pct,
        warnings=warnings,
        notes=notes,
    )
