from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi.testclient import TestClient
from PIL import Image

from iliagpt_ocr.api.main import create_app
from iliagpt_ocr.application.ocr_use_case import OcrRequest
from iliagpt_ocr.domain.models import BoundingBox, OcrPageResult, OcrResult, TextBlock


def _png_bytes() -> bytes:
    img = Image.new("RGB", (200, 80), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@dataclass
class _StubUseCase:
    def run(self, req: OcrRequest) -> OcrResult:
        page = OcrPageResult(
            page_index=0,
            engine="paddle",
            engine_lang=req.lang,
            text="hello",
            blocks=[TextBlock(text="hello", confidence=0.99, bbox=BoundingBox(1, 2, 3, 4))],
            avg_confidence=0.99,
        )
        return OcrResult(
            engine="paddle",
            lang=req.lang,
            pages=[page],
            text="hello",
            avg_confidence=0.99,
            timings_ms={"total_ms": 1.0, "load_ms": 0.2, "preprocess_ms": 0.3, "engine_ms": 0.5},
        )


def test_api_success_with_stub_use_case():
    app = create_app(use_case_override=_StubUseCase())
    client = TestClient(app)

    r = client.post("/v1/ocr?engine=auto&lang=eng", files={"file": ("x.png", _png_bytes(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "hello"
    assert body["engine"] == "paddle"
    assert body["avg_confidence"] == 0.99
    assert body["pages"][0]["page_index"] == 0
