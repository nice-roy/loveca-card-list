import { expect, test } from '@playwright/test';
import links from '../app/data/bp08-purchase-links.json' with {type:'json'};

test.use({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] });

for (const width of [1365, 390]) {
  test(`BP08 product, versions, links and orange effects work at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({width,height:900});
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.routeWebSocket('**/*', ws => {external.push('websocket');ws.close();});
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin === 'http://127.0.0.1:4173' && ['GET','HEAD'].includes(request.method())) return route.continue();
      external.push(request.url()); return route.abort();
    });
    await page.goto('/');
    await expect(page.getByLabel('登録カード総数')).toContainText('2054');
    await page.getByRole('checkbox',{name:'同一カードをまとめる'}).uncheck();
    if (width < 768) await page.getByRole('toolbar',{name:'カード一覧の操作'}).getByRole('button',{name:/^絞り込み/}).click();
    await page.getByRole('button',{name:'収録商品 すべての商品'}).click();
    await page.getByRole('checkbox',{name:'BP8｜ブースターパック まじかる♡とり～と',exact:true}).check();
    await page.keyboard.press('Escape');
    await expect(page.locator('.result-bar strong')).toHaveText('141');
    if (width < 768) await page.getByRole('toolbar',{name:'カード一覧の操作'}).getByRole('button',{name:'検索',exact:true}).click();
    const search = page.getByRole('searchbox',{name:'カード名、カード番号、効果テキストで検索'});
    for (const number of ['LL-bp8-001-R＋','PL!N-bp8-001-P＋','PL!HS-bp8-004-SEC','PL!-bp3-026-SECL','PL!-bp8-020-L','PL!-bp8-025-L']) {
      await search.fill(number);
      const card = page.getByRole('article');
      await expect(card).toHaveCount(1);
      await expect(card.getByRole('link',{name:'カードラボで購入',exact:true})).toHaveAttribute('href',links.find(l => l.cardNumber === number)!.url);
    }
    await search.fill('PL!-bp8-003');
    await page.getByRole('checkbox',{name:'同一カードをまとめる'}).check();
    await expect(page.getByRole('article')).toHaveCount(1);
    for (const rarity of ['P','P＋','R＋','SEC']) {
      await expect(page.getByRole('article').getByRole('link',{name:`カードラボで購入（${rarity}）`,exact:true})).toHaveAttribute('href',links.find(l => l.cardNumber === `PL!-bp8-003-${rarity}`)!.url);
    }
    await search.fill('PL!-bp8-023-L');
    const card = page.getByRole('article');
    await expect(card).toContainText('Snow halation');
    await expect(card.getByLabel('橙ブレード',{exact:true})).toHaveCount(2);
    await expect(card.locator('.heart-orange').first()).toHaveCSS('color','rgb(220, 107, 19)');
    await expect(card).not.toContainText('[橙ブレードハート]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:`/tmp/bp08-${width}.png`,fullPage:true});
    await testInfo.attach(`BP08 ${width}px`,{body:await page.screenshot(),contentType:'image/png'});
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
}
