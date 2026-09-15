import {expect, test, type Page} from '@playwright/test';

const viewportHeight = 667;

async function openScenario(page: Page, name: string) {
  await page.getByRole('button', {name: new RegExp(`^${name}`)}).click();
  await page.locator('.sync-preview-entry .cloud-sync-button').click();
  return page.getByRole('dialog', {name: 'クラウド同期'});
}

async function expectScrollableToClose(page: Page) {
  const dialog = page.getByRole('dialog', {name: 'クラウド同期'});
  const metrics = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    };
  });

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);

  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const close = dialog.getByRole('button', {name: '閉じる', exact: true});
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
  await close.click();
  await expect(dialog).toBeHidden();
}

test.describe('同期UI mockのスマホ内スクロール', () => {
  test.use({viewport: {width: 375, height: viewportHeight}});

  test.beforeEach(async ({page}) => {
    await page.goto('/sync-ui-preview');
    await expect(page.getByRole('heading', {name: 'クラウド同期UI 安全確認'})).toBeVisible();
  });

  test('未保存状態でも最下部の閉じるへ到達できる', async ({page}) => {
    await openScenario(page, '未保存変更あり');
    await expect(page.getByText('この端末に未保存の変更があります。')).toBeVisible();
    await expectScrollableToClose(page);
  });

  test('詳細情報を展開しても最下部の閉じるへ到達できる', async ({page}) => {
    const dialog = await openScenario(page, '同期済み');
    await dialog.getByText('詳細情報', {exact: true}).click();
    await expect(dialog.getByText('クラウド最終更新')).toBeVisible();
    await expect(dialog.getByText('この端末の最終同期')).toBeVisible();
    await expect(dialog.getByText('revision', {exact: true})).toBeVisible();
    await expectScrollableToClose(page);
  });

  test('保存履歴が複数あっても最下部の閉じるへ到達できる', async ({page}) => {
    const dialog = await openScenario(page, '保存履歴あり');
    await expect(dialog.getByRole('button', {name: '内容を見る'})).toHaveCount(2);
    await expectScrollableToClose(page);
  });

  test('保存・読み込みの方向と同期解除の影響範囲を明示する', async ({page}) => {
    const dialog = await openScenario(page, '同期済み');
    await expect(dialog.getByRole('button', {name: /クラウドへ保存/})).toContainText('この端末 → クラウド');
    await expect(dialog.getByRole('button', {name: /クラウドから読み込み/})).toContainText('クラウド → この端末');

    await dialog.getByRole('button', {name: 'この端末の同期を解除'}).click();
    const confirmation = page.getByRole('dialog', {name: 'この端末の同期を解除しますか？'});
    await expect(confirmation).toContainText('この端末と同期コードの関連付けだけを解除します。');
    await expect(confirmation).toContainText('クラウド上の同期データと、この端末のデッキ・候補・所持カードは削除されません。');
    await expect(confirmation).toContainText('ほかの端末の同期にも影響しません。');
    await confirmation.getByRole('button', {name: 'キャンセル'}).click();
    await expect(confirmation).toBeHidden();

    await dialog.getByRole('button', {name: 'この端末の同期を解除'}).click();
    await confirmation.getByRole('button', {name: '同期を解除', exact: true}).click();
    await expect(dialog.getByRole('button', {name: '同期コードを作成'})).toBeVisible();
    await expect(dialog.getByText('この端末のmock同期を解除しました。')).toBeVisible();
  });
});
