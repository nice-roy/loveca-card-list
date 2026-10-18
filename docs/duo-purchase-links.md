# DUO カードラボ購入リンク（C2.1）

確認日: 2026-10-18。基準main: `94e7fefdc448fb03a2328b798bcf87e154f4fe68`。

## 原因

C1で追加したDUO 96件には `purchaseLinks` がなく、旧ライブ用の監査データ157件にも含まれていなかった。既存UIは `https://www.c-labo-online.jp/product/<数字>` の個別URLを持つ版だけに購入リンクを表示するため、DUOだけ表示されなかった。

## 確認結果

| 対象 | カード数 | 個別URL確認・登録 | 未登録 |
| --- | ---: | ---: | ---: |
| メンバー | 56 | 56 | 0 |
| ライブ | 40 | 40 | 0 |
| 合計 | 96 | 96 | 0 |

出典: [カードラボDUO商品一覧（在庫による除外なし）](https://www.c-labo-online.jp/product-list/3523/0/photo?num=120)、およびその一覧に実際に掲載された個別商品ページ。2ページを読み取り、対象96版の通常商品候補を個別GETで確認した。対象外エネルギー・特価品を登録していない。在庫切れをURL不存在とは扱わず、価格・在庫は恒久データに保存しない。

完全なカード番号（レアリティ接尾辞込み）、カード名、商品見出しのレアリティを照合。空白・NFKC差、SEC/PPの末尾「サイン」注記だけを既存基準に従って許容した。HTTP 200、リダイレクト後URLの完全一致、個別ページh1と一覧見出しの一致も確認。URLを推測で生成せず、検索結果URLも個別URLとして登録していない。

各版のID・番号・名称・種類・商品ID・URL・見出し・確認日時・HTML SHA256は `duo-purchase-links-audit.json`。確認できない版は `unverified` に理由を残し、URLを付与しない。

## 実装と影響範囲

- `app/data/duo-purchase-links.json` に物理版ごとの監査済みURLを追加。
- `app/page.tsx` は旧ライブ用データとDUO用データを既存の適用関数へ渡す。
- `lib/purchase-links.ts` は従来liveのみだった照合を明示的な `cardType` と `productId` に対応。旧データの暗黙live条件は保持。ID・完全な番号・種類・商品が不一致なら停止し、重複・競合も引き続き拒否する。
- 表示UI、`cards.json`、旧ライブURLデータ、所持・デッキ・同期保存形式、workflowは変更しない。

## 検証

`node --experimental-strip-types --test scripts/test-purchase-links.mjs scripts/test-duo-purchase-links.mjs`

既存購入リンク回帰テストにDUO監査データを追加。新規テストは96版の監査対応、旧1817件と全カード属性の保持、誤ったID/番号/種類/商品の拒否、未確認版へのfallback禁止、まとめ表示ON/OFFの版別リンク保持を検証する。

`tests/duo-purchase-links.spec.ts` はメンバーR/PP・ライブの実表示URLとまとめ表示を確認。使い捨てcontextでlocalhost GET/HEADだけ許可し、外部通信・書込み・WebSocket・リダイレクトを遮断する。リンク先のクリック、購入、同期操作は行わない。

PRの通常Quality成功後は既存Pages Previewが条件に従い自動起動し得る。Production workflowは手動dispatch専用であり、本PRの作成・更新では起動しない。merge・Production公開は別工程。
