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

export const MAX_DECK_QUANTITY = 4;

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
  const current = next[id] ?? 0;
  if (delta > 0 && current >= MAX_DECK_QUANTITY) return next;
  const quantity = Math.max(0, Math.min(MAX_DECK_QUANTITY, current + delta));
  if (quantity === 0) delete next[id];
  else next[id] = quantity;
  return next;
}

export function removeDeckCardIfSingle(deck: DeckQuantities, id: string) {
  return deck[id] === 1 ? changeDeckQuantity(deck, id, -1) : deck;
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

const effectHeartTokenLabels: Record<string, string> = {
  heart01: '桃ハート',
  heart02: '赤ハート',
  heart03: '黄ハート',
  heart04: '緑ハート',
  heart05: '青ハート',
  heart06: '紫ハート',
  heart0: '無色ハート',
};

const effectBladeTokenLabels: Record<string, string> = {
  heart01: '桃ブレード',
  heart02: '赤ブレード',
  heart03: '黄ブレード',
  heart04: '緑ブレード',
  heart05: '青ブレード',
  heart06: '紫ブレード',
  heart0: 'ALLブレード',
};

// Legacy Liella effect text was flattened from structured icon markup into ♥/◇.
// Keep verified source markup separate from card data so only AI copy uses it.
const verifiedEffectIconMarkup: Record<string, string> = {
  '【ライブ開始時】自分の成功ライブカード置き場にカードが2枚以上ある場合、このカードのスコアを＋５し、必要ハートは♥♥♥♥♥♥♥♥♥◇◇◇になる。':
    '【ライブ開始時】自分の成功ライブカード置き場にカードが2枚以上ある場合、このカードのスコアを＋５し、必要ハートはheart02heart02heart02heart03heart03heart03heart06heart06heart06heart0heart0heart0になる。',
};

function compactIconRuns(text: string) {
  return text.replace(/\[([^\]]+)\](?:\[\1\])+/g, (run, label: string) => {
    const count = run.split(`[${label}]`).length - 1;
    return `[${label}×${count}]`;
  }).replace(/\]\[/g, '] / [').replace(/\[([^\]]+)\]/g, '$1');
}

export function formatEffectTextForAi(card: Card) {
  if (!card.effectText) return '記載なし';
  const sourceText = verifiedEffectIconMarkup[card.effectText] ?? card.effectText;
  const converted = sourceText
    .replace(/(heart0[1-6]|heart0)ブレード/g, (_, token: string) => `[${effectBladeTokenLabels[token]}]`)
    .replace(/♥ブレード/g, '[色不明ブレード]')
    .replace(/heart0[1-6]|heart0/g, (token) => `[${effectHeartTokenLabels[token]}]`)
    .replace(/◇/g, '[無色ハート]')
    .replace(/♥/g, '[色不明ハート]');
  return compactIconRuns(converted);
}

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

export function createAiConsultationText(entries: DeckEntry[], candidateEntries: Pick<DeckEntry, 'id' | 'card'>[] = []) {
  const { members, lives } = splitDeckEntries(entries);
  const deckIds = new Set(entries.map((entry) => entry.id));
  const candidates = [...new Map(candidateEntries.filter((entry) => !deckIds.has(entry.id)).map((entry) => [entry.id, entry])).values()];
  const memberTotal = members.reduce((sum, entry) => sum + entry.quantity, 0);
  const liveTotal = lives.reduce((sum, entry) => sum + entry.quantity, 0);
  const total = memberTotal + liveTotal;
  const memberBlocks = members.length ? members.map((entry) => [
    `・${entry.card.name} / ${entry.id} ×${entry.quantity}`,
    `  COST：${entry.card.member?.cost ?? '不明'}`,
    `  基本ハート：${formatHearts(entry.card.member?.hearts ?? [])}`,
    `  ブレードハート：${formatHearts(entry.card.member?.bladeHearts ?? [])}`,
    `  ブレード：${entry.card.member?.yell.count ?? '不明'}`,
    `  効果：${formatEffectTextForAi(entry.card)}`,
  ].join('\n')).join('\n\n') : '（なし）';
  const liveBlocks = lives.length ? lives.map((entry) => [
    `・${entry.card.name} / ${entry.id} ×${entry.quantity}`,
    `  SCORE：${entry.card.live?.score ?? '不明'}`,
    `  必要ハート：${formatHearts(entry.card.live?.requiredHearts ?? [])}`,
    `  効果：${formatEffectTextForAi(entry.card)}`,
  ].join('\n')).join('\n\n') : '（なし）';
  const candidateMembers = candidates.filter((entry) => entry.card.cardType === 'member');
  const candidateLives = candidates.filter((entry) => entry.card.cardType === 'live');
  const formatCandidateMembers = candidateMembers.map((entry) => [
    `・${entry.card.name} / ${entry.id}`,
    `  COST：${entry.card.member?.cost ?? '不明'}`,
    `  基本ハート：${formatHearts(entry.card.member?.hearts ?? [])}`,
    `  ブレードハート：${formatHearts(entry.card.member?.bladeHearts ?? [])}`,
    `  ブレード：${entry.card.member?.yell.count ?? '不明'}`,
    `  効果：${formatEffectTextForAi(entry.card)}`,
  ].join('\n')).join('\n\n');
  const formatCandidateLives = candidateLives.map((entry) => [
    `・${entry.card.name} / ${entry.id}`,
    `  SCORE：${entry.card.live?.score ?? '不明'}`,
    `  必要ハート：${formatHearts(entry.card.live?.requiredHearts ?? [])}`,
    `  効果：${formatEffectTextForAi(entry.card)}`,
  ].join('\n')).join('\n\n');
  const candidatePrompt = candidates.length ? [
    '追加候補カードも記載しています。',
    '残り枠や入れ替え候補については、まず記載された候補カードを優先して比較・提案してください。',
    '記載情報にないカードについて、不明な効果を推測しないでください。',
  ] : [];
  const candidateSection = candidates.length ? [
    '',
    '【追加候補カード】',
    ...(candidateMembers.length ? ['', '■ メンバー候補', formatCandidateMembers] : []),
    ...(candidateLives.length ? ['', '■ ライブ候補', formatCandidateLives] : []),
  ] : [];

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
    ...candidatePrompt,
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
    ...candidateSection,
  ].join('\n');
}
