// Display codes for the product filter. Reprints can retain another product's card number.
// Card-number prefixes: PL! → μ's, PL!S → Aq, PL!N → N, PL!SP → Li, PL!HS → HS.
const filterCodes: Readonly<Partial<Record<string, string>>> = {
  'product:8cee97be5d17': "BP1", // ブースターパック vol.1
  'product:fcb4ff2c1d85': "BP2", // ブースターパック NEXT STEP
  'product:8e18bc569e72': "BP3", // ブースターパック　夏、はじまる。
  'product:87ef464767aa': "BP4", // ブースターパック SAPPHIRE MOON
  'product:a8d4041e8b82': "BP5", // ブースターパック Anniversary 2026
  'product:d41d2ca57378': "BP6", // ブースターパック Royal Holiday
  'product:763068a8ed9b': "BP7", // ブースターパック MELLOW MOMENT
  'product:8cf67415f883': "μ's-PB1", // プレミアムブースター ラブライブ！
  'product:79a3699c3a78': "μ's-PB2", // プレミアムブースター ラブライブ！DUO
  'product:dd9764e60c7d': "Aq-PB1", // プレミアムブースター ラブライブ！サンシャイン!!
  'product:27739fd61f60': "N-PB1", // プレミアムブースター ラブライブ！虹ヶ咲学園スクールアイドル同好会
  'product:df9035d9276d': "Li-PB1", // プレミアムブースター ラブライブ！スーパースター!!
  'product:a32dfc622613': "Li-PB2", // プレミアムブースター ラブライブ！スーパースター!! DUO
  'product:8389db1f064d': "HS-PB1", // プレミアムブースター 蓮ノ空女学院スクールアイドルクラブ
  'product:b95a7842f755': "μ's-SD1", // スタートデッキ ラブライブ！
  'product:19bff205d7fc': "Aq-SD1", // スタートデッキ ラブライブ！サンシャイン!!
  'product:a441500ac5ed': "N-SD1", // スタートデッキ ラブライブ！虹ヶ咲学園スクールアイドル同好会
  'product:6fd06e26f92e': "N-SD2", // スタートデッキ ラブライブ！虹ヶ咲学園スクールアイドル同好会 cheer
  'product:0bb3a96c6a7a': "Li-SD1", // スタートデッキ ラブライブ！スーパースター!!
  'product:9fb769bcdff1': "Li-SD2", // スタートデッキ ラブライブ！スーパースター!! cheer
  'product:df614dd1f5bd': "HS-SD1", // スタートデッキ ラブライブ！蓮ノ空女学院スクールアイドルクラブ
  'product:5c25e2c8b9cd': "HS-CL1", // コレクション クリアポケット ラブライブ！蓮ノ空女学院スクールアイドルクラブ
};

export function productFilterOption(product: { id: string; label: string }) {
  const code = filterCodes[product.id];
  return code ? { ...product, label: `${code}｜${product.label}` } : product;
}
