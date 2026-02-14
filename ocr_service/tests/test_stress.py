from __future__ import annotations

import time

import pytest

from _helpers import make_text_image


@pytest.mark.stress
def test_stress_20_ocr_requests(client, ocr_available):
    start = time.perf_counter()
    for i in range(20):
        text = f"ILIAGPT STRESS {i:03d} ABC 123"
        img = make_text_image(text, seed=10_000 + i, fmt="png")
        r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("stress.png", img, "image/png")})
        assert r.status_code == 200
    duration = time.perf_counter() - start
    # Very generous upper bound to avoid flakes; purpose is to surface deadlocks/crashes.
    assert duration < 120.0
