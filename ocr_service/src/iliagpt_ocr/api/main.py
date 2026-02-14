from __future__ import annotations

import uuid

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
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


def _to_response(result) -> OcrResponse:
    pages: list[OcrPageOut] = []
    for p in result.pages:
        blocks = []
        for b in p.blocks:
            bbox_out = None
            if b.bbox is not None:
                bbox_out = BoundingBoxOut(x1=b.bbox.x1, y1=b.bbox.y1, x2=b.bbox.x2, y2=b.bbox.y2)
            blocks.append(TextBlockOut(text=b.text, confidence=b.confidence, bbox=bbox_out))
        pages.append(OcrPageOut(page_index=p.page_index, text=p.text, avg_confidence=p.avg_confidence, blocks=blocks))

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
    configure_logging()
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

    app = FastAPI(title="ILIAGPT OCR Service", version=__version__)

    @app.middleware("http")
    async def request_context_mw(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        bind_contextvars(request_id=request_id)
        try:
            with OCR_REQUEST_DURATION_SECONDS.labels(endpoint=request.url.path, method=request.method).time():
                resp = await call_next(request)
        finally:
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

        OCR_REQUESTS_TOTAL.labels(
            endpoint=request.url.path,
            method=request.method,
            status_code=str(status),
            engine="n/a",
        ).inc()

        log.warning("ocr_error", path=request.url.path, method=request.method, status=status, err=str(exc))
        return JSONResponse(
            status_code=status,
            content=ErrorResponse(error=exc.__class__.__name__, detail=str(exc), request_id=request_id).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", None)
        status = 500
        OCR_REQUESTS_TOTAL.labels(
            endpoint=request.url.path,
            method=request.method,
            status_code=str(status),
            engine="n/a",
        ).inc()
        log.error("unhandled_error", path=request.url.path, method=request.method, status=status, err=str(exc))
        return JSONResponse(
            status_code=status,
            content=ErrorResponse(error="InternalServerError", detail="Unhandled error", request_id=request_id).model_dump(),
        )

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "service": "iliagpt-ocr", "version": __version__}

    @app.get("/metrics")
    async def metrics():
        body, content_type = render_prometheus()
        return Response(content=body, media_type=content_type)

    @app.post("/v1/ocr", response_model=OcrResponse)
    async def ocr(
        request: Request,
        file: UploadFile = File(...),
        lang: str | None = Query(default=None, description="Engine language (e.g., eng, spa, latin)"),
        engine: str = Query(default="auto", description="auto|paddle|tesseract"),
    ):
        content = await file.read()
        max_bytes = int(settings.max_file_size_mb) * 1024 * 1024
        if len(content) > max_bytes:
            raise FileTooLargeError(f"File too large: {len(content)} bytes (max {max_bytes})")

        req = OcrRequest(
            content=content,
            filename=file.filename,
            content_type=file.content_type,
            lang=(lang or settings.default_lang),
            engine=engine,
            dpi=settings.dpi,
        )

        result = await run_in_threadpool(use_case.run, req)

        OCR_REQUESTS_TOTAL.labels(
            endpoint=request.url.path,
            method=request.method,
            status_code="200",
            engine=result.engine,
        ).inc()

        return _to_response(result)

    log.info("app_ready", host=settings.host, port=settings.port)
    return app


app = create_app()
