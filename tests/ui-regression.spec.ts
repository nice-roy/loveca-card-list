import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await expect(page.getByLabel('登録カード総数')).toContainText('1817');
});

test('基本表示と「その他」の分類を操作できる', async ({page}) => {
  const groupNavigation = page.getByRole('navigation', {name: 'グループを切り替え'});
  const expectedGroups = ['すべて', "μ's", 'Aqours', '虹ヶ咲', 'Liella!', '蓮ノ空', 'その他'];

  for (const label of expectedGroups) {
    await expect(groupNavigation.getByRole('button', {name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)})).toBeVisible();
  }
  await expect(page.getByLabel('登録カード総数')).toContainText('メンバー 1526 · ライブ 291');

  await groupNavigation.getByRole('button', {name: /^その他(?:\s|$)/}).click();
  const otherNavigation = page.getByRole('navigation', {name: 'その他のグループを切り替え'});
  await expect(otherNavigation).toBeVisible();
  await expect(otherNavigation.getByRole('button')).toHaveText([
    'すべて',
    'A-RISE',
    'Saint Snow',
    'Sunny Passion',
    'その他ライブ',
  ]);
});

test('複数語のフリーワード検索は順序によらずAND検索になる', async ({page}) => {
  const search = page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'});
  const resultCount = page.locator('.result-bar strong');

  await search.fill('控え室 カード');
  const forwardCount = await resultCount.textContent();
  expect(Number(forwardCount)).toBeGreaterThan(0);

  await search.fill('カード　控え室');
  await expect(resultCount).toHaveText(forwardCount ?? '');

  await search.fill('控え室 この語はカードマスターに存在しません');
  await expect(page.getByRole('heading', {name: '該当するカードがありません'})).toBeVisible();
});

test('まとめカード表面のCard Laboリンクとバージョン詳細の公式リンクを守る', async ({page}) => {
  await page.getByRole('navigation', {name: 'グループを切り替え'}).getByRole('button', {name: /^Aqours(?:\s|$)/}).click();
  await page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'}).fill('PL!S-bp2-001');

  const card = page.getByRole('article').filter({hasText: '高海千歌'}).filter({hasText: 'PL!S-bp2-001'});
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('link', {name: '公式カード情報'})).toHaveCount(1);

  const purchaseP = card.getByRole('link', {name: 'カードラボで購入（P）'});
  const purchaseR = card.getByRole('link', {name: 'カードラボで購入（R）'});
  await expect(purchaseP).toHaveAttribute('href', /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
  await expect(purchaseR).toHaveAttribute('href', /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);

  await card.getByText('バージョンを見る（2種）', {exact: true}).click();
  const versionDetails = card.locator('details');
  await expect(versionDetails.getByRole('link', {name: '公式カード情報'})).toHaveCount(2);
  await expect(versionDetails.getByRole('link', {name: /カードラボで購入/})).toHaveCount(0);
  await expect(card.getByRole('link', {name: /カードラボで購入/})).toHaveCount(2);
});

test('監査済みライブカードのCard Laboリンクをまとめ表示ON/OFFで保持する', async ({page}) => {
  const search = page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'});
  const grouping = page.getByRole('checkbox', {name: '同一カードをまとめる'});
  const cases = [
    ['PL!S-bp6-019-L', 'Step! ZERO to ONE', 'https://www.c-labo-online.jp/product/386698'],
    ['LL-bp5-001-L', 'Live with a smile!', 'https://www.c-labo-online.jp/product/368566'],
    ['PL!-bp4-026-L', 'ダイヤモンドプリンセスの憂鬱', 'https://www.c-labo-online.jp/product/350919'],
    ['PL!SP-sd1-026-SRL', '私のSymphony 〜澁谷かのんVer.〜', 'https://www.c-labo-online.jp/product/393393'],
    ['LL-PR-004-PR', '愛♡スクリ～ム！', 'https://www.c-labo-online.jp/product/338834'],
    ['PL!HS-pb1-029-L', '全方位キュン♡', 'https://www.c-labo-online.jp/product/381743'],
  ] as const;

  await expect(grouping).toBeChecked();
  for (const [cardNumber, name, url] of cases) {
    await search.fill(cardNumber);
    const card = page.getByRole('article').filter({hasText: name}).filter({hasText: cardNumber});
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', {name: 'カードラボで購入'})).toHaveAttribute('href', url);
  }

  await grouping.uncheck();
  for (const [cardNumber, name, url] of cases) {
    await search.fill(cardNumber);
    const card = page.getByRole('article').filter({hasText: name}).filter({hasText: cardNumber});
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', {name: 'カードラボで購入'})).toHaveAttribute('href', url);
  }
});

test('所持・候補・デッキ4枚上限の基本操作が成立する', async ({page}) => {
  const cardNumber = 'PL!SP-bp5-021-N';
  await page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'}).fill(cardNumber);
  const card = page.getByRole('article').filter({hasText: cardNumber});
  await expect(card).toHaveCount(1);

  const inventory = card.getByRole('spinbutton', {name: `${cardNumber}の所持枚数`});
  await expect(inventory).toHaveValue('0');
  await card.getByRole('button', {name: `${cardNumber}の所持枚数を1枚増やす`}).click();
  await expect(inventory).toHaveValue('1');
  await card.getByRole('button', {name: `${cardNumber}の所持枚数を1枚減らす`}).click();
  await expect(inventory).toHaveValue('0');

  await card.getByRole('button', {name: '候補', exact: true}).click();
  await expect(card.getByRole('button', {name: '候補中', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', {name: '候補中', exact: true}).click();
  await expect(card.getByRole('button', {name: '候補', exact: true})).toHaveAttribute('aria-pressed', 'false');

  for (let quantity = 1; quantity <= 4; quantity += 1) {
    await card.getByRole('button', {name: 'デッキに追加', exact: true}).click();
  }
  const limitButton = card.getByRole('button', {name: '4枚採用中', exact: true});
  await expect(limitButton).toBeDisabled();
  await expect(page.getByRole('button', {name: 'デッキを開く、現在4枚'})).toBeVisible();
});

test('クラウド同期ダイアログを通信なしで開ける', async ({page}) => {
  await page.getByRole('button', {name: 'クラウド同期'}).click();
  const dialog = page.getByRole('dialog', {name: 'クラウド同期'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', {name: '同期コードを作成'})).toBeVisible();
  await expect(dialog.getByRole('button', {name: '既存の同期コードを入力'})).toBeVisible();
});

test('PCでは従来の検索・絞り込み・並び順を常時表示する', async ({page}) => {
  await expect(page.getByRole('toolbar', {name: 'カード一覧の操作'})).toBeHidden();
  await expect(page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'})).toBeVisible();
  await expect(page.getByRole('group', {name: 'カード種類'})).toBeVisible();
  await expect(page.locator('#mobile-sort-panel').getByRole('combobox')).toBeVisible();
});

test.describe('iPhone SE2向け操作バー', () => {
  test.use({viewport: {width: 375, height: 667}});

  test('ブランドは流れ、stickyバーから3パネルを排他的に操作できる', async ({page}) => {
    const header = page.locator('.site-header');
    const toolbar = page.getByRole('toolbar', {name: 'カード一覧の操作'});
    const searchButton = toolbar.getByRole('button', {name: '検索', exact: true});
    const filterButton = toolbar.getByRole('button', {name: /^絞り込み/});
    const sortButton = toolbar.getByRole('button', {name: '並び順', exact: true});
    const search = page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'});

    await expect(toolbar).toBeVisible();
    await expect(search).toBeHidden();
    await expect(header).toHaveCSS('position', 'static');
    await expect(page.locator('.filter-panel')).toHaveCSS('position', 'sticky');

    await page.mouse.wheel(0, 900);
    await expect(header).not.toBeInViewport();
    await expect(toolbar).toBeInViewport();

    await searchButton.click();
    await expect(search).toBeVisible();
    expect(await search.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(search).toHaveAttribute('autocomplete', 'off');
    await expect(search).toHaveAttribute('inputmode', 'search');
    await expect(search).toHaveAttribute('name', 'card-search');
    await expect(search).toHaveAttribute('id', 'card-search');

    await filterButton.click();
    await expect(search).toBeHidden();
    await expect(page.getByRole('region', {name: '絞り込みパネル'})).toBeVisible();
    await expect(page.getByRole('region', {name: '並び順パネル'})).toBeHidden();

    await sortButton.click();
    await expect(page.getByRole('region', {name: '絞り込みパネル'})).toBeHidden();
    await expect(page.getByRole('region', {name: '並び順パネル'})).toBeVisible();
    await sortButton.click();
    await expect(page.getByRole('region', {name: '並び順パネル'})).toBeHidden();
  });

  test('検索結果0件でも位置と入力を保ち、文字を戻すとカードが再表示される', async ({page}) => {
    const toolbar = page.getByRole('toolbar', {name: 'カード一覧の操作'});
    await page.mouse.wheel(0, 900);
    await toolbar.getByRole('button', {name: '検索', exact: true}).click();
    const search = page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'});

    await search.fill('PL!S-bp6-019-L');
    await expect(page.getByRole('article').filter({hasText: 'Step! ZERO to ONE'})).toBeVisible();
    await search.fill('zzzzzz-存在しないカード番号');
    await expect(page.getByRole('heading', {name: '該当するカードがありません'})).toBeVisible();
    await expect(search).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    await search.fill('PL!S-bp6-019-L');
    await expect(page.getByRole('article').filter({hasText: 'Step! ZERO to ONE'})).toBeVisible();
  });

  test('4項目のstickyバーからデッキを開け、右下の旧入口は表示されない', async ({page}) => {
    const toolbar = page.getByRole('toolbar', {name: 'カード一覧の操作'});
    const deckButton = toolbar.getByRole('button', {name: /デッキ/});
    await expect(toolbar.getByRole('button')).toHaveCount(4);
    await expect(deckButton).toContainText('デッキ');
    await expect(deckButton).toContainText('0');
    await expect(page.locator('.deck-launcher')).toBeHidden();

    const toolbarBox = await toolbar.boundingBox();
    const deckBox = await deckButton.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(deckBox).not.toBeNull();
    expect(toolbarBox?.height ?? Infinity).toBeLessThanOrEqual(56);
    expect(deckBox?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);

    await toolbar.getByRole('button', {name: /^検索$/}).click();
    await expect(page.getByRole('region', {name: '検索パネル'})).toBeVisible();
    await deckButton.click();
    await expect(page.getByRole('region', {name: '検索パネル'})).toBeHidden();
    await expect(page.getByRole('dialog', {name: 'デッキ'})).toBeVisible();
  });
});

test.describe('スマホ縦幅', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('主要カテゴリ・デッキ・同期UIへ到達でき、致命的な横あふれがない', async ({page}) => {
    const groupNavigation = page.getByRole('navigation', {name: 'グループを切り替え'});
    await groupNavigation.getByRole('button', {name: /^その他(?:\s|$)/}).click();
    await expect(page.getByRole('navigation', {name: 'その他のグループを切り替え'})).toBeVisible();

    const deckButton = page.getByRole('button', {name: /デッキを開く/});
    const syncButton = page.getByRole('button', {name: 'クラウド同期'});
    await expect(deckButton).toBeInViewport();
    await expect(syncButton).toBeVisible();

    await deckButton.click();
    await expect(page.getByRole('dialog', {name: 'デッキ'})).toBeVisible();
    await page.keyboard.press('Escape');
    await syncButton.click();
    await expect(page.getByRole('dialog', {name: 'クラウド同期'})).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
