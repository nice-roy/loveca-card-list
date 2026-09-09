import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { baseCardId } from '../lib/card-grouping.ts';
import { changeDeckQuantity } from '../lib/deck-builder.ts';
import { createShortageCardsText, getDeckOwnershipStatuses, getShortageEntries } from '../lib/deck-ownership.ts';
import { inventoryTotalsByBase } from '../lib/inventory.ts';

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

test('version-specific ownership is combined for the Tomari base card while the deck remains capped at four', () => {
  const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));
  const cardNumbers = ['PL!SP-bp5-011-AR', 'PL!SP-bp5-011-P', 'PL!SP-bp5-011-R'];
  const versions = cards.filter((card) => cardNumbers.includes(card.cardNumber));
  assert.deepEqual(versions.map((card) => card.cardNumber), cardNumbers);

  const base = baseCardId(versions[0].cardNumber);
  const totals = inventoryTotalsByBase(
    { [versions[0].id]: 2, [versions[1].id]: 1, [versions[2].id]: 1 },
    new Map(cards.map((card) => [card.id, baseCardId(card.cardNumber)])),
  );
  assert.equal(totals.get(base), 4);

  let deck = {};
  for (let index = 0; index < 5; index += 1) deck = changeDeckQuantity(deck, base, 1);
  assert.equal(deck[base], 4);

  const [status] = getDeckOwnershipStatuses([{ id: base, quantity: deck[base], card: versions[0] }], totals);
  assert.deepEqual({ owned: status.ownedQuantity, shortage: status.shortageQuantity }, { owned: 4, shortage: 0 });
});
