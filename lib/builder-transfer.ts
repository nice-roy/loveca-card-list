import type { DeckQuantities } from './deck-builder';

export const BUILDER_TRANSFER_FORMAT = 'loveca-card-list-state';
export const BUILDER_TRANSFER_VERSION = 1;

export type BuilderTransferData = {
  format: typeof BUILDER_TRANSFER_FORMAT;
  version: typeof BUILDER_TRANSFER_VERSION;
  exportedAt: string;
  deck: { baseCardId: string; count: number }[];
  candidates: string[];
};

export type ValidatedBuilderTransfer = {
  deck: DeckQuantities;
  candidates: string[];
};

export type BuilderTransferValidation =
  | { ok: true; value: ValidatedBuilderTransfer }
  | { ok: false; errors: string[] };

export function createBuilderTransfer(deck: DeckQuantities, candidates: Iterable<string>, exportedAt = new Date().toISOString()): BuilderTransferData {
  return {
    format: BUILDER_TRANSFER_FORMAT,
    version: BUILDER_TRANSFER_VERSION,
    exportedAt,
    deck: Object.entries(deck)
      .map(([baseCardId, count]) => ({ baseCardId, count }))
      .sort((left, right) => left.baseCardId.localeCompare(right.baseCardId, 'ja', { numeric: true })),
    candidates: [...new Set(candidates)].sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
  };
}

export function createBuilderTransferText(deck: DeckQuantities, candidates: Iterable<string>, exportedAt?: string) {
  return JSON.stringify(createBuilderTransfer(deck, candidates, exportedAt), null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  if (value.version !== BUILDER_TRANSFER_VERSION) errors.push(`対応していないバージョンです（version: ${String(value.version)}）。`);
  if (typeof value.exportedAt !== 'string') errors.push('exportedAtが正しくありません。');
  if (!Array.isArray(value.deck)) errors.push('deckの形式が正しくありません。');
  if (!Array.isArray(value.candidates)) errors.push('candidatesの形式が正しくありません。');
  if (errors.length) return { ok: false, errors };

  const deck: DeckQuantities = {};
  const deckIds = new Set<string>();
  for (const entry of value.deck) {
    if (!isPlainObject(entry) || typeof entry.baseCardId !== 'string' || !Number.isInteger(entry.count)) {
      errors.push('deck内に正しくないカード情報があります。');
      continue;
    }
    const { baseCardId, count } = entry;
    if (deckIds.has(baseCardId)) errors.push(`デッキ内で同一カードが重複しています：${baseCardId}`);
    else deckIds.add(baseCardId);
    if (!validIds.has(baseCardId)) errors.push(`確認できないカード：${baseCardId}`);
    if (count < 1 || count > 4) errors.push(`採用枚数が不正：${baseCardId} ×${count}`);
    if (validIds.has(baseCardId) && count >= 1 && count <= 4 && !deck[baseCardId]) deck[baseCardId] = count;
  }

  const candidates: string[] = [];
  const candidateIds = new Set<string>();
  for (const baseCardId of value.candidates) {
    if (typeof baseCardId !== 'string') {
      errors.push('候補内に正しくないカード情報があります。');
      continue;
    }
    if (candidateIds.has(baseCardId)) errors.push(`候補内で同一カードが重複しています：${baseCardId}`);
    else candidateIds.add(baseCardId);
    if (!validIds.has(baseCardId)) errors.push(`確認できない候補カード：${baseCardId}`);
    if (validIds.has(baseCardId) && !candidates.includes(baseCardId)) candidates.push(baseCardId);
  }

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, value: { deck, candidates } };
}
