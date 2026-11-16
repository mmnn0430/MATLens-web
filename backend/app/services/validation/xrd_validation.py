"""XRD Scientific Validation Module.

Performs:
1. Peak Position Validation (exp 2θ vs reference, deviation calculation, calibration check)
2. Phase Identification Validation (major/minor peak match, unexplained peaks, multi-phase assessment)
3. Lattice Parameter Validation (Bragg's law, d-spacing, lattice constant refinement, literature comparison, relative deviation %)
4. Multi-Hypothesis Peak Shifting Interpretation (expansion/contraction, doping, residual stress, distortion, alignment error)
"""
from __future__ import annotations

import math
from typing import Any
import numpy as np

from ...schemas_literature import (
    ComparisonMetricItem,
    ExtractedEvidenceItem,
    LiteratureValidationItem,
)


def validate_xrd_analysis(
    xrd_result: dict[str, Any],
    validations: list[LiteratureValidationItem],
    material_name: str,
) -> dict[str, Any]:
    """Perform comprehensive scientific validation of XRD measurement against literature."""
    peaks = [p for p in xrd_result.get("peaks", []) if not p.get("user_excluded")]
    conditions = xrd_result.get("conditions", {})
    wl = float(conditions.get("wavelength_angstrom", 1.5406))
    phase_matching = xrd_result.get("phase_matching", {})
    candidates = phase_matching.get("candidates", [])

    # 1. Peak Position Validation
    peak_validations: list[dict[str, Any]] = []
    unexplained_peaks: list[dict[str, Any]] = []
    matched_peak_ids: set[str] = set()

    primary_candidate = candidates[0] if candidates else None
    ref_peaks = primary_candidate.get("peaks", []) if primary_candidate else []

    for p in peaks:
        exp_2th = float(p["two_theta"])
        exp_d = float(p.get("d_spacing_A") or (wl / (2.0 * math.sin(math.radians(exp_2th / 2.0)))))

        best_match = None
        min_dev = 999.0
        for rp in ref_peaks:
            r_2th = float(rp.get("two_theta", 0.0))
            dev = exp_2th - r_2th
            if abs(dev) < abs(min_dev):
                min_dev = dev
                best_match = rp

        if best_match and abs(min_dev) <= float(conditions.get("match_tol_deg", 0.35)):
            matched_peak_ids.add(p["peak_id"])
            peak_validations.append({
                "peak_id": p["peak_id"],
                "exp_two_theta": exp_2th,
                "ref_two_theta": round(float(best_match.get("two_theta", 0.0)), 4),
                "hkl": best_match.get("hkl"),
                "deviation_deg": round(min_dev, 4),
                "exp_d_spacing_A": round(exp_d, 4),
                "ref_d_spacing_A": round(float(best_match.get("d_spacing", 0.0)), 4),
                "is_matched": True,
            })
        else:
            unexplained_peaks.append({
                "peak_id": p["peak_id"],
                "two_theta": exp_2th,
                "rel_intensity_pct": p.get("rel_intensity_pct"),
                "fwhm_deg": p.get("fwhm_deg"),
            })

    # 2. Phase Identification Validation
    n_total_peaks = len(peaks)
    n_matched = len(matched_peak_ids)
    match_ratio = (n_matched / n_total_peaks) if n_total_peaks > 0 else 0.0

    phase_notes: list[str] = []
    if primary_candidate:
        score = primary_candidate.get("score", 0.0)
        c_name = primary_candidate.get("name", "Unknown Phase")
        if score >= 65.0:
            phase_notes.append(f"주상(Primary Phase) '{c_name}' 일치도 {score:.1f}%로 우수하게 매칭되었습니다.")
        elif score >= 35.0:
            phase_notes.append(f"주상 '{c_name}' 일치도 {score:.1f}% (부분 일치). 추가 상 또는 불순물 상 검토 필요.")
        else:
            phase_notes.append(f"주상 매칭 일치도 {score:.1f}%로 낮아 단일 결정상으로 확정할 수 없습니다.")

    if unexplained_peaks:
        sample_angles = ", ".join(f"{p['two_theta']}°" for p in unexplained_peaks[:3])
        phase_notes.append(
            f"설명되지 않은 피크 {len(unexplained_peaks)}개 감지 (예: 2θ = {sample_angles}). "
            "미량 2차상(Secondary phase) 또는 기판/오염 피크 가능성을 평가해야 합니다."
        )

    # 3. Lattice Parameter Refinement & Literature Comparison
    # Calculate apparent cubic lattice constant a = d * sqrt(h^2 + k^2 + l^2) for matched cubic peaks
    calc_a_values: list[float] = []
    for pv in peak_validations:
        hkl = pv.get("hkl")
        d_val = pv.get("exp_d_spacing_A")
        if hkl and d_val and isinstance(hkl, list) and len(hkl) == 3:
            h, k, l = hkl
            hkl_sq = h * h + k * k + l * l
            if hkl_sq > 0:
                calc_a = d_val * math.sqrt(hkl_sq)
                if 2.0 <= calc_a <= 15.0:
                    calc_a_values.append(calc_a)

    meas_lattice_a = round(float(np.median(calc_a_values)), 4) if calc_a_values else None

    # Find reported literature lattice parameter
    lit_lattice_a = None
    lit_lattice_paper = None
    for val in validations:
        for ev in val.evidence_items:
            prop = ev.evidence.property.lower()
            if "lattice parameter a" in prop and ev.evidence.value is not None:
                lit_lattice_a = ev.evidence.value
                lit_lattice_paper = val.paper
                break
        if lit_lattice_a:
            break

    comparisons: list[ComparisonMetricItem] = []
    if meas_lattice_a and lit_lattice_a:
        abs_dev = round(abs(meas_lattice_a - lit_lattice_a), 4)
        rel_dev = round(100.0 * abs_dev / lit_lattice_a, 2)
        comparisons.append(
            ComparisonMetricItem(
                property_name="Lattice Parameter a",
                measured_value=meas_lattice_a,
                literature_value=lit_lattice_a,
                unit="Å",
                absolute_deviation=abs_dev,
                relative_deviation_pct=rel_dev,
                comparable=True,
                reason_if_not_comparable=None,
            )
        )

    # 4. Multi-Hypothesis Peak Shifting Interpretation
    peak_shift_mean = float(np.mean([pv["deviation_deg"] for pv in peak_validations])) if peak_validations else 0.0
    shift_hypotheses: list[dict[str, Any]] = []

    if abs(peak_shift_mean) >= 0.03:
        direction = "고각(Higher 2θ, 격자 수축)" if peak_shift_mean > 0 else "저각(Lower 2θ, 격자 팽창)"
        shift_hypotheses.append({
            "hypothesis": f"격자 상수 변화 ({direction})",
            "basis": f"검출 피크들의 평균 2θ 이동량이 {peak_shift_mean:+.3f}°로 유의미하게 관찰됨.",
            "possible_mechanisms": [
                "치환형 도핑(Substitutional Doping): 모상 원소와 반경이 다른 원소 치환 (예: Ti 치환 시 이온 반경 차이로 격자 수축/팽창)",
                "잔류 응력(Residual Stress): 가공 또는 열처리 후 재료 내부에 존재하는 인장/압축 잔류응력에 의한 d-spacing 변화",
                "격자 왜곡(Lattice Distortion) 및 점결함(산소/원자 공공): 공공 결함 형성에 따른 국소 격자 이완",
                "기기 정렬 및 시편 변위 오차(Zero-shift / Sample Displacement Error): 시편 표면 높낮이 불일치에 따른 계통적 각도 이동",
            ],
            "recommended_validation": "LaB6 표준 시료(SRM 660)를 통한 디프랙토미터 2θ 영점 보정 및 EDS 원소 농도 정량 분석 병행 권장",
        })
    else:
        shift_hypotheses.append({
            "hypothesis": "기준 결정구조와 높은 각도 일치성",
            "basis": f"피크 위치 평균 편차가 {peak_shift_mean:+.3f}°로 회절기 각도 분해능 허용 범위 내에 위치함.",
            "possible_mechanisms": ["표준 결정격자 구조가 왜곡 없이 안정적으로 유지됨."],
            "recommended_validation": "추가 고각 피크(2θ > 60°) 프로파일 분석으로 미세변형(Microstrain) 분리 평가 권장",
        })

    return {
        "instrument_type": "XRD",
        "peak_validations": peak_validations,
        "unexplained_peaks": unexplained_peaks,
        "phase_notes": phase_notes,
        "measured_lattice_a": meas_lattice_a,
        "literature_lattice_a": lit_lattice_a,
        "lattice_reference_paper": lit_lattice_paper.model_dump() if lit_lattice_paper else None,
        "comparisons": comparisons,
        "peak_shift_mean_deg": round(peak_shift_mean, 4),
        "shift_hypotheses": shift_hypotheses,
    }
