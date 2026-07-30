# PolicyGOS V1 評価記録

## 評価対象

2026年7月31日に、`fixtures/policy-documents/walking-skeleton-policy-evaluation.pdf`を入力として評価した。期待結果は`walking-skeleton.gold.json`に固定し、PDF本文、期待値、抽出結果を別々に保持している。

評価対象の主要事実は、事業名「地域移動支援事業」、成果指標「公共交通利用者満足度」、令和7年度の目標値80%、実績値76%である。目標値の根拠ページは1ページ、実績値の根拠ページは2ページとした。

## 再実行

全自動ゲートは次のコマンドで実行する。

```bash
pnpm check
```

既存OCR、LM Studio、PolicyGOS APIを起動した実provider評価は次のコマンドで実行する。

```bash
pnpm test:e2e:real
```

保存済みのPolicyDatasetだけをgold setと比較する場合は次を使う。

```bash
pnpm evaluate:gold -- path/to/policy-dataset.json
```

## 新実装の実測結果

実provider E2Eでは、OCRに既存`document_ocr_api`、ReportMetaにLM Studioの`agents-a1-4b-oqe6`、OpenUI構成に`qwen/qwen3.6-27b`を使用した。費用はローカルproviderから金額情報が返らないため`null`として記録し、0円とはみなしていない。

| 指標 | 結果 |
|---|---:|
| field exact match | 1.00 |
| precision | 1.00 |
| recall | 1.00 |
| F1 | 1.00 |
| evidence page一致率 | 1.00 |
| evidence quote包含率 | 1.00 |
| 年度一致率 | 1.00 |
| 単位一致率 | 1.00 |
| schema validation失敗率 | 0 / 1 |
| OpenUI component validation成功率 | 1 / 1 |
| 実PDF E2E成功率 | 1 / 1 |
| human correction率 | 未測定 |
| OCR処理時間 | 51 ms |
| ReportMeta往復時間 | 5,545 ms |
| OpenUI生成時間 | 5,598 ms |
| E2E全体 | 11,216 ms |

human correction率は、自動E2Eが確認操作を再現する検査であり、実利用者の判断を測定していないため数値化していない。初回表示時間もAPI単体試験では測定せず、OCR、ReportMeta、OpenUI、全体の処理時間を`test:e2e:real`の実行結果へ出力する。

## 旧版との同一入力比較

旧`policyevaluationGOS`は削除前の状態をmacOSのゴミ箱へ退避し、同じwalking-skeleton PDFを旧版の画面から入力した。旧版は`pdf_text_fast_path / image_pdf`として処理を完了し、本文プレビュー内には80%と76%が表示された。一方、画面上の事業件数は0件であり、目標値と実績値を年度、単位、ページ、原文引用に結び付けた確認対象は生成されなかった。

| 比較項目 | 旧版 | 新実装 |
|---|---|---|
| PDF本文の表示 | 可能 | 可能 |
| 事業の構造化 | 0件 | 1件 |
| 目標値・実績値の役割分離 | 確認できず | 80%をtarget、76%をactualとして保持 |
| 値から根拠ページ・引用への参照 | 確認できず | 2値とも一致 |
| 公開前の確認状態 | 値単位では確認できず | unreviewedから確認・修正・却下 |
| 生成UIの制約 | 旧runtime固有 | OpenUI component allowlistで検証 |

旧版の実PDF E2EはGemini APIキーを必須としていたため、ローカルproviderだけを使う新実装とprovider条件を一致させた生成品質比較は行っていない。したがって、この表は同一PDFに対する観察可能なデータ契約と確認フローの比較であり、モデル性能の比較ではない。

## 判定

walking-skeletonの範囲では、PDF取込、OCR、構造化、根拠照合、人による確認、許可されたOpenUI生成、出典表示、ブラウザ保存までを旧版なしで完遂できる。外部公開または複数利用者運用へ進む条件では、認証、テナント分離、サーバー側監査ログ、保存期間、バックアップを追加のリリースゲートとする。
