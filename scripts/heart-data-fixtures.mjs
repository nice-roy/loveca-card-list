export const OFFICIAL_EFFECT_TEXT_CORRECTION_IDS = new Set([
  'PL!SP-bp5-024-L',
  'PL!SP-bp4-024-L', 'PL!SP-bp4-024-SECL', 'PL!SP-bp4-024-SRL',
  'PL!SP-pb1-025-L', 'PL!SP-pb1-025-SECL', 'PL!SP-pb1-025-SRL',
  'PL!SP-pb2-048-L',
  'PL!SP-bp1-026-L', 'PL!SP-bp1-026-SECL', 'PL!SP-bp1-026-SRL',
  'PL!SP-bp1-024-L', 'PL!SP-bp1-024-SRL',
  'PL!SP-sd2-023-P', 'PL!SP-sd2-023-SD2',
]);

export const OFFICIAL_HEART_VALUE_CORRECTION_IDS = new Set([
  'PL!S-PR-046-PR',
  'PL!-PR-023-PR',
]);

export function applyOfficialHeartCorrections(expectedCards, actualCards) {
  const actualByNumber = new Map(actualCards.map((card) => [card.cardNumber, card]));
  for (const card of expectedCards) {
    const actual = actualByNumber.get(card.cardNumber);
    if (!actual) continue;
    if (OFFICIAL_EFFECT_TEXT_CORRECTION_IDS.has(card.cardNumber)) card.effectText = actual.effectText;
    if (OFFICIAL_HEART_VALUE_CORRECTION_IDS.has(card.cardNumber) && card.member && actual.member) card.member.hearts = actual.member.hearts;
  }
  return expectedCards;
}
