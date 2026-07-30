# PolicyGOS Next 実装計画

## 1. 目的

PolicyGOS Nextは、行政・政策関連PDFから根拠付きの政策データを抽出し、人が確認した内容だけを使って、質問と利用者に応じた対話的な説明画面を生成する。

実装中は既存PolicyGOSを比較・回帰確認の対象として維持し、新規実装を`policygos-next/`内で独立して進める。すべての検証ゲートを通過した後は新実装をリポジトリ直下へ昇格し、旧フロントエンドを削除する。既存OCRバックエンドは再実装せず、Yomitokuを含む既存の文書解析結果を新しいadapterから利用する。

## 2. 用語と責務

| 用語 | 区分 | この計画で指す対象 | 担当しないこと |
|---|---|---|---|
| OCR | 確立語 | PDF・画像からページ、文字列、座標、表を取得する処理 | 政策上の意味判断、UI生成 |
| ReportMeta | ユーザー定義名 | OCR結果と関連文書から、政策・事業・指標・値・根拠を構造化する新サービス | PDF表示、対話画面の生成 |
| PolicyDataset | プロジェクト内のデータ契約 | 文書、政策、事業、指標、値、証拠、確認状態を保持するデータ | OpenUI固有のレイアウト |
| OpenUI | OpenUIプロジェクトの用語 | 許可されたコンポーネントから、LLM出力をストリーミング表示する基盤 | OCR、政策値の推測、永続データの基準形式 |
| PolicyGOS OpenUI | プロジェクト内のアプリ名 | PDF投入、確認・修正、質問、生成UI、出典表示を提供する新アプリ | OCRエンジンの実装 |

## 3. 採用する構成

処理順序を以下に固定する。

1. 利用者がPDFと質問をPolicyGOS OpenUIへ入力する。
2. document-ocr-adapterが既存OCRバックエンドへPDFを送る。
3. OCRバックエンドがページ、文字列、座標、表、抽出方式を返す。
4. ReportMetaがOCR結果と関連文書をPolicyDatasetへ変換する。
5. PolicyGOS OpenUIが抽出値と根拠を確認・修正する画面を表示する。
6. 確認済みデータと質問をOpenUI生成処理へ渡す。
7. LLMが許可されたPolicyGOS専用コンポーネントだけを生成する。
8. 各表示値から出典文書、ページ、原文を開けるようにする。

OpenUIの生成結果をPolicyDatasetの保存形式にせず、抽出データと表示仕様を分離する。

## 4. リポジトリ構成

- `apps/policygos-openui/`: 利用者向けアプリ
- `services/reportmeta/`: 政策データ抽出サービス
- `services/document-ocr-adapter/`: 既存OCRとの接続
- `packages/policy-schema/`: 共有データ契約
- `packages/policy-openui-library/`: PolicyGOS専用OpenUI部品
- `fixtures/policy-documents/`: 実PDFと期待結果
- `tests/e2e/`: サービスを横断するE2E

### 4.1 `apps/policygos-openui`

- PDFアップロード
- 処理状況表示
- 抽出結果の確認・修正
- 質問と対象読者の入力
- OpenUI Langのストリーミング受信
- PolicyGOS専用コンポーネントの表示
- 出典ページの表示
- JSON、CSV、HTMLの出力

### 4.2 `services/reportmeta`

- OCR結果の受け取り
- 文書種別の判定
- 複数文書の統合
- 政策、計画、事業、指標、予算の抽出
- 計画値、目標値、実績値の区別
- 年度、単位、対象範囲の正規化
- 各値とページ、原文、座標の結合
- 文書間の矛盾と要確認項目の生成
- PolicyDatasetの検証と返却
- provider、モデル、トークン、費用、処理時間の記録

### 4.3 `services/document-ocr-adapter`

- 既存OCRバックエンドのidentity確認
- ファイル拡張子、MIME type、magic bytesの検証
- 同期・非同期job APIの差を吸収
- OCRレスポンスをReportMeta入力形式へ変換
- timeout、cancel、再試行、エラー分類
- OCRエンジンや抽出方式の記録

### 4.4 `packages/policy-schema`

- PolicyDatasetのZodスキーマ
- JSON Schema生成
- API request／response型
- schema version
- migration関数
- fixture builder

### 4.5 `packages/policy-openui-library`

- PolicyGOS専用OpenUIコンポーネント
- 各component propsのZodスキーマ
- component libraryから生成するLLM指示
- action定義
- 出典表示と確認状態の共通表示

## 5. PolicyDataset v1

PolicyDataset v1は少なくとも次を保持する。

### 5.1 文書

- document ID
- file name
- title
- municipality
- document type
- page count
- extraction method
- schema version

### 5.2 証拠

- evidence ID
- document ID
- page number
- quote
- bounding box
- table ID、row、column
- extraction method
- OCR confidence

### 5.3 政策・事業

- policy／project ID
- 名称
- 概要
- 担当部局
- 対象者
- 対象地域
- 実施期間
- 予算・決算
- evidence IDs

### 5.4 指標と値

- indicator ID
- 活動指標／成果指標
- 指標名
- 基準値／計画値／目標値／実績値
- 年度
- 単位
- 分母・集計範囲
- evidence IDs
- confidence
- review status

`review status`は`unreviewed`、`confirmed`、`corrected`、`rejected`の4状態とし、OpenUIの断定的な数値表示には`confirmed`または`corrected`かつ有効な証拠を持つ値だけを渡す。

## 6. ReportMetaの抽出方式

ReportMetaは、[`surveyMeta`](https://github.com/ShoFujihara/surveyMeta)の次の設計を政策文書向けに置き換える。

- 固定スキーマへの構造化出力
- 統制語彙
- 値ごとの原文引用とページ番号
- 複数文書の同時入力
- provider別adapter
- token、費用、処理時間の計測
- gold setとの比較

JDCat、DDI、CESSDA向けフィールドはPolicyDatasetへ置き換え、ReportMetaから社会調査用メタデータを出力する機能はV1の対象外とする。

### 6.1 抽出ステップ

1. OCR結果をページ単位で正規化する。
2. 文書種別と文書間の関係を判定する。
3. 候補となる事業、指標、値、単位、年度を抽出する。
4. 候補ごとに根拠箇所を割り当てる。
5. JSON Schemaによる構造検証を行う。
6. 参照切れ、単位欠落、年度不明、値の競合を検出する。
7. review itemを生成する。
8. PolicyDatasetとして返す。

### 6.2 provider

V1では次を同じinterfaceの後ろに実装する。

- Gemini
- OpenAI互換API
- OllamaまたはLM Studio

providerがJSON Schemaによる厳密な構造化出力に対応する場合は、その機能を利用する。対応しない場合は、受信後のZod検証に失敗した結果を成功として扱わない。

## 7. PolicyGOS専用OpenUIコンポーネント

最初のcomponent libraryは以下に限定する。

| Component | 用途 |
|---|---|
| `PolicySummary` | 政策・計画の概要 |
| `ProjectList` | 事業一覧 |
| `MetricComparison` | 計画値、目標値、実績値の比較 |
| `MetricTrend` | 年度推移 |
| `BudgetBreakdown` | 予算・決算の内訳 |
| `EvidenceQuote` | 原文、文書名、ページ |
| `ReviewWarning` | 未確認値、矛盾、根拠欠落 |
| `SourceLink` | 出典ページを開く操作 |
| `AudienceExplanation` | 住民、職員、議員、研究者向け説明 |
| `FollowUpActions` | 次の質問と表示切替 |

これらの名称はPolicyGOS内のcomponent名であり、OpenUIが定める標準名称ではない。

### 7.1 OpenUI action

V1で許可するactionを次に限定する。

- 出典を開く
- 表示対象年度を変更する
- 事業を絞り込む
- 説明対象を変更する
- 確認画面へ移動する
- JSON／CSVを保存する

生成された任意JavaScript、任意URL、外部送信、データ削除をactionとして実行しない。

## 8. Walking Skeleton

最初の縦一本は次の一事例に限定する。

> 一つの政策評価PDFを投入し、事業名、成果指標、目標値、実績値をページ・原文付きで抽出し、人が確認した後、OpenUIの`MetricComparison`と`EvidenceQuote`で表示する。

この縦一本の合格条件は以下とする。

- PDFが既存OCRバックエンドで処理される。
- ReportMetaがPolicyDataset v1を返す。
- 抽出された目標値と実績値にページと原文がある。
- 根拠がない値は確認済みにできない。
- 確認済みの値だけがOpenUIへ渡る。
- OpenUIが許可component以外を表示しない。
- 表示値から出典ページを確認できる。
- 同じfixtureで自動テストを再実行できる。

## 9. 実装段階

### Phase 0: workspace初期化

- npm workspaceまたはpnpm workspaceを設定する。
- TypeScript、React、Vitest、Playwright、ESLintを設定する。
- `.env.example`を用意し、秘密情報を含めない。
- package間の依存方向を固定する。

完了条件:

- 全packageのtype-check、test、buildをルートコマンドで実行できる。

### Phase 1: PolicyDataset契約

- `policy-schema`にZodスキーマを実装する。
- JSON Schemaを生成する。
- schema versionとmigration方針を定義する。
- 正常・異常fixtureを作成する。

完了条件:

- 不明なdocument ID、evidence ID、重複ID、根拠のない確認済み値を拒否する。
- TypeScript型と実行時検証が同一スキーマから生成される。

### Phase 2: OCR adapter

- 既存OCRバックエンドのidentityを検証する。
- PDF upload、job polling、cancelを実装する。
- OCR出力をReportMeta入力へ変換する。
- page、block、table、coordinateを失わず受け渡す。

完了条件:

- 実PDF fixtureから同じ正規化OCR JSONを再現できる。
- 誤ったbackendへ接続した場合は処理を開始しない。

### Phase 3: ReportMeta

- provider interfaceを実装する。
- PolicyDataset JSON Schemaを構造化出力へ渡す。
- 証拠参照、統制語彙、review itemを実装する。
- 複数文書入力を実装する。
- provider、model、費用、時間を記録する。

完了条件:

- Walking Skeletonのfixtureで事業、指標、目標値、実績値、根拠を抽出できる。
- schema違反、参照切れ、LLM refusalを成功として返さない。

### Phase 4: 確認・修正UI

- 抽出値と原文を並べて表示する。
- confirmed、corrected、rejectedを操作できる。
- 修正前後の値と操作者の判断を保存する。
- 未確認項目の残数を表示する。

完了条件:

- 値を確認または却下するまで公開用表示へ渡らない。
- 修正履歴から元の抽出値を復元できる。

### Phase 5: OpenUI component library

- component propsをZodで定義する。
- ReportMetaの値を参照するdata bindingを定義する。
- `MetricComparison`、`EvidenceQuote`、`ReviewWarning`を実装する。
- libraryからLLM指示を生成する。

完了条件:

- 未登録componentと不正propsを拒否する。
- OpenUI出力がPolicyDatasetの値を複製せずIDで参照する。

### Phase 6: OpenUIアプリ

- prompt-first composerを実装する。
- OpenUI Langをストリーミング受信する。
- follow-up時に会話と表示状態を継承する。
- browser、fullscreen、exportを実装する。

完了条件:

- Walking Skeletonを画面上で最初から最後まで実行できる。
- ストリーム中断時に不完全な画面を確定結果として保存しない。

### Phase 7: 評価と移行

- 実PDF gold setを作成する。
- 旧PolicyGOSとPolicyGOS Nextを同じ入力で比較する。
- 抽出精度、証拠一致、失敗率、処理時間、費用を記録する。
- 配布ビルドと実PDF E2Eを実行する。

完了条件:

- V1の全E2Eが通る。
- P0/P1不具合が0件である。
- 旧版を参照しなくても主要フローを完遂できる。

## 10. 評価指標

### 10.1 ReportMeta

- field exact match
- precision、recall、F1
- evidence page一致率
- evidence quote包含率
- 年度・単位一致率
- schema validation失敗率
- human correction率
- provider別の処理時間と費用

### 10.2 OpenUI

- component validation成功率
- 初回表示までの時間
- ストリーム完了時間
- 根拠リンク欠落率
- 未確認値の表示件数
- follow-up後の状態保持率
- 実PDF E2E成功率

モデルの一般ベンチマークではなく、PolicyGOSの実PDF fixtureで比較する。

## 11. セキュリティとデータ経路

- PDFは信頼できない入力として扱う。
- upload時に拡張子、MIME type、magic bytesを検証する。
- API keyをブラウザへ渡さない。
- providerへ送る文書と保持期間を設定画面で明示する。
- ローカル処理を選択した場合は外部providerへ文書を送らない。
- OCR文書内の命令をsystem instructionとして実行しない。
- OpenUI actionをallowlistで制御する。
- 任意HTMLと任意JavaScriptを実行しない。
- ログへPDF本文、API key、個人情報を無制限に記録しない。

## 12. 既存実装との関係

既存資産は以下の用途に限定して利用する。

- `document_ocr_api/`: OCRサービスとして利用
- `policyevaluationGOS/public/`と`tests/fixtures/`: fixture候補
- 既存E2E: 期待する利用者フローの比較
- `policyevaluationGOS/src/policy-core/`: 新スキーマ検討時の参考

新しいOpenUIアプリから既存`App.tsx`、`ViewPlanV2`、prompt-to-HTML runtimeをimportしない。既存画面のCSSやstate構造も自動移植せず、必要な利用者行動だけを確認して再実装する。

## 13. 重要な設計判断

| 判断 | 採用内容 | 再検討条件 |
|---|---|---|
| OCR | 既存サービスを継続利用 | 実PDF gold setで必要情報を取得できない |
| ReportMeta | 新規サービスとして分離 | 抽出が単純な同期関数で完結し、独立運用が不要になる |
| PolicyDataset | OpenUIから独立したZod契約 | 外部標準が必要項目と証拠モデルを満たす |
| OpenUI | 表示・対話の中心として採用 | Walking Skeletonで構文失敗率や保守負担が許容範囲を超える |
| 任意HTML | V1の生成経路では不採用 | sandbox、CSP、検証方法を含む別の要件が確定する |
| 開発単位 | 一つのworkspaceで開始 | ReportMetaを独立配布する段階に到達する |

## 14. 未確定事項

次の項目はWalking Skeletonを妨げないため、初期実装と並行して決定する。

- npm workspaceとpnpm workspaceの選択
- ReportMetaのHTTP framework
- PolicyDatasetと確認履歴の保存先
- 外部providerの既定値
- Web版を先行するかElectron shellまで同時に作るか
- ReportMetaを`surveyMeta`のGitHub forkとして公開するか、履歴と帰属を保持した別実装として公開するか

GitHub上のfork作成や新規リポジトリ公開は、送信先と内容を確認した後に別途実行する。

## 15. 最初の実装バッチ

次の順序で着手する。

1. workspace設定
2. `policy-schema`のPolicyDataset v1
3. 正常・異常fixture
4. OCR backend identity client
5. OCRレスポンスの正規化
6. ReportMeta provider interface
7. 一つの実PDFによるWalking Skeleton
8. `MetricComparison`と`EvidenceQuote`
9. 確認画面
10. end-to-end test

最初の成果物は画面の外観ではなく、同一fixtureに対してOCR、ReportMeta、確認、OpenUI表示までを自動再現できる縦一本とする。

## 16. 参照した内容

内容根拠:

- [`../README.md`](../README.md): 現行PolicyGOSの目的、利用者、主要フロー
- [`../document_ocr_api/README.md`](../document_ocr_api/README.md): 既存OCRバックエンドの役割と出力
- [`ShoFujihara/surveyMeta`](https://github.com/ShoFujihara/surveyMeta): 構造化メタデータ、統制語彙、証拠、複数文書、評価の設計
- [`thesysdev/openui`](https://github.com/thesysdev/openui): component library、OpenUI Lang、ストリーミングrenderer

文体:

- 実装者が順序、境界、完了条件を判断できる簡潔な技術計画
