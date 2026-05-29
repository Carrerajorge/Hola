"""Focused tests for Redis resilience helpers."""
from unittest.mock import MagicMock

import redis

from fastapi_sse.app.redis_resilience import (
    build_redis_connection_kwargs,
    classify_redis_error,
    is_transient_redis_error,
    redact_redis_url,
    run_sync_redis_operation,
)


def test_redact_redis_url_hides_password():
    redacted = redact_redis_url("redis://user:secret@example.com:6379/0")
    assert "secret" not in redacted
    assert "***" in redacted


def test_classify_redis_error_for_connection_reset():
    error = redis.ConnectionError("Error while reading from socket: read ECONNRESET")
    assert classify_redis_error(error) == "connection_reset"
    assert is_transient_redis_error(error) is True


def test_build_redis_connection_kwargs_enables_health_checks():
    kwargs = build_redis_connection_kwargs()
    assert kwargs["retry_on_timeout"] is True
    assert kwargs["socket_keepalive"] is True
    assert kwargs["health_check_interval"] > 0


def test_run_sync_redis_operation_retries_transient_errors_once():
    calls = {"count": 0}
    logger = MagicMock()

    def flaky_operation():
        calls["count"] += 1
        if calls["count"] == 1:
            raise redis.ConnectionError("read ECONNRESET")
        return "ok"

    result = run_sync_redis_operation(
        flaky_operation,
        operation_name="test.redis.retry",
        logger=logger,
        attempts=2,
    )

    assert result == "ok"
    assert calls["count"] == 2
    logger.warning.assert_called()
