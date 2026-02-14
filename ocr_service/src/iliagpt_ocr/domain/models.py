from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BoundingBox:
    # (x1, y1, x2, y2) in image pixel coordinates.
    x1: int
    y1: int
    x2: int
    y2: int


@dataclass(frozen=True)
class TextBlock:
    text: str
    confidence: float  # 0..1
    bbox: BoundingBox | None = None


@dataclass(frozen=True)
class OcrPageResult:
    page_index: int
    text: str
    blocks: list[TextBlock]
    avg_confidence: float | None


@dataclass(frozen=True)
class OcrResult:
    engine: str
    lang: str
    pages: list[OcrPageResult]
    text: str
    avg_confidence: float | None
    timings_ms: dict[str, float]

