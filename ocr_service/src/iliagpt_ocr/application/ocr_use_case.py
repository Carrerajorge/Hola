from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from iliagpt_ocr.domain.errors import EngineUnavailableError, OcrFailedError
from iliagpt_ocr.domain.lang import ResolvedLanguage, resolve_language
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
        lang = resolve_language(req.lang)

        page_results: list[OcrPageResult] = []
        preprocess_ms_total = 0.0
        engine_ms_total = 0.0
        disabled: set[str] = set()

        for idx, img in enumerate(pages):
            img_pp, pp_ms = self._preprocess(img, dpi=req.dpi)
            preprocess_ms_total += pp_ms

            page_res, page_engine_ms = self._ocr_with_fallback(
                img_pp, lang=lang, page_index=idx, engines=engines, disabled=disabled
            )
            engine_ms_total += page_engine_ms
            page_results.append(page_res)

        timings_ms["preprocess_ms"] = preprocess_ms_total
        timings_ms["engine_ms"] = engine_ms_total
        timings_ms["total_ms"] = (time.perf_counter() - t0) * 1000.0

        full_text = "\n\n".join([p.text for p in page_results]).strip()
        confidences = [p.avg_confidence for p in page_results if p.avg_confidence is not None]
        avg_conf = (sum(confidences) / len(confidences)) if confidences else None
        engines_used = {p.engine for p in page_results}
        engine_out = next(iter(engines_used)) if len(engines_used) == 1 else "mixed"

        return OcrResult(
            engine=engine_out,
            lang=lang.requested,
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

    def _lang_for_engine(self, engine: OcrEngine, lang: ResolvedLanguage) -> str:
        if engine.name == "paddle":
            return lang.paddle
        if engine.name == "tesseract":
            return lang.tesseract
        return lang.requested

    def _ocr_with_fallback(
        self,
        image_bgr: np.ndarray,
        *,
        lang: ResolvedLanguage,
        page_index: int,
        engines: list[OcrEngine],
        disabled: set[str],
    ) -> tuple[OcrPageResult, float]:
        last_err: Exception | None = None
        for engine in engines:
            if engine.name in disabled:
                continue
            t0 = time.perf_counter()
            try:
                engine_lang = self._lang_for_engine(engine, lang)
                with observe_engine(engine.name):
                    res = engine.recognize(image_bgr, lang=engine_lang, page_index=page_index)
                return res, (time.perf_counter() - t0) * 1000.0
            except EngineUnavailableError as e:
                OCR_ENGINE_FAILURES_TOTAL.labels(engine=engine.name, error_type="unavailable").inc()
                disabled.add(engine.name)
                last_err = e
                continue
            except OcrFailedError as e:
                OCR_ENGINE_FAILURES_TOTAL.labels(engine=engine.name, error_type="failed").inc()
                # If an engine is failing consistently, avoid retrying it on every page.
                disabled.add(engine.name)
                last_err = e
                continue

        raise OcrFailedError(f"All OCR engines failed: {last_err}") from last_err
