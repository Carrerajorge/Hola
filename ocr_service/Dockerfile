FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps:
# - tesseract-ocr: fallback engine (Tesseract 5 + LSTM)
# - libgomp1: required by PaddlePaddle CPU wheels
# - libgl1/libglib2.0-0: common runtime deps for OpenCV wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-spa \
      curl \
      fonts-dejavu-core \
      libgomp1 \
      libgl1 \
      libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app/ocr_service

COPY ocr_service/pyproject.toml ocr_service/README.md ocr_service/run_api.py ./
COPY ocr_service/src ./src

RUN python -m pip install --upgrade pip && \
    pip install -e ".[paddle]"

EXPOSE 8000

CMD ["uvicorn", "iliagpt_ocr.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
