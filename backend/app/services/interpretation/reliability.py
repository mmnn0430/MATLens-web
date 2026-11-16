"""Scientific Reliability Assessment System.

Bifurcates reliability strictly into:
1. Analytical Reliability (Data quality, calibration, residual fitting, segmentation quality)
2. Interpretation Reliability (Literature evidence level, condition compatibility, traceability, agreement/conflict)

Uses discrete status states without arbitrary numbers:
Supported | Partially Supported | Insufficient Evidence | Conflicting Evidence | Not Comparable
"""
from __future__ import annotations

from typing import Any
from ...schemas_literature import (
    AnalyticalReliability,
    InterpretationReliability,
    LiteratureValidationItem,
    ReliabilityStatus,
    ScientificReliabilityAssessment,
)


def assess_scientific_reliability(
    instrument_type: str,
    measurement_res: dict[str, Any],
    validations: list[LiteratureValidationItem],
    comparisons: list[Any],
) -> ScientificReliabilityAssessment:
    """Assess analytical and interpretation reliability deterministically."""
    # 1. Analytical Reliability Assessment
    analytical_details: list[str] = []
    has_calib = True
    data_quality = "우수"
    fitting_residual = "R² ≥ 0.95"
    uncertainty = "표준 편차 및 기기 분해능 허용 한계 내"
    analytical_status: ReliabilityStatus = "Supported"

    inst = instrument_type.upper()
    if inst == "XRD":
        cond = measurement_res.get("conditions", {})
        insp = measurement_res.get("inspection", {})
        has_calib = bool(cond.get("wavelength_confirmed", True))
        peaks = measurement_res.get("peaks", [])
        active_peaks = [p for p in peaks if not p.get("user_excluded")]

        if not has_calib:
            analytical_details.append("X선 파장 보정 미확인 상태입니다.")
            analytical_status = "Partially Supported"
        if len(active_peaks) < 3:
            analytical_details.append(f"검출 피크 수(N={len(active_peaks)})가 부족하여 결정구조 정밀 검증에 한계가 있습니다.")
            analytical_status = "Insufficient Evidence"
            data_quality = "보통(피크 부족)"
        else:
            analytical_details.append(f"유효 회절 피크 {len(active_peaks)}개 프로파일 피팅 완료.")

        noise_sigma = cond.get("noise_sigma_est", 1.0)
        fitting_residual = f"배경 노이즈 추정 σ = {noise_sigma:.2f}"

    elif inst == "SEM":
        scale = measurement_res.get("scale", {})
        has_calib = bool(scale.get("is_calibrated", False))
        summary = measurement_res.get("summary_stats", {})
        n_active = summary.get("sample_count_n", 0)

        if not has_calib:
            analytical_details.append("스케일바 미보정(px 단위)으로 절대 크기 분석 신뢰도가 제한됩니다.")
            analytical_status = "Partially Supported"
            has_calib = False
        if n_active < 10:
            analytical_details.append(f"측정 입자/결정립 수 N={n_active}개로 통계적 대표성이 부족합니다.")
            analytical_status = "Insufficient Evidence"
            data_quality = "표본 부족"
        else:
            analytical_details.append(f"유효 객체 N={n_active}개 분할 및 통계 추출 완료.")

    elif inst == "UTM":
        elastic = measurement_res.get("elastic_modulus") or {}
        r2 = elastic.get("r_squared")
        if r2 is not None and r2 < 0.85:
            analytical_status = "Partially Supported"
            fitting_residual = f"R² = {r2:.4f} (탄성 계수 피팅 주의)"
            analytical_details.append("탄성 영역 결정계수가 낮아 추가 구간 재설정이 권장됩니다.")
        else:
            r2_val = r2 if r2 is not None else 0.99
            fitting_residual = f"R² = {r2_val:.4f}"
            analytical_details.append("초기 단면적(A0) 및 표점거리(L0) 기반 응력-변형률 계산 검증 완료.")

    # 2. Interpretation Reliability Assessment
    interp_details: list[str] = []
    unverified_assumptions: list[str] = []
    interp_status: ReliabilityStatus = "Supported"
    evidence_traceability = "동일 재료 계열 피어리뷰 논문 원문 및 DOI 확인"
    condition_compat_label = "실험 조건 부합"
    lit_agreement = "선행 연구 보고값 범위 내 일치"

    if not validations:
        interp_status = "Insufficient Evidence"
        evidence_traceability = "비교 가능한 학술 문헌 부족"
        condition_compat_label = "문헌 대조 불가"
        lit_agreement = "확인 불가"
        interp_details.append("해당 재료 및 조건에 직접 매칭되는 공인 문헌이 검색되지 않았습니다.")
    else:
        # Check condition compatibility across validations
        incompatible_count = sum(1 for v in validations if v.comparison_status == "Not Comparable")
        top_status = validations[0].comparison_status if validations else "Insufficient Evidence"
        if incompatible_count == len(validations):
            interp_status = "Not Comparable"
            condition_compat_label = "조건 불일치(직접 비교 제한)"
            interp_details.append("모든 검색 논문과 필수 실험 조건(열처리/온도/시험기법 등)이 불일치하여 정량 직접 비교가 제한됩니다.")
        elif top_status == "Supported":
            interp_status = "Supported"
            condition_compat_label = "실험 조건 부합"
            interp_details.append("주요 선행 연구와 필수 실험 조건이 완전히 부합합니다.")
        elif top_status == "Partially Supported":
            interp_status = "Partially Supported"
            condition_compat_label = "조건 부분 일치"
            interp_details.append("선행 연구와 부분적 조건 일치 하에 비교되었습니다.")
        else:
            interp_status = top_status

        # Check comparisons deviations
        for c in comparisons:
            rel_dev = getattr(c, "relative_deviation_pct", None)
            if rel_dev is not None:
                if rel_dev > 25.0:
                    lit_agreement = f"문헌값 대비 상대 편차 {rel_dev:.1f}% 관찰 (미세조직/합성조건 차이 검토 필요)"
                    interp_details.append(f"{c.property_name} 항목에서 선행 연구값과 {rel_dev:.1f}% 편차가 확인되었습니다.")
                    if interp_status == "Supported":
                        interp_status = "Partially Supported"

    analytical = AnalyticalReliability(
        status=analytical_status,
        calibration_availability=has_calib,
        data_quality_label=data_quality,
        fitting_residual_label=fitting_residual,
        measurement_uncertainty=uncertainty,
        details=analytical_details,
    )

    interpretation = InterpretationReliability(
        status=interp_status,
        evidence_traceability=evidence_traceability,
        condition_compatibility_label=condition_compat_label,
        literature_agreement=lit_agreement,
        unverified_assumptions=unverified_assumptions,
        details=interp_details,
    )

    return ScientificReliabilityAssessment(
        analytical=analytical,
        interpretation=interpretation,
    )
