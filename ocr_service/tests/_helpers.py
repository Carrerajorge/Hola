from __future__ import annotations

import io
import os
import random
import re
from dataclasses import dataclass
from difflib import SequenceMatcher

import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


def normalize_text(s: str) -> str:
    s = (s or "").lower()
    # Keep only ascii alnum; OCR engines vary in whitespace/punctuation.
    #
    # Also normalize a few common OCR confusions to make the accuracy suite stable
    # across Tesseract/Paddle versions and platforms (e.g. O vs 0, I/l vs 1).
    tokens = re.findall(r"[a-z0-9]+", s)
    out: list[str] = []
    for t in tokens:
        if any(ch.isdigit() for ch in t) or re.fullmatch(r"[oil]+", t):
            t = t.replace("o", "0").replace("i", "1").replace("l", "1")
        out.append(t)
    return "".join(out)


def similarity(a: str, b: str) -> float:
    a_n = normalize_text(a)
    b_n = normalize_text(b)
    if not a_n and not b_n:
        return 1.0
    return SequenceMatcher(None, a_n, b_n).ratio()


def _find_font() -> str | None:
    candidates = [
        # Linux (CI)
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        # macOS (local)
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def make_text_image(
    text: str,
    *,
    seed: int,
    fmt: str = "png",
    width: int = 1200,
    height: int = 320,
) -> bytes:
    rnd = random.Random(seed)

    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    font_path = _find_font()
    font_size = 54
    if font_path:
        font = ImageFont.truetype(font_path, font_size)
    else:
        font = ImageFont.load_default()

    # Slight jitter to simulate imperfect scans/handwriting-ish variation.
    x0 = 40 + rnd.randint(-5, 5)
    y0 = 110 + rnd.randint(-5, 5)
    draw.text((x0, y0), text, fill="black", font=font)

    # Transformations (kept moderate to avoid flaky OCR).
    angle = rnd.choice([0, 0, 0, -2.5, 2.5, -5, 5])
    if angle:
        img = img.rotate(angle, expand=False, fillcolor="white")

    # Low-light simulation.
    if rnd.random() < 0.25:
        img = ImageEnhance.Brightness(img).enhance(rnd.uniform(0.65, 0.9))

    # Contrast changes.
    if rnd.random() < 0.25:
        img = ImageEnhance.Contrast(img).enhance(rnd.uniform(0.85, 1.25))

    # Blur / noise.
    if rnd.random() < 0.2:
        img = img.filter(ImageFilter.GaussianBlur(radius=rnd.uniform(0.3, 0.8)))

    if rnd.random() < 0.2:
        # Add sparse salt-and-pepper noise.
        px = img.load()
        for _ in range(int(width * height * 0.001)):
            x = rnd.randrange(0, width)
            y = rnd.randrange(0, height)
            px[x, y] = (0, 0, 0) if rnd.random() < 0.5 else (255, 255, 255)

    buf = io.BytesIO()
    if fmt.lower() in ("jpg", "jpeg"):
        img.save(buf, format="JPEG", quality=85, optimize=True)
    else:
        img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def make_pdf_from_image(image_bytes: bytes) -> bytes:
    # Create a 1-page PDF that embeds the image as a scanned document.
    with Image.open(io.BytesIO(image_bytes)) as im:
        w, h = im.size
    doc = fitz.open()
    try:
        page = doc.new_page(width=w, height=h)
        page.insert_image(page.rect, stream=image_bytes)
        return doc.tobytes()
    finally:
        doc.close()


@dataclass(frozen=True)
class OcrCase:
    case_id: int
    fmt: str  # png|jpg|pdf
    text: str
    bytes: bytes
    filename: str
