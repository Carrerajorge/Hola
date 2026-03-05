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
    # PaddleOCR accuracy on synthetic images can vary by version/model.
    # For CI determinism we prefer Tesseract for "real OCR" tests; Paddle is still the
    # primary engine in production deployments.
    os.environ.setdefault("OCR_PREFER_ENGINE", "tesseract")
    # Our accuracy suite generates a single text line; PSM 6 is more stable than the
    # fully-automatic default (PSM 3) across platforms.
    os.environ.setdefault("OCR_TESSERACT_PSM", "6")
    os.environ.setdefault("OCR_LOG_LEVEL", "ERROR")
    app = create_app()
    return TestClient(app)


@pytest.fixture(scope="session")
def ocr_available(client) -> bool:
    smoke = make_text_image("ILIAGPT OCR SMOKE 000", seed=999, fmt="png")
    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("smoke.png", smoke, "image/png")})
    if r.status_code != 200:
        pytest.skip(f"OCR not available in this environment: {r.status_code} {r.text}")
    return True


@pytest.fixture(scope="session")
def tesseract_available(client) -> bool:
    smoke = make_text_image("ILIAGPT OCR TESSERACT 000", seed=998, fmt="png")
    r = client.post("/v1/ocr?engine=tesseract&lang=eng", files={"file": ("smoke.png", smoke, "image/png")})
    if r.status_code != 200:
        pytest.skip(f"Tesseract OCR not available in this environment: {r.status_code} {r.text}")
    return True
