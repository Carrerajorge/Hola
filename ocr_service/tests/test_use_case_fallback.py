from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from iliagpt_ocr.application.ocr_use_case import OcrRequest, OcrUseCase
from iliagpt_ocr.domain.errors import EngineUnavailableError, OcrFailedError
from iliagpt_ocr.domain.models import OcrPageResult


@dataclass(frozen=True)
class _Loader:
    def load(self, *, content: bytes, filename: str | None, content_type: str | None):
        return [np.zeros((10, 10, 3), dtype=np.uint8)]


@dataclass(frozen=True)
class _Pre:
    def process(self, image_bgr: np.ndarray, *, dpi: int):
        return image_bgr


@dataclass
class _Engine:
    _name: str
    mode: str  # ok|unavailable|fail

    @property
    def name(self) -> str:
        return self._name

    def recognize(self, image_bgr: np.ndarray, *, lang: str, page_index: int) -> OcrPageResult:
        if self.mode == "unavailable":
            raise EngineUnavailableError("nope")
        if self.mode == "fail":
            raise OcrFailedError("bad")
        return OcrPageResult(page_index=page_index, text="ok", blocks=[], avg_confidence=1.0)


def test_fallback_used_when_primary_unavailable():
    use_case = OcrUseCase(
        loader=_Loader(),
        preprocessor=_Pre(),
        primary_engine=_Engine("paddle", "unavailable"),
        fallback_engine=_Engine("tesseract", "ok"),
        prefer_engine="auto",
    )
    res = use_case.run(OcrRequest(content=b"x", filename="x.png", content_type="image/png", lang="eng", engine="auto", dpi=300))
    assert res.engine == "tesseract"
    assert res.text == "ok"


def test_fallback_used_when_primary_fails():
    use_case = OcrUseCase(
        loader=_Loader(),
        preprocessor=_Pre(),
        primary_engine=_Engine("paddle", "fail"),
        fallback_engine=_Engine("tesseract", "ok"),
        prefer_engine="auto",
    )
    res = use_case.run(OcrRequest(content=b"x", filename="x.png", content_type="image/png", lang="eng", engine="auto", dpi=300))
    assert res.engine == "tesseract"


def test_requested_engine_only():
    use_case = OcrUseCase(
        loader=_Loader(),
        preprocessor=_Pre(),
        primary_engine=_Engine("paddle", "ok"),
        fallback_engine=_Engine("tesseract", "ok"),
        prefer_engine="auto",
    )
    res = use_case.run(
        OcrRequest(content=b"x", filename="x.png", content_type="image/png", lang="eng", engine="tesseract", dpi=300)
    )
    assert res.engine == "tesseract"


def test_no_pages_raises():
    @dataclass(frozen=True)
    class _EmptyLoader:
        def load(self, *, content: bytes, filename: str | None, content_type: str | None):
            return []

    use_case = OcrUseCase(
        loader=_EmptyLoader(),
        preprocessor=_Pre(),
        primary_engine=_Engine("paddle", "ok"),
        fallback_engine=_Engine("tesseract", "ok"),
        prefer_engine="auto",
    )
    try:
        use_case.run(OcrRequest(content=b"x", filename="x.png", content_type="image/png", lang="eng", engine="auto", dpi=300))
        assert False, "expected OcrFailedError"
    except OcrFailedError:
        pass


def test_prefer_engine_ordering():
    use_case = OcrUseCase(
        loader=_Loader(),
        preprocessor=_Pre(),
        primary_engine=_Engine("paddle", "ok"),
        fallback_engine=_Engine("tesseract", "ok"),
        prefer_engine="tesseract",
    )
    engines = use_case._engine_order("auto")
    assert [e.name for e in engines] == ["tesseract", "paddle"]
