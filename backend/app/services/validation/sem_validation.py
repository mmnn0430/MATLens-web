"""SEM Scientific Validation Module.

Enforces strict materials science rules:
1. Distinguishes 2D image analysis accuracy from literature comparability.
2. Evaluates grain/particle size against ASTM E112 / E1382 standards.
3. Porosity: area fraction from 2D section must NOT be claimed as 3D volume porosity without stereological assumptions (ASTM E562).
4. Microstructure: brightness/contrast alone must NEVER be used to determine chemical phase; requires EDS/EBSD/XRD.
"""
from __future__ import annotations

from typing import Any
from ...schemas_literature import (
    ComparisonMetricItem,
    LiteratureValidationItem,
)


def validate_sem_analysis(
    sem_result: dict[str, Any],
    validations: list[LiteratureValidationItem],
    material_name: str,
) -> dict[str, Any]:
    """Perform scientific validation for SEM image analysis results."""
    scale = sem_result.get("scale", {})
    is_calibrated = bool(scale.get("is_calibrated", False))
    unit = scale.get("unit", "px")
    summary = sem_result.get("summary_stats", {})
    mode = sem_result.get("mode", "particle")

    meas_mean_size = summary.get("mean_diameter")
    sample_count_n = summary.get("sample_count_n", 0)
    cv_pct = summary.get("cv_pct", 0.0)

    # 1. Scale & Calibration Validation
    calib_notes: list[str] = []
    if is_calibrated:
        calib_notes.append(f"스케일바 보정 완료 (1 px = {scale.get('um_per_pixel', 0):.4f} µm, 단위: {unit}).")
    else:
        calib_notes.append("스케일바가 보정되지 않았습니다 (픽셀 px 단위). 절대 물리 크기 문헌 비교가 불가능합니다.")

    # 2. ASTM Statistical Adequacy
    astm_notes: list[str] = []
    if sample_count_n < 10:
        astm_notes.append(f"측정 표본 수(N={sample_count_n})가 ASTM E112/E1382 통계적 유의 기준(권장 N ≥ 50)에 미달합니다.")
    elif sample_count_n < 50:
        astm_notes.append(f"측정 표본 수 N={sample_count_n}개 (최소 요구량 충족, 신뢰도 향상을 위해 복수 시야 N ≥ 100 권장).")
    else:
        astm_notes.append(f"측정 표본 수 N={sample_count_n}개로 ASTM 권장 통계적 대표성을 확보했습니다.")

    # 3. Porosity / Area Fraction Stereological Warning (ASTM E562)
    porosity_warnings: list[str] = [
        "2차원(2D) 단면 이미지에서 계산한 면적분율(Area Fraction, %)은 등방성(Isotropy)과 무작위 단면 가정이 성립할 때만 3D 체적 기공률(Volume Porosity, %)의 비편향 추정치가 됩니다 (ASTM E562 체적분율 측정 기준 참조).",
        "단일 시야(Single FOV) 측정치이므로 시편 전체의 벌크 기공률로 단정할 수 없으며 복수 단면 평균 및 아르키메데스 밀도 측정과의 교차 검증이 요구됩니다.",
    ]

    # 4. Microstructure Chemical Phase Guardrail
    microstructure_rules: list[str] = [
        "SEM 이차전자(SE) 및 반사전자(BSE) 이미지의 명암 대비(Brightness/Contrast)만으로는 특정 화학적 상(Phase)의 조성을 단정할 수 없습니다.",
        "정확한 원소 분포 및 상 동정을 위해 에너지 분산형 X선 분광분석(EDS), 후방산란전자회절(EBSD) 및 분말 XRD 복합 분석을 권장합니다.",
    ]

    # 5. Literature Comparison for Mean Size / Grain Size
    lit_size = None
    lit_paper = None
    for val in validations:
        for ev in val.evidence_items:
            prop = ev.evidence.property.lower()
            if any(k in prop for k in ["grain size", "particle size", "diameter"]) and ev.evidence.value is not None:
                lit_size = ev.evidence.value
                lit_paper = val.paper
                break
        if lit_size:
            break

    comparisons: list[ComparisonMetricItem] = []
    if is_calibrated and meas_mean_size and lit_size:
        abs_dev = round(abs(meas_mean_size - lit_size), 2)
        rel_dev = round(100.0 * abs_dev / lit_size, 2)
        comparisons.append(
            ComparisonMetricItem(
                property_name="Average Grain/Particle Size",
                measured_value=meas_mean_size,
                literature_value=lit_size,
                unit=unit,
                absolute_deviation=abs_dev,
                relative_deviation_pct=rel_dev,
                comparable=True,
                reason_if_not_comparable=None,
            )
        )
    elif not is_calibrated:
        comparisons.append(
            ComparisonMetricItem(
                property_name="Average Grain/Particle Size",
                measured_value=meas_mean_size,
                literature_value=lit_size,
                unit="px",
                comparable=False,
                reason_if_not_comparable="스케일 캘리브레이션 미확정으로 문헌 물리량(nm/µm)과 직접 비교 불가",
            )
        )

    return {
        "instrument_type": "SEM",
        "is_calibrated": is_calibrated,
        "calibration_notes": calib_notes,
        "astm_notes": astm_notes,
        "porosity_stereology_warnings": porosity_warnings,
        "microstructure_chemical_guardrails": microstructure_rules,
        "comparisons": comparisons,
    }
