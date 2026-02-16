from __future__ import annotations

from typing import Protocol

import numpy as np

from iliagpt_ocr.domain.models import OcrPageResult


class DocumentLoader(Protocol):
    def load(self, *, content: bytes, filename: str | None, content_type: str | None) -> list[np.ndarray]:
        """Returns a list of pages as BGR uint8 images."""


class Preprocessor(Protocol):
    def process(self, image_bgr: np.ndarray, *, dpi: int) -> np.ndarray:
        """Returns a preprocessed BGR uint8 image."""


class OcrEngine(Protocol):
    @property
    def name(self) -> str: ...

    def recognize(self, image_bgr: np.ndarray, *, lang: str, page_index: int) -> OcrPageResult:
        """Run OCR on a single page image."""

