// Prepare the expanded private reference set, leaving the tested base intact.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.argv[2];
if (!base || !path.isAbsolute(base)) throw Error('Specify the original 1,913-edition engine directory.');
const work = path.join(root, 'outputs/private-bp08');
const engine = path.join(work, 'engine');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = JSON.parse(await readFile(path.join(root, 'scripts/camera-inputs.json')));
const indexFile = 'data/reference-index.json';
const baseDigest = '1bbd2420cc38e2c0a29953dbd484cbfdfc2d7de8786e90f4aa45c1431483ed6d';
const baseBytes = await readFile(path.join(base, indexFile));
assert.equal(digest(baseBytes), baseDigest);
const index = JSON.parse(baseBytes);
const manifestBytes = await readFile(path.join(work, 'manifest.json'));
const records = JSON.parse(manifestBytes);
const master = JSON.parse(await readFile(path.join(root, 'app/data/cards.json')));
const byId = new Map(master.map(card => [card.id, card.cardNumber]));
const seen = new Set(index.entries.map(entry => entry.cardId));
assert.equal(seen.size, 1913);
assert.equal(records.length, 141);

const assets = new Map();
for (const [file, hash] of Object.entries(pins)) {
  if (file === indexFile) continue;
  const data = await readFile(path.join(base, file));
  assert.equal(digest(data), hash, file);
  assets.set(file, data);
}
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-background-networking'] });
try {
  const page = await browser.newPage();
  const origin = 'http://127.0.0.1';
  const html = '<title>Local reference builder</title><script src="/vendor/opencv/opencv.js"></script>';
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin);
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    const js = assets.get(url.pathname.slice(1));
    return js ? route.fulfill({ contentType: 'text/javascript', body: js }) : route.abort();
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    if (!window.cv.Mat) await new Promise(resolve => window.cv.then(() => resolve()));
    window.extractReference = (await import('/src/visual-features.mjs')).extractFeatures;
  });
  for (const record of records) {
    assert.equal(byId.get(record.cardId), record.cardNumber);
    assert.ok(!seen.has(record.cardId));
    assert.match(record.file, /^images\/[A-Za-z0-9!_+.\-]+\.png$/);
    const image = await readFile(path.join(work, record.file));
    assert.equal(digest(image), record.sha256);
    const features = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      try {
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return window.extractReference(window.cv, canvas);
      } finally { bitmap.close(); canvas.width = canvas.height = 0; }
    }, image.toString('base64'));
    assert.equal(features.version, 1);
    assert.ok(features.count > 0 && features.count <= 400);
    assert.equal(features.keypoints.length, features.count * 2);
    assert.equal(features.coarse.length, 768);
    assert.equal(Buffer.from(features.descriptors, 'base64').length, features.count * 32);
    index.entries.push({ cardId: record.cardId, cardNumber: record.cardNumber, referenceSha256: record.sha256,
      artworkId: null, rightsStatus: 'unverified_for_service_use_and_distribution', publicDistributionAllowed: false, features });
    seen.add(record.cardId);
  }
} finally { await browser.close(); }
assert.equal(seen.size, byId.size);
for (const e of index.entries) assert.equal(byId.get(e.cardId), e.cardNumber);
const provenance = JSON.stringify({ baseIndexSha256: baseDigest, baseManifestSha256: index.sourceManifestSha256,
  bp08ManifestSha256: digest(manifestBytes), masterFileSha256: digest(await readFile(path.join(root, 'app/data/cards.json'))) });
index.baseMasterSha = index.masterSha;
index.masterSha = '972d8b485770206d559aa2411859f858cec92ccd';
index.sourceManifestSha256 = digest(provenance);
index.referenceCount = index.entries.length;
index.updatedThroughProduct = 'BP08';
const bytes = Buffer.from(JSON.stringify(index));
assets.set(indexFile, bytes);
for (const [file, body] of assets) {
  const target = path.join(engine, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target + '.part', body);
  await rename(target + '.part', target);
}
await writeFile(path.join(work, 'source-manifests.json'), provenance);
console.log('Expanded private index:', index.referenceCount, 'editions;', digest(bytes));
