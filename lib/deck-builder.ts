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
