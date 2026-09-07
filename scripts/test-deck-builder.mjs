import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDeckQuantity, groupDeckEntriesByMetric, normalizeBuilderState } from '../lib/deck-builder.ts';

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
