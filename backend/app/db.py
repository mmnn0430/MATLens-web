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
            """
        )


def new_id(prefix: str = "") -> str:
    uid = uuid.uuid4().hex[:12]
    return f"{prefix}_{uid}" if prefix else uid


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
