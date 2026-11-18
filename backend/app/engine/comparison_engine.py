"""Scientific Multi-Specimen Comparison & XRD-Guided SEM Cross-Analysis Engine.

Implements:
1. Experimental Question-Driven Specimen Grouping & Confounded Variable Detection:
   - process_variation: Same matrix, nominal composition, dopant & content; compares process conditions.
   - dopant_type: Same matrix & comparable process/content; compares dopant elements (with undoped control).
   - dopant_amount: Same matrix, dopant element & process; sorts by content ascending (checks unit compatibility & replicates).
2. Strict Specimen -> XRD Run -> SEM Field-of-View (FOV) Identifier Binding:
   - Never substitutes another specimen's image, previous run image, or example placeholder image.
   - Supports multiple SEM FOVs (e.g., A1, A2) per specimen and preserves selection across reordering, refresh, and export.
3. Rigorous XRD Peak, (hkl), Reference Pattern, and Secondary Phase Evidence Evaluation:
   - Distinguishes '측정 범위 밖 (out_of_range)' vs '미검출 (not_detected)'.
   - Evaluates secondary phase candidates by multi-reflection matching, missing strong reflections in range, and primary overlap.
   - Never confirms a secondary phase from a single weak peak alone.
4. 4-Step XRD-Guided SEM Interpretation:
   - Step 1 (XRD Clue) -> Step 2 (Target SEM Feature) -> Step 3 (Actual Observation) -> Step 4 (Limitations & Verification).
   - Strictly separates XRD Scherrer crystallite size (nm) from SEM particle/grain size.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any, Literal

import numpy as np

QuestionType = Literal["process_variation", "dopant_type", "dopant_amount"]

QUESTION_DEFINITIONS: dict[str, dict[str, str]] = {
    "process_variation": {
        "id": "process_variation",
        "question": "같은 조성에서 공정이 바뀌면 무엇이 달라지는가?",
        "criteria_summary": "명목 조성·도펀트·함량이 같은 시편에서 열처리 온도, 유지 시간, 분위기 등 선택한 공정 변수를 비교",
        "result_display_focus": "각 시편의 공정값(온도·시간·분위기)과 함께 기준 시편 대비 달라진 조건 및 복수 변수 변경 여부",
    },
    "dopant_type": {
        "id": "dopant_type",
        "question": "같은 모재에서 도펀트 종류가 바뀌면 무엇이 달라지는가?",
        "criteria_summary": "같은 모재와 가능한 한 같은 공정·동등한 함량 기준에서 도펀트 종류를 비교 (무도핑 대조군 포함)",
        "result_display_focus": "모재, 도펀트 종류, 함량과 단위, 무도핑 대조군 여부 및 공정 조건 일치성",
    },
    "dopant_amount": {
        "id": "dopant_amount",
        "question": "같은 모재에서 함량이 바뀌면 무엇이 달라지는가?",
        "criteria_summary": "같은 모재·도펀트(또는 첨가 성분)·공정에서 함량별 시편을 구성하여 함량 오름차순 비교",
        "result_display_focus": "함량 오름차순의 피크 이동·미세조직 변화 추세, 단위 호환성 및 반복 시편 간 편차",
    },
}


def infer_or_extract_experiment_meta(proj: dict[str, Any]) -> dict[str, Any]:
    """Extract explicit `experiment_meta` from project conditions, or infer structured fields
    from formula/description while tracking which fields are missing or unconfirmed.
    """
    cond = proj.get("current_conditions") or {}
    saved_meta = cond.get("experiment_meta") or {}

    sample_name = (proj.get("sample_name") or "").strip()
    desc = (proj.get("description") or "").strip()
    formula = (proj.get("expected_formula") or "").strip()
    elems = proj.get("expected_elements") or []
    is_demo = bool(proj.get("is_sample_demo", False) or saved_meta.get("is_synthetic_demo", False))

    text_blob = f"{sample_name} {formula} {desc}"

    # 1. Base matrix
    base_matrix = (saved_meta.get("base_matrix") or "").strip()
    if not base_matrix:
        for known in ("TiO2", "NbFeSb", "Al2O3", "ZnO", "SiO2", "BaTiO3", "SrTiO3", "Bi2Te3", "Fe2O3", "ZrO2", "Si"):
            if re.search(rf"\b{re.escape(known)}\b", text_blob, re.IGNORECASE) or known.upper() in formula.upper():
                base_matrix = known
                break
        if not base_matrix and formula:
            base_matrix = formula

    # 2. Nominal composition
    nominal_composition = (saved_meta.get("nominal_composition") or "").strip()
    if not nominal_composition:
        nominal_composition = formula or base_matrix

    # 3. Dopant element, amount, unit
    dopant_element = (saved_meta.get("dopant_element") or "").strip()
    dopant_amount = saved_meta.get("dopant_amount")
    dopant_unit = (saved_meta.get("dopant_unit") or "").strip()

    if dopant_amount is not None:
        try:
            dopant_amount = float(dopant_amount)
        except (TypeError, ValueError):
            dopant_amount = None

    if not dopant_element and dopant_amount is None:
        # Check for explicit undoped keywords
        if re.search(r"(무도핑|undoped|pure|0\s*at%|0\s*wt%|0\s*mol%)", text_blob, re.IGNORECASE):
            dopant_element = ""
            dopant_amount = 0.0
            dopant_unit = saved_meta.get("dopant_unit") or "at%"
        else:
            # e.g. "Nb 2 at%", "2 at% Nb", "Fe (5 wt%)", "Ti 5 at%"
            m1 = re.search(
                r"\b([A-Z][a-z]?)\s*[-:(]?\s*(\d+(?:\.\d+)?)\s*(at%|wt%|mol%|at\.%|wt\.%|mol\.%)",
                text_blob,
            )
            m2 = re.search(
                r"(\d+(?:\.\d+)?)\s*(at%|wt%|mol%|at\.%|wt\.%|mol\.%)\s*([A-Z][a-z]?)\b",
                text_blob,
            )
            if m1:
                dopant_element = m1.group(1)
                dopant_amount = float(m1.group(2))
                dopant_unit = m1.group(3).replace(".", "")
            elif m2:
                dopant_amount = float(m2.group(1))
                dopant_unit = m2.group(2).replace(".", "")
                dopant_element = m2.group(3)

    # 4. Process temperature (°C), time (h), atmosphere, method
    process_temp_c = saved_meta.get("process_temp_c")
    if process_temp_c is not None:
        try:
            process_temp_c = float(process_temp_c)
        except (TypeError, ValueError):
            process_temp_c = None
    if process_temp_c is None:
        mt = re.search(r"(\d{3,4}(?:\.\d+)?)\s*°?C\b", text_blob)
        if mt:
            process_temp_c = float(mt.group(1))

    process_time_h = saved_meta.get("process_time_h")
    if process_time_h is not None:
        try:
            process_time_h = float(process_time_h)
        except (TypeError, ValueError):
            process_time_h = None
    if process_time_h is None:
        mh = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|시간)\b", text_blob, re.IGNORECASE)
        if mh:
            process_time_h = float(mh.group(1))

    atmosphere = (saved_meta.get("atmosphere") or "").strip()
    if not atmosphere:
        for atm_kw, atm_std in [
            ("air", "Air"),
            ("대기", "Air"),
            ("ar", "Ar"),
            ("아르곤", "Ar"),
            ("vacuum", "Vacuum"),
            ("진공", "Vacuum"),
            ("n2", "N2"),
            ("질소", "N2"),
            ("h2", "H2/Ar"),
        ]:
            if re.search(rf"\b{re.escape(atm_kw)}\b", text_blob, re.IGNORECASE):
                atmosphere = atm_std
                break

    process_method = (saved_meta.get("process_method") or "").strip()
    if not process_method:
        for pm_kw, pm_std in [
            ("sps", "SPS"),
            ("방전플라즈마", "SPS"),
            ("calcination", "하소(Calcination)"),
            ("하소", "하소(Calcination)"),
            ("annealing", "열처리(Annealing)"),
            ("열처리", "열처리(Annealing)"),
            ("소둔", "열처리(Annealing)"),
            ("sintering", "소결(Sintering)"),
            ("소결", "소결(Sintering)"),
            ("as-cast", "As-Cast"),
        ]:
            if pm_kw in text_blob.lower():
                process_method = pm_std
                break

    replicate_id = (saved_meta.get("replicate_id") or "").strip()

    missing_fields: list[str] = []
    if not base_matrix:
        missing_fields.append("모재(base_matrix)")
    if not nominal_composition:
        missing_fields.append("명목 조성(nominal_composition)")
    if dopant_element and dopant_amount is None:
        missing_fields.append("도펀트 함량(dopant_amount)")
    if dopant_amount is not None and dopant_amount > 0 and not dopant_unit:
        missing_fields.append("함량 단위(dopant_unit: at%/wt%/mol%)")
    if process_temp_c is None:
        missing_fields.append("열처리/공정 온도(process_temp_c)")
    if process_time_h is None:
        missing_fields.append("유지 시간(process_time_h)")
    if not atmosphere:
        missing_fields.append("공정 분위기(atmosphere)")

    return {
        "base_matrix": base_matrix,
        "nominal_composition": nominal_composition,
        "dopant_element": dopant_element,
        "dopant_amount": dopant_amount,
        "dopant_unit": dopant_unit,
        "process_temp_c": process_temp_c,
        "process_time_h": process_time_h,
        "atmosphere": atmosphere,
        "process_method": process_method,
        "replicate_id": replicate_id,
        "is_synthetic_demo": is_demo,
        "explicitly_saved": bool(cond.get("experiment_meta")),
        "missing_fields": missing_fields,
        "expected_elements": elems,
    }


def _fmt_dopant(meta: dict[str, Any]) -> str:
    el = meta.get("dopant_element") or ""
    amt = meta.get("dopant_amount")
    unit = meta.get("dopant_unit") or ""
    if not el and (amt is None or amt == 0.0):
        return "무도핑 (0)"
    if amt is not None:
        return f"{el} {amt:g} {unit}".strip()
    return f"{el} (함량 미기재)"


def _fmt_process(meta: dict[str, Any]) -> str:
    parts = []
    if meta.get("process_method"):
        parts.append(str(meta["process_method"]))
    if meta.get("process_temp_c") is not None:
        parts.append(f"{meta['process_temp_c']:g} °C")
    if meta.get("process_time_h") is not None:
        parts.append(f"{meta['process_time_h']:g} h")
    if meta.get("atmosphere"):
        parts.append(str(meta["atmosphere"]))
    return " · ".join(parts) if parts else "공정 조건 미기재"


def compare_specimen_conditions(
    base_meta: dict[str, Any],
    cand_meta: dict[str, Any],
    question_type: QuestionType,
) -> dict[str, Any]:
    """Compare a candidate specimen's metadata against the baseline specimen for a given experimental question."""
    same_conds: list[str] = []
    changed_conds: list[str] = []
    needs_check: list[str] = []
    confounded_warnings: list[str] = []

    b_mat = (base_meta.get("base_matrix") or "").upper()
    c_mat = (cand_meta.get("base_matrix") or "").upper()

    # 1. Base matrix check
    if not b_mat or not c_mat:
        needs_check.append("모재(base_matrix) 정보가 누락되어 동일 계열 여부를 확인해야 합니다.")
        is_same_matrix = False
    elif b_mat != c_mat:
        return {
            "eligible": False,
            "exclusion_category": "unrelated_material",
            "exclusion_reason": f"모재 불일치 (기준 시편: {base_meta.get('base_matrix')} vs 후보 시편: {cand_meta.get('base_matrix')}) — 무관한 재료이므로 비교 후보에서 제외됨",
            "same_conditions": [],
            "changed_conditions": [f"모재: {base_meta.get('base_matrix')} → {cand_meta.get('base_matrix')}"],
            "needs_check_conditions": [],
            "confounded_warnings": [],
            "unit_compatible": False,
            "summary_sentence": f"무관한 재료({cand_meta.get('base_matrix')})로 기본 비교군에서 제외됨",
        }
    else:
        is_same_matrix = True
        same_conds.append(f"모재: {base_meta.get('base_matrix')}")

    # 2. Compare Dopant & Composition
    b_dop_el = (base_meta.get("dopant_element") or "").strip()
    c_dop_el = (cand_meta.get("dopant_element") or "").strip()
    b_amt = base_meta.get("dopant_amount")
    c_amt = cand_meta.get("dopant_amount")
    b_unit = (base_meta.get("dopant_unit") or "").strip()
    c_unit = (cand_meta.get("dopant_unit") or "").strip()

    b_is_undoped = (not b_dop_el) and (b_amt is None or b_amt == 0.0)
    c_is_undoped = (not c_dop_el) and (c_amt is None or c_amt == 0.0)

    same_dopant_el = (b_dop_el.upper() == c_dop_el.upper())
    unit_compatible = True
    if not b_is_undoped and not c_is_undoped:
        if b_unit and c_unit and b_unit.lower() != c_unit.lower():
            unit_compatible = False

    same_dopant_amt = False
    if b_is_undoped and c_is_undoped:
        same_dopant_amt = True
    elif same_dopant_el and unit_compatible and b_amt is not None and c_amt is not None and abs(b_amt - c_amt) < 1e-6:
        same_dopant_amt = True

    if same_dopant_el and same_dopant_amt:
        same_conds.append(f"조성/도펀트: {_fmt_dopant(base_meta)}")
    else:
        if b_dop_el.upper() != c_dop_el.upper():
            changed_conds.append(f"도펀트 종류: {b_dop_el or '무도핑'} → {c_dop_el or '무도핑'}")
        if not unit_compatible:
            changed_conds.append(f"함량 및 단위: {_fmt_dopant(base_meta)} → {_fmt_dopant(cand_meta)} (단위 기준 상이)")
            needs_check.append(
                f"함량 단위 기준이 다름 ({b_unit} vs {c_unit}) — 분모 및 밀도/원자량 환산 근거가 없으므로 동일 수치 축에 놓을 수 없음"
            )
        elif b_amt != c_amt:
            changed_conds.append(f"도펀트 함량: {_fmt_dopant(base_meta)} → {_fmt_dopant(cand_meta)}")

    # 3. Compare Process Parameters (Temperature, Time, Atmosphere, Method)
    b_temp = base_meta.get("process_temp_c")
    c_temp = cand_meta.get("process_temp_c")
    b_time = base_meta.get("process_time_h")
    c_time = cand_meta.get("process_time_h")
    b_atm = (base_meta.get("atmosphere") or "").strip()
    c_atm = (cand_meta.get("atmosphere") or "").strip()
    b_meth = (base_meta.get("process_method") or "").strip()
    c_meth = (cand_meta.get("process_method") or "").strip()

    changed_process_vars: list[str] = []

    if b_meth and c_meth:
        if b_meth.upper() == c_meth.upper():
            same_conds.append(f"공정 방법: {b_meth}")
        else:
            changed_conds.append(f"공정 방법: {b_meth} → {c_meth}")
            changed_process_vars.append(f"공정 방법이 {b_meth}→{c_meth}로 바뀌었고")
    elif not b_meth or not c_meth:
        needs_check.append("공정 방법(process_method) 확인 필요")

    if b_temp is not None and c_temp is not None:
        if abs(b_temp - c_temp) < 1e-4:
            same_conds.append(f"열처리 온도: {b_temp:g} °C")
        else:
            changed_conds.append(f"열처리 온도: {b_temp:g} → {c_temp:g} °C")
            changed_process_vars.append(f"열처리가 {b_temp:g}→{c_temp:g} °C로 바뀌었고")
    else:
        needs_check.append("열처리 온도(°C) 확인 필요")

    if b_time is not None and c_time is not None:
        if abs(b_time - c_time) < 1e-4:
            same_conds.append(f"유지 시간: {b_time:g} h")
        else:
            changed_conds.append(f"유지 시간: {b_time:g} → {c_time:g} h")
            changed_process_vars.append(f"유지 시간도 {b_time:g}→{c_time:g} h로 달라짐")
    else:
        needs_check.append("유지 시간(h) 확인 필요")

    if b_atm and c_atm:
        if b_atm.upper() == c_atm.upper():
            same_conds.append(f"분위기: {b_atm}")
        else:
            changed_conds.append(f"분위기: {b_atm} → {c_atm}")
            changed_process_vars.append(f"분위기가 {b_atm}→{c_atm}로 달라짐")
    else:
        needs_check.append("공정 분위기(Air/Ar/Vacuum 등) 확인 필요")

    # 4. Question-specific Eligibility & Confounding Logic
    eligible = True
    exclusion_category = None
    exclusion_reason = None

    if question_type == "process_variation":
        if not (same_dopant_el and same_dopant_amt):
            eligible = False
            exclusion_category = "composition_mismatch"
            exclusion_reason = (
                f"‘같은 조성에서 공정 비교’ 질문이나 조성/도펀트가 다름 "
                f"(기준: {_fmt_dopant(base_meta)} vs 후보: {_fmt_dopant(cand_meta)})"
            )
        else:
            if len(changed_process_vars) >= 2:
                joined_vars = " ".join(changed_process_vars)
                confounded_warnings.append(
                    f"같은 모재({base_meta.get('base_matrix')})에서 {joined_vars} — "
                    "복수의 공정 변수가 동시에 변경되었으므로 온도 또는 시간 하나의 단독 효과로 결론짓지 마십시오."
                )

    elif question_type == "dopant_type":
        # Must share same base matrix. Can be undoped control or another dopant element.
        if len(changed_process_vars) >= 1:
            confounded_warnings.append(
                f"도펀트 종류 변경과 함께 공정 조건({', '.join(changed_process_vars)})이 달라져 도펀트 고유 효과와 열처리 효과가 혼재할 수 있습니다."
            )
        if not b_is_undoped and not c_is_undoped:
            if not unit_compatible:
                confounded_warnings.append(
                    f"도펀트 함량 단위가 상이함 ({b_unit} vs {c_unit}) — 동등 함량 직접 비교 불가"
                )
            elif b_amt is not None and c_amt is not None and abs(b_amt - c_amt) > 1e-4:
                confounded_warnings.append(
                    f"도펀트 종류({b_dop_el} vs {c_dop_el})뿐만 아니라 함량({b_amt:g} vs {c_amt:g} {b_unit})도 함께 달라졌습니다."
                )

    elif question_type == "dopant_amount":
        # Must be same dopant element (or undoped 0% control of the same matrix)
        if not c_is_undoped and not b_is_undoped and not same_dopant_el:
            eligible = False
            exclusion_category = "dopant_element_mismatch"
            exclusion_reason = (
                f"‘같은 도펀트의 함량 변화’ 질문이나 도펀트 원소가 다름 "
                f"(기준: {b_dop_el} vs 후보: {c_dop_el})"
            )
        else:
            if not unit_compatible:
                confounded_warnings.append(
                    f"함량 단위 불일치 ({b_unit} vs {c_unit}) — 환산 근거가 없으므로 동일 함량 수치 축에 놓지 않고 별도 구분합니다."
                )
            if len(changed_process_vars) >= 1:
                confounded_warnings.append(
                    f"함량 변화와 함께 공정 조건({', '.join(changed_process_vars)})이 달라져 함량 단독 효과로 단정할 수 없습니다."
                )

    for mf in cand_meta.get("missing_fields", []):
        msg = f"후보 시편 메타데이터 미입력: {mf}"
        if msg not in needs_check:
            needs_check.append(msg)

    if confounded_warnings:
        summary_sentence = confounded_warnings[0]
    elif changed_conds:
        summary_sentence = f"같은 모재({base_meta.get('base_matrix')})에서 " + ", ".join(changed_conds)
    else:
        summary_sentence = f"같은 모재 및 동일 조건 (반복 측정/시편 비교)"

    return {
        "eligible": eligible,
        "is_same_matrix": is_same_matrix,
        "exclusion_category": exclusion_category,
        "exclusion_reason": exclusion_reason,
        "same_conditions": same_conds,
        "changed_conditions": changed_conds,
        "needs_check_conditions": needs_check,
        "confounded_warnings": confounded_warnings,
        "unit_compatible": unit_compatible,
        "summary_sentence": summary_sentence,
    }


def evaluate_all_candidates_for_question(
    projects_detail: list[dict[str, Any]],
    question_type: QuestionType,
    baseline_project_id: str | None = None,
) -> dict[str, Any]:
    """Evaluate all workspace projects for a selected experimental question, returning:
    - baseline project
    - eligible candidates (sorted appropriately for the question)
    - excluded candidates (with explicit reasons: unrelated material, different dopant, etc.)
    - dynamic report title & sorting explanation
    """
    q_def = QUESTION_DEFINITIONS.get(question_type, QUESTION_DEFINITIONS["process_variation"])

    if not projects_detail:
        return {
            "question": q_def,
            "baseline_project_id": None,
            "report_title": f"[{q_def['question']}] 비교 가능한 시편 데이터가 없습니다",
            "sorting_rule_description": "등록된 시편 없음",
            "eligible_candidates": [],
            "excluded_candidates": [],
            "recommended_project_ids": [],
            "empty_state_reason": "워크스페이스에 생성된 시편 프로젝트가 없습니다. 시편을 먼저 업로드하거나 검증 시리즈를 불러오세요.",
        }

    # Enrich each project with inferred/explicit experiment_meta
    enriched: list[dict[str, Any]] = []
    for p in projects_detail:
        meta = infer_or_extract_experiment_meta(p)
        enriched.append({**p, "experiment_meta": meta})

    # Choose baseline project intelligently when not specified
    base_proj = next((p for p in enriched if p["id"] == baseline_project_id), None)
    if base_proj is None:
        # Find the base_matrix that has the richest multi-specimen series
        matrix_counts: dict[str, int] = {}
        for p in enriched:
            bm = p["experiment_meta"].get("base_matrix") or ""
            if bm:
                matrix_counts[bm] = matrix_counts.get(bm, 0) + 1
        dominant_matrix = max(matrix_counts.items(), key=lambda kv: kv[1])[0] if matrix_counts else ""
        pool = [p for p in enriched if p["experiment_meta"].get("base_matrix") == dominant_matrix] if dominant_matrix else enriched

        if question_type in ("dopant_amount", "dopant_type"):
            # Find process_temp_c of doped specimens in this matrix so we pick the matching undoped control
            doped_in_pool = [p for p in pool if p["experiment_meta"].get("dopant_element")]
            ref_temp = doped_in_pool[0]["experiment_meta"].get("process_temp_c") if doped_in_pool else None
            undoped_matching = [
                p
                for p in pool
                if not p["experiment_meta"].get("dopant_element")
                and (p["experiment_meta"].get("dopant_amount") == 0.0)
                and (ref_temp is None or p["experiment_meta"].get("process_temp_c") == ref_temp)
            ]
            if undoped_matching:
                base_proj = undoped_matching[0]
            elif doped_in_pool:
                doped_in_pool.sort(key=lambda x: x["experiment_meta"].get("dopant_amount") or 0.0)
                base_proj = doped_in_pool[0]
            else:
                base_proj = pool[0]
        else:
            # process_variation: pick undoped specimen with valid process_temp_c (lowest temperature as baseline)
            with_temp = [
                p
                for p in pool
                if p["experiment_meta"].get("process_temp_c") is not None
                and not p["experiment_meta"].get("dopant_element")
            ]
            if not with_temp:
                with_temp = [p for p in pool if p["experiment_meta"].get("process_temp_c") is not None]
            with_temp.sort(key=lambda x: float(x["experiment_meta"]["process_temp_c"]))
            base_proj = with_temp[0] if with_temp else pool[0]

    base_meta = base_proj["experiment_meta"]

    # For dopant_amount, if baseline is undoped (0%), determine the target dopant element from matching matrix projects
    target_dopant_el = base_meta.get("dopant_element") or ""
    target_dopant_unit = base_meta.get("dopant_unit") or "at%"
    if question_type == "dopant_amount" and not target_dopant_el:
        for p in enriched:
            pm = p["experiment_meta"]
            if pm.get("base_matrix") == base_meta.get("base_matrix") and pm.get("dopant_element"):
                target_dopant_el = pm["dopant_element"]
                target_dopant_unit = pm.get("dopant_unit") or "at%"
                break

    effective_base_meta = dict(base_meta)
    if question_type == "dopant_amount" and target_dopant_el and not effective_base_meta.get("dopant_element"):
        effective_base_meta["dopant_element"] = target_dopant_el
        effective_base_meta["dopant_unit"] = target_dopant_unit

    eligible_list: list[dict[str, Any]] = []
    excluded_list: list[dict[str, Any]] = []

    for p in enriched:
        if p["id"] == base_proj["id"]:
            eligible_list.append(
                {
                    "project_id": p["id"],
                    "sample_name": p["sample_name"],
                    "description": p["description"],
                    "is_Baseline": True,
                    "is_synthetic_demo": p["experiment_meta"]["is_synthetic_demo"],
                    "experiment_meta": p["experiment_meta"],
                    "comparison_eval": {
                        "eligible": True,
                        "is_same_matrix": True,
                        "exclusion_category": None,
                        "exclusion_reason": None,
                        "same_conditions": [
                            f"모재: {base_meta.get('base_matrix') or '미기재'}",
                            f"조성/도펀트: {_fmt_dopant(base_meta)}",
                            f"공정: {_fmt_process(base_meta)}",
                        ],
                        "changed_conditions": ["기준 시편 (Baseline)"],
                        "needs_check_conditions": [
                            f"메타데이터 확인 필요: {mf}" for mf in base_meta.get("missing_fields", [])
                        ],
                        "confounded_warnings": [],
                        "unit_compatible": True,
                        "summary_sentence": "비교 기준 시편 (Baseline Control)",
                    },
                }
            )
            continue

        ev = compare_specimen_conditions(effective_base_meta, p["experiment_meta"], question_type)
        item = {
            "project_id": p["id"],
            "sample_name": p["sample_name"],
            "description": p["description"],
            "is_Baseline": False,
            "is_synthetic_demo": p["experiment_meta"]["is_synthetic_demo"],
            "experiment_meta": p["experiment_meta"],
            "comparison_eval": ev,
        }
        if ev["eligible"]:
            eligible_list.append(item)
        else:
            excluded_list.append(item)

    # Sort eligible_list according to the experimental question
    if question_type == "process_variation":
        eligible_list.sort(
            key=lambda item: (
                item["experiment_meta"].get("process_temp_c") is None,
                item["experiment_meta"].get("process_temp_c") or 0.0,
                item["experiment_meta"].get("process_time_h") or 0.0,
            )
        )
        sorting_desc = "공정 변수 오름차순 정렬 (열처리 온도 °C → 유지 시간 h 순)"
        mat_label = base_meta.get("nominal_composition") or base_meta.get("base_matrix") or "시료"
        report_title = f"[공정 변수 비교 리포트] {mat_label} ({_fmt_dopant(base_meta)}) — 열처리·공정 조건 변화에 따른 결정상 및 미세조직 비교"

    elif question_type == "dopant_type":
        def _dop_type_key(item: dict[str, Any]) -> tuple[int, str]:
            m = item["experiment_meta"]
            el = m.get("dopant_element") or ""
            amt = m.get("dopant_amount")
            is_undoped = (not el) and (amt is None or amt == 0.0)
            return (0 if is_undoped else 1, el)

        eligible_list.sort(key=_dop_type_key)
        sorting_desc = "무도핑 대조군(Control) 우선 배치 후 도펀트 원소 기호순 정렬"
        mat_label = base_meta.get("base_matrix") or "모재"
        report_title = f"[도펀트 종류 비교 리포트] {mat_label} 모재 — 도펀트 원소 종류별 결정상·피크 이동 및 미세조직 비교"

    else:  # dopant_amount
        def _dop_amt_key(item: dict[str, Any]) -> tuple[int, float, str]:
            m = item["experiment_meta"]
            ev = item["comparison_eval"]
            # Compatible unit first, sorted by numerical amount ascending; incompatible unit placed at end
            compat_rank = 0 if ev.get("unit_compatible", True) else 1
            amt = m.get("dopant_amount") if m.get("dopant_amount") is not None else 9999.0
            rep = m.get("replicate_id") or ""
            return (compat_rank, float(amt), rep)

        eligible_list.sort(key=_dop_amt_key)
        sorting_desc = f"동일 단위({target_dopant_unit}) 기준 도펀트 함량 오름차순 정렬 (단위 불일치 시편은 수치 축에서 분리)"
        mat_label = base_meta.get("base_matrix") or "모재"
        report_title = f"[도펀트 함량 비교 리포트] {mat_label}:{target_dopant_el or '첨가제'} ({target_dopant_unit}) — 함량 증가에 따른 격자 변화 및 미세조직 추세"

    # Compute replicate statistics for dopant_amount if replicates exist
    replicate_groups: list[dict[str, Any]] = []
    if question_type == "dopant_amount":
        by_amt: dict[tuple[float, str], list[str]] = {}
        for it in eligible_list:
            m = it["experiment_meta"]
            if it["comparison_eval"].get("unit_compatible") and m.get("dopant_amount") is not None:
                k = (float(m["dopant_amount"]), m.get("dopant_unit") or target_dopant_unit)
                by_amt.setdefault(k, []).append(it["sample_name"])
        for (amt_val, u_str), names in by_amt.items():
            if len(names) > 1:
                replicate_groups.append(
                    {
                        "amount": amt_val,
                        "unit": u_str,
                        "count": len(names),
                        "specimens": names,
                    }
                )

    empty_reason = None
    if len(eligible_list) <= 1:
        empty_reason = (
            f"선택한 실험 질문(‘{q_def['question']}’)과 기준 시편({base_proj['sample_name']})의 모재({base_meta.get('base_matrix')}) 조건에 부합하는 "
            f"비교 후보 시편이 없습니다. (제외된 무관/조건불일치 시편: {len(excluded_list)}개). "
            "시편 메타데이터(모재·도펀트·온도·시간)를 보완하거나 상단 ‘검증용 시편 시리즈 생성’ 버튼을 눌러 비교 분석을 테스트할 수 있습니다."
        )

    # Default recommended IDs: compatible eligible candidates with matching controlled conditions
    b_temp_ref = base_meta.get("process_temp_c")
    if question_type == "process_variation":
        recommended_ids = [
            it["project_id"]
            for it in eligible_list
            if it["experiment_meta"].get("process_temp_c") is not None
        ]
    elif question_type in ("dopant_amount", "dopant_type"):
        recommended_ids = [
            it["project_id"]
            for it in eligible_list
            if it["comparison_eval"].get("unit_compatible", True)
            and (b_temp_ref is None or it["experiment_meta"].get("process_temp_c") == b_temp_ref)
            and it["experiment_meta"].get("dopant_amount") is not None
        ]
        # For dopant_type, keep at most one specimen per dopant element in default recommended set
        if question_type == "dopant_type":
            seen_els: set[str] = set()
            dedup_ids: list[str] = []
            for it in eligible_list:
                if it["project_id"] not in recommended_ids:
                    continue
                el_k = (it["experiment_meta"].get("dopant_element") or "UNDOPED").upper()
                if el_k not in seen_els:
                    seen_els.add(el_k)
                    dedup_ids.append(it["project_id"])
            recommended_ids = dedup_ids
    else:
        recommended_ids = [
            it["project_id"]
            for it in eligible_list
            if it["comparison_eval"].get("unit_compatible", True)
        ]

    if not recommended_ids and eligible_list:
        recommended_ids = [it["project_id"] for it in eligible_list[:3]]

    return {
        "question": q_def,
        "baseline_project_id": base_proj["id"],
        "report_title": report_title,
        "sorting_rule_description": sorting_desc,
        "eligible_candidates": eligible_list,
        "excluded_candidates": excluded_list,
        "recommended_project_ids": recommended_ids,
        "replicate_groups": replicate_groups,
        "empty_state_reason": empty_reason,
    }


def evaluate_secondary_phase_evidence(
    xrd_result: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Rigorously evaluate secondary phase candidates in an XRD result:
    - Records reference source, ID, wavelength.
    - Checks whether multiple reflections match together.
    - Checks whether expected strong reflections (I_ref >= 25%) within the measured 2theta range are missing.
    - Checks whether matched peaks overlap with primary phase peaks.
    - Never confirms a secondary phase from a single weak peak alone!
    """
    if not xrd_result:
        return []
    pm = xrd_result.get("phase_matching") or {}
    cands = pm.get("candidates") or []
    if len(cands) < 2:
        return []

    peaks = [p for p in (xrd_result.get("peaks") or []) if not p.get("user_excluded")]
    tt_series = (xrd_result.get("series") or {}).get("two_theta") or []
    meas_min = float(min(tt_series)) if tt_series else 10.0
    meas_max = float(max(tt_series)) if tt_series else 80.0

    primary = cands[0]
    primary_explained_ids = set(primary.get("explained_peak_ids") or [])

    evaluations: list[dict[str, Any]] = []
    for sec in cands[1:5]:
        ref_2t = sec.get("ref_stick_two_theta") or []
        ref_I = sec.get("ref_stick_intensity") or []
        ref_hkl = sec.get("ref_stick_hkl") or []
        matched = sec.get("matched_peaks") or []

        # Separate matched peaks into: (a) unique to secondary phase vs (b) overlapping with primary phase
        unique_matched = [m for m in matched if m.get("peak_id") not in primary_explained_ids]
        overlapped_matched = [m for m in matched if m.get("peak_id") in primary_explained_ids]

        # Check strong reflections (I_ref >= 25%) inside [meas_min, meas_max]
        matched_hkl_set = {m.get("hkl") for m in matched}
        missing_strong_in_range: list[dict[str, Any]] = []
        out_of_range_strong: list[dict[str, Any]] = []

        for t0, ri, hkl_s in zip(ref_2t, ref_I, ref_hkl):
            if float(ri) >= 25.0:
                if meas_min <= float(t0) <= meas_max:
                    if hkl_s not in matched_hkl_set:
                        missing_strong_in_range.append(
                            {"two_theta": round(float(t0), 2), "rel_intensity": round(float(ri), 1), "hkl": hkl_s}
                        )
                else:
                    out_of_range_strong.append(
                        {"two_theta": round(float(t0), 2), "rel_intensity": round(float(ri), 1), "hkl": hkl_s}
                    )

        # Scientific Verdict
        if len(unique_matched) == 0:
            verdict_code = "overlapped_only"
            verdict_badge = "주상 반사 중첩 (독립 근거 없음)"
            rationale = (
                f"일치 반사 {len(matched)}개가 모두 주상({primary.get('name')}) 피크 위치와 중첩되어 "
                "이차상 존재의 독립적인 회절 근거가 없습니다."
            )
        elif len(unique_matched) == 1 and len(missing_strong_in_range) > 0:
            verdict_code = "unconfirmed_single_weak_missing_strong"
            verdict_badge = "단일 피크·강반사 누락 (이차상 미확정)"
            miss_str = ", ".join(f"{m['hkl']}({m['two_theta']}°)" for m in missing_strong_in_range[:3])
            rationale = (
                f"주상으로 설명되지 않는 단일 피크 1개({unique_matched[0].get('meas_two_theta')}°)만 부합하며, "
                f"측정 범위({meas_min:.1f}°~{meas_max:.1f}°) 내 예상 강반사({miss_str})가 검출되지 않았으므로 이차상으로 확정할 수 없습니다."
            )
        elif len(unique_matched) == 1:
            verdict_code = "unconfirmed_single_peak"
            verdict_badge = "단일 미소 피크 (확정 불가 — 보류)"
            rationale = (
                f"단일 피크({unique_matched[0].get('meas_two_theta')}°, {unique_matched[0].get('hkl')})만으로 이차상을 확정하지 않습니다. "
                "고통계 재측정 또는 국소 전자회절/EDS 확인이 필요합니다."
            )
        elif len(missing_strong_in_range) == 0 and len(unique_matched) >= 2:
            verdict_code = "supported_multi_reflection"
            verdict_badge = f"다중 반사 정합 ({len(unique_matched)}개 고유 반사 지지)"
            u_str = ", ".join(f"{m.get('hkl')}({m.get('meas_two_theta')}°)" for m in unique_matched[:4])
            rationale = (
                f"주상으로 설명되지 않는 고유 반사 {len(unique_matched)}개({u_str})가 함께 정합하고, "
                f"측정 범위 내 주요 강반사가 누락 없이 검출되어 이차상 후보로 지지됩니다."
            )
        else:
            verdict_code = "partial_candidate"
            verdict_badge = f"부분 정합 후보 (누락 강반사 {len(missing_strong_in_range)}개 확인 필요)"
            miss_str = ", ".join(f"{m['hkl']}({m['two_theta']}°)" for m in missing_strong_in_range[:3])
            rationale = (
                f"고유 반사 {len(unique_matched)}개가 일치하나, 측정 범위 내 강반사({miss_str})가 미검출 상태이므로 우선배향(Texture) 또는 타 후보상 가능성을 검토해야 합니다."
            )

        evaluations.append(
            {
                "phase_id": sec.get("phase_id"),
                "mp_id": sec.get("mp_id"),
                "name": sec.get("name"),
                "formula": sec.get("formula"),
                "spacegroup": sec.get("spacegroup"),
                "source": sec.get("source"),
                "wavelength_A": sec.get("search_wavelength_A", 1.5406),
                "measured_range_deg": [round(meas_min, 2), round(meas_max, 2)],
                "unique_matched_peaks": unique_matched,
                "overlapped_with_primary_peaks": overlapped_matched,
                "missing_strong_reflections_in_range": missing_strong_in_range,
                "out_of_range_strong_reflections": out_of_range_strong,
                "verdict_code": verdict_code,
                "verdict_badge": verdict_badge,
                "scientific_rationale": rationale,
            }
        )

    return evaluations


def build_full_comparison_report_data(
    question_type: QuestionType,
    baseline_project_id: str | None,
    requested_slots: list[dict[str, Any]],
    projects_by_id: dict[str, dict[str, Any]],
    runs_by_id: dict[str, dict[str, Any]],
    norm_mode: Literal["max_100", "raw"] = "max_100",
    offset_step: float = 115.0,
) -> dict[str, Any]:
    """Assemble the complete, traceable multi-specimen comparison & cross-instrument analysis dataset.
    Strictly preserves specimen -> XRD run -> SEM file binding without cross-specimen leakage or fake image fallbacks.
    """
    q_def = QUESTION_DEFINITIONS.get(question_type, QUESTION_DEFINITIONS["process_variation"])

    # Enrich all projects with experiment_meta
    for pid, proj in projects_by_id.items():
        proj["experiment_meta"] = infer_or_extract_experiment_meta(proj)

    base_proj = projects_by_id.get(baseline_project_id or "")
    if not base_proj and requested_slots:
        first_pid = requested_slots[0].get("project_id")
        base_proj = projects_by_id.get(first_pid or "")

    base_meta = base_proj["experiment_meta"] if base_proj else {}
    effective_base_meta = dict(base_meta)
    if question_type == "dopant_amount" and not effective_base_meta.get("dopant_element"):
        for s in requested_slots:
            p_cand = projects_by_id.get(s.get("project_id") or "")
            if p_cand and p_cand["experiment_meta"].get("dopant_element"):
                effective_base_meta["dopant_element"] = p_cand["experiment_meta"]["dopant_element"]
                effective_base_meta["dopant_unit"] = p_cand["experiment_meta"].get("dopant_unit") or "at%"
                break

    resolved_slots: list[dict[str, Any]] = []
    all_peaks_table: list[dict[str, Any]] = []
    stacked_traces: list[dict[str, Any]] = []

    palette = ["#1D4ED8", "#059669", "#D97706", "#7C3AED", "#DC2626", "#0891B2"]

    for idx, req_slot in enumerate(requested_slots):
        pid = req_slot.get("project_id")
        if not pid or pid not in projects_by_id:
            continue
        proj = projects_by_id[pid]
        meta = proj["experiment_meta"]
        files = proj.get("files") or []
        proj_runs = [runs_by_id[r["id"]] for r in (proj.get("runs") or []) if r["id"] in runs_by_id and runs_by_id[r["id"]]["status"] == "completed"]

        # Condition comparison vs baseline
        if base_proj and pid == base_proj["id"]:
            cond_eval = {
                "eligible": True,
                "is_same_matrix": True,
                "same_conditions": [
                    f"모재: {meta.get('base_matrix') or '미기재'}",
                    f"조성/도펀트: {_fmt_dopant(meta)}",
                    f"공정: {_fmt_process(meta)}",
                ],
                "changed_conditions": ["기준 시편 (Baseline Control)"],
                "needs_check_conditions": [f"확인 필요: {mf}" for mf in meta.get("missing_fields", [])],
                "confounded_warnings": [],
                "unit_compatible": True,
                "summary_sentence": "기준 시편 (Baseline Control)",
            }
        else:
            cond_eval = compare_specimen_conditions(effective_base_meta, meta, question_type)

        # 1. Resolve XRD Run & File for this slot
        req_xrd_run_id = req_slot.get("xrd_run_id")
        xrd_runs_avail = [r for r in proj_runs if r.get("xrd_result") is not None]
        sel_xrd_run = next((r for r in xrd_runs_avail if r["id"] == req_xrd_run_id), None)
        if sel_xrd_run is None and xrd_runs_avail:
            sel_xrd_run = xrd_runs_avail[0]

        xrd_files_avail = [f for f in files if f["file_role"] == "xrd"]
        sel_xrd_file = None
        if sel_xrd_run and sel_xrd_run.get("xrd_result", {}).get("source_file_id"):
            sfid = sel_xrd_run["xrd_result"]["source_file_id"]
            sel_xrd_file = next((f for f in xrd_files_avail if f["id"] == sfid), None)
        if sel_xrd_file is None and xrd_files_avail:
            sel_xrd_file = xrd_files_avail[-1]

        xrd_res = sel_xrd_run["xrd_result"] if sel_xrd_run else None
        sec_evals = evaluate_secondary_phase_evidence(xrd_res)

        # Build map of secondary phase verdicts by phase name
        sec_verdict_by_name = {ev["name"]: ev for ev in sec_evals}

        # 2. Resolve SEM File (Field of View A1, A2, ...) & Run for this slot
        sem_files_avail = [f for f in files if f["file_role"] == "sem"]
        req_sem_file_id = req_slot.get("sem_file_id")

        sel_sem_file = None
        if req_sem_file_id:
            # Strictly verify that req_sem_file_id belongs to THIS project!
            sel_sem_file = next((f for f in sem_files_avail if f["id"] == req_sem_file_id), None)
        if sel_sem_file is None and sem_files_avail:
            sel_sem_file = sem_files_avail[0]

        # Format available SEM FOV options for this specimen
        formatted_sem_files: list[dict[str, Any]] = []
        for f_idx, sf in enumerate(sem_files_avail):
            insp = sf.get("inspection") or {}
            fov_lbl = insp.get("fov_label") or f"시야 #{f_idx + 1} ({sf['original_filename']})"
            formatted_sem_files.append(
                {
                    "file_id": sf["id"],
                    "project_id": pid,
                    "original_filename": sf["original_filename"],
                    "fov_label": fov_lbl,
                    "imaging_mode": insp.get("imaging_mode", "SE"),
                    "magnification": insp.get("magnification", "배율 메타데이터 없음"),
                    "width": insp.get("width"),
                    "height": insp.get("height"),
                    "sha256": sf["sha256"],
                    "raw_url": f"/api/projects/{pid}/files/{sf['id']}/raw?sha={sf['sha256'][:10]}",
                }
            )

        # Check if there is a completed SEM run that analyzed THIS exact sel_sem_file
        sem_runs_avail = [r for r in proj_runs if r.get("sem_result") is not None]
        sel_sem_run = None
        if sel_sem_file:
            sel_sem_run = next(
                (
                    r
                    for r in sem_runs_avail
                    if r["sem_result"].get("source_file_id") == sel_sem_file["id"]
                    or r["sem_result"].get("source_sha256") == sel_sem_file["sha256"]
                ),
                None,
            )
            if sel_sem_run is None and len(sem_files_avail) == 1 and sem_runs_avail:
                sel_sem_run = sem_runs_avail[0]

        # Build strict SEM slot info (NO fallback to other specimens or sample images!)
        if sel_sem_file is None:
            sem_slot_info = {
                "has_image": False,
                "image_status": "no_uploaded_image",
                "status_message": f"시편 ‘{proj['sample_name']}’에 업로드된 SEM 이미지가 없습니다. (다른 시편이나 예시 이미지로 대체하지 않음)",
                "project_id": pid,
                "file_id": None,
                "run_id": None,
                "original_filename": None,
                "fov_label": "SEM 미업로드",
                "imaging_mode": None,
                "magnification": None,
                "sha256": None,
                "raw_image_url": None,
                "overlay_image_url": None,
                "roi_image_url": None,
                "scale_calibrated": False,
                "scale_summary": "SEM 데이터 없음",
                "segmentation_verified": False,
                "n_fov_analyzed": 0,
                "quant_metrics": None,
                "qualitative_notes": [],
            }
        else:
            sf_insp = sel_sem_file.get("inspection") or {}
            fov_lbl = sf_insp.get("fov_label") or sel_sem_file["original_filename"]
            img_mode = sf_insp.get("imaging_mode") or "SE"
            mag_str = sf_insp.get("magnification") or "배율 정보 미기재"
            raw_url = f"/api/projects/{pid}/files/{sel_sem_file['id']}/raw?sha={sel_sem_file['sha256'][:10]}"

            sem_res = sel_sem_run["sem_result"] if sel_sem_run else None
            ov_url = (
                f"/api/runs/{sel_sem_run['id']}/overlay.png?sha={sel_sem_file['sha256'][:10]}"
                if (sel_sem_run and sel_sem_run.get("has_overlay"))
                else None
            )
            roi_url = (
                f"/api/runs/{sel_sem_run['id']}/roi.png?sha={sel_sem_file['sha256'][:10]}"
                if (sel_sem_run and sel_sem_run.get("has_roi_image"))
                else None
            )

            sc_info = (sem_res.get("scale") if sem_res else None) or sf_insp.get("scale_override") or {}
            scale_cal = bool(sc_info.get("scale_confirmed")) and (sc_info.get("real_length") or 0) > 0
            seg_ver = bool(sem_res and sem_res.get("conditions", {}).get("segmentation_confirmed", True) and (sem_res.get("n_valid_objects", 0) >= 3 or sem_res.get("mode") == "grain"))

            if scale_cal:
                scale_summary = f"스케일 보정됨: {sc_info.get('real_length')} {sc_info.get('unit')} ({sc_info.get('length_px')} px)"
            else:
                scale_summary = "스케일 미보정 (px 단위 — 실측 µm/nm 정량 수치 생성 제한)"

            quant_metrics = None
            if scale_cal and sem_res:
                if sem_res.get("mode") == "particle" and sem_res.get("summary_stats"):
                    st = sem_res["summary_stats"]
                    quant_metrics = {
                        "mode": "particle",
                        "mode_label": "입자 분할 통계 (2D 투영 등가원 직경)",
                        "d10": st.get("d10"),
                        "d50": st.get("d50"),
                        "d90": st.get("d90"),
                        "mean": st.get("mean_diameter"),
                        "std": st.get("std_diameter"),
                        "unit": st.get("unit", sc_info.get("unit", "µm")),
                        "sample_count_n": st.get("sample_count_n", sem_res.get("n_valid_objects", 0)),
                        "median_aspect_ratio": st.get("median_aspect_ratio"),
                        "median_circularity": st.get("median_circularity"),
                        "fov_count": 1,
                        "used_image_filename": sel_sem_file["original_filename"],
                    }
                elif sem_res.get("mode") == "grain" and sem_res.get("grain_intercept"):
                    gi = sem_res["grain_intercept"]
                    if gi.get("mean_intercept_length") is not None:
                        quant_metrics = {
                            "mode": "grain",
                            "mode_label": "결정립 선형교차 길이 (ASTM E112 기반)",
                            "d50": gi.get("mean_intercept_length"),
                            "mean": gi.get("mean_intercept_length"),
                            "std": gi.get("std_intercept_length"),
                            "unit": gi.get("unit", sc_info.get("unit", "µm")),
                            "sample_count_n": gi.get("n_intersections", 0),
                            "n_test_lines": gi.get("n_lines", 0),
                            "fov_count": 1,
                            "used_image_filename": sel_sem_file["original_filename"],
                        }

            qual_notes = sf_insp.get("qualitative_notes") or []
            if not qual_notes:
                if img_mode == "BSE":
                    qual_notes.append("BSE(후방산란전자) 영상: 원자번호(Z) 대비 차이에 따른 밝기 분포 관찰 가능 (단, EDS 없이 대비만으로 특정 결정상 이름을 단정하지 않음)")
                else:
                    qual_notes.append("SE(이차전자) 영상: 표면 요철, 입자 형상, 응집 상태 및 결정립계 윤곽 관찰 가능")
                if not scale_cal:
                    qual_notes.append("스케일 바 실제 길이가 확정되지 않아 절대 입자 크기(nm/µm) 수치를 생성하지 않고 형태학적 특징만 기술함")

            sem_slot_info = {
                "has_image": True,
                "image_status": "ok",
                "status_message": "원본 SEM 이미지 연결 확인됨",
                "project_id": pid,
                "file_id": sel_sem_file["id"],
                "run_id": sel_sem_run["id"] if sel_sem_run else None,
                "original_filename": sel_sem_file["original_filename"],
                "fov_label": fov_lbl,
                "imaging_mode": img_mode,
                "magnification": mag_str,
                "width": sf_insp.get("width"),
                "height": sf_insp.get("height"),
                "sha256": sel_sem_file["sha256"],
                "raw_image_url": raw_url,
                "overlay_image_url": ov_url,
                "roi_image_url": roi_url,
                "scale_calibrated": scale_cal,
                "scale_summary": scale_summary,
                "segmentation_verified": seg_ver,
                "n_fov_analyzed": len(sem_files_avail),
                "quant_metrics": quant_metrics,
                "qualitative_notes": qual_notes,
                "eds_available": bool(sf_insp.get("eds_available", False)),
                "eds_summary": sf_insp.get("eds_summary"),
            }

        slot_id = f"slot_{idx + 1}_{pid}"
        color_hex = palette[idx % len(palette)]

        # 3. Build Stacked XRD Trace & Peak Markers for this slot
        xrd_slot_summary = None
        if xrd_res and xrd_res.get("series"):
            ser = xrd_res["series"]
            tt = ser.get("two_theta") or []
            raw_y = ser.get("raw_intensity") or []
            bg_y = ser.get("background") or []
            corr_y = ser.get("corrected_unsmoothed") or []

            base_signal = corr_y if corr_y else raw_y
            max_val = max(base_signal) if base_signal else 1.0
            if max_val <= 0:
                max_val = 1.0

            if norm_mode == "max_100":
                norm_signal = [round(100.0 * float(v) / max_val, 3) for v in base_signal]
                norm_raw = [round(100.0 * float(v) / max_val, 3) for v in raw_y]
                norm_bg = [round(100.0 * float(v) / max_val, 3) for v in bg_y]
                y_offset = round(idx * offset_step, 2)
            else:
                norm_signal = [round(float(v), 2) for v in base_signal]
                norm_raw = [round(float(v), 2) for v in raw_y]
                norm_bg = [round(float(v), 2) for v in bg_y]
                y_offset = round(idx * offset_step * 15.0, 2)

            stacked_y = [round(v + y_offset, 3) for v in norm_signal]
            stacked_raw_y = [round(v + y_offset, 3) for v in norm_raw]
            stacked_bg_y = [round(v + y_offset, 3) for v in norm_bg]

            cands = (xrd_res.get("phase_matching") or {}).get("candidates") or []
            primary_cand = cands[0] if (cands and cands[0].get("score", 0) >= 35.0) else None
            primary_matched_map = {
                m["peak_id"]: m for m in (primary_cand.get("matched_peaks") or [])
            } if primary_cand else {}

            # Secondary phase matched map
            sec_matched_map: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
            for sev in sec_evals:
                for m in sev.get("unique_matched_peaks") or []:
                    if m["peak_id"] not in sec_matched_map:
                        sec_matched_map[m["peak_id"]] = (sev, m)

            slot_peaks_annotated: list[dict[str, Any]] = []
            for p in xrd_res.get("peaks") or []:
                if p.get("user_excluded"):
                    continue
                pid_str = p["peak_id"]
                p_tt = float(p["two_theta"])
                p_uid = f"{slot_id}_{pid_str}"

                # Find corresponding y on stacked curve
                if tt:
                    nearest_idx = int(np.argmin(np.abs(np.asarray(tt, dtype=float) - p_tt)))
                    y_on_curve = stacked_y[nearest_idx]
                else:
                    y_on_curve = float(p.get("rel_intensity_pct", 50.0)) + y_offset

                # Fit stability / overlap status
                if p.get("is_overlapping"):
                    fit_badge = "중첩 피크 (분리 불확실)"
                elif p.get("fit_status") != "ok" or (p.get("snr") or 0) < 6.0:
                    fit_badge = f"저신호/피팅 불안정 (SNR={p.get('snr')})"
                else:
                    fit_badge = "정상 피팅"

                if pid_str in primary_matched_map:
                    m_info = primary_matched_map[pid_str]
                    phase_name = primary_cand["name"]
                    phase_formula = primary_cand["formula"]
                    hkl_str = m_info.get("hkl")
                    ref_tt = m_info.get("ref_two_theta")
                    delta_ref = (
                        m_info.get("delta_deg")
                        if m_info.get("delta_deg") is not None
                        else ((p_tt - float(ref_tt)) if ref_tt is not None else 0.0)
                    )
                    phase_role = "주상 (Primary Phase)"
                    marker_symbol = "circle"
                    marker_label = "●"
                    ref_source = primary_cand.get("source")
                    ref_id = primary_cand.get("mp_id") or primary_cand.get("phase_id")
                elif pid_str in sec_matched_map:
                    sev, m_info = sec_matched_map[pid_str]
                    phase_name = sev["name"]
                    phase_formula = sev["formula"]
                    hkl_str = m_info.get("hkl") if sev["verdict_code"] == "supported_multi_reflection" else f"{m_info.get('hkl')}?"
                    ref_tt = m_info.get("ref_two_theta")
                    delta_ref = (
                        m_info.get("delta_deg")
                        if m_info.get("delta_deg") is not None
                        else ((p_tt - float(ref_tt)) if ref_tt is not None else 0.0)
                    )
                    phase_role = f"이차상 후보 ({sev['verdict_badge']})"
                    marker_symbol = "diamond" if sev["verdict_code"] == "supported_multi_reflection" else "triangle-up"
                    marker_label = "◆" if sev["verdict_code"] == "supported_multi_reflection" else "△"
                    ref_source = sev.get("source")
                    ref_id = sev.get("mp_id") or sev.get("phase_id")
                else:
                    phase_name = "미할당 피크 (Unassigned)"
                    phase_formula = "-"
                    hkl_str = None  # Never attach fake (hkl) to unassigned peaks!
                    ref_tt = None
                    delta_ref = None
                    phase_role = "미할당 피크 (참조 근거 부족)"
                    marker_symbol = "x"
                    marker_label = "?"
                    ref_source = "-"
                    ref_id = "-"

                pk_entry = {
                    "peak_uid": p_uid,
                    "slot_id": slot_id,
                    "slot_index": idx + 1,
                    "project_id": pid,
                    "sample_name": proj["sample_name"],
                    "peak_id": pid_str,
                    "two_theta": round(p_tt, 4),
                    "ref_two_theta": round(float(ref_tt), 4) if ref_tt is not None else None,
                    "delta_ref_deg": round(float(delta_ref), 4) if delta_ref is not None else None,
                    "d_spacing_A": p.get("d_spacing_A"),
                    "rel_intensity_pct": p.get("rel_intensity_pct"),
                    "height_au": p.get("height"),
                    "area": p.get("area"),
                    "fwhm_deg": p.get("fwhm_deg"),
                    "snr": p.get("snr"),
                    "is_overlapping": bool(p.get("is_overlapping")),
                    "fit_status": p.get("fit_status"),
                    "fit_quality_badge": fit_badge,
                    "assigned_phase": phase_name,
                    "assigned_formula": phase_formula,
                    "assigned_hkl": hkl_str,
                    "phase_role": phase_role,
                    "marker_symbol": marker_symbol,
                    "marker_label": marker_label,
                    "reference_source": ref_source,
                    "reference_id": ref_id,
                    "y_on_stacked_curve": round(float(y_on_curve), 2),
                }
                slot_peaks_annotated.append(pk_entry)
                all_peaks_table.append(pk_entry)

            cond_xrd = xrd_res.get("conditions") or {}
            sch_obj = xrd_res.get("scherrer") or {}
            xrd_slot_summary = {
                "run_id": sel_xrd_run["id"],
                "run_number": sel_xrd_run["run_number"],
                "file_id": sel_xrd_file["id"] if sel_xrd_file else None,
                "original_filename": sel_xrd_file["original_filename"] if sel_xrd_file else "XRD 데이터",
                "sha256": sel_xrd_file["sha256"] if sel_xrd_file else None,
                "xray_source": cond_xrd.get("xray_source", "Cu Kα (1.5406 Å)"),
                "wavelength_A": cond_xrd.get("wavelength_angstrom", 1.5406),
                "wavelength_confirmed": bool(cond_xrd.get("wavelength_confirmed", True)),
                "two_theta_min": float(min(tt)) if tt else 10.0,
                "two_theta_max": float(max(tt)) if tt else 80.0,
                "step_deg": (xrd_res.get("inspection") or {}).get("median_step_deg", 0.02),
                "primary_phase": {
                    "name": primary_cand["name"],
                    "formula": primary_cand["formula"],
                    "spacegroup": primary_cand["spacegroup"],
                    "score": primary_cand["score"],
                    "source": primary_cand["source"],
                    "reference_id": primary_cand.get("mp_id") or primary_cand.get("phase_id"),
                    "shift_deg": primary_cand.get("shift_deg", 0.0),
                } if primary_cand else None,
                "secondary_phase_evaluations": sec_evals,
                "scherrer_mean_nm": sch_obj.get("mean_nm"),
                "scherrer_status": sch_obj.get("status"),
                "scherrer_is_inst_corrected": sch_obj.get("is_instrument_corrected", False),
                "peaks_count": len(slot_peaks_annotated),
                "unassigned_peaks_count": sum(1 for pk in slot_peaks_annotated if pk["assigned_hkl"] is None),
            }

            stacked_traces.append(
                {
                    "slot_id": slot_id,
                    "slot_index": idx + 1,
                    "project_id": pid,
                    "sample_name": proj["sample_name"],
                    "legend_label": f"[{idx + 1}] {proj['sample_name']} ({_fmt_process(meta)})",
                    "color": color_hex,
                    "y_offset": y_offset,
                    "two_theta": tt,
                    "stacked_intensity": stacked_y,
                    "stacked_raw_intensity": stacked_raw_y,
                    "stacked_background": stacked_bg_y,
                    "peaks": slot_peaks_annotated,
                }
            )

        resolved_slots.append(
            {
                "slot_id": slot_id,
                "slot_index": idx + 1,
                "project_id": pid,
                "sample_name": proj["sample_name"],
                "description": proj["description"],
                "is_synthetic_demo": meta["is_synthetic_demo"],
                "color": color_hex,
                "experiment_meta": meta,
                "condition_comparison": cond_eval,
                "available_xrd_runs": [
                    {"run_id": r["id"], "run_number": r["run_number"], "created_at": r["created_at"]}
                    for r in xrd_runs_avail
                ],
                "selected_xrd": xrd_slot_summary,
                "available_sem_files": formatted_sem_files,
                "selected_sem": sem_slot_info,
            }
        )

    # 4. Build Cross-Specimen Reflection Evolution Table (comparing corresponding reflections across slots)
    reflection_evolution = _build_reflection_evolution_table(resolved_slots, stacked_traces)

    # 5. Build 4-Step XRD-Guided SEM Cross-Analysis Cards
    cross_analysis_cards = _build_xrd_guided_sem_cards(resolved_slots, reflection_evolution, question_type)

    # 6. Compute Replicate Specimen Deviation Summary (if multiple slots share the same condition/content)
    replicate_deviations: list[dict[str, Any]] = []
    cond_buckets: dict[tuple[str, str, float, str, float | None], list[dict[str, Any]]] = {}
    for sl in resolved_slots:
        m = sl["experiment_meta"]
        if m.get("dopant_amount") is not None:
            key = (
                (m.get("base_matrix") or "").upper(),
                (m.get("dopant_element") or "").upper(),
                float(m["dopant_amount"]),
                (m.get("dopant_unit") or "").lower(),
                m.get("process_temp_c"),
            )
            cond_buckets.setdefault(key, []).append(sl)

    for (bmat, delm, damt, dunit, ptemp), grp_slots in cond_buckets.items():
        if len(grp_slots) >= 2:
            sch_vals = [
                float(s["selected_xrd"]["scherrer_mean_nm"])
                for s in grp_slots
                if s.get("selected_xrd") and s["selected_xrd"].get("scherrer_mean_nm") is not None
            ]
            shift_vals = [
                float(s["selected_xrd"]["primary_phase"]["shift_deg"])
                for s in grp_slots
                if s.get("selected_xrd") and s["selected_xrd"].get("primary_phase")
            ]
            sem_d50_vals = [
                float(s["selected_sem"]["quant_metrics"]["d50"])
                for s in grp_slots
                if s.get("selected_sem") and s["selected_sem"].get("quant_metrics") and s["selected_sem"]["quant_metrics"].get("d50") is not None
            ]
            replicate_deviations.append(
                {
                    "condition_label": f"{bmat}:{delm or '무도핑'} {damt:g} {dunit} ({ptemp or '-'} °C)",
                    "specimen_names": [s["sample_name"] for s in grp_slots],
                    "n_replicates": len(grp_slots),
                    "scherrer_mean_nm": round(float(np.mean(sch_vals)), 2) if sch_vals else None,
                    "scherrer_std_nm": round(float(np.std(sch_vals, ddof=1)), 2) if len(sch_vals) >= 2 else 0.0,
                    "shift_mean_deg": round(float(np.mean(shift_vals)), 4) if shift_vals else None,
                    "shift_std_deg": round(float(np.std(shift_vals, ddof=1)), 4) if len(shift_vals) >= 2 else 0.0,
                    "sem_d50_mean": round(float(np.mean(sem_d50_vals)), 2) if sem_d50_vals else None,
                    "sem_d50_std": round(float(np.std(sem_d50_vals, ddof=1)), 2) if len(sem_d50_vals) >= 2 else 0.0,
                }
            )

    return {
        "question": q_def,
        "baseline_project_id": base_proj["id"] if base_proj else None,
        "normalization_info": {
            "mode": norm_mode,
            "mode_label": "배경 보정 후 최대 피크 = 100 정규화 (Max=100)" if norm_mode == "max_100" else "배경 보정 원시 강도 (Raw Intensity, counts)",
            "offset_step": offset_step,
            "mass_fraction_warning": (
                "주의: 세로 오프셋 적층 그래프의 정규화된 피크 높이(0~100)는 시편 간 회절 위치(2θ)·반가폭(FWHM)·이차상 출현 여부를 "
                "비교하기 위한 것이며, RIR(Reference Intensity Ratio) 및 미소흡수 보정이 없으므로 정규화된 피크 높이 비율만으로 결정상 질량분율(wt%)을 계산하지 마십시오."
            ),
        },
        "slots": resolved_slots,
        "stacked_traces": stacked_traces,
        "all_peaks_table": all_peaks_table,
        "reflection_evolution": reflection_evolution,
        "cross_analysis_cards": cross_analysis_cards,
        "replicate_deviations": replicate_deviations,
    }


def _build_reflection_evolution_table(
    slots: list[dict[str, Any]],
    traces: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build a reflection-by-reflection comparison table across all ordered specimens.
    Explicitly distinguishes:
    - 'detected': peak found within match tolerance
    - 'not_detected': angle is inside specimen's [two_theta_min, two_theta_max], but peak was not detected
    - 'out_of_range': angle is outside specimen's measured [two_theta_min, two_theta_max]
    """
    if not traces:
        return []

    # Collect canonical reflections from all slots (grouped by phase+hkl or approximate 2theta within 0.45 deg)
    canonical_refs: list[dict[str, Any]] = []
    for tr in traces:
        for pk in tr.get("peaks") or []:
            tt = pk["two_theta"]
            hkl = pk.get("assigned_hkl")
            phase = pk.get("assigned_phase")
            # Try to match existing canonical reflection
            matched_canon = None
            for c in canonical_refs:
                if hkl and c["hkl"] == hkl and c["phase"] == phase:
                    matched_canon = c
                    break
                if abs(c["anchor_two_theta"] - tt) <= 0.42 and (not hkl or not c["hkl"] or c["hkl"] == hkl):
                    matched_canon = c
                    break
            if matched_canon is None:
                canonical_refs.append(
                    {
                        "reflection_id": f"ref_{len(canonical_refs) + 1}",
                        "anchor_two_theta": tt,
                        "ref_two_theta": pk.get("ref_two_theta"),
                        "phase": phase,
                        "hkl": hkl,
                        "phase_role": pk.get("phase_role"),
                        "marker_label": pk.get("marker_label", "●"),
                    }
                )

    canonical_refs.sort(key=lambda c: c["anchor_two_theta"])

    trace_by_slot = {tr["slot_id"]: tr for tr in traces}
    evolution_rows: list[dict[str, Any]] = []

    for canon in canonical_refs:
        anchor_tt = canon["anchor_two_theta"]
        per_specimen: list[dict[str, Any]] = []
        baseline_tt: float | None = None
        baseline_fwhm: float | None = None

        for s_idx, sl in enumerate(slots):
            sid = sl["slot_id"]
            xrd_info = sl.get("selected_xrd")
            tr = trace_by_slot.get(sid)
            if not xrd_info or not tr:
                per_specimen.append(
                    {
                        "slot_id": sid,
                        "sample_name": sl["sample_name"],
                        "status": "no_xrd",
                        "status_label": "XRD 미측정",
                    }
                )
                continue

            t_min = xrd_info["two_theta_min"]
            t_max = xrd_info["two_theta_max"]

            if anchor_tt < t_min or anchor_tt > t_max:
                per_specimen.append(
                    {
                        "slot_id": sid,
                        "sample_name": sl["sample_name"],
                        "status": "out_of_range",
                        "status_label": f"측정 범위 밖 ({t_min:.1f}°~{t_max:.1f}°)",
                    }
                )
                continue

            # Search peak in this trace
            cand_peaks = [
                pk
                for pk in (tr.get("peaks") or [])
                if (canon["hkl"] and pk.get("assigned_hkl") == canon["hkl"] and pk.get("assigned_phase") == canon["phase"])
                or abs(pk["two_theta"] - anchor_tt) <= 0.45
            ]
            if not cand_peaks:
                per_specimen.append(
                    {
                        "slot_id": sid,
                        "sample_name": sl["sample_name"],
                        "status": "not_detected",
                        "status_label": "미검출 (측정 범위 내)",
                    }
                )
                continue

            best_pk = min(cand_peaks, key=lambda p: abs(p["two_theta"] - anchor_tt))
            meas_tt = best_pk["two_theta"]
            meas_fwhm = best_pk.get("fwhm_deg")

            if baseline_tt is None:
                baseline_tt = meas_tt
            if baseline_fwhm is None and meas_fwhm is not None:
                baseline_fwhm = float(meas_fwhm)

            delta_vs_base = round(meas_tt - baseline_tt, 4) if baseline_tt is not None else 0.0
            delta_fwhm = (
                round(float(meas_fwhm) - baseline_fwhm, 4)
                if (meas_fwhm is not None and baseline_fwhm is not None)
                else None
            )

            per_specimen.append(
                {
                    "slot_id": sid,
                    "sample_name": sl["sample_name"],
                    "status": "detected",
                    "status_label": "검출됨",
                    "peak_uid": best_pk["peak_uid"],
                    "two_theta": meas_tt,
                    "delta_vs_baseline_deg": delta_vs_base,
                    "delta_vs_ref_deg": best_pk.get("delta_ref_deg"),
                    "fwhm_deg": meas_fwhm,
                    "delta_fwhm_deg": delta_fwhm,
                    "rel_intensity_pct": best_pk.get("rel_intensity_pct"),
                    "d_spacing_A": best_pk.get("d_spacing_A"),
                    "fit_quality_badge": best_pk.get("fit_quality_badge"),
                }
            )

        evolution_rows.append(
            {
                **canon,
                "per_specimen": per_specimen,
            }
        )

    return evolution_rows


def _build_xrd_guided_sem_cards(
    slots: list[dict[str, Any]],
    reflection_evolution: list[dict[str, Any]],
    question_type: QuestionType,
) -> list[dict[str, Any]]:
    """Construct structured 4-step XRD-guided SEM interpretation cards:
    Step 1: XRD에서 얻은 단서 (XRD Clue)
    Step 2: 같은 시편의 SEM에서 확인할 특징 (Target SEM Feature)
    Step 3: 실제 관찰 (Actual SEM Observation)
    Step 4: 해석의 한계 및 추가 확인 방법 (Limitations & Next Verification)
    """
    cards: list[dict[str, Any]] = []
    if not slots:
        return cards

    base_slot = slots[0]
    base_xrd = base_slot.get("selected_xrd")

    for sl in slots:
        sid = sl["slot_id"]
        sname = sl["sample_name"]
        meta = sl["experiment_meta"]
        xrd = sl.get("selected_xrd")
        sem = sl.get("selected_sem") or {}
        cond_diff = sl.get("condition_comparison") or {}

        observed_facts: list[str] = []
        possible_interps: list[str] = []
        verification_methods: list[str] = []

        # --- Step 1: XRD Clue ---
        xrd_link_peak_uid = None
        xrd_link_window = [20.0, 60.0]

        if not xrd:
            step1_xrd = f"시편 ‘{sname}’에는 XRD 측정 데이터가 없어 회절 단서를 추출할 수 없습니다."
        else:
            prim = xrd.get("primary_phase")
            sec_evals = xrd.get("secondary_phase_evaluations") or []
            supported_secs = [e for e in sec_evals if e["verdict_code"] == "supported_multi_reflection"]
            single_weak_secs = [e for e in sec_evals if "single" in e["verdict_code"]]
            sch_nm = xrd.get("scherrer_mean_nm")

            clue_parts = []
            if prim:
                shift_str = f"Δ2θ = {prim.get('shift_deg', 0.0):+.3f}°"
                clue_parts.append(
                    f"주상으로 {prim['name']} ({prim['formula']}, [{prim['spacegroup']}], 참조: {prim['reference_id']})가 동정되었으며({shift_str})"
                )
                observed_facts.append(
                    f"[XRD 관찰 사실] {sname}: 주상 {prim['name']} ({prim['formula']}) 정합 (기준 패턴 대비 평균 위치 이동 {shift_str})."
                )
            if sch_nm is not None:
                clue_parts.append(f"비평활 피크 폭에서 추정한 평균 Scherrer 결정자 크기는 {sch_nm:.1f} nm입니다")
                if base_xrd and base_xrd.get("scherrer_mean_nm") and sl["slot_index"] > 1:
                    b_nm = base_xrd["scherrer_mean_nm"]
                    clue_parts.append(f"(기준 시편 {b_nm:.1f} nm 대비 {sch_nm - b_nm:+.1f} nm 변화)")
                observed_facts.append(
                    f"[XRD 관찰 사실] {sname}: Scherrer 평균 결정자 크기 추정치 = {sch_nm:.1f} nm (단결정 간섭 산란 도메인 크기이며 SEM 입자 크기와 별개 항목임)."
                )

            if supported_secs:
                sec0 = supported_secs[0]
                u_pks = sec0.get("unique_matched_peaks") or []
                pk_desc = ", ".join(f"{m.get('hkl')}({m.get('meas_two_theta')}°)" for m in u_pks[:3])
                clue_parts.append(
                    f"특히 이차상 후보인 {sec0['name']} ({sec0['formula']})의 고유 반사 {len(u_pks)}개({pk_desc})가 함께 검출되었습니다"
                )
                if u_pks:
                    t_center = float(u_pks[0].get("meas_two_theta", 27.5))
                    xrd_link_window = [round(t_center - 3.0, 1), round(t_center + 3.0, 1)]
                observed_facts.append(
                    f"[XRD 관찰 사실] {sname}: 이차상 후보 {sec0['name']}의 다중 반사({pk_desc})가 측정 범위 내에서 누락 없이 검출됨."
                )
            elif single_weak_secs:
                sw0 = single_weak_secs[0]
                u_pks = sw0.get("unique_matched_peaks") or []
                t_val = u_pks[0].get("meas_two_theta") if u_pks else "-"
                clue_parts.append(
                    f"2θ = {t_val}° 부근에서 미소 피크 1개가 관찰되었으나 단일 약피크만으로는 이차상({sw0['name']})을 확정하지 않고 미할당/보류로 분류했습니다"
                )
                if u_pks:
                    t_center = float(u_pks[0].get("meas_two_theta", 29.0))
                    xrd_link_window = [round(t_center - 3.0, 1), round(t_center + 3.0, 1)]
                observed_facts.append(
                    f"[XRD 관찰 사실] {sname}: 2θ = {t_val}° 단일 미소 피크 검출 (다중 반사 근거 부족으로 이차상 미확정)."
                )
            elif xrd.get("unassigned_peaks_count", 0) > 0:
                clue_parts.append(
                    f"주상으로 설명되지 않는 미할당 약피크 {xrd['unassigned_peaks_count']}개가 존재합니다"
                )

            step1_xrd = ". ".join(clue_parts) + "."

        # Find first peak_uid for this slot to link
        for row in reflection_evolution:
            for ps in row.get("per_specimen") or []:
                if ps.get("slot_id") == sid and ps.get("peak_uid"):
                    if xrd_link_peak_uid is None:
                        xrd_link_peak_uid = ps["peak_uid"]

        # --- Step 2: Target SEM Feature to Check ---
        img_mode = sem.get("imaging_mode") or "SE"
        has_sec = bool(xrd and any(e["verdict_code"] == "supported_multi_reflection" for e in (xrd.get("secondary_phase_evaluations") or [])))
        if not sem.get("has_image"):
            step2_target = (
                "XRD에서 추정한 결정성·상 변화가 실제 입자 조대화, 응집, 또는 이상(heterophase) 형태 변화로 나타나는지 확인하기 위해 "
                "동일 시편의 SEM 영상(SE 표면 형상 및 BSE 원자번호 대비) 확보가 필요합니다."
            )
        elif img_mode == "BSE":
            step2_target = (
                f"선택된 SEM 영상({sem.get('fov_label')})은 BSE(후방산란전자) 모드입니다. "
                + (
                    "XRD에서 검출된 이차상 후보와 관련하여 평균 원자번호(Z) 차이에 의한 밝기 대비(Contrast) 분리 영역이 입계나 국소 영역에 분포하는지 확인합니다."
                    if has_sec
                    else "단일상 주상 내부에 조성 불균일이나 미검출 이차상에 의한 국소 밝기 대비 영역 및 기공 분포가 존재하는지 확인합니다."
                )
            )
        else:
            step2_target = (
                f"선택된 SEM 영상({sem.get('fov_label')})은 SE(이차전자) 모드이므로 원자번호 대비만으로 상을 구분할 수 없습니다. "
                + (
                    "대신 XRD에서 관찰된 상전이/이차상 출현 및 결정자 크기 변화에 대응하여, 대조 시편 대비 입자 크기 조대화(Coarsening), 목 형성(Necking/응집), 또는 상이한 결정 습성(Morphology)을 가진 입자군이 나타나는지 확인합니다."
                    if has_sec
                    else "XRD 피크 폭 및 위치 변화에 대응하여 입자/결정립 크기 분포, 구형도·종횡비 변화, 표면 응집 상태를 대조 시편과 비교합니다."
                )
            )

        # --- Step 3: Actual SEM Observation ---
        qm = sem.get("quant_metrics")
        if not sem.get("has_image"):
            step3_obs = f"시편 ‘{sname}’에는 업로드된 SEM 이미지가 없어 미세조직 관찰 결과를 생성하지 않습니다."
        elif qm is not None:
            step3_obs = (
                f"원본 파일 ‘{sem.get('original_filename')}’ ({sem.get('fov_label')}, {img_mode} 모드, {sem.get('scale_summary')}) 분석 결과, "
                f"측정 시야 {qm.get('fov_count', 1)}개에서 검출된 대상 N={qm.get('sample_count_n')}개의 중앙 크기(D50)는 "
                f"{qm.get('d50')} {qm.get('unit')} (평균 {qm.get('mean')} ± {qm.get('std')} {qm.get('unit')})로 측정되었습니다. "
            )
            if xrd and xrd.get("scherrer_mean_nm") is not None:
                step3_obs += (
                    f"(비교: XRD Scherrer 결정자 크기 {xrd['scherrer_mean_nm']:.1f} nm와 SEM 실측 크기 {qm.get('d50')} {qm.get('unit')}는 "
                    "각각 간섭 산란 도메인 크기와 물리적 입자/결정립 경계 크기로 별개 관리됨)."
                )
            observed_facts.append(
                f"[SEM 관찰 사실] {sname} ({sem.get('original_filename')}, N={qm.get('sample_count_n')}, 시야 {qm.get('fov_count', 1)}개): "
                f"D50 = {qm.get('d50')} {qm.get('unit')}, 평균 = {qm.get('mean')} ± {qm.get('std')} {qm.get('unit')}."
            )
            possible_interps.append(
                f"[가능한 해석] {cond_diff.get('summary_sentence', '실험 조건 변화')}에 따라 입자/결정립 성장 및 응집도가 변화했으며, "
                "SEM 입자 크기가 XRD 결정자 크기보다 큰 것은 1개의 SEM 입자 내부에 복수의 아결정립(Sub-grain domain)이 포함된 다결정 응집 구조일 가능성을 시사합니다."
            )
        else:
            # Uncalibrated scale or qualitative-only
            q_notes_str = " ".join(sem.get("qualitative_notes") or [])
            step3_obs = (
                f"원본 파일 ‘{sem.get('original_filename')}’ ({sem.get('fov_label')}, {img_mode} 모드)에서 표면 입자 형상과 응집 분포를 관찰했습니다. "
                f"현재 {sem.get('scale_summary')} 상태이므로 근거 없는 크기 수치(nm/µm)를 생성하지 않으며, {q_notes_str}"
            )
            observed_facts.append(
                f"[SEM 관찰 사실] {sname} ({sem.get('original_filename')}): 스케일 미보정 상태로 정량 치수 산출을 보류하고 시야 내 입자 형상·응집 상태만 기록함."
            )
            verification_methods.append(
                f"[추가 확인 방법] ‘{sem.get('original_filename')}’의 스케일 바 실제 길이와 단위를 확인·입력하면 D10/D50/D90 정량 분포를 산출할 수 있습니다."
            )

        # --- Step 4: Limitations & Verification ---
        lim_parts = [
            "XRD는 시편 조사 부피 전체(수 mm² × 수십 µm 깊이)의 평균 회절 신호인 반면, SEM은 선택한 국소 시야(FOV)의 표면 관찰입니다. 따라서 XRD에서 이차상 후보가 검출되더라도 특정 국소 SEM 시야에서 뚜렷한 이상 영역이 보이지 않는 경우(또는 국소 편석이 XRD 검출 한계 미만인 경우)는 정상적인 분석 결과입니다.",
            "SEM 영상의 밝기 대비(Contrast)나 입자 형상 차이만으로 특정 영역에 결정상 이름을 부여할 수 없습니다.",
        ]
        if sem.get("eds_available") and sem.get("eds_summary"):
            lim_parts.append(f"연결된 EDS 원소 분석 근거: {sem['eds_summary']}")
            observed_facts.append(f"[EDS 관찰 사실] {sem['eds_summary']}")
        else:
            lim_parts.append("현재 시야에 연결된 EDS 원소 맵핑 데이터가 없으므로, 후보 상의 화학 조성 편석 여부는 EDS 또는 미소영역 회절(EBSD/TEM-SAED)로 별도 검증해야 합니다.")
            verification_methods.append(
                "[추가 확인 방법] SEM-EDS 원소 맵핑 또는 점 분석을 수행하여 국소 영역의 원소 비율이 XRD 후보 상의 화학량론과 일치하는지 검증하십시오."
            )

        if cond_diff.get("confounded_warnings"):
            for cw in cond_diff["confounded_warnings"]:
                lim_parts.append(f"실험 설계 주의사항: {cw}")
                verification_methods.append(
                    "[추가 확인 방법] 동시 변경된 공정 변수를 하나씩 고정한 단일 변수 대조 시편(Single-variable control)을 추가 측정하여 개별 변수의 효과를 분리하십시오."
                )

        if not possible_interps:
            possible_interps.append(
                f"[가능한 해석] {sname}의 XRD 회절 특성과 SEM 표면 관찰 결과를 종합할 때, 공정/조성 조건에 따른 결정성 변화와 표면 입자 배열 변화가 함께 진행되었을 가능성이 있습니다."
            )

        cards.append(
            {
                "slot_id": sid,
                "slot_index": sl["slot_index"],
                "project_id": sl["project_id"],
                "sample_name": sname,
                "condition_summary": cond_diff.get("summary_sentence"),
                "step1_xrd_clue": step1_xrd,
                "step2_sem_target": step2_target,
                "step3_actual_observation": step3_obs,
                "step4_limitations": " ".join(lim_parts),
                "observed_facts": observed_facts,
                "possible_interpretations": possible_interps,
                "verification_methods": verification_methods,
                "evidence_links": {
                    "xrd_link": {
                        "slot_id": sid,
                        "peak_uid": xrd_link_peak_uid,
                        "two_theta_window": xrd_link_window,
                        "label": f"{sname} XRD 피크/구간({xrd_link_window[0]}°~{xrd_link_window[1]}°)으로 이동",
                    },
                    "sem_link": {
                        "slot_id": sid,
                        "sem_file_id": sem.get("file_id"),
                        "fov_label": sem.get("fov_label"),
                        "label": f"{sname} SEM 원본({sem.get('fov_label')}) 카드로 이동",
                    },
                },
            }
        )

    return cards
