import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableId = (prefix, label) => `${prefix}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;
const normalize = name => name.replace(/[\s　]+/g, '');
const groupIds = { "μ's": 'muse', '虹ヶ咲': 'nijigasaki', '蓮ノ空': 'hasunosora' };
const heartFields = { heart01: 'pink', heart02: 'red', heart03: 'yellow', heart04: 'green', heart05: 'blue', heart06: 'purple', heart0: 'any' };
const colors = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 無: 'any' };
function integer(value) {
  assert.match(String(value), /^\d+$/, `Unconfirmed numeric value: ${value}`);
  const n = Number(value); assert.ok(Number.isSafeInteger(n)); return n;
}
function hearts(row) {
  return Object.entries(heartFields).flatMap(([field, color]) => {
    const count = integer(row[field]); return count ? [{ color, count }] : [];
  });
}
function bladeHearts(value) {
  if (value === '-') return [];
  assert.match(value, /^(?:[桃赤黄緑青紫無]\d+)+$/);
  return [...value.matchAll(/([桃赤黄緑青紫無])(\d+)/g)].map(([, color, n]) => ({ color: colors[color], count: integer(n) }));
}

// Offline, append-only importer for this reviewed BP08 snapshot; no image/network access.
export function importSnapshot(cards, references, snapshot) {
  assert.equal(snapshot.format, 'loveca-bp08-official-snapshot');
  assert.equal(snapshot.product.code, 'BP08');
  assert.equal(snapshot.product.releaseDate, '2026.11.14');
  assert.ok(snapshot.product.releaseDate.replaceAll('.', '-') <= snapshot.asOf);
  assert.equal(snapshot.baseline.count, 1913);
  assert.equal(digest(cards.slice(0, snapshot.baseline.count)), snapshot.baseline.cardsSha256, 'Existing cards changed');
  assert.equal(snapshot.cards.length, 141);
  assert.equal(snapshot.excludedEnergy.length, 31);
  assert.equal(snapshot.officialTotal, 172);
  const all = [...snapshot.cards, ...snapshot.excludedEnergy];
  assert.equal(new Set(all.map(c => c.id)).size, 172);
  assert.equal(new Set(all.map(c => c.card_number)).size, 172);
  assert.ok(snapshot.excludedEnergy.every(c => c.card_kind === 'エネルギー'));
  const refs = structuredClone(references);
  const product = { id: stableId('product', snapshot.product.label), label: snapshot.product.label };
  const combination = '矢澤にこ&宮下 愛&セラス 柳田 リリエンフェルト';
  const member = { id: stableId('member', combination), label: combination, groupId: 'muse', groupIds: ['muse', 'nijigasaki', 'hasunosora'] };
  for (const [key, item] of [['products', product], ['members', member]]) {
    const existing = refs[key].find(x => x.id === item.id || normalize(x.label) === normalize(item.label));
    if (existing) assert.deepEqual(existing, item); else refs[key].push(item);
  }
  const originalRefs = structuredClone(refs);
  originalRefs.products = originalRefs.products.filter(p => p.id !== product.id);
  originalRefs.members = originalRefs.members.filter(m => m.id !== member.id);
  assert.equal(digest(originalRefs), snapshot.baseline.referencesSha256, 'Existing references changed');
  const mapped = snapshot.cards.map(row => {
    assert.equal(row.expansion, 'BP08');
    assert.ok(['メンバー', 'ライブ'].includes(row.card_kind));
    assert.ok(row.card_number && row.card_name && row.rare);
    const groups = row.group_name.split('/').map(g => { assert.ok(groupIds[g], `Unknown group: ${g}`); return groupIds[g]; });
    const isMember = row.card_kind === 'メンバー';
    const person = isMember ? refs.members.find(m => normalize(m.label) === normalize(row.card_name) && groups.includes(m.groupId)) : null;
    if (isMember) assert.ok(person, `Unknown member: ${row.card_name}`);
    return {
      id: `loveca-card:${row.card_number.toLocaleLowerCase('en-US')}`, cardNumber: row.card_number,
      name: row.card_name.trim(), cardType: isMember ? 'member' : 'live', groupIds: groups,
      memberIds: person ? [person.id] : [], productId: product.id, rarity: row.rare,
      image: { url: null, alt: null },
      officialUrl: `https://llofficial-cardgame.com/cardlist/searchresults/?cardno=${encodeURIComponent(row.card_number)}&sort=no&view=text`,
      effectText: row.text.trim() || null, tags: [],
      member: isMember ? { cost: integer(row.cost), hearts: hearts(row), bladeHearts: bladeHearts(row.blade_heart), yell: { count: row.attack === '-' ? null : integer(row.attack) } } : null,
      live: isMember ? null : { requiredHearts: hearts(row), score: integer(row.blade_heart) },
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
  const result = importSnapshot(await read('../app/data/cards.json'), await read('../app/data/reference-data.json'), await read('../docs/bp08/official-bp08.json'));
  if (process.argv.includes('--write')) {
    await writeFile(new URL('../app/data/cards.json', import.meta.url), `${JSON.stringify(result.cards, null, 2)}\n`);
    await writeFile(new URL('../app/data/reference-data.json', import.meta.url), `${JSON.stringify(result.references, null, 2)}\n`);
  }
  console.log(JSON.stringify({ mode: process.argv.includes('--write') ? 'write' : 'dry-run', added: result.added, total: result.cards.length }));
}
