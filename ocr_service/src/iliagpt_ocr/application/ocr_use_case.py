from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from iliagpt_ocr.domain.errors import EngineUnavailableError, OcrFailedError
from iliagpt_ocr.domain.models import OcrPageResult, OcrResult
from iliagpt_ocr.domain.ports import DocumentLoader, OcrEngine, Preprocessor
from iliagpt_ocr.infra.metrics import OCR_ENGINE_FAILURES_TOTAL, observe_engine


@dataclass(frozen=True)
class OcrRequest:
    content: bytes
    filename: str | None
    content_type: str | None
    lang: str
    engine: str  # auto|paddle|tesseract
    dpi: int


@dataclass
class OcrUseCase:
    loader: DocumentLoader
    preprocessor: Preprocessor
    primary_engine: OcrEngine
    fallback_engine: OcrEngine
    prefer_engine: str = "auto"  # auto|paddle|tesseract

    def run(self, req: OcrRequest) -> OcrResult:
        timings_ms: dict[str, float] = {}

        t0 = time.perf_counter()
        pages = self.loader.load(content=req.content, filename=req.filename, content_type=req.content_type)
        timings_ms["load_ms"] = (time.perf_counter() - t0) * 1000.0

        if not pages:
            raise OcrFailedError("No pages to OCR")

        engines = self._engine_order(req.engine)

        page_results: list[OcrPageResult] = []
        preprocess_ms_total = 0.0
        engine_ms_total = 0.0
        chosen_engine = None

        for idx, img in enumerate(pages):
            img_pp, pp_ms = self._preprocess(img, dpi=req.dpi)
            preprocess_ms_total += pp_ms

            page_res = self._ocr_with_fallback(img_pp, lang=req.lang, page_index=idx, engines=engines)
            engine_ms_total += page_res["_engine_ms"]
            chosen_engine = page_res["_engine_name"]
            page_results.append(page_res["result"])

        timings_ms["preprocess_ms"] = preprocess_ms_total
        timings_ms["engine_ms"] = engine_ms_total
        timings_ms["total_ms"] = (time.perf_counter() - t0) * 1000.0

        full_text = "\n\n".join([p.text for p in page_results]).strip()
        confidences = [p.avg_confidence for p in page_results if p.avg_confidence is not None]
        avg_conf = (sum(confidences) / len(confidences)) if confidences else None

        return OcrResult(
            engine=str(chosen_engine or engines[0].name),
            lang=req.lang,
            pages=page_results,
            text=full_text,
            avg_confidence=avg_conf,
            timings_ms=timings_ms,
        )

    def _preprocess(self, image_bgr: np.ndarray, *, dpi: int) -> tuple[np.ndarray, float]:
        t0 = time.perf_counter()
        out = self.preprocessor.process(image_bgr, dpi=dpi)
        return out, (time.perf_counter() - t0) * 1000.0

    def _engine_order(self, requested: str) -> list[OcrEngine]:
        requested = (requested or "auto").lower()
        prefer = (self.prefer_engine or "auto").lower()

        if requested in ("paddle", "tesseract"):
            return [self.primary_engine if requested == self.primary_engine.name else self.fallback_engine]

        if prefer in ("paddle", "tesseract"):
            first = self.primary_engine if prefer == self.primary_engine.name else self.fallback_engine
            second = self.fallback_engine if first is self.primary_engine else self.primary_engine
            return [first, second]

        return [self.primary_engine, self.fallback_engine]

    def _ocr_with_fallback(
        self, image_bgr: np.ndarray, *, lang: str, page_index: int, engines: list[OcrEngine]
    ) -> dict[str, object]:
        last_err: Exception | None = None
        for engine in engines:
            t0 = time.perf_counter()
            try:
                with observe_engine(engine.name):
                    res = engine.recognize(image_bgr, lang=lang, page_index=page_index)
                return {
                    "result": res,
                    "_engine_name": engine.name,
                    "_engine_ms": (time.perf_counter() - t0) * 1000.0,
                }
            except EngineUnavailableError as e:
                OCR_ENGINE_FAILURES_TOTAL.labels(engine=engine.name, error_type="unavailable").inc()
                last_err = e
                continue
            except OcrFailedError as e:
                OCR_ENGINE_FAILURES_TOTAL.labels(engine=engine.name, error_type="failed").inc()
                last_err = e
                continue

        raise OcrFailedError(f"All OCR engines failed: {last_err}") from last_err

