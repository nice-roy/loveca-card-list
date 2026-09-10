import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_TYPE_STORAGE_KEY, normalizeCardTypeFilter } from '../lib/card-type-preference.ts';

test('card type preference uses a dedicated, safe value', () => {
  assert.equal(CARD_TYPE_STORAGE_KEY, 'loveca-card-list:card-type:v1');
  assert.equal(normalizeCardTypeFilter(null), 'all');
  assert.equal(normalizeCardTypeFilter('all'), 'all');
  assert.equal(normalizeCardTypeFilter('member'), 'member');
  assert.equal(normalizeCardTypeFilter('live'), 'live');
  assert.equal(normalizeCardTypeFilter('energy'), 'all');
  assert.equal(normalizeCardTypeFilter({ value: 'live' }), 'all');
});
