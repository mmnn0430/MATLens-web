"""Asynchronous background job runner separating CPU-heavy XRD/SEM numerical engines from FastAPI request handling."""
from __future__ import annotations

import json
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .config import PROJECTS_STORAGE_DIR
from .db import get_conn, new_id, utc_now_iso
from .engine.ref_library import load_reference_library, parse_user_cif
from .engine.report_engine import (
    build_rule_summary,
    generate_gemini_interpretation,
    generate_grain_phase_ai_interpretation,
)
from .engine.sem_engine import run_sem_pipeline
from .engine.xrd_engine import run_xrd_pipeline
from .schemas import RunAnalysisRequest

_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="matlens-worker")
_ACTIVE_FUTURES: dict[str, Future[None]] = {}


def _update_run_progress(run_id: str, status: str, pct: int, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE analysis_runs SET status = ?, progress_pct = ?, stage_message = ? WHERE id = ?",
            (status, pct, message, run_id),
        )


def execute_analysis_run_sync(run_id: str, project_id: str, req_dict: dict[str, Any]) -> None:
    """Execute full XRD + SEM + Rule Summary + optional Gemini AI pipeline for `run_id`."""
    try:
        req = RunAnalysisRequest.model_validate(req_dict)
        _update_run_progress(run_id, "running", 10, "프로젝트 파일 및 기준 라이브러리를 불러오는 중...")

        with get_conn() as conn:
            proj_row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not proj_row:
                raise RuntimeError("프로젝트를 찾을 수 없습니다.")
            file_rows = conn.execute(
                "SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC", (project_id,)
            ).fetchall()

        project_meta = {
            "id": proj_row["id"],
            "sample_name": proj_row["sample_name"],
            "description": proj_row["description"],
            "expected_elements": json.loads(proj_row["expected_elements_json"]),
            "expected_formula": proj_row["expected_formula"],
            "is_same_sample": bool(proj_row["is_same_sample"]),
            "is_sample_demo": bool(proj_row["is_sample_demo"]),
        }

        proj_dir = PROJECTS_STORAGE_DIR / project_id
        run_dir = proj_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        xrd_file = next((r for r in reversed(file_rows) if r["file_role"] == "xrd"), None)
        sem_file = next((r for r in reversed(file_rows) if r["file_role"] == "sem"), None)
        cif_files = [r for r in file_rows if r["file_role"] == "cif"]

        if xrd_file is None and sem_file is None:
            raise ValueError("분석할 XRD 또는 SEM 파일이 업로드되지 않았습니다.")

        xrd_res: dict[str, Any] | None = None
        sem_res: dict[str, Any] | None = None
        overlay_rel: str | None = None
        roi_rel: str | None = None
        ov_bytes: bytes | None = None
        roi_bytes: bytes | None = None

        if xrd_file is not None:
            _update_run_progress(run_id, "running", 30, "XRD 배경 보정, 비평활 정량 피크 피팅 및 상 후보 비교 중...")
            lib_data = load_reference_library()
            ref_entries = list(lib_data["entries"])
            for idx, cf in enumerate(cif_files):
                cif_bytes = (proj_dir / cf["stored_relpath"]).read_bytes()
                ref_entries.insert(0, parse_user_cif(cif_bytes, cf["original_filename"], ref_index=idx + 1))
            raw_xrd = (proj_dir / xrd_file["stored_relpath"]).read_bytes()
            xrd_res = run_xrd_pipeline(
                raw_xrd,
                req.xrd_params,
                ref_entries,
                project_meta["expected_elements"],
                sample_name=project_meta["sample_name"],
                sample_description=project_meta["description"],
                expected_formula=project_meta["expected_formula"],
            )

        if sem_file is not None:
            _update_run_progress(run_id, "running", 60, "SEM 영역 분할 및 결정립 상(Phase) 매핑 계산 중...")
            raw_sem = (proj_dir / sem_file["stored_relpath"]).read_bytes()
            sem_res, ov_bytes, roi_bytes = run_sem_pipeline(
                raw_sem,
                req.sem_params,
                xrd_result=xrd_res,
                expected_formula=project_meta["expected_formula"],
            )
            ov_path = run_dir / "overlay.png"
            roi_path = run_dir / "roi.png"
            ov_path.write_bytes(ov_bytes)
            roi_path.write_bytes(roi_bytes)
            overlay_rel = f"runs/{run_id}/overlay.png"
            roi_rel = f"runs/{run_id}/roi.png"

        _update_run_progress(run_id, "running", 80, "규칙 기반 요약 생성 중...")
        rule_summary = build_rule_summary(project_meta, xrd_res, sem_res)

        with get_conn() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET xrd_result_json = ?,
                    sem_result_json = ?,
                    rule_summary_json = ?,
                    overlay_relpath = ?,
                    roi_relpath = ?
                WHERE id = ?
                """,
                (
                    json.dumps(xrd_res, ensure_ascii=False) if xrd_res is not None else None,
                    json.dumps(sem_res, ensure_ascii=False) if sem_res is not None else None,
                    json.dumps(rule_summary, ensure_ascii=False),
                    overlay_rel,
                    roi_rel,
                    run_id,
                ),
            )

        if req.run_ai_interpretation:
            _update_run_progress(run_id, "running", 90, "Gemini AI 통합 해석 및 결정립별 상(Phase) 분석 생성 중...")
            if sem_res is not None:
                sem_res = generate_grain_phase_ai_interpretation(project_meta, sem_res, xrd_res, roi_bytes)
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE analysis_runs SET sem_result_json = ? WHERE id = ?",
                        (json.dumps(sem_res, ensure_ascii=False), run_id),
                    )
            ai_out = generate_gemini_interpretation(project_meta, rule_summary, roi_bytes, ov_bytes)
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO ai_reports (
                        id, project_id, run_id, status, model_name, prompt_version,
                        schema_valid, reference_check_json, report_json, error_message, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id("ai"),
                        project_id,
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
        else:
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO ai_reports (
                        id, project_id, run_id, status, model_name, prompt_version,
                        schema_valid, reference_check_json, report_json, error_message, created_at
                    ) VALUES (?, ?, ?, 'disabled', '', '', 0, '{}', NULL, '사용자가 AI 해석을 끈 상태로 실행했습니다.', ?)
                    """,
                    (new_id("ai"), project_id, run_id, utc_now_iso()),
                )

        with get_conn() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET status = 'completed', progress_pct = 100, stage_message = '분석 완료', completed_at = ?
                WHERE id = ?
                """,
                (utc_now_iso(), run_id),
            )
    except Exception as exc:
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET status = 'failed', stage_message = '분석 오류', error_message = ?, completed_at = ?
                WHERE id = ?
                """,
                (str(exc)[:500], utc_now_iso(), run_id),
            )
    finally:
        _ACTIVE_FUTURES.pop(run_id, None)


def submit_analysis_job(run_id: str, project_id: str, req_dict: dict[str, Any]) -> None:
    fut = _EXECUTOR.submit(execute_analysis_run_sync, run_id, project_id, req_dict)
    _ACTIVE_FUTURES[run_id] = fut
