from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from iliagpt_ocr.application.ocr_use_case import OcrRequest, OcrUseCase
from iliagpt_ocr.domain.lang import resolve_language
from iliagpt_ocr.domain.models import OcrPageResult


def test_resolve_language_basic():
    r = resolve_language("eng")
    assert r.tesseract == "eng"
    assert r.paddle == "en"

    r2 = resolve_language("spa")
    assert r2.tesseract == "spa"
    assert r2.paddle == "latin"

    r3 = resolve_language("fr")
    assert r3.tesseract == "fra"
    assert r3.paddle == "french"

    r4 = resolve_language("de")
    assert r4.tesseract == "deu"
    assert r4.paddle == "german"

    r5 = resolve_language("zzz")
    assert r5.tesseract == "zzz"
    assert r5.paddle == "zzz"


def test_resolve_language_multilang_tesseract_style():
    r = resolve_language("eng+spa")
    assert r.tesseract == "eng+spa"
    assert r.paddle == "latin"

    r2 = resolve_language("en+foo")
    assert r2.tesseract == "eng+foo"
    assert r2.paddle == "en"


def test_resolve_language_handles_only_separators():
    r = resolve_language("++")
    assert r.tesseract == "eng"
    assert r.paddle == "en"


@dataclass(frozen=True)
class _Loader:
    def load(self, *, content: bytes, filename: str | None, content_type: str | None):
        return [np.zeros((10, 10, 3), dtype=np.uint8)]


@dataclass(frozen=True)
class _Pre:
    def process(self, image_bgr: np.ndarray, *, dpi: int):
        return image_bgr


@dataclass
class _EchoEngine:
    _name: str

    @property
    def name(self) -> str:
        return self._name

    def recognize(self, image_bgr: np.ndarray, *, lang: str, page_index: int) -> OcrPageResult:
        return OcrPageResult(
            page_index=page_index,
            engine=self.name,
            engine_lang=lang,
            text="ok",
            blocks=[],
            avg_confidence=1.0,
        )


def test_use_case_maps_eng_to_paddle_en():
    use_case = OcrUseCase(
        loader=_Loader(),
        preprocessor=_Pre(),
        primary_engine=_EchoEngine("paddle"),
        fallback_engine=_EchoEngine("tesseract"),
        prefer_engine="paddle",
    )
    res = use_case.run(OcrRequest(content=b"x", filename="x.png", content_type="image/png", lang="eng", engine="auto", dpi=300))
    assert res.engine == "paddle"
    assert res.pages[0].engine_lang == "en"
