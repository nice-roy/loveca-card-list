import type { Card } from '../app/data/schema';

export const BUILDER_STORAGE_KEY = 'loveca-card-list:deck-builder:v1';

export type DeckQuantities = Record<string, number>;
export type DeckEntry = { id: string; quantity: number; card: Card };
export type DeckMetric = 'cost' | 'score';
export type DeckGroup = { value: number | null; quantity: number; entries: DeckEntry[] };
export type SavedDeck = { id: string; name: string; cards: DeckQuantities };
export type BuilderState = {
  version: 2;
  candidates: string[];
  decks: SavedDeck[];
  activeDeckId: string;
};

export const MAX_DECK_QUANTITY = 4;
const COMPLETE_MEMBER_COUNT = 48;
const COMPLETE_LIVE_COUNT = 12;
const COMPLETE_DECK_COUNT = COMPLETE_MEMBER_COUNT + COMPLETE_LIVE_COUNT;

function normalizeDeckQuantities(value: unknown, validIds: Set<string>) {
  const deck: DeckQuantities = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return deck;
  for (const [id, quantity] of Object.entries(value)) {
    if (!validIds.has(id) || typeof quantity !== 'number' || !Number.isFinite(quantity)) continue;
    const normalizedQuantity = Math.floor(quantity);
    if (normalizedQuantity > 0) deck[id] = normalizedQuantity;
  }
  return deck;
}

export function createDeckId() {
  return globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nextDefaultDeckName(decks: Pick<SavedDeck, 'name'>[]) {
  const names = new Set(decks.map((deck) => deck.name));
  let number = 1;
  while (names.has(`デッキ${number}`)) number += 1;
  return `デッキ${number}`;
}

export function duplicateDeckName(name: string, decks: Pick<SavedDeck, 'name'>[]) {
  const names = new Set(decks.map((deck) => deck.name));
  const base = `${name} のコピー`;
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

export function normalizeBuilderState(value: unknown, validIds: Set<string>): BuilderState {
  const createEmpty = (): BuilderState => {
    const id = createDeckId();
    return { version: 2, candidates: [], decks: [{ id, name: 'デッキ1', cards: {} }], activeDeckId: id };
  };
  if (!value || typeof value !== 'object') return createEmpty();

  const saved = value as { version?: unknown; candidates?: unknown; deck?: unknown; decks?: unknown; activeDeckId?: unknown };
  const candidates = Array.isArray(saved.candidates)
    ? [...new Set(saved.candidates.filter((id): id is string => typeof id === 'string' && validIds.has(id)))]
    : [];

  if (saved.version === 2 && Array.isArray(saved.decks)) {
    const seenIds = new Set<string>();
    const decks: SavedDeck[] = [];
    for (const item of saved.decks) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const deck = item as { id?: unknown; name?: unknown; cards?: unknown };
      if (typeof deck.id !== 'string' || !deck.id || seenIds.has(deck.id) || typeof deck.name !== 'string' || !deck.name.trim()) continue;
      seenIds.add(deck.id);
      decks.push({ id: deck.id, name: deck.name.trim(), cards: normalizeDeckQuantities(deck.cards, validIds) });
    }
    if (decks.length) {
      const activeDeckId = typeof saved.activeDeckId === 'string' && seenIds.has(saved.activeDeckId) ? saved.activeDeckId : decks[0].id;
      return { version: 2, candidates, decks, activeDeckId };
    }
  }

  const legacyId = createDeckId();
  return { version: 2, candidates, decks: [{ id: legacyId, name: 'デッキ1', cards: normalizeDeckQuantities(saved.deck, validIds) }], activeDeckId: legacyId };
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

export function emptyDeckForBulkClear(deck: DeckQuantities) {
  return { deck: {} as DeckQuantities, undoDeck: { ...deck } };
}

export function restoreDeckAfterBulkClear(deck: DeckQuantities) {
  return { ...deck };
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

export function createDeckRecipeText(entries: DeckEntry[], deckName?: string) {
  const { members, lives } = splitDeckEntries(entries);
  const memberTotal = members.reduce((sum, entry) => sum + entry.quantity, 0);
  const liveTotal = lives.reduce((sum, entry) => sum + entry.quantity, 0);
  const formatLines = (items: DeckEntry[]) => items.length
    ? items.map((entry) => `${entry.card.name} / ${entry.id} ×${entry.quantity}`).join('\n')
    : '（なし）';

  return [
    '【ラブカ デッキレシピ】',
    ...(deckName ? ['', `デッキ名：${deckName}`] : []),
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

export function createAiConsultationText(entries: DeckEntry[], candidateEntries: Pick<DeckEntry, 'id' | 'card'>[] = [], deckName?: string) {
  const { members, lives } = splitDeckEntries(entries);
  const deckIds = new Set(entries.map((entry) => entry.id));
  const candidates = [...new Map(candidateEntries.filter((entry) => !deckIds.has(entry.id)).map((entry) => [entry.id, entry])).values()];
  const memberTotal = members.reduce((sum, entry) => sum + entry.quantity, 0);
  const liveTotal = lives.reduce((sum, entry) => sum + entry.quantity, 0);
  const total = memberTotal + liveTotal;
  const remainingMembers = Math.max(0, COMPLETE_MEMBER_COUNT - memberTotal);
  const remainingLives = Math.max(0, COMPLETE_LIVE_COUNT - liveTotal);
  const remainingTotal = remainingMembers + remainingLives;
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
    ...(deckName ? [`デッキ名：${deckName}`] : []),
    '記載されたカード情報を基準にデッキを分析してください。',
    '現在の採用カードをできるだけ尊重しながら、',
    '・構成の長所と弱点',
    '・増やす候補',
    '・減らす／抜く候補',
    '・残り枠に入れる候補',
    '・その理由',
    'を提案してください。',
    '不明なカード効果を推測しないでください。',
    '完成案を提示する場合は、提案後の採用枚数を再計算し、メンバーカード48枚・ライブカード12枚・合計60枚になっていることを必ず確認してください。',
    '現在のデッキや追加候補カードとは別に、新しく採用を提案するカードがある場合は、回答の最後に「候補一括追加用」ブロックをコードブロックで出力してください。各行は「カード番号 | カード名 | 推奨枚数」の形式にしてください。現在のデッキにあるカードと追加候補カードにあるカードは原則として再出力せず、カード番号を確実に特定できないカードは出力しないでください。新しい候補がない場合は、このブロックを出力しないでください。',
    ...candidatePrompt,
    '完成形はメンバーカード48枚、ライブカード12枚、合計60枚で固定です。完成枚数をユーザーへ確認しないでください。',
    '未完成の場合は、以下の残り枠について提案してください。ライブの残り枠が0枚の場合は、ライブカードの追加を無理に提案しないでください。メンバーだけ不足している場合は、メンバーの残り枠を中心に提案してください。',
    '',
    '【現在のデッキ】',
    `メンバー：${memberTotal}枚`,
    `ライブ：${liveTotal}枚`,
    `合計：${total}枚`,
    '',
    '【完成形】',
    `メンバー：${COMPLETE_MEMBER_COUNT}枚`,
    `ライブ：${COMPLETE_LIVE_COUNT}枚`,
    `合計：${COMPLETE_DECK_COUNT}枚`,
    '',
    '【残り枠】',
    `メンバー：${remainingMembers}枚`,
    `ライブ：${remainingLives}枚`,
    `合計：${remainingTotal}枚`,
    '',
    '■ メンバーカード',
    memberBlocks,
    '',
    '■ ライブカード',
    liveBlocks,
    ...candidateSection,
  ].join('\n');
}
