import type { Card } from '../app/data/schema';

// 元データは既存のインポート検証用に保持し、確認済みの補正を表示・AI出力に共通適用する。
// 取得元・変更前後・対象8枚は docs/data-audit/GENERAL-FIXES.json を参照。
export function applyAuditedCardCorrections(cards: Card[]): Card[] {
  return cards.map((card) => {
    const effectText = card.effectText?.replace(/<br\s*\/?\s*>[ \t]*\r?\n?/gi, '\n') ?? card.effectText;
    let member = card.member;
    if (card.cardNumber === 'PL!-bp4-002-SEC') {
      const hearts = member?.bladeHearts;
      if (!member || !hearts || hearts.length !== 1 || hearts[0].color !== 'purple' || ![1, 2].includes(hearts[0].count)) {
        throw new Error('PL!-bp4-002-SEC: 確認済み補正と元データが一致しません');
      }
      if (hearts[0].count === 2) member = { ...member, bladeHearts: [{ color: 'purple', count: 1 }] };
    }
    return effectText === card.effectText && member === card.member ? card : { ...card, effectText, member };
  });
}
