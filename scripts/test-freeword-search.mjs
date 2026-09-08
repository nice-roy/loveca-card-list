import assert from 'node:assert/strict';
import { test } from 'node:test';
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
