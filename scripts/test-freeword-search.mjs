import assert from 'node:assert/strict';
import { test } from 'node:test';
import cards from '../app/data/cards.json' with { type: 'json' };
import references from '../app/data/reference-data.json' with { type: 'json' };
import { matchesFreewordSearch, splitFreewordSearchTerms } from '../lib/freeword-search.ts';

test('one word retains the existing partial-match behavior', () => {
  assert.equal(matchesFreewordSearch('澁谷かのん 控え室にあるカード', '控え室'), true);
  assert.equal(matchesFreewordSearch('澁谷かのん 控え室にあるカード', '登場'), false);
});

test('multiple half-width-space terms use AND matching across card fields', () => {
  const searchText = '澁谷かのん PL!SP-bp1-012 登場時：控え室にあるライブカードを選ぶ';
  assert.equal(matchesFreewordSearch(searchText, '澁谷かのん 控え室'), true);
  assert.equal(matchesFreewordSearch(searchText, '控え室 ライブ'), true);
  assert.equal(matchesFreewordSearch(searchText, '控え室 登場 ライブ'), true);
  assert.equal(matchesFreewordSearch(searchText, '控え室 存在しない語'), false);
});

test('full-width, repeated, and surrounding spaces are ignored as separators', () => {
  assert.deepEqual(splitFreewordSearchTerms('　控え室　　カード  '), ['控え室', 'カード']);
  assert.equal(matchesFreewordSearch('控え室にあるカード', '　控え室　　カード  '), true);
});

test('term order does not affect matching and normalization remains case-insensitive', () => {
  const searchText = 'PL!SP-BP1-012 控え室 ライブ';
  assert.equal(matchesFreewordSearch(searchText, 'ライブ 控え室'), true);
  assert.equal(matchesFreewordSearch(searchText, 'pl!sp-bp1-012'), true);
});


test('names match with half-width, full-width, or no spaces', () => {
  assert.equal(matchesFreewordSearch('唐 可可', '唐 可可'), true);
  assert.equal(matchesFreewordSearch('唐 可可', '唐可可'), true);
  assert.equal(matchesFreewordSearch('唐 可可', '唐　可可'), true);
  assert.equal(matchesFreewordSearch('鐘 嵐珠', '鐘嵐珠'), true);
  assert.equal(matchesFreewordSearch('宮下 愛', '宮下愛'), true);
  assert.equal(matchesFreewordSearch('渡辺 曜', '渡辺曜'), true);
});

test('every current space-containing member label matches without spaces', () => {
  const labels = references.members
    .map((member) => member.label)
    .filter((label) => /[\s\u3000]/u.test(label));
  assert.ok(labels.length > 0);

  for (const label of labels) {
    const withoutSpaces = label.replace(/[\s\u3000]+/gu, '');
    assert.equal(matchesFreewordSearch(label, withoutSpaces), true, label);
  }
});

test('space-containing card names and existing search targets remain searchable', () => {
  const names = [...new Set(cards
    .map((card) => card.name)
    .filter((name) => /[\s\u3000]/u.test(name)))];
  assert.ok(names.length > 0);

  for (const name of names) {
    assert.equal(matchesFreewordSearch(name, name.replace(/[\s\u3000]+/gu, '')), true, name);
  }

  const multiMemberName = '渡辺 曜&鬼塚夏美&大沢瑠璃乃';
  assert.equal(matchesFreewordSearch(multiMemberName, '渡辺曜'), true);
  assert.equal(matchesFreewordSearch('PL!SP-bp1-012 登場時：控え室にあるライブカードを選ぶ', 'PL!SP-bp1-012'), true);
  assert.equal(matchesFreewordSearch('PL!SP-bp1-012 登場時：控え室にあるライブカードを選ぶ', '控え室'), true);
});
