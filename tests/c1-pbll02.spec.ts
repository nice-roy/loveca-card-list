import { expect, test } from '@playwright/test';

test('C1 cards show six to nine blades and retain distinct reprint versions', async ({ page }) => {
  const externalRequests: string[] = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/')) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  await page.goto('/');
  await expect(page.getByLabel('登録カード総数')).toContainText('1913');
  const search = page.getByRole('searchbox', { name: 'カード名、カード番号、効果テキストで検索' });
  for (const [number, blades] of [['PL!-pb2-016-R', '6'], ['PL!-pb2-000-DUO', '7'], ['PL!-pb2-018-R', '8'], ['PL!-pb2-001-R', '9']]) {
    await search.fill(number);
    const card = page.getByRole('article');
    await expect(card).toHaveCount(1);
    await expect(card.locator('dl.stats > div').filter({ has: page.locator('dt').filter({ hasText: /^ブレード$/ }) }).locator('dd')).toHaveText(blades);
    await expect(card).toContainText('プレミアムブースター ラブライブ！DUO');
    await expect(card.getByRole('link', { name: '公式カード情報' }).first()).toHaveAttribute('href', new RegExp(encodeURIComponent(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  await search.fill('PL!-bp3-019');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '同一カードをまとめる' }).uncheck();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').filter({ hasText: 'PL!-bp3-019-SRL' })).toContainText('プレミアムブースター ラブライブ！DUO');
  expect(externalRequests).toEqual([]);
});
