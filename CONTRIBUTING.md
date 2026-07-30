# Contributing

## 変更前の確認

- 変更対象を`apps`、`packages`、`services`のいずれかに限定してください。
- APIキー、実文書、ローカル生成物をコミットしないでください。
- 構造化データとOpenUIの参照整合性を緩める変更には、失敗ケースのテストを追加してください。

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
