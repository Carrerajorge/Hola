from __future__ import annotations

import types

import pytest
import numpy as np

import iliagpt_ocr.adapters.ocr.paddle as paddle_mod
import iliagpt_ocr.adapters.ocr.tesseract as tess_mod
from iliagpt_ocr.adapters.ocr.paddle import PaddleOcrEngine
from iliagpt_ocr.adapters.ocr.tesseract import TesseractOcrEngine
from iliagpt_ocr.domain.errors import EngineUnavailableError


def test_paddle_adapter_parses_blocks(monkeypatch):
    class FakePaddleOCR:
        def __init__(self, **kwargs):
            pass

        def ocr(self, image, cls=True):
            return [
                (
                    [[0, 0], [50, 0], [50, 20], [0, 20]],
                    ("HELLO", 0.95),
                ),
                ("MALFORMED",),  # should be ignored without failing the request
                (
                    [[0, 30], [50, 30], [50, 50], [0, 50]],
                    ("WORLD", 0.90),
                ),
            ]

    monkeypatch.setattr(paddle_mod, "PaddleOCR", FakePaddleOCR)

    eng = PaddleOcrEngine(use_angle_cls=True)
    assert eng.is_available() is True
    img = np.zeros((60, 60, 3), dtype=np.uint8)
    res = eng.recognize(img, lang="en", page_index=0)
    assert res.text == "HELLO\nWORLD"
    assert res.avg_confidence is not None
    assert res.avg_confidence > 0.9
    assert len(res.blocks) == 2
    assert res.blocks[0].bbox is not None

    # Call again to cover instance cache fast-path.
    res2 = eng.recognize(img, lang="en", page_index=1)
    assert res2.engine == "paddle"


def test_tesseract_adapter_parses_blocks(monkeypatch):
    fake = types.SimpleNamespace()

    def image_to_string(pil, lang, config):
        return "HELLO WORLD"

    def image_to_data(pil, lang, config, output_type):
        return {
            "text": ["HELLO", "WORLD"],
            "conf": ["90", "85"],
            "left": [10, 80],
            "top": [5, 5],
            "width": [60, 70],
            "height": [20, 20],
        }

    fake.image_to_string = image_to_string
    fake.image_to_data = image_to_data
    fake.Output = types.SimpleNamespace(DICT=object())

    monkeypatch.setattr(tess_mod, "pytesseract", fake)

    eng = TesseractOcrEngine(oem=1, psm=3)
    img = np.zeros((40, 200, 3), dtype=np.uint8)
    res = eng.recognize(img, lang="eng", page_index=0)
    assert res.text == "HELLO WORLD"
    assert res.avg_confidence is not None
    assert 0.8 <= res.avg_confidence <= 1.0
    assert len(res.blocks) == 2

    # Availability check should be truthy when version call works.
    fake.get_tesseract_version = lambda: "5.0.0"
    assert eng.is_available() is True


def test_tesseract_adapter_skips_empty_and_invalid_tokens(monkeypatch):
    fake = types.SimpleNamespace()

    def image_to_string(pil, lang, config):
        return "HELLO WORLD"

    def image_to_data(pil, lang, config, output_type):
        return {
            "text": ["", "HELLO", "BADCONF", "NEG", "WORLD"],
            "conf": ["90", "90", "not-a-number", "-1", "85"],
            "left": [0, 10, 20, 30, 80],
            "top": [0, 5, 5, 5, 5],
            "width": [1, 60, 60, 60, 70],
            "height": [1, 20, 20, 20, 20],
        }

    fake.image_to_string = image_to_string
    fake.image_to_data = image_to_data
    fake.Output = types.SimpleNamespace(DICT=object())

    monkeypatch.setattr(tess_mod, "pytesseract", fake)

    eng = TesseractOcrEngine(oem=1, psm=3)
    img = np.zeros((40, 200, 3), dtype=np.uint8)
    res = eng.recognize(img, lang="eng", page_index=0)
    # Only HELLO + WORLD should survive.
    assert [b.text for b in res.blocks] == ["HELLO", "WORLD"]


def test_tesseract_adapter_engine_unavailable_when_pytesseract_missing(monkeypatch):
    monkeypatch.setattr(tess_mod, "pytesseract", None)
    eng = TesseractOcrEngine()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    with pytest.raises(EngineUnavailableError):
        eng.recognize(img, lang="eng", page_index=0)

    assert eng.is_available() is False


def test_tesseract_is_available_false_when_binary_missing(monkeypatch):
    class Tnf(Exception):
        pass

    fake = types.SimpleNamespace()
    fake.TesseractNotFoundError = Tnf
    fake.get_tesseract_version = lambda: (_ for _ in ()).throw(Tnf("missing"))

    monkeypatch.setattr(tess_mod, "pytesseract", fake)
    eng = TesseractOcrEngine()
    assert eng.is_available() is False


def test_tesseract_adapter_propagates_engine_unavailable(monkeypatch):
    fake = types.SimpleNamespace()

    def image_to_string(pil, lang, config):
        raise EngineUnavailableError("boom")

    fake.image_to_string = image_to_string
    fake.image_to_data = lambda *args, **kwargs: {}
    fake.Output = types.SimpleNamespace(DICT=object())

    monkeypatch.setattr(tess_mod, "pytesseract", fake)

    eng = TesseractOcrEngine()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    with pytest.raises(EngineUnavailableError):
        eng.recognize(img, lang="eng", page_index=0)
