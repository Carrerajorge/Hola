from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from iliagpt_ocr.domain.errors import EngineUnavailableError, OcrFailedError
from iliagpt_ocr.domain.models import BoundingBox, OcrPageResult, TextBlock

try:
    from paddleocr import PaddleOCR  # type: ignore
except Exception:  # pragma: no cover
    PaddleOCR = None  # type: ignore


@dataclass
class PaddleOcrEngine:
    use_angle_cls: bool = True
    _instances: dict[str, object] = field(default_factory=dict, init=False, repr=False)

    @property
    def name(self) -> str:
        return "paddle"

    def _get_instance(self, lang: str) -> object:
        if PaddleOCR is None:
            raise EngineUnavailableError("PaddleOCR is not installed (install extra: [paddle])")

        # PaddleOCR initialization is expensive; cache per-language.
        inst = self._instances.get(lang)
        if inst is None:
            inst = PaddleOCR(use_angle_cls=self.use_angle_cls, lang=lang, show_log=False)
            self._instances[lang] = inst
        return inst

    def recognize(self, image_bgr: np.ndarray, *, lang: str, page_index: int) -> OcrPageResult:
        try:
            ocr = self._get_instance(lang)
            # PaddleOCR API returns a nested list; for a single image it is a list of lines.
            raw = ocr.ocr(image_bgr, cls=self.use_angle_cls)  # type: ignore[attr-defined]
        except EngineUnavailableError:
            raise
        except Exception as e:  # pragma: no cover
            raise OcrFailedError(f"PaddleOCR failed: {e}") from e

        blocks: list[TextBlock] = []
        confidences: list[float] = []
        lines_text: list[str] = []

        # raw can be None/[] if no text
        for line in (raw or []):
            try:
                pts = line[0]
                text, conf = line[1]
                conf_f = float(conf)
                confidences.append(conf_f)
                lines_text.append(str(text))
                xs = [int(round(p[0])) for p in pts]
                ys = [int(round(p[1])) for p in pts]
                bbox = BoundingBox(min(xs), min(ys), max(xs), max(ys))
                blocks.append(TextBlock(text=str(text), confidence=conf_f, bbox=bbox))
            except Exception:
                # Be resilient to unexpected line shapes.
                continue

        text_out = "\n".join(lines_text).strip()
        avg_conf = (sum(confidences) / len(confidences)) if confidences else None
        return OcrPageResult(page_index=page_index, text=text_out, blocks=blocks, avg_confidence=avg_conf)

