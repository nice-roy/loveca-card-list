import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Same IDs and field mapping as import-muse; append only, using the reviewed
// text-only official snapshot. This importer never fetches images or services.
const heartFields = [['heart01', 'pink'], ['heart02', 'red'], ['heart03', 'yellow'],
  ['heart04', 'green'], ['heart05', 'blue'], ['heart06', 'purple'], ['heart0', 'any']];
const colors = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 無: 'any' };
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableId = (prefix, label) => `${prefix}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;
const normalizedName = (label) => label.replace(/[\s　]+/g, '');

export function officialInteger(value) {
  assert.match(String(value), /^\d+$/, `Unconfirmed numeric value: ${value}`);
  const result = Number(value);
  assert.ok(Number.isSafeInteger(result));
  return result;
}

function hearts(source) {
  return heartFields.flatMap(([field, color]) => {
    const count = officialInteger(source[field]);
    return count ? [{ color, count }] : [];
  });
}

function bladeHearts(value) {
  if (value === '-') return [];
  assert.match(value, /^(?:[桃赤黄緑青紫無]\d+)+$/);
  const totals = new Map();
  for (const [, label, digits] of value.matchAll(/([桃赤黄緑青紫無])(\d+)/g)) {
    const color = colors[label];
    totals.set(color, (totals.get(color) ?? 0) + officialInteger(digits));
  }
  return [...totals].map(([color, count]) => ({ color, count }));
}

export function importSnapshot(cards, references, snapshot) {
  assert.equal(snapshot.format, 'loveca-c1-official-snapshot');
  assert.equal(snapshot.product.code, 'PBLL02');
  assert.equal(snapshot.product.releaseDate, '2026.10.03');
  assert.ok(snapshot.product.releaseDate.replaceAll('.', '-') <= snapshot.asOf);
  assert.equal(digest(cards.slice(0, snapshot.baseline.count)), snapshot.baseline.cardsSha256,
    'Existing cards changed: re-audit before applying');
  const refs = structuredClone(references);
  const product = { id: stableId('product', snapshot.product.label), label: snapshot.product.label };
  const existingProduct = refs.products.find(p => p.id === product.id || p.label === product.label);
  if (existingProduct) assert.deepEqual(existingProduct, product);
  else refs.products.push(product);

  const pairLabel = '星空 凛&小泉花陽';
  const pair = { id: stableId('member', pairLabel), label: pairLabel, groupId: 'muse' };
  const existingPair = refs.members.find(m => m.id === pair.id || normalizedName(m.label) === normalizedName(pairLabel));
  if (existingPair) assert.deepEqual(existingPair, pair);
  else refs.members.push(pair);
  // Removing exactly the two known additions must recover all prior references.
  const originalRefs = structuredClone(refs);
  originalRefs.products = originalRefs.products.filter(p => p.id !== product.id);
  originalRefs.members = originalRefs.members.filter(m => m.id !== pair.id);
  assert.equal(digest(originalRefs), snapshot.baseline.referencesSha256);

  assert.equal(snapshot.cards.length, 96);
  assert.equal(new Set(snapshot.cards.map(c => c.card_number)).size, 96);
  assert.equal(new Set(snapshot.cards.map(c => c.id)).size, 96);
  const mapped = snapshot.cards.map(source => {
    assert.equal(source.expansion, 'PBLL02');
    assert.equal(source.work_title, "μ's");
    assert.ok(['メンバー', 'ライブ'].includes(source.card_kind));
    assert.ok(source.card_number && source.card_name && source.rare);
    const isMember = source.card_kind === 'メンバー';
    const member = isMember ? refs.members.find(m => m.groupId === 'muse'
      && normalizedName(m.label) === normalizedName(source.card_name)) : null;
    if (isMember) assert.ok(member, `Unknown member: ${source.card_name}`);
    return {
      id: `loveca-card:${source.card_number.toLocaleLowerCase('en-US')}`,
      cardNumber: source.card_number,
      name: source.card_name.trim(),
      cardType: isMember ? 'member' : 'live',
      groupIds: ['muse'],
      memberIds: member ? [member.id] : [],
      productId: product.id,
      rarity: source.rare,
      image: { url: null, alt: null },
      officialUrl: `https://llofficial-cardgame.com/cardlist/searchresults/?cardno=${encodeURIComponent(source.card_number)}&sort=no&view=text`,
      effectText: source.text.trim() || null,
      tags: [],
      member: isMember ? {
        cost: officialInteger(source.cost), hearts: hearts(source), bladeHearts: bladeHearts(source.blade_heart),
        // Historical field name: yell.count stores the printed blade count.
        yell: { count: source.attack === '-' ? null : officialInteger(source.attack) },
      } : null,
      live: isMember ? null : { requiredHearts: hearts(source), score: officialInteger(source.blade_heart) },
    };
  });
  const result = [...cards];
  for (const card of mapped) {
    const matches = result.filter(c => c.id === card.id || c.cardNumber === card.cardNumber);
    assert.ok(matches.length <= 1, `Duplicate identity: ${card.cardNumber}`);
    if (matches.length) assert.deepEqual(matches[0], card, `Existing version conflict: ${card.cardNumber}`);
    else result.push(card);
  }
  assert.equal(result.length, snapshot.baseline.count + mapped.length);
  assert.equal(new Set(result.map(c => c.id)).size, result.length);
  assert.equal(new Set(result.map(c => c.cardNumber)).size, result.length);
  return { cards: result, references: refs, added: result.length - cards.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
  const cards = await read('../app/data/cards.json');
  const refs = await read('../app/data/reference-data.json');
  const snapshot = await read('../docs/c1/official-pbll02.json');
  const result = importSnapshot(cards, refs, snapshot);
  if (process.argv.includes('--write')) {
    await writeFile(new URL('../app/data/cards.json', import.meta.url), `${JSON.stringify(result.cards, null, 2)}\n`);
    await writeFile(new URL('../app/data/reference-data.json', import.meta.url), `${JSON.stringify(result.references, null, 2)}\n`);
  }
  console.log(JSON.stringify({ mode: process.argv.includes('--write') ? 'write' : 'dry-run', added: result.added,
    total: result.cards.length, member: result.cards.filter(c => c.member).length,
    live: result.cards.filter(c => c.live).length, products: result.references.products.length }, null, 2));
}
