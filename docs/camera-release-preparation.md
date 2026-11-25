# カメラ機能の本番組み込み準備

基点は `nice-roy/loveca-card-list` の main `972d8b485770206d559aa2411859f858cec92ccd`。実機確認済みの撮影、枠調整、版選択、枚数変更、一括加算を本体の所持データに接続した。自宅LANのペアリング、証明書、固定写真、速度比較ページは本番向けソースに含めない。

## ローカルで確認できるもの

通常の `npm run check` は従来のカード一覧を `dist/` に生成する。カメラ専用ページ、照合データ、撮影画面のJS・CSSはそこに出力されない。専用コマンドで作った非公開の候補版では、一覧の「写真から所持に追加」から同じオリジンの `/camera/` へ進む。最後に一覧に戻ると所持枚数を共有できる。写真はブラウザー内で処理する。

候補版は正本の実装・照合データ・OpenCV・ライセンスをSHA-256で検証して取り込む。実行時に開発PCのフォルダーや追加サーバーを参照しない。BP08追加後の2,054版の索引をエントリ順の6ファイルに分け、照合前に同じ構造へ戻す。候補版はローカル専用の `outputs/camera-candidate/`、個別ファイルのSHA-256は `outputs/camera-candidate-manifest.json` にある。

## 再現

Nodeとnpmは既存の本体と同じバージョンを使用する。ビルド時の同期先には現行の公開サイトと同じ公開APIオリジンをプロセス内で指定する。ブラウザーテストはループバックで動作する。照合の正本と実機試験と同じ6枚写真はローカルから指定する。

```powershell
$baseEngine = Read-Host '従来の1,913版の照合エンジン正本の絶対パス'
$photo = Read-Host '共通6枚写真の絶対パス'
$policy = ((Invoke-WebRequest -Method Head -Uri 'https://loveca-card-list.pages.dev/').Headers['Content-Security-Policy'] -join ' ')
$endpoint = [regex]::Match($policy, '(?:^|;\s*)connect-src (https://loveca-card-list-sync\.[a-z0-9-]+\.workers\.dev)(?:;|$)')
if (!$endpoint.Success) { throw '現行の本番ポリシーと同期先を確認してください。' }
$env:VITE_SYNC_API_URL = $endpoint.Groups[1].Value
npm.cmd run check
python scripts/collect-camera-bp08.py $baseEngine
node scripts/build-camera-bp08.mjs $baseEngine
$engine = (Resolve-Path 'outputs/private-bp08/engine').Path
npm.cmd run build:camera-candidate -- $engine
python scripts/audit-camera-candidate.py $engine
node scripts/verify-camera-candidate.mjs $photo $policy
node scripts/check-camera-bp08.mjs
```

## 検証結果

- 既存1,913版のエントリを保持し、BP08「まじかる♡とり～と」のメンバー108版・ライブ33版を追加した。全2,054版のIDとカード番号が本体と一致した。公式一覧172件を以前の公式詳細スナップショットと照合し、対象外のエネルギー31版を除いた。141枚のPNGはすべてデコードでき、SHA-256は各画像で異なる。公式画像URL、対応番号、サイズとハッシュは `outputs/private-bp08/manifest.json`、画像は同じ場所の `images/` にある。取得には標準PythonとPillow、特徴抽出には既存正本のOpenCVと抽出モジュール・ローカルのChromeを使用する。
- 候補版28ファイルについて、リポジトリのPages用アーカイブ検査と現行ヘッダー・同期先の内容検査を通過。最大ファイルは10,872,779バイト。復元した索引を非公開の2,054版正本と照合した。これは静的ファイルの検査であり、Cloudflareでのデプロイ試験ではない。
- 隔離ブラウザーで、通常ビルドの入口非表示、現行の本番ポリシーでの索引取得ブロック、撮影ページ専用の試験ポリシーでの6版の照合・確認・一括登録・一覧復帰・再読込後の保持を確認した。照合・登録中の外部リクエストは0件。SE2での照合7.5秒は統合試験版の既測値であり、分割索引を使う候補のSE2実測値は未取得。
- 本体の単体テスト139件成功。Windows上のUI回帰は、通常ビルド・カメラ有効の候補版ともに34件中32件成功。「高坂穂乃果の効果を全文読む」のボタン表示2件は、変更前のmainと同じソースでも、同じ画面幅（1365px・390px）で失敗した。単独のTypeScript検査は既知の4件が残る。

BP08の追加後、新規141枚の公式画像を1枚ずつ更新済み候補版に入力し、141枚すべてで同じカード番号の版が第1候補になった。結果は `outputs/private-bp08/recognition-results.json` に記録。これは元画像を使った索引確認で、実物の撮影精度とは別の測定。従来の実写真6枚でも一括登録・再読込後の所持を確認した。

## 公開前に必要な判断

1. **照合データの一般配布条件。** 正本の `SOURCE-PROVENANCE.json` と索引には `publicDistributionAllowed: false` が記録されている。データは利用者の端末へ配信される。公式画像由来の索引とライブ判定用データについて一般配布可能な入力を確定し、その版の識別子・配布条件・ハッシュを管理する。現在の候補成果物は外部へ渡さない。
2. **撮影ページの配信ポリシー。** 本番で確認したCSPは、同一オリジンへの索引取得、選択写真のblob URL、現行OpenCVの実行要件をすべては満たさない。ローカル検証では一覧に本番と同じCSPを維持し、撮影ページだけで `connect-src 'self'`、`img-src 'self' data: blob:`、`script-src 'self' 'unsafe-eval'` とした。最後の指定はJavaScriptの動的実行も許可する。パスの分離はオリジンの隔離ではない。現行ライブラリをこの条件で配信するか、より厳しいCSPで動くビルドへ置き換えるかを公開前に判断する。
3. **正式な配信経路。** 上の2点が解決した時点で、承認済みの入力を既存のCandidateビルドで再現できるよう接続し、信頼済みパッケージ作成側で一覧・撮影の各レスポンスヘッダーを検証する。通常ビルドの入口を有効にして候補を作り直し、SE2・既存UIの確認後に公開の可否を決める。今回の専用コマンドはそのためのローカルリハーサルである。
