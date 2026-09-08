import type { DeckQuantities, SavedDeck } from './deck-builder';

export const BUILDER_TRANSFER_FORMAT = 'loveca-card-list-state';
export const BUILDER_TRANSFER_VERSION = 2;

type TransferDeckCards = { baseCardId: string; count: number }[];

export type BuilderTransferData = {
  format: typeof BUILDER_TRANSFER_FORMAT;
  version: typeof BUILDER_TRANSFER_VERSION;
  exportedAt: string;
  activeDeckId: string;
  decks: { id: string; name: string; cards: TransferDeckCards }[];
  candidates: string[];
};

export type ValidatedBuilderTransfer = {
  sourceVersion: 1 | 2;
  decks: SavedDeck[];
  activeDeckId: string;
  candidates: string[];
};

export type BuilderTransferValidation =
  | { ok: true; value: ValidatedBuilderTransfer }
  | { ok: false; errors: string[] };

function sortedCards(deck: DeckQuantities): TransferDeckCards {
  return Object.entries(deck)
    .map(([baseCardId, count]) => ({ baseCardId, count }))
    .sort((left, right) => left.baseCardId.localeCompare(right.baseCardId, 'ja', { numeric: true }));
}

export function createBuilderTransfer(decks: SavedDeck[], activeDeckId: string, candidates: Iterable<string>, exportedAt = new Date().toISOString()): BuilderTransferData {
  return {
    format: BUILDER_TRANSFER_FORMAT,
    version: BUILDER_TRANSFER_VERSION,
    exportedAt,
    activeDeckId,
    decks: decks.map((deck) => ({ id: deck.id, name: deck.name, cards: sortedCards(deck.cards) })),
    candidates: [...new Set(candidates)].sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
  };
}

export function createBuilderTransferText(decks: SavedDeck[], activeDeckId: string, candidates: Iterable<string>, exportedAt?: string) {
  return JSON.stringify(createBuilderTransfer(decks, activeDeckId, candidates, exportedAt), null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateCandidates(value: unknown, validIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push('candidatesの形式が正しくありません。');
    return [];
  }
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const baseCardId of value) {
    if (typeof baseCardId !== 'string') {
      errors.push('候補内に正しくないカード情報があります。');
      continue;
    }
    if (seen.has(baseCardId)) errors.push(`候補内で同一カードが重複しています：${baseCardId}`);
    else seen.add(baseCardId);
    if (!validIds.has(baseCardId)) errors.push(`確認できない候補カード：${baseCardId}`);
    if (validIds.has(baseCardId) && !candidates.includes(baseCardId)) candidates.push(baseCardId);
  }
  return candidates;
}

function validateDeckCards(value: unknown, validIds: Set<string>, errors: string[], label: string) {
  const deck: DeckQuantities = {};
  if (!Array.isArray(value)) {
    errors.push(`${label}のカード内容が正しくありません。`);
    return deck;
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.baseCardId !== 'string' || !Number.isInteger(entry.count)) {
      errors.push(`${label}に正しくないカード情報があります。`);
      continue;
    }
    const baseCardId = entry.baseCardId;
    const count = entry.count as number;
    if (seen.has(baseCardId)) errors.push(`${label}で同一カードが重複しています：${baseCardId}`);
    else seen.add(baseCardId);
    if (!validIds.has(baseCardId)) errors.push(`確認できないカード：${baseCardId}`);
    if (count < 1 || count > 4) errors.push(`採用枚数が不正：${baseCardId} ×${count}`);
    if (validIds.has(baseCardId) && count >= 1 && count <= 4 && !deck[baseCardId]) deck[baseCardId] = count;
  }
  return deck;
}

export function validateBuilderTransferText(text: string, validIds: Set<string>): BuilderTransferValidation {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSONの形式が正しくありません。'] };
  }
  if (!isPlainObject(value)) return { ok: false, errors: ['移行データの形式が正しくありません。'] };

  const errors: string[] = [];
  if (value.format !== BUILDER_TRANSFER_FORMAT) errors.push('対応していない移行データです。');
  if (value.version !== 1 && value.version !== BUILDER_TRANSFER_VERSION) errors.push(`対応していないバージョンです（version: ${String(value.version)}）。`);
  if (typeof value.exportedAt !== 'string') errors.push('exportedAtが正しくありません。');
  const candidates = validateCandidates(value.candidates, validIds, errors);

  if (value.version === 1) {
    const cards = validateDeckCards(value.deck, validIds, errors, 'デッキ1');
    return errors.length
      ? { ok: false, errors: [...new Set(errors)] }
      : { ok: true, value: { sourceVersion: 1, decks: [{ id: 'imported-deck-v1', name: 'デッキ1', cards }], activeDeckId: 'imported-deck-v1', candidates } };
  }

  if (!Array.isArray(value.decks) || value.decks.length === 0) errors.push('decksには1件以上のデッキが必要です。');
  const decks: SavedDeck[] = [];
  const deckIds = new Set<string>();
  if (Array.isArray(value.decks)) {
    for (const item of value.decks) {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()) {
        errors.push('decks内に正しくないデッキ情報があります。');
        continue;
      }
      if (deckIds.has(item.id)) errors.push(`デッキIDが重複しています：${item.id}`);
      else deckIds.add(item.id);
      decks.push({ id: item.id, name: item.name.trim(), cards: validateDeckCards(item.cards, validIds, errors, `「${item.name.trim()}」`) });
    }
  }
  if (typeof value.activeDeckId !== 'string' || !deckIds.has(value.activeDeckId)) errors.push('アクティブデッキを確認できません。');

  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, value: { sourceVersion: 2, decks, activeDeckId: value.activeDeckId as string, candidates } };
}
