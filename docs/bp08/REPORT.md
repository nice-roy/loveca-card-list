# BP08「まじかる♡とり～と」追加 — 2026-11-14

## 確定事項

- 基準main: `499f2cff6abc6eba15a9641c33f891e96f74e730`。既存1913版を全フィールド・ID・順序ごと保全。
- 公式一覧172件（100件＋72件）をID・完全カード番号で照合。メンバー108版・ライブ33版、計141版を追加。エネルギー31版は対象外。
- 追加後2054版（メンバー1690、ライブ364）。同一ゲームカード1271種類。新規レアリティはP 29、N 29、L 21、R 19、SECL 12、R+ 11、P+ 10、SEC 10。
- 商品略号は `BP8｜ブースターパック まじかる♡とり～と`。商品ID `product:1141b059d897`。
- 公式詳細の `group_name` に従い、3人組「矢澤にこ&宮下 愛&セラス 柳田 リリエンフェルト」はμ's・虹ヶ咲・蓮ノ空のすべてに所属。学年・ユニットを推測せず複数メンバー分類。
- カードラボ個別購入リンク141版を確認。既存1020リンクを保持し、計1161リンク。価格・在庫は保存しない。
- `PL!-bp8-020-L` と `PL!-bp8-025-L` はカードラボの曲名で♡が？になっている。前者は波ダッシュも異なる。個別ページの完全番号・レアリティ・その他の曲名が一致した2版だけを、明示的な名前例外として監査記録に保存。一般的な曖昧一致は導入していない。
- Snow halationの効果文にある `[橙ブレードハート]` を既存の効果アイコン表示に追加。公式文字列はマスターにそのまま保持。効果の自動解決機能は追加していない。

## 正本・取得方法

- 公式一覧: https://llofficial-cardgame.com/cardlist/searchresults/?expansion=BP08
- 現在の商品URL（公式詳細APIのexpansionから取得）: https://llofficial-cardgame.com/products/bp08_magicaltreat/
- 公開一覧API: https://llofficial-cardgame.com/manage/card-list-user/list?title=BP08&page=1&per_page=100&sort=no
- 公開詳細API: `https://llofficial-cardgame.com/manage/card-list-user/detail?id=<公式ID>`
- カードラボ一覧: https://www.c-labo-online.jp/product-list/3564/0/photo?num=120 （2ページ）

クラウドからの公式サイト取得は404だったため、接続済みブラウザで公式公開JSONのページ本文を読み取り取得した。各141件について一覧と詳細の共通フィールドの完全一致を確認した。`official-bp08.json` は必要な文字・数値だけを保存し、画像本体・画像URL・HTMLを含めない。カードラボは各通常商品ページのHTTP 200・リダイレクトなし・h1の一致を確認し、HTMLのSHA256を記録した。特価品・エネルギーは追加しない。

初回BP08追加ではライブの必要ハート・スコア・効果を収録し、`attack`は正本への保存までだった。その後のユーザー依頼により、全ライブのブレードハート・特殊ハートを照合して表示する変更と、ハート形状の統一を追加した。続きの正本は`../live-hearts/REPORT.md`。

## 成果物・再現

- `official-bp08.json`: 全141版の公式詳細と対象外31版の一覧。
- `purchase-links-audit.json`: 141個別リンクの照合記録。
- `../../scripts/import-bp08.mjs`: 正本からのオフライン追加。既存データ・参照データのハッシュ照合、重複・競合拒否、再実行で追加0件。
- `../../app/data/bp08-purchase-links.json`: 既存の監査済みリンク適用関数用データ。
- 新規単体テスト6件とPC・390px幅の画面テスト2件。過去監査の期待値は過去の範囲に固定し、新規分を過去監査済みとは扱わない。

再現: `node scripts/import-bp08.mjs`（dry-run）、`node scripts/import-bp08.mjs --write`（追加反映）。この正本専用。既存のC1 importerはC1当時の正本専用のままとする。

## 検証・未完了事項

- `npm run check`: 単体テスト126件成功、UTF-8/JSON検査成功、Vite build成功。従来と同種の500KB超バンドル警告あり。
- ローカル画面テストは実行環境でChromium起動時のsocketが許可されず、アプリ起動前に停止。アプリのテスト成功とは数えていない。GitHubの既存Quality workflowで全25画面テスト（新規PC・390px幅2件を含む）が成功した。
- GitHubブラウザは未サインインで、`PAGES_PREVIEW_ENABLED` の管理画面での現在値確認は未完了。変数は変更していない。既存PreviewはQuality成功後に条件に応じて自動起動し得る。
- PR #28: https://github.com/nice-roy/loveca-card-list/pull/28 。実装commit `62fd71436b6c76f1d257e2dbf0bd2287354d8cb6` のQuality run `43578841080` は成功（単体126件・画面25件・build）。
- 最初のPreview run `43578982854` はDraft PRを拒否する既存gateで停止、build/deployは未実行。検証後にReadyへ変更し、この記録更新で起動するQuality／Previewを確認する。最新の実行結果とPreview URLはPR本文へ記録する。
- 利用者による表示確認、Production承認・公開後確認は未完了。

## 禁止事項と次の1操作

mainへの直接push、無承認のProduction公開、Secret・Environment・Variable・PAT・Cloudflare設定の変更は禁止。全workflow（quality.ymlを含む）・同期Worker・D1・保存形式・既存カード・既存購入リンクは変更していない。

次の1操作: 専用branchのPRで既存Quality／Previewの結果を確認し、確認用URLを提示する。Production公開は、検証結果と公開対象を提示してユーザーの別途明示承認を受けてから。
