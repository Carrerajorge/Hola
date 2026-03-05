from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi.testclient import TestClient
from PIL import Image

from iliagpt_ocr.api.main import create_app
from iliagpt_ocr.application.ocr_use_case import OcrRequest
from iliagpt_ocr.domain.models import OcrPageResult, OcrResult


def _png_bytes() -> bytes:
    img = Image.new("RGB", (200, 80), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@dataclass
class _StubUseCase:
    def run(self, req: OcrRequest) -> OcrResult:
        page = OcrPageResult(page_index=0, engine="tesseract", engine_lang=req.lang, text="ok", blocks=[], avg_confidence=1.0)
        return OcrResult(
            engine="tesseract",
            lang=req.lang,
            pages=[page],
            text="ok",
            avg_confidence=1.0,
            timings_ms={"total_ms": 1.0},
        )


def test_api_key_required(monkeypatch):
    monkeypatch.setenv("OCR_API_KEY", "secret")
    monkeypatch.setenv("OCR_LOG_LEVEL", "ERROR")

    app = create_app(use_case_override=_StubUseCase())
    client = TestClient(app, raise_server_exceptions=False)

    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("x.png", _png_bytes(), "image/png")})
    assert r.status_code == 401
    assert r.json()["error"] == "Unauthorized"

    r2 = client.post(
        "/v1/ocr?engine=auto&lang=eng",
        headers={"Authorization": "Bearer secret"},
        files={"file": ("x.png", _png_bytes(), "image/png")},
    )
    assert r2.status_code == 200

    r3 = client.post(
        "/v1/ocr?engine=auto&lang=eng",
        headers={"X-API-Key": "secret"},
        files={"file": ("x.png", _png_bytes(), "image/png")},
    )
    assert r3.status_code == 200

