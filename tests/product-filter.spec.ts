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
