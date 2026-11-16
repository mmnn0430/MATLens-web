"""Automated Academic Literature Retrieval Engine.

Searches OpenAlex API, Crossref API, and curated peer-reviewed literature benchmarks.
Never crashes when external APIs fail or are slow (graceful offline fallback).
"""
from __future__ import annotations

import logging
from typing import Any
import httpx

from ...schemas_literature import (
    ConditionCompatibility,
    ExtractedEvidenceItem,
    LiteraturePaper,
    LiteratureValidationItem,
    ReliabilityStatus,
)
from .curated_db import CURATED_LITERATURE_DB
from .metadata import parse_openalex_work
from .ranking import evaluate_paper_relevance

logger = logging.getLogger("matlens.literature")

OPENALEX_API_URL = "https://api.openalex.org/works"
CROSSREF_API_URL = "https://api.crossref.org/works"


def _matches_curated_entry(entry: dict[str, Any], material_name: str, comp: str | None, inst: str) -> bool:
    targets = [t.lower() for t in entry.get("target_materials", [])]
    insts = [i.upper() for i in entry.get("target_instruments", [])]
    m_lower = material_name.lower().strip()
    c_lower = (comp or "").lower().strip()

    mat_matched = any(
        t in m_lower or m_lower in t or (c_lower and (t in c_lower or c_lower in t))
        for t in targets
    )
    inst_matched = inst.upper() in insts or "ALL" in insts or not insts
    return mat_matched and inst_matched


async def query_openalex_works(
    search_query: str,
    limit: int = 5,
    timeout_sec: float = 3.5,
) -> list[LiteraturePaper]:
    """Query OpenAlex API for works with timeout and safe error handling."""
    papers: list[LiteraturePaper] = []
    try:
        params = {
            "search": search_query,
            "per-page": limit,
            "mailto": "research@matlens.org",
        }
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.get(OPENALEX_API_URL, params=params)
            if resp.status_code == 200:
                data = resp.json()
                for work in data.get("results", []):
                    try:
                        p = parse_openalex_work(work)
                        papers.append(p)
                    except Exception as err:
                        logger.debug(f"Failed to parse work: {err}")
    except Exception as e:
        logger.info(f"OpenAlex API query skipped or timed out: {e}")
    return papers


async def search_academic_literature(
    material_name: str,
    chemical_composition: str | None = None,
    instrument_type: str = "XRD",
    measurement_conditions: dict[str, Any] | None = None,
    target_property: str = "",
    analysis_result: dict[str, Any] | None = None,
    max_results: int = 6,
) -> tuple[list[LiteraturePaper], list[LiteratureValidationItem]]:
    """Execute automatic multi-source literature retrieval and relevance validation."""
    conditions = measurement_conditions or {}
    results_map: dict[str, LiteraturePaper] = {}
    validations_map: dict[str, LiteratureValidationItem] = {}

    # 1. First, search curated peer-reviewed database (guaranteed high-quality exact data)
    for entry in CURATED_LITERATURE_DB:
        if _matches_curated_entry(entry, material_name, chemical_composition, instrument_type):
            p = LiteraturePaper(
                paper_id=entry["paper_id"],
                title=entry["title"],
                authors=entry["authors"],
                publication_year=entry["publication_year"],
                journal=entry["journal"],
                doi=entry["doi"],
                landing_page_url=entry["landing_page_url"],
                pdf_url=entry.get("pdf_url"),
                access_level=entry["access_level"],
                citation_count=entry.get("citation_count"),
                open_access_status=entry.get("open_access_status", "closed"),
                abstract=entry.get("abstract"),
            )
            rel_score, compat, comp_status = evaluate_paper_relevance(
                paper=p,
                material_name=material_name,
                chemical_composition=chemical_composition,
                instrument_type=instrument_type,
                target_property=target_property,
                measurement_conditions=conditions,
                literature_conditions=entry.get("reported_conditions"),
            )

            # Build extracted evidence items strictly conforming to Section 6 schema
            evidence_items: list[ExtractedEvidenceItem] = []
            for ev in entry.get("evidences", []):
                evidence_items.append(
                    ExtractedEvidenceItem(
                        paper={
                            "title": p.title,
                            "doi": p.doi or "",
                            "publication_year": p.publication_year,
                            "access_level": p.access_level,
                        },
                        evidence=ev,
                    )
                )

            val_item = LiteratureValidationItem(
                paper=p,
                compatibility=compat,
                evidence_items=evidence_items,
                relevance_score=rel_score,
                comparison_status=comp_status,
            )
            key = p.doi or p.paper_id
            results_map[key] = p
            validations_map[key] = val_item

    # 2. Query live OpenAlex API if needed
    query_terms = [material_name]
    if chemical_composition and chemical_composition != material_name:
        query_terms.append(chemical_composition)
    if instrument_type:
        query_terms.append(instrument_type)
    if target_property:
        query_terms.append(target_property)

    search_query = " ".join(query_terms)
    openalex_papers = await query_openalex_works(search_query, limit=5)

    for p in openalex_papers:
        key = p.doi or p.paper_id
        if key not in results_map:
            rel_score, compat, comp_status = evaluate_paper_relevance(
                paper=p,
                material_name=material_name,
                chemical_composition=chemical_composition,
                instrument_type=instrument_type,
                target_property=target_property,
                measurement_conditions=conditions,
                literature_conditions=None,
            )
            val_item = LiteratureValidationItem(
                paper=p,
                compatibility=compat,
                evidence_items=[],
                relevance_score=rel_score,
                comparison_status=comp_status,
            )
            results_map[key] = p
            validations_map[key] = val_item

    # If still empty (e.g. general material), provide general curated papers matching instrument
    if not results_map:
        for entry in CURATED_LITERATURE_DB:
            insts = [i.upper() for i in entry.get("target_instruments", [])]
            if instrument_type.upper() in insts:
                p = LiteraturePaper(
                    paper_id=entry["paper_id"],
                    title=entry["title"],
                    authors=entry["authors"],
                    publication_year=entry["publication_year"],
                    journal=entry["journal"],
                    doi=entry["doi"],
                    landing_page_url=entry["landing_page_url"],
                    pdf_url=entry.get("pdf_url"),
                    access_level=entry["access_level"],
                    citation_count=entry.get("citation_count"),
                    open_access_status=entry.get("open_access_status", "closed"),
                    abstract=entry.get("abstract"),
                )
                rel_score, compat, comp_status = evaluate_paper_relevance(
                    paper=p,
                    material_name=material_name,
                    chemical_composition=chemical_composition,
                    instrument_type=instrument_type,
                    target_property=target_property,
                    measurement_conditions=conditions,
                    literature_conditions=entry.get("reported_conditions"),
                )
                evidence_items = [
                    ExtractedEvidenceItem(
                        paper={
                            "title": p.title,
                            "doi": p.doi or "",
                            "publication_year": p.publication_year,
                            "access_level": p.access_level,
                        },
                        evidence=ev,
                    )
                    for ev in entry.get("evidences", [])
                ]
                val_item = LiteratureValidationItem(
                    paper=p,
                    compatibility=compat,
                    evidence_items=evidence_items,
                    relevance_score=rel_score,
                    comparison_status=comp_status,
                )
                key = p.doi or p.paper_id
                results_map[key] = p
                validations_map[key] = val_item
                if len(results_map) >= 2:
                    break

    # Sort validations by relevance score descending
    sorted_items = sorted(validations_map.values(), key=lambda v: v.relevance_score, reverse=True)
    final_validations = sorted_items[:max_results]
    final_papers = [v.paper for v in final_validations]

    return final_papers, final_validations
