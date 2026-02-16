from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi.testclient import TestClient
from PIL import Image

from iliagpt_ocr.api.main import create_app
from iliagpt_ocr.application.ocr_use_case import OcrRequest
from iliagpt_ocr.domain.errors import EngineUnavailableError


def _png_bytes() -> bytes:
    img = Image.new("RGB", (200, 80), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@dataclass
class _UseCaseEngineUnavailable:
    def run(self, req: OcrRequest):
        raise EngineUnavailableError("engine not ready")


@dataclass
class _UseCaseBoom:
    def run(self, req: OcrRequest):
        raise RuntimeError("boom")


def test_engine_unavailable_maps_to_503():
    app = create_app(use_case_override=_UseCaseEngineUnavailable())
    client = TestClient(app)

    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("x.png", _png_bytes(), "image/png")})
    assert r.status_code == 503
    assert r.json()["error"] == "EngineUnavailableError"


def test_unhandled_exception_maps_to_500():
    app = create_app(use_case_override=_UseCaseBoom())
    client = TestClient(app, raise_server_exceptions=False)

    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("x.png", _png_bytes(), "image/png")})
    assert r.status_code == 500
    assert r.json()["error"] == "InternalServerError"
