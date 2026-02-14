from __future__ import annotations

from pydantic import BaseModel, Field


class BoundingBoxOut(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


class TextBlockOut(BaseModel):
    text: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BoundingBoxOut | None = None


class OcrPageOut(BaseModel):
    page_index: int
    text: str
    avg_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    blocks: list[TextBlockOut] = Field(default_factory=list)


class OcrResponse(BaseModel):
    engine: str
    lang: str
    text: str
    avg_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    pages: list[OcrPageOut]
    timings_ms: dict[str, float]


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    request_id: str | None = None

