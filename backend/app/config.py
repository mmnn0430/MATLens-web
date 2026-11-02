"""Application configuration and environment variables.

Security rule:
- GEMINI_API_KEY and GEMINI_MODEL are read ONLY from server environment variables (or .env loaded on server startup).
- API keys and user file contents are NEVER logged or returned to clients.
"""
from __future__ import annotations

import importlib.metadata
import os
from pathlib import Path


def _load_dotenv_if_present() -> None:
    """Lightweight config loader without external dependency (reads api_config.txt and .env)."""
    root = Path(__file__).resolve().parent.parent.parent
    candidates = [
        root.parent / "api_config.txt",
        root / "api_config.txt",
        root.parent / ".env",
        root / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for env_path in candidates:
        if env_path.exists():
            try:
                for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and (val or key not in os.environ):
                        os.environ[key] = val
            except Exception:
                pass


_load_dotenv_if_present()

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
SAMPLES_DIR = PROJECT_ROOT / "samples"
STORAGE_DIR = Path(os.environ.get("MATLENS_STORAGE_DIR", str(BASE_DIR / "storage"))).resolve()
DB_PATH = STORAGE_DIR / "matlens.db"
PROJECTS_STORAGE_DIR = STORAGE_DIR / "projects"

# Upload & safety limits
MAX_UPLOAD_BYTES = int(os.environ.get("MATLENS_MAX_UPLOAD_MB", "25")) * 1024 * 1024
MAX_IMAGE_PIXELS = int(os.environ.get("MATLENS_MAX_IMAGE_PIXELS", "25000000"))  # 25 MP

ALLOWED_XRD_EXTS = {".csv", ".txt", ".xy", ".dat", ".xlsx", ".xls", ".asc"}
ALLOWED_SEM_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
ALLOWED_CIF_EXTS = {".cif"}

# Version tracking for reproducibility
ENGINE_VERSION = "matlens-engine-1.2.0"
REF_LIBRARY_VERSION = "matlens-curated-mp-v1.2"
AI_PROMPT_VERSION = "matlens-gemini-schema-v1.1"
MP_CACHE_DIR = DATA_DIR / "mp_cache"
API_CONFIG_TXT_PATH = PROJECT_ROOT / "api_config.txt"

GEMINI_MODEL_OPTIONS: list[dict[str, str]] = [
    {"id": "auto", "label": "자동 선택 (가용 Gemini 버전 자동 탐색·폴백)"},
    {"id": "gemini-3.5-flash", "label": "Gemini 3.5 Flash (빠르고 정확한 표준 멀티모달 · 권장)"},
    {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite (초고속 1~2초 응답)"},
    {"id": "gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite (경량 고속 멀티모달)"},
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash (최신 심층 추론 멀티모달)"},
    {"id": "gemini-3.7-flash", "label": "Gemini 3.7 Flash (고정밀 멀티모달)"},
    {"id": "gemini-3.6-flash", "label": "Gemini 3.6 Flash (균형형 멀티모달)"},
    {"id": "gemini-3-flash-preview", "label": "Gemini 3 Flash Preview"},
    {"id": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro Preview (고정밀 심층 추론)"},
    {"id": "gemini-flash-latest", "label": "Gemini Flash Latest (최신 Flash 별칭)"},
    {"id": "gemini-flash-lite-latest", "label": "Gemini Flash-Lite Latest (최신 Lite 별칭)"},
    {"id": "gemini-pro-latest", "label": "Gemini Pro Latest (최신 Pro 별칭)"},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (구버전 호환 · 미지원 시 3.5 자동 전환)"},
    {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro (구버전 호환)"},
    {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash (구버전 호환)"},
]

GEMINI_FALLBACK_ORDER: list[str] = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.1-pro-preview",
    "gemini-pro-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
]


def get_gemini_api_key() -> str | None:
    """Read Gemini API key strictly from server environment variable or hot-reloaded config."""
    _load_dotenv_if_present()
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    return key if key else None


def get_gemini_model() -> str:
    """Read Gemini model name from server environment variable or hot-reloaded config."""
    _load_dotenv_if_present()
    return (os.environ.get("GEMINI_MODEL") or "auto").strip()


def has_gemini_api_key() -> bool:
    return get_gemini_api_key() is not None


def get_mp_api_key() -> str | None:
    """Read Materials Project API key strictly from server environment variable or hot-reloaded config."""
    _load_dotenv_if_present()
    key = (os.environ.get("MP_API_KEY") or "").strip()
    return key if key else None


def has_mp_api_key() -> bool:
    return get_mp_api_key() is not None


def update_runtime_api_config(
    gemini_api_key: str | None = None,
    gemini_model: str | None = None,
    mp_api_key: str | None = None,
) -> None:
    """Update server environment variables and persist to api_config.txt & .env on disk."""
    _load_dotenv_if_present()
    if gemini_api_key is not None:
        clean_g = gemini_api_key.strip()
        if clean_g:
            os.environ["GEMINI_API_KEY"] = clean_g
        elif "GEMINI_API_KEY" in os.environ and clean_g == "__CLEAR__":
            os.environ["GEMINI_API_KEY"] = ""
    if gemini_model is not None and gemini_model.strip():
        os.environ["GEMINI_MODEL"] = gemini_model.strip()
    if mp_api_key is not None:
        clean_mp = mp_api_key.strip()
        if clean_mp:
            os.environ["MP_API_KEY"] = clean_mp
        elif "MP_API_KEY" in os.environ and clean_mp == "__CLEAR__":
            os.environ["MP_API_KEY"] = ""

    g_key = os.environ.get("GEMINI_API_KEY", "")
    g_mod = os.environ.get("GEMINI_MODEL", "auto")
    m_key = os.environ.get("MP_API_KEY", "")

    content = (
        "# MatLens API 설정 파일 (일반 텍스트 — IDE 암호화/차단 없이 바로 편집 가능)\n"
        "# GEMINI_MODEL은 auto 로 두면 사용 가능한 최신 Gemini 모델(2.5-flash, 2.0-flash, 2.5-pro, 2.5-flash-lite 등)을 자동으로 탐색·전환합니다.\n\n"
        f"GEMINI_API_KEY={g_key}\n"
        f"GEMINI_MODEL={g_mod}\n"
        f"MP_API_KEY={m_key}\n"
    )
    for target in (API_CONFIG_TXT_PATH, PROJECT_ROOT / ".env"):
        try:
            target.write_text(content, encoding="utf-8")
        except Exception:
            pass


def get_algorithm_and_library_versions() -> dict[str, str]:
    pkgs = ["numpy", "scipy", "pandas", "scikit-image", "opencv-python-headless", "pymatgen", "google-genai", "fastapi"]
    versions: dict[str, str] = {"matlens_engine": ENGINE_VERSION}
    for pkg in pkgs:
        try:
            versions[pkg] = importlib.metadata.version(pkg)
        except importlib.metadata.PackageNotFoundError:
            versions[pkg] = "not-installed"
    return versions


def ensure_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
