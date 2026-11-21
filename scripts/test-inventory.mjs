import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeOwnedQuantity, inventoryTotalsByBase, matchesInventoryFilter, normalizeInventory, setOwnedQuantity } from '../lib/inventory.ts';

test('inventory keeps only known version ids with integer quantities from 1 to 99', () => {
  assert.deepEqual(normalizeInventory({ version: 1, cards: { regular: 2, parallel: 99, zero: 0, tooMany: 100, decimal: 1.5, unknown: 3 } }, new Set(['regular', 'parallel', 'zero', 'tooMany', 'decimal'])), {
    regular: 2,
    parallel: 99,
  });
});

test('inventory controls stay between zero and 99 and remove zero entries', () => {
  let inventory = {};
  inventory = changeOwnedQuantity(inventory, 'regular', 1);
  assert.deepEqual(inventory, { regular: 1 });
  inventory = setOwnedQuantity(inventory, 'regular', 99);
  inventory = changeOwnedQuantity(inventory, 'regular', 1);
  assert.deepEqual(inventory, { regular: 99 });
  inventory = setOwnedQuantity(inventory, 'regular', 0);
  assert.deepEqual(inventory, {});
  assert.strictEqual(setOwnedQuantity(inventory, 'regular', -1), inventory);
  assert.strictEqual(setOwnedQuantity(inventory, 'regular', 100), inventory);
});

test('base-card totals add quantities across versions without losing version detail', () => {
  const inventory = { regular: 2, parallel: 2, other: 3 };
  const totals = inventoryTotalsByBase(inventory, new Map([['regular', 'BASE-001'], ['parallel', 'BASE-001'], ['other', 'BASE-002']]));
  assert.deepEqual([...totals], [['BASE-001', 4], ['BASE-002', 3]]);
  assert.deepEqual(inventory, { regular: 2, parallel: 2, other: 3 });
});

test('owned filter uses base totals only while identical cards are grouped', () => {
  const inventory = { parallel: 2 };
  const totals = new Map([['BASE-001', 2]]);
  assert.equal(matchesInventoryFilter('owned', 'regular', 'BASE-001', true, inventory, totals), true);
  assert.equal(matchesInventoryFilter('unowned', 'regular', 'BASE-001', true, inventory, totals), false);
  assert.equal(matchesInventoryFilter('owned', 'regular', 'BASE-001', false, inventory, totals), false);
  assert.equal(matchesInventoryFilter('unowned', 'regular', 'BASE-001', false, inventory, totals), true);
  assert.equal(matchesInventoryFilter('all', 'regular', 'BASE-001', false, inventory, totals), true);
});

test('quantity filters match exact counts through three and include all counts from four up', () => {
  const inventory = { regular: 3, parallel: 1, pair: 2, stack: 5 };
  const bases = new Map([['regular', 'A'], ['parallel', 'A'], ['pair', 'B'], ['stack', 'C'], ['missing', 'D']]);
  const totals = inventoryTotalsByBase(inventory, bases);
  function matchingVersions(filter, grouped) {
    return [...bases.keys()].filter(id => matchesInventoryFilter(filter, id, bases.get(id), grouped, inventory, totals));
  }

  assert.deepEqual(matchingVersions('4+', true), ['regular', 'parallel', 'stack']);
  assert.deepEqual(matchingVersions('4+', false), ['stack']);
  assert.deepEqual(matchingVersions('3', true), []);
  assert.deepEqual(matchingVersions('3', false), ['regular']);
  assert.deepEqual(matchingVersions('2', true), ['pair']);
  assert.deepEqual(matchingVersions('2', false), ['pair']);
  assert.deepEqual(matchingVersions('1', true), []);
  assert.deepEqual(matchingVersions('1', false), ['parallel']);
});
