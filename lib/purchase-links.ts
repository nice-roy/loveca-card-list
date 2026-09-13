import type { Card, PurchaseLink } from '../app/data/schema';

export type AuditedPurchaseLink = PurchaseLink & {
  cardId: string;
  cardNumber: string;
};

export function applyAuditedPurchaseLinks(cards: Card[], records: AuditedPurchaseLink[]): Card[] {
  const byId = new Map<string, AuditedPurchaseLink>();
  for (const record of records) {
    if (byId.has(record.cardId)) throw new Error(`Duplicate audited purchase-link card id: ${record.cardId}`);
    byId.set(record.cardId, record);
  }

  let applied = 0;
  const result = cards.map((card) => {
    const record = byId.get(card.id);
    if (!record) return card;
    if (card.cardType !== 'live' || card.cardNumber !== record.cardNumber) {
      throw new Error(`Audited purchase link is attached to the wrong physical card: ${record.cardNumber}`);
    }
    const cardlaboLinks = (card.purchaseLinks ?? []).filter((link) => link.shopId === 'cardlabo');
    if (cardlaboLinks.some((link) => link.url !== record.url)) {
      throw new Error(`Conflicting Card Labo URL for ${record.cardNumber}`);
    }
    applied += 1;
    if (cardlaboLinks.some((link) => link.url === record.url)) return card;
    return {
      ...card,
      purchaseLinks: [...(card.purchaseLinks ?? []), { shopId: record.shopId, label: record.label, url: record.url }],
    };
  });

  if (applied !== records.length) throw new Error('Audited purchase link references a missing physical card');
  return result;
}
