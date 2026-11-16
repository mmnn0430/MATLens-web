"""Differential Scanning Calorimetry (DSC) Analytical Engine:
Segment Splitting (Heating/Cooling cycles), Transition Temperature Detection (Tg, Tc, Tm, Tcc),
Enthalpy Integration (ΔH), Specific Heat Capacity (Cp), and Conditional Crystallinity (Xc).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.signal import find_peaks, savgol_filter, peak_widths


def _find_peak_bounds(
    t_arr: np.ndarray,
    q_arr: np.ndarray,
    peak_idx: int,
    rel_height: float = 0.96,
) -> tuple[int, int]:
    """Calculate onset and endset indices using peak_widths or adaptive window."""
    n = len(t_arr)
    try:
        widths, heights, left_ips, right_ips = peak_widths(q_arr, [peak_idx], rel_height=rel_height)
        left_idx = max(0, int(round(left_ips[0])))
        right_idx = min(n - 1, int(round(right_ips[0])))
        if right_idx > left_idx:
            return left_idx, right_idx
    except Exception:
        pass
    dt = abs(float(np.median(np.diff(t_arr)))) if n > 1 else 1.0
    pts_20c = max(8, int(round(20.0 / max(1e-3, dt))))
    return max(0, peak_idx - pts_20c), min(n - 1, peak_idx + pts_20c)


def split_dsc_segments(
    temperature: np.ndarray,
    time_s: np.ndarray | None = None,
    heat_flow: np.ndarray | None = None,
    temp_rate_threshold_c_per_min: float = 0.5,
) -> list[dict[str, Any]]:
    """Detect and split thermal steps into 1st Heating, Cooling, 2nd Heating, Isothermal, etc."""
    n = len(temperature)
    if n < 5:
        return [{
            "id": "step-1",
            "name": "전체 데이터",
            "type": "unknown",
            "start_idx": 0,
            "end_idx": n - 1,
            "start_temp": float(temperature[0]),
            "end_temp": float(temperature[-1]),
            "duration_s": float(time_s[-1] - time_s[0]) if time_s is not None else None,
        }]

    # Compute dT/dt or dT/di
    if time_s is not None and len(time_s) == n and time_s[-1] > time_s[0]:
        dt = np.gradient(time_s)
        dt = np.where(dt <= 0, 1e-4, dt)
        rate_c_min = np.gradient(temperature) / (dt / 60.0)
    else:
        # Fallback to index rate
        rate_c_min = np.gradient(temperature) * 60.0

    # Smooth rate slightly to prevent noisy rapid sign flips
    if len(rate_c_min) > 11:
        rate_smooth = savgol_filter(rate_c_min, window_length=11, polyorder=1)
    else:
        rate_smooth = rate_c_min

    # Classify each point: +1 (heating), -1 (cooling), 0 (isothermal)
    pt_types = np.zeros(n, dtype=int)
    thresh = temp_rate_threshold_c_per_min
    pt_types[rate_smooth > thresh] = 1
    pt_types[rate_smooth < -thresh] = -1

    # Group contiguous blocks of same type
    blocks: list[dict[str, Any]] = []
    curr_type = pt_types[0]
    start_idx = 0

    for i in range(1, n):
        if pt_types[i] != curr_type:
            # Only consider blocks with at least 8 points as true steps to ignore transient noise
            if (i - start_idx) >= 8:
                blocks.append({"type": curr_type, "start": start_idx, "end": i - 1})
                start_idx = i
                curr_type = pt_types[i]
    blocks.append({"type": curr_type, "start": start_idx, "end": n - 1})

    # Merge very short noisy blocks into previous
    merged_blocks: list[dict[str, Any]] = []
    for b in blocks:
        if not merged_blocks:
            merged_blocks.append(b)
        else:
            prev = merged_blocks[-1]
            if (b["end"] - b["start"] < 10) or (b["type"] == prev["type"]):
                prev["end"] = b["end"]
            else:
                merged_blocks.append(b)

    # Name steps sequentially (e.g. 1st Heating, 1st Cooling, 2nd Heating)
    heating_cnt = 0
    cooling_cnt = 0
    iso_cnt = 0
    named_segments: list[dict[str, Any]] = []

    for b in merged_blocks:
        st_idx = b["start"]
        en_idx = b["end"]
        t_start = float(temperature[st_idx])
        t_end = float(temperature[en_idx])
        delta_t = t_end - t_start

        if b["type"] == 1 or delta_t > 3.0:
            heating_cnt += 1
            name = f"제{heating_cnt}차 승온 (Heating #{heating_cnt})"
            stype = "heating"
        elif b["type"] == -1 or delta_t < -3.0:
            cooling_cnt += 1
            name = f"제{cooling_cnt}차 냉각 (Cooling #{cooling_cnt})"
            stype = "cooling"
        else:
            iso_cnt += 1
            name = f"등온 유지 #{iso_cnt} (Isothermal)"
            stype = "isothermal"

        dur = float(time_s[en_idx] - time_s[st_idx]) if time_s is not None else None

        named_segments.append({
            "id": f"step-{len(named_segments)+1}",
            "name": name,
            "type": stype,
            "start_idx": st_idx,
            "end_idx": en_idx,
            "start_temp": round(t_start, 2),
            "end_temp": round(t_end, 2),
            "delta_temp": round(delta_t, 2),
            "point_count": en_idx - st_idx + 1,
            "duration_s": round(dur, 1) if dur is not None else None,
        })

    return named_segments


def run_dsc_analysis(
    temperature: list[float],
    heat_flow: list[float],
    time_s: list[float] | None = None,
    heat_capacity: list[float] | None = None,
    sample_mass_mg: float | None = None,
    heat_flow_unit: str = "mW",  # 'mW', 'W', 'mW/mg', 'W/g'
    exo_direction: str = "down",  # 'down' (Endo Up / Exo Down) or 'up' (Exo Up / Endo Down)
    selected_segment_id: str | None = None,
    standard_melting_enthalpy_J_per_g: float | None = None,  # ΔHm° for 100% crystalline
    standard_enthalpy_source: str = "",
    polymer_mass_fraction: float = 1.0,  # w
    t_min: float | None = None,
    t_max: float | None = None,
    peak_prominence: float = 0.05,
    custom_tg_range: tuple[float, float] | None = None,
    custom_melting_range: tuple[float, float] | None = None,
    custom_cryst_range: tuple[float, float] | None = None,
    cp_baseline_range: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Execute complete DSC thermodynamic evaluation with step separation and unit integrity."""
    t_arr = np.asarray(temperature, dtype=float)
    hf_raw = np.asarray(heat_flow, dtype=float)
    time_arr = np.asarray(time_s, dtype=float) if time_s is not None and len(time_s) == len(t_arr) else None
    cp_raw = np.asarray(heat_capacity, dtype=float) if heat_capacity is not None and len(heat_capacity) == len(t_arr) else None

    warnings: list[str] = []

    # Unit normalization to specific heat flow: W/g (equivalent to mW/mg)
    # Check if already normalized by mass
    unit_lower = heat_flow_unit.lower()
    is_already_normalized = "w/g" in unit_lower or "mw/mg" in unit_lower

    if is_already_normalized:
        q_norm = hf_raw.copy()  # Already W/g or mW/mg
        normalization_note = f"입력 단위({heat_flow_unit})가 이미 질량 정규화되어 있어 이중 나누기를 방지했습니다."
    else:
        if sample_mass_mg and sample_mass_mg > 0:
            if "mw" in unit_lower:
                # mW / mg = (mW * 1e-3 W) / (mg * 1e-3 g) = W/g
                q_norm = hf_raw / sample_mass_mg
            elif "w" in unit_lower:
                # W / (mg * 1e-3) = W/g
                q_norm = hf_raw / (sample_mass_mg * 1e-3)
            else:
                q_norm = hf_raw / sample_mass_mg
            normalization_note = f"시료 질량({sample_mass_mg} mg)으로 정규화하여 W/g (= mW/mg) 단위로 통일했습니다."
        else:
            q_norm = hf_raw.copy()
            warnings.append("시료 질량이 입력되지 않아 비정규화된 원시 열유속으로 표시됩니다 (정량 엔탈피 J/g 산출 제한).")
            normalization_note = "시료 질량 미지정 (원시 단위 유지)"

    # Segment identification
    segments = split_dsc_segments(t_arr, time_arr, q_norm)

    # Active segment selection
    if selected_segment_id:
        active_seg = next((s for s in segments if s["id"] == selected_segment_id), segments[0])
    else:
        # Default: pick 2nd Heating if exists, else 1st Heating, else first segment
        second_heat = next((s for s in segments if "2차 승온" in s["name"]), None)
        first_heat = next((s for s in segments if "1차 승온" in s["name"]), None)
        active_seg = second_heat or first_heat or segments[0]

    st_idx = active_seg["start_idx"]
    en_idx = active_seg["end_idx"]
    t_seg = t_arr[st_idx : en_idx + 1]
    q_seg = q_norm[st_idx : en_idx + 1]
    time_seg = time_arr[st_idx : en_idx + 1] if time_arr is not None else None

    # Filter by user temperature range if provided
    mask = np.ones(len(t_seg), dtype=bool)
    if t_min is not None:
        mask &= (t_seg >= t_min)
    if t_max is not None:
        mask &= (t_seg <= t_max)

    t_sub = t_seg[mask]
    q_sub = q_seg[mask]
    time_sub = time_seg[mask] if time_seg is not None else None

    if len(t_sub) < 5:
        return {
            "status": "계산 불가",
            "reason": "선택한 구간에 유효한 데이터 포인트가 부족합니다.",
            "segments": segments,
            "active_segment": active_seg,
        }

    # Temperature derivative d(HF)/dT (W/(g·°C))
    if len(t_sub) > 9 and abs(t_sub[-1] - t_sub[0]) > 1.0:
        dt_deriv = np.gradient(t_sub)
        dt_deriv = np.where(np.abs(dt_deriv) < 1e-4, 1e-4, dt_deriv)
        q_deriv = np.gradient(q_sub) / dt_deriv
        # Smooth derivative
        if len(q_deriv) > 11:
            q_deriv_smooth = savgol_filter(q_deriv, window_length=11, polyorder=2)
        else:
            q_deriv_smooth = q_deriv
    else:
        q_deriv_smooth = np.zeros_like(q_sub)

    # Orientation factor: In "Endo Up", melting is positive peak; in "Exo Up", melting is negative (downward dip)
    # Convert internally so positive peaks represent Endotherm (Melting) for uniform detection
    is_endo_up = (exo_direction.lower() == "down")
    q_detect_endo = q_sub if is_endo_up else -q_sub

    # 1. Melting Peak (Tm) & Enthalpy (ΔHm)
    tm_results: dict[str, Any] = {}
    if active_seg["type"] == "heating":
        # Search endothermic peaks
        m_range = custom_melting_range or (float(np.min(t_sub)), float(np.max(t_sub)))
        m_mask = (t_sub >= m_range[0]) & (t_sub <= m_range[1])
        t_m_sub = t_sub[m_mask]
        q_m_sub = q_detect_endo[m_mask]

        if len(t_m_sub) > 8:
            peaks_m, props_m = find_peaks(q_m_sub, prominence=peak_prominence, distance=10)
            if len(peaks_m) > 0:
                best_pk = peaks_m[np.argmax(props_m["prominences"])]
                tm_peak = float(t_m_sub[best_pk])
                # Onset / endset estimation via peak_widths baseline intercept
                left_base, right_base = _find_peak_bounds(t_m_sub, q_m_sub, best_pk, rel_height=0.96)
                t_onset = float(t_m_sub[left_base])
                t_endset = float(t_m_sub[right_base])

                # Integration of Enthalpy ΔHm: ∫ (q - q_linear_base) dt
                q_base = np.interp(t_m_sub, [t_m_sub[left_base], t_m_sub[right_base]], [q_m_sub[left_base], q_m_sub[right_base]])
                net_q = np.maximum(0.0, q_m_sub - q_base)

                if time_sub is not None:
                    # Direct time integration: ∫ net_q dt [W/g * s = J/g]
                    time_m_sub = time_sub[m_mask]
                    delta_h_m = float(np.trapezoid(net_q[left_base:right_base], time_m_sub[left_base:right_base]))
                    integration_basis = "실제 시간(t) 축 기반 수치 적분 (W/g · s = J/g)"
                else:
                    # Estimate based on nominal rate
                    dur_total = (t_m_sub[right_base] - t_m_sub[left_base])
                    rate_est = 10.0 / 60.0  # fallback 10 C/min = 0.166 C/s
                    delta_h_m = float(np.trapezoid(net_q[left_base:right_base], t_m_sub[left_base:right_base])) / max(1e-4, rate_est)
                    integration_basis = "승온 속도 가정 기반 환산 적분 (시간 열 부재)"

                delta_h_m = abs(delta_h_m)
                tm_results = {
                    "status": "검출 완료",
                    "tm_peak_c": round(tm_peak, 2),
                    "tm_onset_c": round(t_onset, 2),
                    "tm_endset_c": round(t_endset, 2),
                    "delta_h_m_J_per_g": round(delta_h_m, 2),
                    "integration_basis": integration_basis,
                    "integral_range_c": [round(t_onset, 1), round(t_endset, 1)],
                }

    # 2. Crystallization Peak (Tc) & Enthalpy (ΔHc)
    tc_results: dict[str, Any] = {}
    if active_seg["type"] == "cooling":
        # Search exothermic peaks (opposite polarity to melting)
        q_detect_exo = -q_detect_endo
        c_range = custom_cryst_range or (float(np.min(t_sub)), float(np.max(t_sub)))
        c_mask = (t_sub >= c_range[0]) & (t_sub <= c_range[1])
        t_c_sub = t_sub[c_mask]
        q_c_sub = q_detect_exo[c_mask]

        if len(t_c_sub) > 8:
            peaks_c, props_c = find_peaks(q_c_sub, prominence=peak_prominence, distance=10)
            if len(peaks_c) > 0:
                best_pk = peaks_c[np.argmax(props_c["prominences"])]
                tc_peak = float(t_c_sub[best_pk])
                left_base, right_base = _find_peak_bounds(t_c_sub, q_c_sub, best_pk, rel_height=0.96)
                t_onset = float(t_c_sub[left_base])
                t_endset = float(t_c_sub[right_base])

                q_base = np.interp(t_c_sub, [t_c_sub[left_base], t_c_sub[right_base]], [q_c_sub[left_base], q_c_sub[right_base]])
                net_q = np.maximum(0.0, q_c_sub - q_base)

                if time_sub is not None:
                    time_c_sub = time_sub[c_mask]
                    delta_h_c = float(np.trapezoid(net_q[left_base:right_base], time_c_sub[left_base:right_base]))
                else:
                    delta_h_c = float(np.trapezoid(net_q[left_base:right_base], t_c_sub[left_base:right_base])) / (10.0 / 60.0)

                tc_results = {
                    "status": "검출 완료",
                    "tc_peak_c": round(tc_peak, 2),
                    "tc_onset_c": round(t_onset, 2),
                    "tc_endset_c": round(t_endset, 2),
                    "delta_h_c_J_per_g": round(abs(delta_h_c), 2),
                    "integral_range_c": [round(t_onset, 1), round(t_endset, 1)],
                }

    # 3. Glass Transition Temperature (Tg) via Baseline Step Change / Inflection
    tg_results: dict[str, Any] = {}
    tg_range = custom_tg_range or (float(np.min(t_sub)), min(float(np.max(t_sub)), tm_results.get("tm_onset_c", float(np.max(t_sub)))))
    tg_mask = (t_sub >= tg_range[0]) & (t_sub <= tg_range[1])
    t_tg_sub = t_sub[tg_mask]
    q_tg_sub = q_detect_endo[tg_mask]

    if len(t_tg_sub) > 15:
        # Derivative extrema correlate with inflection point of step change
        deriv_tg = q_deriv_smooth[tg_mask]
        pk_d, pr_d = find_peaks(np.abs(deriv_tg), prominence=0.005, distance=8)
        if len(pk_d) > 0:
            best_d = pk_d[np.argmax(pr_d["prominences"])]
            tg_midpoint = float(t_tg_sub[best_d])
            # Step height delta Cp estimate
            left_val = float(np.median(q_tg_sub[:max(1, best_d - 5)]))
            right_val = float(np.median(q_tg_sub[min(len(q_tg_sub) - 1, best_d + 5):]))
            delta_step = abs(right_val - left_val)

            tg_results = {
                "status": "검출 완료",
                "tg_midpoint_c": round(tg_midpoint, 2),
                "tg_step_height_W_per_g": round(delta_step, 4),
                "method": "열유속 1차 미분 변곡점 및 중간점(Midpoint) 판정",
                "evaluated_range_c": [round(tg_range[0], 1), round(tg_range[1], 1)],
            }

    # 4. Conditional Crystallinity (Xc)
    xc_results: dict[str, Any] = {}
    delta_hm_val = tm_results.get("delta_h_m_J_per_g")
    delta_hcc_val = 0.0  # Cold crystallization enthalpy (0 if neat without cold cryst)

    if standard_melting_enthalpy_J_per_g and standard_melting_enthalpy_J_per_g > 0:
        if delta_hm_val is not None:
            w_poly = max(1e-4, min(1.0, polymer_mass_fraction))
            xc_val = ((delta_hm_val - delta_hcc_val) / (w_poly * standard_melting_enthalpy_J_per_g)) * 100.0

            if 0.0 <= xc_val <= 100.0:
                xc_status = "분석 완료"
                xc_note = f"100% 결정 표준 엔탈피(ΔHm° = {standard_melting_enthalpy_J_per_g} J/g, 출처: {standard_enthalpy_source or '사용자 지정'}) 기준 결정화도 산출"
            else:
                xc_status = "확인 필요"
                xc_note = f"산출된 결정화도({xc_val:.1f}%)가 물리적 범위(0~100%)를 벗어났습니다. 표준 엔탈피 및 적분 구간 검토 필요."

            xc_results = {
                "status": xc_status,
                "crystallinity_pct": round(xc_val, 2),
                "standard_melting_enthalpy_J_per_g": standard_melting_enthalpy_J_per_g,
                "standard_enthalpy_source": standard_enthalpy_source or "사용자 입력",
                "polymer_mass_fraction": w_poly,
                "summary": xc_note,
                "formula_display": {
                    "equation": "Xc (%) = [ (ΔHm - ΔHcc) / (w × ΔHm°) ] × 100",
                    "substituted_values": {
                        "ΔHm (용융 엔탈피)": f"{delta_hm_val} J/g",
                        "ΔHcc (냉결정화 엔탈피)": f"{delta_hcc_val} J/g",
                        "w (고분자 질량 분율)": f"{w_poly}",
                        "ΔHm° (100% 결정질 기준)": f"{standard_melting_enthalpy_J_per_g} J/g",
                        "산출된 결정화도 Xc": f"{xc_val:.2f}%",
                    },
                },
            }
        else:
            xc_results = {
                "status": "계산 불가",
                "reason": "선택한 단계에서 측정된 용융 엔탈피(ΔHm)가 없습니다.",
            }
    else:
        xc_results = {
            "status": "기준 엔탈피 입력 필요",
            "reason": "100% 완전 결정질 고분자의 기준 용융 엔탈피(ΔHm°)가 설정되지 않아 임의 계산(100 J/g 가정 등)을 배제했습니다.",
            "crystallinity_pct": None,
        }

    # 5. Specific Heat Capacity (Cp) if column present
    cp_results: dict[str, Any] = {}
    if cp_raw is not None:
        cp_seg = cp_raw[st_idx : en_idx + 1][mask]
        cp_range = cp_baseline_range or (float(np.min(t_sub)), float(np.min(t_sub)) + 40.0)
        cpm = (t_sub >= cp_range[0]) & (t_sub <= cp_range[1])
        if np.sum(cpm) > 3:
            mean_cp = float(np.mean(cp_seg[cpm]))
            cp_results = {
                "status": "분석 완료",
                "mean_cp": round(mean_cp, 3),
                "unit": "J/(g·K)" if sample_mass_mg else "J/K",
                "temperature_range_c": [round(cp_range[0], 1), round(cp_range[1], 1)],
                "notes": f"{cp_range[0]}~{cp_range[1]}°C 안정 구간 평균 비열 산출",
            }

    return {
        "status": "분석 완료",
        "segments": segments,
        "active_segment": active_seg,
        "temperature": t_sub.tolist(),
        "heat_flow": q_sub.tolist(),
        "heat_flow_deriv": q_deriv_smooth.tolist(),
        "time_s": time_sub.tolist() if time_sub is not None else [],
        "heat_flow_unit": "W/g (= mW/mg)" if is_already_normalized or sample_mass_mg else heat_flow_unit,
        "exo_direction": exo_direction,
        "normalization_note": normalization_note,
        "transitions": {
            "glass_transition": tg_results,
            "melting": tm_results,
            "crystallization": tc_results,
            "crystallinity": xc_results,
            "heat_capacity": cp_results,
        },
        "warnings": warnings,
    }
