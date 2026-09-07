export const BUILDER_STORAGE_KEY = 'loveca-card-list:deck-builder:v1';

export type DeckQuantities = Record<string, number>;
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
