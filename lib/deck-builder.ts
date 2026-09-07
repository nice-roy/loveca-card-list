import type { Card } from '../app/data/schema';

export const BUILDER_STORAGE_KEY = 'loveca-card-list:deck-builder:v1';

export type DeckQuantities = Record<string, number>;
export type DeckEntry = { id: string; quantity: number; card: Card };
export type DeckMetric = 'cost' | 'score';
export type DeckGroup = { value: number | null; quantity: number; entries: DeckEntry[] };
export type BuilderState = {
  version: 1;
  candidates: string[];
  deck: DeckQuantities;
};

export function normalizeBuilderState(value: unknown, validIds: Set<string>): BuilderState {
  const empty: BuilderState = { version: 1, candidates: [], deck: {} };
  if (!value || typeof value !== 'object') return empty;

  const saved = value as { candidates?: unknown; deck?: unknown };
  const candidates = Array.isArray(saved.candidates)
    ? [...new Set(saved.candidates.filter((id): id is string => typeof id === 'string' && validIds.has(id)))]
    : [];
  const deck: DeckQuantities = {};

  if (saved.deck && typeof saved.deck === 'object' && !Array.isArray(saved.deck)) {
    for (const [id, quantity] of Object.entries(saved.deck)) {
      if (!validIds.has(id) || typeof quantity !== 'number' || !Number.isFinite(quantity)) continue;
      const normalizedQuantity = Math.floor(quantity);
      if (normalizedQuantity > 0) deck[id] = normalizedQuantity;
    }
  }

  return { version: 1, candidates, deck };
}

export function changeDeckQuantity(deck: DeckQuantities, id: string, delta: number) {
  const next = { ...deck };
  const quantity = Math.max(0, (next[id] ?? 0) + delta);
  if (quantity === 0) delete next[id];
  else next[id] = quantity;
  return next;
}

function compareNullable(left: string | number | null, right: string | number | null, direction: 'asc' | 'desc' = 'asc') {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'ja', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

export function groupDeckEntriesByMetric(entries: DeckEntry[], metric: DeckMetric): DeckGroup[] {
  const groups = new Map<number | null, DeckEntry[]>();

  for (const entry of entries) {
    const value = metric === 'cost'
      ? entry.card.member?.cost ?? null
      : entry.card.live?.score ?? null;
    groups.set(value, [...(groups.get(value) ?? []), entry]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => compareNullable(left, right))
    .map(([value, groupedEntries]) => ({
      value,
      quantity: groupedEntries.reduce((sum, entry) => sum + entry.quantity, 0),
      entries: [...groupedEntries].sort((left, right) => compareNullable(left.id, right.id)),
    }));
}

const heartColorLabels: Record<string, string> = {
  pink: '桃',
  red: '赤',
  yellow: '黄',
  green: '緑',
  blue: '青',
  purple: '紫',
  any: '無色',
};

function formatHearts(values: { color: string | null; count: number }[]) {
  if (!values.length) return 'なし';
  return values.map((value) => `${heartColorLabels[value.color ?? 'any'] ?? value.color ?? '無色'}×${value.count}`).join(' / ');
}

function splitDeckEntries(entries: DeckEntry[]) {
  const members = groupDeckEntriesByMetric(entries.filter((entry) => entry.card.cardType === 'member'), 'cost').flatMap((group) => group.entries);
  const lives = groupDeckEntriesByMetric(entries.filter((entry) => entry.card.cardType === 'live'), 'score').flatMap((group) => group.entries);
  return { members, lives };
}

export function createDeckRecipeText(entries: DeckEntry[]) {
  const { members, lives } = splitDeckEntries(entries);
  const memberTotal = members.reduce((sum, entry) => sum + entry.quantity, 0);
  const liveTotal = lives.reduce((sum, entry) => sum + entry.quantity, 0);
  const formatLines = (items: DeckEntry[]) => items.length
    ? items.map((entry) => `${entry.card.name} / ${entry.id} ×${entry.quantity}`).join('\n')
    : '（なし）';

  return [
    '【ラブカ デッキレシピ】',
    '',
    `合計：${memberTotal + liveTotal}枚`,
    `メンバー：${memberTotal}枚`,
    `ライブ：${liveTotal}枚`,
    '',
    '■ メンバーカード',
    formatLines(members),
    '',
    '■ ライブカード',
    formatLines(lives),
  ].join('\n');
}

export function createAiConsultationText(entries: DeckEntry[]) {
  const { members, lives } = splitDeckEntries(entries);
  const memberTotal = members.reduce((sum, entry) => sum + entry.quantity, 0);
  const liveTotal = lives.reduce((sum, entry) => sum + entry.quantity, 0);
  const total = memberTotal + liveTotal;
  const memberBlocks = members.length ? members.map((entry) => [
    `・${entry.card.name} / ${entry.id} ×${entry.quantity}`,
    `  COST：${entry.card.member?.cost ?? '不明'}`,
    `  基本ハート：${formatHearts(entry.card.member?.hearts ?? [])}`,
    `  ブレードハート：${formatHearts(entry.card.member?.bladeHearts ?? [])}`,
    `  ブレード：${entry.card.member?.yell.count ?? '不明'}`,
    `  効果：${entry.card.effectText ?? '記載なし'}`,
  ].join('\n')).join('\n\n') : '（なし）';
  const liveBlocks = lives.length ? lives.map((entry) => [
    `・${entry.card.name} / ${entry.id} ×${entry.quantity}`,
    `  SCORE：${entry.card.live?.score ?? '不明'}`,
    `  必要ハート：${formatHearts(entry.card.live?.requiredHearts ?? [])}`,
    `  効果：${entry.card.effectText ?? '記載なし'}`,
  ].join('\n')).join('\n\n') : '（なし）';

  return [
    '以下はラブライブ！オフィシャルカードゲームの現在作成中のデッキです。',
    '記載されたカード情報を基準にデッキを分析してください。',
    '現在の採用カードをできるだけ尊重しながら、',
    '・構成の長所と弱点',
    '・増やす候補',
    '・減らす／抜く候補',
    '・残り枠に入れる候補',
    '・その理由',
    'を提案してください。',
    '不明なカード効果を推測しないでください。',
    `現在の合計は${total}枚です。未完成の場合は、想定する完成枚数を確認したうえで残り枠について提案してください。`,
    '',
    '【現在のデッキ】',
    `合計：${total}枚`,
    `メンバー：${memberTotal}枚`,
    `ライブ：${liveTotal}枚`,
    '',
    '■ メンバーカード',
    memberBlocks,
    '',
    '■ ライブカード',
    liveBlocks,
  ].join('\n');
}
