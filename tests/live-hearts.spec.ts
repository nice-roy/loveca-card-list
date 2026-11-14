import { expect, test } from '@playwright/test';

test.use({ serviceWorkers:'block', acceptDownloads:false, permissions:[] });

for (const width of [1365,390]) {
  test(`live hearts and the shared hollow silhouette work at ${width}px`, async ({page,context}) => {
    await page.setViewportSize({width,height:900});
    const external: string[]=[];
    const errors: string[]=[];
    page.on('pageerror', error=>errors.push(error.message));
    await context.routeWebSocket('**/*', ws=>{external.push('websocket');ws.close();});
    await context.route('**/*', route=>{
      const r=route.request();
      if(new URL(r.url()).origin==='http://127.0.0.1:4173' && ['GET','HEAD'].includes(r.method())) return route.continue();
      external.push(r.url());return route.abort();
    });
    await page.goto('/');
    await page.getByRole('checkbox',{name:'同一カードをまとめる'}).uncheck();
    const toolbar=page.getByRole('toolbar',{name:'カード一覧の操作'});
    if(width<768) await toolbar.getByRole('button',{name:'検索',exact:true}).click();
    const search=page.getByRole('searchbox',{name:'カード名、カード番号、効果テキストで検索'});
    const card=page.getByRole('article');
    await search.fill('PL!-bp8-023-L');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.stats')).toContainText('ブレードハート');
    await expect(card.locator('.live-heart-list')).toContainText('橙×1');
    await expect(card.locator('.heart-orange').first()).toHaveCSS('color','rgb(220, 107, 19)');
    const orange=card.locator('.heart-orange path').first();
    await expect(orange).toHaveAttribute('fill','currentColor');
    const silhouette=await orange.getAttribute('d');
    const hollow=card.locator('.heart-any path').first();
    await expect(hollow).toHaveAttribute('d',silhouette!);
    await expect(hollow).toHaveAttribute('fill','none');
    await expect(hollow).toHaveAttribute('stroke','currentColor');
    await expect(card.getByLabel('橙ブレード',{exact:true}).first().locator('svg path')).toHaveAttribute('d',silhouette!);
    await expect(card.locator('.heart-pink path').first()).toHaveAttribute('d',silhouette!);

    // Distinguish colorless from ALL, and verify both old products and BP08.
    for(const [number,text] of [
      ['PL!-bp8-019-L','無色×2'],
      ['PL!SP-bp2-025-SRL','ALL×1'],
      ['LL-PR-004-PR','ALL×1'],
      ['PL!SP-bp1-023-L','スコアアップ'],
      ['PL!-bp8-020-L','スコアアップ'],
      ['PL!-bp8-024-L','紫×1ドロー'],
    ]) {
      await search.fill(number);
      await expect(card).toHaveCount(1);
      await expect(card.locator('.live-heart-list')).toHaveText(text);
    }
    await expect(card.getByLabel('ドローハート',{exact:true})).toBeVisible();
    await card.getByRole('button',{name:'デッキに追加',exact:true}).click();
    if(width<768) await toolbar.getByRole('button',{name:/^デッキ/}).click();
    else await page.getByRole('button',{name:'デッキを開く、現在1枚',exact:true}).click();
    const deckDetails=page.locator('.deck-key-info');
    await expect(deckDetails).toContainText('ブレードハート');
    await expect(deckDetails.locator('.live-heart-list')).toHaveText('紫×1ドロー');
    await expect(deckDetails.locator('.heart-any path').first()).toHaveAttribute('fill','none');
    await page.keyboard.press('Escape');
    if(width<768 && !await search.isVisible()) await toolbar.getByRole('button',{name:'検索',exact:true}).click();

    // Member effect text uses the very same hollow symbol, without changing the saved text.
    await search.fill('PL!-bp8-001-R');
    await expect(card).toHaveCount(1);
    await expect(card.getByLabel('無色ハート',{exact:true}).locator('svg path')).toHaveAttribute('fill','none');
    await expect(card.getByLabel('無色ハート',{exact:true}).locator('svg path')).toHaveAttribute('d',silhouette!);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(external).toEqual([]);expect(errors).toEqual([]);
  });
}
