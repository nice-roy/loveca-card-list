import assert from 'node:assert/strict';
import test from 'node:test';
import cards from '../app/data/cards.json' with { type: 'json' };
import bladeAudit from '../docs/effect-reader/blade-display-audit.json' with { type: 'json' };
import { heartDisplayLabel, splitEffectTextForDisplay } from '../lib/heart-presentation.ts';

const colors = new Set(['pink', 'red', 'yellow', 'green', 'blue', 'purple', 'any']);

test('every stored heart value uses a known official color and a positive integer count', () => {
  for (const card of cards) {
    const values = [
      ...(card.member?.hearts ?? []),
      ...(card.member?.bladeHearts ?? []),
      ...(card.live?.requiredHearts ?? []),
    ];
    for (const value of values) {
      assert.ok(colors.has(value.color), `${card.cardNumber}: unknown color ${value.color}`);
      assert.ok(Number.isInteger(value.count) && value.count > 0, `${card.cardNumber}: invalid count ${value.count}`);
    }
  }
});

test('officially corrected heart records retain their color and quantity', () => {
  const yo = cards.find((card) => card.cardNumber === 'PL!S-PR-046-PR');
  const eli = cards.find((card) => card.cardNumber === 'PL!-PR-023-PR');
  assert.deepEqual(yo.member?.hearts, [
    { color: 'red', count: 1 }, { color: 'green', count: 1 }, { color: 'blue', count: 1 },
  ]);
  assert.deepEqual(eli.member?.hearts, [
    { color: 'pink', count: 1 }, { color: 'yellow', count: 1 }, { color: 'purple', count: 2 },
  ]);
});

test('stored effects contain no flattened colorless heart glyphs', () => {
  const flattened = cards.filter((card) => /[♥◇]/.test(card.effectText ?? ''));
  assert.deepEqual(flattened.map((card) => card.cardNumber), []);
});

test('effect display converts every official heart token into an explicit colored label', () => {
  const text = 'heart02[heart03][heart06]heart0 [heart05]ブレード [ブレード] [ALLブレード]';
  const icons = splitEffectTextForDisplay(text).filter((fragment) => fragment.type === 'icon').map((fragment) => fragment.icon);
  assert.deepEqual(icons, [
    { type: 'heart', color: 'red' },
    { type: 'heart', color: 'yellow' },
    { type: 'heart', color: 'purple' },
    { type: 'heart', color: 'any' },
    { type: 'blade', color: 'blue', all: false },
    { type: 'blade', color: null, all: false },
    { type: 'blade', color: 'all', all: true },
  ]);
  assert.equal(heartDisplayLabel('yellow'), '黄ハート');
  assert.equal(heartDisplayLabel('all', true), 'ALLブレード');
  assert.equal(heartDisplayLabel('any', true), '無色ブレード');
});

test('all effect tokens are consumed by the display transformation', () => {
  for (const card of cards) {
    const visibleText = splitEffectTextForDisplay(card.effectText ?? '')
      .filter((fragment) => fragment.type === 'text')
      .map((fragment) => fragment.value)
      .join('');
    assert.doesNotMatch(visibleText, /\[?heart0(?:[1-6])?\]?/i, card.cardNumber);
  }
});

test('the full-card blade display audit accounts for every affected version and preserves repeated icons', () => {
  const affected = cards.filter(card => (card.effectText ?? '').includes('[ブレード]'));
  assert.equal(cards.length, bladeAudit.masterCount);
  assert.equal(affected.length, 342);
  assert.equal(affected.filter(card => card.cardType === 'member').length, 298);
  assert.equal(affected.filter(card => card.cardType === 'live').length, 44);
  assert.deepEqual(affected.map(card => card.cardNumber), bladeAudit.cards.map(card => card.cardNumber));
  let total = 0;
  for (const card of affected) {
    const expected = bladeAudit.cards.find(row => row.cardNumber === card.cardNumber).bladeIcons;
    const fragments = splitEffectTextForDisplay(card.effectText);
    const ordinary = fragments.filter(fragment => fragment.type === 'icon' && fragment.icon.type === 'blade' && fragment.icon.color === null && !fragment.icon.all);
    assert.equal(ordinary.length, expected, card.cardNumber);
    total += ordinary.length;
    const text = fragments.filter(fragment => fragment.type === 'text').map(fragment => fragment.value).join('');
    assert.doesNotMatch(text, /\[ブレード\]|◆/, card.cardNumber);
  }
  assert.equal(total, 523);
  assert.equal(total, bladeAudit.totalBladeIcons);
});
