from __future__ import annotations

import io

import fitz
import numpy as np
from PIL import Image

from iliagpt_ocr.adapters.loaders.document_loader import PyMuPdfDocumentLoader
from iliagpt_ocr.domain.errors import TooManyPagesError


def _png_bytes() -> bytes:
    img = Image.new("RGB", (320, 120), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_loader_loads_image_bytes():
    loader = PyMuPdfDocumentLoader(dpi=200, max_pages=5)
    pages = loader.load(content=_png_bytes(), filename="x.png", content_type="image/png")
    assert len(pages) == 1
    assert isinstance(pages[0], np.ndarray)
    assert pages[0].dtype == np.uint8
    assert pages[0].ndim == 3


def test_loader_guesses_mime_from_filename_when_content_type_missing():
    loader = PyMuPdfDocumentLoader(dpi=200, max_pages=5)
    pages = loader.load(content=_png_bytes(), filename="x.png", content_type=None)
    assert len(pages) == 1


def test_loader_loads_pdf_pages():
    img_bytes = _png_bytes()
    doc = fitz.open()
    try:
        for _ in range(2):
            page = doc.new_page(width=320, height=120)
            page.insert_image(page.rect, stream=img_bytes)
        pdf_bytes = doc.tobytes()
    finally:
        doc.close()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=pdf_bytes, filename="x.pdf", content_type="application/pdf")
    assert len(pages) == 2
    assert pages[0].shape[2] == 3


def test_loader_detects_pdf_from_filename_even_if_mime_is_generic():
    img_bytes = _png_bytes()
    doc = fitz.open()
    try:
        page = doc.new_page(width=320, height=120)
        page.insert_image(page.rect, stream=img_bytes)
        pdf_bytes = doc.tobytes()
    finally:
        doc.close()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=pdf_bytes, filename="x.pdf", content_type="application/octet-stream")
    assert len(pages) == 1


def test_loader_rejects_too_many_pages():
    doc = fitz.open()
    try:
        doc.new_page()
        doc.new_page()
        doc.new_page()
        pdf_bytes = doc.tobytes()
    finally:
        doc.close()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=2)
    try:
        loader.load(content=pdf_bytes, filename="x.pdf", content_type="application/pdf")
        assert False, "expected TooManyPagesError"
    except TooManyPagesError:
        pass
