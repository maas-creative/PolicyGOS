# Document OCR Backend

このbackendはPolicyGOS向けのdocument ingestion / OCR APIです。公開用CPUコンテナは`PyMuPDF + Tesseract（日本語）`を使い、PaddlePaddleを別途導入した環境ではPaddleOCRも利用できます。

## 役割

- born-digital PDF の高速抽出
- 画像 PDF / 画像入力の OCR
- normalized JSON / markdown / csv の返却
- frontend から利用する async job API の提供

## 抽出戦略

1. `PyMuPDF`
   - plain text
   - layout text
   - `page.find_tables()` による表候補
2. `PaddleOCR`
   - PaddlePaddleを導入した環境での画像入力とtext extraction fallback
3. `Tesseract`
   - 公開用CPUコンテナの画像入力とOCR fallback

## 必要条件

- Python 3.12
- `pip install -r requirements.txt`
- 推奨:

```bash
pip install paddlepaddle paddleocr 'paddlex[ocr]'
```

## 起動

```bash
python main.py
```

または:

```bash
PYTHONPATH=..:. uvicorn document_ocr_api.main:app --host 127.0.0.1 --port 8000
```

リポジトリ直下の公開構成ではOCRポートをホストへ公開せず、PolicyGOS APIからだけ接続します。`OCR_DEPLOYMENT=public`では`OCR_API_TOKEN`が必須となり、`/health`と`/ready`以外はBearer認証を要求します。単体の`docker-compose.yml`はローカル開発専用で、ポートをloopbackへだけ公開します。

## 主な endpoint

- `GET /health`
- `GET /ready`
- `GET /formats`
- `POST /analyze`
- `POST /analyze/async`
- `GET /jobs/{job_id}`

## JSON shape

`output_format=json` は normalized document shape を返します。

```json
{
  "schema_version": "ocr-backend-v1",
  "classification": "digital_text_pdf",
  "path_used": "pdf_text_fast_path",
  "engine": {
    "primary": "pymupdf",
    "ocr": "paddleocr"
  },
  "pages": [
    {
      "page_number": 1,
      "text": "...",
      "layout_text": "...",
      "text_blocks": [],
      "tables": []
    }
  ]
}
```

## 運用メモ

- `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`を使うとmodel host connectivity checkを短絡できます
- 初回の PaddleOCR / PP-Structure 系起動では model download が走ることがあります
- 外部URL取得は既定で無効です。有効化には`SOURCE_FETCH_ENABLED=true`と`SOURCE_FETCH_ALLOWED_HOSTS`の両方が必要です
