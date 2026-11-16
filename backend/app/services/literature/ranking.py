"""Literature Relevance and Condition Compatibility Evaluation.

Evaluates candidates on 6 dimensions:
1. Material Composition Similarity
2. Crystal Structure / Microstructure Similarity
3. Experimental Method Similarity
4. Measurement Condition Compatibility
5. Target Property Relevance
6. Source Quality and Accessible Evidence Level

Strict scientific rule:
Do not assume direct comparability merely because materials belong to the same family.
If mandatory conditions mismatch, quantitative direct comparison is strictly restricted.
"""
from __future__ import annotations

import re
from typing import Any
from ...schemas_literature import (
    ConditionCompatibility,
    ConditionStatus,
    PaperMetadata,
    ReliabilityStatus,
)


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[A-Za-z0-9\.\-]+", text.lower()))


def evaluate_paper_relevance(
    paper: PaperMetadata,
    material_name: str,
    chemical_composition: str | None,
    instrument_type: str,
    target_property: str,
    measurement_conditions: dict[str, Any],
    literature_conditions: dict[str, Any] | None = None,
) -> tuple[float, ConditionCompatibility, ReliabilityStatus]:
    """Score paper relevance and determine whether direct quantitative comparison is allowed."""
    corpus = f"{paper.title} {paper.journal or ''} {paper.abstract or ''}".lower()
    mat_lower = material_name.lower().strip()
    comp_lower = (chemical_composition or "").lower().strip()

    # 1. Material Composition Similarity
    mat_score = 0.0
    if mat_lower in corpus:
        mat_score = 1.0
    elif comp_lower and comp_lower in corpus:
        mat_score = 0.9
    else:
        # Check token overlap
        mat_tokens = _tokenize(material_name)
        if mat_tokens:
            overlap = len([t for t in mat_tokens if t in corpus])
            mat_score = overlap / len(mat_tokens)

    # 2. Crystal / Microstructure Similarity
    struct_score = 0.5
    struct_keywords = ["cubic", "tetragonal", "hexagonal", "half-heusler", "anatase", "rutile", "f-43m", "grain", "particle", "austenite", "ferrite"]
    for kw in struct_keywords:
        if kw in corpus:
            struct_score = min(1.0, struct_score + 0.25)

    # 3. Experimental Method Similarity
    method_score = 0.0
    inst_lower = instrument_type.lower()
    if inst_lower == "xrd":
        if any(k in corpus for k in ["x-ray diffraction", "xrd", "powder diffraction", "diffractometer", "bragg", "lattice parameter"]):
            method_score = 1.0
        elif "diffraction" in corpus:
            method_score = 0.7
    elif inst_lower == "sem":
        if any(k in corpus for k in ["scanning electron", "sem", "microstructure", "grain size", "particle size", "porosity"]):
            method_score = 1.0
    elif inst_lower == "utm":
        if any(k in corpus for k in ["tensile", "stress-strain", "yield strength", "young's modulus", "utm", "astm e8", "elongation"]):
            method_score = 1.0
    else:
        method_score = 0.8

    # 4. Measurement Condition Compatibility
    mismatches: list[str] = []
    condition_status: ConditionStatus = "compatible"
    lit_cond = literature_conditions or {}

    # Temperature mismatch
    meas_temp = measurement_conditions.get("temperature_K") or measurement_conditions.get("test_temperature_K")
    lit_temp = lit_cond.get("temperature_K") or lit_cond.get("test_temperature_K")
    if meas_temp and lit_temp:
        if abs(float(meas_temp) - float(lit_temp)) > 25.0:
            mismatches.append(f"측정 온도 차이: 실측 {meas_temp} K vs 문헌 {lit_temp} K (열팽창 및 열활성화 차이 발생)")

    # X-ray Wavelength mismatch (XRD)
    meas_wl = measurement_conditions.get("wavelength_angstrom")
    lit_wl = lit_cond.get("wavelength_angstrom")
    if meas_wl and lit_wl and abs(float(meas_wl) - float(lit_wl)) > 0.01:
        mismatches.append(f"X선 파장 차이: 실측 {meas_wl} Å vs 문헌 {lit_wl} Å (Bragg 각도 직접 비교 시 2θ 보정 필수)")

    # Heat Treatment state mismatch (UTM)
    meas_ht = str(measurement_conditions.get("heat_treatment") or "").strip().lower()
    lit_ht = str(lit_cond.get("heat_treatment") or "").strip().lower()
    if meas_ht and lit_ht and meas_ht != lit_ht:
        mismatches.append(f"열처리 이력 불일치: 실측 '{meas_ht}' vs 문헌 '{lit_ht}' (항복강도·연신율의 직접 정량 비교 불가)")

    # Strain Rate mismatch (UTM)
    meas_sr = measurement_conditions.get("strain_rate_per_sec")
    lit_sr = lit_cond.get("strain_rate_per_sec")
    if meas_sr and lit_sr and abs(float(meas_sr) - float(lit_sr)) > 0.01:
        mismatches.append(f"변형률 속도 불일치: 실측 {meas_sr} /s vs 문헌 {lit_sr} /s")

    # 5. Target Property Relevance
    prop_score = 0.5
    if target_property:
        t_tokens = _tokenize(target_property)
        if any(t in corpus for t in t_tokens):
            prop_score = 1.0

    # 6. Source Quality & Evidence Level
    source_score = 0.7
    if paper.access_level == "full_text":
        source_score = 1.0
    elif paper.access_level == "abstract_only":
        source_score = 0.8
    if (paper.citation_count or 0) > 50:
        source_score = min(1.0, source_score + 0.1)

    # Determine condition compatibility & direct comparison permission
    direct_allowed = True
    warning = None
    if mismatches:
        if len(mismatches) >= 2 or any("열처리 이력 불일치" in m for m in mismatches):
            condition_status = "incompatible"
            direct_allowed = False
            warning = f"필수 실험 조건 불일치({'; '.join(mismatches)})로 인해 정량적 직접 비교가 엄격히 제한됩니다."
        else:
            condition_status = "conditionally_compatible"
            direct_allowed = True
            warning = f"조건 차이 주의: {'; '.join(mismatches)}"

    # Composite relevance score
    total_relevance = (
        0.30 * mat_score
        + 0.15 * struct_score
        + 0.20 * method_score
        + 0.15 * prop_score
        + 0.10 * source_score
        + (0.10 if not mismatches else 0.02)
    )
    total_relevance = round(min(1.0, max(0.0, total_relevance)), 3)

    # Determine comparison status
    if not direct_allowed:
        status: ReliabilityStatus = "Not Comparable"
    elif total_relevance >= 0.75 and not mismatches:
        status = "Supported"
    elif total_relevance >= 0.50:
        status = "Partially Supported"
    elif total_relevance < 0.35:
        status = "Insufficient Evidence"
    else:
        status = "Partially Supported"

    compat = ConditionCompatibility(
        material_similarity=round(mat_score, 2),
        crystal_or_micro_similarity=round(struct_score, 2),
        experimental_method_similarity=round(method_score, 2),
        condition_compatibility=condition_status,
        condition_mismatches=mismatches,
        direct_comparison_allowed=direct_allowed,
        direct_comparison_warning=warning,
    )

    return total_relevance, compat, status
