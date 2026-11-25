// Measure reference-image matches; this is not a physical-camera accuracy test.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'outputs/private-bp08');
const rows = JSON.parse(await readFile(path.join(folder, 'manifest.json')));
const liveIds = JSON.parse(await readFile(path.join(root, 'app/data/cards.json')))
  .filter(card => card.cardType === 'live').map(card => card.id);
const server = await preview({ root, build: { outDir: 'outputs/camera-candidate' },
  preview: { host: '127.0.0.1', port: 0 } });
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
let browser;
try {
  browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin);
    assert.equal(route.request().method(), 'GET');
    if (url.pathname === '/bp08-check') return route.fulfill({ contentType: 'text/html', body: '<title>Private reference check</title>' });
    return route.continue();
  });
  await page.goto(origin + '/bp08-check');
  await page.evaluate(async liveCardIds => {
    const { createMultiEngine } = await import('/camera-engine/src/multi-engine.mjs');
    window.testEngine = createMultiEngine({ liveCardIds });
    await window.testEngine.initialize();
  }, liveIds);
  const results = [];
  for (const row of rows) {
    const bytes = await readFile(path.join(folder, row.file));
    const matches = await page.evaluate(async encoded => {
      const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      try {
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const box = { id: 'check', x: 0, y: 0, width: canvas.width, height: canvas.height, source: 'manual' };
        const result = await window.testEngine.recognizeRegions(canvas, [box]);
        return result.regions[0].candidates.map(c => c.cardId);
      } finally { bitmap.close(); canvas.width = canvas.height = 0; }
    }, bytes.toString('base64'));
    results.push({ cardNumber: row.cardNumber, rank: matches.includes(row.cardId) ? matches.indexOf(row.cardId) + 1 : null, candidates: matches });
    if (results.length % 25 === 0) console.log(results.length + '/' + rows.length);
  }
  await writeFile(path.join(folder, 'recognition-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ checked: results.length, inCandidates: results.filter(r => r.rank).length,
    first: results.filter(r => r.rank === 1).length, missing: results.filter(r => !r.rank).map(r => r.cardNumber) }));
} finally { await browser?.close(); await server.close(); }
