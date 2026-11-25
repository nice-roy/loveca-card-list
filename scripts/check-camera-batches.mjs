import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.resolve(root, process.argv[2] ?? 'outputs/private-bp08/batch-photos');
const cases = JSON.parse(await readFile(path.join(folder, 'cases.json')));
const cards = new Map(JSON.parse(await readFile(path.join(root, 'app/data/cards.json'))).map(c => [c.id, c]));
const results = [];
const server = await preview({ root, build: { outDir: 'outputs/camera-candidate' }, preview: {
  host: '127.0.0.1', port: 0, headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'" },
} });
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
let browser;
try {
  browser = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const result = { n: c.n, cols: c.cols, rows: c.rows, matches: [], saved: false };
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.protocol === 'blob:' || url.protocol === 'data:' || (url.origin === origin && route.request().method() === 'GET')) return route.continue();
        return route.abort();
      });
      await page.goto(origin);
      await page.getByRole('button', { name: '写真から所持に追加' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('撮る枚数').selectOption(String(c.n));
      await dialog.getByLabel('並べ方').getByText('横' + c.cols + '枚 × 縦' + c.rows + '段', { exact: true }).waitFor({ state: 'attached' });
      assert.equal(await dialog.getByLabel('並べ方').inputValue(), '0');
      await dialog.getByLabel('保存した写真を選ぶ').setInputFiles(path.join(folder, c.file));
      const svg = dialog.getByRole('img', { name: 'カードの範囲' });
      await svg.scrollIntoViewIfNeeded();
      const b = await svg.boundingBox();
      const mx = c.margin / c.width, my = c.margin / c.height;
      await svg.tap({ position: { x: b.width*mx, y: b.height*my } });
      await svg.locator('circle').waitFor();
      await svg.tap({ position: { x: b.width*(1-mx), y: b.height*(1-my) } });
      await dialog.getByRole('button', { name: c.n + '枚を照合' }).waitFor();
      assert.equal(await svg.locator('g rect').count(), c.n);
      await dialog.getByRole('button', { name: c.n + '枚を照合' }).click();
      await dialog.getByRole('heading', { name: '版と追加枚数を確認' }).waitFor({ timeout: 200000 });
      result.timing = await dialog.locator('.cam-timing > p').first().innerText();
      const rows = dialog.locator('.cam-rows > li');
      assert.equal(await rows.count(), c.n);
      const expected = {};
      for (const [i,id] of c.cards.entries()) {
        const row = rows.nth(i), select = row.getByRole('combobox');
        const candidates = await select.locator('option').evaluateAll(opts => opts.map(o => o.value).filter(Boolean));
        const rank = candidates.indexOf(id) + 1;
        result.matches.push({ id, rank, first: candidates[0] ?? null, preset: await select.inputValue() });
        if (rank) await select.selectOption(id);
        else {
          const card = cards.get(id);
          await row.getByRole('button', { name: '番号・名前で探す' }).click();
          await row.getByRole('searchbox').fill(card.cardNumber);
          const exactCard = row.locator('.cam-search li button').filter({ hasText: new RegExp(card.cardNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
          await exactCard.click();
          assert.equal(await select.inputValue(), id);
        }
        expected[id] = (expected[id] ?? 0) + 1;
      }
      await dialog.getByRole('button', { name: c.n + '枚をまとめて追加' }).click();
      await dialog.getByText('所持枚数に' + c.n + '枚追加しました。').waitFor();
      await dialog.getByRole('button', { name: 'カード一覧に戻る' }).click();
      await page.waitForURL(origin + '/');
      await page.reload();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('loveca-card-list:inventory:v1')).cards), expected);
      result.saved = true;
    } catch (error) { result.error = error.message; }
    finally { await context.close(); }
    results.push(result);
    await writeFile(path.join(folder, 'results.json'), JSON.stringify(results, null, 2));
    console.log(c.n, result.saved ? 'saved' : 'failed', 'first', result.matches.filter(r => r.rank === 1).length, result.error ?? result.timing);
    if (result.error && results.length === 1) throw Error(result.error);
  }
  assert.ok(results.length === cases.length && results.every(r => r.saved));
} finally { await browser?.close(); await server.close(); }
