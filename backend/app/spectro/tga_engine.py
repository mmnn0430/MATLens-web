"""Thermogravimetric Analysis (TGA) Analytical Engine:
Mass Normalization, Derivative Thermogravimetry (DTG), Stepwise Mass Loss Decomposition,
Threshold Interpolation (T5, T10), and Atmosphere Switching Verification.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.signal import find_peaks, savgol_filter


def run_tga_analysis(
    temperature: list[float],
    mass_or_percent: list[float],
    time_s: list[float] | None = None,
    instrument_dtg: list[float] | None = None,
    initial_mass_mg: float | None = None,
    input_is_percent: bool = False,
    heating_rate_c_per_min: float | None = 10.0,
    atmosphere_initial: str = "N₂ (질소 불활성 분위기)",
    gas_switch_temp_c: float | None = None,  # e.g., 600°C switch to Air/O2
    atmosphere_after_switch: str = "Air / O₂ (산화 분위기)",
    target_residual_temp_c: float | None = None,
    t_min: float | None = None,
    t_max: float | None = None,
    custom_step_boundaries: list[tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """Execute rigorous TGA/DTG decomposition analysis with strict unit conservation."""
    t_arr = np.asarray(temperature, dtype=float)
    y_raw = np.asarray(mass_or_percent, dtype=float)
    time_arr = np.asarray(time_s, dtype=float) if time_s is not None and len(time_s) == len(t_arr) else None
    dtg_raw = np.asarray(instrument_dtg, dtype=float) if instrument_dtg is not None and len(instrument_dtg) == len(t_arr) else None

    warnings: list[str] = []

    # Sort in ascending temperature order
    if len(t_arr) >= 2 and t_arr[0] > t_arr[-1]:
        idx_asc = np.argsort(t_arr)
        t_arr = t_arr[idx_asc]
        y_raw = y_raw[idx_asc]
        if time_arr is not None:
            time_arr = time_arr[idx_asc]
        if dtg_raw is not None:
            dtg_raw = dtg_raw[idx_asc]

    # Filter by user temperature range
    mask = np.ones(len(t_arr), dtype=bool)
    if t_min is not None:
        mask &= (t_arr >= t_min)
    if t_max is not None:
        mask &= (t_arr <= t_max)

    t_sub = t_arr[mask]
    y_sub = y_raw[mask]
    time_sub = time_arr[mask] if time_arr is not None else None
    dtg_sub = dtg_raw[mask] if dtg_raw is not None else None

    if len(t_sub) < 5:
        return {
            "status": "계산 불가",
            "reason": "선택한 온도 구간에 유효한 데이터가 부족합니다.",
        }

    # Normalization to % and mg
    if input_is_percent:
        mass_percent = y_sub.copy()
        if initial_mass_mg and initial_mass_mg > 0:
            mass_mg = mass_percent * (initial_mass_mg / 100.0)
            norm_basis = f"입력값(% 단위) 및 초기 질량({initial_mass_mg} mg) 기준 환산"
        else:
            mass_mg = None
            norm_basis = "입력값(% 단위) 그대로 사용 (초기 질량 mg 미지정)"
    else:
        # Input is mass (e.g. mg)
        m0 = initial_mass_mg or float(y_sub[0])
        if m0 <= 0:
            m0 = float(y_sub[0]) if float(y_sub[0]) > 0 else 1.0
        mass_mg = y_sub.copy()
        mass_percent = (y_sub / m0) * 100.0
        norm_basis = f"초기 질량(m₀ = {m0:.3f} mg) 기준 백분율(%) 정규화"

    # DTG calculation: -dW/dT (%/°C)
    if len(mass_percent) > 9:
        dt_step = np.gradient(t_sub)
        dt_step = np.where(np.abs(dt_step) < 1e-4, 1e-4, dt_step)
        # DTG is negative derivative so that mass loss appears as positive peak
        dtg_calc_temp = -np.gradient(mass_percent) / dt_step
        if len(dtg_calc_temp) > 11:
            dtg_calc_temp_smooth = savgol_filter(dtg_calc_temp, window_length=11, polyorder=2)
        else:
            dtg_calc_temp_smooth = dtg_calc_temp
    else:
        dtg_calc_temp_smooth = np.zeros_like(mass_percent)

    # Conversion to %/min if heating rate or time is available
    if time_sub is not None and time_sub[-1] > time_sub[0]:
        d_time = np.gradient(time_sub)
        d_time = np.where(d_time <= 0, 1e-4, d_time)
        dtg_time_min = -np.gradient(mass_percent) / (d_time / 60.0)
        dtg_time_source = "실제 시간(t) 축 기반 %/min 환산"
    elif heating_rate_c_per_min and heating_rate_c_per_min > 0:
        dtg_time_min = dtg_calc_temp_smooth * heating_rate_c_per_min
        dtg_time_source = f"일정 승온 속도(β = {heating_rate_c_per_min} °C/min) 기반 환산"
    else:
        dtg_time_min = None
        dtg_time_source = "시간 및 승온속도 정보 부재로 %/min 산출 제한"

    final_dtg_c = dtg_sub if dtg_sub is not None else dtg_calc_temp_smooth

    # Find DTG peaks (temperatures of maximum decomposition rate)
    dtg_peaks_out: list[dict[str, Any]] = []
    pks, props = find_peaks(final_dtg_c, prominence=0.02, distance=10)
    for p_idx in pks:
        t_peak = float(t_sub[p_idx])
        rate_val = float(final_dtg_c[p_idx])
        dtg_peaks_out.append({
            "peak_index": len(dtg_peaks_out) + 1,
            "temperature_c": round(t_peak, 2),
            "max_decomposition_rate_pct_per_c": round(rate_val, 4),
            "max_rate_pct_per_min": round(float(dtg_time_min[p_idx]), 4) if dtg_time_min is not None else None,
        })
    dtg_peaks_out.sort(key=lambda x: x["max_decomposition_rate_pct_per_c"], reverse=True)

    # Threshold temperatures: T5, T10 (interpolated)
    def find_temperature_at_loss(target_loss_pct: float) -> tuple[float | None, str]:
        target_remaining = 100.0 - target_loss_pct
        for i in range(len(mass_percent) - 1):
            w1, w2 = mass_percent[i], mass_percent[i + 1]
            if (w1 >= target_remaining >= w2) or (w1 <= target_remaining <= w2):
                if abs(w2 - w1) < 1e-6:
                    return float(t_sub[i]), "직접 일치"
                frac = (target_remaining - w1) / (w2 - w1)
                t_interp = float(t_sub[i] + frac * (t_sub[i + 1] - t_sub[i]))
                return round(t_interp, 2), "선형 보간 완료"
        return None, "측정 온도 범위 내 도달하지 않음 (미도달)"

    t5_val, t5_status = find_temperature_at_loss(5.0)
    t10_val, t10_status = find_temperature_at_loss(10.0)

    # Stepwise mass loss segmentation
    # If custom boundaries given by user, use them; else propose boundaries from DTG peak valleys
    steps_out: list[dict[str, Any]] = []
    if custom_step_boundaries and len(custom_step_boundaries) > 0:
        step_ranges = custom_step_boundaries
    else:
        # Auto propose steps based on DTG peaks and valleys
        if len(dtg_peaks_out) >= 1:
            sorted_pks = sorted([p["temperature_c"] for p in dtg_peaks_out[:4]])
            cuts = [float(t_sub[0])]
            for i in range(len(sorted_pks) - 1):
                mid = (sorted_pks[i] + sorted_pks[i + 1]) / 2.0
                cuts.append(mid)
            cuts.append(float(t_sub[-1]))
            step_ranges = [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]
        else:
            step_ranges = [(float(t_sub[0]), float(t_sub[-1]))]

    # Evaluate each decomposition step
    for s_idx, (t_s_start, t_s_end) in enumerate(step_ranges):
        s_mask = (t_sub >= t_s_start) & (t_sub <= t_s_end)
        if np.sum(s_mask) >= 2:
            w_start = float(mass_percent[s_mask][0])
            w_end = float(mass_percent[s_mask][-1])
            delta_w = w_start - w_end  # Positive for mass loss
            delta_m_mg = (delta_w / 100.0 * initial_mass_mg) if initial_mass_mg else None

            # Find peak inside this step if any
            step_pk = next((p for p in dtg_peaks_out if t_s_start <= p["temperature_c"] <= t_s_end), None)

            # Atmosphere tag
            if gas_switch_temp_c and t_s_start >= gas_switch_temp_c:
                atm_tag = atmosphere_after_switch
            elif gas_switch_temp_c and t_s_start < gas_switch_temp_c < t_s_end:
                atm_tag = f"{atmosphere_initial} → {atmosphere_after_switch} 전환 구간"
            else:
                atm_tag = atmosphere_initial

            steps_out.append({
                "step_index": s_idx + 1,
                "label": f"질량 감소 구간 {s_idx + 1}",
                "temperature_range_c": [round(t_s_start, 1), round(t_s_end, 1)],
                "initial_residual_pct": round(w_start, 2),
                "final_residual_pct": round(w_end, 2),
                "mass_loss_pct": round(delta_w, 2),
                "mass_loss_mg": round(delta_m_mg, 3) if delta_m_mg is not None else None,
                "dtg_peak_temp_c": step_pk["temperature_c"] if step_pk else None,
                "atmosphere": atm_tag,
            })

    # Residual mass at final temperature
    final_temp = float(t_sub[-1])
    final_res_pct = float(mass_percent[-1])
    final_res_mg = (final_res_pct / 100.0 * initial_mass_mg) if initial_mass_mg else None

    # Residual mass at user selected temperature if provided
    target_res_pct = None
    target_res_mg = None
    if target_residual_temp_c is not None:
        idx_near = int(np.argmin(np.abs(t_sub - target_residual_temp_c)))
        target_res_pct = round(float(mass_percent[idx_near]), 2)
        target_res_mg = round(target_res_pct / 100.0 * initial_mass_mg, 3) if initial_mass_mg else None

    return {
        "status": "분석 완료",
        "temperature": t_sub.tolist(),
        "mass_percent": mass_percent.tolist(),
        "mass_mg": mass_mg.tolist() if mass_mg is not None else [],
        "dtg_pct_per_c": final_dtg_c.tolist(),
        "dtg_pct_per_min": dtg_time_min.tolist() if dtg_time_min is not None else [],
        "time_s": time_sub.tolist() if time_sub is not None else [],
        "normalization_basis": norm_basis,
        "decomposition_characteristics": {
            "T5_c": t5_val,
            "T5_status": t5_status,
            "T10_c": t10_val,
            "T10_status": t10_status,
            "dtg_peaks": dtg_peaks_out,
            "dtg_time_source": dtg_time_source,
        },
        "steps": steps_out,
        "residual": {
            "final_temperature_c": round(final_temp, 1),
            "final_residual_pct": round(final_res_pct, 2),
            "final_residual_mg": round(final_res_mg, 3) if final_res_mg is not None else None,
            "target_temperature_c": target_residual_temp_c,
            "target_residual_pct": target_res_pct,
            "target_residual_mg": target_res_mg,
        },
        "atmosphere_conditions": {
            "initial": atmosphere_initial,
            "gas_switch_temp_c": gas_switch_temp_c,
            "after_switch": atmosphere_after_switch if gas_switch_temp_c else None,
        },
        "formula_display": {
            "mass_loss_percent": "ΔW (%) = W_start - W_end",
            "mass_loss_mg": "Δm (mg) = m₀ × ΔW / 100",
            "dtg_equation": "DTG_T = -dW/dT [%/°C], DTG_t = DTG_T × β [%/min]",
        },
        "warnings": warnings,
    }
