"""Metadata normalization and DOI validation helpers."""
from __future__ import annotations

import re
from typing import Any
from ...schemas_literature import AccessLevel, PaperMetadata

_DOI_CLEAN_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)$", re.IGNORECASE)


def normalize_doi(raw_doi: str | None) -> str | None:
    if not raw_doi:
        return None
    raw = raw_doi.strip()
    m = _DOI_CLEAN_RE.match(raw)
    if m:
        return m.group(1)
    if raw.startswith("10.") and "/" in raw:
        return raw
    return None


def format_doi_url(doi: str | None) -> str | None:
    norm = normalize_doi(doi)
    if norm:
        return f"https://doi.org/{norm}"
    return None


def parse_openalex_work(work: dict[str, Any]) -> PaperMetadata:
    """Parse an OpenAlex API work object into a standardized PaperMetadata schema."""
    paper_id = str(work.get("id") or "")
    doi = normalize_doi(work.get("doi"))
    title = str(work.get("display_name") or work.get("title") or "Untitled Paper").strip()
    pub_year = work.get("publication_year")

    # Authors
    authors: list[str] = []
    for authorship in work.get("authorships", []):
        author_name = authorship.get("author", {}).get("display_name")
        if author_name:
            authors.append(author_name)

    # Primary location / source
    primary_loc = work.get("primary_location") or {}
    source = primary_loc.get("source") or {}
    journal = source.get("display_name")

    landing_page_url = primary_loc.get("landing_page_url") or format_doi_url(doi)
    pdf_url = primary_loc.get("pdf_url")

    # Open Access & Access Level
    oa_info = work.get("open_access") or {}
    is_oa = bool(oa_info.get("is_oa", False) or primary_loc.get("is_oa", False))
    oa_status = str(oa_info.get("oa_status") or ("open" if is_oa else "closed"))

    access_level: AccessLevel = "metadata_only"
    if pdf_url or oa_status in {"gold", "green"}:
        access_level = "full_text"
    elif work.get("abstract_inverted_index") or is_oa:
        access_level = "abstract_only"

    # Reconstruct abstract from inverted index if present
    abstract_text = None
    inv_index = work.get("abstract_inverted_index")
    if inv_index and isinstance(inv_index, dict):
        words_positions: list[tuple[int, str]] = []
        for word, positions in inv_index.items():
            for pos in positions:
                words_positions.append((pos, word))
        words_positions.sort(key=lambda x: x[0])
        abstract_text = " ".join([w for _, w in words_positions])

    citation_count = work.get("cited_by_count")

    return PaperMetadata(
        paper_id=paper_id,
        title=title,
        authors=authors,
        publication_year=int(pub_year) if pub_year else None,
        journal=journal,
        doi=doi,
        landing_page_url=landing_page_url,
        pdf_url=pdf_url,
        access_level=access_level,
        citation_count=int(citation_count) if citation_count is not None else None,
        open_access_status=oa_status,
        abstract=abstract_text,
    )
