"""Secret Management Provider for MatLens 2.0.

Provides safe access to sensitive keys:
- Reads from server environment variables / .env
- Optionally reads from Google Cloud Secret Manager when GCP_SECRET_MANAGER_ENABLED is set
- Never exposes raw keys in client responses or telemetry logs
"""
from __future__ import annotations

import os
from typing import Optional


def get_secret(secret_name: str, default: Optional[str] = None) -> Optional[str]:
    """Retrieves secret from environment or GCP Secret Manager."""
    # 1. Direct environment variable lookup
    val = os.environ.get(secret_name)
    if val:
        return val

    # 2. GCP Secret Manager if enabled
    if os.environ.get("GCP_SECRET_MANAGER_ENABLED", "").lower() in ("true", "1", "yes"):
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if project_id:
            try:
                from google.cloud import secretmanager
                client = secretmanager.SecretManagerServiceClient()
                name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
                response = client.access_secret_version(request={"name": name})
                return response.payload.data.decode("UTF-8").strip()
            except Exception:
                pass

    return default
