import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API_BASE = 'https://llofficial-cardgame.com/manage';
const OFFICIAL_SEARCH = 'https://llofficial-cardgame.com/cardlist/searchresults/';
const CARDS_PATH = new URL('../app/data/cards.json', import.meta.url);
const REFERENCES_PATH = new URL('../app/data/reference-data.json', import.meta.url);
const AUDIT_PATH = new URL('../app/data/live-card-audit.json', import.meta.url);
const WRITE = process.argv.includes('--write');
const AUDIT_DATE = '2026-09-09';

const heartFields = [
  ['heart01', 'pink'], ['heart02', 'red'], ['heart03', 'yellow'], ['heart04', 'green'],
  ['heart05', 'blue'], ['heart06', 'purple'], ['heart0', 'any'],
];
const officialUnitToGroupId = new Map([
  ['Liella!', 'liella'], ['Aqours', 'aqours'], ["μ's", 'muse'],
  ['A-RISE', 'a-rise'], ['Saint Snow', 'saint-snow'], ['Sunny Passion', 'sunny-passion'],
  ['虹ヶ咲学園スクールアイドル同好会', 'nijigasaki'], ['蓮ノ空女学院スクールアイドルクラブ', 'hasunosora'],
]);

function stableId(prefix, label) {
  return `${prefix}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;
}

async function fetchJson(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
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

async function fetchOfficialLiveSummaries() {
  const firstPage = await fetchJson('/card-list-user/list', { page: 1, per_page: 100, sort: 'new' });
  const pageCount = Math.ceil(firstPage.total / 100);
  const pages = await mapConcurrent(Array.from({ length: pageCount - 1 }, (_, index) => index + 2), 3,
    (page) => fetchJson('/card-list-user/list', { page, per_page: 100, sort: 'new' }));
  return [firstPage, ...pages].flatMap((page) => page.items ?? []).filter((card) => card.card_kind === 'ライブ');
}

function hearts(card) {
  return heartFields.flatMap(([field, color]) => {
    const count = Number(card[field] ?? 0);
    return Number.isFinite(count) && count > 0 ? [{ color, count }] : [];
  });
}

function nullableNumber(value) {
  const number = Number(value);
  return String(value ?? '').trim() !== '' && Number.isFinite(number) ? number : null;
}

function splitOfficialUnits(unitName) {
  return String(unitName ?? '').split('/').map((unit) => unit.trim()).filter((unit) => unit && unit !== '-');
}

function classificationFor(card) {
  const workTitle = String(card.work_title ?? '').trim();
  if (workTitle === '虹ヶ咲') return 'nijigasaki';
  if (workTitle === '蓮ノ空') return 'hasunosora';
  const units = splitOfficialUnits(card.unit_name);
  if (units.includes('AiScReam')) return 'series-cross-special';
  const groupIds = units.map((unit) => officialUnitToGroupId.get(unit)).filter(Boolean);
  if (groupIds.includes('nijigasaki')) return 'nijigasaki';
  if (groupIds.includes('hasunosora')) return 'hasunosora';
  if (groupIds.length > 1) return 'multiple-groups';
  if (groupIds.length === 1) return 'existing-group';
  return 'special-unclassified';
}

function displayGroupIdsFor(card) {
  const groupIds = splitOfficialUnits(card.unit_name).map((unit) => officialUnitToGroupId.get(unit)).filter(Boolean);
  return groupIds.length ? [...new Set(groupIds)] : ['other-live'];
}

function toCard(source, productIdByLabel) {
  const cardNumber = String(source.card_number).trim();
  return {
    id: `loveca-card:${cardNumber.toLocaleLowerCase('en-US')}`,
    cardNumber,
    name: String(source.card_name).trim(),
    cardType: 'live',
    groupIds: displayGroupIdsFor(source),
    memberIds: [],
    productId: productIdByLabel.get(source.expansion_name),
    rarity: String(source.rare ?? '').trim() || null,
    image: { url: null, alt: null },
    officialUrl: `${OFFICIAL_SEARCH}?cardno=${encodeURIComponent(cardNumber)}&sort=no&view=text`,
    effectText: String(source.text ?? '').trim() || null,
    tags: [],
    member: null,
    live: { requiredHearts: hearts(source), score: nullableNumber(source.blade_heart) },
  };
}

const cardsOnDisk = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
const references = JSON.parse(await readFile(REFERENCES_PATH, 'utf8'));
let priorAudit = null;
try {
  priorAudit = JSON.parse(await readFile(AUDIT_PATH, 'utf8'));
} catch {
  // The first audit has no prior snapshot.
}
const priorBaseline = priorAudit?.baseline;
const priorCards = Number.isInteger(priorBaseline?.cardCount) ? cardsOnDisk.slice(0, priorBaseline.cardCount) : null;
const cards = priorCards && createHash('sha256').update(JSON.stringify(priorCards)).digest('hex') === priorBaseline.cardsPrefixSha256
  ? priorCards
  : cardsOnDisk;
const officialSummaries = await fetchOfficialLiveSummaries();
const masterLives = cards.filter((card) => card.cardType === 'live');
const masterNumbers = new Set(masterLives.map((card) => card.cardNumber));
const officialNumbers = new Set(officialSummaries.map((card) => card.card_number));
const duplicateOfficialNumbers = officialSummaries.map((card) => card.card_number)
  .filter((number, index, all) => all.indexOf(number) !== index);
const missingSummaries = officialSummaries.filter((card) => !masterNumbers.has(card.card_number));
const masterOnly = masterLives.filter((card) => !officialNumbers.has(card.cardNumber)).map((card) => card.cardNumber);
const missingDetails = await mapConcurrent(missingSummaries, 4, async (summary) => {
  const data = await fetchJson('/card-list-user/detail', { id: summary.id });
  return { ...data.card, expansion_name: summary.expansion_name || data.expansion?.name || '' };
});
const approvedDetails = missingDetails.filter((card) => ['special-unclassified', 'series-cross-special'].includes(classificationFor(card)));
const productIdByLabel = new Map(references.products.map((product) => [product.label, product.id]));
for (const label of new Set(approvedDetails.map((card) => card.expansion_name).filter(Boolean))) {
  if (!productIdByLabel.has(label)) productIdByLabel.set(label, stableId('product', label));
}
const additions = approvedDetails.map((card) => toCard(card, productIdByLabel));
const duplicateAdditions = additions.map((card) => card.cardNumber).filter((number, index, all) => all.indexOf(number) !== index);
const invalidAdditions = additions.filter((card) => !card.cardNumber || !card.name || !card.productId || !card.live || card.member || !card.groupIds.length);
if (duplicateOfficialNumbers.length || duplicateAdditions.length || invalidAdditions.length || masterOnly.length) {
  throw new Error(JSON.stringify({ duplicateOfficialNumbers, duplicateAdditions, invalidAdditions: invalidAdditions.map((card) => card.cardNumber), masterOnly }, null, 2));
}

const audit = {
  format: 'loveca-card-list-live-audit',
  version: 1,
  auditedAt: AUDIT_DATE,
  officialSource: 'https://llofficial-cardgame.com/manage/card-list-user/list (全件取得後、card_kind=ライブを抽出)',
  baseline: { cardCount: cards.length, liveCount: masterLives.length, cardsPrefixSha256: createHash('sha256').update(JSON.stringify(cards)).digest('hex') },
  officialLiveCards: officialSummaries.map((card) => ({ id: card.id, cardNumber: card.card_number, name: card.card_name })),
  missing: missingDetails.map((card) => ({
    id: card.id, cardNumber: card.card_number, name: card.card_name, product: card.expansion_name,
    rarity: card.rare, officialUnitName: card.unit_name, officialWorkTitle: card.work_title,
    classification: classificationFor(card), addedInThisAudit: approvedDetails.some((approved) => approved.id === card.id),
  })),
  excludedFromThisChange: ['nijigasaki', 'hasunosora'],
};

if (WRITE) {
  if (!references.groups.some((group) => group.id === 'other-live')) {
    references.groups.push({ id: 'other-live', label: 'その他ライブ', enabled: true });
  }
  for (const [label, id] of productIdByLabel) {
    if (!references.products.some((product) => product.id === id)) references.products.push({ id, label });
  }
  await writeFile(CARDS_PATH, `${JSON.stringify([...cards, ...additions], null, 2)}\n`, 'utf8');
  await writeFile(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`, 'utf8');
  await writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  officialLiveCount: officialSummaries.length,
  masterLiveCount: masterLives.length,
  matchedCount: officialSummaries.length - missingDetails.length,
  missingCount: missingDetails.length,
  masterOnlyCount: masterOnly.length,
  duplicateOfficialNumbers,
  classifications: Object.fromEntries(['existing-group', 'multiple-groups', 'special-unclassified', 'series-cross-special', 'nijigasaki', 'hasunosora'].map((kind) => [kind, missingDetails.filter((card) => classificationFor(card) === kind).length])),
  additions: additions.map((card) => ({ cardNumber: card.cardNumber, name: card.name, groupIds: card.groupIds })),
  missing: missingDetails.map((card) => ({ cardNumber: card.card_number, name: card.card_name, unitName: card.unit_name, classification: classificationFor(card) })),
}, null, 2));
