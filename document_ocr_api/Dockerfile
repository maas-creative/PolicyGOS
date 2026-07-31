FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libgl1 \
    tesseract-ocr \
    tesseract-ocr-jpn \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

ENV PYTHONPATH=/app:/app/document_ocr_api

COPY . /app/document_ocr_api

RUN groupadd --system policygos \
    && useradd --system --gid policygos --home-dir /app policygos \
    && mkdir -p /app/document_ocr_api/uploads /app/document_ocr_api/logs \
    && chown -R policygos:policygos /app

USER policygos
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "document_ocr_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
