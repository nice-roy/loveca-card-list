import type { Card, HeartValue } from '../app/data/schema';

export type LiveHeartRecord = {
  cardNumber: string;
  bladeHearts: HeartValue[];
  specialHeart: 'draw' | 'score' | null;
};

// Keep historical masters/importers intact; this audited supplement is keyed by
// the complete physical card number, including rarity and reprint version.
export function applyAuditedLiveHearts(cards: Card[], records: LiveHeartRecord[]): Card[] {
  const byNumber = new Map(records.map(record => [record.cardNumber, record]));
  if (byNumber.size !== records.length) throw new Error('Duplicate live heart record');
  const liveNumbers = new Set(cards.filter(card => card.live).map(card => card.cardNumber));
  if (records.some(record => !liveNumbers.has(record.cardNumber))) throw new Error('Unknown live heart record');
  return cards.map(card => {
    const record = byNumber.get(card.cardNumber);
    if (!card.live || !record) return card;
    return { ...card, live: { ...card.live, bladeHearts: record.bladeHearts, specialHeart: record.specialHeart } };
  });
}
