import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { baseCardId, cardVersion, groupCardsForDisplay } from '../lib/card-grouping.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));

test('base number and version are derived without changing individual records', () => {
  assert.equal(baseCardId('PL!SP-pb2-012-P＋'), 'PL!SP-pb2-012');
  assert.equal(cardVersion('PL!SP-pb2-012-P＋'), 'P＋');
  assert.equal(cards.length, 1051);
  assert.equal(new Set(cards.map((card) => card.id)).size, 1051);
});

test('only complete, performance-identical variants are grouped', () => {
  const groups = groupCardsForDisplay(cards);
  assert.equal(groups.length, 681);
  assert.equal(groups.filter((group) => group.cards.length > 1).length, 256);
  assert.equal(groups.filter((group) => group.cards.length > 1).reduce((sum, group) => sum + group.cards.length, 0), 626);
  assert.equal(groups.reduce((sum, group) => sum + group.cards.length, 0), cards.length);

  for (const group of groups.filter((item) => item.cards.length > 1)) {
    const first = group.cards[0];
    for (const card of group.cards.slice(1)) {
      assert.equal(baseCardId(card.cardNumber), group.baseCardId);
      assert.equal(card.name, first.name);
      assert.equal(card.cardType, first.cardType);
      assert.deepEqual(card.member, first.member);
      assert.deepEqual(card.live, first.live);
      assert.equal(card.effectText.trim().replace(/\s+/g, ' '), first.effectText.trim().replace(/\s+/g, ' '));
    }
  }
});

test('same base number with different performance remains separate', () => {
  const sample = cards.find((card) => card.cardType === 'member' && card.member?.hearts.length);
  const changed = structuredClone(sample);
  changed.id += '-different';
  changed.cardNumber = `${baseCardId(sample.cardNumber)}-TEST`;
  changed.member.cost += 1;
  assert.equal(groupCardsForDisplay([sample, changed]).length, 2);
});

test('missing comparison data remains separate', () => {
  const sample = structuredClone(cards.find((card) => card.cardType === 'member'));
  sample.effectText = null;
  const variant = structuredClone(sample);
  variant.id += '-variant';
  variant.cardNumber = `${baseCardId(sample.cardNumber)}-TEST`;
  assert.equal(groupCardsForDisplay([sample, variant]).length, 2);
});

test('filtering first keeps only matching versions, including full-number searches', () => {
  const productVersions = cards.filter((card) => card.productId === 'product:9fb769bcdff1' && baseCardId(card.cardNumber) === 'PL!SP-sd1-020');
  assert.deepEqual(productVersions.map((card) => card.cardNumber), ['PL!SP-sd1-020-P', 'PL!SP-sd1-020-SD2']);
  assert.equal(groupCardsForDisplay(productVersions).length, 1);

  const exactVersion = cards.filter((card) => card.cardNumber.includes('PL!SP-pb2-012-P＋'));
  assert.equal(exactVersion.length, 1);
  assert.equal(groupCardsForDisplay(exactVersion)[0].representative.cardNumber, 'PL!SP-pb2-012-P＋');
});
