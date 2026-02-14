# ILIAGPT OCR Service

Python + FastAPI microservice providing OCR for images and scanned PDFs.

- Primary engine: PaddleOCR (when installed, typically in Linux production images)
- Fallback engine: Tesseract 5 (via `pytesseract`)
- Preprocessing: OpenCV (deskew, denoise, adaptive binarization, region detection, DPI normalization)
- Observability: structured logs + Prometheus `/metrics`

## API

- `GET /healthz`
- `GET /metrics`
- `POST /v1/ocr` (multipart upload)

Example:

```bash
curl -sS -F file=@/path/to/doc.png "http://localhost:8000/v1/ocr?lang=eng&engine=auto"
```

## Env Vars

All settings are prefixed with `OCR_`:

- `OCR_HOST` (default: `0.0.0.0`)
- `OCR_PORT` (default: `8000`)
- `OCR_PREFER_ENGINE` (`paddle|tesseract|auto`, default: `auto`)
- `OCR_DEFAULT_LANG` (default: `eng`)
- `OCR_DPI` (default: `300`)
- `OCR_MAX_PAGES` (default: `10`)
- `OCR_MAX_FILE_SIZE_MB` (default: `15`)
- `OCR_ENABLE_DESKEW` (default: `true`)
- `OCR_ENABLE_DENOISE` (default: `true`)
- `OCR_ENABLE_REGION_DETECT` (default: `true`)

## Local Dev

System deps (macOS):

```bash
brew install tesseract
```

Python:

```bash
uv venv --python 3.11
source .venv/bin/activate
uv pip install -e ".[dev]"
uvicorn iliagpt_ocr.api.main:app --reload --port 8000
```

## Tests

```bash
pytest
```

## Docker

Build and run:

```bash
docker build -f ocr_service/Dockerfile -t iliagpt-ocr:local .
docker run --rm -p 8000:8000 iliagpt-ocr:local
```
