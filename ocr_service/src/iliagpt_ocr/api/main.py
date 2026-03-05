from __future__ import annotations

import time
import uuid
from enum import Enum

import anyio
from fastapi import FastAPI, File, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from structlog.contextvars import bind_contextvars, clear_contextvars

from iliagpt_ocr.adapters.loaders.document_loader import PyMuPdfDocumentLoader
from iliagpt_ocr.adapters.ocr.paddle import PaddleOcrEngine
from iliagpt_ocr.adapters.ocr.tesseract import TesseractOcrEngine
from iliagpt_ocr.adapters.preprocessing.opencv_pipeline import OpenCvPreprocessor
from iliagpt_ocr.api.schemas import ErrorResponse, OcrResponse, OcrPageOut, TextBlockOut, BoundingBoxOut
from iliagpt_ocr.application.ocr_use_case import OcrRequest, OcrUseCase
from iliagpt_ocr.domain.errors import (
    EngineUnavailableError,
    FileTooLargeError,
    OcrError,
    OcrFailedError,
    TooManyPagesError,
    UnsupportedFileTypeError,
)
from iliagpt_ocr.infra.logging import configure_logging, get_logger
from iliagpt_ocr.infra.metrics import OCR_REQUEST_DURATION_SECONDS, OCR_REQUESTS_TOTAL, render_prometheus
from iliagpt_ocr.infra.settings import get_settings
from iliagpt_ocr.infra.version import __version__

_READ_CHUNK_BYTES = 1024 * 1024


async def _read_upload_limited(file: UploadFile, *, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise FileTooLargeError(f"File too large: {total} bytes (max {max_bytes})")
        chunks.append(chunk)
    return b"".join(chunks)


class EngineParam(str, Enum):
    auto = "auto"
    paddle = "paddle"
    tesseract = "tesseract"


def _to_response(result) -> OcrResponse:
    pages: list[OcrPageOut] = []
    for p in result.pages:
        blocks = []
        for b in p.blocks:
            bbox_out = None
            if b.bbox is not None:
                bbox_out = BoundingBoxOut(x1=b.bbox.x1, y1=b.bbox.y1, x2=b.bbox.x2, y2=b.bbox.y2)
            blocks.append(TextBlockOut(text=b.text, confidence=b.confidence, bbox=bbox_out))
        pages.append(
            OcrPageOut(
                page_index=p.page_index,
                engine=p.engine,
                engine_lang=p.engine_lang,
                text=p.text,
                avg_confidence=p.avg_confidence,
                blocks=blocks,
            )
        )

    return OcrResponse(
        engine=result.engine,
        lang=result.lang,
        text=result.text,
        avg_confidence=result.avg_confidence,
        pages=pages,
        timings_ms=result.timings_ms,
    )


def create_app(*, use_case_override: OcrUseCase | None = None) -> FastAPI:
    settings = get_settings()
    configure_logging(log_level=settings.log_level)
    log = get_logger(service="iliagpt-ocr", version=__version__)

    loader = PyMuPdfDocumentLoader(dpi=settings.dpi, max_pages=settings.max_pages)
    pre = OpenCvPreprocessor(
        enable_deskew=settings.enable_deskew,
        enable_denoise=settings.enable_denoise,
        enable_region_detect=settings.enable_region_detect,
    )
    primary = PaddleOcrEngine(use_angle_cls=settings.paddle_use_angle_cls)
    fallback = TesseractOcrEngine(oem=settings.tesseract_oem, psm=settings.tesseract_psm)
    use_case = use_case_override or OcrUseCase(
        loader=loader,
        preprocessor=pre,
        primary_engine=primary,
        fallback_engine=fallback,
        prefer_engine=settings.prefer_engine,
    )
    limiter = anyio.CapacityLimiter(settings.max_concurrent_requests)

    app = FastAPI(title="ILIAGPT OCR Service", version=__version__)

    @app.middleware("http")
    async def request_context_mw(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        try:
            resp = await call_next(request)
        finally:
            duration = time.perf_counter() - start
            OCR_REQUEST_DURATION_SECONDS.labels(endpoint=request.url.path, method=request.method).observe(duration)

            engine = getattr(resp, "headers", {}).get("x-ocr-engine", "n/a") if "resp" in locals() else "n/a"
            status_code = getattr(resp, "status_code", 500) if "resp" in locals() else 500
            OCR_REQUESTS_TOTAL.labels(
                endpoint=request.url.path,
                method=request.method,
                status_code=str(status_code),
                engine=str(engine),
            ).inc()

            log.info(
                "http_request",
                method=request.method,
                path=request.url.path,
                status=int(status_code),
                engine=str(engine),
                duration_ms=round(duration * 1000.0, 2),
            )
            clear_contextvars()

        resp.headers["x-request-id"] = request_id
        return resp

    @app.exception_handler(OcrError)
    async def ocr_error_handler(request: Request, exc: OcrError):
        request_id = getattr(request.state, "request_id", None)

        status = 500
        if isinstance(exc, (UnsupportedFileTypeError,)):
            status = 415
        elif isinstance(exc, (TooManyPagesError,)):
            status = 413
        elif isinstance(exc, (FileTooLargeError,)):
            status = 413
        elif isinstance(exc, (EngineUnavailableError,)):
            status = 503
        elif isinstance(exc, (OcrFailedError,)):
            status = 500

        log.warning("ocr_error", path=request.url.path, method=request.method, status=status, err=str(exc))
        return JSONResponse(
            status_code=status,
            content=ErrorResponse(error=exc.__class__.__name__, detail=str(exc), request_id=request_id).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", None)
        status = 500
        log.error("unhandled_error", path=request.url.path, method=request.method, status=status, err=str(exc))
        return JSONResponse(
            status_code=status,
            content=ErrorResponse(error="InternalServerError", detail="Unhandled error", request_id=request_id).model_dump(),
        )

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "service": "iliagpt-ocr", "version": __version__}

    @app.get("/readyz")
    async def readyz():
        engines = {
            primary.name: bool(getattr(primary, "is_available", lambda: False)()),
            fallback.name: bool(getattr(fallback, "is_available", lambda: False)()),
        }
        ok = any(engines.values())
        status = 200 if ok else 503
        return JSONResponse(status_code=status, content={"ok": ok, "service": "iliagpt-ocr", "version": __version__, "engines": engines})

    @app.get("/v1/engines")
    async def engines():
        engines = {
            primary.name: {"available": bool(getattr(primary, "is_available", lambda: False)())},
            fallback.name: {"available": bool(getattr(fallback, "is_available", lambda: False)())},
        }
        return {"engines": engines}

    @app.get("/metrics")
    async def metrics():
        body, content_type = render_prometheus()
        return Response(content=body, media_type=content_type)

    @app.post("/v1/ocr", response_model=OcrResponse)
    async def ocr(
        request: Request,
        response: Response,
        file: UploadFile = File(...),
        lang: str | None = Query(default=None, description="Engine language (e.g., eng, spa, latin)"),
        engine: EngineParam = Query(default=EngineParam.auto, description="auto|paddle|tesseract"),
    ):
        max_bytes = int(settings.max_file_size_mb) * 1024 * 1024
        if settings.api_key:
            auth = request.headers.get("authorization", "")
            token = ""
            if auth.lower().startswith("bearer "):
                token = auth.split(" ", 1)[1].strip()
            token = token or request.headers.get("x-api-key", "")
            if token != settings.api_key:
                return JSONResponse(
                    status_code=401,
                    content=ErrorResponse(
                        error="Unauthorized",
                        detail="Missing or invalid API key",
                        request_id=getattr(request.state, "request_id", None),
                    ).model_dump(),
                    headers={"x-request-id": getattr(request.state, "request_id", "")},
                )

        content = await _read_upload_limited(file, max_bytes=max_bytes)

        req = OcrRequest(
            content=content,
            filename=file.filename,
            content_type=file.content_type,
            lang=(lang or settings.default_lang),
            engine=str(engine.value),
            dpi=settings.dpi,
        )

        result = await anyio.to_thread.run_sync(use_case.run, req, limiter=limiter)
        response.headers["x-ocr-engine"] = result.engine
        return _to_response(result)

    log.info("app_ready", host=settings.host, port=settings.port)
    return app


app = create_app()
