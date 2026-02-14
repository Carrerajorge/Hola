from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from iliagpt_ocr.api.main import create_app
from _helpers import make_text_image


@pytest.fixture(scope="session")
def client() -> TestClient:
    # Keep tests fast / deterministic.
    os.environ.setdefault("OCR_MAX_FILE_SIZE_MB", "2")
    os.environ.setdefault("OCR_MAX_PAGES", "5")
    os.environ.setdefault("OCR_DEFAULT_LANG", "eng")
    os.environ.setdefault("OCR_PREFER_ENGINE", "auto")
    app = create_app()
    return TestClient(app)


@pytest.fixture(scope="session")
def ocr_available(client) -> bool:
    smoke = make_text_image("ILIAGPT OCR SMOKE 000", seed=999, fmt="png")
    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("smoke.png", smoke, "image/png")})
    if r.status_code != 200:
        pytest.skip(f"OCR not available in this environment: {r.status_code} {r.text}")
    return True
