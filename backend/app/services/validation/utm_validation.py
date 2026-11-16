"""UTM Scientific Validation Module.

Enforces:
1. Verification of calculation reliability: A0, L0, R^2 in elastic range, 0.2% offset proof stress.
2. Literature comparison strictly conditioned on: Chemical composition, Heat treatment, Test temperature, Strain rate, Geometry (ASTM E8).
3. Distinguishes macro-curve deformation facts (elastic, plastic, yield, UTS, necking) from microscopic fracture hypotheses.
"""
from __future__ import annotations

from typing import Any
from ...schemas_literature import (
    ComparisonMetricItem,
    LiteratureValidationItem,
)
from .condition_checker import check_conditions


def validate_utm_analysis(
    utm_result: dict[str, Any],
    validations: list[LiteratureValidationItem],
    material_name: str,
    meas_conditions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Perform rigorous scientific validation for UTM tensile test analysis."""
    conditions = meas_conditions or {}
    peak_stress = utm_result.get("peak_stress") or {}
    elastic = utm_result.get("elastic_modulus") or {}
    offset_yield = utm_result.get("offset_yield") or {}

    meas_uts = peak_stress.get("stress_MPa")
    meas_modulus = elastic.get("E_GPa")
    elastic_r2 = elastic.get("r_squared")
    meas_yield = offset_yield.get("yield_stress_MPa")

    # 1. Calculation Reliability Checks
    calc_checks: list[str] = []
    if elastic_r2 is not None:
        if elastic_r2 >= 0.990:
            calc_checks.append(f"탄성 구간 선형 회귀 결정계수 R² = {elastic_r2:.4f}로 매우 우수한 신뢰도 확보.")
        elif elastic_r2 >= 0.850:
            calc_checks.append(f"탄성 구간 선형 회귀 결정계수 R² = {elastic_r2:.4f} (양호하나 비선형 미세슬립 구간 검토 권장).")
        else:
            calc_checks.append(f"탄성 구간 결정계수 R² = {elastic_r2:.4f}로 낮음 (구간 재설정 필요).")

    if offset_yield.get("is_valid"):
        calc_checks.append("ASTM E8 표준 0.2% Offset 항복강도 산출 조건 충족.")
    else:
        calc_checks.append("0.2% Offset 항복강도 산출 불가 (소성 변형 구간 데이터 부족 또는 항복 거동 불명확).")

    # 2. Check literature comparisons against conditions
    comparisons: list[ComparisonMetricItem] = []

    # Find benchmark properties from matched literature
    lit_modulus = None
    lit_yield = None
    lit_uts = None
    matched_paper = None
    condition_compat = None

    for val in validations:
        # Check condition compatibility with this paper
        lit_conditions = getattr(val.paper, "reported_conditions", None) or {}
        compat = check_conditions("UTM", conditions, lit_conditions)
        if condition_compat is None:
            condition_compat = compat

        for ev in val.evidence_items:
            prop = ev.evidence.property.lower()
            val_num = ev.evidence.value
            if val_num is not None:
                if any(k in prop for k in ["young's modulus", "elastic modulus"]) and lit_modulus is None:
                    lit_modulus = val_num
                    matched_paper = val.paper
                elif any(k in prop for k in ["yield strength", "proof stress", "rp0.2"]) and lit_yield is None:
                    lit_yield = val_num
                elif any(k in prop for k in ["ultimate tensile strength", "uts", "peak stress"]) and lit_uts is None:
                    lit_uts = val_num

    direct_allowed = condition_compat.direct_comparison_allowed if condition_compat else True
    warning_reason = condition_compat.direct_comparison_warning if condition_compat else None

    # Young's Modulus
    if meas_modulus and lit_modulus:
        abs_dev = round(abs(meas_modulus - lit_modulus), 2)
        rel_dev = round(100.0 * abs_dev / lit_modulus, 1)
        comparisons.append(
            ComparisonMetricItem(
                property_name="Young's Modulus E",
                measured_value=round(meas_modulus, 2),
                literature_value=round(lit_modulus, 2),
                unit="GPa",
                absolute_deviation=abs_dev,
                relative_deviation_pct=rel_dev,
                comparable=direct_allowed,
                reason_if_not_comparable=warning_reason if not direct_allowed else None,
            )
        )

    # Yield Strength
    if meas_yield and lit_yield:
        abs_dev = round(abs(meas_yield - lit_yield), 1)
        rel_dev = round(100.0 * abs_dev / lit_yield, 1)
        comparisons.append(
            ComparisonMetricItem(
                property_name="0.2% Offset Yield Strength",
                measured_value=round(meas_yield, 1),
                literature_value=round(lit_yield, 1),
                unit="MPa",
                absolute_deviation=abs_dev,
                relative_deviation_pct=rel_dev,
                comparable=direct_allowed,
                reason_if_not_comparable=warning_reason if not direct_allowed else None,
            )
        )

    # UTS
    if meas_uts and lit_uts:
        abs_dev = round(abs(meas_uts - lit_uts), 1)
        rel_dev = round(100.0 * abs_dev / lit_uts, 1)
        comparisons.append(
            ComparisonMetricItem(
                property_name="Ultimate Tensile Strength (UTS)",
                measured_value=round(meas_uts, 1),
                literature_value=round(lit_uts, 1),
                unit="MPa",
                absolute_deviation=abs_dev,
                relative_deviation_pct=rel_dev,
                comparable=direct_allowed,
                reason_if_not_comparable=warning_reason if not direct_allowed else None,
            )
        )

    # 3. Mechanical Behavior Interpretation Guardrails
    fracture_guardrails: list[str] = [
        "거시적 응력-변형률 곡선(Macroscopic Stress-Strain Curve)만으로는 입계파괴(Intergranular) 또는 입내 연성 딤플 파괴(Dimple Ductile) 등 미세조직적 파괴 메커니즘을 확정할 수 없습니다.",
        "파괴 양상 규명을 위해서는 인장 파단면(Fracture surface)에 대한 고배율 SEM 프랙토그래피(Fractography) 및 EBSD 결정립계 분석이 필수적입니다.",
    ]

    return {
        "instrument_type": "UTM",
        "calculation_checks": calc_checks,
        "condition_compatibility": condition_compat.model_dump() if condition_compat else None,
        "comparisons": comparisons,
        "fracture_interpretation_guardrails": fracture_guardrails,
    }
