from __future__ import annotations

import io

import fitz
import numpy as np
import pytest
from PIL import Image

from iliagpt_ocr.adapters.loaders.document_loader import PyMuPdfDocumentLoader
from iliagpt_ocr.domain.errors import TooManyPagesError, UnsupportedFileTypeError


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


def test_loader_detects_pdf_from_signature_without_filename_or_mime():
    img_bytes = _png_bytes()
    doc = fitz.open()
    try:
        page = doc.new_page(width=320, height=120)
        page.insert_image(page.rect, stream=img_bytes)
        pdf_bytes = doc.tobytes()
    finally:
        doc.close()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=pdf_bytes, filename=None, content_type=None)
    assert len(pages) == 1


def test_loader_loads_multipage_tiff():
    frames = [
        Image.new("RGB", (200, 80), "white"),
        Image.new("RGB", (200, 80), "white"),
    ]
    buf = io.BytesIO()
    frames[0].save(buf, format="TIFF", save_all=True, append_images=frames[1:])
    tiff_bytes = buf.getvalue()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=tiff_bytes, filename="x.tiff", content_type="image/tiff")
    assert len(pages) == 2
    assert pages[0].shape[2] == 3


def test_loader_sniffs_png_without_filename_or_mime():
    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=_png_bytes(), filename=None, content_type=None)
    assert len(pages) == 1


def test_loader_sniffs_jpg_without_filename_or_mime():
    img = Image.new("RGB", (120, 60), "white")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    jpg_bytes = buf.getvalue()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=jpg_bytes, filename=None, content_type=None)
    assert len(pages) == 1


def test_loader_sniffs_gif_without_filename_or_mime():
    img = Image.new("RGB", (120, 60), "white")
    buf = io.BytesIO()
    img.save(buf, format="GIF")
    gif_bytes = buf.getvalue()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=gif_bytes, filename=None, content_type=None)
    assert len(pages) == 1


def test_loader_sniffs_tiff_without_filename_or_mime():
    img = Image.new("RGB", (120, 60), "white")
    buf = io.BytesIO()
    img.save(buf, format="TIFF")
    tiff_bytes = buf.getvalue()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=tiff_bytes, filename=None, content_type=None)
    assert len(pages) == 1


def test_loader_pdf_mislabelled_content_is_treated_as_image():
    # If bytes clearly identify an image, prefer them over a misleading filename.
    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=_png_bytes(), filename="x.pdf", content_type="application/octet-stream")
    assert len(pages) == 1
    assert pages[0].shape[2] == 3


def test_loader_unknown_bytes_with_pdf_extension_raises_unsupported():
    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    with pytest.raises(UnsupportedFileTypeError):
        loader.load(content=b"not-a-pdf", filename="x.pdf", content_type="application/octet-stream")


def test_loader_tiff_too_many_pages_raises():
    frames = [
        Image.new("RGB", (120, 60), "white"),
        Image.new("RGB", (120, 60), "white"),
    ]
    buf = io.BytesIO()
    frames[0].save(buf, format="TIFF", save_all=True, append_images=frames[1:])
    tiff_bytes = buf.getvalue()

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=1)
    try:
        loader.load(content=tiff_bytes, filename="x.tiff", content_type="image/tiff")
        assert False, "expected TooManyPagesError"
    except TooManyPagesError:
        pass


def test_loader_tiff_invalid_bytes_raises_unsupported():
    # Starts with TIFF signature but is invalid.
    bad = b"II*\x00" + b"x" * 20
    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    try:
        loader.load(content=bad, filename="x.tiff", content_type="image/tiff")
        assert False, "expected UnsupportedFileTypeError"
    except Exception as e:
        assert e.__class__.__name__ == "UnsupportedFileTypeError"


def test_loader_image_decode_falls_back_to_pillow(monkeypatch):
    import iliagpt_ocr.adapters.loaders.document_loader as dl

    # Force OpenCV decode failure and ensure Pillow path succeeds.
    monkeypatch.setattr(dl.cv2, "imdecode", lambda *args, **kwargs: None)
    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    pages = loader.load(content=_png_bytes(), filename="x.png", content_type="image/png")
    assert len(pages) == 1


def test_loader_tiff_empty_frames_raises_unsupported(monkeypatch):
    import iliagpt_ocr.adapters.loaders.document_loader as dl

    img = Image.new("RGB", (120, 60), "white")
    buf = io.BytesIO()
    img.save(buf, format="TIFF")
    tiff_bytes = buf.getvalue()

    monkeypatch.setattr(dl.ImageSequence, "Iterator", lambda im: iter([]))

    loader = PyMuPdfDocumentLoader(dpi=120, max_pages=5)
    with pytest.raises(UnsupportedFileTypeError):
        loader.load(content=tiff_bytes, filename="x.tiff", content_type="image/tiff")


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
