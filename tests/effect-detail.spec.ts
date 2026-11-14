import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] });

for (const width of [1365, 390]) {
  test(`truncated member and live effects can be read without losing the list at ${width}px`, async ({ page, context }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 720 });
    const snap = async (stage:string) => console.log('SCROLL_DIAG',JSON.stringify(await page.evaluate(stage=>({stage,y:scrollY,max:document.documentElement.scrollHeight-innerHeight,html:document.documentElement.getAttribute('style'),body:document.body.getAttribute('style'),active:document.activeElement?.outerHTML.slice(0,100),card:document.querySelector('article')?.getBoundingClientRect().toJSON(),trigger:document.querySelector('.effect-read-more')?.getBoundingClientRect().toJSON()}), stage)));
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.routeWebSocket('**/*', ws => { external.push('websocket'); ws.close(); });
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin === 'http://127.0.0.1:4173' && ['GET', 'HEAD'].includes(request.method())) return route.continue();
      external.push(request.url()); return route.abort();
    });
    await page.goto('/');
    await page.getByRole('checkbox', { name: '同一カードをまとめる' }).uncheck();
    if (width < 768) await page.getByRole('toolbar', { name: 'カード一覧の操作' }).getByRole('button', { name: '検索', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'カード名、カード番号、効果テキストで検索' });
    const card = page.getByRole('article');

    for (const [iteration, [number, name, ending, icon]] of [
      ['LL-bp5-001-L', 'Live with a smile!', 'このカードのスコアを＋１する。', '桃ハート'],
      ['PL!-bp8-001-R', '高坂穂乃果', '減らす。', '無色ハート'],
    ].flatMap(item => [item,item,item]).entries()) {
      await search.fill(number);
      await expect(card).toHaveCount(1);
      const trigger = card.getByRole('button', { name: `${name}の効果を全文読む`, exact: true });
      await expect(trigger).toBeVisible();
      await trigger.scrollIntoViewIfNeeded();
      // Record the actual opening position, after Playwright's click auto-scroll.
      // The page uses smooth scrolling, so a pre-click snapshot can still be moving.
      await trigger.evaluate(button => {
        button.addEventListener('click', () => {
          button.setAttribute('data-scroll-at-open', String(window.scrollY));
        }, { once: true });
      });
      const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      await snap('before-click');
      if (iteration % 3 === 2) {
        // Reproduce opening while a previous focus/navigation scroll is running.
        await trigger.evaluate(button => {
          (button as HTMLElement).focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await trigger.press('Enter');
      } else await trigger.click();
      // The modal makes the background inaccessible to role locators while open.
      const openingPosition = await page.locator('.effect-read-more[data-scroll-at-open]').getAttribute('data-scroll-at-open');
      expect(openingPosition).not.toBeNull();
      const scrollBefore = Number(openingPosition); console.log('CLICK_Y',scrollBefore); await snap('after-click');
      const dialog = page.getByRole('dialog', { name, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(number);
      await expect(dialog.locator('.effect-detail-text')).toContainText(ending);
      await expect(dialog.getByLabel(icon, { exact: true })).toBeVisible();
      await expect(dialog.locator('.effect-detail-text')).toHaveCSS('-webkit-line-clamp', 'none');
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(721);
      // Keyboard access and scrolling remain inside the reader on a small screen.
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await dialog.locator('.effect-detail-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThanOrEqual(2);
      await snap('before-close'); if (name === 'Live with a smile!') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused(); await snap('after-close');
      await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThanOrEqual(2);
      await expect(search).toHaveValue(number);
      expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(storageBefore);
    }

    await search.fill('PL!HS-bp1-019-SECL');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.effect-text')).toHaveText('-');
    await expect(card.locator('.effect-read-more')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}
