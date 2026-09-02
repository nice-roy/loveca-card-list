import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://llofficial-cardgame.com/manage';
const OFFICIAL_SEARCH = 'https://llofficial-cardgame.com/cardlist/searchresults/';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CARDS_PATH = new URL('../app/data/cards.json', import.meta.url);
const REFERENCES_PATH = new URL('../app/data/reference-data.json', import.meta.url);
const WRITE = process.argv.includes('--write');
const TARGET_GROUP = 'Aqours';
const TARGET_GROUP_ID = 'aqours';
const AQOURS_MEMBER_ORDER = ['高海千歌', '桜内梨子', '松浦果南', '黒澤ダイヤ', '渡辺 曜', '津島善子', '国木田花丸', '小原鞠莉', '黒澤ルビィ'];

const heartFields = [
  ['heart01', 'pink'],
  ['heart02', 'red'],
  ['heart03', 'yellow'],
  ['heart04', 'green'],
  ['heart05', 'blue'],
  ['heart06', 'purple'],
  ['heart0', 'any'],
];
const bladeColors = { '桃': 'pink', '赤': 'red', '黄': 'yellow', '緑': 'green', '青': 'blue', '紫': 'purple', '無': 'any' };

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

async function getSunshineCards() {
  const items = [];
  for (let page = 1; ; page += 1) {
    const data = await fetchJson('/card-list-user/list', {
      work_title: 'title_2', page, per_page: 100, sort: 'new',
    });
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
      results[index] = await mapper(items[index], index);
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
  if (/全|ALL/i.test(text)) {
    const count = Number(text.match(/\d+/)?.[0] ?? 1);
    return [{ color: 'any', count }];
  }
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
const existingAqours = cards.filter((card) => card.groupIds.includes(TARGET_GROUP_ID));
const preservedCards = cards.filter((card) => !card.groupIds.includes(TARGET_GROUP_ID));
const preservedSnapshot = JSON.stringify(preservedCards);
const preservedNumbers = new Set(preservedCards.map((card) => card.cardNumber));

const summaries = await getSunshineCards();
const details = await mapConcurrent(summaries, 16, async (summary) => {
  const data = await fetchJson('/card-list-user/detail', { id: summary.id });
  return { ...data.card, expansion_name: summary.expansion_name || data.expansion?.name || '' };
});

const aqours = details.filter((card) =>
  card.work_title === TARGET_GROUP && (card.card_kind === 'メンバー' || card.card_kind === 'ライブ'));
const memberLabels = [...new Set(aqours.filter((card) => card.card_kind === 'メンバー').map((card) => card.card_name))]
  .sort((a, b) => AQOURS_MEMBER_ORDER.indexOf(a) - AQOURS_MEMBER_ORDER.indexOf(b));
const productLabels = [...new Set(aqours.map((card) => card.expansion_name).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'ja'));

const memberIdByLabel = new Map(references.members.map((member) => [member.label, member.id]));
for (const label of memberLabels) {
  if (!memberIdByLabel.has(label)) memberIdByLabel.set(label, stableId('member', label));
}
const productIdByLabel = new Map(references.products.map((product) => [product.label, product.id]));
for (const label of productLabels) {
  if (!productIdByLabel.has(label)) productIdByLabel.set(label, stableId('product', label));
}

const imported = aqours.map((source) => {
  const isMember = source.card_kind === 'メンバー';
  const cardNumber = String(source.card_number).trim();
  return {
    id: `loveca-card:${cardNumber.toLocaleLowerCase('en-US')}`,
    cardNumber,
    name: String(source.card_name).trim(),
    cardType: isMember ? 'member' : 'live',
    groupIds: [TARGET_GROUP_ID],
    memberIds: isMember ? [memberIdByLabel.get(String(source.card_name).trim())] : [],
    productId: productIdByLabel.get(source.expansion_name),
    rarity: String(source.rare ?? '').trim() || null,
    image: { url: null, alt: null },
    officialUrl: `${OFFICIAL_SEARCH}?cardno=${encodeURIComponent(cardNumber)}&sort=no&view=text`,
    effectText: String(source.text ?? '').trim() || null,
    tags: [],
    member: isMember ? {
      cost: nullableNumber(source.cost),
      hearts: hearts(source),
      bladeHearts: bladeHearts(source.blade_heart),
      yell: { count: nullableNumber(source.attack) },
    } : null,
    live: isMember ? null : {
      requiredHearts: hearts(source),
      score: nullableNumber(source.blade_heart),
    },
  };
});

const duplicateOfficialNumbers = imported.map((card) => card.cardNumber)
  .filter((number, index, all) => all.indexOf(number) !== index);
const overlaps = imported.filter((card) => preservedNumbers.has(card.cardNumber)).map((card) => card.cardNumber);
const invalid = imported.filter((card) => !card.cardNumber || !card.name || !card.productId ||
  (card.cardType === 'member' && (!card.member || card.live)) ||
  (card.cardType === 'live' && (!card.live || card.member)));
if (duplicateOfficialNumbers.length || overlaps.length || invalid.length) {
  throw new Error(JSON.stringify({ duplicateOfficialNumbers, overlaps, invalid: invalid.map((card) => card.cardNumber) }, null, 2));
}

const memberCount = imported.filter((card) => card.cardType === 'member').length;
const liveCount = imported.filter((card) => card.cardType === 'live').length;
const energyCount = details.filter((card) => card.work_title === TARGET_GROUP && card.card_kind === 'エネルギー').length;
const workTitles = [...new Set(details.map((card) => card.work_title))].sort((a, b) => a.localeCompare(b, 'ja'));

if (WRITE) {
  const aqoursGroup = references.groups.find((group) => group.id === TARGET_GROUP_ID);
  if (!aqoursGroup) throw new Error('Aqours group reference is missing');
  aqoursGroup.enabled = true;
  references.members = [
    ...references.members.filter((member) => member.groupId !== TARGET_GROUP_ID),
    ...memberLabels.map((label) => ({ id: memberIdByLabel.get(label), label, groupId: TARGET_GROUP_ID })),
  ];
  for (const label of productLabels) {
    if (!references.products.some((product) => product.label === label)) {
      references.products.push({ id: productIdByLabel.get(label), label });
    }
  }
  await writeFile(CARDS_PATH, `${JSON.stringify([...preservedCards, ...imported], null, 2)}\n`);
  await writeFile(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`);
  if (JSON.stringify(preservedCards) !== preservedSnapshot) throw new Error('Existing non-Aqours card data changed during import');
}

console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  existingAqoursCards: existingAqours.length,
  sourceTotal: summaries.length,
  sourceWorkTitles: workTitles,
  aqoursTotal: imported.length,
  memberCount,
  liveCount,
  excludedAqoursEnergyCards: energyCount,
  memberLabels,
  productLabels,
  missingRarity: imported.filter((card) => card.rarity === null).length,
  missingMemberStats: imported.filter((card) => card.member && card.member.cost === null).length,
  missingLiveStats: imported.filter((card) => card.live && card.live.score === null).length,
  root: ROOT,
}, null, 2));
