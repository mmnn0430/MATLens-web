"""SQLite persistence layer for projects, uploaded files, edit history, analysis runs, and AI reports."""
from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import DB_PATH, PROJECTS_STORAGE_DIR, ensure_dirs


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    ensure_dirs()
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                sample_name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                expected_elements_json TEXT NOT NULL DEFAULT '[]',
                expected_formula TEXT NOT NULL DEFAULT '',
                is_same_sample INTEGER NOT NULL DEFAULT 0,
                is_sample_demo INTEGER NOT NULL DEFAULT 0,
                current_conditions_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_files (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                file_role TEXT NOT NULL, -- 'xrd' | 'sem' | 'cif'
                original_filename TEXT NOT NULL,
                stored_relpath TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mime_type TEXT NOT NULL DEFAULT '',
                inspection_json TEXT NOT NULL DEFAULT '{}',
                is_sample INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edit_history (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                action_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS analysis_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                run_number INTEGER NOT NULL,
                status TEXT NOT NULL, -- 'queued' | 'running' | 'completed' | 'failed'
                progress_pct INTEGER NOT NULL DEFAULT 0,
                stage_message TEXT NOT NULL DEFAULT '',
                params_json TEXT NOT NULL,
                file_hashes_json TEXT NOT NULL,
                ref_library_version TEXT NOT NULL,
                algo_versions_json TEXT NOT NULL,
                xrd_result_json TEXT,
                sem_result_json TEXT,
                rule_summary_json TEXT,
                overlay_relpath TEXT,
                roi_relpath TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ai_reports (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
                status TEXT NOT NULL, -- 'completed' | 'failed' | 'disabled'
                model_name TEXT NOT NULL DEFAULT '',
                prompt_version TEXT NOT NULL DEFAULT '',
                schema_valid INTEGER NOT NULL DEFAULT 0,
                reference_check_json TEXT NOT NULL DEFAULT '{}',
                report_json TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plot_datasets (
                id TEXT PRIMARY KEY,
                sample_id TEXT NOT NULL,
                sample_name TEXT NOT NULL,
                measurement_type TEXT NOT NULL DEFAULT 'XRD',
                x_unit TEXT NOT NULL DEFAULT 'degree',
                y_unit TEXT NOT NULL DEFAULT 'a.u.',
                source_type TEXT NOT NULL DEFAULT 'raw_file',
                source_filename TEXT NOT NULL DEFAULT '',
                measurement_conditions_json TEXT NOT NULL DEFAULT '{}',
                data_quality_json TEXT NOT NULL DEFAULT '{}',
                processing_history_json TEXT NOT NULL DEFAULT '[]',
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plots (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                plot_type TEXT NOT NULL DEFAULT 'stacked',
                instrument TEXT NOT NULL DEFAULT 'XRD',
                normalization TEXT NOT NULL DEFAULT 'maximum',
                user_scale REAL NOT NULL DEFAULT 1.0,
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )


def new_id(prefix: str = "") -> str:
    uid = uuid.uuid4().hex[:12]
    return f"{prefix}_{uid}" if prefix else uid


def save_plot_dataset(dataset: dict[str, Any]) -> str:
    ds_id = dataset.get("id") or new_id("ds")
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO plot_datasets (
                id, sample_id, sample_name, measurement_type, x_unit, y_unit,
                source_type, source_filename, measurement_conditions_json,
                data_quality_json, processing_history_json, data_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM plot_datasets WHERE id = ?), ?), ?)
            """,
            (
                ds_id,
                dataset.get("sample_id") or ds_id,
                dataset.get("sample_name") or ds_id,
                dataset.get("measurement_type") or "XRD",
                dataset.get("x_unit") or "degree",
                dataset.get("y_unit") or "a.u.",
                dataset.get("source_type") or "raw_file",
                dataset.get("source_filename") or "",
                json.dumps(dataset.get("measurement_conditions") or {}, ensure_ascii=False),
                json.dumps(dataset.get("data_quality") or {}, ensure_ascii=False),
                json.dumps(dataset.get("processing_history") or [], ensure_ascii=False),
                json.dumps(dataset.get("data") or {}, ensure_ascii=False),
                ds_id,
                now,
                now,
            ),
        )
    return ds_id


def get_plot_dataset(ds_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM plot_datasets WHERE id = ?", (ds_id,)).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "dataset_id": row["id"],
            "sample_id": row["sample_id"],
            "sample_name": row["sample_name"],
            "measurement_type": row["measurement_type"],
            "x_unit": row["x_unit"],
            "y_unit": row["y_unit"],
            "source_type": row["source_type"],
            "source_filename": row["source_filename"],
            "measurement_conditions": json.loads(row["measurement_conditions_json"] or "{}"),
            "data_quality": json.loads(row["data_quality_json"] or "{}"),
            "processing_history": json.loads(row["processing_history_json"] or "[]"),
            "data": json.loads(row["data_json"] or "{}"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


def list_plot_datasets(measurement_type: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if measurement_type:
            rows = conn.execute(
                "SELECT * FROM plot_datasets WHERE measurement_type = ? ORDER BY created_at DESC",
                (measurement_type,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM plot_datasets ORDER BY created_at DESC").fetchall()
        result = []
        for row in rows:
            result.append({
                "id": row["id"],
                "dataset_id": row["id"],
                "sample_id": row["sample_id"],
                "sample_name": row["sample_name"],
                "measurement_type": row["measurement_type"],
                "x_unit": row["x_unit"],
                "y_unit": row["y_unit"],
                "source_type": row["source_type"],
                "source_filename": row["source_filename"],
                "measurement_conditions": json.loads(row["measurement_conditions_json"] or "{}"),
                "data_quality": json.loads(row["data_quality_json"] or "{}"),
                "processing_history": json.loads(row["processing_history_json"] or "[]"),
                "data": json.loads(row["data_json"] or "{}"),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            })
        return result


def delete_plot_dataset(ds_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM plot_datasets WHERE id = ?", (ds_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM plot_datasets WHERE id = ?", (ds_id,))
        return True


def save_plot(plot_id: str, title: str, plot_type: str, instrument: str, normalization: str, user_scale: float, config: dict[str, Any]) -> str:
    pid = plot_id or new_id("plot")
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO plots (
                id, title, plot_type, instrument, normalization, user_scale, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM plots WHERE id = ?), ?), ?)
            """,
            (
                pid,
                title,
                plot_type,
                instrument,
                normalization,
                user_scale,
                json.dumps(config, ensure_ascii=False),
                pid,
                now,
                now,
            ),
        )
    return pid


def get_plot(plot_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM plots WHERE id = ?", (plot_id,)).fetchone()
        if not row:
            return None
        cfg = json.loads(row["config_json"] or "{}")
        return {
            "id": row["id"],
            "plot_id": row["id"],
            "title": row["title"],
            "plot_type": row["plot_type"],
            "instrument": row["instrument"],
            "normalization": row["normalization"],
            "user_scale": row["user_scale"],
            "config": cfg,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


def update_plot(plot_id: str, patch_data: dict[str, Any]) -> dict[str, Any] | None:
    current = get_plot(plot_id)
    if not current:
        return None
    title = patch_data.get("title", current["title"])
    plot_type = patch_data.get("plot_type", current["plot_type"])
    instrument = patch_data.get("instrument", current["instrument"])
    normalization = patch_data.get("normalization", current["normalization"])
    user_scale = patch_data.get("user_scale", current["user_scale"])
    
    config = current["config"]
    if "config" in patch_data:
        config.update(patch_data["config"])
    for key in ["datasets", "x_axis", "y_axis", "annotations", "graph_properties", "preprocessing"]:
        if key in patch_data:
            config[key] = patch_data[key]
            
    now = utc_now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE plots
            SET title = ?, plot_type = ?, instrument = ?, normalization = ?, user_scale = ?, config_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, plot_type, instrument, normalization, user_scale, json.dumps(config, ensure_ascii=False), now, plot_id),
        )
    return get_plot(plot_id)


def record_history(conn: sqlite3.Connection, project_id: str, action_type: str, summary: str, payload: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO edit_history (id, project_id, action_type, summary, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id("hist"), project_id, action_type, summary, json.dumps(payload, ensure_ascii=False), utc_now_iso()),
    )


def delete_project_completely(project_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    proj_dir = PROJECTS_STORAGE_DIR / project_id
    if proj_dir.exists():
        shutil.rmtree(proj_dir, ignore_errors=True)
    return True
