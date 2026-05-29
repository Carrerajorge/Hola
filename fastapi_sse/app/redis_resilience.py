"""Shared Redis resilience helpers for sync and async clients."""
from __future__ import annotations

import random
import time
from typing import Any, Callable, Optional, TypeVar
from urllib.parse import urlsplit, urlunsplit

import redis

from .config import Settings, get_settings

T = TypeVar("T")

_RECENT_LOGS: dict[str, float] = {}

_TRANSIENT_ERROR_MARKERS = (
    "econnreset",
    "connection reset",
    "connection refused",
    "temporarily unavailable",
    "broken pipe",
    "timed out",
    "timeout",
    "try again",
)


def redact_redis_url(url: str) -> str:
    """Hide credentials when logging Redis URLs."""
    parsed = urlsplit(url)
    if not parsed.password:
        return url
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    if parsed.username:
        netloc = f"{parsed.username}:***@{netloc}"
    else:
        netloc = f":***@{netloc}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def build_redis_connection_kwargs(
    settings: Optional[Settings] = None,
    *,
    decode_responses: bool = True,
) -> dict[str, Any]:
    """Build consistent connection kwargs for Redis clients and pools."""
    cfg = settings or get_settings()
    return {
        "decode_responses": decode_responses,
        "socket_timeout": cfg.redis_socket_timeout,
        "socket_connect_timeout": cfg.redis_socket_connect_timeout,
        "health_check_interval": cfg.redis_health_check_interval,
        "retry_on_timeout": True,
        "socket_keepalive": True,
    }


def build_sync_redis_client(
    redis_url: Optional[str] = None,
    *,
    decode_responses: bool = True,
) -> redis.Redis:
    """Create a sync Redis client with hardened defaults."""
    settings = get_settings()
    return redis.from_url(
        redis_url or settings.redis_url,
        **build_redis_connection_kwargs(settings, decode_responses=decode_responses),
    )


def classify_redis_error(error: BaseException) -> str:
    """Classify Redis failures into broad operator-friendly buckets."""
    error_text = str(error).lower()
    if any(marker in error_text for marker in ("econnreset", "connection reset", "broken pipe")):
        return "connection_reset"
    if any(marker in error_text for marker in ("timed out", "timeout")):
        return "timeout"
    if any(marker in error_text for marker in ("connection refused", "temporarily unavailable", "try again")):
        return "connection_unavailable"
    if isinstance(error, redis.AuthenticationError):
        return "auth"
    return "redis_error"


def is_transient_redis_error(error: BaseException) -> bool:
    """Return True when the Redis failure is likely recoverable."""
    if isinstance(error, (redis.TimeoutError, redis.ConnectionError, ConnectionError, OSError)):
        return True
    if isinstance(error, redis.RedisError):
        lowered = str(error).lower()
        return any(marker in lowered for marker in _TRANSIENT_ERROR_MARKERS)
    return False


def compute_redis_retry_delay_seconds(attempt: int, settings: Optional[Settings] = None) -> float:
    """Exponential backoff with light jitter for Redis retries."""
    cfg = settings or get_settings()
    base_ms = max(1, cfg.redis_retry_base_delay_ms)
    max_ms = max(base_ms, cfg.redis_retry_max_delay_ms)
    delay_ms = min(max_ms, base_ms * (2 ** max(0, attempt - 1)))
    jitter_factor = 0.85 + random.random() * 0.3
    return (delay_ms * jitter_factor) / 1000.0


def should_emit_transient_redis_log(log_key: str, settings: Optional[Settings] = None) -> bool:
    """Throttle repeated transient Redis warnings to reduce noisy logs."""
    cfg = settings or get_settings()
    now = time.monotonic()
    last_seen = _RECENT_LOGS.get(log_key)
    if last_seen is not None and (now - last_seen) < cfg.redis_transient_log_ttl_sec:
        return False
    _RECENT_LOGS[log_key] = now
    return True


def run_sync_redis_operation(
    operation: Callable[[], T],
    *,
    operation_name: str,
    logger: Any,
    context: Optional[dict[str, Any]] = None,
    attempts: Optional[int] = None,
) -> T:
    """Run a sync Redis operation with retry/backoff on transient failures."""
    settings = get_settings()
    max_attempts = max(1, attempts or settings.redis_retry_attempts)
    log_context = context.copy() if context else {}

    last_error: Optional[BaseException] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return operation()
        except Exception as error:  # pragma: no cover - exercised by callers/tests
            last_error = error
            transient = is_transient_redis_error(error)
            error_kind = classify_redis_error(error)
            base_log = {
                "operation": operation_name,
                "attempt": attempt,
                "max_attempts": max_attempts,
                "transient": transient,
                "error_kind": error_kind,
                "error": str(error),
                **log_context,
            }

            if transient and attempt < max_attempts:
                if should_emit_transient_redis_log(f"{operation_name}:{error_kind}", settings):
                    logger.warning("redis_transient_retry_scheduled", **base_log)
                time.sleep(compute_redis_retry_delay_seconds(attempt, settings))
                continue

            log_method = logger.warning if transient else logger.error
            log_method("redis_operation_failed", **base_log)
            raise

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Redis operation {operation_name} failed without an exception")
