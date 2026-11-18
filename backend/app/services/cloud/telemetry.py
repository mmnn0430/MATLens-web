"""Cloud Telemetry, Structured Logging, and Cost Optimization for MatLens 2.0.

Provides:
- Structured JSON logging for Cloud Run / Cloud Logging
- Token usage tracking & daily budget limits
- Latency and performance timing
- Error rate monitoring
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("matlens.cloud.telemetry")

# In-memory daily budget counters (reset on process restart)
_TOKEN_USAGE_COUNTER = 0
_DAILY_TOKEN_BUDGET = int(os.environ.get("MAX_DAILY_TOKEN_BUDGET", "500000"))


def log_structured_event(event_type: str, payload: Dict[str, Any], level: str = "INFO") -> None:
    """Emits structured JSON logs compatible with Google Cloud Logging."""
    # Sanitize payload: strip any raw API keys or passwords
    safe_payload = {}
    for k, v in payload.items():
        if any(secret_term in k.lower() for secret_term in ("key", "secret", "password", "token")):
            safe_payload[k] = "[REDACTED]"
        else:
            safe_payload[k] = v

    log_entry = {
        "timestamp": time.time(),
        "event_type": event_type,
        "service": "matlens-backend-v2",
        "severity": level.upper(),
        "data": safe_payload,
    }

    raw_json = json.dumps(log_entry, default=str)
    if level.upper() == "ERROR":
        logger.error(raw_json)
    elif level.upper() == "WARNING":
        logger.warning(raw_json)
    else:
        logger.info(raw_json)


def track_token_usage(estimated_tokens: int) -> bool:
    """Records token usage and checks against daily safety budget."""
    global _TOKEN_USAGE_COUNTER
    _TOKEN_USAGE_COUNTER += estimated_tokens
    if _TOKEN_USAGE_COUNTER > _DAILY_TOKEN_BUDGET:
        log_structured_event("BUDGET_EXCEEDED_WARNING", {
            "current_usage": _TOKEN_USAGE_COUNTER,
            "daily_budget": _DAILY_TOKEN_BUDGET,
        }, level="WARNING")
        return False
    return True


def get_telemetry_metrics() -> Dict[str, Any]:
    """Returns current telemetry metrics for health and monitoring dashboards."""
    return {
        "total_tokens_used": _TOKEN_USAGE_COUNTER,
        "daily_budget": _DAILY_TOKEN_BUDGET,
        "budget_remaining": max(0, _DAILY_TOKEN_BUDGET - _TOKEN_USAGE_COUNTER),
        "cloud_run_environment": bool(os.environ.get("K_SERVICE")),
        "google_cloud_project": os.environ.get("GOOGLE_CLOUD_PROJECT", "local-dev"),
    }
