import { readFile } from 'node:fs/promises';

const API_BASE = 'https://llofficial-cardgame.com/manage';
const CARDS_PATH = new URL('../app/data/cards.json', import.meta.url);
const heartFields = [
  ['heart01', 'pink'], ['heart02', 'red'], ['heart03', 'yellow'], ['heart04', 'green'],
  ['heart05', 'blue'], ['heart06', 'purple'], ['heart0', 'any'],
];

async function fetchJson(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function sourceHearts(card) {
  return heartFields.flatMap(([field, color]) => {
    const count = Number(card[field] ?? 0);
    return Number.isFinite(count) && count > 0 ? [{ color, count }] : [];
  });
}

const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
const first = await fetchJson('/card-list-user/list', { page: 1, per_page: 100, sort: 'new' });
const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, index) =>
  fetchJson('/card-list-user/list', { page: index + 2, per_page: 100, sort: 'new' })));
const officialByNumber = new Map([first, ...pages].flatMap((page) => page.items ?? []).map((card) => [card.card_number, card]));

const missingOfficial = [];
const heartMismatches = [];
const flattenedEffects = [];
for (const card of cards) {
  const official = officialByNumber.get(card.cardNumber);
  if (!official) {
    missingOfficial.push(card.cardNumber);
    continue;
  }
  const actual = card.member?.hearts ?? card.live?.requiredHearts ?? [];
  const expected = sourceHearts(official);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) heartMismatches.push({ cardNumber: card.cardNumber, expected, actual });
  if (/[♥◇]/.test(card.effectText ?? '')) flattenedEffects.push({
    cardNumber: card.cardNumber,
    masterText: card.effectText,
    officialText: official.text,
  });
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

function sourceBladeHearts(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return [];
  if (/全|ALL/i.test(text)) return [{ color: 'any', count: Number(text.match(/\d+/)?.[0] ?? 1) }];
  const colorByLabel = { 桃: 'pink', 赤: 'red', 黄: 'yellow', 緑: 'green', 青: 'blue', 紫: 'purple', 無: 'any' };
  const totals = new Map();
  for (const match of text.matchAll(/([桃赤黄緑青紫無])(\d+)/g)) {
    const color = colorByLabel[match[1]];
    totals.set(color, (totals.get(color) ?? 0) + Number(match[2]));
  }
  return [...totals].map(([color, count]) => ({ color, count }));
}

let bladeHeartMismatches = [];
if (process.argv.includes('--details')) {
  const memberCards = cards.filter((card) => card.cardType === 'member');
  const details = await mapConcurrent(memberCards, 12, async (card) => {
    const response = await fetchJson('/card-list-user/detail', { cardno: card.cardNumber });
    return { card, official: response.card };
  });
  bladeHeartMismatches = details.flatMap(({ card, official }) => {
    const expected = sourceBladeHearts(official.blade_heart);
    const actual = card.member?.bladeHearts ?? [];
    return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [{ cardNumber: card.cardNumber, expected, actual }];
  });
}

console.log(JSON.stringify({
  officialRecordCount: officialByNumber.size,
  masterRecordCount: cards.length,
  missingOfficial,
  heartMismatches,
  bladeHeartMismatches,
  flattenedEffects,
}, null, 2));

if (missingOfficial.length || heartMismatches.length || bladeHeartMismatches.length) process.exitCode = 1;
