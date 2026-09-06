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

function normalizedText(value: string | null) {
  return value?.trim().replace(/\s+/g, ' ') ?? null;
}

function hasComparablePerformance(card: Card) {
  if (!card.name || card.effectText === null) return false;
  if (card.cardType === 'member') {
    return card.member !== null
      && card.member.cost !== null
      && card.member.hearts.length > 0
      && Array.isArray(card.member.bladeHearts)
      && Object.hasOwn(card.member.yell, 'count');
  }
  return card.live !== null && card.live.score !== null && card.live.requiredHearts.length > 0;
}

function performanceFingerprint(card: Card) {
  return JSON.stringify({
    name: normalizedText(card.name),
    cardType: card.cardType,
    member: card.member,
    live: card.live,
    effectText: normalizedText(card.effectText),
  });
}

export function groupCardsForDisplay(cards: Card[]): CardDisplayGroup[] {
  const grouped = new Map<string, CardDisplayGroup>();

  for (const card of cards) {
    const base = baseCardId(card.cardNumber);
    const key = hasComparablePerformance(card)
      ? `${base}\u0000${performanceFingerprint(card)}`
      : `individual\u0000${card.id}`;
    const existing = grouped.get(key);
    if (existing) existing.cards.push(card);
    else grouped.set(key, { baseCardId: base, cards: [card], representative: card });
  }

  return [...grouped.values()];
}
