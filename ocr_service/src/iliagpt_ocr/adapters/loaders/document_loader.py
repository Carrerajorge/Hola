from __future__ import annotations

import io
import mimetypes
from dataclasses import dataclass

import cv2
import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageSequence

from iliagpt_ocr.domain.errors import TooManyPagesError, UnsupportedFileTypeError


def _guess_mime(filename: str | None, content_type: str | None) -> str | None:
    if content_type:
        return content_type.split(";")[0].strip().lower()
    if filename:
        return mimetypes.guess_type(filename)[0]
    return None


def _sniff_mime(content: bytes) -> str | None:
    if content.startswith(b"%PDF"):
        return "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"GIF8"):
        return "image/gif"
    if content.startswith(b"II*\x00") or content.startswith(b"MM\x00*"):
        return "image/tiff"
    return None


def _is_pdf(mime: str | None, filename: str | None, content: bytes) -> bool:
    if mime == "application/pdf":
        return True
    if content.startswith(b"%PDF"):
        return True
    if filename and filename.lower().endswith(".pdf"):
        return True
    return False


def _decode_image(content: bytes) -> np.ndarray:
    arr = np.frombuffer(content, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        # Fallback to Pillow for formats OpenCV cannot decode in some builds.
        try:
            with Image.open(io.BytesIO(content)) as im:
                rgb = im.convert("RGB")
                np_img = np.array(rgb)
                img = cv2.cvtColor(np_img, cv2.COLOR_RGB2BGR)
        except Exception as e:
            raise UnsupportedFileTypeError("Could not decode image bytes") from e
    return img


def _decode_tiff(content: bytes, *, max_pages: int) -> list[np.ndarray]:
    try:
        with Image.open(io.BytesIO(content)) as im:
            frames: list[np.ndarray] = []
            for frame in ImageSequence.Iterator(im):
                rgb = frame.convert("RGB")
                np_img = np.array(rgb)
                bgr = cv2.cvtColor(np_img, cv2.COLOR_RGB2BGR)
                frames.append(bgr)
                if len(frames) > max_pages:
                    raise TooManyPagesError(f"TIFF has >{max_pages} pages")
            if not frames:
                raise UnsupportedFileTypeError("Empty TIFF")
            return frames
    except TooManyPagesError:
        raise
    except Exception as e:
        raise UnsupportedFileTypeError("Could not decode TIFF") from e


def _is_tiff(mime: str | None, filename: str | None, content: bytes) -> bool:
    if mime == "image/tiff":
        return True
    if filename and filename.lower().endswith((".tif", ".tiff")):
        return True
    if content.startswith(b"II*\x00") or content.startswith(b"MM\x00*"):
        return True
    return False


@dataclass(frozen=True)
class PyMuPdfDocumentLoader:
    dpi: int = 300
    max_pages: int = 10

    def load(self, *, content: bytes, filename: str | None, content_type: str | None) -> list[np.ndarray]:
        sniffed = _sniff_mime(content)
        mime = _guess_mime(filename, content_type)

        # If bytes clearly identify an image, trust the bytes over a misleading filename/content-type.
        if sniffed and sniffed.startswith("image/") and sniffed != "application/pdf":
            if sniffed == "image/tiff":
                return _decode_tiff(content, max_pages=self.max_pages)
            return [self._load_image(content)]

        effective_mime = mime or sniffed
        if _is_pdf(effective_mime, filename, content):
            return self._load_pdf(content)
        if _is_tiff(effective_mime, filename, content):
            return _decode_tiff(content, max_pages=self.max_pages)
        return [self._load_image(content)]

    def _load_image(self, content: bytes) -> np.ndarray:
        return _decode_image(content)

    def _load_pdf(self, content: bytes) -> list[np.ndarray]:
        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception as e:
            raise UnsupportedFileTypeError("Could not open PDF") from e
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
