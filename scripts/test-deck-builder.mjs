import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDeckQuantity, createAiConsultationText, createDeckRecipeText, formatEffectTextForAi, groupDeckEntriesByMetric, normalizeBuilderState, removeDeckCardIfSingle } from '../lib/deck-builder.ts';

test('saved state is restored only for valid cards and positive whole quantities', () => {
  const restored = normalizeBuilderState({
    candidates: ['A-001', 'A-001', 'missing'],
    deck: { 'A-001': 3.8, 'B-002': 0, missing: 4, broken: '2' },
  }, new Set(['A-001', 'B-002']));

  assert.deepEqual(restored, {
    version: 1,
    candidates: ['A-001'],
    deck: { 'A-001': 3 },
  });
});

test('decreasing to zero removes a card from the deck', () => {
  assert.deepEqual(changeDeckQuantity({ 'A-001': 1, 'B-002': 2 }, 'A-001', -1), { 'B-002': 2 });
  assert.deepEqual(changeDeckQuantity({ 'B-002': 2 }, 'B-002', 1), { 'B-002': 3 });
});

test('quantity updates stop at four without rewriting legacy over-limit values', () => {
  assert.deepEqual(changeDeckQuantity({ 'A-001': 3 }, 'A-001', 1), { 'A-001': 4 });
  assert.deepEqual(changeDeckQuantity({ 'A-001': 4 }, 'A-001', 1), { 'A-001': 4 });
  assert.deepEqual(changeDeckQuantity({ 'A-001': 3 }, 'A-001', 20), { 'A-001': 4 });
  assert.deepEqual(changeDeckQuantity({ 'A-001': 6 }, 'A-001', 1), { 'A-001': 6 });
  assert.deepEqual(normalizeBuilderState({ deck: { 'A-001': 6 } }, new Set(['A-001'])).deck, { 'A-001': 6 });
});

test('single-card removal only occurs after the dedicated confirmation path', () => {
  const deck = { 'A-001': 1, 'B-002': 2 };
  assert.strictEqual(removeDeckCardIfSingle(deck, 'B-002'), deck);
  assert.deepEqual(removeDeckCardIfSingle(deck, 'A-001'), { 'B-002': 2 });
});

test('AI effect text converts only icons supported by token or structured color data', () => {
  assert.equal(formatEffectTextForAi({ effectText: 'heart02heart02とheart0、heart03ブレードとheart0ブレード', member: null, live: null }), '赤ハート×2と無色ハート、黄ブレードとALLブレード');
  assert.equal(formatEffectTextForAi({ effectText: '♥を得る。', member: null, live: { requiredHearts: [{ color: 'yellow', count: 1 }] } }), '色不明ハートを得る。');
});

test('AI effect text uses verified icon markup for Hajimari wa Kimi no Sora', () => {
  const effectText = '【ライブ開始時】自分の成功ライブカード置き場にカードが2枚以上ある場合、このカードのスコアを＋５し、必要ハートは♥♥♥♥♥♥♥♥♥◇◇◇になる。';
  assert.equal(formatEffectTextForAi({ effectText, member: null, live: { requiredHearts: [{ color: 'yellow', count: 1 }, { color: 'any', count: 2 }] } }), '【ライブ開始時】自分の成功ライブカード置き場にカードが2枚以上ある場合、このカードのスコアを＋５し、必要ハートは赤ハート×3 / 黄ハート×3 / 紫ハート×3 / 無色ハート×3になる。');
});

test('deck entries are grouped by metric with adopted quantities totaled', () => {
  const entries = [
    { id: 'CARD-010', quantity: 2, card: { member: { cost: 5 }, live: null } },
    { id: 'CARD-002', quantity: 3, card: { member: { cost: 2 }, live: null } },
    { id: 'CARD-001', quantity: 1, card: { member: { cost: 5 }, live: null } },
  ];

  const groups = groupDeckEntriesByMetric(entries, 'cost');
  assert.deepEqual(groups.map((group) => ({ value: group.value, quantity: group.quantity })), [
    { value: 2, quantity: 3 },
    { value: 5, quantity: 3 },
  ]);
  assert.deepEqual(groups[1].entries.map((entry) => entry.id), ['CARD-001', 'CARD-010']);
  assert.deepEqual(entries.map((entry) => entry.quantity), [2, 3, 1]);
});

test('live cards are grouped by score from low to high', () => {
  const entries = [
    { id: 'LIVE-060', quantity: 1, card: { member: null, live: { score: 60 } } },
    { id: 'LIVE-040', quantity: 2, card: { member: null, live: { score: 40 } } },
  ];

  assert.deepEqual(groupDeckEntriesByMetric(entries, 'score').map((group) => ({ value: group.value, quantity: group.quantity })), [
    { value: 40, quantity: 2 },
    { value: 60, quantity: 1 },
  ]);
});

test('recipe copy text totals quantities and keeps base card ids separate', () => {
  const entries = [
    { id: 'MEMBER-001', quantity: 4, card: { name: 'メンバーA', cardType: 'member', member: { cost: 3 }, live: null } },
    { id: 'MEMBER-002', quantity: 2, card: { name: 'メンバーA', cardType: 'member', member: { cost: 3 }, live: null } },
    { id: 'LIVE-001', quantity: 3, card: { name: 'ライブA', cardType: 'live', member: null, live: { score: 50 } } },
  ];
  const text = createDeckRecipeText(entries);

  assert.match(text, /合計：9枚/);
  assert.match(text, /メンバー：6枚/);
  assert.match(text, /ライブ：3枚/);
  assert.match(text, /メンバーA \/ MEMBER-001 ×4/);
  assert.match(text, /メンバーA \/ MEMBER-002 ×2/);
});

test('AI consultation text contains card details without links or images', () => {
  const entries = [{
    id: 'MEMBER-001',
    quantity: 2,
    card: {
      name: 'メンバーA', cardType: 'member', officialUrl: 'https://example.com/card', image: { url: 'https://example.com/card.png' },
      member: { cost: 4, hearts: [{ color: 'pink', count: 2 }], bladeHearts: [{ color: 'blue', count: 1 }], yell: { count: 3 } },
      live: null, effectText: '確認済みの効果全文。',
    },
  }];
  const text = createAiConsultationText(entries);

  assert.match(text, /現在の合計は2枚です/);
  assert.match(text, /COST：4/);
  assert.match(text, /基本ハート：桃×2/);
  assert.match(text, /ブレードハート：青×1/);
  assert.match(text, /ブレード：3/);
  assert.match(text, /効果：確認済みの効果全文。/);
  assert.doesNotMatch(text, /https:\/\//);
  assert.doesNotMatch(text, /画像/);
});
