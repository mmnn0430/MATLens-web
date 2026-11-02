"""UTM (Universal Testing Machine) Raw Data Numerical Analysis Engine.

Performs robust parsing, unit conversions, feature extraction (UTS, yield/offset,
elastic modulus, fracture candidate, negative load detection), and rule-based reporting
without modifying any existing XRD/SEM structures.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Standard gravity conversion constant for kgf to N and kgf/mm^2 to MPa
KGF_TO_N = 9.80665
KGF_MM2_TO_MPA = 9.80665


@dataclass
class ColumnMapping:
    index_col: Optional[str] = None
    time_col: Optional[str] = None
    load_col: Optional[str] = None
    displacement_col: Optional[str] = None
    stress_col: Optional[str] = None
    strain_col: Optional[str] = None
    true_stress_col: Optional[str] = None
    true_strain_col: Optional[str] = None


@dataclass
class UnitMapping:
    time_unit: str = "sec"
    load_unit: str = "kgf"
    disp_unit: str = "mm"
    stress_unit: str = "kgf/mm²"
    strain_unit: str = "%"
    true_stress_unit: str = "kgf/mm²"
    true_strain_unit: str = "%"


def detect_encoding(content_bytes: bytes) -> str:
    """Detect UTF-8 vs CP949 / EUC-KR safely."""
    try:
        content_bytes.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        try:
            content_bytes.decode("cp949")
            return "cp949"
        except UnicodeDecodeError:
            return "latin-1"


def parse_utm_raw_text(text: str) -> Dict[str, Any]:
    """Parse UTM raw text data with header, units, and numeric rows.

    Handles space, tab, or comma delimiters, preserved serial numbers,
    and recognizes '변형율'/'변형률' equivalents while retaining original headers.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 3:
        raise ValueError("파일에 충분한 데이터가 없습니다 (헤더, 단위, 데이터 행 필요).")

    # Delimiter detection for header line
    header_line = lines[0]
    if "\t" in header_line:
        raw_headers = [h.strip() for h in header_line.split("\t") if h.strip()]
    elif "," in header_line:
        raw_headers = [h.strip() for h in header_line.split(",") if h.strip()]
    else:
        raw_headers = re.split(r"\s+", header_line)

    unit_line = lines[1]
    if "\t" in unit_line:
        raw_units = [u.strip() for u in unit_line.split("\t")]
    elif "," in unit_line:
        raw_units = [u.strip() for u in unit_line.split(",")]
    else:
        raw_units = re.split(r"\s+", unit_line)

    # Pad or align units with headers
    # Handle the fact that index/serial number often has no unit
    # e.g., headers: [일련번호, 시간, 하중, ...] (8 cols), units: [sec, kgf, ...] (7 cols)
    aligned_units = [""] * len(raw_headers)
    if len(raw_units) == len(raw_headers) - 1:
        # First column has no unit
        aligned_units[0] = ""
        aligned_units[1:] = raw_units
    elif len(raw_units) == len(raw_headers):
        aligned_units = raw_units
    else:
        # Best effort alignment
        for i in range(min(len(raw_headers), len(raw_units))):
            aligned_units[i] = raw_units[i]

    # Map standard roles to raw column names
    col_mapping = {}
    for idx, name in enumerate(raw_headers):
        norm = name.strip().lower()
        if "일련번호" in norm or "no" in norm or "index" in norm:
            col_mapping["index"] = name
        elif "시간" in norm or "time" in norm:
            col_mapping["time"] = name
        elif "하중" in norm or "load" in norm or "force" in norm:
            col_mapping["load"] = name
        elif "변위" in norm or "displacement" in norm or "stroke" in norm:
            col_mapping["displacement"] = name
        elif "진응력" in norm or "true stress" in norm:
            col_mapping["true_stress"] = name
        elif "응력" in norm or "stress" in norm:
            if "true" not in norm and "진" not in norm:
                col_mapping["stress"] = name
        elif "진변형" in norm or "true strain" in norm:
            col_mapping["true_strain"] = name
        elif "변형율" in norm or "변형률" in norm or "strain" in norm:
            if "true" not in norm and "진" not in norm:
                col_mapping["strain"] = name

    # Parse numeric data rows
    data_rows = []
    skipped_rows = []
    expected_col_count = len(raw_headers)

    for line_idx, line_str in enumerate(lines[2:], start=3):
        # Split row
        if "\t" in line_str:
            parts = [p.strip() for p in line_str.split("\t") if p.strip()]
        elif "," in line_str:
            parts = [p.strip() for p in line_str.split(",") if p.strip()]
        else:
            parts = re.split(r"\s+", line_str)

        if len(parts) < expected_col_count:
            skipped_rows.append({"line": line_idx, "reason": "열 개수 부족", "content": line_str})
            continue

        try:
            row_dict = {}
            for col_idx, hname in enumerate(raw_headers):
                val_str = parts[col_idx]
                # Convert float or int
                val = float(val_str)
                row_dict[hname] = val
            data_rows.append(row_dict)
        except ValueError as e:
            skipped_rows.append({"line": line_idx, "reason": f"수치 변환 실패: {str(e)}", "content": line_str})

    return {
        "headers": raw_headers,
        "units": aligned_units,
        "col_mapping": col_mapping,
        "rows": data_rows,
        "row_count": len(data_rows),
        "skipped_rows": skipped_rows,
    }


def analyze_utm_dataset(
    parsed_data: Dict[str, Any],
    start_index: Optional[int] = None,
    end_index: Optional[int] = None,
    specimen_area_A0: Optional[float] = None,  # mm^2
    specimen_gauge_L0: Optional[float] = None,  # mm
    elastic_start_strain_pct: Optional[float] = None,
    elastic_end_strain_pct: Optional[float] = None,
    calc_offset_yield: bool = True,
    smoothing_window: int = 1,
) -> Dict[str, Any]:
    """Perform deterministic numerical calculation on the UTM dataset.

    - Computes peak stress (UTS candidate), peak load, corresponding strain,
    - Detects negative load points,
    - Calculates elastic modulus (Young's modulus) via linear regression in specified strain range,
    - Calculates 0.2% offset yield stress if valid elastic line exists,
    - Distinguishes file-provided values vs re-calculated values.
    """
    rows = parsed_data["rows"]
    if not rows:
        raise ValueError("분석할 유효한 데이터 행이 없습니다.")

    headers = parsed_data["headers"]
    units = parsed_data["units"]
    mapping = parsed_data["col_mapping"]

    # Header lookup helpers
    idx_col = mapping.get("index") or (headers[0] if headers else None)
    time_col = mapping.get("time")
    load_col = mapping.get("load")
    disp_col = mapping.get("displacement")
    stress_col = mapping.get("stress")
    strain_col = mapping.get("strain")
    true_stress_col = mapping.get("true_stress")
    true_strain_col = mapping.get("true_strain")

    # Unit lookup
    unit_by_header = dict(zip(headers, units))
    load_unit = unit_by_header.get(load_col, "kgf") if load_col else "kgf"
    stress_unit = unit_by_header.get(stress_col, "kgf/mm²") if stress_col else "kgf/mm²"
    strain_unit = unit_by_header.get(strain_col, "%") if strain_col else "%"

    # Slice range by row index or serial number
    total_len = len(rows)
    s_idx = max(0, start_index if start_index is not None else 0)
    e_idx = min(total_len, end_index if end_index is not None else total_len)
    if s_idx >= e_idx:
        s_idx, e_idx = 0, total_len

    sliced_rows = rows[s_idx:e_idx]

    # Extract numpy arrays
    time_arr = np.array([r.get(time_col, 0.0) for r in sliced_rows]) if time_col else None
    load_raw = np.array([r.get(load_col, 0.0) for r in sliced_rows]) if load_col else None
    disp_raw = np.array([r.get(disp_col, 0.0) for r in sliced_rows]) if disp_col else None
    stress_raw = np.array([r.get(stress_col, 0.0) for r in sliced_rows]) if stress_col else None
    strain_raw = np.array([r.get(strain_col, 0.0) for r in sliced_rows]) if strain_col else None
    index_arr = [int(r.get(idx_col, i + 1)) if idx_col and idx_col in r else (i + 1) for i, r in enumerate(sliced_rows)]

    # Standard unit conversions
    # Load -> N
    if load_raw is not None:
        if "kgf" in load_unit.lower():
            load_N = load_raw * KGF_TO_N
        else:
            load_N = load_raw.copy()
    else:
        load_N = None

    # Stress -> MPa
    # If file provided stress:
    if stress_raw is not None:
        if "kgf" in stress_unit.lower() or "kgf/mm" in stress_unit.lower():
            stress_MPa = stress_raw * KGF_MM2_TO_MPA
        else:
            stress_MPa = stress_raw.copy()
    else:
        stress_MPa = None

    # Strain: percent (%) vs dimensionless
    if strain_raw is not None:
        if "%" in strain_unit:
            strain_pct = strain_raw.copy()
            strain_dimensionless = strain_raw / 100.0
        else:
            strain_pct = strain_raw * 100.0
            strain_dimensionless = strain_raw.copy()
    else:
        strain_pct = None
        strain_dimensionless = None

    # Re-calculation mode if A0 and L0 provided
    recalculated_stress_MPa = None
    recalculated_strain_pct = None
    if specimen_area_A0 and specimen_area_A0 > 0 and load_N is not None:
        # Engineering stress = Force (N) / Area (mm^2) = MPa
        recalculated_stress_MPa = load_N / specimen_area_A0
    if specimen_gauge_L0 and specimen_gauge_L0 > 0 and disp_raw is not None:
        # Engineering strain = Delta L / L0
        recalculated_strain_dimensionless = disp_raw / specimen_gauge_L0
        recalculated_strain_pct = recalculated_strain_dimensionless * 100.0

    # Primary analysis arrays (prefer file-provided, fallback to recalculated)
    active_stress_MPa = stress_MPa if stress_MPa is not None else recalculated_stress_MPa
    active_strain_pct = strain_pct if strain_pct is not None else recalculated_strain_pct

    # Peak Stress (UTS candidate)
    peak_stress_info = None
    if active_stress_MPa is not None and len(active_stress_MPa) > 0:
        max_idx = int(np.argmax(active_stress_MPa))
        orig_serial = index_arr[max_idx]
        max_val_MPa = float(active_stress_MPa[max_idx])
        raw_val = float(stress_raw[max_idx]) if stress_raw is not None else (max_val_MPa / KGF_MM2_TO_MPA)
        corr_time = float(time_arr[max_idx]) if time_arr is not None else None
        corr_strain = float(active_strain_pct[max_idx]) if active_strain_pct is not None else None
        corr_disp = float(disp_raw[max_idx]) if disp_raw is not None else None

        peak_stress_info = {
            "index": max_idx + s_idx,
            "serial_number": orig_serial,
            "stress_raw": round(raw_val, 4),
            "stress_raw_unit": stress_unit,
            "stress_MPa": round(max_val_MPa, 6),
            "strain_pct": round(corr_strain, 4) if corr_strain is not None else None,
            "time_sec": round(corr_time, 4) if corr_time is not None else None,
            "displacement_mm": round(corr_disp, 4) if corr_disp is not None else None,
            "source": "파일 제공값" if stress_raw is not None else "하중/A0 재계산값",
        }

    # Peak Load
    peak_load_info = None
    if load_raw is not None and len(load_raw) > 0:
        max_load_idx = int(np.argmax(load_raw))
        peak_load_info = {
            "index": max_load_idx + s_idx,
            "serial_number": index_arr[max_load_idx],
            "load_raw": round(float(load_raw[max_load_idx]), 4),
            "load_raw_unit": load_unit,
            "load_N": round(float(load_N[max_load_idx]), 4) if load_N is not None else None,
            "time_sec": round(float(time_arr[max_load_idx]), 4) if time_arr is not None else None,
        }

    # Negative load detection
    negative_load_points = []
    if load_raw is not None:
        for i, val in enumerate(load_raw):
            if val < 0:
                negative_load_points.append({
                    "index": i + s_idx,
                    "serial_number": index_arr[i],
                    "load_raw": float(val),
                    "time_sec": float(time_arr[i]) if time_arr is not None else None,
                })

    # Elastic modulus (Young's modulus E) calculation via linear regression
    # Requires strain % and stress MPa
    elastic_info = None
    if active_strain_pct is not None and active_stress_MPa is not None:
        # Default strain range if not specified: e.g. 0.05% to 0.25% (or 10% to 40% of peak stress strain)
        if elastic_start_strain_pct is None or elastic_end_strain_pct is None:
            max_s_strain = peak_stress_info["strain_pct"] if peak_stress_info and peak_stress_info.get("strain_pct") else 1.0
            e_start = max(0.01, max_s_strain * 0.08)
            e_end = max_s_strain * 0.40
        else:
            e_start = elastic_start_strain_pct
            e_end = elastic_end_strain_pct

        # Mask points in [e_start, e_end]
        mask = (active_strain_pct >= e_start) & (active_strain_pct <= e_end)
        x_sub_pct = active_strain_pct[mask]
        y_sub_MPa = active_stress_MPa[mask]

        # Convert strain % to dimensionless for standard Young's Modulus calculation: E = dSigma / dEpsilon
        # E (MPa) = slope of (stress_MPa vs strain_dimensionless) = slope of (stress_MPa vs strain_pct) * 100
        unique_strains = len(np.unique(x_sub_pct))
        if len(x_sub_pct) >= 4 and unique_strains >= 3:
            x_dim = x_sub_pct / 100.0
            # Linear regression: y = slope * x + intercept
            slope, intercept = np.polyfit(x_dim, y_sub_MPa, 1)
            y_pred = slope * x_dim + intercept
            ss_tot = np.sum((y_sub_MPa - np.mean(y_sub_MPa)) ** 2)
            ss_res = np.sum((y_sub_MPa - y_pred) ** 2)
            r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

            # E in GPa
            E_GPa = slope / 1000.0

            elastic_info = {
                "strain_start_pct": round(e_start, 4),
                "strain_end_pct": round(e_end, 4),
                "point_count": int(len(x_sub_pct)),
                "unique_strain_count": int(unique_strains),
                "slope_MPa": round(float(slope), 2),
                "E_GPa": round(float(E_GPa), 3),
                "intercept_MPa": round(float(intercept), 3),
                "r_squared": round(float(r_squared), 4),
                "is_valid": bool(slope > 0 and r_squared >= 0.85),
            }
        else:
            elastic_info = {
                "strain_start_pct": round(e_start, 4),
                "strain_end_pct": round(e_end, 4),
                "point_count": int(len(x_sub_pct)),
                "unique_strain_count": int(unique_strains),
                "is_valid": False,
                "reason": "선택 구간의 데이터 점 수가 부족하거나 변형률 변화가 없습니다 (최소 4점 이상 필요).",
            }

    # 0.2% Offset Yield Stress calculation (Rp0.2)
    offset_yield_info = None
    if calc_offset_yield and elastic_info and elastic_info.get("is_valid"):
        E_slope_MPa = elastic_info["slope_MPa"]
        # Offset strain = 0.2% = 0.002 dimensionless
        # Offset line equation: stress = E * (strain_dimensionless - 0.002) = E * (strain_pct/100 - 0.002)
        # Find intersection between active curve and offset line
        offset_line_stress = E_slope_MPa * (active_strain_pct / 100.0 - 0.002)
        diff = active_stress_MPa - offset_line_stress

        # Find sign changes after offset starting point (strain_pct > 0.2)
        valid_indices = np.where(active_strain_pct > 0.2)[0]
        intersect_idx = None
        for k in range(len(valid_indices) - 1):
            i1 = valid_indices[k]
            i2 = valid_indices[k + 1]
            if diff[i1] * diff[i2] <= 0:
                intersect_idx = i1
                break

        if intersect_idx is not None:
            offset_yield_info = {
                "yield_stress_MPa": round(float(active_stress_MPa[intersect_idx]), 4),
                "yield_strain_pct": round(float(active_strain_pct[intersect_idx]), 4),
                "index": int(intersect_idx + s_idx),
                "serial_number": index_arr[intersect_idx],
                "method": "0.2% 오프셋 연속 교점법",
                "is_valid": True,
            }
        else:
            offset_yield_info = {
                "is_valid": False,
                "reason": "0.2% 오프셋 선과 실험 곡선의 유효한 교점을 찾을 수 없습니다 (연성 항복 거동이 뚜렷하지 않거나 탄성 구간 설정 필요).",
            }

    # Fracture / Load Drop Candidate Detection
    # Look for sharp drop in load or stress
    fracture_candidate = None
    if active_stress_MPa is not None and len(active_stress_MPa) > 10:
        peak_idx = int(np.argmax(active_stress_MPa))
        post_peak_stress = active_stress_MPa[peak_idx:]
        post_peak_indices = np.arange(peak_idx, len(active_stress_MPa))
        # Look for sudden drop below 50% or 30% of peak or maximum negative derivative
        diff_post = np.diff(post_peak_stress)
        if len(diff_post) > 0:
            min_slope_idx = int(np.argmin(diff_post))
            sharp_drop_idx = post_peak_indices[min_slope_idx]
            fracture_candidate = {
                "candidate_index": int(sharp_drop_idx + s_idx),
                "serial_number": index_arr[sharp_drop_idx],
                "stress_MPa": round(float(active_stress_MPa[sharp_drop_idx]), 4),
                "strain_pct": round(float(active_strain_pct[sharp_drop_idx]), 4) if active_strain_pct is not None else None,
                "note": "최대 하중 이후 급격한 하중 강하가 감지된 지점입니다 (자동 확정이 아니며 사용자의 확인이 권장됩니다).",
            }

    # Rule-based Summary Construction
    summary_lines = [
        f"**UTM 인장시험 데이터 수치 분석 요약**",
        f"- **전체 데이터 행 수**: {total_len}개 (분석 구간: {s_idx + 1}행 ~ {e_idx}행, 총 {len(sliced_rows)}행)",
        f"- **기본 열 매핑**: 하중({load_col or '미지정'}), 변위({disp_col or '미지정'}), 응력({stress_col or '미지정'}), 변형률({strain_col or '미지정'})",
    ]
    if peak_stress_info:
        summary_lines.append(
            f"- **최대 응력 (인장강도 후보)**: **{peak_stress_info['stress_MPa']} MPa** "
            f"(원본: {peak_stress_info['stress_raw']} {peak_stress_info['stress_raw_unit']}, "
            f"일련번호 No. {peak_stress_info['serial_number']}, 변형률 {peak_stress_info['strain_pct']}%, 시간 {peak_stress_info['time_sec']}s)"
        )
    if peak_load_info:
        summary_lines.append(
            f"- **최대 하중**: **{peak_load_info['load_N']} N** (원본: {peak_load_info['load_raw']} {peak_load_info['load_raw_unit']})"
        )
    if elastic_info and elastic_info.get("is_valid"):
        summary_lines.append(
            f"- **탄성계수 (Young's Modulus)**: **{elastic_info['E_GPa']} GPa** "
            f"(계산 구간: {elastic_info['strain_start_pct']}% ~ {elastic_info['strain_end_pct']}%, R² = {elastic_info['r_squared']}, 점 수 = {elastic_info['point_count']}개)"
        )
    elif elastic_info:
        summary_lines.append(f"- **탄성계수**: 산출 제한 ({elastic_info.get('reason')})")

    if offset_yield_info and offset_yield_info.get("is_valid"):
        summary_lines.append(
            f"- **0.2% 오프셋 내력 (Rp0.2)**: **{offset_yield_info['yield_stress_MPa']} MPa** (변형률 {offset_yield_info['yield_strain_pct']}%)"
        )
    elif offset_yield_info:
        summary_lines.append(f"- **0.2% 오프셋 내력**: 산출 제한 ({offset_yield_info.get('reason')})")

    if negative_load_points:
        summary_lines.append(
            f"- **음수 하중 탐지**: 일련번호 {negative_load_points[0]['serial_number']}~{negative_load_points[-1]['serial_number']} "
            f"구간에서 총 {len(negative_load_points)}건의 음수 하중이 감지되었습니다. (센서 영점 드리프트 또는 시험 후반 이완 구간)"
        )

    if true_stress_col or true_strain_col:
        summary_lines.append(
            "- **진응력/진변형률 열 알림**: 파일 내 진응력·진변형률 열은 산출 방식(단면적 추정식 등)이 확인되지 않았으므로 기본 분석에는 공칭 응력·변형률 열을 사용하며, 원본 값은 보존됩니다."
        )

    return {
        "analysis_range": {"start_idx": s_idx, "end_idx": e_idx, "count": len(sliced_rows), "total_count": total_len},
        "peak_stress": peak_stress_info,
        "peak_load": peak_load_info,
        "elastic_modulus": elastic_info,
        "offset_yield": offset_yield_info,
        "fracture_candidate": fracture_candidate,
        "negative_load_summary": {
            "count": len(negative_load_points),
            "first_serial": negative_load_points[0]["serial_number"] if negative_load_points else None,
            "last_serial": negative_load_points[-1]["serial_number"] if negative_load_points else None,
        },
        "summary_text": "\n".join(summary_lines),
        "curves": {
            "index": index_arr,
            "time": time_arr.tolist() if time_arr is not None else [],
            "load_raw": load_raw.tolist() if load_raw is not None else [],
            "load_N": load_N.tolist() if load_N is not None else [],
            "disp_raw": disp_raw.tolist() if disp_raw is not None else [],
            "stress_raw": stress_raw.tolist() if stress_raw is not None else [],
            "stress_MPa": active_stress_MPa.tolist() if active_stress_MPa is not None else [],
            "strain_pct": active_strain_pct.tolist() if active_strain_pct is not None else [],
            "true_stress_raw": [r.get(true_stress_col) for r in sliced_rows] if true_stress_col else [],
            "true_strain_raw": [r.get(true_strain_col) for r in sliced_rows] if true_strain_col else [],
        },
    }
