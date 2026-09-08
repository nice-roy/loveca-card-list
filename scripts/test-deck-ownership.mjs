import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShortageCardsText, getDeckOwnershipStatuses, getShortageEntries } from '../lib/deck-ownership.ts';

const cardA = { name: 'カードA', cardType: 'member', member: null, live: null };
const cardB = { name: 'カードB', cardType: 'live', member: null, live: null };

test('shortage is required quantity minus base-card owned total without negative values', () => {
  const entries = [
    { id: 'BASE-001', quantity: 4, card: cardA },
    { id: 'BASE-002', quantity: 2, card: cardB },
    { id: 'BASE-003', quantity: 4, card: cardA },
    { id: 'BASE-004', quantity: 4, card: cardB },
  ];
  const statuses = getDeckOwnershipStatuses(entries, new Map([['BASE-001', 0], ['BASE-002', 2], ['BASE-003', 10], ['BASE-004', 2]]));
  assert.deepEqual(statuses.map(({ id, ownedQuantity, shortageQuantity }) => ({ id, ownedQuantity, shortageQuantity })), [
    { id: 'BASE-001', ownedQuantity: 0, shortageQuantity: 4 },
    { id: 'BASE-002', ownedQuantity: 2, shortageQuantity: 0 },
    { id: 'BASE-003', ownedQuantity: 10, shortageQuantity: 0 },
    { id: 'BASE-004', ownedQuantity: 2, shortageQuantity: 2 },
  ]);
});

test('shortage summary and copy text include only cards still missing', () => {
  const statuses = getDeckOwnershipStatuses([
    { id: 'BASE-001', quantity: 4, card: cardA },
    { id: 'BASE-002', quantity: 3, card: cardB },
  ], new Map([['BASE-001', 2], ['BASE-002', 3]]));
  const shortages = getShortageEntries(statuses);
  assert.equal(shortages.length, 1);
  assert.equal(shortages.reduce((sum, entry) => sum + entry.shortageQuantity, 0), 2);
  assert.equal(createShortageCardsText(statuses), '【不足カード】\nBASE-001 | カードA | 必要4 | 所持2 | 不足2');
  assert.equal(createShortageCardsText(getDeckOwnershipStatuses([], new Map())), null);
});
