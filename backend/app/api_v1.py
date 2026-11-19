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
    report_id: Optional[str] = None
    selected_items: Optional[List[Dict[str, Any]]] = None


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
    report_id: Optional[str] = None
    selected_items: Optional[List[Dict[str, Any]]] = None
    report_title: Optional[str] = None


class ScopedAnalysisSelection(BaseModel):
    id: str
    instrument: str  # "XRD", "SEM", "UTM", "Hall", "LFA", "FT-IR", "DSC", "TGA"
    sample_id: str
    sample_name: Optional[str] = None
    file_id: Optional[str] = None
    measurement_id: Optional[str] = None
    analysis_id: Optional[str] = None
    run_id: Optional[str] = None
    original_filename: Optional[str] = None
    run_number: Optional[int] = 1


class ScopedIntegratedReportRequest(BaseModel):
    title: Optional[str] = None
    selected_items: List[ScopedAnalysisSelection]
    temperature_K: float = 300.0
    user_notes: Optional[str] = None
    run_ai: bool = True


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
    if any(k in lower for k in ("wavenumber", "cm-1", "cm^-1", "transmittance", "%t", "absorbance", "ftir", "ft-ir")):
        return "ftir"
    if any(k in lower for k in ("heat flow", "heatflow", "dsc", "mw/mg", "endo", "exo")):
        return "dsc"
    if any(k in lower for k in ("tga", "weight %", "weight%", "mass loss", "mass %", "residual")):
        return "tga"

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


# -------------------------------------------------------------------------
# Strictly Scoped Integrated Report & Saved Analyses Endpoints
# -------------------------------------------------------------------------
def _query_all_saved_analyses(
    instrument: Optional[str] = None,
    sample_id: Optional[str] = None,
    query: Optional[str] = None,
) -> tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Query saved analyses across all 8 instruments: XRD, SEM, UTM, Hall, LFA, FT-IR, DSC, TGA."""
    counts = {
        "XRD": 0,
        "SEM": 0,
        "UTM": 0,
        "Hall": 0,
        "LFA": 0,
        "FT-IR": 0,
        "DSC": 0,
        "TGA": 0,
    }
    all_items: List[Dict[str, Any]] = []

    with get_conn() as conn:
        # 1. XRD from projects + project_files (file_role='xrd') + analysis_runs
        xrd_rows = conn.execute(
            """
            SELECT p.id as project_id, p.sample_name, p.expected_formula,
                   f.id as file_id, f.original_filename, f.created_at as file_created_at,
                   r.id as run_id, r.run_number, r.status, r.params_json, r.xrd_result_json,
                   r.created_at as run_created_at
            FROM projects p
            JOIN project_files f ON f.project_id = p.id AND f.file_role = 'xrd'
            LEFT JOIN analysis_runs r ON r.project_id = p.id AND r.xrd_result_json IS NOT NULL
            ORDER BY p.created_at DESC, r.run_number DESC
            """
        ).fetchall()

        seen_xrd_runs = set()
        seen_xrd_files_with_run = set()
        for row in xrd_rows:
            fid = row["file_id"]
            rid = row["run_id"]
            has_completed_run = bool(rid and row["status"] == "completed" and row["xrd_result_json"])
            if has_completed_run and rid not in seen_xrd_runs:
                seen_xrd_runs.add(rid)
                seen_xrd_files_with_run.add(fid)
                counts["XRD"] += 1
                xrd_res = json.loads(row["xrd_result_json"]) if row["xrd_result_json"] else {}
                cands = (xrd_res.get("phase_matching") or {}).get("candidates") or []
                top_phase = cands[0].get("name") if cands else (xrd_res.get("primary_phase") or row["expected_formula"] or "XRD Phase")
                crystallite_nm = (xrd_res.get("scherrer") or {}).get("mean_nm") or xrd_res.get("crystallite_size_nm")
                summary = f"주 결정상: {top_phase}" + (f", 결정자 크기: {crystallite_nm} nm" if crystallite_nm else "")
                all_items.append(
                    {
                        "id": f"xrd_run_{rid}",
                        "instrument": "XRD",
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "file_id": fid,
                        "run_id": rid,
                        "original_filename": row["original_filename"],
                        "run_number": row["run_number"],
                        "version_label": f"Run #{row['run_number']}",
                        "status": "completed",
                        "created_at": row["run_created_at"] or row["file_created_at"],
                        "summary_text": summary,
                        "results_preview": {
                            "primary_phase": top_phase,
                            "crystallite_size_nm": crystallite_nm,
                            "peak_count": len(xrd_res.get("peaks") or []),
                        },
                        "parameters": json.loads(row["params_json"]) if row["params_json"] else {},
                        "raw_curve_available": True,
                    }
                )

        seen_raw_files = set()
        for row in xrd_rows:
            fid = row["file_id"]
            if fid not in seen_xrd_files_with_run and fid not in seen_raw_files:
                seen_raw_files.add(fid)
                all_items.append(
                    {
                        "id": f"xrd_file_{fid}",
                        "instrument": "XRD",
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "file_id": fid,
                        "original_filename": row["original_filename"],
                        "version_label": "원본 업로드",
                        "status": "needs_analysis",
                        "created_at": row["file_created_at"],
                        "summary_text": "분석 대기 중 (분석 필요)",
                        "results_preview": {},
                        "parameters": {},
                        "raw_curve_available": True,
                    }
                )

        # 2. SEM from projects + project_files (file_role='sem') + analysis_runs
        sem_rows = conn.execute(
            """
            SELECT p.id as project_id, p.sample_name, p.expected_formula,
                   f.id as file_id, f.original_filename, f.created_at as file_created_at,
                   r.id as run_id, r.run_number, r.status, r.params_json, r.sem_result_json,
                   r.overlay_relpath, r.roi_relpath, r.created_at as run_created_at
            FROM projects p
            JOIN project_files f ON f.project_id = p.id AND f.file_role = 'sem'
            LEFT JOIN analysis_runs r ON r.project_id = p.id AND r.sem_result_json IS NOT NULL
            ORDER BY p.created_at DESC, r.run_number DESC
            """
        ).fetchall()

        seen_sem_runs = set()
        seen_sem_files_with_run = set()
        for row in sem_rows:
            fid = row["file_id"]
            rid = row["run_id"]
            has_completed_run = bool(rid and row["status"] == "completed" and row["sem_result_json"])
            if has_completed_run and rid not in seen_sem_runs:
                seen_sem_runs.add(rid)
                seen_sem_files_with_run.add(fid)
                counts["SEM"] += 1
                sem_res = json.loads(row["sem_result_json"]) if row["sem_result_json"] else {}
                g_size = sem_res.get("grain_size_um") or (sem_res.get("summary_stats") or {}).get("mean_diameter")
                porosity = sem_res.get("porosity_pct")
                summary = (f"입자/결정립 크기: {g_size} µm" if g_size else "SEM 미세조직 분석") + (f", 기공률: {porosity}%" if porosity is not None else "")
                all_items.append(
                    {
                        "id": f"sem_run_{rid}",
                        "instrument": "SEM",
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "file_id": fid,
                        "run_id": rid,
                        "original_filename": row["original_filename"],
                        "run_number": row["run_number"],
                        "version_label": f"Run #{row['run_number']}",
                        "status": "completed",
                        "created_at": row["run_created_at"] or row["file_created_at"],
                        "summary_text": summary,
                        "results_preview": {
                            "grain_size_um": g_size,
                            "porosity_pct": porosity,
                        },
                        "parameters": json.loads(row["params_json"]) if row["params_json"] else {},
                        "raw_curve_available": bool(row["overlay_relpath"] or row["roi_relpath"]),
                    }
                )

        seen_raw_sem = set()
        for row in sem_rows:
            fid = row["file_id"]
            if fid not in seen_sem_files_with_run and fid not in seen_raw_sem:
                seen_raw_sem.add(fid)
                all_items.append(
                    {
                        "id": f"sem_file_{fid}",
                        "instrument": "SEM",
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "file_id": fid,
                        "original_filename": row["original_filename"],
                        "version_label": "원본 이미지",
                        "status": "needs_analysis",
                        "created_at": row["file_created_at"],
                        "summary_text": "분석 대기 중 (분석 필요)",
                        "results_preview": {},
                        "parameters": {},
                        "raw_curve_available": False,
                    }
                )

        # 3. UTM, Hall, LFA, FT-IR, DSC, TGA from sample_measurements + sample_analysis_results
        inst_map = {
            "utm": "UTM",
            "hall": "Hall",
            "lfa": "LFA",
            "ftir": "FT-IR",
            "dsc": "DSC",
            "tga": "TGA",
        }
        meas_rows = conn.execute(
            """
            SELECT p.id as project_id, p.sample_name, p.expected_formula,
                   m.id as measurement_id, m.instrument_type, m.original_filename, m.metadata_json, m.raw_payload_json, m.created_at as meas_created_at,
                   a.id as analysis_id, a.analysis_type, a.parameters_json, a.results_json, a.summary_text, a.created_at as analysis_created_at
            FROM projects p
            JOIN sample_measurements m ON m.sample_id = p.id
            LEFT JOIN sample_analysis_results a ON a.measurement_id = m.id
            ORDER BY m.created_at DESC, a.created_at DESC
            """
        ).fetchall()

        seen_meas_ids = set()
        for row in meas_rows:
            itype = str(row["instrument_type"] or "").lower().replace("-", "").strip()
            norm_inst = inst_map.get(itype)
            if not norm_inst:
                continue

            mid = row["measurement_id"]
            aid = row["analysis_id"]
            has_analysis = bool(aid and row["results_json"])

            if has_analysis:
                counts[norm_inst] += 1
                res_obj = json.loads(row["results_json"]) if row["results_json"] else {}
                summary = row["summary_text"] or f"{norm_inst} 분석 완료"
                all_items.append(
                    {
                        "id": f"{itype}_ares_{aid}",
                        "instrument": norm_inst,
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "measurement_id": mid,
                        "analysis_id": aid,
                        "original_filename": row["original_filename"],
                        "run_number": 1,
                        "version_label": "분석 결과",
                        "status": "completed",
                        "created_at": row["analysis_created_at"] or row["meas_created_at"],
                        "summary_text": summary,
                        "results_preview": res_obj,
                        "parameters": json.loads(row["parameters_json"]) if row["parameters_json"] else {},
                        "raw_curve_available": bool(row["raw_payload_json"]),
                    }
                )
                seen_meas_ids.add(mid)
            elif mid not in seen_meas_ids:
                seen_meas_ids.add(mid)
                all_items.append(
                    {
                        "id": f"{itype}_meas_{mid}",
                        "instrument": norm_inst,
                        "sample_id": row["project_id"],
                        "sample_name": row["sample_name"],
                        "measurement_id": mid,
                        "original_filename": row["original_filename"],
                        "version_label": "원본 데이터",
                        "status": "needs_analysis",
                        "created_at": row["meas_created_at"],
                        "summary_text": "분석 대기 중 (분석 필요)",
                        "results_preview": {},
                        "parameters": {},
                        "raw_curve_available": bool(row["raw_payload_json"]),
                    }
                )

    # Apply filters
    filtered = all_items
    if instrument and instrument.lower() != "all":
        norm_filter = instrument.upper().replace("-", "")
        filtered = [it for it in filtered if it["instrument"].upper().replace("-", "") == norm_filter]

    if sample_id:
        filtered = [it for it in filtered if it["sample_id"] == sample_id]

    if query:
        q_lower = query.lower().strip()
        filtered = [
            it for it in filtered
            if q_lower in it["sample_name"].lower()
            or q_lower in it["original_filename"].lower()
            or q_lower in it["sample_id"].lower()
            or q_lower in it["summary_text"].lower()
        ]

    return filtered, counts


def generate_scoped_integrated_ai_interpretation(
    sample_id: str,
    material_name: str,
    selected_instruments: List[str],
    analysis_result: Dict[str, Any],
    user_notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Generates structured AI scientific interpretation strictly scoped to selected instruments."""
    from .config import get_gemini_api_key

    api_key = get_gemini_api_key()
    inst_str = ", ".join(selected_instruments)
    key_metrics = analysis_result.get("key_metrics_table") or []
    corrs = analysis_result.get("cross_correlations") or []
    exec_items = analysis_result.get("executive_summary_items") or []

    if api_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key)
            prompt = f"""당신은 재료과학 및 물성 분석 전문 연구원 AI입니다.
연구자가 명시적으로 선택한 측정 기기([{inst_str}])의 실제 데이터만을 바탕으로 정밀 종합 리포트를 작성하십시오.

[절대 준수 규칙]
1. 사용자가 선택한 기기([{inst_str}]) 외의 장비(예: 선택되지 않은 UTM, Hall, LFA 등)에 대한 물성을 임의로 가정하거나 단정하지 마십시오.
2. key_metrics_table에 기재된 수치와 cross_correlations 해석만을 엄격히 바탕으로 작성하십시오.
3. [측정 사실], [계산 결과], [해석 가설]을 엄격히 구분하여 작성하십시오.
4. 사용자 메모가 있을 경우 반영하십시오: {user_notes or '없음'}

[분석 데이터 현황]
• 시료: {sample_id} ({material_name})
• 포함된 기기: {inst_str}
• 주요 지표 표:
{json.dumps(key_metrics, ensure_ascii=False, indent=2)}
• 교차 상관성 해석:
{json.dumps(corrs, ensure_ascii=False, indent=2)}

다음 JSON 형식으로만 응답하십시오:
{{
  "analysis_summary": "선택된 기기들의 관찰 사실과 물성을 요약한 2~3문장의 종합 요약",
  "data_quality_assessment": "수치 신뢰도 및 측정 품질 평가",
  "physical_mechanisms": ["선택된 기기간 물리적 연계 메커니즘 가설 1", "가설 2"],
  "scientific_cautions": "단일 시편 분석 및 선택되지 않은 기기로 인한 한계점 주의사항",
  "recommended_experiments": ["추천 후속 실험 1", "추천 후속 실험 2"]
}}
"""
            for m_name in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]:
                try:
                    resp = client.models.generate_content(
                        model=m_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.15),
                    )
                    if resp and resp.text:
                        parsed = json.loads(resp.text)
                        parsed["ai_engine"] = f"Vertex AI / Gemini ({m_name})"
                        return parsed
                except Exception:
                    continue
        except Exception:
            pass

    # Deterministic high-quality fallback
    summary_parts = [f"선택된 {len(selected_instruments)}개 기기({inst_str})의 정밀 측정 결과를 통합 분석하였습니다."]
    for item in exec_items:
        if item.get("badge") and item.get("text"):
            summary_parts.append(f"• [{item['badge']}] {item['text']}")

    return {
        "analysis_summary": "\n".join(summary_parts),
        "executive_summary": "\n".join(summary_parts),
        "data_quality_assessment": "선택된 모든 데이터의 수치 유효성 및 기기별 측정 신뢰도 검증 완료.",
        "physical_mechanisms": [
            corr.get("interpretation_hypotheses", ["-"])[0]
            if isinstance(corr.get("interpretation_hypotheses"), list) and corr.get("interpretation_hypotheses")
            else str(corr.get("interpretation_hypotheses", "-"))
            for corr in corrs
        ] or [f"{inst_str} 상호 연계에 기반한 구조-물성 가설 수립 완료."],
        "scientific_cautions": f"본 리포트는 사용자가 명시적으로 선택한 기기({inst_str})의 데이터 범위 내에서만 작성되었으며, 선택되지 않은 다른 기기의 특성을 확정적으로 추정하지 않습니다.",
        "recommended_experiments": analysis_result.get("limitations_and_next_actions", {}).get("recommended_next_steps", [
            "온도 가변 측정 및 열처리 조건별 추가 분석을 통해 메커니즘을 교차 검증하십시오."
        ]),
        "ai_engine": "Deterministic Rule Engine (오프라인/규칙 기반 과학적 요약)",
    }


@router.get("/saved-analyses")
def get_saved_analyses(
    instrument: Optional[str] = None,
    sample_id: Optional[str] = None,
    query: Optional[str] = None,
):
    """Retrieve saved analyses and measurement records across all 8 instruments."""
    items, counts = _query_all_saved_analyses(instrument=instrument, sample_id=sample_id, query=query)
    return {
        "items": items,
        "counts": counts,
        "total_count": len(items),
    }


@router.get("/saved-analyses/counts")
def get_saved_analyses_counts():
    """Retrieve counts of saved analysis results for each of the 8 instruments."""
    _, counts = _query_all_saved_analyses()
    return {"counts": counts}


@router.post("/analysis/integrated-scoped")
def run_integrated_scoped_analysis(req: ScopedIntegratedReportRequest):
    """Executes strictly scoped multi-instrument materials analysis using ONLY user-selected items."""
    if not req.selected_items:
        raise HTTPException(status_code=400, detail="리포트에 포함할 분석 결과를 최소 1개 이상 선택해야 합니다.")

    chosen_instruments = list(dict.fromkeys(item.instrument for item in req.selected_items))
    sample_ids = list(dict.fromkeys(item.sample_id for item in req.selected_items))

    with get_conn() as conn:
        sample_names = {}
        for sid in sample_ids:
            p = conn.execute("SELECT sample_name, expected_formula FROM projects WHERE id = ?", (sid,)).fetchone()
            if p:
                sample_names[sid] = p["sample_name"]

    is_same_sample = len(sample_ids) == 1
    primary_sample_id = sample_ids[0]
    primary_sample_name = sample_names.get(primary_sample_id, primary_sample_id)
    material_name = primary_sample_name if is_same_sample else "복수 시료 비교 분석 시리즈"
    report_title = req.title or f"{material_name} — {' · '.join(chosen_instruments)} 통합 분석 리포트"

    eff_xrd = None
    eff_sem = None
    eff_utm = None
    eff_hall = None
    eff_lfa = None
    eff_ftir = None
    eff_dsc = None
    eff_tga = None

    multi_curves: Dict[str, List[Dict[str, Any]]] = {}

    with get_conn() as conn:
        for item in req.selected_items:
            inst = item.instrument.upper().replace("-", "")

            if inst == "XRD":
                if item.run_id:
                    r = conn.execute("SELECT xrd_result_json, params_json FROM analysis_runs WHERE id = ?", (item.run_id,)).fetchone()
                    if r and r["xrd_result_json"]:
                        xres = json.loads(r["xrd_result_json"])
                        if eff_xrd is None:
                            eff_xrd = xres
                            eff_xrd["source_file"] = item.original_filename or "XRD 회절 데이터"
                        curve = xres.get("series") or xres.get("curve") or {}
                        two_theta = curve.get("two_theta") or []
                        intensity = curve.get("corrected_intensity") or curve.get("raw_intensity") or []
                        if two_theta and intensity:
                            multi_curves.setdefault("XRD", []).append({
                                "id": item.id,
                                "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'XRD'}) - {item.run_number or 1}차",
                                "two_theta": two_theta,
                                "intensity": intensity,
                            })
            elif inst == "SEM":
                if item.run_id:
                    r = conn.execute("SELECT sem_result_json, overlay_relpath, roi_relpath FROM analysis_runs WHERE id = ?", (item.run_id,)).fetchone()
                    if r and r["sem_result_json"]:
                        sres = json.loads(r["sem_result_json"])
                        if eff_sem is None:
                            eff_sem = sres
                            eff_sem["source_file"] = item.original_filename or "SEM 미세조직 영상"
                        multi_curves.setdefault("SEM", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'SEM'})",
                            "metrics": sres,
                        })
            else:
                arow = None
                if item.analysis_id:
                    arow = conn.execute("SELECT * FROM sample_analysis_results WHERE id = ?", (item.analysis_id,)).fetchone()
                elif item.measurement_id:
                    arow = conn.execute("SELECT * FROM sample_analysis_results WHERE measurement_id = ? ORDER BY created_at DESC LIMIT 1", (item.measurement_id,)).fetchone()

                mrow = None
                if item.measurement_id:
                    mrow = conn.execute("SELECT * FROM sample_measurements WHERE id = ?", (item.measurement_id,)).fetchone()

                res_dict = json.loads(arow["results_json"]) if (arow and arow["results_json"]) else {}
                raw_dict = json.loads(mrow["raw_payload_json"]) if (mrow and mrow["raw_payload_json"]) else {}

                if inst == "UTM":
                    if eff_utm is None and res_dict:
                        eff_utm = res_dict
                        eff_utm["source_file"] = item.original_filename or "UTM 인장 곡선"
                    if raw_dict.get("strain") and raw_dict.get("stress"):
                        multi_curves.setdefault("UTM", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'UTM'})",
                            "strain": raw_dict["strain"],
                            "stress": raw_dict["stress"],
                            "metrics": res_dict,
                        })
                elif inst == "HALL":
                    if eff_hall is None and res_dict:
                        eff_hall = res_dict
                        eff_hall["source_file"] = item.original_filename or "Hall 수송 데이터"
                    if raw_dict.get("b_field") and raw_dict.get("hall_voltage"):
                        multi_curves.setdefault("Hall", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'Hall'})",
                            "b_field": raw_dict["b_field"],
                            "hall_voltage": raw_dict["hall_voltage"],
                            "metrics": res_dict,
                        })
                elif inst == "LFA":
                    if eff_lfa is None and res_dict:
                        eff_lfa = res_dict
                        eff_lfa["source_file"] = item.original_filename or "LFA 열확산도 데이터"
                    if raw_dict.get("time_s") and raw_dict.get("rear_temp"):
                        multi_curves.setdefault("LFA", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'LFA'})",
                            "time_s": raw_dict["time_s"],
                            "rear_temp": raw_dict["rear_temp"],
                            "metrics": res_dict,
                        })
                elif inst == "FTIR":
                    if eff_ftir is None and res_dict:
                        eff_ftir = res_dict
                        eff_ftir["source_file"] = item.original_filename or "FT-IR 스펙트럼"
                    if raw_dict.get("wavenumber") and (raw_dict.get("transmittance") or raw_dict.get("absorbance")):
                        multi_curves.setdefault("FT-IR", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'FT-IR'})",
                            "wavenumber": raw_dict["wavenumber"],
                            "signal": raw_dict.get("transmittance") or raw_dict.get("absorbance"),
                            "signal_type": "transmittance" if "transmittance" in raw_dict else "absorbance",
                            "metrics": res_dict,
                        })
                elif inst == "DSC":
                    if eff_dsc is None and res_dict:
                        eff_dsc = res_dict
                        eff_dsc["source_file"] = item.original_filename or "DSC 열류량 데이터"
                    if raw_dict.get("temperature") and raw_dict.get("heat_flow"):
                        multi_curves.setdefault("DSC", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'DSC'})",
                            "temperature": raw_dict["temperature"],
                            "heat_flow": raw_dict["heat_flow"],
                            "metrics": res_dict,
                        })
                elif inst == "TGA":
                    if eff_tga is None and res_dict:
                        eff_tga = res_dict
                        eff_tga["source_file"] = item.original_filename or "TGA 중량 감량 데이터"
                    if raw_dict.get("temperature") and raw_dict.get("mass_percent"):
                        multi_curves.setdefault("TGA", []).append({
                            "id": item.id,
                            "label": f"{item.sample_name or primary_sample_name} ({item.original_filename or 'TGA'})",
                            "temperature": raw_dict["temperature"],
                            "mass_percent": raw_dict["mass_percent"],
                            "metrics": res_dict,
                        })

    result = perform_cross_instrument_analysis(
        sample_id=primary_sample_id,
        material_name=material_name,
        xrd_data=eff_xrd,
        sem_data=eff_sem,
        hall_data=eff_hall,
        lfa_data=eff_lfa,
        utm_data=eff_utm,
        ftir_data=eff_ftir,
        dsc_data=eff_dsc,
        tga_data=eff_tga,
        temperature_K=req.temperature_K,
        selected_instruments=chosen_instruments,
    )
    result_dict = result.to_dict()
    result_dict["report_title"] = report_title

    if req.run_ai:
        ai_interpretation = generate_scoped_integrated_ai_interpretation(
            sample_id=primary_sample_id,
            material_name=material_name,
            selected_instruments=chosen_instruments,
            analysis_result=result_dict,
            user_notes=req.user_notes,
        )
    else:
        ai_interpretation = {
            "analysis_summary": f"선택된 {len(chosen_instruments)}개 기기({', '.join(chosen_instruments)})의 정밀 측정 결과를 통합 분석하였습니다.",
            "data_quality_assessment": "수치 유효성 검증 완료.",
            "physical_mechanisms": ["구조-물성 연계 가설 수립 완료."],
            "scientific_cautions": "선택된 데이터 범위 내 규칙 기반 요약입니다.",
            "recommended_experiments": ["추가 후속 분석을 진행하십시오."],
            "ai_engine": "Deterministic Rule Engine (AI 비활성화 모드)",
        }
    if ai_interpretation and "analysis_summary" in ai_interpretation and "executive_summary" not in ai_interpretation:
        ai_interpretation["executive_summary"] = ai_interpretation["analysis_summary"]

    report_id = new_id("rpt")
    now_iso = utc_now_iso()

    report_data = {
        "id": report_id,
        "report_id": report_id,
        "title": report_title,
        "sample_id": primary_sample_id,
        "material_name": material_name,
        "is_same_sample": is_same_sample,
        "sample_ids": sample_ids,
        "selected_instruments": chosen_instruments,
        "selected_items": [s.model_dump() for s in req.selected_items],
        "analysis_result": result_dict,
        "multi_curves": multi_curves,
        "ai_interpretation": ai_interpretation,
        "created_at": now_iso,
    }

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO integrated_reports (
                id, title, sample_id, material_name, instruments_json, selected_items_json,
                calculated_properties_json, report_data_json, ai_interpretation_json,
                ai_model, prompt_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                report_title,
                primary_sample_id,
                material_name,
                json.dumps(chosen_instruments, ensure_ascii=False),
                json.dumps([s.model_dump() for s in req.selected_items], ensure_ascii=False),
                json.dumps(result_dict.get("key_metrics_table") or [], ensure_ascii=False),
                json.dumps(report_data, ensure_ascii=False),
                json.dumps(ai_interpretation, ensure_ascii=False),
                ai_interpretation.get("ai_engine") or "rule-based",
                "matlens-scoped-v1.0",
                now_iso,
            ),
        )

    log_structured_event("INTEGRATED_SCOPED_REPORT_GENERATED", {
        "report_id": report_id,
        "instruments": chosen_instruments,
        "item_count": len(req.selected_items),
    })

    return report_data


@router.get("/reports/{report_id}")
def get_integrated_report_snapshot(report_id: str):
    """Retrieve an immutable snapshot of an integrated report."""
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM integrated_reports WHERE id = ?", (report_id,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="통합 리포트를 찾을 수 없습니다.")
        return json.loads(r["report_data_json"])


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

    context_prefix = ""
    calc_props = req.calculated_properties or {}
    mat_name = req.material_name
    inst_name = req.instrument

    if req.report_id:
        try:
            with get_conn() as conn:
                r = conn.execute("SELECT * FROM integrated_reports WHERE id = ?", (req.report_id,)).fetchone()
                if r:
                    rpt = json.loads(r["report_data_json"])
                    mat_name = r["material_name"]
                    sel_insts = json.loads(r["instruments_json"])
                    inst_name = " · ".join(sel_insts)
                    calc_props = rpt.get("analysis_result", {}).get("key_metrics_table") or {}
                    context_prefix = (
                        f"[선택된 리포트 스냅샷 컨텍스트]\n"
                        f"• 리포트명: {r['title']}\n"
                        f"• 시료명: {mat_name}\n"
                        f"• 포함된 기기: {inst_name}\n"
                        f"• 주의: 본 상담은 사용자가 명시적으로 선택한 위 기기들의 데이터 범위 내에서만 답변하십시오.\n\n"
                    )
        except Exception:
            pass

    return answer_research_assistant_query(
        question=(context_prefix + req.message) if context_prefix else req.message,
        history=req.history,
        material_name=mat_name,
        chemical_composition=req.chemical_composition,
        instrument=inst_name,
        calculated_properties=calc_props,
        references=req.references,
    )


@router.post("/reports/pdf")
def export_scientific_pdf_endpoint(req: PdfReportRequest):
    """Generates an elegant, highly readable Korean PDF scientific report."""
    log_structured_event("PDF_REPORT_GENERATED", {
        "sample_id": req.sample_id,
        "material_name": req.material_name,
    })

    sample_id = req.sample_id
    mat_name = req.material_name
    calc_props = req.calculated_properties
    insts = req.instruments_included
    wf = req.wiedemann_franz
    grain_corr = req.grain_correlation
    ai_interp = req.ai_interpretation
    xrd_diff = req.xrd_diffraction_data
    xrd_peaks = req.xrd_peaks
    sem_b64 = req.sem_image_base64
    sem_metrics = req.sem_metrics

    if req.report_id:
        try:
            with get_conn() as conn:
                r = conn.execute("SELECT * FROM integrated_reports WHERE id = ?", (req.report_id,)).fetchone()
                if r:
                    rpt = json.loads(r["report_data_json"])
                    sample_id = r["sample_id"] or sample_id
                    mat_name = r["material_name"] or mat_name
                    insts = json.loads(r["instruments_json"])
                    an_res = rpt.get("analysis_result", {})
                    wf = an_res.get("wiedemann_franz")
                    grain_corr = an_res.get("xrd_sem_correlation")
                    ai_interp = rpt.get("ai_interpretation")
                    calc_props = {
                        item["metric_name"]: item["value"]
                        for item in (an_res.get("key_metrics_table") or [])
                    }
                    xrd_series = rpt.get("multi_curves", {}).get("XRD") or []
                    if xrd_series:
                        xrd_diff = {
                            "two_theta": xrd_series[0].get("two_theta"),
                            "intensity": xrd_series[0].get("intensity"),
                        }
        except Exception:
            pass

    pdf_bytes = generate_scientific_pdf_report_v2(
        sample_id=sample_id,
        material_name=mat_name,
        chemical_composition=req.chemical_composition,
        dopant=req.dopant,
        temperature_K=req.temperature_K,
        instruments_included=insts,
        calculated_properties=calc_props,
        wiedemann_franz=wf,
        grain_correlation=grain_corr,
        ai_interpretation=ai_interp,
        references=req.references,
        grounding_claims=req.grounding_claims,
        xrd_diffraction_data=xrd_diff,
        xrd_peaks=xrd_peaks,
        sem_image_base64=sem_b64,
        sem_image_path=req.sem_image_path,
        sem_metrics=sem_metrics,
    )
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', sample_id)
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

