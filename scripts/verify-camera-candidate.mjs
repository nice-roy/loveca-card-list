import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { headersFor } from './camera-response-headers.mjs';

const [photo, mode, address] = process.argv.slice(2);
const trial = mode === '--lan' ? new URL(address) : null;
if (trial && (trial.protocol !== 'https:' || !/^192\.168\.\d+\.\d+$/.test(trial.hostname))) throw Error('Expected local HTTPS trial');
if (!photo) throw Error('Specify the six-card test photo.');
const productionPolicy = headersFor('/')['Content-Security-Policy'];
const cameraPolicy = headersFor('/camera/')['Content-Security-Policy'];
assert.ok(!cameraPolicy.includes("'unsafe-eval'") && cameraPolicy.includes("connect-src 'self'"));
// These policies are response headers on ephemeral loopback listeners only.
const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const expected = ['PL!SP-bp7-023-L', 'PL!SP-pb2-048-L', 'PL!SP-pb1-023-L', 'PL!SP-pb1-001-R', 'PL!SP-sd2-004-SD2', 'PL!SP-pb2-018-R'];
async function verify(directory, policy, kind) {
  const server = trial ? null : await preview({ build: { outDir: directory }, preview: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'loopback-only-headers', configurePreviewServer(s) {
      s.middlewares.use((req, res, next) => {
        const headers = headersFor(new URL(req.url, 'http://localhost').pathname);
        if (kind !== 'private') headers['Content-Security-Policy'] = policy;
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
        next();
      });
    } }],
  });
  const origin = trial?.origin ?? ('http://127.0.0.1:' + server.httpServer.address().port);
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: Boolean(trial) });
  if (kind === 'private') {
    page.on('pageerror', err => console.error(err.message.slice(0, 400)));
    page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text().slice(0, 400)); });
  }
  const unexpected = [], parts = new Set();
  try {
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
      if (url.origin !== origin || req.method() !== 'GET') { unexpected.push(req.method() + ' ' + url.pathname); return route.abort(); }
      if (/\/reference-\d+\.json$/.test(url.pathname)) parts.add(url.pathname);
      return route.continue();
    });
    if (trial) {
      const index = origin + '/camera-engine/data/reference-index.json';
      assert.equal((await page.request.get(index)).status(), 403);
    }
    await page.goto(trial?.href ?? origin);
    const entry = page.getByRole('button', { name: '写真から所持に追加' });
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
    await dialog.getByRole('heading', { name: '版と追加枚数を確認' }).or(dialog.getByText(/^照合できませんでした/)).waitFor({ timeout: 180_000 });
    const error = dialog.getByText(/^照合できませんでした/);
    if (await error.count()) throw Error(await error.innerText());
    assert.equal(parts.size, 6);
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
  } finally { await page.close(); await server?.close(); }
}
try {
  if (!trial) {
    await verify('outputs/camera-candidate', productionPolicy, 'policy');
  }
  await verify('dist', cameraPolicy, 'private');
  console.log('PASS: ' + (trial ? 'authenticated LAN HTTPS trial' : 'local candidate') + ', six index parts, six editions and persisted quantities.');
} finally { await browser.close(); }
