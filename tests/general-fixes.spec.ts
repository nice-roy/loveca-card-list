import {expect, test} from '@playwright/test';

test('同期コードのコピー操作は整形済みコードを渡して成功表示する', async ({page, context}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') return route.continue();
    // Production候補では画面を開くと履歴取得が始まる。実Workerへは送らない。
    if (process.env.VITE_SYNC_API_URL
      && route.request().url() === `${process.env.VITE_SYNC_API_URL}/sync/history`
      && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({code: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'});
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({history: [], revision: 1})});
    }
    external.push(route.request().url());
    return route.abort();
  });
  // CI専用のダミー。既存コードや実クラウドへのアクセスは使わない。
  await page.addInitScript(() => {
    localStorage.setItem('loveca-card-list:sync-code:v1', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.setAttribute('data-copied-sync-code', text); },
    }});
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'クラウド同期'}).click();
  const dialog = page.getByRole('dialog', {name: 'クラウド同期'});
  await dialog.getByRole('button', {name: 'コピー', exact: true}).click();
  await expect(dialog.getByRole('button', {name: 'コピーしました', exact: true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-copied-sync-code', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('AI回答全文から候補ブロックの1枚だけを追加し採用済みと減らすカードを除外する', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: '候補を一括追加', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '候補を一括追加', exact: true});
  await dialog.getByRole('textbox', {name: '候補に追加するカード番号'}).fill('採用中：PL!-bp8-020\n減らす候補：PL!-bp8-023\n### 候補一括追加用\n```\nPL!-bp8-001 | 高坂穂乃果 | 4\n```\n補足：PL!-bp8-023は増やしません。');
  await dialog.getByRole('button', {name: '候補に追加', exact: true}).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('loveca-card-list:deck-builder:v1') ?? '{}').candidates)).toEqual(['PL!-bp8-001']);
});

test('SEC絵里の紫ブレードハートは1個でライブ効果にHTML改行タグを表示しない', async ({page}) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', {name: 'カード名、カード番号、効果テキストで検索'});
  await search.fill('PL!-bp4-002-SEC');
  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.stats > div').filter({has: page.getByText('ブレードハート', {exact: true})}).getByRole('definition')).toHaveText('紫×1');
  await search.fill('PL!N-bp1-026-L');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.effect-text')).not.toContainText('<br>');
  await card.getByRole('button', {name: "Poppin' Up!の効果を全文読む", exact: true}).click();
  const dialog = page.getByRole('dialog', {name: "Poppin' Up!", exact: true});
  await expect(dialog.locator('.effect-detail-text')).not.toContainText('<br>');
  expect(await dialog.locator('.effect-detail-text').textContent()).toContain('\n(');
});
