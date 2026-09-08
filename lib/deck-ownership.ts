import type { DeckEntry } from './deck-builder';

export type DeckOwnershipStatus = DeckEntry & {
  ownedQuantity: number;
  shortageQuantity: number;
};

export function getDeckOwnershipStatuses(entries: DeckEntry[], ownedTotalsByBase: Map<string, number>): DeckOwnershipStatus[] {
  return entries.map((entry) => {
    const ownedQuantity = ownedTotalsByBase.get(entry.id) ?? 0;
    return {
      ...entry,
      ownedQuantity,
      shortageQuantity: Math.max(0, entry.quantity - ownedQuantity),
    };
  });
}

export function getShortageEntries(entries: DeckOwnershipStatus[]) {
  return entries.filter((entry) => entry.shortageQuantity > 0);
}

export function createShortageCardsText(entries: DeckOwnershipStatus[]) {
  const shortages = getShortageEntries(entries);
  if (!shortages.length) return null;
  return [
    '【不足カード】',
    ...shortages.map((entry) => `${entry.id} | ${entry.card.name} | 必要${entry.quantity} | 所持${entry.ownedQuantity} | 不足${entry.shortageQuantity}`),
  ].join('\n');
}
