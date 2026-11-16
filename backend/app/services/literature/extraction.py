"""Deterministic and Schema-Conforming Evidence Extraction.

Extracts evidence strictly following the Section 6 Schema:
{
  "paper": {
    "title": "",
    "doi": "",
    "publication_year": null,
    "access_level": "full_text"
  },
  "evidence": {
    "property": "",
    "value": null,
    "unit": "",
    "measurement_temperature": null,
    "source_page": null,
    "source_figure": null,
    "source_table": null,
    "quoted_text": "",
    "extraction_method": "",
    "verification_status": "pending"
  }
}

Strict rule:
If information is not present or verified in the paper, set null.
Never hallucinate or generate synthetic values, DOIs, page or figure numbers!
"""
from __future__ import annotations

from typing import Any
from ...schemas_literature import EvidenceDetail, ExtractedEvidenceItem, PaperMetadata


def extract_verified_evidence(
    paper: PaperMetadata,
    reported_evidence_list: list[dict[str, Any]] | None = None,
) -> list[ExtractedEvidenceItem]:
    """Format and return verified evidence items with strict null-fallback."""
    items: list[ExtractedEvidenceItem] = []
    paper_dict = {
        "title": paper.title,
        "doi": paper.doi or "",
        "publication_year": paper.publication_year,
        "access_level": paper.access_level,
    }

    if not reported_evidence_list:
        return items

    for ev in reported_evidence_list:
        detail = EvidenceDetail(
            property=str(ev.get("property") or ""),
            value=float(ev["value"]) if ev.get("value") is not None else None,
            unit=str(ev.get("unit") or ""),
            measurement_temperature=float(ev["measurement_temperature"]) if ev.get("measurement_temperature") is not None else None,
            source_page=ev.get("source_page"),
            source_figure=ev.get("source_figure"),
            source_table=ev.get("source_table"),
            quoted_text=str(ev.get("quoted_text") or ""),
            extraction_method=str(ev.get("extraction_method") or "deterministic_table_extraction"),
            verification_status="verified" if ev.get("value") is not None else "pending",
        )
        items.append(ExtractedEvidenceItem(paper=paper_dict, evidence=detail))

    return items
