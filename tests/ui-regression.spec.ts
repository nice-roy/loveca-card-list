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
