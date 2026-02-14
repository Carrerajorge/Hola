from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from iliagpt_ocr.domain.errors import EngineUnavailableError, OcrFailedError
from iliagpt_ocr.domain.models import BoundingBox, OcrPageResult, TextBlock

try:
    import pytesseract
except Exception:  # pragma: no cover
    pytesseract = None  # type: ignore


@dataclass(frozen=True)
class TesseractOcrEngine:
    oem: int = 1
    psm: int = 3

    @property
    def name(self) -> str:
        return "tesseract"

    def recognize(self, image_bgr: np.ndarray, *, lang: str, page_index: int) -> OcrPageResult:
        if pytesseract is None:
            raise EngineUnavailableError("pytesseract is not installed")

        try:
            rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            config = f"--oem {int(self.oem)} --psm {int(self.psm)}"

            text_out = pytesseract.image_to_string(pil, lang=lang, config=config)  # type: ignore[attr-defined]
            data = pytesseract.image_to_data(  # type: ignore[attr-defined]
                pil,
                lang=lang,
                config=config,
                output_type=pytesseract.Output.DICT,  # type: ignore[attr-defined]
            )
        except getattr(pytesseract, "TesseractNotFoundError", ()):  # pragma: no cover
            raise EngineUnavailableError("tesseract binary not found on PATH")
        except EngineUnavailableError:
            raise
        except Exception as e:  # pragma: no cover
            raise OcrFailedError(f"Tesseract failed: {e}") from e

        blocks: list[TextBlock] = []
        confs: list[float] = []

        n = len(data.get("text", []))
        for i in range(n):
            w = str(data["text"][i]).strip()
            if not w:
                continue
            try:
                conf_raw = float(data["conf"][i])
            except Exception:
                continue
            if conf_raw < 0:
                continue
            conf = max(0.0, min(1.0, conf_raw / 100.0))
            x = int(data["left"][i])
            y = int(data["top"][i])
            bw = int(data["width"][i])
            bh = int(data["height"][i])
            bbox = BoundingBox(x, y, x + bw, y + bh)
            blocks.append(TextBlock(text=w, confidence=conf, bbox=bbox))
            confs.append(conf)

        avg_conf = (sum(confs) / len(confs)) if confs else None
        return OcrPageResult(
            page_index=page_index,
            text=str(text_out).strip(),
            blocks=blocks,
            avg_confidence=avg_conf,
        )
