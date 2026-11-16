"""FT-IR Analytical Engine: Spectrum Conversion, Preprocessing, Peak Detection,
Functional Group Screening, and Thin-Film Interference Fringe Thickness.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.signal import find_peaks, savgol_filter

# Curated reference table for characteristic functional group vibrational bands
CURATED_FUNCTIONAL_GROUPS: list[dict[str, Any]] = [
    {
        "id": "FG-OH-BONDED",
        "name": "O-H 신축 진동 (수소결합)",
        "bond": "O-H",
        "vibration_type": "신축 (Stretch, Broad)",
        "range_cm": [3200.0, 3600.0],
        "category": "알코올 / 페놀 / 카복실산",
        "notes": "분자간 수소결합으로 인해 폭이 넓은(Broad) U자형 밴드로 관찰됩니다. 수분 흡습 영향 여부 확인 필요.",
    },
    {
        "id": "FG-NH-AMINE",
        "name": "N-H 신축 진동 (아민/아마이드)",
        "bond": "N-H",
        "vibration_type": "신축 (Stretch)",
        "range_cm": [3300.0, 3500.0],
        "category": "아민 / 아마이드",
        "notes": "1차 아민은 쌍봉(doublet), 2차 아민은 단일봉(singlet) 형태를 띱니다.",
    },
    {
        "id": "FG-CH-ALIPHATIC",
        "name": "C-H 신축 진동 (지방족 sp³)",
        "bond": "C-H (sp³)",
        "vibration_type": "신축 (대칭/비대칭 Stretch)",
        "range_cm": [2840.0, 2980.0],
        "category": "지방족 탄화수소 (CH₂, CH₃)",
        "notes": "대부분의 유기 고분자(PE, PP 등)에서 2920, 2850 cm⁻¹ 부근에 강한 이중/다중 피크로 나타납니다.",
    },
    {
        "id": "FG-CH-AROMATIC",
        "name": "C-H 신축 진동 (방향족 sp²)",
        "bond": "C-H (sp²)",
        "vibration_type": "신축 (Stretch)",
        "range_cm": [3000.0, 3120.0],
        "category": "방향족 / 알켄",
        "notes": "3000 cm⁻¹ 초과 영역에 위치하여 지방족 C-H(3000 미만)와 구분됩니다 (예: Polystyrene 페닐기).",
    },
    {
        "id": "FG-CO2-ATM",
        "name": "대기 중 CO₂ 간섭 흡수",
        "bond": "O=C=O",
        "vibration_type": "비대칭 신축 (Asymmetric Stretch)",
        "range_cm": [2320.0, 2380.0],
        "category": "환경/대기 가스 간섭",
        "notes": "측정 광로 상의 대기 이산화탄소 잔류 시 2349 cm⁻¹ 부근에 날카로운 이중 흡수 피크로 나타납니다 (시료 고유 피크 아님).",
    },
    {
        "id": "FG-C-TRIPLE",
        "name": "삼중결합 / 누적 이중결합 (C≡C, C≡N, N=C=O)",
        "bond": "C≡C, C≡N, N=C=O",
        "vibration_type": "신축 (Stretch)",
        "range_cm": [2100.0, 2270.0],
        "category": "알카인 / 나이트릴 / 아이소사이아네이트",
        "notes": "폴리우레탄 원료 반응 검토 시 N=C=O (약 2270 cm⁻¹) 잔류 여부 모니터링에 활용됩니다.",
    },
    {
        "id": "FG-CARBONYL",
        "name": "C=O 신축 진동 (카보닐기)",
        "bond": "C=O",
        "vibration_type": "신축 (Stretch, Strong)",
        "range_cm": [1650.0, 1780.0],
        "category": "케톤 / 알데하이드 / 에스터 / 카복실산 / 아마이드 I",
        "notes": "매우 강하고 날카로운 흡수 피크. 에스터(~1735), 카복실산(~1710), 아마이드(~1660 cm⁻¹) 등 치환기 효과에 따라 위치가 이동합니다.",
    },
    {
        "id": "FG-AROMATIC-RING",
        "name": "방향족 고리 골격 진동 (Aromatic C=C)",
        "bond": "C=C (Aromatic)",
        "vibration_type": "골격 신축 (Ring Stretch)",
        "range_cm": [1450.0, 1610.0],
        "category": "방향족 화합물",
        "notes": "1600, 1500, 1450 cm⁻¹ 부근에 특징적인 복수 밴드로 출현합니다 (에폭시 수지, 폴리스타이렌 등).",
    },
    {
        "id": "FG-CH-BEND",
        "name": "C-H 굽힘 진동 (알킬기 변형)",
        "bond": "C-H",
        "vibration_type": "변각/굽힘 (Scissoring/Bending)",
        "range_cm": [1350.0, 1480.0],
        "category": "알킬기 (CH₂, CH₃)",
        "notes": "-CH₃ 대칭 변형(약 1375 cm⁻¹) 및 -CH₂- 가위질 진동(약 1460 cm⁻¹).",
    },
    {
        "id": "FG-CO-STRETCH",
        "name": "C-O 신축 진동",
        "bond": "C-O",
        "vibration_type": "신축 (Stretch, Strong)",
        "range_cm": [1000.0, 1300.0],
        "category": "알코올 / 에터 / 에스터",
        "notes": "에폭시 수지의 글리시딜 에터 결합(C-O-C) 및 알코올 C-O 결합 영역.",
    },
    {
        "id": "FG-AROMATIC-OOP",
        "name": "방향족 C-H 면외 굽힘 (Out-of-Plane Bending)",
        "bond": "C-H (Aromatic OOP)",
        "vibration_type": "면외 굽힘 (Bending)",
        "range_cm": [690.0, 850.0],
        "category": "방향족 치환 패턴",
        "notes": "단일치환 페닐기(700, 750 cm⁻¹의 2개 밴드) 또는 파라치환(820-840 cm⁻¹ 1개 밴드) 등 치환 위치 판별 보조 지표.",
    },
]


def convert_ftir_signals(
    wavenumbers: np.ndarray,
    signal_values: np.ndarray,
    signal_type: str = "transmittance",  # 'transmittance' (%T), 'transmittance_ratio' (0~1), or 'absorbance' (A)
) -> dict[str, Any]:
    """Convert between %T, T, and Absorbance with strict range and physical validity checks."""
    wn = np.asarray(wavenumbers, dtype=float)
    sig = np.asarray(signal_values, dtype=float)
    warnings: list[str] = []

    # Sort in canonical decreasing order of wavenumber (e.g. 4000 -> 400 cm-1)
    if len(wn) >= 2 and wn[0] < wn[-1]:
        idx_rev = np.argsort(-wn)
        wn = wn[idx_rev]
        sig = sig[idx_rev]

    n_pts = len(wn)
    st = signal_type.lower()

    if st in ("transmittance", "%t"):
        # Expecting 0 ~ 100%
        transmittance_pct = sig.copy()
        # Quality check
        neg_count = int(np.sum(transmittance_pct <= 0.0))
        high_count = int(np.sum(transmittance_pct > 100.0))
        if neg_count > 0:
            warnings.append(
                f"투과율이 0% 이하인 데이터 {neg_count}개가 검출되었습니다 (완전 흡수 또는 검출기 암전류/노이즈). "
                "해당 지점의 흡광도는 정의상 무한대(∞)이므로 상한 클리핑(A=4.0)하여 표시합니다."
            )
        if high_count > 0:
            warnings.append(
                f"투과율이 100%를 초과하는 데이터 {high_count}개가 포함되어 있습니다 (배경 스펙트럼 표류 또는 광로 정렬 오차)."
            )

        # Convert to Absorbance: A = -log10(T) = -log10(%T / 100)
        t_ratio = np.clip(transmittance_pct / 100.0, 1e-4, 10.0)
        absorbance = -np.log10(t_ratio)
        absorbance = np.clip(absorbance, 0.0, 4.0)

    elif st in ("transmittance_ratio", "t"):
        transmittance_pct = sig * 100.0
        neg_count = int(np.sum(sig <= 0.0))
        if neg_count > 0:
            warnings.append(f"투과율 비율이 0 이하인 데이터 {neg_count}개가 포함되어 있습니다.")
        t_ratio = np.clip(sig, 1e-4, 10.0)
        absorbance = -np.log10(t_ratio)
        absorbance = np.clip(absorbance, 0.0, 4.0)

    elif st in ("absorbance", "abs", "a"):
        absorbance = sig.copy()
        neg_count = int(np.sum(absorbance < 0.0))
        if neg_count > 0:
            warnings.append(
                f"음수 흡광도 데이터 {neg_count}개가 검출되었습니다 (배경선 표류 등). 원본은 보존되며 투과율 환산 시 반영됩니다."
            )
        # Convert to Transmittance: T = 10^(-A), %T = 100 * 10^(-A)
        transmittance_pct = 100.0 * (10.0 ** (-absorbance))
    else:
        # Default assume %T
        transmittance_pct = sig.copy()
        t_ratio = np.clip(transmittance_pct / 100.0, 1e-4, 10.0)
        absorbance = -np.log10(t_ratio)

    return {
        "wavenumbers": wn.tolist(),
        "transmittance_pct": transmittance_pct.tolist(),
        "absorbance": absorbance.tolist(),
        "input_signal_type": signal_type,
        "n_points": n_pts,
        "wavenumber_range": [float(np.min(wn)), float(np.max(wn))],
        "warnings": warnings,
    }


def preprocess_and_detect_peaks(
    wavenumbers: list[float],
    absorbance: list[float],
    transmittance_pct: list[float],
    use_smoothing: bool = False,
    smooth_window: int = 9,
    smooth_polyorder: int = 3,
    use_baseline_correction: bool = False,
    baseline_degree: int = 1,
    min_prominence: float = 0.02,
    min_distance_cm: float = 8.0,
    wavenumber_min: float | None = None,
    wavenumber_max: float | None = None,
    excluded_wavenumbers: list[float] | None = None,
) -> dict[str, Any]:
    """Detect absorption peaks in Absorbance domain (maxima) or %T domain (minima)."""
    wn = np.asarray(wavenumbers, dtype=float)
    abs_y = np.asarray(absorbance, dtype=float)
    t_y = np.asarray(transmittance_pct, dtype=float)

    # Filtering range
    mask = np.ones(len(wn), dtype=bool)
    if wavenumber_min is not None:
        mask &= (wn >= wavenumber_min)
    if wavenumber_max is not None:
        mask &= (wn <= wavenumber_max)

    wn_sub = wn[mask]
    abs_sub = abs_y[mask]
    t_sub = t_y[mask]

    proc_abs = abs_sub.copy()
    proc_t = t_sub.copy()

    # Smoothing
    if use_smoothing and len(proc_abs) > smooth_window:
        w_len = smooth_window if smooth_window % 2 == 1 else smooth_window + 1
        proc_abs = savgol_filter(proc_abs, window_length=w_len, polyorder=min(smooth_polyorder, w_len - 1))
        proc_t = savgol_filter(proc_t, window_length=w_len, polyorder=min(smooth_polyorder, w_len - 1))

    # Baseline correction (linear or polynomial subtraction in absorbance domain)
    baseline_curve = np.zeros_like(proc_abs)
    if use_baseline_correction and len(proc_abs) > baseline_degree + 2:
        poly_coeffs = np.polyfit(wn_sub, proc_abs, deg=baseline_degree)
        baseline_curve = np.polyval(poly_coeffs, wn_sub)
        proc_abs = np.maximum(0.0, proc_abs - baseline_curve)

    # Step size for distance conversion
    step_cm = abs(float(np.median(np.diff(wn_sub)))) if len(wn_sub) > 1 else 1.0
    dist_pts = max(1, int(round(min_distance_cm / max(1e-4, step_cm))))

    # Peak detection in absorbance (maxima)
    peak_indices, props = find_peaks(proc_abs, prominence=min_prominence, distance=dist_pts)

    excluded_set = set(round(x, 1) for x in (excluded_wavenumbers or []))
    peaks_out: list[dict[str, Any]] = []

    for idx in peak_indices:
        w_peak = float(wn_sub[idx])
        if round(w_peak, 1) in excluded_set:
            continue
        prom = float(props["prominences"][np.where(peak_indices == idx)[0][0]]) if "prominences" in props else 0.0
        abs_val = float(abs_sub[idx])
        t_val = float(t_sub[idx])

        # Match with functional group reference table
        matched_groups: list[dict[str, Any]] = []
        for fg in CURATED_FUNCTIONAL_GROUPS:
            if fg["range_cm"][0] <= w_peak <= fg["range_cm"][1]:
                matched_groups.append({
                    "id": fg["id"],
                    "name": fg["name"],
                    "bond": fg["bond"],
                    "vibration_type": fg["vibration_type"],
                    "category": fg["category"],
                    "notes": fg["notes"],
                })

        peaks_out.append({
            "id": f"P-{len(peaks_out)+1}",
            "wavenumber": round(w_peak, 1),
            "absorbance": round(abs_val, 4),
            "transmittance_pct": round(t_val, 2),
            "prominence": round(prom, 4),
            "functional_groups": matched_groups,
            "is_atmospheric_gas": any(g["id"] == "FG-CO2-ATM" for g in matched_groups),
        })

    # Sort peaks by absorbance intensity descending
    peaks_out.sort(key=lambda p: p["absorbance"], reverse=True)

    return {
        "processed_wavenumbers": wn_sub.tolist(),
        "processed_absorbance": proc_abs.tolist(),
        "processed_transmittance_pct": proc_t.tolist(),
        "baseline": baseline_curve.tolist() if use_baseline_correction else [],
        "detected_peaks": peaks_out,
        "peak_count": len(peaks_out),
    }


def calculate_film_thickness_interference(
    wavenumbers: list[float],
    signal_values: list[float],
    refractive_index: float | None = 1.59,  # e.g. Polystyrene n ≈ 1.59
    refractive_index_source: str = "고분자 표준 굴절률 (Polystyrene/Polyethylene 문헌치)",
    wavenumber_range: tuple[float, float] = (1900.0, 2700.0),
    min_prominence: float = 0.5,
    min_distance_cm: float = 15.0,
    user_selected_points: list[dict[str, float]] | None = None,
) -> dict[str, Any]:
    """Calculate thin polymer film thickness from transmission interference fringes.

    Equation under normal incidence:
        d (μm) = [ m * 10^4 ] / [ 2 * n * |ν1 - ν2| ]
    where:
        - ν1, ν2: Wavenumbers in cm⁻¹
        - m: Number of complete fringe cycles between ν1 and ν2.
          (Note: for k consecutive extrema of the same phase, m = k - 1 intervals!)
        - n: Refractive index
    If refractive index n is not provided, returns optical thickness (n * d) only.
    """
    wn = np.asarray(wavenumbers, dtype=float)
    sig = np.asarray(signal_values, dtype=float)

    # Crop to transparent interference range (typically 1800 ~ 2800 cm-1 free of strong core bonds)
    low_wn, high_wn = min(wavenumber_range), max(wavenumber_range)
    mask = (wn >= low_wn) & (wn <= high_wn)
    if np.sum(mask) < 20:
        return {
            "status": "계산 불가",
            "reason": f"선택한 파수 범위({low_wn}~{high_wn} cm⁻¹) 내에 충분한 데이터 포인트가 없습니다.",
            "fringe_points": [],
        }

    wn_roi = wn[mask]
    sig_roi = sig[mask]

    # Detect interference fringes (maxima and minima)
    step_cm = abs(float(np.median(np.diff(wn_roi)))) if len(wn_roi) > 1 else 1.0
    dist_pts = max(1, int(round(min_distance_cm / max(1e-4, step_cm))))

    # Find peaks (maxima)
    pk_idx, pk_props = find_peaks(sig_roi, prominence=min_prominence, distance=dist_pts)
    # Find troughs (minima)
    tr_idx, tr_props = find_peaks(-sig_roi, prominence=min_prominence, distance=dist_pts)

    fringe_extrema: list[dict[str, Any]] = []
    for idx in pk_idx:
        fringe_extrema.append({
            "type": "peak",
            "phase": "극대(Peak)",
            "wavenumber": float(wn_roi[idx]),
            "signal": float(sig_roi[idx]),
        })
    for idx in tr_idx:
        fringe_extrema.append({
            "type": "trough",
            "phase": "극소(Trough)",
            "wavenumber": float(wn_roi[idx]),
            "signal": float(sig_roi[idx]),
        })

    # Sort extrema by wavenumber
    fringe_extrema.sort(key=lambda x: x["wavenumber"])

    # If user provided manually confirmed points, override
    if user_selected_points and len(user_selected_points) >= 2:
        selected_points = sorted(user_selected_points, key=lambda x: x["wavenumber"])
        phase_label = "사용자 지정 극값"
    else:
        # Use detected peaks (maxima) as default phase series if >= 2, else troughs
        peaks_series = [e for e in fringe_extrema if e["type"] == "peak"]
        troughs_series = [e for e in fringe_extrema if e["type"] == "trough"]
        if len(peaks_series) >= 2:
            selected_points = peaks_series
            phase_label = "극대점(Peaks)"
        elif len(troughs_series) >= 2:
            selected_points = troughs_series
            phase_label = "극소점(Troughs)"
        else:
            return {
                "status": "계산 불가",
                "reason": "선택한 구간에서 명확한 2개 이상의 주기적 간섭무늬 극값을 검출하지 못했습니다.",
                "fringe_points": fringe_extrema,
                "n_detected_extrema": len(fringe_extrema),
            }

    k_points = len(selected_points)
    m_intervals = k_points - 1  # Key physical distinction: k points define k-1 intervals!

    nu_start = selected_points[0]["wavenumber"]
    nu_end = selected_points[-1]["wavenumber"]
    delta_nu_total = abs(nu_end - nu_start)

    if delta_nu_total < 1e-3 or m_intervals < 1:
        return {
            "status": "계산 불가",
            "reason": "간섭 파수 간격(Δν)이 0이거나 유효 간격 수가 부족합니다.",
            "fringe_points": fringe_extrema,
        }

    # Optical thickness: n * d = m * 10^4 / (2 * Δν) [μm]
    optical_thickness_um = (m_intervals * 10000.0) / (2.0 * delta_nu_total)

    # Interval-by-interval consistency analysis
    interval_thicknesses: list[float] = []
    interval_details: list[dict[str, Any]] = []
    for i in range(m_intervals):
        p1 = selected_points[i]
        p2 = selected_points[i + 1]
        d_nu_i = abs(p2["wavenumber"] - p1["wavenumber"])
        if d_nu_i > 1e-3:
            opt_i = (1.0 * 10000.0) / (2.0 * d_nu_i)
            interval_thicknesses.append(opt_i)
            interval_details.append({
                "interval_index": i + 1,
                "nu1": round(p1["wavenumber"], 1),
                "nu2": round(p2["wavenumber"], 1),
                "delta_nu": round(d_nu_i, 1),
                "optical_thickness_um": round(opt_i, 3),
                "physical_thickness_um": round(opt_i / refractive_index, 3) if refractive_index else None,
            })

    std_opt = float(np.std(interval_thicknesses)) if len(interval_thicknesses) > 1 else 0.0
    cv_pct = float(std_opt / optical_thickness_um * 100.0) if optical_thickness_um > 0 else 0.0

    if refractive_index and refractive_index > 0:
        physical_thickness_um = optical_thickness_um / refractive_index
        status = "분석 완료"
        subtext = (
            f"수직 입사 조건(m={m_intervals}개 간격, n={refractive_index}) 기준 물리적 막 두께: "
            f"{physical_thickness_um:.2f} μm (광학적 두께 n·d = {optical_thickness_um:.2f} μm)"
        )
    else:
        physical_thickness_um = None
        status = "확인 필요"
        subtext = (
            f"굴절률(n) 미입력으로 광학적 두께만 산출되었습니다: n·d = {optical_thickness_um:.2f} μm. "
            "실제 물리적 막 두께 확정을 위해 해당 시료의 굴절률을 입력해주세요."
        )

    return {
        "status": status,
        "phase_basis": phase_label,
        "k_extrema_count": k_points,
        "m_interval_count": m_intervals,
        "nu_range_used": [round(nu_start, 1), round(nu_end, 1)],
        "delta_nu_total": round(delta_nu_total, 2),
        "refractive_index": refractive_index,
        "refractive_index_source": refractive_index_source if refractive_index else "미지정",
        "optical_thickness_um": round(optical_thickness_um, 3),
        "physical_thickness_um": round(physical_thickness_um, 3) if physical_thickness_um else None,
        "interval_cv_pct": round(cv_pct, 2),
        "interval_details": interval_details,
        "fringe_points": fringe_extrema,
        "selected_points": selected_points,
        "summary_text": subtext,
        "formula_display": {
            "equation": "d = m × 10⁴ / [ 2n × |ν₁ - ν₂| ]",
            "substituted_values": {
                "m (완전 간섭 간격 수)": f"{m_intervals} (극값 {k_points}개 선택)",
                "|ν₁ - ν₂| (파수 차이)": f"{delta_nu_total:.2f} cm⁻¹ ({nu_start:.1f} ~ {nu_end:.1f} cm⁻¹)",
                "n (굴절률)": f"{refractive_index}" if refractive_index else "미지정 (광학두께 n·d만 계산)",
                "계산 결과 d": f"{physical_thickness_um:.2f} μm" if physical_thickness_um else f"광학두께 n·d = {optical_thickness_um:.2f} μm",
            },
        },
    }
