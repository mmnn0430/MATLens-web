"""XRD Numerical Analysis Engine.

Principles:
- Preserves raw measurements without destructive modification.
- Strictly separates smoothed peak-detection signal from unsmoothed quantitative peak-fitting signal.
- Never substitutes 0 or arbitrary numbers when fitting or physical conditions fail.
- Documents match score definition, Scherrer/W-H assumptions, and instrumental broadening status.
"""
from __future__ import annotations

import io
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.optimize import curve_fit, nnls
from scipy.signal import find_peaks, peak_widths, savgol_filter
from scipy.sparse.linalg import spsolve

from ..schemas import XRDParams
from .mp_service import (
    compute_phase_diagram_and_bse_analysis,
    enrich_entry_with_mp_properties,
    fetch_mp_phases_for_elements,
)
from .ref_library import XRAY_PRESETS, project_pattern_to_wavelength

_NUM_RE = re.compile(r"^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$")


def _extract_xlsx_lines(raw: bytes) -> list[str]:
    """Extract worksheet rows from an .xlsx file into comma-separated lines without external dependencies."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = zf.namelist()
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in names:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in ss_root:
                    shared_strings.append("".join((t.text or "") for t in si.iter() if t.tag.endswith("t")))

            sheet_candidates = sorted(
                n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")
            )
            if not sheet_candidates:
                raise ValueError("Excel(.xlsx) 파일 내부에 워크시트가 없습니다.")

            sheet_root = ET.fromstring(zf.read(sheet_candidates[0]))
            rows = [el for el in sheet_root.iter() if el.tag.endswith("row")]
            lines: list[str] = []
            for r in rows:
                row_dict: dict[int, str] = {}
                for c in r:
                    ref = c.attrib.get("r", "")
                    col_letters = "".join(ch for ch in ref if ch.isalpha())
                    if col_letters:
                        col_idx = 0
                        for ch in col_letters:
                            col_idx = col_idx * 26 + (ord(ch.upper()) - ord("A") + 1)
                        col_idx -= 1
                    else:
                        col_idx = len(row_dict)
                    cell_type = c.attrib.get("t", "")
                    v_el = next((ch for ch in c if ch.tag.endswith("v")), None)
                    is_el = next((ch for ch in c if ch.tag.endswith("is")), None)
                    if v_el is not None and v_el.text is not None:
                        val = v_el.text.strip()
                        if cell_type == "s" and val.isdigit() and int(val) < len(shared_strings):
                            val = shared_strings[int(val)].strip()
                    elif is_el is not None:
                        val = "".join((t.text or "") for t in is_el.iter() if t.tag.endswith("t")).strip()
                    else:
                        val = ""
                    row_dict[col_idx] = val.replace(",", " ")
                if row_dict:
                    max_c = max(row_dict.keys())
                    lines.append(",".join(row_dict.get(i, "") for i in range(max_c + 1)))
            return lines
    except zipfile.BadZipFile as exc:
        raise ValueError("손상되었거나 지원하지 않는 Excel 파일 형식입니다. CSV 또는 .xlsx 파일을 업로드해주세요.") from exc


def _decode_text(raw: bytes) -> tuple[str, str]:
    if raw[:4] == b"PK\x03\x04":
        xlsx_lines = _extract_xlsx_lines(raw)
        return "\n".join(xlsx_lines), "xlsx (Excel 워크시트)"
    for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace"), "latin-1"


def _detect_delimiter(lines: list[str]) -> tuple[str, str]:
    sample = [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith(("#", "*", ";", "//"))][:30]
    for delim, name in [(",", "comma (,)"), ("\t", "tab (\\t)"), (";", "semicolon (;)")]:
        counts = [ln.count(delim) for ln in sample if ln]
        if counts and sum(c >= 1 for c in counts) >= max(1, int(0.6 * len(counts))):
            return delim, name
    return r"\s+", "whitespace"


def _split_line(line: str, delim: str) -> list[str]:
    if delim == r"\s+":
        return [p for p in re.split(r"\s+", line.strip()) if p]
    return [p.strip() for p in line.strip().split(delim)]


def inspect_and_parse_xrd(
    raw: bytes,
    col_two_theta: int | str | None = None,
    col_intensity: int | str | None = None,
) -> dict[str, Any]:
    """Inspect XRD CSV/TXT structure, auto-estimate 2θ & intensity columns, check anomalies, and return clean arrays."""
    text, encoding = _decode_text(raw)
    raw_lines = text.splitlines()
    if not raw_lines:
        raise ValueError("빈 파일입니다. 2θ와 강도(Intensity)가 포함된 CSV 파일을 업로드해주세요.")

    delim, delim_label = _detect_delimiter(raw_lines)

    header_names: list[str] | None = None
    data_rows: list[list[str]] = []
    skipped_preamble = 0

    for ln in raw_lines:
        stripped = ln.strip()
        if not stripped or stripped.startswith(("#", "*", "//")):
            skipped_preamble += 1
            continue
        parts = _split_line(stripped, delim)
        if len(parts) < 2:
            skipped_preamble += 1
            continue
        num_flags = [_NUM_RE.match(p) is not None for p in parts]
        if sum(num_flags) >= 2 and (num_flags[0] or sum(num_flags) >= len(parts) - 1):
            data_rows.append(parts)
        else:
            if not data_rows:
                header_names = parts
            else:
                skipped_preamble += 1

    if len(data_rows) < 15:
        raise ValueError(
            f"유효한 수치 데이터 행이 부족합니다 (읽힌 행 수: {len(data_rows)}개, 최소 15개 필요). "
            "파일 구분자(쉼표·탭)와 2θ/Intensity 숫자 열이 포함되어 있는지 확인해주세요."
        )

    max_cols = max(len(r) for r in data_rows)
    if header_names and len(header_names) >= max_cols:
        col_names = [header_names[i] or f"열 {i + 1}" for i in range(max_cols)]
        has_header = True
    else:
        col_names = [
            header_names[i] if (header_names and i < len(header_names) and header_names[i]) else f"열 {i + 1}"
            for i in range(max_cols)
        ]
        has_header = header_names is not None

    mat = np.full((len(data_rows), max_cols), np.nan, dtype=float)
    for r_idx, row in enumerate(data_rows):
        for c_idx in range(min(len(row), max_cols)):
            val_str = row[c_idx]
            if _NUM_RE.match(val_str):
                try:
                    mat[r_idx, c_idx] = float(val_str)
                except ValueError:
                    pass

    # Auto-estimate columns
    est_theta_idx = 0
    est_int_idx = 1 if max_cols > 1 else 0

    for c_idx, cname in enumerate(col_names):
        low = cname.lower()
        if any(k in low for k in ("2theta", "2-theta", "two_theta", "2θ", "angle", "pos", "deg")):
            est_theta_idx = c_idx
            break
    else:
        # Heuristic: monotonic column within [0.5, 175]
        for c_idx in range(max_cols):
            col_valid = mat[~np.isnan(mat[:, c_idx]), c_idx]
            if len(col_valid) >= 15:
                diffs = np.diff(col_valid)
                if np.mean(diffs > 0) > 0.95 and 0.0 <= col_valid.min() <= 90.0 and col_valid.max() <= 180.0:
                    est_theta_idx = c_idx
                    break

    for c_idx, cname in enumerate(col_names):
        if c_idx == est_theta_idx:
            continue
        low = cname.lower()
        if any(k in low for k in ("int", "count", "cps", "yobs", "obs", "signal")):
            est_int_idx = c_idx
            break
    else:
        for c_idx in range(max_cols):
            if c_idx != est_theta_idx and np.sum(~np.isnan(mat[:, c_idx])) >= 15:
                est_int_idx = c_idx
                break

    def _resolve_col(spec: int | str | None, fallback: int) -> int:
        if spec is None:
            return fallback
        if isinstance(spec, int) and 0 <= spec < max_cols:
            return spec
        if isinstance(spec, str):
            if spec.isdigit() and 0 <= int(spec) < max_cols:
                return int(spec)
            for idx, nm in enumerate(col_names):
                if nm == spec:
                    return idx
        return fallback

    sel_theta = _resolve_col(col_two_theta, est_theta_idx)
    sel_int = _resolve_col(col_intensity, est_int_idx)
    if sel_theta == sel_int and max_cols >= 2:
        sel_int = 1 if sel_theta == 0 else 0

    raw_x = mat[:, sel_theta]
    raw_y = mat[:, sel_int]

    missing_mask = np.isnan(raw_x) | np.isnan(raw_y)
    missing_count = int(np.sum(missing_mask))
    finite_mask = (~missing_mask) & np.isfinite(raw_x) & np.isfinite(raw_y)
    abnormal_inf_count = int(np.sum(~missing_mask & ~finite_mask))

    x_clean = raw_x[finite_mask]
    y_clean = raw_y[finite_mask]

    # Angle sanity check
    out_of_bounds_angles = int(np.sum((x_clean < 0.2) | (x_clean > 179.5)))
    in_bounds = (x_clean >= 0.2) & (x_clean <= 179.5)
    x_clean = x_clean[in_bounds]
    y_clean = y_clean[in_bounds]

    if len(x_clean) < 15:
        raise ValueError(
            "선택한 열에서 유효한 2θ 각도(0.2°~179.5°) 데이터가 15개 미만입니다. "
            "2θ 열과 Intensity 열 매핑을 다시 확인해주세요."
        )

    negative_intensity_count = int(np.sum(y_clean < 0))

    # Sort & merge duplicate angles by averaging intensity
    df = pd.DataFrame({"two_theta": x_clean, "intensity": y_clean}).sort_values("two_theta")
    dup_count = int(df.duplicated(subset=["two_theta"]).sum())
    if dup_count > 0:
        df = df.groupby("two_theta", as_index=False)["intensity"].mean()

    x_arr = df["two_theta"].to_numpy(dtype=float)
    y_arr = df["intensity"].to_numpy(dtype=float)

    steps = np.diff(x_arr)
    median_step = float(np.median(steps))
    max_step_dev = float(np.max(np.abs(steps - median_step))) if len(steps) else 0.0
    is_uniform_step = bool(median_step > 0 and (max_step_dev <= max(1e-4, 0.08 * median_step)))

    y_ptp = float(np.ptp(y_arr))
    is_constant_signal = bool(y_ptp <= 1e-9)

    warnings: list[str] = []
    if missing_count > 0:
        warnings.append(f"결측치 {missing_count}개 행을 제외했습니다.")
    if dup_count > 0:
        warnings.append(f"중복된 2θ 각도 {dup_count}개를 평균 강도로 병합했습니다.")
    if negative_intensity_count > 0:
        warnings.append(f"음수 강도 값 {negative_intensity_count}개가 포함되어 있습니다 (배경 보정 전 전처리 데이터 여부 확인 권장).")
    if out_of_bounds_angles > 0:
        warnings.append(f"물리적 2θ 범위를 벗어난 행 {out_of_bounds_angles}개를 제외했습니다.")
    if not is_uniform_step:
        warnings.append(
            f"불균일 각도 간격 감지 (중앙 간격 {median_step:.4f}°, 최대 편차 {max_step_dev:.4f}°): "
            "정량 피크 피팅은 원본 불균일 2θ 좌표에서 직접 수행하고, 검출용 Savitzky–Golay 평활화만 균일 격자 내삽 후 복원합니다."
        )
    if is_constant_signal:
        warnings.append("강도 변화가 없는 상수 신호(평탄 데이터)입니다. 피크 검출 및 정량 분석이 제한됩니다.")

    columns_meta = []
    for idx, nm in enumerate(col_names):
        col_non_nan = mat[~np.isnan(mat[:, idx]), idx]
        if len(col_non_nan) < 15 and idx not in (est_theta_idx, est_int_idx, sel_theta, sel_int):
            continue
        valid_vals = col_non_nan[:3]
        columns_meta.append(
            {
                "index": idx,
                "name": nm,
                "preview": [round(float(v), 4) for v in valid_vals],
            }
        )

    inspection = {
        "encoding": encoding,
        "delimiter": delim_label,
        "has_header": has_header,
        "skipped_preamble_lines": skipped_preamble,
        "columns": columns_meta,
        "estimated_col_two_theta": est_theta_idx,
        "estimated_col_intensity": est_int_idx,
        "selected_col_two_theta": sel_theta,
        "selected_col_intensity": sel_int,
        "n_points": int(len(x_arr)),
        "two_theta_min": round(float(x_arr.min()), 4),
        "two_theta_max": round(float(x_arr.max()), 4),
        "median_step_deg": round(median_step, 5),
        "max_step_deviation_deg": round(max_step_dev, 5),
        "is_uniform_step": is_uniform_step,
        "non_uniform_handling": (
            "균일 각도 간격 — 원본 격자 그대로 사용"
            if is_uniform_step
            else "정량 피팅·배경 추정은 원본 2θ 좌표 유지, 검출용 Savitzky–Golay 평활화에만 중앙 간격 균일 보간 적용"
        ),
        "missing_count": missing_count,
        "duplicate_angle_count": dup_count,
        "negative_intensity_count": negative_intensity_count,
        "abnormal_value_count": abnormal_inf_count + out_of_bounds_angles,
        "is_constant_signal": is_constant_signal,
        "warnings": warnings,
    }
    return {"x": x_arr, "y": y_arr, "inspection": inspection}


def als_baseline(y: np.ndarray, lam: float = 1e5, p: float = 0.01, niter: int = 12) -> np.ndarray:
    """Asymmetric Least Squares baseline estimation (Eilers & Boelens, 2005)."""
    n = len(y)
    if n < 5 or float(np.ptp(y)) <= 1e-12:
        return y.copy()
    D = sparse.diags([1.0, -2.0, 1.0], [0, -1, -2], shape=(n, n - 2))
    DDT = float(lam) * D.dot(D.transpose())
    w = np.ones(n, dtype=float)
    z = y.copy()
    for _ in range(niter):
        W = sparse.spdiags(w, 0, n, n)
        z = spsolve((W + DDT).tocsc(), w * y)
        w = p * (y > z) + (1.0 - p) * (y <= z)
    return np.asarray(z, dtype=float)


def _smooth_for_detection(x: np.ndarray, y: np.ndarray, window: int, polyorder: int, is_uniform: bool) -> np.ndarray:
    n = len(y)
    step = float(np.median(np.diff(x))) if n > 1 else 0.02
    # Cap smoothing angular span to ~0.22 deg unless user explicitly set a larger window on fine step data
    max_pts_by_span = max(5, int(round(0.22 / max(step, 1e-4))) | 1)
    win = max(5, min(int(window) | 1, max_pts_by_span if step >= 0.03 else (int(window) | 1)))
    max_odd = (n - 1) if (n - 1) % 2 == 1 else (n - 2)
    win = min(win, max_odd)
    if win <= polyorder or win < 5:
        return y.copy()
    if is_uniform:
        return np.asarray(savgol_filter(y, win, polyorder), dtype=float)
    # Non-uniform angular spacing: interpolate onto temporary uniform grid ONLY for detection trace
    step = float(np.median(np.diff(x)))
    n_uni = max(n, min(20000, int(round((x[-1] - x[0]) / max(step, 1e-4))) + 1))
    x_uni = np.linspace(x[0], x[-1], n_uni)
    y_uni = np.interp(x_uni, x, y)
    win_uni = min(win, (n_uni - 1) if (n_uni - 1) % 2 == 1 else (n_uni - 2))
    if win_uni <= polyorder:
        return y.copy()
    ys_uni = savgol_filter(y_uni, win_uni, polyorder)
    return np.interp(x, x_uni, ys_uni)


# ---------------- Peak Profile Functions ---------------- #
def _gauss(x: np.ndarray, x0: float, h: float, w: float) -> np.ndarray:
    return h * np.exp(-4.0 * math.log(2.0) * ((x - x0) / np.maximum(w, 1e-6)) ** 2)


def _lorentz(x: np.ndarray, x0: float, h: float, w: float) -> np.ndarray:
    return h / (1.0 + 4.0 * ((x - x0) / np.maximum(w, 1e-6)) ** 2)


def _pvoigt(x: np.ndarray, x0: float, h: float, w: float, eta: float) -> np.ndarray:
    return eta * _lorentz(x, x0, h, w) + (1.0 - eta) * _gauss(x, x0, h, w)


def _analytic_area(h: float, w: float, eta: float) -> float:
    g_area = h * w * 0.5 * math.sqrt(math.pi / math.log(2.0))
    l_area = h * w * 0.5 * math.pi
    return float(eta * l_area + (1.0 - eta) * g_area)


def detect_and_fit_peaks(
    x: np.ndarray,
    y_quant: np.ndarray,
    y_detect: np.ndarray,
    step_deg: float,
    params: XRDParams,
) -> tuple[list[dict[str, Any]], float]:
    """Detect candidate peaks on y_detect, then fit profile widths/areas on UNSMOOTHED y_quant."""
    y_pos = np.clip(y_detect, 0.0, None)
    ymax = float(np.max(y_pos)) if len(y_pos) else 0.0
    if ymax <= 1e-9:
        return [], 0.0

    # Estimate noise floor sigma from lower quantile residuals of unsmoothed y_quant
    low_cut = np.percentile(np.abs(y_quant), 35)
    quiet = y_quant[np.abs(y_quant) <= max(low_cut, 1e-9)]
    mad = float(np.median(np.abs(quiet - np.median(quiet)))) if len(quiet) >= 5 else 0.0
    noise_sigma = max(1.4826 * mad, 1e-6 * ymax)

    dist_pts = max(1, int(round(params.min_distance_deg / max(step_deg, 1e-4))))
    cand_idx, props = find_peaks(
        y_pos,
        height=ymax * params.min_rel_height,
        prominence=ymax * params.prominence_rel,
        distance=dist_pts,
    )
    if len(cand_idx) == 0:
        return [], noise_sigma

    widths_pts, _, _, _ = peak_widths(y_pos, cand_idx, rel_height=0.5)
    init_fwhms = np.clip(widths_pts * step_deg, max(1.5 * step_deg, 0.03), 3.5)

    # Group overlapping peaks (separation < 2.2 * mean initial FWHM)
    clusters: list[list[int]] = []
    for k in range(len(cand_idx)):
        if not clusters:
            clusters.append([k])
        else:
            prev_k = clusters[-1][-1]
            sep_deg = float(x[cand_idx[k]] - x[cand_idx[prev_k]])
            thresh_deg = 2.2 * 0.5 * float(init_fwhms[k] + init_fwhms[prev_k])
            if sep_deg < max(thresh_deg, 0.28):
                clusters[-1].append(k)
            else:
                clusters.append([k])

    peaks_out: list[dict[str, Any]] = []
    q_max_raw = max(float(np.max(y_quant)), 1e-9)

    for cluster in clusters:
        is_overlap = len(cluster) > 1
        left_x = float(x[cand_idx[cluster[0]]]) - max(2.8 * float(init_fwhms[cluster[0]]), 0.45)
        right_x = float(x[cand_idx[cluster[-1]]]) + max(2.8 * float(init_fwhms[cluster[-1]]), 0.45)
        win_mask = (x >= left_x) & (x <= right_x)
        xw = x[win_mask]
        yw = y_quant[win_mask]

        fit_params_per_peak: list[tuple[float, float, float, float] | None] = [None] * len(cluster)
        cluster_r2 = 0.0

        if len(xw) >= 4 * len(cluster) + 2:
            try:
                if params.fit_profile == "pseudo_voigt":
                    # Per peak: (x0, h, w, eta) + linear local baseline offset c0
                    p0: list[float] = [0.0]
                    lb: list[float] = [-0.25 * q_max_raw]
                    ub: list[float] = [0.25 * q_max_raw]
                    for k in cluster:
                        cx0 = float(x[cand_idx[k]])
                        ch0 = max(float(y_quant[cand_idx[k]]), float(y_pos[cand_idx[k]]), 1e-3)
                        cw0 = float(init_fwhms[k])
                        p0.extend([cx0, ch0, cw0, 0.4])
                        lb.extend([cx0 - max(0.35, cw0), 0.0, max(0.7 * step_deg, 0.015), 0.0])
                        ub.extend([cx0 + max(0.35, cw0), ch0 * 2.5 + q_max_raw * 0.2, 6.0, 1.0])

                    def _multi_pv(xv: np.ndarray, *pars: float) -> np.ndarray:
                        out = np.full_like(xv, pars[0], dtype=float)
                        for m in range((len(pars) - 1) // 4):
                            base = 1 + 4 * m
                            out += _pvoigt(xv, pars[base], pars[base + 1], pars[base + 2], pars[base + 3])
                        return out

                    popt, _ = curve_fit(_multi_pv, xw, yw, p0=p0, bounds=(lb, ub), maxfev=6000)
                    pred = _multi_pv(xw, *popt)
                    ss_res = float(np.sum((yw - pred) ** 2))
                    ss_tot = float(np.sum((yw - np.mean(yw)) ** 2)) or 1.0
                    cluster_r2 = 1.0 - ss_res / ss_tot
                    for m in range(len(cluster)):
                        base = 1 + 4 * m
                        fit_params_per_peak[m] = (
                            float(popt[base]),
                            float(popt[base + 1]),
                            float(popt[base + 2]),
                            float(popt[base + 3]),
                        )
                else:
                    fixed_eta = 0.0 if params.fit_profile == "gaussian" else 1.0
                    p0 = [0.0]
                    lb = [-0.25 * q_max_raw]
                    ub = [0.25 * q_max_raw]
                    for k in cluster:
                        cx0 = float(x[cand_idx[k]])
                        ch0 = max(float(y_quant[cand_idx[k]]), float(y_pos[cand_idx[k]]), 1e-3)
                        cw0 = float(init_fwhms[k])
                        p0.extend([cx0, ch0, cw0])
                        lb.extend([cx0 - max(0.35, cw0), 0.0, max(0.7 * step_deg, 0.015)])
                        ub.extend([cx0 + max(0.35, cw0), ch0 * 2.5 + q_max_raw * 0.2, 6.0])

                    def _multi_gl(xv: np.ndarray, *pars: float) -> np.ndarray:
                        out = np.full_like(xv, pars[0], dtype=float)
                        for m in range((len(pars) - 1) // 3):
                            base = 1 + 3 * m
                            out += _pvoigt(xv, pars[base], pars[base + 1], pars[base + 2], fixed_eta)
                        return out

                    popt, _ = curve_fit(_multi_gl, xw, yw, p0=p0, bounds=(lb, ub), maxfev=5000)
                    pred = _multi_gl(xw, *popt)
                    ss_res = float(np.sum((yw - pred) ** 2))
                    ss_tot = float(np.sum((yw - np.mean(yw)) ** 2)) or 1.0
                    cluster_r2 = 1.0 - ss_res / ss_tot
                    for m in range(len(cluster)):
                        base = 1 + 3 * m
                        fit_params_per_peak[m] = (
                            float(popt[base]),
                            float(popt[base + 1]),
                            float(popt[base + 2]),
                            fixed_eta,
                        )
            except Exception:
                fit_params_per_peak = [None] * len(cluster)

        for m, k in enumerate(cluster):
            pid = f"P{len(peaks_out) + 1}"
            raw_pos = float(x[cand_idx[k]])
            raw_height = max(float(y_quant[cand_idx[k]]), 0.0)
            fp = fit_params_per_peak[m]

            if fp is not None and cluster_r2 >= 0.40 and 0.016 <= fp[2] <= 5.8 and fp[1] > 0:
                pos, h_fit, fwhm_fit, eta_fit = fp
                snr = float(h_fit / noise_sigma)
                area = _analytic_area(h_fit, fwhm_fit, eta_fit)
                if is_overlap:
                    fit_status = "overlapping"
                    status_label = "겹침 피크 (다중 프로파일 분리 피팅)"
                elif snr < 6.0:
                    fit_status = "low_snr"
                    status_label = "낮은 신호 품질 (SNR < 6)"
                else:
                    fit_status = "ok"
                    status_label = "정상 피팅"
                peaks_out.append(
                    {
                        "peak_id": pid,
                        "two_theta": round(pos, 4),
                        "height": round(h_fit, 2),
                        "area": round(area, 2),
                        "fwhm_deg": round(fwhm_fit, 4),
                        "eta": round(eta_fit, 3),
                        "fit_r2": round(cluster_r2, 4),
                        "snr": round(snr, 1),
                        "is_overlapping": is_overlap,
                        "fit_status": fit_status,
                        "status_label": status_label,
                        "user_excluded": pid in set(params.excluded_peak_ids),
                    }
                )
            else:
                # Fitting failed -> DO NOT substitute 0 or fake FWHM!
                snr = float(raw_height / noise_sigma)
                peaks_out.append(
                    {
                        "peak_id": pid,
                        "two_theta": round(raw_pos, 4),
                        "height": round(raw_height, 2),
                        "area": None,
                        "fwhm_deg": None,
                        "eta": None,
                        "fit_r2": round(cluster_r2, 4) if cluster_r2 else None,
                        "snr": round(snr, 1),
                        "is_overlapping": is_overlap,
                        "fit_status": "fit_failed",
                        "status_label": "피팅 실패 (수렴 불가 또는 비물리적 폭 — 선폭 계산 제외)",
                        "user_excluded": pid in set(params.excluded_peak_ids),
                    }
                )

    # Compute relative intensity (%) and d-spacing (Å)
    active_heights = [p["height"] for p in peaks_out if not p["user_excluded"] and p["height"] is not None]
    max_h = max(active_heights) if active_heights else max((p["height"] or 1.0 for p in peaks_out), default=1.0)
    max_h = max(max_h, 1e-9)

    for p in peaks_out:
        th_rad = math.radians(p["two_theta"] / 2.0)
        d_val = params.wavelength_angstrom / (2.0 * max(math.sin(th_rad), 1e-6))
        p["d_spacing_A"] = round(d_val, 4)
        p["rel_intensity_pct"] = round(100.0 * float(p["height"]) / max_h, 1)

    return peaks_out, noise_sigma


# ---------------- Phase Candidate Matching & Multi-Phase ---------------- #
def _score_single_candidate(
    meas_x: np.ndarray,
    meas_rel_I: np.ndarray,
    peak_ids: list[str],
    ref_x: np.ndarray,
    ref_I: np.ndarray,
    ref_hkls: list[str],
    tol_deg: float,
    shift_deg: float,
) -> dict[str, Any]:
    """Evaluate documented Match Score S in [0, 100]:
    S = 100 * (0.50 * C_ref + 0.30 * C_meas + 0.20 * S_int)
    - C_ref: intensity-weighted reference peak coverage with linear angular error weight (1 - 0.5*|Δ2θ|/tol)
    - C_meas: fraction of measured peak intensity sum explained within tolerance
    - S_int: cosine similarity between matched measured relative intensities and reference intensities
    """
    rx_shifted = ref_x + shift_deg
    total_ref_w = float(np.sum(ref_I)) or 1.0
    matched_ref_w = 0.0
    explained_meas = np.zeros(len(meas_x), dtype=bool)
    matched_pairs: list[dict[str, Any]] = []
    unmatched_ref: list[dict[str, Any]] = []
    vec_m: list[float] = []
    vec_r: list[float] = []

    for r_pos_s, r_pos_0, r_int, r_hkl in zip(rx_shifted, ref_x, ref_I, ref_hkls):
        if len(meas_x) == 0:
            unmatched_ref.append({"two_theta": round(float(r_pos_0), 3), "intensity": round(float(r_int), 1), "hkl": r_hkl})
            continue
        j = int(np.argmin(np.abs(meas_x - r_pos_s)))
        err = abs(float(meas_x[j] - r_pos_s))
        if err <= tol_deg:
            pos_factor = 1.0 - 0.5 * (err / max(tol_deg, 1e-6))
            matched_ref_w += float(r_int) * pos_factor
            explained_meas[j] = True
            vec_m.append(float(meas_rel_I[j]))
            vec_r.append(float(r_int))
            matched_pairs.append(
                {
                    "peak_id": peak_ids[j],
                    "meas_two_theta": round(float(meas_x[j]), 4),
                    "ref_two_theta": round(float(r_pos_0), 4),
                    "shifted_ref_two_theta": round(float(r_pos_s), 4),
                    "delta_two_theta": round(float(meas_x[j] - r_pos_s), 4),
                    "meas_rel_intensity": round(float(meas_rel_I[j]), 1),
                    "ref_intensity": round(float(r_int), 1),
                    "hkl": r_hkl,
                }
            )
        else:
            unmatched_ref.append({"two_theta": round(float(r_pos_0), 3), "intensity": round(float(r_int), 1), "hkl": r_hkl})

    c_ref = matched_ref_w / total_ref_w
    total_meas_w = float(np.sum(meas_rel_I)) or 1.0
    c_meas = float(np.sum(meas_rel_I[explained_meas])) / total_meas_w

    if len(vec_m) >= 2:
        vm = np.asarray(vec_m, dtype=float)
        vr = np.asarray(vec_r, dtype=float)
        denom = float(np.linalg.norm(vm) * np.linalg.norm(vr))
        s_int = float(np.dot(vm, vr) / denom) if denom > 0 else 0.0
    elif len(vec_m) == 1:
        s_int = 0.65
    else:
        s_int = 0.0

    score = 100.0 * (0.50 * c_ref + 0.30 * c_meas + 0.20 * s_int)
    mean_err = float(np.mean([ abs(p["delta_two_theta"]) for p in matched_pairs ])) if matched_pairs else tol_deg
    unexplained_ids = [peak_ids[i] for i in range(len(meas_x)) if not explained_meas[i]]

    return {
        "score": round(score, 1),
        "c_ref": round(c_ref, 3),
        "c_meas": round(c_meas, 3),
        "s_int": round(s_int, 3),
        "shift_deg": round(shift_deg, 3),
        "mean_abs_delta_deg": round(mean_err, 4),
        "matched_peaks": matched_pairs,
        "unmatched_ref_peaks": unmatched_ref[:15],
        "explained_peak_ids": [peak_ids[i] for i in range(len(meas_x)) if explained_meas[i]],
        "unexplained_peak_ids": unexplained_ids,
    }


# ---------------- Composition-Guided XRD Parsing & Scoring ---------------- #
KNOWN_ELEMENTS = {
    "H","He","Li","Be","B","C","N","O","F","Ne","Na","Mg","Al","Si","P","S","Cl","Ar",
    "K","Ca","Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Ga","Ge","As","Se","Br","Kr",
    "Rb","Sr","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd","In","Sn","Sb","Te","I","Xe",
    "Cs","Ba","La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu",
    "Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg","Tl","Pb","Bi","Po","At","Rn","Fr","Ra","Ac",
    "Th","Pa","U"
}


def parse_elements_from_formula(f: str) -> dict[str, float]:
    """Parse elemental stoichiometric ratios from a chemical formula (e.g. Nb0.8Ti0.2FeSb -> {Nb: 0.8, Ti: 0.2, Fe: 1.0, Sb: 1.0})."""
    clean = re.sub(r"[^A-Za-z0-9.]", "", f.strip())
    tokens = re.findall(r"([A-Z][a-z]?)(\d*(?:\.\d+)?)?", clean)
    elems: dict[str, float] = {}
    for el, count in tokens:
        if el in KNOWN_ELEMENTS:
            cnt = float(count) if count else 1.0
            elems[el] = elems.get(el, 0.0) + cnt
    return elems


def parse_sample_composition_context(
    sample_description: str | None,
    sample_name: str | None,
    expected_formula: str | None,
    expected_elements: list[str] | None,
) -> dict[str, Any]:
    """Extract chemical stoichiometry, solid-solution dopants, target phases, and process hints from sample metadata."""
    combined_text = " ".join(filter(None, [sample_name, expected_formula, sample_description]))
    formula_matches = re.findall(
        r"(?<![A-Za-z0-9])(?:\(?[A-Z][a-z]?(?:\d+(?:\.\d+)?)?\)?){2,}(?![A-Za-z0-9])", combined_text
    )

    extracted_formulas: list[str] = []
    extracted_elements: set[str] = set(expected_elements or [])
    formula_stoichiometries: list[dict[str, Any]] = []

    for raw_fm in formula_matches:
        fm = raw_fm.strip("()")
        elems = parse_elements_from_formula(fm)
        if len(elems) >= 2:
            extracted_formulas.append(fm)
            extracted_elements.update(elems.keys())
            formula_stoichiometries.append({"formula": fm, "elements": elems})

    nominal_formula = None
    target_primary_phases: list[str] = []
    secondary_phases: list[str] = []
    doping_notes: list[str] = []

    for fs in formula_stoichiometries:
        has_fractions = any(abs(v - round(v)) > 1e-4 for v in fs["elements"].values())
        if has_fractions:
            nominal_formula = fs["formula"]
            sub_candidates = [el for el, cnt in fs["elements"].items() if cnt < 0.99]
            if len(sub_candidates) >= 2:
                doping_notes.append(f"{sub_candidates[0]}-{sub_candidates[1]} 치환 고용체")
            elif sub_candidates:
                doping_notes.append(f"{sub_candidates[0]} 부분 치환/도핑")
            break

    if not nominal_formula and formula_stoichiometries:
        formula_stoichiometries.sort(key=lambda s: len(s["elements"]), reverse=True)
        nominal_formula = formula_stoichiometries[0]["formula"]

    if sample_name and sample_name.strip():
        target_primary_phases.append(sample_name.strip())
    if expected_formula and expected_formula.strip():
        target_primary_phases.append(expected_formula.strip())

    if nominal_formula:
        elems_nom = parse_elements_from_formula(nominal_formula)
        frac_elems = [el for el, cnt in elems_nom.items() if abs(cnt - round(cnt)) > 1e-4]
        int_elems = [el for el, cnt in elems_nom.items() if abs(cnt - round(cnt)) <= 1e-4]
        if frac_elems and int_elems:
            for fe in frac_elems:
                target_primary_phases.append(fe + "".join(int_elems))
        else:
            target_primary_phases.append(nominal_formula)

    for fm in extracted_formulas:
        if fm == nominal_formula or fm in target_primary_phases:
            continue
        secondary_phases.append(fm)

    desc_lower = (sample_description or "").lower()
    process_hints: list[str] = []
    if any(k in combined_text or k in desc_lower for k in ["아크", "arc"]):
        process_hints.append("아크 용해(Arc Melting)")
    if any(k in combined_text or k in desc_lower for k in ["열처리", "furnace", "anneal", "박스", "box"]):
        process_hints.append("고온 균질화 열처리(Annealing)")
    if any(k in combined_text or k in desc_lower for k in ["소결", "sps", "sinter"]):
        process_hints.append("가압 소결(Sintering)")

    return {
        "combined_text": combined_text,
        "extracted_elements": sorted(extracted_elements),
        "nominal_formula": nominal_formula,
        "target_primary_phases": list(dict.fromkeys(target_primary_phases)),
        "secondary_phases": list(dict.fromkeys(secondary_phases)),
        "doping_notes": doping_notes,
        "process_hints": process_hints,
    }


def match_phase_candidates(
    x: np.ndarray,
    y_quant: np.ndarray,
    peaks: list[dict[str, Any]],
    ref_entries: list[dict[str, Any]],
    params: XRDParams,
    expected_elements: list[str],
    sample_name: str | None = None,
    sample_description: str | None = None,
    expected_formula: str | None = None,
) -> dict[str, Any]:
    active_peaks = [p for p in peaks if not p["user_excluded"]]
    x_min, x_max = float(x.min()), float(x.max())

    comp_ctx = parse_sample_composition_context(
        sample_description=sample_description,
        sample_name=sample_name,
        expected_formula=expected_formula,
        expected_elements=expected_elements,
    )

    score_formula_doc = (
        "S = 100 × (0.50·C_ref + 0.30·C_meas + 0.20·S_int) + S_comp. "
        "C_ref: 각도 오차 가중 기준 피크 재현율, C_meas: 실측 피크 강도 설명 비율, S_int: 일치 피크 상대강도 코사인 유사도, "
        "S_comp: 시료 설명 명목 조성·타겟 주상 부합 보너스 (최대 12점). "
        "주의: 이 점수는 제한된 기준 라이브러리 내 상대적 패턴 부합도이며 정답 확률(%)이 아닙니다."
    )

    if not active_peaks:
        return {
            "status": "계산 불가",
            "reason": "유효한 검출 피크가 없어 상 후보 매칭을 수행할 수 없습니다.",
            "score_formula": score_formula_doc,
            "library_scope_notice": f"총 {len(ref_entries)}종 기준 패턴 범위",
            "element_filter_applied": False,
            "candidates": [],
            "multiphase_comparison": None,
            "composition_guidance": {
                "has_guidance": False,
                "nominal_formula": comp_ctx.get("nominal_formula"),
            },
        }

    meas_x = np.asarray([p["two_theta"] for p in active_peaks], dtype=float)
    meas_I = np.asarray([p["rel_intensity_pct"] for p in active_peaks], dtype=float)
    peak_ids = [p["peak_id"] for p in active_peaks]

    clean_elems = {el.strip() for el in expected_elements if el.strip()} | set(comp_ctx["extracted_elements"])
    use_elem = bool(params.use_element_filter and clean_elems)

    shifts = np.linspace(-params.max_shift_deg, params.max_shift_deg, max(1, int(round(2 * params.max_shift_deg / 0.02)) + 1))

    evaluated: list[dict[str, Any]] = []
    filtered_count = 0
    excluded_by_ehull_count = 0

    target_formulas_norm = {f.replace(" ", "").upper() for f in comp_ctx["target_primary_phases"] if f}
    sec_formulas_norm = {f.replace(" ", "").upper() for f in comp_ctx["secondary_phases"] if f}
    nom_formula = comp_ctx.get("nominal_formula")

    for raw_entry in ref_entries:
        entry = enrich_entry_with_mp_properties(raw_entry)
        if use_elem and not entry.get("is_user_cif", False):
            if not set(entry["elements"]).issubset(clean_elems):
                continue
        e_hull_val = entry.get("e_hull_ev")
        if (
            not entry.get("is_user_cif", False)
            and e_hull_val is not None
            and float(e_hull_val) > float(params.max_e_hull_ev)
        ):
            excluded_by_ehull_count += 1
            continue
        filtered_count += 1
        rx, rI, rhkl, rd = project_pattern_to_wavelength(entry, params.wavelength_angstrom)
        in_win = (rx >= x_min - params.match_tol_deg) & (rx <= x_max + params.match_tol_deg) & (rI >= 3.0)
        if int(np.sum(in_win)) == 0:
            continue
        rx_w = rx[in_win]
        rI_w = rI[in_win]
        rhkl_w = [rhkl[i] for i in np.where(in_win)[0]]
        rd_w = rd[in_win]

        best_eval = None
        for sh in shifts:
            ev = _score_single_candidate(meas_x, meas_I, peak_ids, rx_w, rI_w, rhkl_w, params.match_tol_deg, float(sh))
            if best_eval is None or ev["score"] > best_eval["score"]:
                best_eval = ev
        assert best_eval is not None
        if best_eval["score"] <= 0.0:
            continue

        base_score = best_eval["score"]
        cand_form_norm = entry["formula"].replace(" ", "").upper()
        cand_elems = set(entry.get("elements", []))

        # Check composition alignment
        is_nominal_target = (
            cand_form_norm in target_formulas_norm
            or (nom_formula and cand_form_norm == nom_formula.replace(" ", "").upper())
            or (sample_name and cand_form_norm == sample_name.replace(" ", "").upper())
        )
        is_suspected_secondary = (
            cand_form_norm in sec_formulas_norm
            or (len(cand_elems) == 2 and cand_elems.issubset(clean_elems))
        )

        score_boost = 0.0
        if base_score >= 20.0:
            if is_nominal_target:
                score_boost = 12.0
                comp_role = f"시료 설명 명목 목표 주상 ({entry['formula']})"
                comp_note = f"시료 설명에 기재된 명목 목표 조성({nom_formula or entry['formula']})의 결정구조와 정합합니다."
                target_badge = "목표 주상 부합"
            elif is_suspected_secondary:
                score_boost = 5.0
                comp_role = f"시료 설명 및 공정 관련 이차상 ({entry['formula']})"
                hints_str = ", ".join(comp_ctx.get("process_hints", [])) or "열처리/소결"
                comp_note = f"시료 설명 및 공정 이력({hints_str})에서 석출 가능한 이차상 후보입니다."
                target_badge = "이차상 후보"
            else:
                comp_role = "원소계 공존 상 후보"
                comp_note = f"원소계({'-'.join(sorted(cand_elems))}) 내 열역학적 후보상입니다."
                target_badge = None
        else:
            comp_role = "미정합 상"
            comp_note = "회절 패턴 일치도가 낮습니다."
            target_badge = None

        composite_score = round(min(99.5, base_score + score_boost), 1)

        evaluated.append(
            {
                "phase_id": entry["id"],
                "mp_id": entry.get("mp_id"),
                "name": entry["name"],
                "formula": entry["formula"],
                "spacegroup": entry["spacegroup"],
                "category": entry["category"],
                "source": entry["source"],
                "is_user_cif": bool(entry.get("is_user_cif", False)),
                "is_mp_live": bool(entry.get("is_mp_live", False)),
                "elements": entry["elements"],
                "e_hull_ev": entry.get("e_hull_ev"),
                "formation_energy_ev": entry.get("formation_energy_ev"),
                "stability_tier": entry.get("stability_tier", "unknown"),
                "stability_badge": entry.get("stability_badge", "사용자/문헌 구조"),
                "density_g_cm3": entry.get("density_g_cm3"),
                "band_gap_ev": entry.get("band_gap_ev"),
                "is_metal": entry.get("is_metal"),
                "electronic_label": entry.get("electronic_label"),
                "z_bse_eff": entry.get("z_bse_eff"),
                "dft_lattice_note": entry.get("dft_lattice_note"),
                "search_wavelength_A": params.wavelength_angstrom,
                "search_two_theta_range": [round(x_min, 2), round(x_max, 2)],
                "ref_stick_two_theta": [round(float(v), 4) for v in rx_w],
                "ref_stick_intensity": [round(float(v), 2) for v in rI_w],
                "ref_stick_hkl": rhkl_w,
                "ref_stick_d_A": [round(float(v), 4) for v in rd_w],
                "is_nominal_target": is_nominal_target,
                "is_suspected_secondary": is_suspected_secondary,
                "composition_role": comp_role,
                "composition_note": comp_note,
                "target_badge": target_badge,
                "base_score": best_eval["score"],
                "composition_boost": score_boost,
                **best_eval,
                "score": composite_score,
            }
        )

    evaluated.sort(key=lambda c: c["score"], reverse=True)
    top_candidates = evaluated[:8]

    # Annotate primary/secondary phase attribution onto peaks with composition context
    primary = top_candidates[0] if (top_candidates and top_candidates[0]["score"] >= 35.0) else None
    primary_map = {m["peak_id"]: (primary["name"], m["hkl"]) for m in (primary["matched_peaks"] if primary else [])}

    for p in peaks:
        if p["peak_id"] in primary_map:
            p_hkl = primary_map[p["peak_id"]][1]
            p["assigned_phase"] = primary_map[p["peak_id"]][0]
            p["assigned_hkl"] = p_hkl
            p["composition_role"] = primary.get("composition_role", "목표 주상")
            p["composition_explanation"] = (
                f"{p_hkl} 주 회절선으로, 시료 설명의 명목 조성({nom_formula or primary['formula']}) "
                f"주상 구조({primary['name']})에 직접 귀속됩니다 (Δ2θ={primary['shift_deg']:+.2f}°)."
            )
        else:
            p["assigned_phase"] = None
            p["assigned_hkl"] = None
            p["composition_role"] = "미설명 미소 피크"
            p["composition_explanation"] = "주상 기준선과 일치하지 않는 미소 피크입니다."

    # Extension: Multi-phase combination residual comparison (Single vs 2-phase NNLS envelope)
    multiphase_result = None
    if params.enable_multiphase and len(top_candidates) >= 2 and primary is not None:
        y_pos = np.clip(y_quant, 0.0, None)
        norm_y = float(np.linalg.norm(y_pos)) or 1.0
        # Estimate median FWHM for synthetic profile basis
        valid_w = [p["fwhm_deg"] for p in active_peaks if p["fwhm_deg"] is not None]
        basis_w = float(np.median(valid_w)) if valid_w else 0.30

        def _synth_basis(cand: dict[str, Any]) -> np.ndarray:
            prof = np.zeros_like(x, dtype=float)
            sh = cand["shift_deg"]
            for t0, ri in zip(cand["ref_stick_two_theta"], cand["ref_stick_intensity"]):
                prof += _pvoigt(x, t0 + sh, ri, basis_w, 0.35)
            mx = float(np.max(prof))
            return prof / mx if mx > 0 else prof

        b0 = _synth_basis(primary)
        coef_single, _ = nnls(b0[:, None], y_pos)
        res_single = float(np.linalg.norm(y_pos - b0 * coef_single[0]) / norm_y)
        unexp_single = set(primary["unexplained_peak_ids"])
        unexp_single_int_pct = round(
            100.0 * sum(p["rel_intensity_pct"] for p in active_peaks if p["peak_id"] in unexp_single) / ( float(np.sum(meas_I)) or 1.0 ),
            1,
        )

        combos = []
        for sec in top_candidates[1:6]:
            if sec["phase_id"] == primary["phase_id"]:
                continue
            newly_explained = [pid for pid in sec["explained_peak_ids"] if pid in unexp_single]
            b1 = _synth_basis(sec)
            A = np.column_stack([b0, b1])
            coefs, _ = nnls(A, y_pos)
            pred_pair = A @ coefs
            res_pair = float(np.linalg.norm(y_pos - pred_pair) / norm_y)
            combined_explained = set(primary["explained_peak_ids"]) | set(sec["explained_peak_ids"])
            still_unexplained = [p["peak_id"] for p in active_peaks if p["peak_id"] not in combined_explained]
            still_unexp_pct = round(
                100.0 * sum(p["rel_intensity_pct"] for p in active_peaks if p["peak_id"] in still_unexplained) / (float(np.sum(meas_I)) or 1.0),
                1,
            )
            c_sum = float(coefs[0] + coefs[1]) or 1.0
            combos.append(
                {
                    "phases": [primary["name"], sec["name"]],
                    "phase_ids": [primary["phase_id"], sec["phase_id"]],
                    "residual_r_pat": round(res_pair, 4),
                    "residual_reduction_pct": round(100.0 * (res_single - res_pair) / max(res_single, 1e-6), 1),
                    "newly_explained_peaks": newly_explained,
                    "remaining_unexplained_peaks": still_unexplained,
                    "remaining_unexplained_intensity_pct": still_unexp_pct,
                    "pattern_scale_share_pct": [round(100.0 * float(coefs[0]) / c_sum, 1), round(100.0 * float(coefs[1]) / c_sum, 1)],
                    "composition_relevance": sec.get("composition_role", "이차상"),
                }
            )
        combos.sort(key=lambda c: (len(c["remaining_unexplained_peaks"]), c["residual_r_pat"]))
        best_combo = combos[0] if combos else None

        # Also assign secondary phase peaks if a secondary phase explains remaining peaks meaningfully
        if best_combo and best_combo["newly_explained_peaks"] and best_combo["residual_reduction_pct"] >= 3.0:
            sec_cand = next((c for c in top_candidates if c["phase_id"] == best_combo["phase_ids"][1]), None)
            if sec_cand:
                sec_map = {m["peak_id"]: m["hkl"] for m in sec_cand["matched_peaks"]}
                for p in peaks:
                    if p["peak_id"] in best_combo["newly_explained_peaks"] and p["assigned_phase"] is None:
                        sec_hkl = sec_map.get(p["peak_id"])
                        p["assigned_phase"] = sec_cand["name"]
                        p["assigned_hkl"] = sec_hkl
                        p["composition_role"] = sec_cand.get("composition_role", "이차상 석출")
                        p["composition_explanation"] = (
                            f"{sec_hkl} 회절선으로, 시료 설명의 공정 조건({', '.join(comp_ctx.get('process_hints', [])) or '열처리'})에서 "
                            f"석출 가능한 이차상 {sec_cand['formula']} 피크에 부합합니다."
                        )

        multiphase_result = {
            "single_phase_baseline": {
                "phase": primary["name"],
                "residual_r_pat": round(res_single, 4),
                "unexplained_peaks": list(unexp_single),
                "unexplained_intensity_pct": unexp_single_int_pct,
            },
            "combinations": combos[:3],
            "mass_fraction_disclaimer": (
                "주의: 패턴 스케일 기여율(%)은 RIR(Reference Intensity Ratio) 및 미소흡수 보정이 적용되지 않은 "
                "단순 회절 프로파일 피팅 계수 비율이며, 상의 실제 질량분율(wt%)을 뜻하지 않습니다."
            ),
        }

    status = "분석 완료" if (primary and primary["score"] >= 50.0) else "확인 필요"
    reason = (
        f"내장/업로드 기준 패턴 {filtered_count}종 중 상위 후보를 비교했습니다."
        if top_candidates
        else "현재 원소 필터 또는 각도 범위 내에서 일치하는 기준 상 후보를 찾지 못했습니다."
    )

    # Construct rich composition-guided summary
    dop_str = f"조성 내 {', '.join(comp_ctx['doping_notes'])}으로 인한 피크 이동(Δ2θ={primary['shift_deg']:+.3f}°)이 관찰되었습니다. " if comp_ctx.get("doping_notes") and primary else ""
    proc_str = f"공정 이력({', '.join(comp_ctx['process_hints'])})에 따른 잔여 미소 피크는 이차상 후보와 대조 검토되었습니다." if primary and len(primary.get("unexplained_peak_ids", [])) > 0 else "미설명 피크 없이 단일상 패턴을 형성하였습니다."
    interp_guide = (
        f"시료 설명에 기재된 명목 조성({nom_formula or sample_name})을 바탕으로 XRD 피크를 해석한 결과, "
        f"총 {len(active_peaks)}개 피크 중 {len(primary.get('matched_peaks', []))}개의 주 피크가 목표 주상인 "
        f"{primary['name']} [{primary['spacegroup']}]에 명확히 부합합니다. {dop_str}{proc_str}"
    ) if primary else "시료 설명 조성에 부합하는 주상을 확정하지 못했습니다."

    composition_guidance = {
        "has_guidance": bool(nom_formula or comp_ctx["target_primary_phases"]),
        "nominal_formula": nom_formula,
        "target_primary_phases": comp_ctx["target_primary_phases"],
        "secondary_phases": comp_ctx["secondary_phases"],
        "doping_notes": comp_ctx["doping_notes"],
        "process_hints": comp_ctx["process_hints"],
        "primary_phase": primary["name"] if primary else None,
        "primary_formula": primary["formula"] if primary else None,
        "shift_deg": primary["shift_deg"] if primary else 0.0,
        "interpretation_guide": interp_guide,
    }

    return {
        "status": status,
        "reason": reason,
        "score_formula": score_formula_doc,
        "library_scope_notice": (
            f"이 결과는 현재 활성화된 기준 라이브러리({filtered_count}종 검색 / 전체 {len(ref_entries)}종, "
            f"E_hull ≤ {params.max_e_hull_ev:.2f} eV/atom 필터 제외 {excluded_by_ehull_count}종) 안에서의 상대 후보이며, "
            "라이브러리에 없는 미지상은 검출되지 않습니다."
        ),
        "element_filter_applied": use_elem,
        "expected_elements": sorted(clean_elems),
        "max_e_hull_ev": params.max_e_hull_ev,
        "excluded_by_ehull_count": excluded_by_ehull_count,
        "candidates": top_candidates,
        "multiphase_comparison": multiphase_result,
        "composition_guidance": composition_guidance,
    }


# ---------------- Conditional Scherrer Analysis ---------------- #
def compute_scherrer(peaks: list[dict[str, Any]], params: XRDParams) -> dict[str, Any]:
    """Conditional Scherrer crystallite size estimation: D = K * λ / (β * cosθ)."""
    inst_provided = params.inst_fwhm_deg is not None and params.inst_fwhm_deg > 0.0
    inst_deg = float(params.inst_fwhm_deg) if inst_provided else 0.0
    beta_inst_rad = math.radians(inst_deg)

    per_peak: list[dict[str, Any]] = []
    used_sizes: list[float] = []

    for p in peaks:
        pid = p["peak_id"]
        tt = float(p["two_theta"])
        theta_rad = math.radians(tt / 2.0)
        fwhm_obs = p["fwhm_deg"]
        eta = float(p["eta"]) if p["eta"] is not None else (0.0 if params.fit_profile == "gaussian" else 1.0)

        excl_reason: str | None = None
        if p["user_excluded"]:
            excl_reason = "사용자 제외 피크"
        elif p["fit_status"] == "fit_failed" or fwhm_obs is None:
            excl_reason = "피크 프로파일 피팅 실패"
        elif p["is_overlapping"]:
            excl_reason = "인접 피크 겹침으로 단일 선폭 분리 불확실"
        elif (p["snr"] or 0.0) < 6.0:
            excl_reason = f"낮은 신호 대 잡음비 (SNR={p['snr']} < 6.0)"
        elif tt > 65.0:
            excl_reason = "고각 영역 (2θ > 65°: Kα1/Kα2 이중선 및 미세변형 기여 증가)"
        elif inst_provided and fwhm_obs <= inst_deg * 1.05:
            excl_reason = f"관측 FWHM({fwhm_obs:.4f}°) ≤ 1.05×기기 선폭({inst_deg:.4f}°) — 분해능 한계"

        beta_corr_rad: float | None = None
        d_nm: float | None = None

        if excl_reason is None and fwhm_obs is not None:
            beta_obs_rad = math.radians(float(fwhm_obs))
            if inst_provided:
                b_gauss = math.sqrt(max(beta_obs_rad**2 - beta_inst_rad**2, 0.0))
                b_lor = max(beta_obs_rad - beta_inst_rad, 0.0)
                beta_corr_rad = (1.0 - eta) * b_gauss + eta * b_lor
            else:
                beta_corr_rad = beta_obs_rad

            if beta_corr_rad <= 1e-5:
                excl_reason = "유효 선폭(β)이 너무 작아 Scherrer 적용 상한 초과"
            else:
                # λ (Å) -> nm is λ / 10.0
                cand_d = (params.scherrer_k * (params.wavelength_angstrom / 10.0)) / (beta_corr_rad * math.cos(theta_rad))
                if cand_d > 150.0:
                    excl_reason = f"추정 크기({cand_d:.0f} nm)가 Scherrer 유효 상한(~150 nm)을 초과"
                elif cand_d < 1.0:
                    excl_reason = "비정질 수준 과도한 선폭(>5°) — 결정자 크기 정의 부적합"
                else:
                    d_nm = round(cand_d, 1)
                    used_sizes.append(cand_d)

        per_peak.append(
            {
                "peak_id": pid,
                "two_theta": tt,
                "hkl": p.get("assigned_hkl"),
                "phase": p.get("assigned_phase"),
                "fwhm_obs_deg": fwhm_obs,
                "beta_rad": round(beta_corr_rad, 6) if beta_corr_rad is not None else None,
                "used": excl_reason is None and d_nm is not None,
                "crystallite_size_nm": d_nm,
                "exclusion_reason": excl_reason,
            }
        )

    assumptions = [
        f"형상 계수 K = {params.scherrer_k:.2f} (구형 등방성 결정자 가정)",
        f"사용 파장 λ = {params.wavelength_angstrom:.4f} Å ({params.wavelength_angstrom / 10.0:.5f} nm), 브래그 각 θ = 2θ / 2 적용",
        "격자 미세변형(microstrain), 적층 결함, 조성 구배에 의한 선폭 확장이 무시할 수 있다고 가정한 겉보기 크기입니다.",
        (
            f"기기 선폭 보정 적용됨 (FWHM_inst = {inst_deg:.4f}°, 프로파일: {params.fit_profile})"
            if inst_provided
            else "기기 선폭 미보정 추정값 (표준시료 기기 선폭 미입력 — 실제 결정자 크기는 표시된 값보다 클 수 있는 하한 추정치입니다)"
        ),
    ]

    if not used_sizes:
        return {
            "title": "결정자 크기 추정 (Scherrer)",
            "status": "계산 불가",
            "status_badge": "계산 불가",
            "instrument_correction_label": "기기 선폭 보정됨" if inst_provided else "기기 선폭 미보정 추정값",
            "is_instrument_corrected": inst_provided,
            "k_factor": params.scherrer_k,
            "wavelength_A": params.wavelength_angstrom,
            "inst_fwhm_deg": inst_deg if inst_provided else None,
            "n_used_peaks": 0,
            "mean_nm": None,
            "median_nm": None,
            "std_nm": None,
            "range_nm": None,
            "reason": "비겹침·고신호·적정 각도 조건을 만족하는 유효 피크가 없어 결정자 크기를 산출하지 않았습니다.",
            "assumptions": assumptions,
            "per_peak": per_peak,
        }

    arr = np.asarray(used_sizes, dtype=float)
    status = "분석 완료" if (inst_provided and params.wavelength_confirmed) else "확인 필요"
    reason = (
        f"유효 피크 {len(used_sizes)}개로부터 산출되었습니다."
        if inst_provided
        else f"유효 피크 {len(used_sizes)}개로부터 산출되었으나 기기 선폭이 보정되지 않은 추정값입니다."
    )

    return {
        "title": "결정자 크기 추정 (Scherrer)",
        "status": status,
        "status_badge": "보정 추정값" if inst_provided else "기기 선폭 미보정 추정값",
        "instrument_correction_label": "기기 선폭 보정 적용" if inst_provided else "기기 선폭 미보정 추정값",
        "is_instrument_corrected": inst_provided,
        "k_factor": params.scherrer_k,
        "wavelength_A": params.wavelength_angstrom,
        "inst_fwhm_deg": inst_deg if inst_provided else None,
        "n_used_peaks": int(len(used_sizes)),
        "mean_nm": round(float(np.mean(arr)), 1),
        "median_nm": round(float(np.median(arr)), 1),
        "std_nm": round(float(np.std(arr, ddof=1)), 1) if len(arr) >= 2 else 0.0,
        "range_nm": [round(float(np.min(arr)), 1), round(float(np.max(arr)), 1)],
        "reason": reason,
        "assumptions": assumptions,
        "per_peak": per_peak,
    }


# ---------------- Williamson-Hall Extension ---------------- #
def compute_williamson_hall(
    peaks: list[dict[str, Any]],
    scherrer_res: dict[str, Any],
    primary_phase_name: str | None,
    params: XRDParams,
) -> dict[str, Any]:
    """Uniform Deformation Model (UDM): β cosθ = Kλ/D + 4ε sinθ on peaks belonging to the same primary phase."""
    if not params.enable_williamson_hall:
        return {"enabled": False, "status": "비활성화", "reason": "Williamson–Hall 확장 분석이 비활성화되어 있습니다."}

    if not primary_phase_name:
        return {
            "enabled": True,
            "status": "계산 불가",
            "reason": "동일 상으로 귀속할 주 결정상 후보가 확인되지 않아 Williamson–Hall 회귀를 생략했습니다.",
            "phase_name": None,
            "n_peaks": 0,
            "crystallite_size_nm": None,
            "microstrain": None,
            "r2": None,
            "points": [],
        }

    sch_map = {r["peak_id"]: r for r in scherrer_res["per_peak"]}
    valid_pts: list[dict[str, Any]] = []

    for p in peaks:
        if p["user_excluded"] or p["fit_status"] == "fit_failed" or p["is_overlapping"] or (p["snr"] or 0.0) < 6.0:
            continue
        if p.get("assigned_phase") != primary_phase_name:
            continue
        sr = sch_map.get(p["peak_id"])
        if not sr or sr["beta_rad"] is None or sr["beta_rad"] <= 1e-5:
            continue
        theta_rad = math.radians(float(p["two_theta"]) / 2.0)
        xv = 4.0 * math.sin(theta_rad)
        yv = float(sr["beta_rad"]) * math.cos(theta_rad)
        valid_pts.append(
            {
                "peak_id": p["peak_id"],
                "two_theta": p["two_theta"],
                "hkl": p.get("assigned_hkl"),
                "x_4sin_theta": round(xv, 5),
                "y_beta_cos_theta": round(yv, 6),
            }
        )

    if len(valid_pts) < 3:
        return {
            "enabled": True,
            "status": "계산 불가",
            "reason": f"주 결정상({primary_phase_name})에 귀속된 비겹침 유효 피크가 {len(valid_pts)}개뿐입니다 (최소 3개 이상 필요).",
            "phase_name": primary_phase_name,
            "is_instrument_corrected": scherrer_res["is_instrument_corrected"],
            "n_peaks": len(valid_pts),
            "crystallite_size_nm": None,
            "microstrain": None,
            "r2": None,
            "points": valid_pts,
        }

    xs = np.asarray([pt["x_4sin_theta"] for pt in valid_pts], dtype=float)
    ys = np.asarray([pt["y_beta_cos_theta"] for pt in valid_pts], dtype=float)
    slope, intercept = np.polyfit(xs, ys, 1)
    pred = slope * xs + intercept
    ss_res = float(np.sum((ys - pred) ** 2))
    ss_tot = float(np.sum((ys - np.mean(ys)) ** 2)) or 1e-12
    r2 = 1.0 - ss_res / ss_tot

    limitations: list[str] = []
    if slope < 0:
        limitations.append("음의 회귀 기울기(ε < 0)가 관찰되어 물리적 미세변형률 정량값을 확정하지 않습니다 (결정학적 탄성 이방성 또는 기기 선폭 각도 의존성 가능성).")
        strain_val = None
    else:
        strain_val = round(float(slope), 6)

    if intercept <= 1e-6:
        limitations.append("회귀 직선의 y절편이 0 이하이므로 결정자 크기를 산출할 수 없습니다.")
        d_wh = None
    else:
        cand_d = (params.scherrer_k * (params.wavelength_angstrom / 10.0)) / float(intercept)
        if cand_d > 250.0:
            limitations.append(f"절편 기반 크기({cand_d:.0f} nm)가 선폭 분해능 상한을 초과하여 제한합니다.")
            d_wh = None
        else:
            d_wh = round(cand_d, 1)

    if r2 < 0.60:
        limitations.append(f"선형 회귀 적합도가 낮습니다 (R² = {r2:.3f} < 0.60). 등방성 변형 모델(UDM) 가정이 잘 맞지 않을 수 있습니다.")
    if len(valid_pts) == 3:
        limitations.append("피크 3개만으로 회귀하여 자유도가 낮습니다 (4개 이상 권장).")
    if not scherrer_res["is_instrument_corrected"]:
        limitations.append("기기 선폭 미보정 상태에서 계산되었습니다.")

    status = "분석 완료" if (not limitations and d_wh is not None and strain_val is not None) else "확인 필요"

    x_line = [round(float(xs.min()) * 0.9, 5), round(float(xs.max()) * 1.08, 5)]
    y_line = [round(float(slope * xl + intercept), 6) for xl in x_line]

    return {
        "enabled": True,
        "status": status,
        "phase_name": primary_phase_name,
        "model_assumption": "등방성 균일 변형 모델 (UDM: β cosθ = Kλ/D + 4ε sinθ, 결정 방향에 무관한 균일 미소변형 가정)",
        "is_instrument_corrected": scherrer_res["is_instrument_corrected"],
        "n_peaks": len(valid_pts),
        "crystallite_size_nm": d_wh,
        "microstrain": strain_val,
        "microstrain_pct": round(strain_val * 100.0, 4) if strain_val is not None else None,
        "raw_slope": round(float(slope), 6),
        "raw_intercept": round(float(intercept), 6),
        "r2": round(float(r2), 4),
        "regression_line": {"x": x_line, "y": y_line},
        "limitations": limitations,
        "reason": limitations[0] if limitations else f"{primary_phase_name} 귀속 피크 {len(valid_pts)}개로 선형 분리했습니다.",
        "points": valid_pts,
    }


# ---------------- Conditional Relative Crystallinity Index ---------------- #
def compute_relative_crystallinity(
    x: np.ndarray,
    y_raw: np.ndarray,
    y_bg: np.ndarray,
    y_quant: np.ndarray,
    params: XRDParams,
) -> dict[str, Any]:
    """Compute a strictly relative crystallinity index ONLY when sample family and separation method are explicitly defined."""
    cfg = params.crystallinity
    if not cfg.enabled:
        return {
            "enabled": False,
            "status": "미적용",
            "index_pct": None,
            "reason": "절대 결정화도의 오용을 막기 위해 기본적으로 비활성화되어 있습니다. 동일 시료군 비교 목적인 경우에만 시료군과 분리 모델을 지정해 활성화하세요.",
        }
    if not cfg.sample_family.strip():
        return {
            "enabled": True,
            "status": "계산 불가",
            "index_pct": None,
            "reason": "적용 시료군(예: 비정질 실리카 지지체 산화물, 반결정성 고분자 등)이 입력되지 않아 상대 결정성 지표를 계산하지 않았습니다.",
        }

    mask = (x >= cfg.two_theta_min) & (x <= cfg.two_theta_max)
    if int(np.sum(mask)) < 20:
        return {
            "enabled": True,
            "status": "계산 불가",
            "index_pct": None,
            "reason": "지정된 결정성 평가 2θ 구간 내 데이터 포인트가 부족합니다.",
        }

    xw = x[mask]
    yw = y_raw[mask]
    ycw = np.clip(y_quant[mask], 0.0, None)
    # Subtract linear air/incoherent scatter baseline connecting window endpoints
    base_lin = np.interp(xw, [xw[0], xw[-1]], [float(np.percentile(yw[:5], 20)), float(np.percentile(yw[-5:], 20))])
    total_coherent = np.clip(yw - base_lin, 0.0, None)
    area_total = float(np.trapezoid(total_coherent, xw))
    area_cryst = float(np.trapezoid(np.minimum(ycw, total_coherent), xw))

    if area_total <= 1e-6:
        return {
            "enabled": True,
            "status": "계산 불가",
            "index_pct": None,
            "reason": "지정 구간에서 유효 산란 면적이 확인되지 않습니다.",
        }

    rel_idx = round(100.0 * area_cryst / area_total, 1)
    return {
        "enabled": True,
        "status": "확인 필요",
        "index_pct": rel_idx,
        "sample_family": cfg.sample_family.strip(),
        "background_model": cfg.background_model,
        "separation_method": cfg.separation_method,
        "window_deg": [cfg.two_theta_min, cfg.two_theta_max],
        "disclaimer": (
            "이 수치는 절대 결정화도(wt% crystallinity)가 아니며, 지정된 시료군·2θ 구간·배경 분리 규칙 하에서 "
            "동일 장비 조건으로 측정된 시료 간 상대 비교에만 사용할 수 있는 상대 결정성 지표입니다."
        ),
    }


def run_xrd_pipeline(
    raw: bytes,
    params: XRDParams,
    ref_entries: list[dict[str, Any]],
    expected_elements: list[str],
    sample_name: str | None = None,
    sample_description: str | None = None,
    expected_formula: str | None = None,
) -> dict[str, Any]:
    parsed = inspect_and_parse_xrd(raw, params.col_two_theta, params.col_intensity)
    x_full = parsed["x"]
    y_full = parsed["y"]
    inspection = parsed["inspection"]

    t_min = params.two_theta_min if params.two_theta_min is not None else float(x_full.min())
    t_max = params.two_theta_max if params.two_theta_max is not None else float(x_full.max())
    win = (x_full >= t_min) & (x_full <= t_max)
    if int(np.sum(win)) < 15:
        raise ValueError(f"지정한 분석 각도 범위({t_min}°~{t_max}°) 내 데이터가 15개 미만입니다.")

    x = x_full[win]
    y_raw = y_full[win]
    step_deg = float(np.median(np.diff(x)))

    if inspection["is_constant_signal"] or float(np.ptp(y_raw)) <= 1e-9:
        return {
            "status": "계산 불가",
            "reason": "입력 XRD 데이터의 강도가 일정(상수 신호)하여 피크 검출 및 상 분석을 수행할 수 없습니다.",
            "inspection": inspection,
            "conditions": params.model_dump(),
            "series": {
                "two_theta": [round(float(v), 4) for v in x],
                "raw_intensity": [round(float(v), 2) for v in y_raw],
                "background": [round(float(v), 2) for v in y_raw],
                "corrected_unsmoothed": [0.0 for _ in x],
                "detection_smoothed": [0.0 for _ in x],
            },
            "peaks": [],
            "phase_matching": {
                "status": "계산 불가",
                "reason": "상수 신호로 인해 검출된 피크가 없습니다.",
                "candidates": [],
                "multiphase_comparison": None,
            },
            "scherrer": {
                "title": "결정자 크기 추정 (Scherrer)",
                "status": "계산 불가",
                "status_badge": "계산 불가",
                "is_instrument_corrected": False,
                "n_used_peaks": 0,
                "mean_nm": None,
                "median_nm": None,
                "std_nm": None,
                "range_nm": None,
                "reason": "상수 신호로 유효 피크가 없습니다.",
                "assumptions": [],
                "per_peak": [],
            },
            "williamson_hall": {"enabled": params.enable_williamson_hall, "status": "계산 불가", "reason": "유효 피크 없음"},
            "crystallinity": {"enabled": params.crystallinity.enabled, "status": "계산 불가", "index_pct": None},
        }

    # ALS baseline on raw intensity
    y_bg = als_baseline(y_raw, lam=params.als_lam, p=params.als_p)
    y_quant = y_raw - y_bg  # Unsmoothed quantitative signal!

    if params.use_smoothing:
        y_smooth = _smooth_for_detection(x, y_raw, params.smooth_window, params.smooth_polyorder, inspection["is_uniform_step"])
        y_detect = np.clip(y_smooth - y_bg, 0.0, None)
    else:
        y_smooth = y_raw.copy()
        y_detect = np.clip(y_quant, 0.0, None)

    peaks, noise_sigma = detect_and_fit_peaks(x, y_quant, y_detect, step_deg, params)

    # Materials Project live/cached structure expansion & thermodynamic enrichment
    merged_refs = [enrich_entry_with_mp_properties(e) for e in ref_entries]
    mp_sync_info: dict[str, Any] = {
        "mode": "curated_mp",
        "mp_api_configured": False,
        "fetched_count": 0,
        "message": "내장 Materials Project 검증 라이브러리 사용",
    }
    if params.use_mp_live and expected_elements:
        mp_fetch = fetch_mp_phases_for_elements(expected_elements, max_e_hull_ev=params.max_e_hull_ev)
        mp_sync_info = {
            "mode": mp_fetch.get("mode", "curated_mp"),
            "mp_api_configured": bool(mp_fetch.get("mp_api_configured", False)),
            "chemsys_queried": mp_fetch.get("chemsys_queried", []),
            "fetched_count": len(mp_fetch.get("entries", [])),
            "message": mp_fetch.get("message", ""),
        }
        existing_mp_ids = {e.get("mp_id") for e in merged_refs if e.get("mp_id")}
        existing_ids = {e.get("id") for e in merged_refs}
        for mp_e in mp_fetch.get("entries", []):
            if mp_e.get("mp_id") not in existing_mp_ids and mp_e.get("id") not in existing_ids:
                merged_refs.append(mp_e)
                existing_mp_ids.add(mp_e.get("mp_id"))
                existing_ids.add(mp_e.get("id"))

    phase_matching = match_phase_candidates(
        x,
        y_quant,
        peaks,
        merged_refs,
        params,
        expected_elements,
        sample_name=sample_name,
        sample_description=sample_description,
        expected_formula=expected_formula,
    )
    phase_diagram_bse = compute_phase_diagram_and_bse_analysis(
        merged_refs,
        expected_elements,
        phase_matching.get("candidates", []),
    )
    scherrer_res = compute_scherrer(peaks, params)
    primary_name = (
        phase_matching["candidates"][0]["name"]
        if (phase_matching["candidates"] and phase_matching["candidates"][0]["score"] >= 35.0)
        else None
    )
    wh_res = compute_williamson_hall(peaks, scherrer_res, primary_name, params)
    cryst_res = compute_relative_crystallinity(x, y_raw, y_bg, y_quant, params)

    # Downsample chart display arrays ONLY if huge (>6000 pts) to keep browser fast, preserving peak positions
    stride = max(1, len(x) // 5000)
    idx_plot = np.arange(0, len(x), stride)

    overall_status = "분석 완료"
    if not params.wavelength_confirmed or len(peaks) == 0 or phase_matching["status"] != "분석 완료":
        overall_status = "확인 필요"
    if len(peaks) == 0:
        overall_status = "계산 불가"

    return {
        "status": overall_status,
        "reason": (
            f"검출 피크 {len(peaks)}개 (활성 {sum(not p['user_excluded'] for p in peaks)}개)"
            if peaks
            else "현재 prominence/최소 높이 조건에서 검출된 피크가 없습니다. 임계값을 낮춰 다시 실행해보세요."
        ),
        "inspection": inspection,
        "conditions": {
            **params.model_dump(),
            "xray_presets": XRAY_PRESETS,
            "noise_sigma_est": round(noise_sigma, 3),
            "smoothing_separation_note": (
                "Savitzky–Golay 평활화 신호는 피크 위치 초기 탐지에만 사용되며, "
                "FWHM·적분면적·결정자 크기는 평활화하지 않은 원본 배경보정 데이터(y_raw - y_bg)에서 프로파일 피팅하여 선폭 왜곡을 방지했습니다."
            ),
        },
        "series": {
            "two_theta": [round(float(v), 4) for v in x[idx_plot]],
            "raw_intensity": [round(float(v), 2) for v in y_raw[idx_plot]],
            "background": [round(float(v), 2) for v in y_bg[idx_plot]],
            "corrected_unsmoothed": [round(float(v), 2) for v in np.clip(y_quant[idx_plot], 0.0, None)],
            "detection_smoothed": [round(float(v), 2) for v in y_detect[idx_plot]],
        },
        "peaks": peaks,
        "phase_matching": phase_matching,
        "phase_diagram_bse": phase_diagram_bse,
        "mp_sync_info": mp_sync_info,
        "scherrer": scherrer_res,
        "williamson_hall": wh_res,
        "crystallinity": cryst_res,
    }
