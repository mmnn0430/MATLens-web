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
    from .db import get_conn, new_id, utc_now_iso
    from .engine.comparison_engine import (
        QUESTION_DEFINITIONS,
        build_full_comparison_report_data,
        evaluate_all_candidates_for_question,
        infer_or_extract_experiment_meta,
    )
    from .engine.comparison_seeder_and_export import (
        ensure_verification_series_seeded,
        generate_comparison_pdf_report,
        generate_comparison_peaks_csv,
        generate_comparison_stacked_xrd_png,
    )
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
    from backend.app.db import get_conn, new_id, utc_now_iso
    from backend.app.engine.comparison_engine import (
        QUESTION_DEFINITIONS,
        build_full_comparison_report_data,
        evaluate_all_candidates_for_question,
        infer_or_extract_experiment_meta,
    )
    from backend.app.engine.comparison_seeder_and_export import (
        ensure_verification_series_seeded,
        generate_comparison_pdf_report,
        generate_comparison_peaks_csv,
        generate_comparison_stacked_xrd_png,
    )
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
    xrd_diffraction_data: Optional[Dict[str, Any]] = None
    xrd_peaks: Optional[List[Dict[str, Any]]] = None
    sem_image_base64: Optional[str] = None
    sem_image_path: Optional[str] = None
    sem_metrics: Optional[Dict[str, Any]] = None


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
        xrd_diffraction_data=req.xrd_diffraction_data,
        xrd_peaks=req.xrd_peaks,
        sem_image_base64=req.sem_image_base64,
        sem_image_path=req.sem_image_path,
        sem_metrics=req.sem_metrics,
    )
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', req.sample_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="MatLens2_Report_{safe_name}.pdf"'},
    )


# -------------------------------------------------------------------------
# Multi-Specimen Experimental Question Comparison & Cross-Instrument API
# -------------------------------------------------------------------------
class ComparisonSeedRequest(BaseModel):
    force_reseed: bool = False


class ComparisonCandidatesRequest(BaseModel):
    question_type: str = "process_variation"
    baseline_project_id: Optional[str] = None
    auto_seed_if_empty: bool = True


class ComparisonSlotRequest(BaseModel):
    project_id: str
    xrd_run_id: Optional[str] = None
    sem_file_id: Optional[str] = None
    sem_run_id: Optional[str] = None


class ComparisonAnalyzeRequest(BaseModel):
    session_id: Optional[str] = None
    question_type: str = "process_variation"
    baseline_project_id: Optional[str] = None
    slots: List[ComparisonSlotRequest] = Field(default_factory=list)
    norm_mode: str = "max_100"
    offset_step: float = 115.0
    report_title: Optional[str] = None


def _load_all_projects_and_runs_from_db() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Load all projects, their files, and their completed/queued runs from SQLite."""
    projects_by_id: dict[str, dict[str, Any]] = {}
    runs_by_id: dict[str, dict[str, Any]] = {}

    with get_conn() as conn:
        prows = conn.execute("SELECT * FROM projects ORDER BY created_at ASC").fetchall()
        frows = conn.execute("SELECT * FROM project_files ORDER BY created_at ASC").fetchall()
        rrows = conn.execute("SELECT * FROM analysis_runs ORDER BY run_number DESC").fetchall()

    files_by_proj: dict[str, list[dict[str, Any]]] = {}
    for f in frows:
        files_by_proj.setdefault(f["project_id"], []).append(
            {
                "id": f["id"],
                "file_role": f["file_role"],
                "original_filename": f["original_filename"],
                "stored_relpath": f["stored_relpath"],
                "sha256": f["sha256"],
                "size_bytes": f["size_bytes"],
                "is_sample": bool(f["is_sample"]),
                "inspection": json.loads(f["inspection_json"]) if f["inspection_json"] else {},
                "created_at": f["created_at"],
            }
        )

    runs_brief_by_proj: dict[str, list[dict[str, Any]]] = {}
    for r in rrows:
        rid = r["id"]
        runs_by_id[rid] = {
            "id": rid,
            "project_id": r["project_id"],
            "run_number": r["run_number"],
            "status": r["status"],
            "params": json.loads(r["params_json"]) if r["params_json"] else {},
            "file_hashes": json.loads(r["file_hashes_json"]) if r["file_hashes_json"] else {},
            "xrd_result": json.loads(r["xrd_result_json"]) if r["xrd_result_json"] else None,
            "sem_result": json.loads(r["sem_result_json"]) if r["sem_result_json"] else None,
            "rule_summary": json.loads(r["rule_summary_json"]) if r["rule_summary_json"] else None,
            "has_overlay": bool(r["overlay_relpath"]),
            "has_roi_image": bool(r["roi_relpath"]),
            "created_at": r["created_at"],
            "completed_at": r["completed_at"],
        }
        runs_brief_by_proj.setdefault(r["project_id"], []).append(
            {
                "id": rid,
                "run_number": r["run_number"],
                "status": r["status"],
                "created_at": r["created_at"],
                "completed_at": r["completed_at"],
            }
        )

    for p in prows:
        pid = p["id"]
        p_dict = {
            "id": pid,
            "sample_name": p["sample_name"],
            "description": p["description"],
            "expected_elements": json.loads(p["expected_elements_json"]) if p["expected_elements_json"] else [],
            "expected_formula": p["expected_formula"],
            "is_same_sample": bool(p["is_same_sample"]),
            "is_sample_demo": bool(p["is_sample_demo"]),
            "current_conditions": json.loads(p["current_conditions_json"]) if p["current_conditions_json"] else {},
            "files": files_by_proj.get(pid, []),
            "runs": runs_brief_by_proj.get(pid, []),
            "created_at": p["created_at"],
            "updated_at": p["updated_at"],
        }
        p_dict["experiment_meta"] = infer_or_extract_experiment_meta(p_dict)
        projects_by_id[pid] = p_dict

    return projects_by_id, runs_by_id


@router.get("/comparison/questions")
def get_comparison_questions():
    """Return the three experimental questions and their grouping criteria."""
    return {"questions": list(QUESTION_DEFINITIONS.values())}


@router.post("/comparison/seed-series")
def seed_verification_series_endpoint(req: ComparisonSeedRequest):
    """Seed the multi-specimen verification series into the database."""
    return ensure_verification_series_seeded(force_reseed=req.force_reseed)


@router.post("/comparison/candidates")
def evaluate_comparison_candidates_endpoint(req: ComparisonCandidatesRequest):
    """Evaluate all workspace projects for a selected experimental question."""
    projects_by_id, _ = _load_all_projects_and_runs_from_db()
    has_series = any(p["sample_name"].startswith("[검증시리즈]") for p in projects_by_id.values())
    if not has_series and req.auto_seed_if_empty:
        ensure_verification_series_seeded(force_reseed=False)
        projects_by_id, _ = _load_all_projects_and_runs_from_db()

    q_type = req.question_type if req.question_type in QUESTION_DEFINITIONS else "process_variation"
    return evaluate_all_candidates_for_question(
        list(projects_by_id.values()),
        q_type,  # type: ignore[arg-type]
        req.baseline_project_id,
    )


def _save_and_compute_session(req: ComparisonAnalyzeRequest) -> dict[str, Any]:
    projects_by_id, runs_by_id = _load_all_projects_and_runs_from_db()
    has_series = any(p["sample_name"].startswith("[검증시리즈]") for p in projects_by_id.values())
    if not has_series:
        ensure_verification_series_seeded(force_reseed=False)
        projects_by_id, runs_by_id = _load_all_projects_and_runs_from_db()

    is_auto_mode = req.question_type not in QUESTION_DEFINITIONS
    if is_auto_mode and req.slots and len(req.slots) >= 2:
        # Infer comparison axis automatically from the selected slots' metadata
        sel_metas = [
            projects_by_id[s.project_id]["experiment_meta"]
            for s in req.slots
            if s.project_id in projects_by_id
        ]
        dop_els = {(m.get("dopant_element") or "").upper() for m in sel_metas}
        dop_amts = {m.get("dopant_amount") for m in sel_metas if m.get("dopant_amount") is not None}
        if len(dop_els - {""}) >= 2:
            q_type = "dopant_type"
        elif len(dop_amts) >= 2 and any(dop_els - {""}):
            q_type = "dopant_amount"
        else:
            q_type = "process_variation"
    else:
        q_type = req.question_type if req.question_type in QUESTION_DEFINITIONS else "process_variation"

    cand_eval = evaluate_all_candidates_for_question(
        list(projects_by_id.values()),
        q_type,  # type: ignore[arg-type]
        req.baseline_project_id,
    )

    if req.slots:
        req_slots_dicts = [s.model_dump() for s in req.slots]
    elif is_auto_mode:
        # In simplified single-target mode ("auto"), default to 1 representative specimen so comparison is not mandatory
        base_pid = cand_eval.get("baseline_project_id")
        if base_pid:
            req_slots_dicts = [{"project_id": base_pid}]
        else:
            rec_ids = cand_eval.get("recommended_project_ids", [])
            req_slots_dicts = [{"project_id": rec_ids[0]}] if rec_ids else []
    else:
        req_slots_dicts = [{"project_id": pid} for pid in cand_eval.get("recommended_project_ids", [])]

    norm_m = "raw" if req.norm_mode == "raw" else "max_100"
    comp_data = build_full_comparison_report_data(
        question_type=q_type,  # type: ignore[arg-type]
        baseline_project_id=cand_eval.get("baseline_project_id"),
        requested_slots=req_slots_dicts,
        projects_by_id=projects_by_id,
        runs_by_id=runs_by_id,
        norm_mode=norm_m,  # type: ignore[arg-type]
        offset_step=req.offset_step,
    )

    # Persist exact resolved slot bindings (including sem_file_id and xrd_run_id) into SQLite session
    persisted_slots = [
        {
            "project_id": sl["project_id"],
            "xrd_run_id": sl["selected_xrd"]["run_id"] if sl.get("selected_xrd") else None,
            "sem_file_id": sl["selected_sem"]["file_id"] if sl.get("selected_sem") else None,
            "sem_run_id": sl["selected_sem"]["run_id"] if sl.get("selected_sem") else None,
        }
        for sl in comp_data.get("slots", [])
    ]

    sid = req.session_id or new_id("comp")
    now = utc_now_iso()
    resolved_slots_list = comp_data.get("slots", [])
    if req.report_title:
        r_title = req.report_title
    elif is_auto_mode and len(resolved_slots_list) == 1:
        s0_name = resolved_slots_list[0].get("sample_name", "선택 시편")
        r_title = f"[통합 분석 리포트] {s0_name} — 결정구조(XRD) · 미세조직(SEM) · 기계(UTM) · 전기(Hall) · 열(LFA) 연계 분석"
    elif is_auto_mode and len(resolved_slots_list) >= 2:
        r_title = f"[연결 시리즈 통합 리포트] 선택 시편 {len(resolved_slots_list)}종 — 실험 조건 및 다종 측정 데이터 연계 분석"
    else:
        r_title = cand_eval.get("report_title")
    options_obj = {
        "norm_mode": norm_m,
        "offset_step": req.offset_step,
        "report_title": r_title,
    }

    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM comparison_sessions WHERE id = ?", (sid,)).fetchone()
        if exists:
            conn.execute(
                """
                UPDATE comparison_sessions
                SET question_type = ?, baseline_project_id = ?, slots_json = ?, options_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    q_type,
                    cand_eval.get("baseline_project_id"),
                    json.dumps(persisted_slots, ensure_ascii=False),
                    json.dumps(options_obj, ensure_ascii=False),
                    now,
                    sid,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO comparison_sessions (id, question_type, baseline_project_id, slots_json, options_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid,
                    q_type,
                    cand_eval.get("baseline_project_id"),
                    json.dumps(persisted_slots, ensure_ascii=False),
                    json.dumps(options_obj, ensure_ascii=False),
                    now,
                    now,
                ),
            )

    return {
        "session_id": sid,
        "question_type": q_type,
        "report_title": r_title,
        "candidate_evaluation": cand_eval,
        **comp_data,
    }


def _load_session_and_compute(session_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM comparison_sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"비교 분석 세션('{session_id}')을 찾을 수 없습니다.")

    slots_list = json.loads(row["slots_json"]) if row["slots_json"] else []
    opts = json.loads(row["options_json"]) if row["options_json"] else {}

    req = ComparisonAnalyzeRequest(
        session_id=row["id"],
        question_type=row["question_type"],
        baseline_project_id=row["baseline_project_id"],
        slots=[ComparisonSlotRequest(**s) for s in slots_list],
        norm_mode=opts.get("norm_mode", "max_100"),
        offset_step=float(opts.get("offset_step", 115.0)),
        report_title=opts.get("report_title"),
    )
    return _save_and_compute_session(req)


@router.post("/comparison/analyze")
def analyze_comparison_endpoint(req: ComparisonAnalyzeRequest):
    """Execute multi-specimen comparison analysis and save session state."""
    return _save_and_compute_session(req)


@router.get("/comparison/sessions/{session_id}")
def get_comparison_session_endpoint(session_id: str):
    """Reload a saved comparison session (preserving specimen order and selected SEM FOVs across refresh)."""
    return _load_session_and_compute(session_id)


@router.post("/comparison/export/xrd-chart.png")
def export_comparison_xrd_png_post(req: ComparisonAnalyzeRequest):
    comp_res = _save_and_compute_session(req)
    png_bytes = generate_comparison_stacked_xrd_png(comp_res, dpi=300)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{comp_res["session_id"]}_xrd.png"'},
    )


@router.get("/comparison/sessions/{session_id}/export/xrd-chart.png")
def export_comparison_xrd_png_get(session_id: str):
    comp_res = _load_session_and_compute(session_id)
    png_bytes = generate_comparison_stacked_xrd_png(comp_res, dpi=300)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{session_id}_xrd.png"'},
    )


@router.post("/comparison/export/xrd-peaks.csv")
def export_comparison_peaks_csv_post(req: ComparisonAnalyzeRequest):
    comp_res = _save_and_compute_session(req)
    csv_bytes = generate_comparison_peaks_csv(comp_res)
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{comp_res["session_id"]}_peaks.csv"'},
    )


@router.get("/comparison/sessions/{session_id}/export/xrd-peaks.csv")
def export_comparison_peaks_csv_get(session_id: str):
    comp_res = _load_session_and_compute(session_id)
    csv_bytes = generate_comparison_peaks_csv(comp_res)
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{session_id}_peaks.csv"'},
    )


@router.post("/comparison/export/result.json")
def export_comparison_json_post(req: ComparisonAnalyzeRequest):
    comp_res = _save_and_compute_session(req)
    raw = json.dumps(comp_res, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=raw,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{comp_res["session_id"]}_result.json"'},
    )


@router.get("/comparison/sessions/{session_id}/export/result.json")
def export_comparison_json_get(session_id: str):
    comp_res = _load_session_and_compute(session_id)
    raw = json.dumps(comp_res, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=raw,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{session_id}_result.json"'},
    )


@router.post("/comparison/export/report.pdf")
def export_comparison_pdf_post(req: ComparisonAnalyzeRequest):
    comp_res = _save_and_compute_session(req)
    pdf_bytes = generate_comparison_pdf_report(comp_res, report_title=comp_res.get("report_title"))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{comp_res["session_id"]}_report.pdf"'},
    )


@router.get("/comparison/sessions/{session_id}/export/report.pdf")
def export_comparison_pdf_get(session_id: str):
    comp_res = _load_session_and_compute(session_id)
    pdf_bytes = generate_comparison_pdf_report(comp_res, report_title=comp_res.get("report_title"))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="MatLens_Comparison_{session_id}_report.pdf"'},
    )

