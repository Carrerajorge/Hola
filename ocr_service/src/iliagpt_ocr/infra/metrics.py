from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest


OCR_REQUESTS_TOTAL = Counter(
    "ocr_requests_total",
    "Total OCR HTTP requests",
    labelnames=["endpoint", "method", "status_code", "engine"],
)

OCR_REQUEST_DURATION_SECONDS = Histogram(
    "ocr_request_duration_seconds",
    "OCR HTTP request duration (seconds)",
    labelnames=["endpoint", "method"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30),
)

OCR_ENGINE_DURATION_SECONDS = Histogram(
    "ocr_engine_duration_seconds",
    "OCR engine duration (seconds)",
    labelnames=["engine"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30),
)

OCR_ENGINE_FAILURES_TOTAL = Counter(
    "ocr_engine_failures_total",
    "Total OCR engine failures",
    labelnames=["engine", "error_type"],
)


def render_prometheus() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST


@contextmanager
def observe_engine(engine: str) -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        OCR_ENGINE_DURATION_SECONDS.labels(engine=engine).observe(time.perf_counter() - start)

