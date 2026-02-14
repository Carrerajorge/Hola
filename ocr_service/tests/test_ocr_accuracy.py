from __future__ import annotations

import pytest

from _helpers import OcrCase, make_pdf_from_image, make_text_image, similarity


def _make_cases() -> list[OcrCase]:
    cases: list[OcrCase] = []
    for case_id in range(100):
        text = f"ILIAGPT OCR CASE {case_id:03d} ABC 123"

        if case_id < 10:
            img_bytes = make_text_image(text, seed=case_id, fmt="png")
            pdf_bytes = make_pdf_from_image(img_bytes)
            cases.append(
                OcrCase(
                    case_id=case_id,
                    fmt="pdf",
                    text=text,
                    bytes=pdf_bytes,
                    filename=f"case_{case_id:03d}.pdf",
                )
            )
        elif case_id % 2 == 0:
            img_bytes = make_text_image(text, seed=case_id, fmt="png")
            cases.append(
                OcrCase(
                    case_id=case_id,
                    fmt="png",
                    text=text,
                    bytes=img_bytes,
                    filename=f"case_{case_id:03d}.png",
                )
            )
        else:
            img_bytes = make_text_image(text, seed=case_id, fmt="jpg")
            cases.append(
                OcrCase(
                    case_id=case_id,
                    fmt="jpg",
                    text=text,
                    bytes=img_bytes,
                    filename=f"case_{case_id:03d}.jpg",
                )
            )
    return cases


@pytest.mark.parametrize("case", _make_cases(), ids=lambda c: f"{c.fmt}-{c.case_id:03d}")
def test_ocr_accuracy_cases(client, ocr_available, tesseract_available, case: OcrCase):
    content_type = "application/pdf" if case.fmt == "pdf" else ("image/jpeg" if case.fmt == "jpg" else "image/png")
    r = client.post(
        "/v1/ocr?engine=tesseract&lang=eng",
        files={"file": (case.filename, case.bytes, content_type)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    out_text = body["text"]
    score = similarity(out_text, case.text)
    assert score >= 0.90, f"case={case.case_id} fmt={case.fmt} score={score:.3f} out={out_text!r}"

    assert body["engine"] == "tesseract"
    assert "timings_ms" in body
