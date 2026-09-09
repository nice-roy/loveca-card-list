import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API_BASE = 'https://llofficial-cardgame.com/manage';
const OFFICIAL_SEARCH = 'https://llofficial-cardgame.com/cardlist/searchresults/';
const CARDS_PATH = new URL('../app/data/cards.json', import.meta.url);
const REFERENCES_PATH = new URL('../app/data/reference-data.json', import.meta.url);
const WRITE = process.argv.includes('--write');

const rivals = [
  { id: 'a-rise', label: 'A-RISE', unitName: 'A-RISE', members: ['綺羅ツバサ', '優木あんじゅ', '統堂英玲奈'] },
  { id: 'saint-snow', label: 'Saint Snow', unitName: 'Saint Snow', members: ['鹿角聖良', '鹿角理亞'] },
  { id: 'sunny-passion', label: 'Sunny Passion', unitName: 'Sunny Passion', members: ['柊摩央', '聖澤悠奈'] },
];

const heartFields = [
  ['heart01', 'pink'], ['heart02', 'red'], ['heart03', 'yellow'], ['heart04', 'green'],
  ['heart05', 'blue'], ['heart06', 'purple'], ['heart0', 'any'],
];
const bladeColors = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 無: 'any' };

function stableId(prefix, label) {
  return `${prefix}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;
}

async function fetchJson(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function listByUnitName(unitName) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const data = await fetchJson('/card-list-user/list', { unit_name: unitName, page, per_page: 100, sort: 'new' });
    items.push(...(data.items ?? []));
    if (items.length >= data.total || !data.items?.length) return items;
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function hearts(card) {
  return heartFields.flatMap(([field, color]) => {
    const count = Number(card[field] ?? 0);
    return Number.isFinite(count) && count > 0 ? [{ color, count }] : [];
  });
}

function bladeHearts(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return [];
  if (/全|ALL/i.test(text)) return [{ color: 'any', count: Number(text.match(/\d+/)?.[0] ?? 1) }];
  const totals = new Map();
  for (const match of text.matchAll(/([桃赤黄緑青紫無])(\d+)/g)) {
    const color = bladeColors[match[1]];
    totals.set(color, (totals.get(color) ?? 0) + Number(match[2]));
  }
  return [...totals].map(([color, count]) => ({ color, count }));
}

function nullableNumber(value) {
  const number = Number(value);
  return String(value ?? '').trim() !== '' && Number.isFinite(number) ? number : null;
}

const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
const references = JSON.parse(await readFile(REFERENCES_PATH, 'utf8'));
const summariesByRival = new Map();
const sourceById = new Map();
for (const rival of rivals) {
  const summaries = await listByUnitName(rival.unitName);
  summariesByRival.set(rival.id, summaries);
  for (const summary of summaries.filter((item) => item.card_kind === 'メンバー' || item.card_kind === 'ライブ')) sourceById.set(summary.id, summary);
}
const details = await mapConcurrent([...sourceById.values()], 3, async (summary) => {
  const data = await fetchJson('/card-list-user/detail', { id: summary.id });
  return { ...data.card, expansion_name: summary.expansion_name || data.expansion?.name || '' };
});

const targetCards = details.filter((card) => card.card_kind === 'メンバー' || card.card_kind === 'ライブ');
const memberIdByLabel = new Map(references.members.map((member) => [member.label, member.id]));
for (const rival of rivals) for (const member of rival.members) {
  if (!memberIdByLabel.has(member)) memberIdByLabel.set(member, stableId('member', member));
}
const productIdByLabel = new Map(references.products.map((product) => [product.label, product.id]));
for (const product of new Set(targetCards.map((card) => card.expansion_name).filter(Boolean))) {
  if (!productIdByLabel.has(product)) productIdByLabel.set(product, stableId('product', product));
}

function groupIdsFor(source) {
  const unitName = String(source.unit_name ?? '');
  const ids = rivals.filter((rival) => unitName.split('/').map((value) => value.trim()).includes(rival.unitName)).map((rival) => rival.id);
  if (unitName.split('/').map((value) => value.trim()).includes('Aqours')) ids.unshift('aqours');
  return [...new Set(ids)];
}

const imported = targetCards.map((source) => {
  const isMember = source.card_kind === 'メンバー';
  const cardNumber = String(source.card_number).trim();
  return {
    id: `loveca-card:${cardNumber.toLocaleLowerCase('en-US')}`,
    cardNumber,
    name: String(source.card_name).trim(),
    cardType: isMember ? 'member' : 'live',
    groupIds: groupIdsFor(source),
    memberIds: isMember ? [memberIdByLabel.get(String(source.card_name).trim())] : [],
    productId: productIdByLabel.get(source.expansion_name),
    rarity: String(source.rare ?? '').trim() || null,
    image: { url: null, alt: null },
    officialUrl: `${OFFICIAL_SEARCH}?cardno=${encodeURIComponent(cardNumber)}&sort=no&view=text`,
    effectText: String(source.text ?? '').trim() || null,
    tags: [],
    member: isMember ? { cost: nullableNumber(source.cost), hearts: hearts(source), bladeHearts: bladeHearts(source.blade_heart), yell: { count: nullableNumber(source.attack) } } : null,
    live: isMember ? null : { requiredHearts: hearts(source), score: nullableNumber(source.blade_heart) },
  };
});

const existingNumbers = new Set(cards.map((card) => card.cardNumber));
const existingIds = new Set(cards.map((card) => card.id));
const duplicateNumbers = imported.map((card) => card.cardNumber).filter((number, index, all) => all.indexOf(number) !== index);
const duplicateIds = imported.map((card) => card.id).filter((id, index, all) => all.indexOf(id) !== index);
const invalid = imported.filter((card) => !card.cardNumber || !card.name || !card.productId || card.groupIds.length === 0 ||
  (card.cardType === 'member' && (!card.member || card.live || card.memberIds.length !== 1)) ||
  (card.cardType === 'live' && (!card.live || card.member || card.memberIds.length !== 0)));
const sourceByNumber = new Map(imported.map((card) => [card.cardNumber, card]));
const conflictingExisting = cards.filter((card) => sourceByNumber.has(card.cardNumber) && card.id !== sourceByNumber.get(card.cardNumber).id)
  .map((card) => card.cardNumber);
const additions = imported.filter((card) => !existingNumbers.has(card.cardNumber) && !existingIds.has(card.id));
if (duplicateNumbers.length || duplicateIds.length || conflictingExisting.length || invalid.length) {
  throw new Error(JSON.stringify({ duplicateNumbers, duplicateIds, conflictingExisting, invalid: invalid.map((card) => card.cardNumber) }, null, 2));
}

const sourceBreakdown = Object.fromEntries(rivals.map((rival) => {
  const matching = targetCards.filter((card) => groupIdsFor(card).includes(rival.id));
  return [rival.label, {
    total: matching.length,
    member: matching.filter((card) => card.card_kind === 'メンバー').length,
    live: matching.filter((card) => card.card_kind === 'ライブ').length,
    energyExcluded: summariesByRival.get(rival.id).filter((card) => card.card_kind === 'エネルギー').length,
    cardNumbers: matching.map((card) => card.card_number),
  }];
}));

if (WRITE) {
  const rivalGroupInsertAt = references.groups.findIndex((group) => group.id === 'nijigasaki');
  const missingRivalGroups = rivals.filter((rival) => !references.groups.some((group) => group.id === rival.id));
  references.groups.splice(rivalGroupInsertAt === -1 ? references.groups.length : rivalGroupInsertAt, 0,
    ...missingRivalGroups.map(({ id, label }) => ({ id, label, enabled: true })));
  for (const rival of rivals) {
    for (const member of rival.members) {
      if (!references.members.some((item) => item.label === member)) references.members.push({ id: memberIdByLabel.get(member), label: member, groupId: rival.id });
    }
  }
  for (const [label, id] of productIdByLabel) {
    if (!references.products.some((product) => product.id === id)) references.products.push({ id, label });
  }
  await writeFile(CARDS_PATH, `${JSON.stringify([...cards, ...additions], null, 2)}\n`, 'utf8');
  await writeFile(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  existingTargetCards: imported.length - additions.length,
  officialUnitRecords: details.length,
  sourceBreakdown,
  newCardsRequired: additions.length,
  importedTotal: imported.length,
  memberCount: imported.filter((card) => card.cardType === 'member').length,
  liveCount: imported.filter((card) => card.cardType === 'live').length,
}, null, 2));
