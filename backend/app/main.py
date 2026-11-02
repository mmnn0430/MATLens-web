"""MatLens FastAPI Server.

Endpoints cover:
- Project lifecycle & sample demo loader
- Validated XRD/SEM/CIF upload with SHA-256 hashing & immediate structural inspection
- Asynchronous analysis job submission & status polling
- Gemini AI retry & external transmission scope disclosure
- Korean PDF, CSV, JSON, and PNG downloads
"""
from __future__ import annotations

from contextlib import asynccontextmanager
import csv
import hashlib
import io
import json
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import (
    ALLOWED_CIF_EXTS,
    ALLOWED_SEM_EXTS,
    ALLOWED_XRD_EXTS,
    GEMINI_MODEL_OPTIONS,
    MAX_IMAGE_PIXELS,
    MAX_UPLOAD_BYTES,
    PROJECT_ROOT,
    PROJECTS_STORAGE_DIR,
    REF_LIBRARY_VERSION,
    SAMPLES_DIR,
    ensure_dirs,
    get_algorithm_and_library_versions,
    get_gemini_model,
    has_gemini_api_key,
    has_mp_api_key,
    update_runtime_api_config,
)
from .db import delete_project_completely, get_conn, init_db, new_id, record_history, utc_now_iso
from .engine.pdf_export import generate_pdf_report
from .engine.xrd_export import generate_xrd_figure_png
from .engine.ref_library import XRAY_PRESETS, load_reference_library, parse_user_cif
from .engine.report_engine import (
    describe_external_ai_scope,
    discover_available_gemini_models,
    generate_gemini_interpretation,
    generate_grain_phase_ai_interpretation,
)
from .engine.sem_engine import compute_grain_phase_map, inspect_sem_bytes, load_sem_grayscale_and_rgb
from .engine.xrd_engine import inspect_and_parse_xrd
from .jobs import submit_analysis_job
from .schemas import (
    CreateProjectRequest,
    ROIRect,
    RunAnalysisRequest,
    SEMParams,
    UpdateAIConfigRequest,
    UpdateProjectRequest,
    XRDParams,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("matlens.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_dirs()
    init_db()
    load_reference_library()
    yield


app = FastAPI(
    title="MatLens API",
    description="XRD와 SEM을 함께 분석하는 재료 연구용 분석 보조 엔진",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Helper Serializers ---------------- #
def _serialize_project(project_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        proj = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        files = conn.execute(
            "SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC", (project_id,)
        ).fetchall()
        runs = conn.execute(
            """
            SELECT id, run_number, status, progress_pct, stage_message, error_message, created_at, completed_at
            FROM analysis_runs WHERE project_id = ? ORDER BY run_number DESC
            """,
            (project_id,),
        ).fetchall()
        history = conn.execute(
            "SELECT id, action_type, summary, created_at FROM edit_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 30",
            (project_id,),
        ).fetchall()
        latest_ai = conn.execute(
            "SELECT id, run_id, status, model_name, created_at FROM ai_reports WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()

    latest_run_id = runs[0]["id"] if runs else None
    has_outdated_ai = bool(latest_ai and latest_run_id and latest_ai["run_id"] != latest_run_id)

    files_out = []
    for f in files:
        files_out.append(
            {
                "id": f["id"],
                "file_role": f["file_role"],
                "original_filename": f["original_filename"],
                "sha256": f["sha256"],
                "size_bytes": f["size_bytes"],
                "is_sample": bool(f["is_sample"]),
                "inspection": json.loads(f["inspection_json"]),
                "created_at": f["created_at"],
            }
        )

    return {
        "id": proj["id"],
        "sample_name": proj["sample_name"],
        "description": proj["description"],
        "expected_elements": json.loads(proj["expected_elements_json"]),
        "expected_formula": proj["expected_formula"],
        "is_same_sample": bool(proj["is_same_sample"]),
        "is_sample_demo": bool(proj["is_sample_demo"]),
        "current_conditions": json.loads(proj["current_conditions_json"]),
        "files": files_out,
        "runs": [dict(r) for r in runs],
        "latest_run_id": latest_run_id,
        "has_outdated_ai": has_outdated_ai,
        "edit_history": [dict(h) for h in history],
        "created_at": proj["created_at"],
        "updated_at": proj["updated_at"],
    }


def _serialize_run(run_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="분석 실행 기록을 찾을 수 없습니다.")
        ai_this_run = conn.execute(
            "SELECT * FROM ai_reports WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", (run_id,)
        ).fetchone()
        ai_latest_completed = conn.execute(
            "SELECT * FROM ai_reports WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
            (r["project_id"],),
        ).fetchone()

    def _fmt_ai(row: Any) -> dict[str, Any] | None:
        if not row:
            return None
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "status": row["status"],
            "model_name": row["model_name"],
            "prompt_version": row["prompt_version"],
            "schema_valid": bool(row["schema_valid"]),
            "reference_check": json.loads(row["reference_check_json"]),
            "report": json.loads(row["report_json"]) if row["report_json"] else None,
            "error_message": row["error_message"],
            "created_at": row["created_at"],
        }

    ai_current = _fmt_ai(ai_this_run)
    ai_fallback_prev = _fmt_ai(ai_latest_completed) if (ai_latest_completed and ai_latest_completed["run_id"] != run_id) else None

    is_stale_missing_key_error = bool(
        has_gemini_api_key()
        and ai_current
        and ai_current["status"] == "failed"
        and (
            "GEMINI_API_KEY" in (ai_current.get("error_message") or "")
            or "키가 아직 설정되지" in (ai_current.get("error_message") or "")
        )
    )

    xrd_obj = json.loads(r["xrd_result_json"]) if r["xrd_result_json"] else None
    sem_obj = json.loads(r["sem_result_json"]) if r["sem_result_json"] else None

    if sem_obj is not None and "grain_phase_map" not in sem_obj and r["roi_relpath"]:
        roi_p = PROJECTS_STORAGE_DIR / r["project_id"] / r["roi_relpath"]
        if roi_p.exists():
            try:
                with get_conn() as conn:
                    proj_r = conn.execute("SELECT expected_formula FROM projects WHERE id = ?", (r["project_id"],)).fetchone()
                exp_f = proj_r["expected_formula"] if proj_r else None
                roi_gray, _, _ = load_sem_grayscale_and_rgb(roi_p.read_bytes())
                sem_obj["grain_phase_map"] = compute_grain_phase_map(
                    roi_gray=roi_gray,
                    roi_rect=sem_obj.get("roi", {"x": 0, "y": 0, "w": int(roi_gray.shape[1]), "h": int(roi_gray.shape[0])}),
                    scale_info=sem_obj.get("scale", {"unit_per_px": 1.0, "display_unit": "px", "area_unit": "px²"}),
                    xrd_result=xrd_obj,
                    expected_formula=exp_f,
                )
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE analysis_runs SET sem_result_json = ? WHERE id = ?",
                        (json.dumps(sem_obj, ensure_ascii=False), run_id),
                    )
            except Exception:
                pass

    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "run_number": r["run_number"],
        "status": r["status"],
        "progress_pct": r["progress_pct"],
        "stage_message": r["stage_message"],
        "params": json.loads(r["params_json"]),
        "file_hashes": json.loads(r["file_hashes_json"]),
        "ref_library_version": r["ref_library_version"],
        "algo_versions": json.loads(r["algo_versions_json"]),
        "xrd_result": xrd_obj,
        "sem_result": sem_obj,
        "rule_summary": json.loads(r["rule_summary_json"]) if r["rule_summary_json"] else None,
        "has_overlay": bool(r["overlay_relpath"]),
        "has_roi_image": bool(r["roi_relpath"]),
        "ai_report": ai_current,
        "previous_outdated_ai_report": ai_fallback_prev,
        "is_ai_outdated": bool(
            (ai_current is None or ai_current["status"] == "disabled" or is_stale_missing_key_error)
            and ai_fallback_prev is not None
        ),
        "error_message": r["error_message"],
        "created_at": r["created_at"],
        "completed_at": r["completed_at"],
    }


# ---------------- System & Reference Info ---------------- #
@app.get("/api/health")
def api_health() -> dict[str, Any]:
    lib = load_reference_library()
    return {
        "status": "ok",
        "gemini_api_configured": has_gemini_api_key(),
        "gemini_model": get_gemini_model(),
        "gemini_models": GEMINI_MODEL_OPTIONS,
        "mp_api_configured": has_mp_api_key(),
        "xray_presets": XRAY_PRESETS,
        "ref_library_version": lib["library_version"],
        "ref_phase_count": lib["count"],
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "max_image_pixels": MAX_IMAGE_PIXELS,
        "versions": get_algorithm_and_library_versions(),
    }


@app.get("/api/ai-config")
def get_ai_config() -> dict[str, Any]:
    return {
        "gemini_api_configured": has_gemini_api_key(),
        "gemini_model": get_gemini_model(),
        "gemini_models": discover_available_gemini_models(),
        "mp_api_configured": has_mp_api_key(),
    }


@app.post("/api/ai-config")
def post_ai_config(req: UpdateAIConfigRequest) -> dict[str, Any]:
    update_runtime_api_config(
        gemini_api_key=req.gemini_api_key,
        gemini_model=req.gemini_model,
        mp_api_key=req.mp_api_key,
    )
    return {
        "gemini_api_configured": has_gemini_api_key(),
        "gemini_model": get_gemini_model(),
        "gemini_models": discover_available_gemini_models(),
        "mp_api_configured": has_mp_api_key(),
    }


@app.get("/api/reference-phases")
def api_reference_phases() -> dict[str, Any]:
    lib = load_reference_library()
    return {
        "library_version": lib["library_version"],
        "description": lib["description"],
        "phases": [
            {
                "id": e["id"],
                "mp_id": e.get("mp_id"),
                "name": e["name"],
                "formula": e["formula"],
                "spacegroup": e["spacegroup"],
                "category": e["category"],
                "elements": e["elements"],
                "e_hull_ev": e.get("e_hull_ev"),
                "formation_energy_ev": e.get("formation_energy_ev"),
                "stability_badge": e.get("stability_badge"),
                "density_g_cm3": e.get("density_g_cm3"),
                "band_gap_ev": e.get("band_gap_ev"),
                "electronic_label": e.get("electronic_label"),
                "z_bse_eff": e.get("z_bse_eff"),
                "source": e["source"],
            }
            for e in lib["entries"]
        ],
    }


# ---------------- Projects CRUD ---------------- #
@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
        out = []
        for p in rows:
            run_cnt = conn.execute("SELECT COUNT(*) AS c FROM analysis_runs WHERE project_id = ?", (p["id"],)).fetchone()["c"]
            file_roles = [
                fr["file_role"]
                for fr in conn.execute("SELECT file_role FROM project_files WHERE project_id = ?", (p["id"],)).fetchall()
            ]
            out.append(
                {
                    "id": p["id"],
                    "sample_name": p["sample_name"],
                    "description": p["description"],
                    "expected_formula": p["expected_formula"],
                    "expected_elements": json.loads(p["expected_elements_json"]),
                    "is_same_sample": bool(p["is_same_sample"]),
                    "is_sample_demo": bool(p["is_sample_demo"]),
                    "file_roles": sorted(set(file_roles)),
                    "run_count": run_cnt,
                    "updated_at": p["updated_at"],
                }
            )
    return out


@app.post("/api/projects")
def create_project(req: CreateProjectRequest) -> dict[str, Any]:
    pid = new_id("proj")
    now = utc_now_iso()
    default_cond = {"xrd_params": XRDParams().model_dump(), "sem_params": SEMParams().model_dump()}
    clean_elems = [e.strip() for e in req.expected_elements if e.strip()]
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO projects (
                id, sample_name, description, expected_elements_json, expected_formula,
                is_same_sample, is_sample_demo, current_conditions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (
                pid,
                req.sample_name.strip(),
                req.description.strip(),
                json.dumps(clean_elems, ensure_ascii=False),
                req.expected_formula.strip(),
                1 if req.is_same_sample else 0,
                json.dumps(default_cond, ensure_ascii=False),
                now,
                now,
            ),
        )
        record_history(conn, pid, "project_created", f"시료 ‘{req.sample_name.strip()}’ 프로젝트 생성", req.model_dump())
    (PROJECTS_STORAGE_DIR / pid / "uploads").mkdir(parents=True, exist_ok=True)
    return _serialize_project(pid)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    return _serialize_project(project_id)


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, req: UpdateProjectRequest) -> dict[str, Any]:
    with get_conn() as conn:
        proj = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

        sample_name = req.sample_name.strip() if req.sample_name is not None else proj["sample_name"]
        desc = req.description.strip() if req.description is not None else proj["description"]
        elems = (
            [e.strip() for e in req.expected_elements if e.strip()]
            if req.expected_elements is not None
            else json.loads(proj["expected_elements_json"])
        )
        formula = req.expected_formula.strip() if req.expected_formula is not None else proj["expected_formula"]
        is_same = int(req.is_same_sample) if req.is_same_sample is not None else proj["is_same_sample"]
        cond = req.current_conditions if req.current_conditions is not None else json.loads(proj["current_conditions_json"])
        now = utc_now_iso()

        conn.execute(
            """
            UPDATE projects
            SET sample_name = ?, description = ?, expected_elements_json = ?, expected_formula = ?,
                is_same_sample = ?, current_conditions_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                sample_name,
                desc,
                json.dumps(elems, ensure_ascii=False),
                formula,
                is_same,
                json.dumps(cond, ensure_ascii=False),
                now,
                project_id,
            ),
        )
        summary = req.change_summary or "분석 조건 및 시료 메타데이터 수정"
        record_history(conn, project_id, "conditions_updated", summary, req.model_dump(exclude_none=True))
    return _serialize_project(project_id)


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str) -> dict[str, Any]:
    deleted = delete_project_completely(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="삭제할 프로젝트를 찾을 수 없습니다.")
    return {"deleted": True, "project_id": project_id}


# ---------------- Sample Demo Project Builder ---------------- #
def _attach_file_bytes_to_project(
    project_id: str,
    file_role: str,
    filename: str,
    raw_bytes: bytes,
    is_sample: bool = False,
) -> dict[str, Any]:
    if len(raw_bytes) == 0:
        raise HTTPException(status_code=400, detail="비어 있는 파일입니다.")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"파일 크기가 허용 한도({MAX_UPLOAD_BYTES // (1024 * 1024)} MB)를 초과합니다.",
        )

    ext = Path(filename).suffix.lower()
    if file_role == "xrd" and ext not in ALLOWED_XRD_EXTS:
        raise HTTPException(status_code=400, detail=f"XRD 파일은 {', '.join(sorted(ALLOWED_XRD_EXTS))} 형식만 지원합니다.")
    if file_role == "sem" and ext not in ALLOWED_SEM_EXTS:
        raise HTTPException(status_code=400, detail=f"SEM 이미지는 {', '.join(sorted(ALLOWED_SEM_EXTS))} 형식만 지원합니다.")
    if file_role == "cif" and ext not in ALLOWED_CIF_EXTS:
        raise HTTPException(status_code=400, detail="기준 결정구조 파일은 .cif 형식만 지원합니다.")

    try:
        if file_role == "xrd":
            parsed = inspect_and_parse_xrd(raw_bytes)
            inspection = parsed["inspection"]
        elif file_role == "sem":
            inspection = inspect_sem_bytes(raw_bytes)
        elif file_role == "cif":
            cif_entry = parse_user_cif(raw_bytes, filename)
            inspection = {
                "formula": cif_entry["formula"],
                "spacegroup": cif_entry["spacegroup"],
                "elements": cif_entry["elements"],
                "n_reflections": len(cif_entry["d_A"]),
            }
        else:
            raise HTTPException(status_code=400, detail="지원하지 않는 파일 역할입니다.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    fid = new_id("file")
    safe_name = "".join(ch if (ch.isalnum() or ch in "._-") else "_" for ch in Path(filename).name)
    rel_path = f"uploads/{fid}_{safe_name}"
    dest = PROJECTS_STORAGE_DIR / project_id / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw_bytes)

    now = utc_now_iso()
    with get_conn() as conn:
        if file_role in ("xrd", "sem"):
            # Replace previous active XRD or SEM file while preserving disk audit only if needed; clean old one
            old_rows = conn.execute(
                "SELECT id, stored_relpath FROM project_files WHERE project_id = ? AND file_role = ?",
                (project_id, file_role),
            ).fetchall()
            for old in old_rows:
                old_p = PROJECTS_STORAGE_DIR / project_id / old["stored_relpath"]
                if old_p.exists():
                    old_p.unlink(missing_ok=True)
                conn.execute("DELETE FROM project_files WHERE id = ?", (old["id"],))

        conn.execute(
            """
            INSERT INTO project_files (
                id, project_id, file_role, original_filename, stored_relpath,
                sha256, size_bytes, mime_type, inspection_json, is_sample, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
            """,
            (
                fid,
                project_id,
                file_role,
                Path(filename).name,
                rel_path,
                sha256,
                len(raw_bytes),
                json.dumps(inspection, ensure_ascii=False),
                1 if is_sample else 0,
                now,
            ),
        )

        # Auto-seed initial conditions from inspection on upload
        proj = conn.execute("SELECT current_conditions_json FROM projects WHERE id = ?", (project_id,)).fetchone()
        cond = json.loads(proj["current_conditions_json"]) if proj else {}
        if file_role == "xrd":
            xp = XRDParams(**cond.get("xrd_params", {}))
            xp.col_two_theta = inspection["selected_col_two_theta"]
            xp.col_intensity = inspection["selected_col_intensity"]
            xp.two_theta_min = inspection["two_theta_min"]
            xp.two_theta_max = inspection["two_theta_max"]
            cond["xrd_params"] = xp.model_dump()
        elif file_role == "sem":
            sp = SEMParams(**cond.get("sem_params", {}))
            sp.roi = ROIRect(**inspection["suggested_roi"])
            sb = inspection.get("primary_scalebar")
            if sb:
                sp.scale_x0 = sb["x0"]
                sp.scale_y0 = sb["y0"]
                sp.scale_x1 = sb["x1"]
                sp.scale_y1 = sb["y1"]
                sp.scale_length_px = sb["length_px"]
            sp.scale_confirmed = False  # User must confirm real length & unit!
            cond["sem_params"] = sp.model_dump()

        conn.execute(
            "UPDATE projects SET current_conditions_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(cond, ensure_ascii=False), now, project_id),
        )
        record_history(
            conn,
            project_id,
            f"upload_{file_role}",
            f"{file_role.upper()} 파일 업로드: {Path(filename).name}",
            {"file_id": fid, "sha256": sha256[:16]},
        )

    return {
        "file_id": fid,
        "file_role": file_role,
        "original_filename": Path(filename).name,
        "sha256": sha256,
        "inspection": inspection,
    }


@app.post("/api/projects/sample-demo")
def create_sample_demo_project(preset: str = Query(default="tio2_powder")) -> dict[str, Any]:
    """Create a clearly badged '[샘플]' demo project and optionally start initial run."""
    xrd_sample_path = SAMPLES_DIR / "sample_anatase_rutile_xrd.csv"
    sem_particle_path = SAMPLES_DIR / "sample_tio2_particles_sem.png"
    sem_grain_path = SAMPLES_DIR / "sample_sintered_grains_sem.png"

    if not xrd_sample_path.exists() or not sem_particle_path.exists():
        raise HTTPException(status_code=500, detail="샘플 데이터 파일이 아직 준비되지 않았습니다.")

    pid = new_id("proj")
    now = utc_now_iso()

    if preset == "desktop_nbfesb":
        desktop_dir = Path.home() / "Desktop"
        xrd_desktop = desktop_dir / "NbFeSb-AC.xlsx"
        sem_desktop = desktop_dir / "NbFeSb AC_BED-C_1_0001.tif"
        if not xrd_desktop.exists() and not sem_desktop.exists():
            raise HTTPException(status_code=404, detail="바탕화면에서 NbFeSb 파일(NbFeSb-AC.xlsx / NbFeSb AC_BED-C_1_0001.tif)을 찾을 수 없습니다.")
        sname = "NbFeSb-AC (바탕화면 시료)"
        desc = "바탕화면에서 불러온 As-Cast NbFeSb 시료 (XRD: NbFeSb-AC.xlsx, SEM: NbFeSb AC_BED-C_1_0001.tif, 스케일바 50 µm)"
        elems = ["Nb", "Fe", "Sb"]
        formula = "NbFeSb"
        is_same = True
        is_demo_flag = 0
    elif preset == "sintered_grains" and sem_grain_path.exists():
        sname = "[샘플] 소결 Al2O3 세라믹 조직 (결정립 선형교차법)"
        desc = "합성 소결 다결정 미세구조 SEM 이미지(스케일바 200 px = 5 µm) 예시 데이터입니다."
        elems = ["Al", "O"]
        formula = "Al2O3"
        is_same = False
        is_demo_flag = 1
    else:
        sname = "[샘플] TiO2 나노분말 (Anatase 주상 + Rutile 부상)"
        desc = (
            "합성 검증용 TiO2 혼합 분말 시료입니다 (Cu Kα, Anatase ~24 nm + Rutile ~38 nm, 기기 선폭 0.08°; "
            "SEM 구형 나노입자/부분 응집체, 스케일바 200 px = 500 nm)."
        )
        elems = ["Ti", "O"]
        formula = "TiO2"
        is_same = True
        is_demo_flag = 1

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO projects (
                id, sample_name, description, expected_elements_json, expected_formula,
                is_same_sample, is_sample_demo, current_conditions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
            """,
            (pid, sname, desc, json.dumps(elems), formula, 1 if is_same else 0, is_demo_flag, now, now),
        )
        record_history(conn, pid, "sample_demo_loaded", f"시료 프로젝트 생성 ({preset})", {"preset": preset})

    if preset == "desktop_nbfesb":
        desktop_dir = Path.home() / "Desktop"
        xrd_desktop = desktop_dir / "NbFeSb-AC.xlsx"
        sem_desktop = desktop_dir / "NbFeSb AC_BED-C_1_0001.tif"
        if xrd_desktop.exists():
            _attach_file_bytes_to_project(pid, "xrd", xrd_desktop.name, xrd_desktop.read_bytes(), is_sample=False)
        if sem_desktop.exists():
            _attach_file_bytes_to_project(pid, "sem", sem_desktop.name, sem_desktop.read_bytes(), is_sample=False)
        with get_conn() as conn:
            cond = json.loads(conn.execute("SELECT current_conditions_json FROM projects WHERE id = ?", (pid,)).fetchone()["current_conditions_json"])
            xp = XRDParams(**cond.get("xrd_params", {}))
            xp.wavelength_confirmed = True
            sp = SEMParams(**cond.get("sem_params", {}))
            sp.scale_confirmed = True
            sp.scale_real_value = 50.0
            sp.scale_unit = "µm"
            sp.segmentation_confirmed = True
            cond["xrd_params"] = xp.model_dump()
            cond["sem_params"] = sp.model_dump()
            conn.execute("UPDATE projects SET current_conditions_json = ? WHERE id = ?", (json.dumps(cond), pid))
    elif preset == "sintered_grains" and sem_grain_path.exists():
        _attach_file_bytes_to_project(pid, "sem", sem_grain_path.name, sem_grain_path.read_bytes(), is_sample=True)
        with get_conn() as conn:
            cond = json.loads(conn.execute("SELECT current_conditions_json FROM projects WHERE id = ?", (pid,)).fetchone()["current_conditions_json"])
            sp = SEMParams(**cond.get("sem_params", {}))
            sp.mode = "grain"
            sp.grain_boundary_confirmed = True
            sp.scale_confirmed = True
            sp.scale_real_value = 5.0
            sp.scale_unit = "µm"
            cond["sem_params"] = sp.model_dump()
            conn.execute("UPDATE projects SET current_conditions_json = ? WHERE id = ?", (json.dumps(cond), pid))
    else:
        _attach_file_bytes_to_project(pid, "xrd", xrd_sample_path.name, xrd_sample_path.read_bytes(), is_sample=True)
        _attach_file_bytes_to_project(pid, "sem", sem_particle_path.name, sem_particle_path.read_bytes(), is_sample=True)
        with get_conn() as conn:
            cond = json.loads(conn.execute("SELECT current_conditions_json FROM projects WHERE id = ?", (pid,)).fetchone()["current_conditions_json"])
            xp = XRDParams(**cond.get("xrd_params", {}))
            xp.inst_fwhm_deg = 0.08
            xp.wavelength_confirmed = True
            sp = SEMParams(**cond.get("sem_params", {}))
            sp.scale_confirmed = True
            sp.scale_real_value = 500.0
            sp.scale_unit = "nm"
            sp.segmentation_confirmed = True
            cond["xrd_params"] = xp.model_dump()
            cond["sem_params"] = sp.model_dump()
            conn.execute("UPDATE projects SET current_conditions_json = ? WHERE id = ?", (json.dumps(cond), pid))

    return _serialize_project(pid)


# ---------------- Desktop Quick File Discovery & Upload ---------------- #
@app.get("/api/desktop-files")
def list_desktop_files() -> dict[str, Any]:
    """List compatible XRD, SEM, and CIF files on the user's Desktop folder for quick 1-click selection."""
    desktop_dir = Path.home() / "Desktop"
    items: list[dict[str, Any]] = []
    if desktop_dir.exists() and desktop_dir.is_dir():
        for p in sorted(desktop_dir.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            role = None
            if ext in ALLOWED_XRD_EXTS:
                role = "xrd"
            elif ext in ALLOWED_SEM_EXTS:
                role = "sem"
            elif ext in ALLOWED_CIF_EXTS:
                role = "cif"
            if role:
                items.append(
                    {
                        "filename": p.name,
                        "role": role,
                        "ext": ext,
                        "size_bytes": p.stat().st_size,
                    }
                )
    return {"desktop_path": str(desktop_dir), "files": items}


@app.post("/api/projects/{project_id}/files/{file_role}/from-desktop")
def upload_project_file_from_desktop(
    project_id: str,
    file_role: str,
    filename: str = Query(..., description="바탕화면 파일명"),
) -> dict[str, Any]:
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    desktop_dir = (Path.home() / "Desktop").resolve()
    safe_name = Path(filename).name
    target = (desktop_dir / safe_name).resolve()
    if target.parent != desktop_dir or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"바탕화면에서 '{safe_name}' 파일을 찾을 수 없습니다.")

    raw_bytes = target.read_bytes()
    _attach_file_bytes_to_project(project_id, file_role.lower(), safe_name, raw_bytes, is_sample=False)
    return _serialize_project(project_id)


# ---------------- File Upload & Raw Image Serving ---------------- #
@app.post("/api/projects/{project_id}/files/{file_role}")
async def upload_project_file(project_id: str, file_role: str, file: UploadFile = File(...)) -> dict[str, Any]:
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    raw_bytes = await file.read()
    _attach_file_bytes_to_project(project_id, file_role.lower(), file.filename or f"upload.{file_role}", raw_bytes, is_sample=False)
    return _serialize_project(project_id)


@app.get("/api/projects/{project_id}/files/{file_id}/raw")
def get_raw_uploaded_file(project_id: str, file_id: str, download: bool = Query(default=False)) -> Response:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT file_role, stored_relpath, original_filename FROM project_files WHERE id = ? AND project_id = ?",
            (file_id, project_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="원본 파일을 찾을 수 없습니다.")
    full_path = PROJECTS_STORAGE_DIR / project_id / row["stored_relpath"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="저장소에서 파일을 찾을 수 없습니다.")

    # Convert .tif / .tiff / .bmp SEM images to lossless PNG when rendered in browser <img> tag
    if not download and row["file_role"] == "sem" and full_path.suffix.lower() in {".tif", ".tiff", ".bmp"}:
        import io
        from PIL import Image

        with Image.open(full_path) as im:
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")

    return FileResponse(str(full_path), filename=row["original_filename"])


@app.get("/api/projects/{project_id}/ai-scope")
def get_project_ai_scope(project_id: str) -> dict[str, Any]:
    proj = _serialize_project(project_id)
    roles = {f["file_role"] for f in proj["files"]}
    return describe_external_ai_scope("xrd" in roles, "sem" in roles, proj["is_same_sample"])


# ---------------- Analysis Run Execution & Status ---------------- #
@app.post("/api/projects/{project_id}/runs")
def start_analysis_run(project_id: str, req: RunAnalysisRequest) -> dict[str, Any]:
    with get_conn() as conn:
        proj = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        files = conn.execute(
            "SELECT file_role, sha256, original_filename FROM project_files WHERE project_id = ?", (project_id,)
        ).fetchall()
        if not any(f["file_role"] in ("xrd", "sem") for f in files):
            raise HTTPException(status_code=400, detail="분석을 실행하려면 XRD 파일 또는 SEM 이미지를 최소 1개 이상 업로드해주세요.")

        max_num = conn.execute(
            "SELECT COALESCE(MAX(run_number), 0) AS m FROM analysis_runs WHERE project_id = ?", (project_id,)
        ).fetchone()["m"]
        run_number = int(max_num) + 1
        run_id = new_id("run")
        now = utc_now_iso()

        file_hashes = {f"{f['file_role']}:{f['original_filename']}": f["sha256"] for f in files}
        algo_versions = get_algorithm_and_library_versions()
        params_dump = req.model_dump()

        conn.execute(
            """
            INSERT INTO analysis_runs (
                id, project_id, run_number, status, progress_pct, stage_message,
                params_json, file_hashes_json, ref_library_version, algo_versions_json, created_at
            ) VALUES (?, ?, ?, 'queued', 0, '분석 작업 대기열에 등록됨', ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                project_id,
                run_number,
                json.dumps(params_dump, ensure_ascii=False),
                json.dumps(file_hashes, ensure_ascii=False),
                REF_LIBRARY_VERSION,
                json.dumps(algo_versions, ensure_ascii=False),
                now,
            ),
        )
        conn.execute(
            "UPDATE projects SET current_conditions_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps({"xrd_params": req.xrd_params.model_dump(), "sem_params": req.sem_params.model_dump()}, ensure_ascii=False), now, project_id),
        )
        record_history(
            conn,
            project_id,
            "run_started",
            f"분석 실행 Run #{run_number} 시작 (AI 해석 {'포함' if req.run_ai_interpretation else '제외'})",
            {"run_id": run_id, "run_number": run_number},
        )

    submit_analysis_job(run_id, project_id, params_dump)
    return {"run_id": run_id, "run_number": run_number, "status": "queued"}


@app.get("/api/runs/{run_id}")
def get_run_status_and_result(run_id: str) -> dict[str, Any]:
    return _serialize_run(run_id)


@app.get("/api/runs/{run_id}/overlay.png")
def get_run_overlay_image(run_id: str) -> FileResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT project_id, overlay_relpath FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
    if not row or not row["overlay_relpath"]:
        raise HTTPException(status_code=404, detail="오버레이 이미지를 찾을 수 없습니다.")
    full_path = PROJECTS_STORAGE_DIR / row["project_id"] / row["overlay_relpath"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="오버레이 파일이 존재하지 않습니다.")
    return FileResponse(str(full_path), media_type="image/png")


@app.get("/api/runs/{run_id}/roi.png")
def get_run_roi_image(run_id: str) -> FileResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT project_id, roi_relpath FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
    if not row or not row["roi_relpath"]:
        raise HTTPException(status_code=404, detail="ROI 이미지를 찾을 수 없습니다.")
    full_path = PROJECTS_STORAGE_DIR / row["project_id"] / row["roi_relpath"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="ROI 파일이 존재하지 않습니다.")
    return FileResponse(str(full_path), media_type="image/png")


@app.post("/api/runs/{run_id}/ai-retry")
def retry_ai_interpretation(
    run_id: str,
    model: str | None = Query(default=None, description="선택할 Gemini 모델 버전 (예: auto, gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash)"),
) -> dict[str, Any]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="분석 실행 기록을 찾을 수 없습니다.")
        if r["status"] != "completed" or not r["rule_summary_json"]:
            raise HTTPException(status_code=400, detail="수치 분석이 완료된 실행에 대해서만 AI 해석을 생성할 수 있습니다.")
        proj = conn.execute("SELECT * FROM projects WHERE id = ?", (r["project_id"],)).fetchone()

    if model and model.strip():
        update_runtime_api_config(gemini_model=model.strip())

    project_meta = {
        "id": proj["id"],
        "sample_name": proj["sample_name"],
        "description": proj["description"],
        "expected_elements": json.loads(proj["expected_elements_json"]),
        "expected_formula": proj["expected_formula"],
        "is_same_sample": bool(proj["is_same_sample"]),
    }
    rule_summary = json.loads(r["rule_summary_json"])
    xrd_obj = json.loads(r["xrd_result_json"]) if r["xrd_result_json"] else None
    sem_obj = json.loads(r["sem_result_json"]) if r["sem_result_json"] else None
    proj_dir = PROJECTS_STORAGE_DIR / r["project_id"]
    roi_bytes = (proj_dir / r["roi_relpath"]).read_bytes() if r["roi_relpath"] and (proj_dir / r["roi_relpath"]).exists() else None
    ov_bytes = (proj_dir / r["overlay_relpath"]).read_bytes() if r["overlay_relpath"] and (proj_dir / r["overlay_relpath"]).exists() else None

    if sem_obj is not None:
        if "grain_phase_map" not in sem_obj and roi_bytes:
            roi_gray, _, _ = load_sem_grayscale_and_rgb(roi_bytes)
            sem_obj["grain_phase_map"] = compute_grain_phase_map(
                roi_gray=roi_gray,
                roi_rect=sem_obj.get("roi", {"x": 0, "y": 0, "w": int(roi_gray.shape[1]), "h": int(roi_gray.shape[0])}),
                scale_info=sem_obj.get("scale", {"unit_per_px": 1.0, "display_unit": "px", "area_unit": "px²"}),
                xrd_result=xrd_obj,
                expected_formula=project_meta["expected_formula"],
            )
        sem_obj = generate_grain_phase_ai_interpretation(
            project_meta, sem_obj, xrd_obj, roi_bytes, override_model=model
        )

    ai_out = generate_gemini_interpretation(project_meta, rule_summary, roi_bytes, ov_bytes, override_model=model)
    with get_conn() as conn:
        if sem_obj is not None:
            conn.execute(
                "UPDATE analysis_runs SET sem_result_json = ? WHERE id = ?",
                (json.dumps(sem_obj, ensure_ascii=False), run_id),
            )
        conn.execute("DELETE FROM ai_reports WHERE run_id = ?", (run_id,))
        conn.execute(
            """
            INSERT INTO ai_reports (
                id, project_id, run_id, status, model_name, prompt_version,
                schema_valid, reference_check_json, report_json, error_message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("ai"),
                r["project_id"],
                run_id,
                ai_out["status"],
                ai_out["model_name"],
                ai_out["prompt_version"],
                1 if ai_out["schema_valid"] else 0,
                json.dumps(ai_out["reference_check"], ensure_ascii=False),
                json.dumps(ai_out["report"], ensure_ascii=False) if ai_out["report"] else None,
                ai_out["error_message"],
                ai_out["created_at"],
            ),
        )
    return _serialize_run(run_id)


@app.post("/api/runs/{run_id}/grain-phase-ai")
def run_grain_phase_ai_endpoint(
    run_id: str,
    model: str | None = Query(default=None, description="선택할 Gemini 모델 버전"),
) -> dict[str, Any]:
    """Run Gemini Multimodal Vision Grain-by-Grain Phase Identification on a completed SEM run."""
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
        if not r or not r["sem_result_json"]:
            raise HTTPException(status_code=404, detail="SEM 분석 실행 기록을 찾을 수 없습니다.")
        proj = conn.execute("SELECT * FROM projects WHERE id = ?", (r["project_id"],)).fetchone()

    project_meta = {
        "id": proj["id"],
        "sample_name": proj["sample_name"],
        "description": proj["description"],
        "expected_elements": json.loads(proj["expected_elements_json"]),
        "expected_formula": proj["expected_formula"],
        "is_same_sample": bool(proj["is_same_sample"]),
    }
    xrd_obj = json.loads(r["xrd_result_json"]) if r["xrd_result_json"] else None
    sem_obj = json.loads(r["sem_result_json"])
    proj_dir = PROJECTS_STORAGE_DIR / r["project_id"]
    roi_bytes = (proj_dir / r["roi_relpath"]).read_bytes() if r["roi_relpath"] and (proj_dir / r["roi_relpath"]).exists() else None

    if "grain_phase_map" not in sem_obj and roi_bytes:
        roi_gray, _, _ = load_sem_grayscale_and_rgb(roi_bytes)
        sem_obj["grain_phase_map"] = compute_grain_phase_map(
            roi_gray=roi_gray,
            roi_rect=sem_obj.get("roi", {"x": 0, "y": 0, "w": int(roi_gray.shape[1]), "h": int(roi_gray.shape[0])}),
            scale_info=sem_obj.get("scale", {"unit_per_px": 1.0, "display_unit": "px", "area_unit": "px²"}),
            xrd_result=xrd_obj,
            expected_formula=project_meta["expected_formula"],
        )

    sem_obj = generate_grain_phase_ai_interpretation(
        project_meta, sem_obj, xrd_obj, roi_bytes, override_model=model
    )
    with get_conn() as conn:
        conn.execute(
            "UPDATE analysis_runs SET sem_result_json = ? WHERE id = ?",
            (json.dumps(sem_obj, ensure_ascii=False), run_id),
        )
    return _serialize_run(run_id)


# ---------------- Export & Download Endpoints ---------------- #
@app.get("/api/runs/{run_id}/download/result.json")
def download_full_json(run_id: str) -> Response:
    run_data = _serialize_run(run_id)
    proj_data = _serialize_project(run_data["project_id"])
    payload = {
        "export_type": "matlens_reproducible_bundle_v1",
        "project": {
            "id": proj_data["id"],
            "sample_name": proj_data["sample_name"],
            "description": proj_data["description"],
            "expected_elements": proj_data["expected_elements"],
            "expected_formula": proj_data["expected_formula"],
            "is_same_sample": proj_data["is_same_sample"],
            "is_sample_demo": proj_data["is_sample_demo"],
        },
        "run": run_data,
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=raw,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="matlens_{run_id}_result.json"'},
    )


@app.get("/api/runs/{run_id}/download/xrd-peaks.csv")
def download_xrd_peaks_csv(run_id: str) -> Response:
    run_data = _serialize_run(run_id)
    xrd = run_data.get("xrd_result")
    if not xrd:
        raise HTTPException(status_code=404, detail="이 실행에는 XRD 분석 결과가 없습니다.")
    sch_map = {p["peak_id"]: p for p in xrd.get("scherrer", {}).get("per_peak", [])}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "peak_id",
            "two_theta_deg",
            "d_spacing_A",
            "height_au",
            "rel_intensity_pct",
            "integrated_area",
            "fwhm_deg",
            "profile_eta",
            "snr",
            "fit_status",
            "user_excluded",
            "assigned_phase",
            "assigned_hkl",
            "scherrer_used",
            "crystallite_size_nm",
            "scherrer_exclusion_reason",
        ]
    )
    for p in xrd.get("peaks", []):
        sp = sch_map.get(p["peak_id"], {})
        writer.writerow(
            [
                p["peak_id"],
                p["two_theta"],
                p["d_spacing_A"],
                p["height"],
                p["rel_intensity_pct"],
                p["area"] if p["area"] is not None else "",
                p["fwhm_deg"] if p["fwhm_deg"] is not None else "",
                p["eta"] if p["eta"] is not None else "",
                p["snr"],
                p["fit_status"],
                p["user_excluded"],
                p.get("assigned_phase") or "",
                p.get("assigned_hkl") or "",
                sp.get("used", False),
                sp.get("crystallite_size_nm") if sp.get("crystallite_size_nm") is not None else "",
                sp.get("exclusion_reason") or "",
            ]
        )

    csv_bytes = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="matlens_{run_id}_xrd_peaks.csv"'},
    )


@app.get("/api/runs/{run_id}/download/xrd-chart.png")
def download_xrd_chart_png(
    run_id: str,
    candidate_id: str | None = Query(default=None, description="선택된 상 후보 ID (미지정 시 1순위 후보)"),
) -> Response:
    """Download high-resolution (300 DPI) publication-quality XRD chart PNG containing
    phase candidates, peak positions (2θ & hkl), theoretical Bragg stick pattern, and background.
    """
    run_data = _serialize_run(run_id)
    proj_data = _serialize_project(run_data["project_id"])
    xrd = run_data.get("xrd_result")
    if not xrd:
        raise HTTPException(status_code=404, detail="이 실행에는 XRD 분석 결과가 없습니다.")

    png_bytes = generate_xrd_figure_png(
        sample_name=proj_data.get("sample_name", "Sample"),
        xrd_result=xrd,
        selected_candidate_id=candidate_id,
        dpi=300,
    )
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="matlens_{run_id}_xrd_analysis.png"'},
    )


@app.get("/api/runs/{run_id}/download/sem-objects.csv")
def download_sem_objects_csv(run_id: str) -> Response:
    run_data = _serialize_run(run_id)
    sem = run_data.get("sem_result")
    if not sem:
        raise HTTPException(status_code=404, detail="이 실행에는 SEM 분석 결과가 없습니다.")

    buf = io.StringIO()
    writer = csv.writer(buf)
    if sem["mode"] == "particle":
        writer.writerow(
            [
                "object_id",
                "excluded",
                "unit",
                "area_unit",
                "equiv_diameter",
                "area",
                "major_axis",
                "minor_axis",
                "aspect_ratio",
                "circularity_4piA_P2",
                "centroid_x_px",
                "centroid_y_px",
                "equiv_diameter_px",
                "area_px2",
            ]
        )
        for o in sem.get("objects", []):
            writer.writerow(
                [
                    o["object_id"],
                    o["excluded"],
                    o["unit"],
                    o["area_unit"],
                    o["equiv_diameter"],
                    o["area"],
                    o["major_axis"],
                    o["minor_axis"],
                    o["aspect_ratio"],
                    o["circularity"],
                    o["centroid_x"],
                    o["centroid_y"],
                    o["equiv_diameter_px"],
                    o["area_px2"],
                ]
            )
    else:
        gi = sem.get("grain_intercept") or {}
        writer.writerow(["intersection_id", "x_roi_px", "y_roi_px", "source", "removed"])
        for pt in gi.get("intersections", []):
            writer.writerow([pt["id"], pt["x"], pt["y"], pt["source"], pt["removed"]])

    csv_bytes = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="matlens_{run_id}_sem_measurements.csv"'},
    )


@app.get("/api/runs/{run_id}/download/overlay.png")
def download_overlay_png(run_id: str) -> FileResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT project_id, overlay_relpath FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
    if not row or not row["overlay_relpath"]:
        raise HTTPException(status_code=404, detail="분할 오버레이 이미지가 없습니다.")
    full_path = PROJECTS_STORAGE_DIR / row["project_id"] / row["overlay_relpath"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="오버레이 파일을 찾을 수 없습니다.")
    return FileResponse(str(full_path), media_type="image/png", filename=f"matlens_{run_id}_overlay.png")


@app.get("/api/runs/{run_id}/download/pdf")
def download_pdf_report(run_id: str) -> Response:
    run_data = _serialize_run(run_id)
    proj_data = _serialize_project(run_data["project_id"])
    with get_conn() as conn:
        r = conn.execute("SELECT roi_relpath, overlay_relpath FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
    proj_dir = PROJECTS_STORAGE_DIR / run_data["project_id"]
    roi_png = (proj_dir / r["roi_relpath"]).read_bytes() if r and r["roi_relpath"] and (proj_dir / r["roi_relpath"]).exists() else None
    ov_png = (proj_dir / r["overlay_relpath"]).read_bytes() if r and r["overlay_relpath"] and (proj_dir / r["overlay_relpath"]).exists() else None

    ai_rec = run_data["ai_report"]
    is_outdated = run_data["is_ai_outdated"]
    if (ai_rec is None or ai_rec["status"] == "disabled") and run_data["previous_outdated_ai_report"]:
        ai_rec = run_data["previous_outdated_ai_report"]
        is_outdated = True

    pdf_bytes = generate_pdf_report(proj_data, run_data, ai_rec, is_outdated, roi_png, ov_png)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="matlens_{run_id}_report.pdf"'},
    )


def _get_run_context_for_ai(
    project_id: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any] | None:
    """Fetch structured analysis run context for AI crawlers and bots."""
    with get_conn() as conn:
        rrow = None
        if run_id:
            rrow = conn.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
        if not rrow and project_id:
            rrow = conn.execute(
                "SELECT * FROM analysis_runs WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
                (project_id,),
            ).fetchone()
        if not rrow:
            rrow = conn.execute(
                "SELECT * FROM analysis_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
            ).fetchone()

        prow = None
        if rrow:
            prow = conn.execute("SELECT * FROM projects WHERE id = ?", (rrow["project_id"],)).fetchone()
        elif project_id:
            prow = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()

        if not prow:
            prow = conn.execute("SELECT * FROM projects ORDER BY created_at DESC LIMIT 1").fetchone()

        if not prow:
            return None

        sample_name = prow["sample_name"] or "미지 시료"
        description = prow["description"] or "시료 설명이 입력되지 않았습니다."
        exp_formula = prow["expected_formula"] or "-"
        exp_elements = json.loads(prow["expected_elements_json"]) if prow["expected_elements_json"] else []

        xrd = json.loads(rrow["xrd_result_json"]) if (rrow and rrow["xrd_result_json"]) else {}
        sem = json.loads(rrow["sem_result_json"]) if (rrow and rrow["sem_result_json"]) else {}
        rule = json.loads(rrow["rule_summary_json"]) if (rrow and rrow["rule_summary_json"]) else {}

        # AI report if available
        ai_rep = None
        if rrow:
            ai_row = conn.execute(
                "SELECT * FROM ai_reports WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", (rrow["id"],)
            ).fetchone()
            if ai_row and ai_row["report_json"]:
                ai_rep = json.loads(ai_row["report_json"])

        cands = xrd.get("phase_matching", {}).get("candidates", [])
        top_cand = cands[0] if cands else {}
        cg = xrd.get("phase_matching", {}).get("composition_guidance", {})

        return {
            "run_id": rrow["id"] if rrow else "",
            "project_id": prow["id"],
            "sample_name": sample_name,
            "description": description,
            "expected_formula": exp_formula,
            "expected_elements": exp_elements,
            "nominal_formula": cg.get("nominal_formula") or exp_formula,
            "xrd": xrd,
            "sem": sem,
            "rule": rule,
            "ai_report": ai_rep,
            "top_cand": top_cand,
            "composition_guidance": cg,
            "peaks": xrd.get("peaks", []),
            "created_at": rrow["created_at"] if rrow else "",
        }


def _build_ai_semantic_html(ctx: dict[str, Any], base_url: str) -> str:
    """Build accessible, high-density semantic HTML for web-browsing bots like ChatGPT and Gemini."""
    sample_name = ctx["sample_name"]
    description = ctx["description"]
    nominal_formula = ctx["nominal_formula"]
    exp_elements_str = ", ".join(ctx["expected_elements"]) if ctx["expected_elements"] else "미지정"
    run_id = ctx["run_id"]

    top_cand = ctx["top_cand"]
    top_name = top_cand.get("name", "미확정")
    top_formula = top_cand.get("formula", "-")
    top_spg = top_cand.get("spacegroup", "-")
    top_score = top_cand.get("score", 0)
    target_badge = top_cand.get("target_badge", "")
    comp_note = top_cand.get("composition_note", "")

    cg = ctx["composition_guidance"]
    interp_guide = cg.get("interpretation_guide", "")
    doping_notes = cg.get("doping_notes", [])
    process_hints = cg.get("process_hints", [])
    sch_nm = ctx["xrd"].get("scherrer", {}).get("mean_nm")

    peaks_rows = []
    for p in ctx["peaks"][:16]:
        peaks_rows.append(
            f"<tr>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;'>{p.get('peak_id')}</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;font-weight:600;'>{p.get('two_theta')}°</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;'>{p.get('d_spacing_A')} Å</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;'>{p.get('rel_intensity_pct')}%</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;'>{p.get('fwhm_deg')}°</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;color:#1E40AF;'><strong>{p.get('assigned_phase') or '-'}</strong> {p.get('assigned_hkl') or ''}</td>"
            f"<td style='padding:6px;border:1px solid #CBD5E1;'>{p.get('composition_role') or '-'}</td>"
            f"</tr>"
        )

    sem_stats = ctx["sem"].get("summary_stats") or {}
    sem_d50 = sem_stats.get("d50")
    sem_unit = sem_stats.get("unit", "µm")
    sem_count = sem_stats.get("sample_count_n", 0)
    sem_circ = sem_stats.get("median_circularity")
    sem_mode = ctx["sem"].get("mode_label", "SEM")

    pdf_url = f"{base_url}/api/runs/{run_id}/download/pdf"
    xrd_png_url = f"{base_url}/api/runs/{run_id}/download/xrd-chart.png"
    xrd_csv_url = f"{base_url}/api/runs/{run_id}/download/xrd-peaks.csv"
    json_url = f"{base_url}/api/runs/{run_id}/download/result.json"

    parts = [
        '<article id="matlens-ai-readable-report" style="font-family: Pretendard, system-ui, -apple-system, sans-serif; line-height: 1.6; color: #0F172A; max-width: 900px; margin: 0 auto; padding: 24px; background: #FFFFFF;">',
        '  <header style="border-bottom: 2px solid #2563EB; padding-bottom: 14px; margin-bottom: 20px;">',
        f'    <h1 style="color: #1E40AF; font-size: 24px; margin: 0 0 6px 0;">MatLens 재료 분석 통합 리포트 — {sample_name}</h1>',
        f'    <p style="color: #64748B; font-size: 13px; margin: 0;">XRD 회절 패턴 정합 및 SEM 미세조직 분석 종합 리포트 (Run ID: {run_id})</p>',
        '  </header>',

        '  <section style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">',
        '    <h2 style="font-size: 17px; color: #1E293B; margin: 0 0 10px 0;">1. 시료 정보 및 명목 조성</h2>',
        f'    <p style="margin: 4px 0;"><strong>시료명:</strong> {sample_name}</p>',
        f'    <p style="margin: 4px 0;"><strong>시료 설명 및 공정 이력:</strong> {description}</p>',
        f'    <p style="margin: 4px 0;"><strong>명목 목표 조성(Nominal Formula):</strong> <code style="background:#E2E8F0;padding:2px 6px;border-radius:4px;">{nominal_formula}</code></p>',
        f'    <p style="margin: 4px 0;"><strong>원소계:</strong> {exp_elements_str}</p>',
        f'    {f"<p style=\"margin: 4px 0; color: #1D4ED8;\"><strong>도핑/치환 특이사항:</strong> {', '.join(doping_notes)}</p>" if doping_notes else ""}',
        f'    {f"<p style=\"margin: 4px 0; color: #475569;\"><strong>공정 이력 힌트:</strong> {', '.join(process_hints)}</p>" if process_hints else ""}',
        '  </section>',

        '  <section style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">',
        '    <h2 style="font-size: 17px; color: #1E293B; margin: 0 0 10px 0;">2. XRD 회절 패턴 및 결정상 분석 결과</h2>',
        '    <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 12px; margin-bottom: 14px;">',
        f'      <div style="font-weight: bold; color: #1E40AF; font-size: 15px;">1순위 정합 상: {top_name} [{top_spg}] — 매칭 점수 {top_score}점 {f"({target_badge})" if target_badge else ""}</div>',
        f'      <div style="color: #2563EB; font-size: 13px; margin-top: 4px;">{comp_note}</div>',
        f'      {f"<div style=\"color: #334155; font-size: 13px; margin-top: 4px;\">Scherrer 평균 결정자 크기: <strong>{sch_nm} nm</strong></div>" if sch_nm else ""}',
        '    </div>',
        f'    {f"<div style=\"background: #F1F5F9; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 14px;\"><strong>시료 설명 조성 연계 해석:</strong> {interp_guide}</div>" if interp_guide else ""}',
        '    <h3 style="font-size: 14px; margin: 12px 0 6px 0;">검출 피크 목록 (밀러 지수 및 조성 역할 귀속)</h3>',
        '    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center;">',
        '      <thead style="background: #F8FAFC; color: #475569;">',
        '        <tr><th style="padding:6px;border:1px solid #CBD5E1;">피크 ID</th><th style="padding:6px;border:1px solid #CBD5E1;">2θ (°)</th><th style="padding:6px;border:1px solid #CBD5E1;">d (Å)</th><th style="padding:6px;border:1px solid #CBD5E1;">상대강도</th><th style="padding:6px;border:1px solid #CBD5E1;">FWHM</th><th style="padding:6px;border:1px solid #CBD5E1;">귀속 상 / hkl</th><th style="padding:6px;border:1px solid #CBD5E1;">조성 역할</th></tr>',
        '      </thead>',
        f'      <tbody>{"".join(peaks_rows)}</tbody>',
        '    </table>',
        '  </section>',
    ]

    if sem_d50 is not None:
        parts.extend([
            '  <section style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">',
            f'    <h2 style="font-size: 17px; color: #1E293B; margin: 0 0 10px 0;">3. SEM 미세구조 분석 결과 ({sem_mode})</h2>',
            f'    <p style="margin: 4px 0;"><strong>대표 결정립 직경 (D50):</strong> {sem_d50} {sem_unit} (검출 수 N={sem_count})</p>',
            f'    {f"<p style=\"margin: 4px 0;\"><strong>중앙 원형도 (Circularity):</strong> {sem_circ}</p>" if sem_circ is not None else ""}',
            '  </section>',
        ])

    overview = ctx["rule"].get("overview")
    if overview:
        parts.extend([
            '  <section style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">',
            '    <h2 style="font-size: 17px; color: #1E293B; margin: 0 0 10px 0;">4. 통합 교차 해석 요약</h2>',
            f'    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #334155;">{overview}</p>',
            '  </section>',
        ])

    if ctx.get("ai_report") and ctx["ai_report"].get("executive_summary"):
        ai_exec = ctx["ai_report"]["executive_summary"]
        parts.extend([
            '  <section style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px; margin-bottom: 20px;">',
            '    <h2 style="font-size: 17px; color: #1D4ED8; margin: 0 0 10px 0;">5. AI 심층 해석 (Executive Summary)</h2>',
            f'    <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #1E293B;">{ai_exec}</p>',
            '  </section>',
        ])

    parts.extend([
        '  <footer style="border-top: 1px solid #E2E8F0; padding-top: 14px; font-size: 13px; color: #64748B;">',
        '    <div><strong>다운로드 및 데이터 접근 링크:</strong></div>',
        '    <div style="margin-top: 6px; display: flex; gap: 14px; flex-wrap: wrap;">',
        f'      <a href="{pdf_url}" style="color: #2563EB; font-weight: 600;">[PDF 리포트 다운로드]</a>',
        f'      <a href="{xrd_png_url}" style="color: #2563EB; font-weight: 600;">[XRD 분석 차트 이미지 (PNG)]</a>',
        f'      <a href="{xrd_csv_url}" style="color: #2563EB; font-weight: 600;">[XRD 피크 데이터 (CSV)]</a>',
        f'      <a href="{json_url}" style="color: #2563EB; font-weight: 600;">[전체 결과 (JSON)]</a>',
        '    </div>',
        '  </footer>',
        '</article>',
    ])

    return "\n".join(parts)


def _build_ai_markdown_summary(ctx: dict[str, Any], base_url: str) -> str:
    """Build clean Markdown summary for LLM ingestion."""
    sample_name = ctx["sample_name"]
    description = ctx["description"]
    nominal_formula = ctx["nominal_formula"]
    top_cand = ctx["top_cand"]
    cg = ctx["composition_guidance"]

    lines = [
        f"# MatLens 재료 분석 리포트: {sample_name}",
        f"- **시료 설명 및 공정 이력**: {description}",
        f"- **명목 목표 조성**: {nominal_formula}",
        f"- **예상 원소**: {', '.join(ctx['expected_elements']) or '미지정'}",
        "",
        "## 1. XRD 회절 결정상 분석 결과",
        f"- **1순위 주상 후보**: {top_cand.get('name', '미확정')} ({top_cand.get('formula')}) [{top_cand.get('spacegroup')}]",
        f"- **매칭 점수**: {top_cand.get('score')}/100 ({top_cand.get('target_badge') or '정합'})",
        f"- **조성 연계 해석**: {cg.get('interpretation_guide') or top_cand.get('composition_note') or '해석 완료'}",
        "",
        "### 주요 검출 회절 피크",
        "| 피크 ID | 2θ (°) | d (Å) | 상대강도 (%) | FWHM (°) | 귀속 상 및 밀러 지수 (hkl) | 조성 역할 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for p in ctx["peaks"][:16]:
        phase_str = f"{p.get('assigned_phase') or '-'} {p.get('assigned_hkl') or ''}".strip()
        lines.append(
            f"| {p.get('peak_id')} | {p.get('two_theta')} | {p.get('d_spacing_A')} | {p.get('rel_intensity_pct')} | {p.get('fwhm_deg')} | {phase_str} | {p.get('composition_role') or '-'} |"
        )

    sem_stats = ctx["sem"].get("summary_stats") or {}
    if sem_stats.get("d50") is not None:
        lines.extend([
            "",
            "## 2. SEM 미세구조 분석 결과",
            f"- **대표 결정립 직경 (D50)**: {sem_stats.get('d50')} {sem_stats.get('unit', 'µm')}",
            f"- **중앙 원형도**: {sem_stats.get('median_circularity')}",
        ])

    overview = ctx["rule"].get("overview")
    if overview:
        lines.extend([
            "",
            "## 3. 통합 교차 해석 요약",
            overview,
        ])

    return "\n".join(lines)


def _is_ai_or_crawler(request: Request) -> bool:
    """Detect if client is an AI agent, web crawler, or CLI tool needing pre-rendered content."""
    ua = request.headers.get("user-agent", "").lower()
    bot_signatures = [
        "bot", "crawler", "spider", "crawl", "slurp", "mediapartners",
        "chatgpt", "gptbot", "oai-searchbot", "google-extended", "googlebot",
        "bingbot", "claudebot", "anthropic", "perplexity", "bytespider",
        "yandex", "duckduckbot", "baiduspider",
        "curl", "python", "urllib", "requests", "aiohttp", "wget", "httpie",
    ]
    if any(sig in ua for sig in bot_signatures):
        return True
    # Explicit query parameter for bot/AI consumption
    if request.query_params.get("ai") in ("1", "true") or request.query_params.get("format") in ("html", "text", "md", "json"):
        return True
    return False


# Dedicated AI-friendly Index & Fallback routes
_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"


@app.get("/", response_class=Response)
@app.get("/index.html", response_class=Response)
def serve_index_with_ai_fallback(
    request: Request,
    project: str | None = Query(None),
    run: str | None = Query(None),
    format: str | None = Query(None),
):
    ctx = _get_run_context_for_ai(project_id=project, run_id=run)
    base_url = str(request.base_url).rstrip("/")

    # If client asks for markdown or json explicitly
    accept_hdr = request.headers.get("accept", "").lower()
    if format in ("json",) or "application/json" in accept_hdr:
        if ctx:
            return Response(content=json.dumps(ctx, ensure_ascii=False, indent=2), media_type="application/json")
        return Response(content=json.dumps({"status": "no_data"}), media_type="application/json")

    if format in ("md", "markdown", "text") or "text/plain" in accept_hdr:
        if ctx:
            return PlainTextResponse(content=_build_ai_markdown_summary(ctx, base_url))
        return PlainTextResponse(content="MatLens: No analysis data available.")

    # Serve HTML with pre-rendered semantic report inside <div id="root">
    html_path = _DIST_DIR / "index.html"
    if not html_path.exists():
        if ctx:
            return HTMLResponse(content=_build_ai_semantic_html(ctx, base_url))
        return HTMLResponse(content="<h1>MatLens API is running</h1>")

    base_html = html_path.read_text(encoding="utf-8")
    if ctx:
        rendered_article = _build_ai_semantic_html(ctx, base_url)
        # Update meta title and description cleanly (prevent awkward [샘플] labels)
        if project or run:
            clean_name = re.sub(r"^\[.*?\]\s*", "", ctx.get("sample_name") or "").strip() or "재료 분석"
            clean_title = f"MatLens — {clean_name} 재료 분석 리포트 (XRD × SEM)"
        else:
            clean_title = "MatLens — 재료 분석 통합 솔루션 (XRD × SEM)"

        base_html = re.sub(r"<title>.*?</title>", f"<title>{clean_title}</title>", base_html)
        base_html = re.sub(r'<meta property="og:title" content=".*?" />', f'<meta property="og:title" content="{clean_title}" />', base_html)
        base_html = re.sub(r'<meta name="twitter:title" content=".*?" />', f'<meta name="twitter:title" content="{clean_title}" />', base_html)

        # Only inject the pre-rendered text for AI crawlers / bots to prevent FOUC for human users
        if _is_ai_or_crawler(request):
            injected_html = re.sub(
                r'<div id="root">.*?</div>',
                f'<div id="root">\n{rendered_article}\n</div>',
                base_html,
                flags=re.DOTALL,
            )
            return HTMLResponse(content=injected_html, status_code=200)

        # For normal human browsers, deliver clean HTML without the sudden report flashing
        return HTMLResponse(content=base_html, status_code=200)

    return HTMLResponse(content=base_html, status_code=200)


from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from app.core.utm_engine import (
    parse_utm_raw_text,
    analyze_utm_dataset,
    detect_encoding,
)
from app.core.utm_pdf import (
    generate_utm_charts_image,
    generate_utm_pdf_report,
)


# ==========================================
# UTM Raw Data Independent Endpoints
# ==========================================
class UTMAnalyzeRequest(BaseModel):
    parsed_data: Dict[str, Any]
    start_index: Optional[int] = None
    end_index: Optional[int] = None
    specimen_area_A0: Optional[float] = None
    specimen_gauge_L0: Optional[float] = None
    elastic_start_strain_pct: Optional[float] = None
    elastic_end_strain_pct: Optional[float] = None
    calc_offset_yield: bool = True
    analysis_name: Optional[str] = "UTM 인장시험 분석"
    notes: Optional[str] = ""


@app.post("/api/utm/parse")
async def utm_parse_file(file: UploadFile = File(...)):
    """Upload and parse UTM raw test file (TXT, CSV, TSV) in UTF-8 or CP949."""
    content_bytes = await file.read()
    if not content_bytes:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    enc = detect_encoding(content_bytes)
    try:
        text = content_bytes.decode(enc)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"인코딩 디코딩 실패 ({enc}): {str(e)}. UTF-8 또는 CP949 파일로 저장해주세요.")

    try:
        parsed = parse_utm_raw_text(text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"UTM 파일 파싱 실패: {str(e)}")

    # Add file metadata
    parsed["filename"] = file.filename
    parsed["encoding"] = enc
    # Include sample preview rows (first 10 rows)
    parsed["preview_rows"] = parsed["rows"][:10]
    return parsed


@app.post("/api/utm/analyze")
def utm_analyze_data(req: UTMAnalyzeRequest):
    """Run numerical calculations and feature extractions on parsed UTM data."""
    try:
        res = analyze_utm_dataset(
            parsed_data=req.parsed_data,
            start_index=req.start_index,
            end_index=req.end_index,
            specimen_area_A0=req.specimen_area_A0,
            specimen_gauge_L0=req.specimen_gauge_L0,
            elastic_start_strain_pct=req.elastic_start_strain_pct,
            elastic_end_strain_pct=req.elastic_end_strain_pct,
            calc_offset_yield=req.calc_offset_yield,
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"UTM 분석 실패: {str(e)}")


@app.post("/api/utm/download/chart")
def utm_download_chart(req: UTMAnalyzeRequest):
    """Download combined 3-panel experimental curves as high-resolution PNG."""
    try:
        res = analyze_utm_dataset(
            parsed_data=req.parsed_data,
            start_index=req.start_index,
            end_index=req.end_index,
            specimen_area_A0=req.specimen_area_A0,
            specimen_gauge_L0=req.specimen_gauge_L0,
            elastic_start_strain_pct=req.elastic_start_strain_pct,
            elastic_end_strain_pct=req.elastic_end_strain_pct,
            calc_offset_yield=req.calc_offset_yield,
        )
        png_bytes = generate_utm_charts_image(res, title=req.analysis_name or "UTM Analysis")
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Content-Disposition": 'attachment; filename="utm_analysis_charts.png"'},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"차트 생성 실패: {str(e)}")


@app.post("/api/utm/download/csv")
def utm_download_csv(req: UTMAnalyzeRequest):
    """Download analyzed slice with standardized units (MPa, N, %) as CSV."""
    try:
        res = analyze_utm_dataset(
            parsed_data=req.parsed_data,
            start_index=req.start_index,
            end_index=req.end_index,
            specimen_area_A0=req.specimen_area_A0,
            specimen_gauge_L0=req.specimen_gauge_L0,
            elastic_start_strain_pct=req.elastic_start_strain_pct,
            elastic_end_strain_pct=req.elastic_end_strain_pct,
            calc_offset_yield=req.calc_offset_yield,
        )
        c = res["curves"]
        output = io.StringIO()
        output.write("Index,Time_sec,Load_raw,Load_N,Disp_mm,Stress_raw,Stress_MPa,Strain_pct,True_Stress_raw,True_Strain_raw\n")
        n = len(c["index"])
        for i in range(n):
            idx = c["index"][i]
            t = c["time"][i] if i < len(c["time"]) else ""
            l_raw = c["load_raw"][i] if i < len(c["load_raw"]) else ""
            l_n = c["load_N"][i] if i < len(c["load_N"]) else ""
            d_mm = c["disp_raw"][i] if i < len(c["disp_raw"]) else ""
            s_raw = c["stress_raw"][i] if i < len(c["stress_raw"]) else ""
            s_mpa = c["stress_MPa"][i] if i < len(c["stress_MPa"]) else ""
            st_pct = c["strain_pct"][i] if i < len(c["strain_pct"]) else ""
            ts_raw = c["true_stress_raw"][i] if i < len(c["true_stress_raw"]) else ""
            tst_raw = c["true_strain_raw"][i] if i < len(c["true_strain_raw"]) else ""
            output.write(f"{idx},{t},{l_raw},{l_n},{d_mm},{s_raw},{s_mpa},{st_pct},{ts_raw},{tst_raw}\n")

        csv_content = output.getvalue().encode("utf-8-sig")
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="utm_converted_data.csv"'},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV 생성 실패: {str(e)}")


@app.post("/api/utm/download/json")
def utm_download_json(req: UTMAnalyzeRequest):
    """Download full numerical metrics and configuration as JSON."""
    try:
        res = analyze_utm_dataset(
            parsed_data=req.parsed_data,
            start_index=req.start_index,
            end_index=req.end_index,
            specimen_area_A0=req.specimen_area_A0,
            specimen_gauge_L0=req.specimen_gauge_L0,
            elastic_start_strain_pct=req.elastic_start_strain_pct,
            elastic_end_strain_pct=req.elastic_end_strain_pct,
            calc_offset_yield=req.calc_offset_yield,
        )
        res_payload = {
            "analysis_name": req.analysis_name,
            "filename": req.parsed_data.get("filename"),
            "notes": req.notes,
            "result": res,
        }
        return Response(
            content=json.dumps(res_payload, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="utm_analysis_result.json"'},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"JSON 내보내기 실패: {str(e)}")


@app.post("/api/utm/download/pdf")
def utm_download_pdf(req: UTMAnalyzeRequest):
    """Download professional standalone UTM PDF report."""
    try:
        res = analyze_utm_dataset(
            parsed_data=req.parsed_data,
            start_index=req.start_index,
            end_index=req.end_index,
            specimen_area_A0=req.specimen_area_A0,
            specimen_gauge_L0=req.specimen_gauge_L0,
            elastic_start_strain_pct=req.elastic_start_strain_pct,
            elastic_end_strain_pct=req.elastic_end_strain_pct,
            calc_offset_yield=req.calc_offset_yield,
        )
        pdf_bytes = generate_utm_pdf_report(
            analysis_result=res,
            file_name=req.parsed_data.get("filename") or "utm_raw_data.txt",
            analysis_name=req.analysis_name or "UTM 인장시험 분석",
            notes=req.notes or "",
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="utm_analysis_report.pdf"'},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF 리포트 생성 실패: {str(e)}")


@app.get("/api/runs/{run_id}/summary")
def get_run_ai_summary(run_id: str, request: Request, format: str = Query("markdown")):
    """Dedicated endpoint returning concise Markdown or JSON summary optimized for LLM reading."""
    ctx = _get_run_context_for_ai(run_id=run_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Run not found")
    base_url = str(request.base_url).rstrip("/")
    if format == "json":
        return ctx
    return PlainTextResponse(content=_build_ai_markdown_summary(ctx, base_url))


# Optional SPA static serving for other assets (/assets/...)
if _DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_DIST_DIR), html=True), name="spa")
