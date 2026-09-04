import type { Card } from '../app/data/schema';

export type NumericFilterKind = 'cost' | 'score';

export function numericValue(card: Card, kind: NumericFilterKind): number | null {
  const value = kind === 'cost'
    ? (card.cardType === 'member' ? card.member?.cost : null)
    : (card.cardType === 'live' ? card.live?.score : null);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function numericOptions(cards: Card[], groupId: string, kind: NumericFilterKind) {
  const values = cards
    .filter((card) => groupId === 'all' || card.groupIds.includes(groupId))
    .map((card) => numericValue(card, kind))
    .filter((value): value is number => value !== null);
  return [...new Set(values)].sort((a, b) => a - b)
    .map((value) => ({ id: String(value), label: String(value) }));
}

export function retainAvailableIds(selectedIds: string[], options: { id: string }[]) {
  const validIds = new Set(options.map((option) => option.id));
  return selectedIds.filter((id) => validIds.has(id));
}

export function matchesNumericFilter(card: Card, kind: NumericFilterKind, selectedIds: string[]) {
  if (selectedIds.length === 0) return true;
  const value = numericValue(card, kind);
  return value !== null && selectedIds.includes(String(value));
}
