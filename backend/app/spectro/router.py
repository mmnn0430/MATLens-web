"""FastAPI Router for Independent Spectroscopy and Thermal Analysis (FT-IR, DSC, TGA).

Endpoints:
- GET  /api/spectro/samples/{instrument}       : Benchmark synthetic sample data
- POST /api/spectro/{instrument}/parse         : Multi-format raw file upload & inspection
- POST /api/spectro/{instrument}/analyze       : Pure Python numerical calculation engine
- POST /api/spectro/{instrument}/ai            : Grounded Gemini scientific interpretation
- POST /api/spectro/{instrument}/download/pdf  : Standalone publication-quality Korean PDF
- POST /api/spectro/{instrument}/download/chart: High-DPI PNG chart export
- POST /api/spectro/{instrument}/download/csv  : Clean converted/processed CSV export
- POST /api/spectro/{instrument}/download/json : Full structured machine-readable JSON
- POST /api/spectro/{instrument}/compare       : Multi-sample overlay & comparison metrics
"""
from __future__ import annotations

import csv
import io
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app.spectro.ai_engine import run_spectro_ai_interpretation
from app.spectro.data_parser import parse_raw_file_bytes
from app.spectro.dsc_engine import run_dsc_analysis
from app.spectro.ftir_engine import (
    calculate_film_thickness_interference,
    convert_ftir_signals,
    preprocess_and_detect_peaks,
)
from app.spectro.pdf_generator import (
    _generate_dsc_chart_png,
    _generate_ftir_chart_png,
    _generate_tga_chart_png,
    generate_spectro_pdf_report,
)
from app.spectro.sample_data import (
    generate_dsc_synthetic_csv,
    generate_ftir_synthetic_csv,
    generate_tga_synthetic_csv,
)
from app.spectro.tga_engine import run_tga_analysis

logger = logging.getLogger("matlens.spectro.api")
router = APIRouter(prefix="/api/spectro", tags=["spectro"])


def _extract_column(columns: list[Any], column_data: list[list[float]], target_roles: list[str], fallback_idx: int) -> list[float] | None:
    """Intelligently match column data by detected role or name, falling back to index."""
    for i, col in enumerate(columns):
        if i >= len(column_data):
            continue
        if isinstance(col, dict):
            role = str(col.get("detected_role", "")).lower()
            name = str(col.get("name", "")).lower()
            unit = str(col.get("detected_unit", "")).lower()
            if any(r in role for r in target_roles) or any(r in name for r in target_roles) or any(r in unit for r in target_roles):
                return column_data[i]
        elif isinstance(col, str):
            if any(r in col.lower() for r in target_roles):
                return column_data[i]
    if 0 <= fallback_idx < len(column_data):
        return column_data[fallback_idx]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response Models
# ─────────────────────────────────────────────────────────────────────────────

class SpectroAnalyzeRequest(BaseModel):
    instrument: str = Field(..., description="ftir, dsc, or tga")
    filename: Optional[str] = "spectro_raw_data"
    columns: list[Any] = Field(default_factory=list, description="Column names or column metadata objects")
    column_data: list[list[float]] = Field(default_factory=list, description="Array of column float values")
    conditions: dict[str, Any] = Field(default_factory=dict, description="Instrument-specific calculation parameters")
    notes: Optional[str] = ""


class SpectroAIRequest(BaseModel):
    instrument: str
    analysis_result: dict[str, Any]
    user_notes: Optional[str] = ""


class SpectroDownloadRequest(BaseModel):
    instrument: str
    analysis_result: dict[str, Any]
    filename: Optional[str] = "spectro_data"
    notes: Optional[str] = ""
    ai_report: Optional[dict[str, Any]] = None


class SpectroCompareItem(BaseModel):
    sample_id: str
    sample_name: str
    instrument: str
    analysis_result: dict[str, Any]
    color: Optional[str] = None
    y_offset: Optional[float] = 0.0
    visible: Optional[bool] = True


class SpectroCompareRequest(BaseModel):
    instrument: str
    items: list[SpectroCompareItem]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Benchmark Synthetic Samples
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/samples/{instrument}")
def get_benchmark_sample(instrument: str):
    """Return benchmark synthetic dataset with verifiable ground truth for each instrument."""
    inst = instrument.lower().strip()
    if inst == "ftir":
        csv_text = generate_ftir_synthetic_csv(film_thickness_um=25.0, refractive_index=1.59)
        return {
            "instrument": "ftir",
            "sample_name": "폴리스티렌(PS) 표준 박막 (간섭무늬 두께 검증용)",
            "filename": "benchmark_polystyrene_film_ftir.csv",
            "description": "25.0 μm 폴리스티렌 박막의 Fabry-Perot 간섭무늬(1800~2750 cm⁻¹) 및 방향족 고리 C-H 밴드가 포함된 표준 스펙트럼",
            "csv_content": csv_text,
            "recommended_conditions": {
                "signal_type": "transmittance",
                "refractive_index": 1.59,
                "refractive_index_source": "고분자 표준 굴절률 (Polystyrene n=1.59)",
                "fringe_min_wn": 2400.0,
                "fringe_max_wn": 2750.0,
                "min_prominence": 1.5,
            },
        }
    elif inst == "dsc":
        csv_text = generate_dsc_synthetic_csv(sample_mass_mg=8.5, heating_rate_c_min=10.0)
        return {
            "instrument": "dsc",
            "sample_name": "Poly(ethylene terephthalate) (PET) 다단계 가열/냉각 분석",
            "filename": "benchmark_pet_multicycle_dsc.csv",
            "description": "1차 가열(Tg 78°C, Tcc 130°C, Tm 255°C) → 1차 냉각(Tc 195°C) → 2차 가열(Tg 80°C, Tm 255°C) 3단계 열이력 분리 데이터",
            "csv_content": csv_text,
            "recommended_conditions": {
                "sample_mass_mg": 8.5,
                "heat_flow_unit": "mW",
                "standard_melting_enthalpy_J_per_g": 140.0,
                "sample_mass_fraction": 1.0,
            },
        }
    elif inst == "tga":
        csv_text = generate_tga_synthetic_csv(initial_mass_mg=10.0, heating_rate_c_min=10.0)
        return {
            "instrument": "tga",
            "sample_name": "카본블랙 함유 고무 복합재 (분위기 질소→공기 전환)",
            "filename": "benchmark_rubber_carbonblack_tga.csv",
            "description": "가소제(10%, ~240°C) → 고분자 열분해(55%, 질소 430°C) → 600°C 공기 전환 후 카본블랙 연소(30%, 665°C) → 무기 회분(5%) 4단계 분석",
            "csv_content": csv_text,
            "recommended_conditions": {
                "initial_mass_mg": 10.0,
                "gas_switch_temp_c": 600.0,
                "input_is_percent": True,
            },
        }
    else:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 장비 종류: {instrument}. ('ftir', 'dsc', 'tga' 중 선택)")


# ─────────────────────────────────────────────────────────────────────────────
# 2. File Upload & Multi-Format Parsing
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{instrument}/parse")
async def spectro_parse_file(instrument: str, file: UploadFile = File(...)):
    """Upload and parse raw spectroscopy/thermal files (CSV, TXT, TSV, XLSX) with encoding auto-detection."""
    inst = instrument.lower().strip()
    if inst not in ("ftir", "dsc", "tga"):
        raise HTTPException(status_code=400, detail=f"지원하지 않는 장비: {instrument}")

    try:
        content_bytes = await file.read()
        filename = file.filename or f"raw_{inst}_data.txt"
        parsed = parse_raw_file_bytes(content_bytes, filename=filename)
        return {
            "status": "success",
            "instrument": inst,
            "filename": filename,
            **parsed,
        }
    except Exception as e:
        logger.exception("Spectro parsing error: %s", str(e))
        raise HTTPException(status_code=400, detail=f"파일 파싱 실패: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# 3. Numerical Calculation Engine
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{instrument}/analyze")
def spectro_analyze(instrument: str, req: SpectroAnalyzeRequest):
    """Execute Python numerical engine for FT-IR, DSC, or TGA."""
    inst = instrument.lower().strip()
    cond = req.conditions or {}

    try:
        if len(req.column_data) < 2:
            raise ValueError("분석을 수행하기 위해 최소 2개 이상의 수치 열이 필요합니다.")

        if inst == "ftir":
            # Column 0: Wavenumber, Column 1: Signal
            wn = req.column_data[0]
            sig = req.column_data[1]
            signal_type = cond.get("signal_type", "transmittance")
            conv = convert_ftir_signals(wn, sig, signal_type=signal_type)

            # Preprocessing & peaks
            proc = preprocess_and_detect_peaks(
                conv["wavenumbers"],
                conv["absorbance"],
                conv["transmittance_pct"],
                use_smoothing=cond.get("use_smoothing", False),
                smooth_window=int(cond.get("smooth_window", 9)),
                smooth_polyorder=int(cond.get("smooth_polyorder", 3)),
                use_baseline_correction=cond.get("use_baseline_correction", False),
                baseline_degree=int(cond.get("baseline_degree", 1)),
                min_prominence=float(cond.get("min_prominence", 0.02)),
                min_distance_cm=float(cond.get("min_distance_cm", 8.0)),
                wavenumber_min=cond.get("wavenumber_min"),
                wavenumber_max=cond.get("wavenumber_max"),
                excluded_wavenumbers=cond.get("excluded_wavenumbers"),
            )

            # Fringe thickness
            refractive_index = cond.get("refractive_index")
            if refractive_index is not None and float(refractive_index) <= 0:
                refractive_index = None
            fringe_min = float(cond.get("fringe_min_wn", 2400.0))
            fringe_max = float(cond.get("fringe_max_wn", 2750.0))

            fringes = calculate_film_thickness_interference(
                conv["wavenumbers"],
                conv["transmittance_pct"],
                refractive_index=float(refractive_index) if refractive_index else None,
                refractive_index_source=cond.get("refractive_index_source", "사용자 입력/참고 문헌치"),
                wavenumber_range=(min(fringe_min, fringe_max), max(fringe_min, fringe_max)),
                min_prominence=float(cond.get("fringe_prominence", 1.5)),
                user_selected_points=cond.get("user_fringe_points"),
            )

            return {
                "status": "success",
                "instrument": "ftir",
                "filename": req.filename,
                "analysis": {
                    **conv,
                    **proc,
                    "peaks": proc["detected_peaks"],
                    "fringes": fringes,
                    "conditions_applied": cond,
                },
            }

        elif inst == "dsc":
            temp = _extract_column(req.columns, req.column_data, ["temperature", "temp", "온도"], 0)
            hf = _extract_column(req.columns, req.column_data, ["heat_flow", "heatflow", "열유속", "mw", "w/g"], 1)
            time_s = _extract_column(req.columns, req.column_data, ["time", "시간"], -1)
            if temp is None:
                temp = req.column_data[0]
            if hf is None:
                hf = req.column_data[-1] if len(req.column_data) > 1 else req.column_data[0]

            sample_mass_mg = cond.get("sample_mass_mg")
            std_dh = cond.get("standard_melting_enthalpy_J_per_g")
            mass_frac = float(cond.get("sample_mass_fraction", 1.0))
            hf_unit = cond.get("heat_flow_unit", "mW")
            active_seg_id = cond.get("selected_segment_id") or cond.get("active_segment_id")

            res = run_dsc_analysis(
                temp,
                hf,
                time_s=time_s,
                sample_mass_mg=float(sample_mass_mg) if sample_mass_mg else None,
                heat_flow_unit=hf_unit,
                standard_melting_enthalpy_J_per_g=float(std_dh) if std_dh else None,
                polymer_mass_fraction=mass_frac,
                selected_segment_id=active_seg_id,
                custom_tg_range=cond.get("custom_tg_range"),
                custom_melting_range=cond.get("custom_melting_range"),
                custom_cryst_range=cond.get("custom_cryst_range"),
            )

            return {
                "status": "success",
                "instrument": "dsc",
                "filename": req.filename,
                "analysis": res,
            }

        elif inst == "tga":
            is_pct = cond.get("input_is_percent", True)
            temp = _extract_column(req.columns, req.column_data, ["temperature", "temp", "온도"], 0)
            time_s = _extract_column(req.columns, req.column_data, ["time", "시간"], -1)
            if is_pct:
                mass = _extract_column(req.columns, req.column_data, ["residual", "mass_pct", "pct", "%"], 1)
            else:
                mass = _extract_column(req.columns, req.column_data, ["mass", "질량", "mg", "g"], 1)
            if temp is None:
                temp = req.column_data[0]
            if mass is None:
                mass = req.column_data[-1] if len(req.column_data) > 1 else req.column_data[0]

            init_mass = cond.get("initial_mass_mg")
            gas_switch = cond.get("gas_switch_temp_c")

            res = run_tga_analysis(
                temp,
                mass,
                time_s=time_s,
                initial_mass_mg=float(init_mass) if init_mass else None,
                input_is_percent=bool(is_pct),
                gas_switch_temp_c=float(gas_switch) if gas_switch else None,
                custom_step_boundaries=cond.get("custom_step_boundaries"),
            )

            return {
                "status": "success",
                "instrument": "tga",
                "filename": req.filename,
                "analysis": res,
            }

        else:
            raise HTTPException(status_code=400, detail=f"알 수 없는 장비: {inst}")

    except Exception as e:
        logger.exception("Analysis error on %s: %s", inst, str(e))
        raise HTTPException(status_code=400, detail=f"분석 계산 실패: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Gemini AI Scientific Interpretation
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{instrument}/ai")
def spectro_ai_interpretation(instrument: str, req: SpectroAIRequest):
    """Generate grounded Gemini AI interpretation or fallback structured rule-based report."""
    inst = instrument.lower().strip()
    try:
        ai_res = run_spectro_ai_interpretation(
            instrument=inst,
            analysis_result=req.analysis_result,
            user_notes=req.user_notes,
        )
        report_content = ai_res.get("report") if isinstance(ai_res, dict) and "report" in ai_res and isinstance(ai_res["report"], dict) else ai_res
        return {
            "status": "success",
            "instrument": inst,
            "report": report_content,
            "envelope": ai_res,
        }
    except Exception as e:
        logger.exception("AI interpretation error: %s", str(e))
        raise HTTPException(status_code=500, detail=f"AI 해석 생성 오류: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# 5. Downloads (PDF, PNG Chart, CSV, JSON)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{instrument}/download/pdf")
def spectro_download_pdf(instrument: str, req: SpectroDownloadRequest):
    """Download publication-quality Korean PDF report with embedded charts and evidence tables."""
    inst = instrument.lower().strip()
    try:
        pdf_bytes = generate_spectro_pdf_report(
            instrument=inst,
            analysis_result=req.analysis_result,
            file_name=req.filename or f"matlens_{inst}_report",
            notes=req.notes or "",
            ai_interpretation=req.ai_report,
        )
        safe_fname = f"matlens_{inst}_report.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_fname}"'},
        )
    except Exception as e:
        logger.exception("PDF generation error: %s", str(e))
        raise HTTPException(status_code=500, detail=f"PDF 리포트 생성 실패: {str(e)}")


@router.post("/{instrument}/download/chart")
def spectro_download_chart(instrument: str, req: SpectroDownloadRequest):
    """Download 180 DPI 2-panel chart PNG."""
    inst = instrument.lower().strip()
    try:
        if inst == "ftir":
            png_bytes = _generate_ftir_chart_png(req.analysis_result, None)
        elif inst == "dsc":
            png_bytes = _generate_dsc_chart_png(req.analysis_result, None)
        elif inst == "tga":
            png_bytes = _generate_tga_chart_png(req.analysis_result, None)
        else:
            raise ValueError(f"지원하지 않는 장비: {inst}")

        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="matlens_{inst}_chart.png"'},
        )
    except Exception as e:
        logger.exception("Chart generation error: %s", str(e))
        raise HTTPException(status_code=500, detail=f"차트 이미지 생성 실패: {str(e)}")


@router.post("/{instrument}/download/csv")
def spectro_download_csv(instrument: str, req: SpectroDownloadRequest):
    """Download converted and processed numerical data table as CSV."""
    inst = instrument.lower().strip()
    analysis = req.analysis_result

    buf = io.StringIO()
    writer = csv.writer(buf)

    # Header comments with metadata & calculations
    buf.write(f"# MatLens Spectroscopy & Thermal Analysis Export\n")
    buf.write(f"# Instrument: {inst.upper()}\n")
    buf.write(f"# Source File: {req.filename}\n")

    if inst == "ftir":
        wn = analysis.get("wavenumbers", [])
        t_pct = analysis.get("transmittance_pct", [])
        abs_y = analysis.get("absorbance", [])
        fringes = analysis.get("fringes", {})
        if fringes.get("physical_thickness_um"):
            buf.write(f"# Calculated Film Thickness: {fringes['physical_thickness_um']} um (n={fringes.get('refractive_index')})\n")
        buf.write("Wavenumber_cm-1,Transmittance_pct,Absorbance_A\n")
        for w, t, a in zip(wn, t_pct, abs_y):
            writer.writerow([f"{w:.2f}", f"{t:.3f}", f"{a:.4f}"])

    elif inst == "dsc":
        temp = analysis.get("temperature", [])
        hf = analysis.get("heat_flow", [])
        dq = analysis.get("heat_flow_deriv", [])
        trans = analysis.get("transitions", {})
        tm = trans.get("melting", {})
        if tm.get("tm_peak_c"):
            buf.write(f"# Tm Peak: {tm['tm_peak_c']} C, delta_Hm: {tm.get('delta_h_m_J_per_g')} J/g\n")
        xc = trans.get("crystallinity", {})
        if xc.get("crystallinity_pct") is not None:
            buf.write(f"# Crystallinity Xc: {xc['crystallinity_pct']} %\n")
        buf.write("Temperature_C,HeatFlow_W_per_g,dHF_dT\n")
        for i, (t, q) in enumerate(zip(temp, hf)):
            d_val = f"{dq[i]:.6f}" if i < len(dq) else ""
            writer.writerow([f"{t:.2f}", f"{q:.6f}", d_val])

    elif inst == "tga":
        temp = analysis.get("temperature", [])
        mass_pct = analysis.get("mass_percent", [])
        dtg = analysis.get("dtg_pct_per_c", [])
        decomp = analysis.get("decomposition_characteristics", {})
        if decomp.get("T5_c"):
            buf.write(f"# T5 (5% mass loss): {decomp['T5_c']} C\n")
        if decomp.get("T10_c"):
            buf.write(f"# T10 (10% mass loss): {decomp['T10_c']} C\n")
        buf.write("Temperature_C,Residual_Mass_pct,DTG_pct_per_C\n")
        for i, (t, w) in enumerate(zip(temp, mass_pct)):
            dtg_val = f"{dtg[i]:.4f}" if i < len(dtg) else ""
            writer.writerow([f"{t:.2f}", f"{w:.3f}", dtg_val])

    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="matlens_{inst}_processed_data.csv"'},
    )


@router.post("/{instrument}/download/json")
def spectro_download_json(instrument: str, req: SpectroDownloadRequest):
    """Download full structured analysis result as JSON."""
    inst = instrument.lower().strip()
    payload = {
        "generator": "MatLens Spectroscopy & Thermal Analysis Engine v1.0",
        "instrument": inst,
        "filename": req.filename,
        "notes": req.notes,
        "analysis": req.analysis_result,
        "ai_report": req.ai_report,
    }
    json_bytes = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="matlens_{inst}_analysis.json"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 6. Multi-Sample Comparison & Overlay
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{instrument}/compare")
def spectro_compare_samples(instrument: str, req: SpectroCompareRequest):
    """Validate and align multiple sample curves for overlay visualization without modifying raw data."""
    inst = instrument.lower().strip()
    items = req.items
    if not items:
        return {"status": "empty", "items": [], "comparison_table": []}

    comparison_table: list[dict[str, Any]] = []
    warnings: list[str] = []

    for item in items:
        an = item.analysis_result
        if inst == "ftir":
            peaks = an.get("peaks", [])
            fringes = an.get("fringes", {})
            comparison_table.append({
                "sample_id": item.sample_id,
                "sample_name": item.sample_name,
                "peak_count": len(peaks),
                "top_peak_wavenumbers": [p["wavenumber"] for p in peaks[:4]],
                "thickness_um": fringes.get("physical_thickness_um"),
                "optical_thickness_um": fringes.get("optical_thickness_um"),
            })
        elif inst == "dsc":
            trans = an.get("transitions", {})
            tm = trans.get("melting", {})
            tc = trans.get("crystallization", {})
            tg = trans.get("glass_transition", {})
            xc = trans.get("crystallinity", {})
            comparison_table.append({
                "sample_id": item.sample_id,
                "sample_name": item.sample_name,
                "tg_midpoint_c": tg.get("tg_midpoint_c"),
                "tm_peak_c": tm.get("tm_peak_c"),
                "delta_h_m_J_per_g": tm.get("delta_h_m_J_per_g"),
                "tc_peak_c": tc.get("tc_peak_c"),
                "delta_h_c_J_per_g": tc.get("delta_h_c_J_per_g"),
                "crystallinity_pct": xc.get("crystallinity_pct"),
            })
        elif inst == "tga":
            decomp = an.get("decomposition_characteristics", {})
            res = an.get("residual", {})
            steps = an.get("steps", [])
            comparison_table.append({
                "sample_id": item.sample_id,
                "sample_name": item.sample_name,
                "T5_c": decomp.get("T5_c"),
                "T10_c": decomp.get("T10_c"),
                "steps_count": len(steps),
                "final_residual_pct": res.get("final_residual_pct"),
            })

    return {
        "status": "success",
        "instrument": inst,
        "sample_count": len(items),
        "comparison_table": comparison_table,
        "warnings": warnings,
    }
