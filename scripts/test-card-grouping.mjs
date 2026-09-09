import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { baseCardId, cardVersion, groupCardsForDisplay } from '../lib/card-grouping.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));

test('base number and version are derived without changing individual records', () => {
  assert.equal(baseCardId('PL!SP-pb2-012-P＋'), 'PL!SP-pb2-012');
  assert.equal(cardVersion('PL!SP-pb2-012-P＋'), 'P＋');
  assert.equal(cards.length, 1069);
  assert.equal(new Set(cards.map((card) => card.id)).size, 1069);
});

test('all official version variants are grouped by their game-card identifier', () => {
  const groups = groupCardsForDisplay(cards);
  assert.equal(groups.length, 669);
  assert.equal(groups.filter((group) => group.cards.length > 1).length, 268);
  assert.equal(groups.filter((group) => group.cards.length > 1).reduce((sum, group) => sum + group.cards.length, 0), 668);
  assert.equal(groups.reduce((sum, group) => sum + group.cards.length, 0), cards.length);

  for (const group of groups) {
    for (const card of group.cards) {
      assert.equal(baseCardId(card.cardNumber), group.baseCardId);
    }
  }
});

test('version variants remain grouped when imported display metadata differs', () => {
  const sample = cards.find((card) => card.cardType === 'member' && card.member?.hearts.length);
  const changed = structuredClone(sample);
  changed.id += '-different';
  changed.cardNumber = `${baseCardId(sample.cardNumber)}-TEST`;
  changed.member.cost += 1;
  assert.equal(groupCardsForDisplay([sample, changed]).length, 1);
});

test('version variants remain grouped when optional metadata is missing', () => {
  const sample = structuredClone(cards.find((card) => card.cardType === 'member'));
  sample.effectText = null;
  const variant = structuredClone(sample);
  variant.id += '-variant';
  variant.cardNumber = `${baseCardId(sample.cardNumber)}-TEST`;
  assert.equal(groupCardsForDisplay([sample, variant]).length, 1);
});

test('audited representative version sets are each one display group', () => {
  const cases = [
    ['PL!SP-bp5-011', ['PL!SP-bp5-011-AR', 'PL!SP-bp5-011-P', 'PL!SP-bp5-011-R']],
    ['PL!SP-bp1-025', ['PL!SP-bp1-025-L', 'PL!SP-bp1-025-L＋', 'PL!SP-bp1-025-SECL', 'PL!SP-bp1-025-SRL']],
    ['PL!-bp4-002', ['PL!-bp4-002-P', 'PL!-bp4-002-P＋', 'PL!-bp4-002-R＋', 'PL!-bp4-002-SEC']],
  ];

  for (const [base, cardNumbers] of cases) {
    const versions = cards.filter((card) => cardNumbers.includes(card.cardNumber));
    assert.equal(versions.length, cardNumbers.length);
    for (const cardNumber of cardNumbers) assert.ok(versions.some((card) => card.cardNumber === cardNumber));
    const groups = groupCardsForDisplay(versions);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].baseCardId, base);
  }
});

test('filtering first keeps only matching versions, including full-number searches', () => {
  const productVersions = cards.filter((card) => card.productId === 'product:9fb769bcdff1' && baseCardId(card.cardNumber) === 'PL!SP-sd1-020');
  assert.deepEqual(productVersions.map((card) => card.cardNumber), ['PL!SP-sd1-020-P', 'PL!SP-sd1-020-SD2']);
  assert.equal(groupCardsForDisplay(productVersions).length, 1);

  const exactVersion = cards.filter((card) => card.cardNumber.includes('PL!SP-pb2-012-P＋'));
  assert.equal(exactVersion.length, 1);
  assert.equal(groupCardsForDisplay(exactVersion)[0].representative.cardNumber, 'PL!SP-pb2-012-P＋');
});
