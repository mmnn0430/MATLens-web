"""Hall Effect Measurement Analysis Engine for MatLens 2.0.

Provides deterministic scientific quantitative calculations:
- Auto-recognition of Hall data columns & units
- Antisymmetrization across +/- B:
    V_H(B) = [V(+B) - V(-B)] / 2
    Longitudinal offset V_long = [V(+B) + V(-B)] / 2
- Linear regression dV_H / dB with R^2, standard error, and residual analysis
- Hall Coefficient: R_H = (t / I) * (dV_H / dB)
- Carrier Type: R_H < 0 -> n-type, R_H > 0 -> p-type
- Carrier Concentration:
    Bulk n_H = 1 / (e * |R_H|)
    Sheet n_s = n_H * t
- Hall Mobility: mu_H = |R_H| / rho_e = |R_H| * sigma
- Electrical Conductivity: sigma = 1 / rho_e
- van der Pauw sheet resistance solver:
    exp(-pi * R_A / R_s) + exp(-pi * R_B / R_s) = 1 (Newton-Raphson)
- Uncertainty propagation & scientific physics validation
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Physical constants (CODATA 2018 / SI)
ELEMENTARY_CHARGE = 1.602176634e-19  # Coulomb (C)


class HallAnalysisResult:
    def __init__(
        self,
        slope_dV_dB: float,
        r_squared: float,
        hall_coefficient_m3_C: float,
        hall_coefficient_cm3_C: float,
        carrier_type: str,
        carrier_concentration_cm3: float,
        carrier_concentration_m3: float,
        sheet_carrier_density_cm2: float,
        hall_mobility_cm2_Vs: Optional[float] = None,
        electrical_conductivity_S_cm: Optional[float] = None,
        resistivity_Ohm_cm: Optional[float] = None,
        sheet_resistance_Ohm_sq: Optional[float] = None,
        uncertainty_carrier_pct: float = 0.0,
        uncertainty_mobility_pct: float = 0.0,
        raw_b_field: List[float] = None,
        raw_v_hall: List[float] = None,
        antisym_b_field: List[float] = None,
        antisym_v_hall: List[float] = None,
        fitted_v_hall: List[float] = None,
        longitudinal_offset_mV: float = 0.0,
        offset_ratio_pct: float = 0.0,
        warnings: List[str] = None,
        notes: List[str] = None,
    ):
        self.slope_dV_dB = slope_dV_dB
        self.r_squared = r_squared
        self.hall_coefficient_m3_C = hall_coefficient_m3_C
        self.hall_coefficient_cm3_C = hall_coefficient_cm3_C
        self.carrier_type = carrier_type
        self.carrier_concentration_cm3 = carrier_concentration_cm3
        self.carrier_concentration_m3 = carrier_concentration_m3
        self.sheet_carrier_density_cm2 = sheet_carrier_density_cm2
        self.hall_mobility_cm2_Vs = hall_mobility_cm2_Vs
        self.electrical_conductivity_S_cm = electrical_conductivity_S_cm
        self.resistivity_Ohm_cm = resistivity_Ohm_cm
        self.sheet_resistance_Ohm_sq = sheet_resistance_Ohm_sq
        self.uncertainty_carrier_pct = uncertainty_carrier_pct
        self.uncertainty_mobility_pct = uncertainty_mobility_pct
        self.raw_b_field = raw_b_field or []
        self.raw_v_hall = raw_v_hall or []
        self.antisym_b_field = antisym_b_field or []
        self.antisym_v_hall = antisym_v_hall or []
        self.fitted_v_hall = fitted_v_hall or []
        self.longitudinal_offset_mV = longitudinal_offset_mV
        self.offset_ratio_pct = offset_ratio_pct
        self.warnings = warnings or []
        self.notes = notes or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slope_dV_dB": self.slope_dV_dB,
            "r_squared": self.r_squared,
            "hall_coefficient_m3_C": self.hall_coefficient_m3_C,
            "hall_coefficient_cm3_C": self.hall_coefficient_cm3_C,
            "carrier_type": self.carrier_type,
            "carrier_concentration_cm3": self.carrier_concentration_cm3,
            "carrier_concentration_m3": self.carrier_concentration_m3,
            "sheet_carrier_density_cm2": self.sheet_carrier_density_cm2,
            "hall_mobility_cm2_Vs": self.hall_mobility_cm2_Vs,
            "electrical_conductivity_S_cm": self.electrical_conductivity_S_cm,
            "resistivity_Ohm_cm": self.resistivity_Ohm_cm,
            "sheet_resistance_Ohm_sq": self.sheet_resistance_Ohm_sq,
            "uncertainty_carrier_pct": round(self.uncertainty_carrier_pct, 2),
            "uncertainty_mobility_pct": round(self.uncertainty_mobility_pct, 2),
            "raw_b_field": self.raw_b_field,
            "raw_v_hall": self.raw_v_hall,
            "antisym_b_field": self.antisym_b_field,
            "antisym_v_hall": self.antisym_v_hall,
            "fitted_v_hall": self.fitted_v_hall,
            "longitudinal_offset_mV": round(self.longitudinal_offset_mV, 4),
            "offset_ratio_pct": round(self.offset_ratio_pct, 2),
            "warnings": self.warnings,
            "notes": self.notes,
        }


def solve_vdp_sheet_resistance(R_A: float, R_B: float, tol: float = 1e-6, max_iter: int = 50) -> float:
    """Solves the van der Pauw transcendental equation for sheet resistance R_s:
        exp(-pi * R_A / R_s) + exp(-pi * R_B / R_s) = 1
    Uses Newton-Raphson iteration.
    """
    if R_A <= 0 or R_B <= 0:
        raise ValueError("van der Pauw resistance values R_A and R_B must be positive.")

    # Initial guess from asymptotic approximation: R_s ~= pi / ln(2) * (R_A + R_B)/2
    r_avg = 0.5 * (R_A + R_B)
    r_s = (math.pi / math.log(2.0)) * r_avg

    for _ in range(max_iter):
        arg_a = -math.pi * R_A / r_s
        arg_b = -math.pi * R_B / r_s
        if arg_a < -700 or arg_b < -700:
            break
        exp_a = math.exp(arg_a)
        exp_b = math.exp(arg_b)
        f_val = exp_a + exp_b - 1.0

        if abs(f_val) < tol:
            return r_s

        # Derivative df / d(r_s) = exp(-pi*R_A/r_s) * (pi*R_A / r_s^2) + exp(-pi*R_B/r_s) * (pi*R_B / r_s^2)
        df_val = (math.pi / (r_s**2)) * (R_A * exp_a + R_B * exp_b)
        if abs(df_val) < 1e-12:
            break
        delta = f_val / df_val
        r_s -= delta
        if r_s <= 0:
            r_s = 0.5 * (r_s + delta)  # damping step

    return r_s


def parse_hall_data(raw_text: str) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """Parses raw text (CSV, TXT, TSV) containing Hall effect data.
    Automatically identifies Magnetic Field and Hall Voltage columns,
    and extracts metadata headers (Thickness, Current, Sheet Resistance).
    """
    metadata: Dict[str, Any] = {}
    lines = raw_text.strip().splitlines()
    data_lines: List[str] = []

    # Regex for header metadata extraction
    meta_patterns = [
        (r"(?:thickness|t)\s*[:=]\s*([\d\.]+)\s*(um|µm|mm|nm|m)?", "thickness"),
        (r"(?:current|i|applied current)\s*[:=]\s*([\d\.]+)\s*(ma|µa|ua|a)?", "current"),
        (r"(?:sheet resistance|r_s|rsheet)\s*[:=]\s*([\d\.]+)\s*(ohm|ω)?", "sheet_resistance"),
        (r"(?:geometry)\s*[:=]\s*([a-zA-Z\s]+)", "geometry"),
        (r"(?:temperature|temp|t)\s*[:=]\s*([\d\.]+)\s*(c|k)?", "temperature"),
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
        raise ValueError("No valid numerical data lines found in Hall input.")

    # Determine delimiter
    first_row = data_lines[0]
    delimiter = "," if "," in first_row else ("\t" if "\t" in first_row else None)

    reader = list(csv.reader(data_lines, delimiter=delimiter or ",")) if delimiter else [l.split() for l in data_lines]
    if not reader:
        raise ValueError("Failed to parse tabular data.")

    header = [h.strip().lower() for h in reader[0]]

    # Detect field & voltage columns
    b_col_idx: Optional[int] = None
    v_col_idx: Optional[int] = None
    b_multiplier = 1.0  # target: Tesla
    v_multiplier = 1e-3  # target: Volts (default assuming mV in instrumentation)

    field_keywords = ["magneticfield", "magfield", "field", "b_t", "b (t)", "b[t]", "b", "flux"]
    volt_keywords = ["transversevoltage", "hallvoltage", "v_hall", "vh", "voltage", "v (mv)", "v[mv]", "transverse"]

    for idx, col in enumerate(header):
        normalized = re.sub(r"[^a-z0-9_]", "", col)
        col_lower = col.lower()
        if b_col_idx is None:
            for kw in field_keywords:
                if kw in normalized:
                    b_col_idx = idx
                    if "kg" in col_lower or "kilogauss" in col_lower:
                        b_multiplier = 0.1
                    elif re.search(r"(\bg\b|_g$|\(g\)|\bgauss\b)", col_lower):
                        b_multiplier = 1e-4
                    else:
                        b_multiplier = 1.0
                    break
        if v_col_idx is None:
            for kw in volt_keywords:
                if kw in normalized:
                    v_col_idx = idx
                    if "_v" in col_lower or "(v)" in col_lower or "[v]" in col_lower or col_lower.endswith("_v"):
                        v_multiplier = 1.0
                    elif "uv" in col_lower or "µv" in col_lower:
                        v_multiplier = 1e-6
                    elif "mv" in col_lower:
                        v_multiplier = 1e-3
                    else:
                        v_multiplier = 1e-3  # Default to mV for standard Hall instruments
                    break

    # If header didn't have names, check if row 0 is numerical
    start_row = 1
    try:
        float(reader[0][0])
        start_row = 0
        b_col_idx = 0
        v_col_idx = 1
    except ValueError:
        pass

    if b_col_idx is None or v_col_idx is None:
        if len(reader[0]) >= 2:
            b_col_idx = 0
            v_col_idx = 1
        else:
            raise ValueError("Could not detect both Magnetic Field (B) and Transverse Voltage (V_H) columns.")

    b_vals: List[float] = []
    v_vals: List[float] = []

    for r in reader[start_row:]:
        if len(r) <= max(b_col_idx, v_col_idx):
            continue
        try:
            b = float(r[b_col_idx].strip()) * b_multiplier
            v = float(r[v_col_idx].strip()) * v_multiplier
            b_vals.append(b)
            v_vals.append(v)
        except ValueError:
            continue

    if len(b_vals) < 3:
        raise ValueError(f"Insufficient valid data points for Hall analysis ({len(b_vals)} points found; >= 3 required).")

    return np.array(b_vals, dtype=float), np.array(v_vals, dtype=float), metadata


def antisymmetrize_hall_voltage(
    b_field: np.ndarray, v_hall: np.ndarray, tol_b: float = 0.02
) -> Tuple[np.ndarray, np.ndarray, float, float]:
    """Applies antisymmetrization across opposite magnetic field values:
        V_H_anti(B) = 0.5 * [ V(B) - V(-B) ]
        V_long(B)   = 0.5 * [ V(B) + V(-B) ]
    Removes longitudinal magnetoresistance / misalignment offset voltage.
    """
    sorted_indices = np.argsort(b_field)
    b_sorted = b_field[sorted_indices]
    v_sorted = v_hall[sorted_indices]

    anti_b: List[float] = []
    anti_v: List[float] = []
    offsets: List[float] = []

    used = set()
    n = len(b_sorted)

    for i in range(n):
        if i in used:
            continue
        bi = b_sorted[i]
        vi = v_sorted[i]
        target = -bi

        # Find closest match to -bi
        best_j = None
        best_diff = float("inf")
        for j in range(n):
            if j == i or j in used:
                continue
            diff = abs(b_sorted[j] - target)
            if diff < best_diff:
                best_diff = diff
                best_j = j

        if best_j is not None and best_diff <= max(tol_b, 0.05 * abs(bi) if abs(bi) > 0.1 else 0.02):
            used.add(i)
            used.add(best_j)
            v_pos = vi if bi >= 0 else v_sorted[best_j]
            v_neg = v_sorted[best_j] if bi >= 0 else vi
            b_mag = abs(bi)

            v_anti = 0.5 * (v_pos - v_neg)
            v_off = 0.5 * (v_pos + v_neg)

            # Store for +B and -B
            anti_b.append(b_mag)
            anti_v.append(v_anti)
            anti_b.append(-b_mag)
            anti_v.append(-v_anti)
            offsets.append(abs(v_off))
        else:
            # Point has no matching negative pair; keep raw
            anti_b.append(bi)
            anti_v.append(vi)

    anti_b_arr = np.array(anti_b, dtype=float)
    anti_v_arr = np.array(anti_v, dtype=float)

    # Sort final arrays
    order = np.argsort(anti_b_arr)
    mean_offset_mV = float(np.mean(offsets) * 1e3) if offsets else 0.0
    v_span = float(np.max(v_sorted) - np.min(v_sorted))
    offset_ratio_pct = (
        float((mean_offset_mV * 1e-3) / (v_span / 2.0) * 100.0) if v_span > 1e-9 and offsets else 0.0
    )

    return anti_b_arr[order], anti_v_arr[order], mean_offset_mV, offset_ratio_pct


def analyze_hall_data(
    b_field: np.ndarray,
    v_hall: np.ndarray,
    thickness_m: float,
    current_A: float,
    sheet_resistance_Ohm_sq: Optional[float] = None,
    resistivity_Ohm_m: Optional[float] = None,
    do_antisymmetrization: bool = True,
    sample_id: str = "Sample",
    material_name: Optional[str] = None,
) -> HallAnalysisResult:
    """Performs rigorous deterministic Hall effect quantitative analysis.

    Parameters:
    - b_field: Magnetic Field in Tesla (T)
    - v_hall: Transverse Hall voltage in Volts (V)
    - thickness_m: Sample thickness in meters (m)
    - current_A: Applied excitation current in Amperes (A)
    - sheet_resistance_Ohm_sq: Optional van der Pauw sheet resistance (Ohm/sq)
    - resistivity_Ohm_m: Optional bulk resistivity (Ohm*m)
    - do_antisymmetrization: Whether to subtract longitudinal offset across +/- B
    """
    warnings: List[str] = []
    notes: List[str] = []

    if thickness_m <= 0:
        raise ValueError(f"Sample thickness must be strictly positive (got {thickness_m} m).")
    if current_A == 0:
        raise ValueError("Applied current cannot be zero.")

    raw_b = b_field.tolist()
    raw_v_mV = (v_hall * 1e3).tolist()

    if do_antisymmetrization and np.any(b_field < 0) and np.any(b_field > 0):
        calc_b, calc_v, mean_offset_mV, offset_ratio_pct = antisymmetrize_hall_voltage(b_field, v_hall)
        notes.append(f"Applied +/-B antisymmetrization. Mean longitudinal offset: {mean_offset_mV:.3f} mV ({offset_ratio_pct:.1f}% of signal).")
    else:
        calc_b = b_field
        calc_v = v_hall
        mean_offset_mV = 0.0
        offset_ratio_pct = 0.0
        if not (np.any(b_field < 0) and np.any(b_field > 0)):
            warnings.append("Data contains single-polarity magnetic field; longitudinal offset could not be antisymmetrized.")

    # Linear regression: V_H = slope * B + intercept
    A = np.vstack([calc_b, np.ones(len(calc_b))]).T
    slope_dV_dB, intercept = np.linalg.lstsq(A, calc_v, rcond=None)[0]

    # Calculate R-squared
    v_pred = slope_dV_dB * calc_b + intercept
    ss_tot = np.sum((calc_v - np.mean(calc_v)) ** 2)
    ss_res = np.sum((calc_v - v_pred) ** 2)
    r_squared = float(1.0 - (ss_res / ss_tot)) if ss_tot > 1e-18 else 1.0

    if r_squared < 0.98:
        warnings.append(
            f"V_H vs B linearity R^2 = {r_squared:.4f} (< 0.98). Flagged for potential non-linear Hall response, "
            "two-band multicarrier conduction, or anomalous Hall effect."
        )

    # Hall Coefficient: R_H = (t / I) * (dV_H / dB)  [m^3 / C]
    hall_coeff_m3_C = (thickness_m / current_A) * slope_dV_dB
    hall_coeff_cm3_C = hall_coeff_m3_C * 1e6  # 1 m^3 = 10^6 cm^3

    # Carrier Type
    if hall_coeff_m3_C < 0:
        carrier_type = "n-type (electron dominated)"
    elif hall_coeff_m3_C > 0:
        carrier_type = "p-type (hole dominated)"
    else:
        carrier_type = "Undetermined (zero Hall coefficient)"

    # Carrier Concentration: n_H = 1 / (e * |R_H|)
    abs_rh = abs(hall_coeff_m3_C)
    if abs_rh > 1e-25:
        carrier_conc_m3 = 1.0 / (ELEMENTARY_CHARGE * abs_rh)
        carrier_conc_cm3 = carrier_conc_m3 * 1e-6
        # Sheet carrier density: n_s = n_H * t  [cm^-2]
        thickness_cm = thickness_m * 1e2
        sheet_carrier_density_cm2 = carrier_conc_cm3 * thickness_cm
    else:
        carrier_conc_m3 = 0.0
        carrier_conc_cm3 = 0.0
        sheet_carrier_density_cm2 = 0.0

    # Resistivity & Mobility
    mobility_cm2_Vs: Optional[float] = None
    conductivity_S_cm: Optional[float] = None
    rho_Ohm_cm: Optional[float] = None

    if sheet_resistance_Ohm_sq is not None and sheet_resistance_Ohm_sq > 0:
        # rho = R_sheet * t
        rho_m = sheet_resistance_Ohm_sq * thickness_m
        rho_Ohm_cm = rho_m * 1e2
    elif resistivity_Ohm_m is not None and resistivity_Ohm_m > 0:
        rho_m = resistivity_Ohm_m
        rho_Ohm_cm = rho_m * 1e2
        sheet_resistance_Ohm_sq = rho_m / thickness_m
    else:
        rho_m = None

    if rho_m is not None and rho_m > 0 and abs_rh > 1e-25:
        # mu_H = |R_H| / rho_m  [m^2 / V*s]
        mu_m2_Vs = abs_rh / rho_m
        mobility_cm2_Vs = mu_m2_Vs * 1e4  # 1 m^2 = 10^4 cm^2
        cond_S_m = 1.0 / rho_m
        conductivity_S_cm = cond_S_m * 1e-2  # 1 S/m = 0.01 S/cm
    else:
        if sheet_resistance_Ohm_sq is None and resistivity_Ohm_m is None:
            notes.append("Sheet resistance or resistivity not provided; Hall mobility calculation skipped.")

    # Uncertainty estimation (assumes thickness +/- 2%, current +/- 0.5%, regression residual)
    rel_err_slope = math.sqrt(ss_res / (len(calc_b) - 2)) / (abs(slope_dV_dB) * math.sqrt(np.sum((calc_b - np.mean(calc_b))**2))) if len(calc_b) > 2 and abs(slope_dV_dB) > 1e-15 else 0.02
    uncertainty_carrier_pct = math.sqrt((0.02)**2 + (0.005)**2 + (rel_err_slope)**2) * 100.0
    uncertainty_mobility_pct = math.sqrt(uncertainty_carrier_pct**2 + (0.03)**2) if mobility_cm2_Vs else 0.0

    notes.append("Calculation assumes single-band conduction with Hall factor r_H = 1.0.")

    return HallAnalysisResult(
        slope_dV_dB=float(slope_dV_dB),
        r_squared=float(r_squared),
        hall_coefficient_m3_C=float(hall_coeff_m3_C),
        hall_coefficient_cm3_C=float(hall_coeff_cm3_C),
        carrier_type=carrier_type,
        carrier_concentration_cm3=float(carrier_conc_cm3),
        carrier_concentration_m3=float(carrier_conc_m3),
        sheet_carrier_density_cm2=float(sheet_carrier_density_cm2),
        hall_mobility_cm2_Vs=float(mobility_cm2_Vs) if mobility_cm2_Vs else None,
        electrical_conductivity_S_cm=float(conductivity_S_cm) if conductivity_S_cm else None,
        resistivity_Ohm_cm=float(rho_Ohm_cm) if rho_Ohm_cm else None,
        sheet_resistance_Ohm_sq=float(sheet_resistance_Ohm_sq) if sheet_resistance_Ohm_sq else None,
        uncertainty_carrier_pct=uncertainty_carrier_pct,
        uncertainty_mobility_pct=uncertainty_mobility_pct,
        raw_b_field=raw_b,
        raw_v_hall=raw_v_mV,
        antisym_b_field=calc_b.tolist(),
        antisym_v_hall=(calc_v * 1e3).tolist(),
        fitted_v_hall=(v_pred * 1e3).tolist(),
        longitudinal_offset_mV=mean_offset_mV,
        offset_ratio_pct=offset_ratio_pct,
        warnings=warnings,
        notes=notes,
    )
