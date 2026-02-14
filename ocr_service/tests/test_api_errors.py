from __future__ import annotations

import fitz


def test_rejects_unsupported_file_type(client):
    r = client.post(
        "/v1/ocr",
        files={"file": ("x.txt", b"this is not an image", "text/plain")},
    )
    assert r.status_code == 415
    body = r.json()
    assert body["error"] in ("UnsupportedFileTypeError", "OcrFailedError")


def test_rejects_too_large_file(client):
    too_big = b"x" * (2 * 1024 * 1024 + 1)
    r = client.post(
        "/v1/ocr",
        files={"file": ("x.png", too_big, "image/png")},
    )
    assert r.status_code == 413
    assert r.json()["error"] == "FileTooLargeError"


def test_rejects_pdf_with_too_many_pages(client):
    doc = fitz.open()
    try:
        for _ in range(6):
            doc.new_page()
        pdf_bytes = doc.tobytes()
    finally:
        doc.close()

    r = client.post(
        "/v1/ocr?engine=auto&lang=eng",
        files={"file": ("x.pdf", pdf_bytes, "application/pdf")},
    )
    assert r.status_code == 413
    assert r.json()["error"] == "TooManyPagesError"
