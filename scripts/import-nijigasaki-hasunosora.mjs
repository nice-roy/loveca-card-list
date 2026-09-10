import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API_BASE = 'https://llofficial-cardgame.com/manage';
const OFFICIAL_SEARCH = 'https://llofficial-cardgame.com/cardlist/searchresults/';
const CARDS_PATH = new URL('../app/data/cards.json', import.meta.url);
const REFERENCES_PATH = new URL('../app/data/reference-data.json', import.meta.url);
const AUDIT_PATH = new URL('../app/data/nijigasaki-hasunosora-audit.json', import.meta.url);
const WRITE = process.argv.includes('--write');
const AUDIT_DATE = '2026-09-10';

const works = [
  { query: 'title_1', groupId: 'muse' },
  { query: 'title_2', groupId: 'aqours' },
  { query: 'title_3', groupId: 'nijigasaki', label: '虹ヶ咲', expectedMember: 396, expectedLive: 58 },
  { query: 'title_4', groupId: 'liella' },
  { query: 'title_5', groupId: 'hasunosora', label: '蓮ノ空', expectedMember: 245, expectedLive: 50 },
];
const targetWorks = works.filter((work) => work.expectedMember);
const officialGroupOrder = works.map((work) => work.groupId);
const heartFields = [
  ['heart01', 'pink'], ['heart02', 'red'], ['heart03', 'yellow'], ['heart04', 'green'],
  ['heart05', 'blue'], ['heart06', 'purple'], ['heart0', 'any'],
];
const bladeColors = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 無: 'any' };
const memberAliases = new Map([
  ['百生吟子', '百生 吟子'],
  ['徒町小鈴', '徒町 小鈴'],
  ['安養寺姫芽', '安養寺 姫芽'],
]);

function stableId(prefix, label) {
  return `${prefix}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`;
}

async function fetchJson(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
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

async function listByWorkTitle(workTitle) {
  const first = await fetchJson('/card-list-user/list', { work_title: workTitle, page: 1, per_page: 100, sort: 'new' });
  const pages = await mapConcurrent(Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, index) => index + 2), 4,
    (page) => fetchJson('/card-list-user/list', { work_title: workTitle, page, per_page: 100, sort: 'new' }));
  return [first, ...pages].flatMap((page) => page.items ?? []);
}

function canonicalMemberName(name) {
  const trimmed = String(name ?? '').trim();
  return memberAliases.get(trimmed) ?? trimmed;
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

function orderedGroupIds(ids) {
  return officialGroupOrder.filter((groupId) => ids.has(groupId));
}

const cardsOnDisk = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
const references = JSON.parse(await readFile(REFERENCES_PATH, 'utf8'));
let priorAudit = null;
try {
  priorAudit = JSON.parse(await readFile(AUDIT_PATH, 'utf8'));
} catch {
  // First import has no prior audit.
}
const priorBaseline = priorAudit?.baseline;
const priorCards = Number.isInteger(priorBaseline?.cardCount) ? structuredClone(cardsOnDisk.slice(0, priorBaseline.cardCount)) : null;
if (priorCards) {
  for (const update of priorAudit.existingCardAffiliationUpdates ?? []) {
    const card = priorCards.find((item) => item.cardNumber === update.cardNumber);
    if (card) card.groupIds = update.before;
  }
}
const baselineCards = priorCards && createHash('sha256').update(JSON.stringify(priorCards)).digest('hex') === priorBaseline.cardsSha256
  ? priorCards
  : cardsOnDisk;
if (baselineCards.length !== 1073 || baselineCards.filter((card) => card.cardType === 'member').length !== 890 || baselineCards.filter((card) => card.cardType === 'live').length !== 183) {
  throw new Error('Expected the verified 1073-card baseline (890 member / 183 live).');
}

const summariesByWork = new Map();
for (const work of works) {
  const summaries = await listByWorkTitle(work.query);
  summariesByWork.set(work.groupId, summaries);
  console.error(`official ${work.groupId}: ${summaries.length}`);
}

const affiliationsByNumber = new Map();
for (const work of works) {
  for (const summary of summariesByWork.get(work.groupId)) {
    if (!affiliationsByNumber.has(summary.card_number)) affiliationsByNumber.set(summary.card_number, new Set());
    affiliationsByNumber.get(summary.card_number).add(work.groupId);
  }
}

const targetSummariesByNumber = new Map();
for (const work of targetWorks) {
  const valid = summariesByWork.get(work.groupId).filter((card) => card.card_kind === 'メンバー' || card.card_kind === 'ライブ');
  const memberCount = valid.filter((card) => card.card_kind === 'メンバー').length;
  const liveCount = valid.filter((card) => card.card_kind === 'ライブ').length;
  if (memberCount !== work.expectedMember || liveCount !== work.expectedLive) {
    throw new Error(`${work.label} official count changed: member=${memberCount}, live=${liveCount}`);
  }
  for (const summary of valid) if (!targetSummariesByNumber.has(summary.card_number)) targetSummariesByNumber.set(summary.card_number, summary);
}

const targetSummaries = [...targetSummariesByNumber.values()];
let completedDetails = 0;
const details = await mapConcurrent(targetSummaries, 10, async (summary) => {
  const data = await fetchJson('/card-list-user/detail', { id: summary.id });
  completedDetails += 1;
  if (completedDetails % 50 === 0 || completedDetails === targetSummaries.length) console.error(`official details: ${completedDetails}/${targetSummaries.length}`);
  return { ...data.card, expansion_name: summary.expansion_name || data.expansion?.name || '' };
});

const memberIdByLabel = new Map(references.members.map((member) => [member.label, member.id]));
const memberGroupsByLabel = new Map();
for (const source of details.filter((card) => card.card_kind === 'メンバー')) {
  const label = canonicalMemberName(source.card_name);
  if (!memberGroupsByLabel.has(label)) memberGroupsByLabel.set(label, new Set());
  for (const groupId of affiliationsByNumber.get(source.card_number) ?? []) memberGroupsByLabel.get(label).add(groupId);
  if (!memberIdByLabel.has(label)) memberIdByLabel.set(label, stableId('member', label));
}

const productIdByLabel = new Map(references.products.map((product) => [product.label, product.id]));
for (const label of new Set(details.map((card) => card.expansion_name).filter(Boolean))) {
  if (!productIdByLabel.has(label)) productIdByLabel.set(label, stableId('product', label));
}

function toCard(source) {
  const cardNumber = String(source.card_number).trim();
  const isMember = source.card_kind === 'メンバー';
  const groupIds = orderedGroupIds(affiliationsByNumber.get(cardNumber) ?? new Set());
  return {
    id: `loveca-card:${cardNumber.toLocaleLowerCase('en-US')}`,
    cardNumber,
    name: String(source.card_name).trim(),
    cardType: isMember ? 'member' : 'live',
    groupIds,
    memberIds: isMember ? [memberIdByLabel.get(canonicalMemberName(source.card_name))] : [],
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
    live: isMember ? null : { requiredHearts: hearts(source), score: nullableNumber(source.blade_heart) },
  };
}

const imported = details.map(toCard);
const importedByNumber = new Map(imported.map((card) => [card.cardNumber, card]));
const existingNumbers = new Set(baselineCards.map((card) => card.cardNumber));
const existingTargetNumbers = [...targetSummariesByNumber.keys()].filter((number) => existingNumbers.has(number));
const additions = imported.filter((card) => !existingNumbers.has(card.cardNumber));
const existingAffiliationUpdates = [];
const preservedCards = baselineCards.map((card) => {
  const official = importedByNumber.get(card.cardNumber);
  if (!official) return card;
  const nextGroupIds = [...new Set([...card.groupIds, ...official.groupIds])];
  if (JSON.stringify(nextGroupIds) === JSON.stringify(card.groupIds)) return card;
  existingAffiliationUpdates.push({ cardNumber: card.cardNumber, before: card.groupIds, after: nextGroupIds });
  return { ...card, groupIds: nextGroupIds };
});

const duplicateTargetNumbers = targetSummaries.map((card) => card.card_number).filter((number, index, all) => all.indexOf(number) !== index);
const duplicateAdditionIds = additions.map((card) => card.id).filter((id, index, all) => all.indexOf(id) !== index);
const invalidAdditions = additions.filter((card) => !card.cardNumber || !card.name || !card.productId || !card.groupIds.length ||
  (card.cardType === 'member' && (!card.member || card.live || card.memberIds.length !== 1 || !card.memberIds[0])) ||
  (card.cardType === 'live' && (!card.live || card.member || card.memberIds.length !== 0)));
if (duplicateTargetNumbers.length || duplicateAdditionIds.length || invalidAdditions.length) {
  throw new Error(JSON.stringify({ duplicateTargetNumbers, duplicateAdditionIds, invalidAdditions: invalidAdditions.map((card) => card.cardNumber) }, null, 2));
}

const groupAudit = Object.fromEntries(targetWorks.map((work) => {
  const official = summariesByWork.get(work.groupId).filter((card) => card.card_kind === 'メンバー' || card.card_kind === 'ライブ');
  const existing = official.filter((card) => existingNumbers.has(card.card_number));
  return [work.groupId, {
    label: work.label,
    officialMemberCount: official.filter((card) => card.card_kind === 'メンバー').length,
    officialLiveCount: official.filter((card) => card.card_kind === 'ライブ').length,
    officialTotal: official.length,
    existingCount: existing.length,
    additionCount: official.length - existing.length,
    cardNumbers: official.map((card) => card.card_number),
  }];
}));
if (groupAudit.nijigasaki.officialLiveCount !== 58 || groupAudit.hasunosora.officialLiveCount !== 50) {
  throw new Error('Live counts do not match the preceding official live-card audit.');
}

const addedProducts = [...productIdByLabel].filter(([label]) => !references.products.some((product) => product.label === label))
  .map(([label, id]) => ({ id, label }));
const audit = {
  format: 'loveca-card-list-nijigasaki-hasunosora-audit',
  version: 1,
  auditedAt: AUDIT_DATE,
  officialSource: 'https://llofficial-cardgame.com/manage/card-list-user/list (work_title=title_3/title_5; member/live only)',
  baseline: {
    cardCount: baselineCards.length,
    memberCount: baselineCards.filter((card) => card.cardType === 'member').length,
    liveCount: baselineCards.filter((card) => card.cardType === 'live').length,
    cardsSha256: createHash('sha256').update(JSON.stringify(baselineCards)).digest('hex'),
  },
  groups: groupAudit,
  uniqueOfficialRecords: targetSummaries.length,
  uniqueExistingRecords: existingTargetNumbers.length,
  uniqueAddedRecords: additions.length,
  existingCardAffiliationUpdates: existingAffiliationUpdates,
  addedProducts,
};

if (WRITE) {
  for (const groupId of ['nijigasaki', 'hasunosora']) {
    const group = references.groups.find((item) => item.id === groupId);
    if (!group) throw new Error(`Missing reserved group metadata: ${groupId}`);
    group.enabled = true;
  }
  for (const [label, groupIds] of memberGroupsByLabel) {
    const existing = references.members.find((member) => member.label === label);
    const ordered = orderedGroupIds(groupIds);
    if (existing) {
      existing.groupIds = [...new Set([...(existing.groupIds ?? [existing.groupId]), ...ordered])];
    } else {
      references.members.push({ id: memberIdByLabel.get(label), label, groupId: ordered.find((id) => id === 'nijigasaki' || id === 'hasunosora') ?? ordered[0], groupIds: ordered });
    }
  }
  references.products.push(...addedProducts);
  await writeFile(CARDS_PATH, `${JSON.stringify([...preservedCards, ...additions], null, 2)}\n`, 'utf8');
  await writeFile(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`, 'utf8');
  await writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  groups: groupAudit,
  uniqueOfficialRecords: targetSummaries.length,
  uniqueExistingRecords: existingTargetNumbers.length,
  uniqueAddedRecords: additions.length,
  addedMemberRecords: additions.filter((card) => card.cardType === 'member').length,
  addedLiveRecords: additions.filter((card) => card.cardType === 'live').length,
  finalCardCount: preservedCards.length + additions.length,
  finalMemberCount: preservedCards.filter((card) => card.cardType === 'member').length + additions.filter((card) => card.cardType === 'member').length,
  finalLiveCount: preservedCards.filter((card) => card.cardType === 'live').length + additions.filter((card) => card.cardType === 'live').length,
  existingAffiliationUpdates,
  addedProducts,
}, null, 2));
