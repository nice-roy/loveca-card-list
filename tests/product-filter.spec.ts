import {expect, test} from '@playwright/test';
import cards from '../app/data/cards.json' with {type: 'json'};

test('収録商品の略号で区別して複数選択・解除できる', async ({page}) => {
  const liella = 'Li-PB1｜プレミアムブースター ラブライブ！スーパースター!!';
  const aqours = 'Aq-PB1｜プレミアムブースター ラブライブ！サンシャイン!!';
  const liellaCount = cards.filter(card => card.productId === 'product:df9035d9276d').length;
  const aqoursCount = cards.filter(card => card.productId === 'product:dd9764e60c7d').length;

  await page.goto('/');
  await page.getByRole('checkbox', {name: '同一カードをまとめる'}).uncheck();
  const results = page.locator('.result-bar strong');
  await expect(results).toHaveText(String(cards.length));
  await page.getByRole('button', {name: '収録商品 すべての商品'}).click();
  await expect(page.getByRole('checkbox', {name: 'BP1｜ブースターパック vol.1', exact: true})).toBeVisible();
  await expect(page.getByRole('checkbox', {name: 'PRカード', exact: true})).toBeVisible();

  await page.getByRole('checkbox', {name: liella, exact: true}).check();
  await expect(results).toHaveText(String(liellaCount));
  await page.getByRole('checkbox', {name: aqours, exact: true}).check();
  await expect(results).toHaveText(String(liellaCount + aqoursCount));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: '収録商品 2件選択中'})).toBeVisible();

  await page.getByRole('button', {name: liella + 'を解除'}).click();
  await expect(results).toHaveText(String(aqoursCount));
  await expect(page.getByRole('button', {name: '収録商品 ' + aqours})).toBeVisible();
  await page.getByRole('button', {name: aqours + 'を解除'}).click();
  await expect(results).toHaveText(String(cards.length));
});

for (const width of [1365, 390]) {
  test(`商品検索・並べ替えで複数選択を保持し操作欄が画面内に収まる ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 667});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    if (width < 600) await page.getByRole('button', {name: '絞り込み', exact: true}).click();
    const trigger = page.getByRole('button', {name: '収録商品 すべての商品', exact: true});
    await trigger.click();
    const dialog = page.getByRole('dialog', {name: '収録商品を選ぶ', exact: true});
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('searchbox', {name: '商品名・略号で検索'});
    const sort = dialog.getByRole('combobox', {name: '商品の並び順'});
    const list = dialog.getByLabel('商品一覧', {exact: true});
    await expect(sort).toHaveValue('numberDesc');
    await expect(list.getByRole('checkbox').first()).toHaveAttribute('aria-label', /^BP8｜/);
    await sort.selectOption('numberAsc');
    await expect(list.getByRole('checkbox').first()).toHaveAttribute('aria-label', /^BP1｜/);
    await sort.selectOption('nameAsc');
    await expect(list.getByRole('checkbox').first()).toHaveAttribute('aria-label', 'PRカード');
    await sort.selectOption('nameDesc');
    await expect(list.getByRole('checkbox').last()).toHaveAttribute('aria-label', 'PRカード');
    await search.fill('ＢＰ８');
    await expect(list.getByRole('checkbox')).toHaveCount(1);
    await list.getByRole('checkbox').check();
    await search.fill('Li');
    await expect(list.getByRole('checkbox')).toHaveCount(4);
    const liella = 'Li-PB1｜プレミアムブースター ラブライブ！スーパースター!!';
    await list.getByRole('checkbox', {name: liella, exact: true}).check();
    await dialog.getByRole('button', {name: '商品検索をクリア'}).click();
    await expect(list.getByRole('checkbox', {checked: true})).toHaveCount(2);
    const beforeHeader = await dialog.locator('.product-picker-header').boundingBox();
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const afterHeader = await dialog.locator('.product-picker-header').boundingBox();
    expect(afterHeader!.y).toBeCloseTo(beforeHeader!.y, 0);
    for (const locator of [dialog, dialog.locator('.product-picker-footer')]) {
      const bounds = await locator.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(668);
    }
    await search.fill('存在しない商品');
    await expect(dialog.getByText('一致する商品がありません。検索語を変えてください。')).toBeVisible();
    await expect(dialog.locator('.product-picker-footer')).toContainText('選択中 2件');
    await dialog.getByRole('button', {name: '完了', exact: true}).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', {name: '収録商品 2件選択中', exact: true}).click();
    await expect(search).toHaveValue('');
    await expect(sort).toHaveValue('nameDesc');
    await expect(list.getByRole('checkbox', {checked: true})).toHaveCount(2);
    await dialog.getByRole('button', {name: 'すべて解除', exact: true}).click();
    await expect(list.getByRole('checkbox', {checked: true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
