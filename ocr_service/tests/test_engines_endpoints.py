from __future__ import annotations

from fastapi.testclient import TestClient

from iliagpt_ocr.api.main import create_app


def test_readyz_and_engines_endpoints(monkeypatch):
    # Make endpoints deterministic even when local machine lacks OCR engines.
    import iliagpt_ocr.adapters.ocr.paddle as paddle_mod
    import iliagpt_ocr.adapters.ocr.tesseract as tess_mod

    monkeypatch.setattr(paddle_mod.PaddleOcrEngine, "is_available", lambda self: True)
    monkeypatch.setattr(tess_mod.TesseractOcrEngine, "is_available", lambda self: True)

    app = create_app()
    client = TestClient(app)

    r = client.get("/readyz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["engines"]["paddle"] is True
    assert body["engines"]["tesseract"] is True

    r2 = client.get("/v1/engines")
    assert r2.status_code == 200
    engines = r2.json()["engines"]
    assert engines["paddle"]["available"] is True
    assert engines["tesseract"]["available"] is True

