"""FastAPI Router for Multi-Dataset Scientific Plotting & Comparison System.

Endpoints specified in Section 10:
- POST  /api/v1/plots/datasets
- POST  /api/v1/plots/create
- PATCH /api/v1/plots/{plot_id}
- GET   /api/v1/plots/{plot_id}
- POST  /api/v1/plots/compare
- POST  /api/v1/plots/peak-comparison
- POST  /api/v1/plots/export
- GET   /api/v1/plots/{plot_id}/datasets
- GET   /api/v1/plots/samples/{sample_id}/sem-link
- GET   /api/v1/plots/presets
- POST  /api/v1/plots/digitize-image
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from .db import (
    get_conn,
    get_plot,
    get_plot_dataset,
    list_plot_datasets,
    new_id,
    save_plot,
    save_plot_dataset,
    update_plot,
)
from .engine.plot_engine import (
    compute_peak_comparison,
    compute_visualization_series,
    detect_peaks,
    digitize_xrd_image,
    get_xrd_sem_linked_data,
    parse_numeric_dataset,
)
from .engine.plot_export import render_publication_plot

router = APIRouter(tags=["Multi-Dataset Plotting"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DatasetConfig(BaseModel):
    dataset_id: str
    sample_id: str
    name: str
    color: str = "#2563EB"
    offset: float = 0.0
    visible: bool = True
    line_width: float = 1.8
    line_style: str = "solid"
    x_unit: str | None = None
    y_unit: str | None = None


class PlotCreateRequest(BaseModel):
    plot_id: str | None = None
    title: str = "Stacked XRD Comparison"
    plot_type: Literal["stacked", "overlay", "subplot", "peak_comparison"] = "stacked"
    instrument: str = "XRD"
    datasets: list[DatasetConfig] = Field(default_factory=list)
    normalization: Literal["none", "maximum", "area", "user"] = "maximum"
    user_scale: float = 1.0
    preprocessing: dict[str, Any] = Field(default_factory=dict)
    x_axis: dict[str, Any] = Field(default_factory=lambda: {"label": "2θ", "unit": "degree"})
    y_axis: dict[str, Any] = Field(default_factory=lambda: {"label": "Normalized Intensity", "unit": "a.u."})
    annotations: list[dict[str, Any]] = Field(default_factory=list)
    graph_properties: dict[str, Any] = Field(default_factory=dict)


class PlotUpdateRequest(BaseModel):
    title: str | None = None
    plot_type: Literal["stacked", "overlay", "subplot", "peak_comparison"] | None = None
    instrument: str | None = None
    normalization: Literal["none", "maximum", "area", "user"] | None = None
    user_scale: float | None = None
    datasets: list[DatasetConfig] | None = None
    preprocessing: dict[str, Any] | None = None
    x_axis: dict[str, Any] | None = None
    y_axis: dict[str, Any] | None = None
    annotations: list[dict[str, Any]] | None = None
    graph_properties: dict[str, Any] | None = None


class CompareRequest(BaseModel):
    dataset_ids: list[str]
    plot_type: Literal["stacked", "overlay", "subplot", "peak_comparison"] = "stacked"
    normalization: Literal["none", "maximum", "area", "user"] = "maximum"
    user_scale: float = 1.0
    auto_offset: bool = True
    offset_step: float | None = None
    preprocessing: dict[str, Any] = Field(default_factory=dict)


class PeakComparisonRequest(BaseModel):
    reference_dataset_id: str
    sample_dataset_ids: list[str]
    tolerance_deg: float = 0.35
    manual_matches: dict[str, list[dict[str, float]]] | None = None


class ExportRequest(BaseModel):
    plot_id: str | None = None
    plot_data: dict[str, Any] | None = None
    format: Literal["png", "svg", "pdf"] = "png"
    dpi: int = 300
    width_in: float = 7.0
    height_in: float = 5.2
    include_metadata_table: bool = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/datasets")
async def register_or_upload_datasets(
    request: Request,
    files: list[UploadFile] = File(None),
    sample_id: str | None = Form(None),
    sample_name: str | None = Form(None),
    measurement_type: str | None = Form(None),
    x_unit: str | None = Form(None),
    y_unit: str | None = Form(None),
):
    """Upload one or multiple dataset files (CSV, TXT, XLSX), or register dataset via JSON."""
    content_type = request.headers.get("content-type", "")

    # 1. JSON payload registration (e.g. from existing project run or manual client array)
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="유효한 JSON 요청이 아닙니다.")

        # Single or list of datasets
        items = body if isinstance(body, list) else [body]
        saved_items = []

        for item in items:
            # Check if importing from an existing analysis run
            run_id = item.get("run_id")
            if run_id:
                with get_conn() as conn:
                    row = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
                    if not row:
                        raise HTTPException(status_code=404, detail=f"Run {run_id}을 찾을 수 없습니다.")
                    xrd_res = json.loads(row["xrd_result_json"] or "{}")
                    series = xrd_res.get("series") or xrd_res.get("signals") or {}
                    x = series.get("two_theta") or []
                    y = series.get("raw_intensity") or series.get("corrected_intensity") or []
                    if not x:
                        raise HTTPException(status_code=400, detail="해당 Run에 XRD 시계열 데이터가 없습니다.")

                    ds_obj = {
                        "id": new_id("ds"),
                        "sample_id": item.get("sample_id") or row["project_id"],
                        "sample_name": item.get("sample_name") or f"Run #{row['run_number']}",
                        "measurement_type": "XRD",
                        "x_unit": "degree",
                        "y_unit": "counts",
                        "source_type": "analysis_run",
                        "source_filename": f"run_{run_id}.json",
                        "measurement_conditions": xrd_res.get("conditions") or {},
                        "data_quality": {"num_points": len(x), "confidence": "High (MatLens Run)"},
                        "processing_history": [{"step": "Imported from MatLens Run", "run_id": run_id}],
                        "data": {"x": x, "y": y},
                    }
                    ds_id = save_plot_dataset(ds_obj)
                    saved_items.append(get_plot_dataset(ds_id))
                    continue

            # Standard raw JSON dataset
            x = item.get("x") or []
            y = item.get("y") or []
            if len(x) < 5 or len(y) < 5:
                raise HTTPException(status_code=400, detail="최소 5개 이상의 데이터 포인트가 필요합니다.")

            ds_id = save_plot_dataset({
                "id": item.get("dataset_id") or item.get("id") or new_id("ds"),
                "sample_id": item.get("sample_id") or "Sample",
                "sample_name": item.get("sample_name") or item.get("name") or "Sample",
                "measurement_type": item.get("measurement_type") or "XRD",
                "x_unit": item.get("x_unit") or "degree",
                "y_unit": item.get("y_unit") or "a.u.",
                "source_type": item.get("source_type") or "raw_file",
                "source_filename": item.get("source_filename") or "manual_input",
                "measurement_conditions": item.get("measurement_conditions") or {},
                "data_quality": item.get("data_quality") or {"num_points": len(x)},
                "processing_history": item.get("processing_history") or [],
                "data": {"x": x, "y": y},
            })
            saved_items.append(get_plot_dataset(ds_id))

        return {"status": "success", "datasets": saved_items}

    # 2. File Upload (CSV, TXT, XLSX)
    if not files:
        raise HTTPException(status_code=400, detail="업로드할 파일이 없습니다.")

    palette = ["#2563EB", "#DC2626", "#059669", "#7C3AED", "#D97706", "#DB2777", "#0891B2", "#4B5563"]
    saved_items = []

    for idx, file in enumerate(files):
        filename = file.filename or "data.csv"
        raw_bytes = await file.read()
        if len(raw_bytes) < 10:
            continue

        # Extract sample ID and name from filename
        stem = Path(filename).stem
        cur_sample_id = sample_id or stem
        cur_sample_name = sample_name or stem

        # Parse file
        parsed = parse_numeric_dataset(
            raw=raw_bytes,
            filename=filename,
            x_unit=x_unit,
            y_unit=y_unit,
            measurement_type=measurement_type,
        )

        peaks = detect_peaks(np.array(parsed["x"]), np.array(parsed["y"])) if parsed["measurement_type"] == "XRD" else []

        ds_record = {
            "id": new_id("ds"),
            "sample_id": cur_sample_id,
            "sample_name": cur_sample_name,
            "measurement_type": parsed["measurement_type"],
            "x_unit": parsed["x_unit"],
            "y_unit": parsed["y_unit"],
            "source_type": "raw_file",
            "source_filename": filename,
            "measurement_conditions": {},
            "data_quality": parsed["data_quality"],
            "processing_history": [{"step": "Uploaded", "filename": filename}],
            "data": {
                "x": parsed["x"],
                "y": parsed["y"],
                "peaks": peaks,
                "color": palette[idx % len(palette)],
            },
        }

        ds_id = save_plot_dataset(ds_record)
        saved_items.append(get_plot_dataset(ds_id))

    return {"status": "success", "count": len(saved_items), "datasets": saved_items}


@router.post("/digitize-image")
async def digitize_image_endpoint(
    image: UploadFile = File(...),
    sample_id: str | None = Form(None),
    sample_name: str | None = Form(None),
    two_theta_min: float = Form(10.0),
    two_theta_max: float = Form(80.0),
    intensity_min: float = Form(0.0),
    intensity_max: float = Form(1000.0),
):
    """Digitize XRD curve from a graph image and register as a dataset with calibration & error metadata."""
    raw_bytes = await image.read()
    filename = image.filename or "digitized_plot.png"
    stem = Path(filename).stem

    dig_res = digitize_xrd_image(
        image_bytes=raw_bytes,
        filename=filename,
        x_min=two_theta_min,
        x_max=two_theta_max,
        y_min=intensity_min,
        y_max=intensity_max,
    )

    cur_sample_id = sample_id or f"{stem}_digitized"
    cur_sample_name = sample_name or f"{stem} (Digitized)"

    ds_record = {
        "id": new_id("ds"),
        "sample_id": cur_sample_id,
        "sample_name": cur_sample_name,
        "measurement_type": "XRD",
        "x_unit": dig_res["x_unit"],
        "y_unit": dig_res["y_unit"],
        "source_type": "image_digitization",
        "source_filename": filename,
        "measurement_conditions": {"digitization_calibration": dig_res["calibration_info"]},
        "data_quality": dig_res["data_quality"],
        "processing_history": [{"step": "Image Digitized", "filename": filename}],
        "data": {
            "x": dig_res["x"],
            "y": dig_res["y"],
            "peaks": detect_peaks(np.array(dig_res["x"]), np.array(dig_res["y"])),
            "color": "#DC2626",
            "line_style": "dash",
        },
    }

    ds_id = save_plot_dataset(ds_record)
    return {"status": "success", "dataset": get_plot_dataset(ds_id)}


@router.post("/create")
def create_plot(req: PlotCreateRequest):
    """Create a plot configuration and compute initial visual traces."""
    # Retrieve dataset records from DB
    loaded_datasets: list[dict[str, Any]] = []
    for d_cfg in req.datasets:
        ds_row = get_plot_dataset(d_cfg.dataset_id)
        if ds_row:
            d_dict = dict(ds_row["data"])
            d_dict.update({
                "dataset_id": ds_row["id"],
                "sample_id": d_cfg.sample_id or ds_row["sample_id"],
                "sample_name": d_cfg.name or ds_row["sample_name"],
                "measurement_type": ds_row["measurement_type"],
                "color": d_cfg.color,
                "offset": d_cfg.offset,
                "visible": d_cfg.visible,
                "line_width": d_cfg.line_width,
                "line_style": d_cfg.line_style,
                "x_unit": d_cfg.x_unit or ds_row["x_unit"],
                "y_unit": d_cfg.y_unit or ds_row["y_unit"],
                "source_type": ds_row["source_type"],
                "data_quality": ds_row["data_quality"],
            })
            loaded_datasets.append(d_dict)

    # Compute visual series
    computed = compute_visualization_series(
        datasets=loaded_datasets,
        plot_type=req.plot_type,
        normalization=req.normalization,
        user_scale=req.user_scale,
        preprocessing=req.preprocessing,
    )

    plot_config = {
        "datasets": [d.model_dump() for d in req.datasets],
        "preprocessing": req.preprocessing,
        "x_axis": req.x_axis,
        "y_axis": req.y_axis,
        "annotations": req.annotations,
        "graph_properties": req.graph_properties,
    }

    plot_id = req.plot_id or new_id("plot")
    save_plot(
        plot_id=plot_id,
        title=req.title,
        plot_type=req.plot_type,
        instrument=req.instrument,
        normalization=req.normalization,
        user_scale=req.user_scale,
        config=plot_config,
    )

    stored = get_plot(plot_id)
    if not stored:
        raise HTTPException(status_code=500, detail="Failed to save plot.")

    stored["computed"] = computed
    return stored


@router.patch("/{plot_id}")
def update_plot_endpoint(plot_id: str, req: PlotUpdateRequest):
    """Update plot configuration (offsets, reorder, visibility, colors, annotations)."""
    stored = get_plot(plot_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Plot not found")

    patch_dict = req.model_dump(exclude_unset=True)
    updated = update_plot(plot_id, patch_dict)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update plot")

    # Recompute visual series
    cfg = updated["config"]
    loaded_datasets: list[dict[str, Any]] = []
    for d_cfg in cfg.get("datasets", []):
        ds_row = get_plot_dataset(d_cfg.get("dataset_id"))
        if ds_row:
            d_dict = dict(ds_row["data"])
            d_dict.update({
                "dataset_id": ds_row["id"],
                "sample_id": d_cfg.get("sample_id", ds_row["sample_id"]),
                "sample_name": d_cfg.get("name", ds_row["sample_name"]),
                "measurement_type": ds_row["measurement_type"],
                "color": d_cfg.get("color", "#2563EB"),
                "offset": d_cfg.get("offset", 0.0),
                "visible": d_cfg.get("visible", True),
                "line_width": d_cfg.get("line_width", 1.8),
                "line_style": d_cfg.get("line_style", "solid"),
                "x_unit": ds_row["x_unit"],
                "y_unit": ds_row["y_unit"],
                "source_type": ds_row["source_type"],
                "data_quality": ds_row["data_quality"],
            })
            loaded_datasets.append(d_dict)

    computed = compute_visualization_series(
        datasets=loaded_datasets,
        plot_type=updated["plot_type"],
        normalization=updated["normalization"],
        user_scale=updated["user_scale"],
        preprocessing=cfg.get("preprocessing", {}),
    )
    updated["computed"] = computed
    return updated


@router.get("/presets")
def get_presets_endpoint():
    """Retrieve preloaded verified benchmark datasets (AC series, TiO2, UTM, LFA, Hall)."""
    samples_dir = Path(__file__).resolve().parent.parent.parent / "samples"
    presets_info = [
        {
            "category": "XRD Activated Carbon Series (논문 재현)",
            "description": "AC, AC700, AC850, AC1000 열처리 온도별 흑연화 및 (002) 피크 시프트 분석",
            "files": [
                {"name": "AC (Room Temp)", "file": "sample_xrd_AC.csv", "sample_id": "AC", "color": "#1E293B"},
                {"name": "AC700 (700°C)", "file": "sample_xrd_AC700.csv", "sample_id": "AC700", "color": "#0284C7"},
                {"name": "AC850 (850°C)", "file": "sample_xrd_AC850.csv", "sample_id": "AC850", "color": "#D97706"},
                {"name": "AC1000 (1000°C)", "file": "sample_xrd_AC1000.csv", "sample_id": "AC1000", "color": "#DC2626"},
            ],
            "instrument": "XRD",
        },
        {
            "category": "XRD BaTiO3 소결체 시리즈",
            "description": "600°C, 700°C, 800°C 열처리 시편 상전이 및 피크 분할 비교",
            "files": [
                {"name": "BaTiO3 600°C", "file": "sample_xrd_600C.csv", "sample_id": "BTO-600", "color": "#475569"},
                {"name": "BaTiO3 700°C", "file": "sample_xrd_700C.csv", "sample_id": "BTO-700", "color": "#2563EB"},
                {"name": "BaTiO3 800°C", "file": "sample_xrd_800C.csv", "sample_id": "BTO-800", "color": "#B91C1C"},
            ],
            "instrument": "XRD",
        },
        {
            "category": "XRD TiO2 혼상 시료",
            "description": "Anatase (101) 및 Rutile (110) 다상 공존 회절 패턴",
            "files": [
                {"name": "TiO2 (Anatase/Rutile)", "file": "sample_anatase_rutile_xrd.csv", "sample_id": "TiO2", "color": "#7C3AED"},
            ],
            "instrument": "XRD",
        },
        {
            "category": "UTM 인장시험 다중 곡선",
            "description": "ABS100 시험편 및 합금 응력-변형률(S-S) 곡선 중첩 비교",
            "files": [
                {"name": "Alloy 70GPa Tensile", "file": "lab_utm_70GPa.txt", "sample_id": "Alloy-70", "color": "#059669"},
            ],
            "instrument": "UTM",
        },
        {
            "category": "LFA 열확산도 비교",
            "description": "Pyroceram 9606 표준물질 온도별 열확산계수 측정 데이터",
            "files": [
                {"name": "Pyroceram 9606", "file": "sample_lfa_pyroceram9606.csv", "sample_id": "LFA-Pyroceram", "color": "#D97706"},
            ],
            "instrument": "LFA",
        },
        {
            "category": "Hall 계수 반도체 특성",
            "description": "n형 실리콘 웨이퍼 온도별 전하밀도 및 이동도 분석",
            "files": [
                {"name": "n-Si Wafer", "file": "sample_hall_n_si_wafer.csv", "sample_id": "Hall-Si", "color": "#0891B2"},
            ],
            "instrument": "Hall",
        },
    ]

    loaded_categories = []
    for cat in presets_info:
        cat_items = []
        for f_info in cat["files"]:
            p = samples_dir / f_info["file"]
            if p.exists():
                try:
                    raw = p.read_bytes()
                    parsed = parse_numeric_dataset(raw=raw, filename=f_info["file"], measurement_type=cat["instrument"])
                    peaks = detect_peaks(np.array(parsed["x"]), np.array(parsed["y"])) if cat["instrument"] == "XRD" else []
                    cat_items.append({
                        "name": f_info["name"],
                        "file": f_info["file"],
                        "sample_id": f_info["sample_id"],
                        "color": f_info["color"],
                        "x": parsed["x"],
                        "y": parsed["y"],
                        "x_unit": parsed["x_unit"],
                        "y_unit": parsed["y_unit"],
                        "measurement_type": cat["instrument"],
                        "data_quality": parsed["data_quality"],
                        "peaks": peaks,
                    })
                except Exception:
                    pass
        if cat_items:
            loaded_categories.append({
                "category": cat["category"],
                "description": cat["description"],
                "instrument": cat["instrument"],
                "items": cat_items,
            })

    return {"presets": loaded_categories}


@router.get("/samples/{sample_id}/sem-link")
def get_sample_sem_link_endpoint(sample_id: str):
    """Retrieve SEM micrograph and grain size data linked with the XRD sample."""
    return get_xrd_sem_linked_data(sample_id)


@router.get("/{plot_id}")
def get_plot_endpoint(plot_id: str):
    """Get plot and recomputed traces."""
    stored = get_plot(plot_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Plot not found")

    cfg = stored["config"]
    loaded_datasets: list[dict[str, Any]] = []
    for d_cfg in cfg.get("datasets", []):
        ds_row = get_plot_dataset(d_cfg.get("dataset_id"))
        if ds_row:
            d_dict = dict(ds_row["data"])
            d_dict.update({
                "dataset_id": ds_row["id"],
                "sample_id": d_cfg.get("sample_id", ds_row["sample_id"]),
                "sample_name": d_cfg.get("name", ds_row["sample_name"]),
                "measurement_type": ds_row["measurement_type"],
                "color": d_cfg.get("color", "#2563EB"),
                "offset": d_cfg.get("offset", 0.0),
                "visible": d_cfg.get("visible", True),
                "line_width": d_cfg.get("line_width", 1.8),
                "line_style": d_cfg.get("line_style", "solid"),
                "x_unit": ds_row["x_unit"],
                "y_unit": ds_row["y_unit"],
                "source_type": ds_row["source_type"],
                "data_quality": ds_row["data_quality"],
            })
            loaded_datasets.append(d_dict)

    computed = compute_visualization_series(
        datasets=loaded_datasets,
        plot_type=stored["plot_type"],
        normalization=stored["normalization"],
        user_scale=stored["user_scale"],
        preprocessing=cfg.get("preprocessing", {}),
    )
    stored["computed"] = computed
    return stored


@router.get("/{plot_id}/datasets")
def get_plot_datasets_endpoint(plot_id: str):
    """List all dataset records linked to a specific plot."""
    stored = get_plot(plot_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Plot not found")

    cfg = stored["config"]
    ds_ids = [d.get("dataset_id") for d in cfg.get("datasets", []) if d.get("dataset_id")]
    records = []
    for did in ds_ids:
        r = get_plot_dataset(did)
        if r:
            records.append(r)
    return {"plot_id": plot_id, "count": len(records), "datasets": records}


@router.post("/compare")
def compare_datasets_endpoint(req: CompareRequest):
    """Compute cross-dataset comparison, normalization, offsets, and summary metrics."""
    loaded_datasets: list[dict[str, Any]] = []
    for did in req.dataset_ids:
        ds_row = get_plot_dataset(did)
        if ds_row:
            d_dict = dict(ds_row["data"])
            d_dict.update({
                "dataset_id": ds_row["id"],
                "sample_id": ds_row["sample_id"],
                "sample_name": ds_row["sample_name"],
                "measurement_type": ds_row["measurement_type"],
                "x_unit": ds_row["x_unit"],
                "y_unit": ds_row["y_unit"],
                "source_type": ds_row["source_type"],
                "data_quality": ds_row["data_quality"],
                "visible": True,
            })
            loaded_datasets.append(d_dict)

    if not loaded_datasets:
        raise HTTPException(status_code=400, detail="유효한 데이터셋이 지정되지 않았습니다.")

    # Unit compatibility check
    units_y = {d.get("y_unit", "") for d in loaded_datasets}
    units_x = {d.get("x_unit", "") for d in loaded_datasets}
    has_unit_mismatch = (len(units_y) > 1 and req.plot_type == "overlay")

    computed = compute_visualization_series(
        datasets=loaded_datasets,
        plot_type=req.plot_type,
        normalization=req.normalization,
        user_scale=req.user_scale,
        auto_offset=req.auto_offset,
        offset_step=req.offset_step,
        preprocessing=req.preprocessing,
    )

    # Summary table
    summary_list = []
    for ds in computed["datasets"]:
        x = np.array(ds["x"])
        y = np.array(ds["y_raw"])
        pks = ds.get("peaks", [])
        top_pk = pks[0]["two_theta"] if pks else None
        summary_list.append({
            "dataset_id": ds["dataset_id"],
            "sample_id": ds["sample_id"],
            "sample_name": ds["sample_name"],
            "source_type": ds["source_type"],
            "points": len(x),
            "x_range": [round(float(x.min()), 2), round(float(x.max()), 2)] if len(x) else [],
            "max_intensity": round(float(y.max()), 2) if len(y) else 0.0,
            "peak_count": len(pks),
            "strongest_peak_2theta": top_pk,
            "data_quality": ds.get("data_quality", {}),
        })

    return {
        "status": "success",
        "plot_type": req.plot_type,
        "normalization": req.normalization,
        "has_unit_mismatch": has_unit_mismatch,
        "unit_warning": "서로 다른 Y축 단위의 데이터셋이 감지되었습니다. Overlay 모드 대신 Stacked 또는 Subplot 모드를 권장합니다." if has_unit_mismatch else None,
        "datasets": computed["datasets"],
        "view_bounds": computed["view_bounds"],
        "summary": summary_list,
    }


@router.post("/peak-comparison")
def peak_comparison_endpoint(req: PeakComparisonRequest):
    """Compute peak matching, shift Δ(2θ) = 2θ_sample - 2θ_reference, FWHM comparison."""
    ref_row = get_plot_dataset(req.reference_dataset_id)
    if not ref_row:
        raise HTTPException(status_code=404, detail="기준(Reference) 데이터셋을 찾을 수 없습니다.")

    ref_dict = dict(ref_row["data"])
    ref_dict.update({
        "dataset_id": ref_row["id"],
        "sample_name": ref_row["sample_name"],
    })

    sample_dicts: list[dict[str, Any]] = []
    for sid in req.sample_dataset_ids:
        s_row = get_plot_dataset(sid)
        if s_row:
            s_dict = dict(s_row["data"])
            s_dict.update({
                "dataset_id": s_row["id"],
                "sample_name": s_row["sample_name"],
            })
            sample_dicts.append(s_dict)

    res = compute_peak_comparison(
        reference_dataset=ref_dict,
        sample_datasets=sample_dicts,
        tolerance_deg=req.tolerance_deg,
        manual_matches=req.manual_matches,
    )
    return res


@router.post("/export")
def export_plot_endpoint(req: ExportRequest):
    """Export publication-quality figure in PNG (>=300 DPI), SVG, or PDF."""
    plot_data = req.plot_data
    if not plot_data and req.plot_id:
        stored = get_plot_endpoint(req.plot_id)
        cfg = stored.get("config", {})
        plot_data = {
            "title": stored.get("title"),
            "plot_type": stored.get("plot_type"),
            "normalization": stored.get("normalization"),
            "datasets": stored.get("computed", {}).get("datasets", []),
            "x_axis": cfg.get("x_axis", {}),
            "y_axis": cfg.get("y_axis", {}),
            "annotations": cfg.get("annotations", []),
            "graph_properties": cfg.get("graph_properties", {}),
        }

    if not plot_data:
        raise HTTPException(status_code=400, detail="내보낼 플롯 데이터가 없습니다.")

    img_bytes = render_publication_plot(
        plot_data=plot_data,
        format=req.format,
        dpi=req.dpi,
        width_in=req.width_in,
        height_in=req.height_in,
        include_metadata_table=req.include_metadata_table,
    )

    mime_map = {
        "png": "image/png",
        "svg": "image/svg+xml",
        "pdf": "application/pdf",
    }
    ext = req.format.lower()
    return Response(
        content=img_bytes,
        media_type=mime_map.get(ext, "image/png"),
        headers={"Content-Disposition": f'attachment; filename="matlens_scientific_plot.{ext}"'},
    )
