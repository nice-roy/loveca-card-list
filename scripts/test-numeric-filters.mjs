import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchesNumericFilter, numericOptions, retainAvailableIds } from '../lib/numeric-filters.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));

test('actual group options are unique, numeric ascending, and independent of other filters', () => {
  for (const group of ['all', 'liella', 'aqours', 'muse']) {
    for (const kind of ['cost', 'score']) {
      const values = cards.filter((c) => group === 'all' || c.groupIds.includes(group))
        .filter((c) => c.cardType === (kind === 'cost' ? 'member' : 'live'))
        .map((c) => kind === 'cost' ? c.member?.cost : c.live?.score)
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
      assert.deepEqual(numericOptions(cards, group, kind).map((o) => Number(o.id)), [...new Set(values)].sort((a, b) => a - b));
    }
  }
});

test('zero is a real score; null, non-finite and wrong card types are not options', () => {
  const fixture = [0, 2, 10, 2, null, NaN, Infinity].map((score) => ({ cardType: 'live', groupIds: ['test'], live: { score } }));
  assert.deepEqual(numericOptions(fixture, 'test', 'score').map((o) => o.id), ['0', '2', '10']);
  assert.equal(matchesNumericFilter(fixture[0], 'score', ['0']), true);
  assert.equal(matchesNumericFilter(fixture[4], 'score', ['0']), false);
  assert.equal(matchesNumericFilter(fixture[0], 'cost', ['0']), false);
  assert.equal(matchesNumericFilter(fixture[4], 'score', []), true);
});

test('multiple values use OR and compose with group/member/product conditions using AND', () => {
  const member = cards.find((c) => c.groupIds.includes('liella') && c.member?.cost === 2);
  const members = new Set(member.memberIds);
  const products = new Set([member.productId]);
  const base = cards.filter((c) => c.groupIds.includes('liella') && c.cardType === 'member'
    && c.memberIds.some((id) => members.has(id)) && products.has(c.productId));
  const actual = base.filter((c) => matchesNumericFilter(c, 'cost', ['2', '3', '4']));
  assert.ok(actual.length > 0);
  assert.deepEqual(actual, base.filter((c) => [2, 3, 4].includes(c.member.cost)));
  const lives = cards.filter((c) => c.groupIds.includes('aqours') && c.cardType === 'live');
  assert.deepEqual(lives.filter((c) => matchesNumericFilter(c, 'score', ['0', '3'])), lives.filter((c) => c.live.score === 0 || c.live.score === 3));
});

test('group changes remove only unavailable values and preserve valid values including zero', () => {
  assert.deepEqual(retainAvailableIds(['0', '3', '10'], [{ id: '0' }, { id: '3' }]), ['0', '3']);
  assert.deepEqual(retainAvailableIds(['2', '999'], numericOptions(cards, 'aqours', 'cost')), ['2']);
  assert.deepEqual(retainAvailableIds(['0', '999'], numericOptions(cards, 'muse', 'score')), ['0']);
});

test('existing pool counts remain unchanged', () => {
  assert.equal(cards.length, 1051);
  for (const [group, count] of [['liella', 483], ['aqours', 300], ['muse', 268]]) {
    assert.equal(cards.filter((c) => c.groupIds.includes(group)).length, count);
  }
  assert.equal(cards.filter((c) => c.cardType === 'member').length, 876);
  assert.equal(cards.filter((c) => c.cardType === 'live').length, 175);
  assert.equal(cards.filter((c) => c.cardType === 'energy').length, 0);
});
