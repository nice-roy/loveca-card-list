import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDeckQuantity, createAiConsultationText, createDeckRecipeText, formatEffectTextForAi, groupDeckEntriesByMetric, normalizeBuilderState, removeDeckCardIfSingle } from '../lib/deck-builder.ts';
import { parseCandidateImportText } from '../lib/candidate-import.ts';

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

  assert.match(text, /【完成形】\nメンバー：48枚\nライブ：12枚\n合計：60枚/);
  assert.match(text, /【残り枠】\nメンバー：46枚\nライブ：12枚\n合計：58枚/);
  assert.doesNotMatch(text, /想定する完成枚数/);
  assert.match(text, /COST：4/);
  assert.match(text, /基本ハート：桃×2/);
  assert.match(text, /ブレードハート：青×1/);
  assert.match(text, /ブレード：3/);
  assert.match(text, /効果：確認済みの効果全文。/);
  assert.doesNotMatch(text, /https:\/\//);
  assert.doesNotMatch(text, /画像/);
  assert.match(text, /候補一括追加用/);
  assert.match(text, /カード番号 \| カード名 \| 推奨枚数/);
  assert.match(text, /提案後の採用枚数を再計算/);
});

test('AI consultation candidates are optional, deduplicated, and exclude adopted base card ids', () => {
  const memberCard = { name: '候補メンバー', cardType: 'member', member: { cost: 2, hearts: [{ color: 'red', count: 1 }], bladeHearts: [], yell: { count: 1 } }, live: null, effectText: '候補効果' };
  const adoptedCard = { ...memberCard, name: '採用済みメンバー' };
  const liveCard = { name: '候補ライブ', cardType: 'live', member: null, live: { score: 3, requiredHearts: [{ color: 'any', count: 2 }] }, effectText: 'ライブ効果' };
  const deck = [{ id: 'MEMBER-001', quantity: 2, card: adoptedCard }];

  const withoutCandidates = createAiConsultationText(deck, []);
  assert.doesNotMatch(withoutCandidates, /【追加候補カード】/);

  const withCandidates = createAiConsultationText(deck, [
    { id: 'MEMBER-001', card: adoptedCard },
    { id: 'MEMBER-002', card: memberCard },
    { id: 'LIVE-001', card: liveCard },
    { id: 'LIVE-001', card: liveCard },
  ]);
  assert.match(withCandidates, /追加候補カードも記載しています/);
  assert.match(withCandidates, /【追加候補カード】/);
  assert.match(withCandidates, /■ メンバー候補/);
  assert.match(withCandidates, /■ ライブ候補/);
  assert.match(withCandidates, /候補メンバー \/ MEMBER-002/);
  assert.match(withCandidates, /候補ライブ \/ LIVE-001/);
  assert.equal((withCandidates.match(/候補ライブ \/ LIVE-001/g) ?? []).length, 1);
  assert.doesNotMatch(withCandidates.split('【追加候補カード】')[1], /MEMBER-001/);
  assert.match(withCandidates, /【完成形】\nメンバー：48枚\nライブ：12枚\n合計：60枚/);
});

test('AI consultation text calculates fixed member and live remaining slots', () => {
  const memberCard = { name: 'メンバー', cardType: 'member', member: { cost: 2, hearts: [], bladeHearts: [], yell: { count: 1 } }, live: null };
  const liveCard = { name: 'ライブ', cardType: 'live', member: null, live: { score: 40, requiredHearts: [] } };
  const createEntries = (memberQuantity, liveQuantity) => [
    { id: 'MEMBER-001', quantity: memberQuantity, card: memberCard },
    { id: 'LIVE-001', quantity: liveQuantity, card: liveCard },
  ];

  const fiftyTwo = createAiConsultationText(createEntries(40, 12));
  assert.match(fiftyTwo, /【残り枠】\nメンバー：8枚\nライブ：0枚\n合計：8枚/);
  assert.match(fiftyTwo, /ライブの残り枠が0枚の場合は、ライブカードの追加を無理に提案しないでください/);

  const sixty = createAiConsultationText(createEntries(48, 12));
  assert.match(sixty, /【残り枠】\nメンバー：0枚\nライブ：0枚\n合計：0枚/);

  const shortLive = createAiConsultationText(createEntries(48, 9));
  assert.match(shortLive, /【残り枠】\nメンバー：0枚\nライブ：3枚\n合計：3枚/);
});

test('candidate import recognizes card numbers, base card ids, and bulk sections safely', () => {
  const knownIds = new Set(['PL!SP-bp1-001', 'PL!SP-bp1-012', 'PL!SP-bp1-013']);

  assert.deepEqual(parseCandidateImportText('PL!SP-bp1-012\nPL!SP-bp1-001', knownIds), {
    recognizedIds: ['PL!SP-bp1-012', 'PL!SP-bp1-001'],
    unrecognizedCardNumbers: [],
    usedBulkCandidateSection: false,
  });
  assert.deepEqual(parseCandidateImportText('PL!SP-bp1-012 | 澁谷かのん | 4\nPL!SP-bp1-013 | 唐 可可 | 4', knownIds), {
    recognizedIds: ['PL!SP-bp1-012', 'PL!SP-bp1-013'],
    unrecognizedCardNumbers: [],
    usedBulkCandidateSection: false,
  });
  assert.deepEqual(parseCandidateImportText('本文の採用済み PL!SP-bp1-001\n【候補一括追加用】\n```\nPL!SP-bp1-012 | 澁谷かのん | 4\nPL!SP-bp1-012-R | 澁谷かのん | 4\nPL!SP-zz9-999 | 不明 | 4\n```\n【補足】\nPL!SP-bp1-013', knownIds), {
    recognizedIds: ['PL!SP-bp1-012'],
    unrecognizedCardNumbers: ['PL!SP-zz9-999'],
    usedBulkCandidateSection: true,
  });
  assert.deepEqual(parseCandidateImportText('カード名だけ', knownIds), {
    recognizedIds: [],
    unrecognizedCardNumbers: [],
    usedBulkCandidateSection: false,
  });
});
