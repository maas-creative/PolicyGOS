# PolicyGOS

PolicyGOSは、政策評価PDFをOCRし、出典ページに結び付いた構造化データとして確認した後、確認済みデータだけからOpenUIの説明画面を生成するワークスペースです。ローカル実行と、認証・TLS・監査記録を備えた外部サーバー実行をサポートします。

[![CI](https://github.com/ukyonagata0105/PolicyGOS/actions/workflows/ci.yml/badge.svg)](https://github.com/ukyonagata0105/PolicyGOS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[サービス紹介サイト](https://ukyonagata0105.github.io/PolicyGOS/)

## 構成

- `services/document-ocr-adapter`: 既存Yomitoku系OCR APIを検査し、ページ・ブロック・表を共通形式へ変換します。
- `services/reportmeta`: OCR本文から`PolicyDataset v1`を抽出し、引用箇所がOCRページに実在するか検査します。
- `packages/policy-schema`: データ構造、参照整合性、確認履歴、JSON Schemaを管理します。
- `packages/policy-openui-library`: 許可した10種類のOpenUI部品と操作だけを公開します。
- `apps/policygos-openui`: PDF取込、根拠確認、履歴保存、出典PDF表示、説明生成、JSON・CSV・HTML出力を提供します。

ブラウザにはモデルAPIキーやOCR内部トークンを渡しません。`POLICYGOS_LOCAL_ONLY=true`の条件下では、ReportMetaからlocalhost以外のモデルAPIへ文書を送信できません。

## 技術的な位置づけ

PolicyGOSのGenerative UI実装は、ThesysがMIT Licenseで公開する[OpenUI](https://github.com/thesysdev/openui)の`@openuidev/react-lang`を依存パッケージとして利用し、政策評価向けの許可部品、参照検査、確認済みデータだけを渡す境界をこのリポジトリで実装しています。OpenUIのソースをこのリポジトリへ複製したフォークではありません。

`document_ocr_api`と`services/document-ocr-adapter`は、Yomitoku系APIとの互換性を維持しながら、PyMuPDF、Tesseract、利用可能な環境ではPaddleOCRを使うPolicyGOS独自のOCR境界です。`services/reportmeta`もこのリポジトリ固有の構造化抽出・引用検査実装であり、外部リポジトリのフォークとしては配布していません。

PolicyGOS本体は[MIT License](./LICENSE)です。依存パッケージとモデルにはそれぞれのライセンス、利用規約、データ保持条件が適用されます。

## ローカル実行

Node.js 22、pnpm 11、Python 3.12、OpenAI互換APIを有効にしたLM Studioを用意します。

```bash
git clone https://github.com/ukyonagata0105/PolicyGOS.git
cd PolicyGOS
pnpm install
cp .env.example .env
pnpm check
```

PlaywrightのChromiumが未導入の場合は、次を一度実行します。

```bash
pnpm exec playwright install chromium-headless-shell
```

3つのターミナルでOCR、API、画面を順に起動します。

```bash
cd document_ocr_api
python3.12 -m venv venv312
venv312/bin/python -m pip install -r requirements.txt
PORT=8000 ./venv312/bin/python main.py
```

```bash
set -a
source .env
set +a
pnpm build
node apps/policygos-openui/server-dist/index.js
```

```bash
pnpm --filter @policygos/openui-app dev
```

画面は通常`http://127.0.0.1:5173`、APIは`http://127.0.0.1:8787`で待機します。

## 外部サーバー実行

Docker Engine、Docker Compose、外部から80/443番へ到達できるLinuxサーバー、サーバーを指すドメインを用意します。CaddyがTLS証明書を取得するため、起動前にDNSを反映してください。

```bash
cp .env.production.example .env.production
openssl rand -hex 32
openssl rand -hex 32
```

生成した異なる値を、利用者用の`POLICYGOS_ACCESS_TOKENS`と内部OCR用の`OCR_API_TOKEN`へ設定します。モデル事業者、モデル名、APIキーも入力した後、秘密情報がGit管理外であることとCompose展開結果を確認します。

```bash
git check-ignore .env.production
docker compose --env-file .env.production config
docker compose --env-file .env.production build
```

公開操作の直前に次を実行します。

```bash
docker compose --env-file .env.production up -d
docker compose ps
curl -I "https://policygos.example.org/api/health"
```

最後のURLは設定した実ドメインへ置き換えます。利用者は管理者から個別に発行されたアクセストークンでログインします。トークンはブラウザメモリだけに置かれるため、再読み込み後は再入力が必要です。OCRはCompose内部だけで待機し、URL取得機能は既定で無効です。構成、保持、障害対応は[`docs/architecture/public-deployment.md`](./docs/architecture/public-deployment.md)を参照してください。

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
- 外部サーバーで401になる場合: 利用者トークンの発行対象と入力値を確認します。
- 外部サーバーで429になる場合: 1分間の利用者別上限に達しています。
- 外部サーバーで503になる場合: OCR同時実行上限に達しています。
- ReportMetaが422を返す場合: モデル出力がスキーマ、文書ID、引用本文、値と根拠のいずれかを満たしていません。検証を外さず、モデルまたは抽出指示を調整します。
- OpenUIが409を返す場合: 根拠付きの値が確認済みまたは修正済みになっていません。
- 出典PDFを表示できない場合: 同じブラウザで元PDFを再度取り込みます。データセットとPDF原本はIndexedDBへ保存されます。

外部サーバー版は複数の利用者資格と監査記録に対応しますが、文書ワークスペースは各ブラウザのIndexedDBに残ります。組織別テナント、サーバー上の文書共有、水平分散は現在の対象外です。
