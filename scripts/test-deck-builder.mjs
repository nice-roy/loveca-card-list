import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDeckQuantity, normalizeBuilderState } from '../lib/deck-builder.ts';

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
