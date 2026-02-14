from __future__ import annotations

import mimetypes
from dataclasses import dataclass

import cv2
import fitz  # PyMuPDF
import numpy as np

from iliagpt_ocr.domain.errors import TooManyPagesError, UnsupportedFileTypeError


def _guess_mime(filename: str | None, content_type: str | None) -> str | None:
    if content_type:
        return content_type.split(";")[0].strip().lower()
    if filename:
        return mimetypes.guess_type(filename)[0]
    return None


def _is_pdf(mime: str | None, filename: str | None) -> bool:
    if mime == "application/pdf":
        return True
    if filename and filename.lower().endswith(".pdf"):
        return True
    return False


def _decode_image(content: bytes) -> np.ndarray:
    arr = np.frombuffer(content, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise UnsupportedFileTypeError("Could not decode image bytes")
    return img


@dataclass(frozen=True)
class PyMuPdfDocumentLoader:
    dpi: int = 300
    max_pages: int = 10

    def load(self, *, content: bytes, filename: str | None, content_type: str | None) -> list[np.ndarray]:
        mime = _guess_mime(filename, content_type)
        if _is_pdf(mime, filename):
            return self._load_pdf(content)
        return [self._load_image(content)]

    def _load_image(self, content: bytes) -> np.ndarray:
        return _decode_image(content)

    def _load_pdf(self, content: bytes) -> list[np.ndarray]:
        doc = fitz.open(stream=content, filetype="pdf")
        try:
            if doc.page_count > self.max_pages:
                raise TooManyPagesError(f"PDF has {doc.page_count} pages (max {self.max_pages})")

            # Render using a DPI-based zoom; PDF coordinate system is 72 DPI.
            zoom = float(self.dpi) / 72.0
            mat = fitz.Matrix(zoom, zoom)

            pages: list[np.ndarray] = []
            for i in range(doc.page_count):
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                # Pixmap samples are in RGB
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                pages.append(img_bgr)

            return pages
        finally:
            doc.close()

