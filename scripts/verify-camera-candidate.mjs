import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const [photo, productionPolicy] = process.argv.slice(2);
if (!photo || !productionPolicy) throw Error('Specify the six-card test photo and the generated Production CSP.');
const cameraPolicy = productionPolicy.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'").replace("img-src 'self' data:", "img-src 'self' data: blob:").replace(/connect-src [^;]+/, "connect-src 'self'");
// These policies are response headers on ephemeral loopback listeners only.
const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const expected = ['PL!SP-bp7-023-L', 'PL!SP-pb2-048-L', 'PL!SP-pb1-023-L', 'PL!SP-pb1-001-R', 'PL!SP-sd2-004-SD2', 'PL!SP-pb2-018-R'];
async function verify(directory, policy, kind) {
  const server = await preview({ build: { outDir: directory }, preview: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'loopback-only-headers', configurePreviewServer(s) {
      s.middlewares.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', req.url?.startsWith('/camera/') ? policy : productionPolicy);
        next();
      });
    } }],
  });
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const unexpected = [], parts = new Set();
  try {
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
      if (url.origin !== origin || req.method() !== 'GET') { unexpected.push(req.method() + ' ' + url.pathname); return route.abort(); }
      if (/\/reference-\d+\.json$/.test(url.pathname)) parts.add(url.pathname);
      return route.continue();
    });
    await page.goto(origin);
    const entry = page.getByRole('button', { name: '写真から所持に追加' });
    if (kind === 'default') {
      await page.locator('.card-item').first().waitFor();
      assert.equal(await entry.count(), 0);
      return;
    }
    if (kind === 'policy') {
      await page.goto(origin + '/camera/');
      const directives = await page.evaluate(async () => {
        const errors = new Set();
        document.addEventListener('securitypolicyviolation', event => errors.add(event.effectiveDirective));
        await fetch('./camera-engine/data/reference-index.json').catch(() => {});
        await new Promise(ok => setTimeout(ok, 50));
        return [...errors];
      });
      assert.ok(directives.includes('connect-src'));
      return;
    }
    await entry.click();
    await page.waitForURL(origin + '/camera/');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('保存した写真を選ぶ').setInputFiles(path.resolve(photo));
    const svg = dialog.getByRole('img', { name: 'カードの範囲' });
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    await svg.tap({ position: { x: box.width * 130/3840, y: Math.max(3, box.height * 20/2160) } });
    await svg.tap({ position: { x: box.width * 3630/3840, y: box.height * 2060/2160 } });
    await dialog.getByRole('button', { name: '6枚を照合' }).click();
    await dialog.getByRole('heading', { name: '版と追加枚数を確認' }).waitFor({ timeout: 180_000 });
    assert.equal(parts.size, 5);
    for (const [i, edition] of expected.entries()) {
      const select = dialog.getByRole('combobox', { name: (i+1) + '番の版', exact: true });
      const option = select.locator('option').filter({ hasText: edition }).first();
      await select.selectOption(await option.getAttribute('value'));
    }
    await dialog.getByRole('button', { name: '6枚をまとめて追加' }).click();
    await dialog.getByText('所持枚数に6枚追加しました。').waitFor();
    await dialog.getByRole('button', { name: 'カード一覧に戻る' }).click();
    await page.waitForURL(origin + '/');
    await page.reload();
    const cards = await page.evaluate(() => JSON.parse(localStorage.getItem('loveca-card-list:inventory:v1')).cards);
    assert.deepEqual(Object.values(cards), [1,1,1,1,1,1]);
    assert.deepEqual(unexpected, []);
  } finally { await page.close(); await server.close(); }
}
try {
  await verify('dist', productionPolicy, 'default');
  await verify('outputs/camera-candidate', productionPolicy, 'policy');
  await verify('outputs/camera-candidate', cameraPolicy, 'private');
  console.log('PASS: default build gate, current Production CSP block, self-contained static recognition, six editions and persisted quantities.');
} finally { await browser.close(); }
