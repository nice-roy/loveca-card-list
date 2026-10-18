import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const links: Array<{cardNumber: string; url: string}> = JSON.parse(readFileSync('app/data/duo-purchase-links.json', 'utf8'));

test.use({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] });

test('DUO member/live links show exact R/PP URLs in both display modes', async ({ page, context }, testInfo) => {
  const blocked: string[] = [];
  await context.routeWebSocket('**/*', ws => { blocked.push('websocket'); ws.close(); });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173' || !['GET', 'HEAD'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      blocked.push('redirect');
      await route.abort();
      return;
    }
    await route.fulfill({ response });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'カード名、カード番号、効果テキストで検索' });
  for (const number of ['PL!-pb2-001-R', 'PL!-pb2-001-PP', 'PL!-bp3-020-SRL']) {
    const expected = links.find(link => link.cardNumber === number)!;
    await search.fill(number);
    const card = page.getByRole('article');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', {name: 'カードラボで購入', exact: true})).toHaveAttribute('href', expected.url);
  }
  await search.fill('PL!-pb2-001');
  await expect(page.getByRole('article')).toHaveCount(1);
  for (const rarity of ['R', 'PP']) {
    const expected = links.find(link => link.cardNumber === `PL!-pb2-001-${rarity}`)!;
    const link = page.getByRole('article').getByRole('link', {name: `カードラボで購入（${rarity}）`, exact: true});
    await expect(link).toHaveAttribute('href', expected.url);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await testInfo.attach('DUO grouped R and PP purchase links', {body: await page.screenshot(), contentType: 'image/png'});
  await page.getByRole('checkbox', { name: '同一カードをまとめる' }).uncheck();
  for (const rarity of ['R', 'PP']) {
    const number = `PL!-pb2-001-${rarity}`;
    const card = page.getByRole('article').filter({hasText: number});
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', {name: 'カードラボで購入', exact: true})).toHaveAttribute('href', links.find(link => link.cardNumber === number)!.url);
  }
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
});
