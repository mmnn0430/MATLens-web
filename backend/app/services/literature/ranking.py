"""Relevance Evaluation and Categorization for Scientific Literature (MatLens 2.0).

Categorizes references into:
1. Direct Experimental Comparison (직접 비교 가능)
2. Similar Composition / Processing (유사 조성 또는 유사 공정)
3. Same Material Family Indirect Evidence (동일 재료군의 간접 근거)
4. General Theoretical Background (일반 이론적 배경)
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def evaluate_paper_relevance(
    paper: Dict[str, Any],
    sample_composition: Optional[str] = None,
    material_name: Optional[str] = None,
    instrument: Optional[str] = None,
    temperature_C: Optional[float] = None,
    dopant: Optional[str] = None,
) -> Dict[str, Any]:
    """Computes a multi-factor relevance score (0 - 100) and assigns an academic comparison category."""
    score = 0.0
    scoring_breakdown: Dict[str, float] = {}

    title = (paper.get("title") or "").lower()
    composition = (paper.get("composition") or "").lower()
    material_sys = (paper.get("material_system") or "").lower()
    paper_instrument = (paper.get("instrument") or "").lower()
    text_corpus = f"{title} {composition} {material_sys} {' '.join(paper.get('key_claims', []))}".lower()

    # 1. Chemical Composition Similarity (0 - 40 pts)
    comp_target = (sample_composition or material_name or "").lower()
    if comp_target:
        comp_clean = re.sub(r"[^a-z0-9]", "", comp_target)
        if comp_clean in re.sub(r"[^a-z0-9]", "", composition) or comp_clean in re.sub(r"[^a-z0-9]", "", title):
            comp_score = 40.0
        elif any(elem in text_corpus for elem in re.findall(r"[A-Z][a-z]?", sample_composition or "")):
            comp_score = 25.0
        else:
            comp_score = 10.0
    else:
        comp_score = 20.0
    score += comp_score
    scoring_breakdown["composition_similarity"] = comp_score

    # 2. Instrument & Measurement Technique Match (0 - 25 pts)
    inst_score = 0.0
    if instrument:
        inst_clean = instrument.lower()
        if inst_clean in paper_instrument or inst_clean in text_corpus:
            inst_score = 25.0
        elif ("hall" in inst_clean and "mobility" in text_corpus) or ("lfa" in inst_clean and "diffusivity" in text_corpus):
            inst_score = 20.0
        else:
            inst_score = 5.0
    else:
        inst_score = 15.0
    score += inst_score
    scoring_breakdown["instrument_match"] = inst_score

    # 3. Dopant & Doping Similarity (0 - 15 pts)
    dop_score = 0.0
    if dopant and dopant.lower() in text_corpus:
        dop_score = 15.0
    elif dopant:
        dop_score = 3.0
    else:
        dop_score = 10.0
    score += dop_score
    scoring_breakdown["dopant_similarity"] = dop_score

    # 4. Temperature Condition Overlap (0 - 10 pts)
    temp_score = 5.0
    if temperature_C is not None:
        if str(int(round(temperature_C))) in text_corpus or "room temperature" in text_corpus:
            temp_score = 10.0
    score += temp_score
    scoring_breakdown["temperature_overlap"] = temp_score

    # 5. Open Access & Full Text Accessibility (0 - 10 pts)
    oa_score = 10.0 if paper.get("is_open_access") else 5.0
    score += oa_score
    scoring_breakdown["full_text_accessibility"] = oa_score

    # Categorization based on score and condition overlap
    if score >= 75.0 and inst_score >= 20.0:
        category_code = 1
        category_label = "Direct Experimental Comparison (직접 비교 가능)"
    elif score >= 55.0:
        category_code = 2
        category_label = "Similar Composition or Processing (유사 조성 또는 유사 공정)"
    elif score >= 35.0:
        category_code = 3
        category_label = "Same Material Family Indirect Evidence (동일 재료군의 간접 근거)"
    else:
        category_code = 4
        category_label = "General Theoretical Background (일반 이론적 배경)"

    return {
        "relevance_score": round(score, 1),
        "category_code": category_code,
        "category_label": category_label,
        "scoring_breakdown": scoring_breakdown,
    }


def rank_literature_references(
    references: List[Dict[str, Any]],
    sample_composition: Optional[str] = None,
    material_name: Optional[str] = None,
    instrument: Optional[str] = None,
    temperature_C: Optional[float] = None,
    dopant: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Evaluates and sorts all candidate literature references by scientific relevance."""
    ranked: List[Dict[str, Any]] = []

    for ref in references:
        eval_result = evaluate_paper_relevance(
            paper=ref,
            sample_composition=sample_composition,
            material_name=material_name,
            instrument=instrument,
            temperature_C=temperature_C,
            dopant=dopant,
        )
        ranked.append({
            **ref,
            **eval_result,
        })

    # Sort primarily by category_code (1 highest), then by relevance_score descending
    ranked.sort(key=lambda x: (x["category_code"], -x["relevance_score"]))
    return ranked
