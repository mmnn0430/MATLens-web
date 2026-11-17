"""RESTful API v1 Router for MatLens 2.0.

Provides modular endpoints for:
- File Upload & Instrument Auto-Detection
- Raw Measurement Parsing
- Hall Effect Analysis
- Laser Flash Analysis (LFA)
- Scientific Literature RAG & DOI Verification
- Cross-Instrument Integrated Analysis
- Vertex AI Interpretation Generation
"""
from __future__ import annotations

import io
import json
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

try:
    from .engine.hall_engine import (
        analyze_hall_data,
        parse_hall_data,
        solve_vdp_sheet_resistance,
    )
    from .engine.integrated_engine import perform_cross_instrument_analysis
    from .engine.lfa_engine import (
        analyze_lfa_transient,
        parse_lfa_data,
    )
    from .engine.pdf_report_v2 import generate_scientific_pdf_report_v2
    from .services.ai.vertex_gemini import (
        answer_research_assistant_query,
        generate_structured_scientific_interpretation,
    )
    from .services.cloud.telemetry import (
        get_telemetry_metrics,
        log_structured_event,
        track_token_usage,
    )
    from .services.literature.pipeline import execute_scientific_grounding_pipeline
    from .services.literature.retrieval import (
        retrieve_literature_for_analysis,
        verify_crossref_doi,
    )
except ImportError:
    from backend.app.engine.hall_engine import (
        analyze_hall_data,
        parse_hall_data,
        solve_vdp_sheet_resistance,
    )
    from backend.app.engine.integrated_engine import perform_cross_instrument_analysis
    from backend.app.engine.lfa_engine import (
        analyze_lfa_transient,
        parse_lfa_data,
    )
    from backend.app.engine.pdf_report_v2 import generate_scientific_pdf_report_v2
    from backend.app.services.ai.vertex_gemini import (
        answer_research_assistant_query,
        generate_structured_scientific_interpretation,
    )
    from backend.app.services.cloud.telemetry import (
        get_telemetry_metrics,
        log_structured_event,
        track_token_usage,
    )
    from backend.app.services.literature.pipeline import execute_scientific_grounding_pipeline
    from backend.app.services.literature.retrieval import (
        retrieve_literature_for_analysis,
        verify_crossref_doi,
    )

logger = logging.getLogger("matlens.api.v1")

router = APIRouter(prefix="/api/v1", tags=["MatLens 2.0 Scientific API"])


# -------------------------------------------------------------------------
# Request Schemas
# -------------------------------------------------------------------------
class HallAnalysisRequest(BaseModel):
    raw_text: Optional[str] = None
    b_field: Optional[List[float]] = None
    v_hall: Optional[List[float]] = None
    thickness_mm: Optional[float] = None
    thickness_um: Optional[float] = None
    current_mA: Optional[float] = None
    sheet_resistance_Ohm_sq: Optional[float] = None
    resistivity_Ohm_cm: Optional[float] = None
    r_a_Ohm: Optional[float] = None
    r_b_Ohm: Optional[float] = None
    sample_id: str = "Sample-01"
    material_name: Optional[str] = None
    chemical_composition: Optional[str] = None
    dopant: Optional[str] = None
    measurement_temperature_C: Optional[float] = 25.0
    do_antisymmetrization: bool = True
    include_ai_interpretation: bool = True


class LfaAnalysisRequest(BaseModel):
    raw_text: Optional[str] = None
    time_s: Optional[List[float]] = None
    temperature_signal: Optional[List[float]] = None
    thickness_mm: float = 2.5
    density_g_cm3: Optional[float] = None
    specific_heat_J_gK: Optional[float] = None
    is_literature_density: bool = False
    is_literature_cp: bool = False
    sample_id: str = "Sample-01"
    material_name: Optional[str] = None
    chemical_composition: Optional[str] = None
    dopant: Optional[str] = None
    measurement_temperature_C: Optional[float] = 25.0
    include_ai_interpretation: bool = True


class LiteratureSearchRequest(BaseModel):
    material_name: Optional[str] = None
    chemical_composition: Optional[str] = None
    dopant: Optional[str] = None
    instrument: Optional[str] = None
    temperature_C: Optional[float] = None
    limit: int = 5


class LiteratureVerifyRequest(BaseModel):
    doi: str


class IntegratedAnalysisRequest(BaseModel):
    sample_id: str
    material_name: str
    temperature_K: float = 300.0
    xrd_data: Optional[Dict[str, Any]] = None
    sem_data: Optional[Dict[str, Any]] = None
    hall_data: Optional[Dict[str, Any]] = None
    lfa_data: Optional[Dict[str, Any]] = None
    utm_data: Optional[Dict[str, Any]] = None


class AssistantChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = None
    material_name: Optional[str] = None
    chemical_composition: Optional[str] = None
    instrument: Optional[str] = None
    calculated_properties: Optional[Dict[str, Any]] = None
    references: Optional[List[Dict[str, Any]]] = None


class PdfReportRequest(BaseModel):
    sample_id: str = "Sample-01"
    material_name: str = "Material"
    chemical_composition: Optional[str] = None
    dopant: Optional[str] = None
    temperature_K: float = 300.0
    instruments_included: Optional[List[str]] = None
    calculated_properties: Optional[Dict[str, Any]] = None
    wiedemann_franz: Optional[Dict[str, Any]] = None
    grain_correlation: Optional[Dict[str, Any]] = None
    ai_interpretation: Optional[Dict[str, Any]] = None
    references: Optional[List[Dict[str, Any]]] = None
    grounding_claims: Optional[List[Dict[str, Any]]] = None


# -------------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------------
def detect_instrument_from_content(filename: str, content_preview: str) -> str:
    """Intelligently detects instrument type from filename and text preview."""
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    if ext in ("png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"):
        return "sem"

    lower = content_preview.lower()
    if any(k in lower for k in ("magneticfield", "transversevoltage", "v_hall", "hall voltage", "b_t")):
        return "hall"
    if any(k in lower for k in ("reartemperature", "diffusivity", "time_s", "rear_temp", "thermogram", "laser flash")):
        return "lfa"
    if any(k in lower for k in ("2theta", "2-theta", "intensity", "cps", "counts", "angle")):
        return "xrd"
    if any(k in lower for k in ("stress", "strain", "stroke", "load", "kgf", "elongation", "disp")):
        return "utm"

    return "unknown"


# -------------------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------------------
@router.get("/health")
def get_api_v1_health():
    """Returns system status, active GCP configuration, and token budgets."""
    metrics = get_telemetry_metrics()
    return {
        "status": "online",
        "api_version": "v2.0-scientific",
        "supported_instruments": ["XRD", "SEM", "UTM", "Hall Effect", "LFA"],
        "telemetry": metrics,
    }


@router.post("/files/upload")
async def upload_and_detect_file(file: UploadFile = File(...)):
    """Uploads a measurement file, auto-detects instrument type, and parses columns."""
    content_bytes = await file.read()
    filename = file.filename or "unknown.dat"

    # Text decode attempt
    is_binary = False
    text_preview = ""
    try:
        text_preview = content_bytes.decode("utf-8")[:4000]
    except UnicodeDecodeError:
        try:
            text_preview = content_bytes.decode("cp949")[:4000]
        except Exception:
            is_binary = True

    detected_instrument = "sem" if is_binary else detect_instrument_from_content(filename, text_preview)

    log_structured_event("FILE_UPLOADED", {
        "filename": filename,
        "size_bytes": len(content_bytes),
        "detected_instrument": detected_instrument,
    })

    return {
        "filename": filename,
        "size_bytes": len(content_bytes),
        "detected_instrument": detected_instrument,
        "is_binary": is_binary,
        "preview_snippet": text_preview[:500] if not is_binary else "Binary image/data file",
    }


@router.post("/analysis/hall")
def run_hall_analysis(req: HallAnalysisRequest):
    """Executes deterministic Hall effect analysis, literature grounding, and AI interpretation."""
    import numpy as np

    thickness_m = 500e-6
    if req.thickness_um is not None and req.thickness_um > 0:
        thickness_m = req.thickness_um * 1e-6
    elif req.thickness_mm is not None and req.thickness_mm > 0:
        thickness_m = req.thickness_mm * 1e-3

    current_A = (req.current_mA * 1e-3) if req.current_mA else 10e-3
    sheet_res = req.sheet_resistance_Ohm_sq

    # If van der Pauw resistances R_A and R_B provided, calculate R_sheet numerically
    if req.r_a_Ohm is not None and req.r_b_Ohm is not None:
        try:
            sheet_res = solve_vdp_sheet_resistance(req.r_a_Ohm, req.r_b_Ohm)
        except Exception as e:
            logger.warning(f"Failed to solve vdP sheet resistance: {e}")

    # Parse data if raw text provided
    if req.raw_text:
        b_arr, v_arr, meta = parse_hall_data(req.raw_text)
        if "thickness" in meta and meta["thickness"]["value"]:
            t_val = meta["thickness"]["value"]
            t_unit = (meta["thickness"]["unit"] or "um").lower()
            if "mm" in t_unit:
                thickness_m = t_val * 1e-3
            elif "um" in t_unit or "µm" in t_unit:
                thickness_m = t_val * 1e-6
        if "current" in meta and meta["current"]["value"]:
            i_val = meta["current"]["value"]
            i_unit = (meta["current"]["unit"] or "ma").lower()
            current_A = (i_val * 1e-3) if "ma" in i_unit else (i_val * 1e-6 if "ua" in i_unit else i_val)
        if "sheet_resistance" in meta and meta["sheet_resistance"]["value"]:
            sheet_res = float(meta["sheet_resistance"]["value"])
    elif req.b_field and req.v_hall:
        b_arr = np.array(req.b_field, dtype=float)
        v_arr = np.array(req.v_hall, dtype=float)
    else:
        raise HTTPException(status_code=400, detail="Must provide either raw_text or b_field and v_hall arrays.")

    # 1. Deterministic Physics Calculation
    calc_res = analyze_hall_data(
        b_field=b_arr,
        v_hall=v_arr,
        thickness_m=thickness_m,
        current_A=current_A,
        sheet_resistance_Ohm_sq=sheet_res,
        resistivity_Ohm_m=(req.resistivity_Ohm_cm * 1e-2) if req.resistivity_Ohm_cm else None,
        do_antisymmetrization=req.do_antisymmetrization,
        sample_id=req.sample_id,
        material_name=req.material_name,
    )

    # 2. Scientific Literature RAG Pipeline
    sample_meta = {
        "sample_id": req.sample_id,
        "material_name": req.material_name or "Silicon",
        "chemical_composition": req.chemical_composition or "Si",
        "dopant": req.dopant,
        "measurement_temperature_C": req.measurement_temperature_C,
    }
    raw_summary = {"point_count": len(b_arr), "instrument": "Hall Effect"}

    grounding_data = execute_scientific_grounding_pipeline(
        instrument="hall",
        raw_data_summary=raw_summary,
        calculated_properties=calc_res.to_dict(),
        sample_metadata=sample_meta,
    )

    # 3. AI Scientific Interpretation
    ai_interpretation = None
    if req.include_ai_interpretation:
        track_token_usage(800)
        ai_interpretation = generate_structured_scientific_interpretation(
            instrument="hall",
            calculated_properties=calc_res.to_dict(),
            sample_metadata=sample_meta,
            grounding_data=grounding_data,
        )

    return {
        "analysis_type": "hall_effect",
        "sample_id": req.sample_id,
        "calculated_properties": calc_res.to_dict(),
        "grounding": grounding_data,
        "ai_interpretation": ai_interpretation,
    }


@router.post("/analysis/lfa")
def run_lfa_analysis(req: LfaAnalysisRequest):
    """Executes deterministic Laser Flash Analysis, literature grounding, and AI interpretation."""
    import numpy as np

    if req.raw_text:
        t_arr, temp_arr, meta = parse_lfa_data(req.raw_text)
        thickness_mm = req.thickness_mm
        if "thickness" in meta and meta["thickness"]["value"]:
            thickness_mm = float(meta["thickness"]["value"])
        density = req.density_g_cm3 or (float(meta["density"]["value"]) if "density" in meta else None)
        cp = req.specific_heat_J_gK or (float(meta["cp"]["value"]) if "cp" in meta else None)
    elif req.time_s and req.temperature_signal:
        t_arr = np.array(req.time_s, dtype=float)
        temp_arr = np.array(req.temperature_signal, dtype=float)
        thickness_mm = req.thickness_mm
        density = req.density_g_cm3
        cp = req.specific_heat_J_gK
    else:
        raise HTTPException(status_code=400, detail="Must provide either raw_text or time_s and temperature_signal arrays.")

    # 1. Deterministic LFA calculation
    calc_res = analyze_lfa_transient(
        time_s=t_arr,
        temp_signal=temp_arr,
        thickness_mm=thickness_mm,
        density_g_cm3=density,
        specific_heat_J_gK=cp,
        is_literature_density=req.is_literature_density,
        is_literature_cp=req.is_literature_cp,
        sample_id=req.sample_id,
        material_name=req.material_name,
    )

    # 2. Scientific Literature RAG Pipeline
    sample_meta = {
        "sample_id": req.sample_id,
        "material_name": req.material_name or "Pyroceram 9606",
        "chemical_composition": req.chemical_composition or "Pyroceram 9606",
        "dopant": req.dopant,
        "measurement_temperature_C": req.measurement_temperature_C,
    }
    raw_summary = {"point_count": len(t_arr), "instrument": "LFA"}

    grounding_data = execute_scientific_grounding_pipeline(
        instrument="lfa",
        raw_data_summary=raw_summary,
        calculated_properties=calc_res.to_dict(),
        sample_metadata=sample_meta,
    )

    # 3. AI Scientific Interpretation
    ai_interpretation = None
    if req.include_ai_interpretation:
        track_token_usage(800)
        ai_interpretation = generate_structured_scientific_interpretation(
            instrument="lfa",
            calculated_properties=calc_res.to_dict(),
            sample_metadata=sample_meta,
            grounding_data=grounding_data,
        )

    return {
        "analysis_type": "lfa",
        "sample_id": req.sample_id,
        "calculated_properties": calc_res.to_dict(),
        "grounding": grounding_data,
        "ai_interpretation": ai_interpretation,
    }


@router.post("/analysis/integrated")
def run_integrated_analysis(req: IntegratedAnalysisRequest):
    """Executes multi-technique cross-instrument analysis across XRD, SEM, Hall, LFA, and UTM."""
    result = perform_cross_instrument_analysis(
        sample_id=req.sample_id,
        material_name=req.material_name,
        xrd_data=req.xrd_data,
        sem_data=req.sem_data,
        hall_data=req.hall_data,
        lfa_data=req.lfa_data,
        utm_data=req.utm_data,
        temperature_K=req.temperature_K,
    )

    log_structured_event("INTEGRATED_ANALYSIS_EXECUTED", {
        "sample_id": req.sample_id,
        "instruments": result.instruments_included,
    })

    return result.to_dict()


@router.post("/literature/search")
def search_literature_endpoint(req: LiteratureSearchRequest):
    """Searches OpenAlex, Crossref, and the Curated Academic Database."""
    return retrieve_literature_for_analysis(
        material_name=req.material_name,
        chemical_formula=req.chemical_composition,
        dopant=req.dopant,
        instrument=req.instrument,
        temperature_C=req.temperature_C,
        limit=req.limit,
    )


@router.post("/literature/verify")
def verify_doi_endpoint(req: LiteratureVerifyRequest):
    """Verifies a DOI against Crossref to validate publication authenticity."""
    verified = verify_crossref_doi(req.doi)
    if not verified:
        return {"doi": req.doi, "is_verified": False, "message": "DOI could not be verified on Crossref."}
    return verified


@router.post("/assistant/chat")
def assistant_chat_endpoint(req: AssistantChatRequest):
    """Grounded Interactive Research Assistant Q&A endpoint."""
    track_token_usage(300)
    return answer_research_assistant_query(
        question=req.message,
        history=req.history,
        material_name=req.material_name,
        chemical_composition=req.chemical_composition,
        instrument=req.instrument,
        calculated_properties=req.calculated_properties,
        references=req.references,
    )


@router.post("/reports/pdf")
def export_scientific_pdf_endpoint(req: PdfReportRequest):
    """Generates an elegant, highly readable Korean PDF scientific report."""
    log_structured_event("PDF_REPORT_GENERATED", {
        "sample_id": req.sample_id,
        "material_name": req.material_name,
    })
    pdf_bytes = generate_scientific_pdf_report_v2(
        sample_id=req.sample_id,
        material_name=req.material_name,
        chemical_composition=req.chemical_composition,
        dopant=req.dopant,
        temperature_K=req.temperature_K,
        instruments_included=req.instruments_included,
        calculated_properties=req.calculated_properties,
        wiedemann_franz=req.wiedemann_franz,
        grain_correlation=req.grain_correlation,
        ai_interpretation=req.ai_interpretation,
        references=req.references,
        grounding_claims=req.grounding_claims,
    )
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', req.sample_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="MatLens2_Report_{safe_name}.pdf"'},
    )
