# PolicyGOS

PolicyGOSは、政策評価PDFをOCRし、出典ページに結び付いた構造化データとして確認した後、確認済みデータだけからOpenUIの説明画面を生成するローカル優先のワークスペースです。

[サービス紹介サイト](https://ukyonagata0105.github.io/PolicyGOS/)

## 構成

- `services/document-ocr-adapter`: 既存Yomitoku系OCR APIを検査し、ページ・ブロック・表を共通形式へ変換します。
- `services/reportmeta`: OCR本文から`PolicyDataset v1`を抽出し、引用箇所がOCRページに実在するか検査します。
- `packages/policy-schema`: データ構造、参照整合性、確認履歴、JSON Schemaを管理します。
- `packages/policy-openui-library`: 許可した10種類のOpenUI部品と操作だけを公開します。
- `apps/policygos-openui`: PDF取込、根拠確認、履歴保存、出典PDF表示、説明生成、JSON・CSV・HTML出力を提供します。

ブラウザにはAPIキーを渡しません。`POLICYGOS_LOCAL_ONLY=true`の条件下では、ReportMetaからlocalhost以外のモデルAPIへ文書を送信できません。

## 初回準備

Node.js、pnpm、既存OCRサービスのPython環境、OpenAI互換APIを有効にしたLM Studioを用意します。

```bash
cd /Volumes/UNTITLED/Obsidian/Projects/PolicyGOS
pnpm install
cp .env.example .env
pnpm check
```

PlaywrightのChromiumが未導入の場合は、次を一度実行します。

```bash
pnpm exec playwright install chromium-headless-shell
```

## 起動

3つのターミナルでOCR、API、画面を順に起動します。

```bash
cd /Volumes/UNTITLED/Obsidian/Projects/PolicyGOS/document_ocr_api
PORT=8000 ./venv312/bin/python main.py
```

```bash
cd /Volumes/UNTITLED/Obsidian/Projects/PolicyGOS
set -a
source .env
set +a
pnpm build
node apps/policygos-openui/server-dist/index.js
```

```bash
cd /Volumes/UNTITLED/Obsidian/Projects/PolicyGOS
pnpm --filter @policygos/openui-app dev
```

画面は通常`http://127.0.0.1:5173`、APIは`http://127.0.0.1:8787`で待機します。

## 確認手順

`pnpm check`はlint、型検査、単体・統合テスト、本番ビルド、モック境界を使うChromium E2Eを実行します。E2EはPDF選択からOCR・構造化抽出を経て、根拠確認、PDF 2ページ目の表示、OpenUI生成、IndexedDBからの復元までを検査します。

gold setの定義、実測指標、旧版との同一入力比較は[`EVALUATION.md`](./EVALUATION.md)に記録しています。

OCR、LM Studio、ReportMeta、OpenUIを実サービスで通す場合は、OCRとAPIを起動した状態で次を実行します。

```bash
pnpm test:e2e:real
```

この実サービス検査は、PDFの2ページ取得、80%の目標値と76%の実績値、引用とページ本文の一致、文書IDの保持、OpenUI許可リストの通過を確認します。2026年7月31日のローカル検証では、LM Studioの`agents-a1-4b-oqe6`を使用しました。モデル名は環境に合わせて`OPENAI_MODEL`で指定してください。

ReportMetaとOpenUIでモデルを分ける場合は、構造化抽出用を`OPENAI_MODEL`、画面構成用を`OPENUI_MODEL`へ指定します。推論出力だけで本文を返さないモデルはOpenUI生成に適さないため、OpenUIには指示追従が速く、本文を返すモデルを選びます。

## 失敗時の判断

- OCRが失敗した場合: `http://127.0.0.1:8000/health`と`/formats`を確認します。
- ReportMetaが422を返す場合: モデル出力がスキーマ、文書ID、引用本文、値と根拠のいずれかを満たしていません。検証を外さず、モデルまたは抽出指示を調整します。
- OpenUIが409を返す場合: 根拠付きの値が確認済みまたは修正済みになっていません。
- 出典PDFを表示できない場合: 同じブラウザで元PDFを再度取り込みます。データセットとPDF原本はIndexedDBへ保存されます。

外部公開や複数利用者運用へ移す場合は、認証、テナント分離、監査ログのサーバー永続化、保存期間、バックアップを別途実装する必要があります。現在の構成は単一端末での確認作業を対象とします。
