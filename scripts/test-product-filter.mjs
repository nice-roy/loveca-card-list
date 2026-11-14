import assert from 'node:assert/strict';
import test from 'node:test';
import references from '../app/data/reference-data.json' with { type: 'json' };
import { groupProductOptions, productFilterOption } from '../lib/product-filter.ts';

const options = references.products.map(productFilterOption);

test('product categories preserve every ID and support both numeric directions within the series order', () => {
  const descending = groupProductOptions(options, '', 'numberDesc');
  assert.deepEqual(descending.map(group => group.label), ['ブースターパック', 'プレミアムブースター', 'スタートデッキ', 'その他・PR']);
  assert.deepEqual(descending[0].options.map(option => option.code), ['BP8', 'BP7', 'BP6', 'BP5', 'BP4', 'BP3', 'BP2', 'BP1']);
  assert.deepEqual(descending[1].options.map(option => option.code), ["μ's-PB2", "μ's-PB1", 'Aq-PB1', 'N-PB1', 'Li-PB2', 'Li-PB1', 'HS-PB1']);
  const ascending = groupProductOptions(options, '', 'numberAsc');
  assert.deepEqual(ascending[0].options.map(option => option.code), ['BP1', 'BP2', 'BP3', 'BP4', 'BP5', 'BP6', 'BP7', 'BP8']);
  assert.deepEqual(ascending[2].options.map(option => option.code), ["μ's-SD1", 'Aq-SD1', 'N-SD1', 'N-SD2', 'Li-SD1', 'Li-SD2', 'HS-SD1']);
  for (const groups of [ascending, descending]) {
    assert.deepEqual(groups.flatMap(group => group.options.map(option => option.id)).sort(), options.map(option => option.id).sort());
  }
  assert.equal(descending.at(-1).options.at(-1).name, 'PRカード');
});

test('product search accepts names, full-width codes and multiple terms without changing source options', () => {
  const before = JSON.stringify(options);
  for (const query of ['ＢＰ８', 'bp8', 'まじかる']) {
    assert.deepEqual(groupProductOptions(options, query, 'numberDesc').flatMap(group => group.options.map(option => option.code)), ['BP8']);
  }
  assert.deepEqual(groupProductOptions(options, 'li DUO', 'numberAsc')[0].options.map(option => option.code), ['Li-PB2']);
  assert.equal(groupProductOptions(options, '存在しない商品', 'numberDesc').length, 0);
  assert.equal(JSON.stringify(options), before);
});

