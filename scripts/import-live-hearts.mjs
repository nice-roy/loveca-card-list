import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const colors = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 橙: 'orange', 無: 'any' };
const fields = { heart01: 'pink', heart02: 'red', heart03: 'yellow', heart04: 'green', heart05: 'blue', heart06: 'purple', heart0: 'any' };
const normalizeName = value => value.replaceAll('〜', '～').normalize('NFKC').replace(/\s/g, '');

export function parseLiveHearts(source) {
  assert.equal(source.card_kind, 'ライブ');
  assert.ok(['-', '', 'スコア', 'ドロー'].includes(source.cost), `Unknown special heart: ${source.cost}`);
  let bladeHearts;
  if (source.attack === '-') bladeHearts = [];
  else if (source.attack === 'ALL1' || source.attack === '[全ブレード]') bladeHearts = [{ color: 'all', count: 1 }];
  else {
    assert.match(source.attack, /^(?:[桃赤黄緑青紫橙無][1-9]\d*)+$/, `Unknown blade heart: ${source.attack}`);
    bladeHearts = [...source.attack.matchAll(/([桃赤黄緑青紫橙無])([1-9]\d*)/g)].map(([, color, count]) => ({ color: colors[color], count: Number(count) }));
    assert.ok(bladeHearts.every(value => Number.isSafeInteger(value.count)));
  }
  const specialHeart = source.cost === 'スコア' ? 'score' : source.cost === 'ドロー' ? 'draw' : null;
  // No reviewed live is blank; a blank or newly introduced format requires review.
  assert.ok(bladeHearts.length || specialHeart, `Missing live hearts: ${source.card_number}`);
  return { cardNumber: source.card_number, bladeHearts, specialHeart };
}

export function importLiveHearts(cards, references, snapshot) {
  assert.equal(snapshot.format, 'loveca-live-hearts-official-snapshot');
  assert.equal(digest(cards), snapshot.baseline.cardsSha256, 'Master changed; review before regenerating');
  assert.equal(cards.length, snapshot.baseline.cardCount);
  const sources = snapshot.pages.flatMap(page => page.lives);
  assert.equal(new Set(sources.map(row => row.card_number)).size, sources.length);
  assert.equal(new Set(sources.map(row => row.id)).size, sources.length);
  assert.equal(snapshot.pages.reduce((n, page) => n + page.itemCount, 0), snapshot.officialTotal);
  assert.equal(sources.length, snapshot.officialLiveCount);
  snapshot.pages.forEach((page, index) => {
    assert.equal(page.page, index + 1);
    assert.equal(page.total, snapshot.officialTotal);
    assert.equal(page.per_page, 100);
    assert.equal(page.itemCount, Math.min(100, snapshot.officialTotal - index * 100));
  });
  const byNumber = new Map(sources.map(row => [row.card_number, row]));
  const products = new Map(references.products.map(product => [product.id, product.label]));
  const records = cards.filter(card => card.live).map(card => {
    const source = byNumber.get(card.cardNumber);
    assert.ok(source, `Missing source: ${card.cardNumber}`);
    assert.equal(normalizeName(source.card_name), normalizeName(card.name), card.cardNumber);
    assert.equal(source.expansion_name, products.get(card.productId), card.cardNumber);
    const requiredHearts = Object.entries(fields).flatMap(([field, color]) => {
      assert.match(source[field], /^\d+$/);
      return Number(source[field]) ? [{ color, count: Number(source[field]) }] : [];
    });
    assert.deepEqual(requiredHearts, card.live.requiredHearts, `Required hearts differ: ${card.cardNumber}`);
    return parseLiveHearts(source);
  });
  assert.equal(records.length, snapshot.baseline.liveCount);
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const records = importLiveHearts(await read('../app/data/cards.json'), await read('../app/data/reference-data.json'), await read('../docs/live-hearts/official-live-hearts.json'));
  if (process.argv.includes('--write')) await writeFile(new URL('../app/data/live-hearts.json', import.meta.url), `${JSON.stringify(records, null, 2)}\n`);
  console.log(JSON.stringify({ mode: process.argv.includes('--write') ? 'write' : 'dry-run', liveVersions: records.length }));
}
