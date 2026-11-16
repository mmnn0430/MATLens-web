"""Open Access retrieval and unpaywall verification helpers."""
from __future__ import annotations

import logging
from typing import Any
import httpx

from .metadata import normalize_doi

logger = logging.getLogger("matlens.retrieval")


async def verify_open_access_with_unpaywall(doi: str, email: str = "research@matlens.org") -> dict[str, Any]:
    """Check Unpaywall API for legal open-access full text locations."""
    norm = normalize_doi(doi)
    if not norm:
        return {"is_oa": False, "pdf_url": None, "oa_status": "closed"}
    url = f"https://api.unpaywall.org/v2/{norm}?email={email}"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                is_oa = bool(data.get("is_oa", False))
                best_loc = data.get("best_oa_location") or {}
                return {
                    "is_oa": is_oa,
                    "pdf_url": best_loc.get("url_for_pdf"),
                    "landing_page_url": best_loc.get("url_for_landing_page"),
                    "oa_status": data.get("oa_status", "closed"),
                }
    except Exception as e:
        logger.debug(f"Unpaywall check skipped for {doi}: {e}")
    return {"is_oa": False, "pdf_url": None, "oa_status": "closed"}
