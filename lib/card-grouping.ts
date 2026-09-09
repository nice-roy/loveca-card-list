import type { Card } from '../app/data/schema';

export type CardDisplayGroup = {
  baseCardId: string;
  cards: Card[];
  representative: Card;
};

export function cardVersion(cardNumber: string) {
  return cardNumber.match(/^(.+-[0-9]{3})-([^-]+)$/)?.[2] ?? null;
}

export function baseCardId(cardNumber: string) {
  return cardNumber.match(/^(.+-[0-9]{3})-([^-]+)$/)?.[1] ?? cardNumber;
}

export function groupCardsForDisplay(cards: Card[]): CardDisplayGroup[] {
  const grouped = new Map<string, CardDisplayGroup>();

  for (const card of cards) {
    const base = baseCardId(card.cardNumber);
    const existing = grouped.get(base);
    if (existing) existing.cards.push(card);
    else grouped.set(base, { baseCardId: base, cards: [card], representative: card });
  }

  return [...grouped.values()];
}
