# Contributing

## 変更前の確認

- 変更対象と影響範囲を、`apps`、`packages`、`services`、`document_ocr_api`、`docs`のいずれかとしてPull Requestに記載してください。
- APIキー、実文書、ローカル生成物をコミットしないでください。
- 構造化データとOpenUIの参照整合性を緩める変更には、失敗ケースのテストを追加してください。
- 外部公開境界を変更する場合は、認証、容量制限、監査記録、OCRのネットワーク分離への影響を記載してください。

## ローカル検証

```bash
pnpm install
pnpm check
```

OCRとモデル接続へ影響する変更では、OCRサービスとPolicyGOS APIを起動して次も実行します。

```bash
pnpm test:e2e:real
```

Pull Requestには、利用者への影響、必要な環境変数、実行した検証コマンドを記載してください。

公開構成へ影響する変更では、次の構成検査も実行してください。

```bash
docker compose --env-file .env.production.example config --quiet
```
