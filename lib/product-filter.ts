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
  'product:1141b059d897': "BP8", // ブースターパック まじかる♡とり～と
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

export type ProductOption = { id: string; label: string; name: string; code: string | null };
export type ProductSort = 'numberDesc' | 'numberAsc';
export type ProductOptionGroup = { id: string; label: string | null; options: ProductOption[] };

export const PRODUCT_SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: 'numberDesc', label: '種類別・番号の大きい順' },
  { value: 'numberAsc', label: '種類別・番号の小さい順' },
];

const categories = [
  { id: 'booster', label: 'ブースターパック' },
  { id: 'premium', label: 'プレミアムブースター' },
  { id: 'starter', label: 'スタートデッキ' },
  { id: 'other', label: 'その他・PR' },
];
const seriesOrder = ["μ's", 'Aq', 'N', 'Li', 'HS'];

export function productFilterOption(product: { id: string; label: string }): ProductOption {
  const code = filterCodes[product.id];
  return { ...product, name: product.label, code: code ?? null, label: code ? `${code}｜${product.label}` : product.label };
}

function productOrder(option: ProductOption) {
  const code = option.code ?? '';
  const booster = code.match(/^BP(\d+)$/);
  if (booster) return { category: 'booster', series: -1, number: Number(booster[1]) };
  const seriesProduct = code.match(/^(μ's|Aq|N|Li|HS)-(PB|SD)(\d+)$/);
  if (seriesProduct) return {
    category: seriesProduct[2] === 'PB' ? 'premium' : 'starter',
    series: seriesOrder.indexOf(seriesProduct[1]),
    number: Number(seriesProduct[3]),
  };
  return { category: 'other', series: option.name === 'PRカード' ? 1 : 0, number: 0 };
}

function normalizeProductSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s｜|]+/g, '');
}

export function groupProductOptions(options: ProductOption[], query: string, sort: ProductSort): ProductOptionGroup[] {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(normalizeProductSearch);
  const matches = options.filter((option) => terms.every((term) => normalizeProductSearch(option.label).includes(term)));
  const compareName = (left: ProductOption, right: ProductOption) => left.name.localeCompare(right.name, 'ja', { numeric: true });
  return categories.map((category) => ({
    ...category,
    options: matches.filter((option) => productOrder(option).category === category.id).sort((a, b) => {
      const left = productOrder(a);
      const right = productOrder(b);
      return left.series - right.series
        || (left.number - right.number) * (sort === 'numberAsc' ? 1 : -1)
        || compareName(a, b);
    }),
  })).filter((group) => group.options.length > 0);
}
