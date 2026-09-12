import type { Card, PurchaseLink } from '../app/data/schema';

export type CardDisplayGroup = {
  baseCardId: string;
  cards: Card[];
  representative: Card;
};

export type VersionPurchaseLink = PurchaseLink & {
  cardId: string;
  cardNumber: string;
  versionLabel: string;
};

const CARDLABO_PRODUCT_URL = /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/;

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

export function cardlaboLinksForDisplay(cards: Card[]): VersionPurchaseLink[] {
  return cards.flatMap((card) => (card.purchaseLinks ?? [])
    .filter((link) => link.shopId === 'cardlabo' && CARDLABO_PRODUCT_URL.test(link.url))
    .map((link) => ({
      ...link,
      cardId: card.id,
      cardNumber: card.cardNumber,
      versionLabel: cardVersion(card.cardNumber) ?? card.rarity ?? card.cardNumber,
    })));
}
