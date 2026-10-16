import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { digest, importSnapshot, officialInteger } from './import-c1-pbll02.mjs';
import { baseCardId, groupCardsForDisplay } from '../lib/card-grouping.ts';
import { createAiConsultationText, changeDeckQuantity, normalizeBuilderState } from '../lib/deck-builder.ts';
import { inventoryTotalsByBase } from '../lib/inventory.ts';
import { matchesFreewordSearch } from '../lib/freeword-search.ts';
import { matchesNumericFilter } from '../lib/numeric-filters.ts';
import { missingMemberMetadata } from '../lib/member-options.ts';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const cards = read('../app/data/cards.json');
const refs = read('../app/data/reference-data.json');
const source = read('../docs/c1/official-pbll02.json');
const audit = read('../docs/c1/limited-audit.json');
const additions = cards.slice(1817);
const byNumber = new Map(cards.map(c => [c.cardNumber, c]));

test('C1 retains the exact 1817-card baseline, every ID, field and ordering', () => {
  assert.equal(source.baseline.count, 1817);
  assert.equal(digest(cards.slice(0, 1817)), source.baseline.cardsSha256);
  assert.equal(cards.length, 1913);
  assert.equal(new Set(cards.map(c => c.id)).size, 1913);
  assert.equal(new Set(cards.map(c => c.cardNumber)).size, 1913);
  assert.equal(refs.products.length, 23);
  assert.equal(additions.filter(c => c.member).length, 56);
  assert.equal(additions.filter(c => c.live).length, 40);
  assert.ok(additions.every(c => c.image.url === null && c.image.alt === null && !c.purchaseLinks));
});

test('every official physical version and all modeled stats match the reviewed text snapshot', () => {
  const heartFields = { heart01: 'pink', heart02: 'red', heart03: 'yellow', heart04: 'green', heart05: 'blue', heart06: 'purple', heart0: 'any' };
  assert.deepEqual(new Set(additions.map(c => c.cardNumber)), new Set(source.cards.map(c => c.card_number)));
  for (const row of source.cards) {
    const actual = byNumber.get(row.card_number);
    assert.equal(actual.name, row.card_name);
    assert.equal(actual.rarity, row.rare);
    assert.equal(actual.effectText, row.text.trim() || null);
    assert.deepEqual(actual.groupIds, ['muse']);
    assert.equal(refs.products.find(p => p.id === actual.productId).label, source.product.label);
    assert.equal(new URL(actual.officialUrl).searchParams.get('cardno'), row.card_number);
    const expectedHearts = Object.entries(heartFields).filter(([field]) => Number(row[field]) > 0)
      .map(([field, color]) => ({ color, count: Number(row[field]) }));
    assert.deepEqual(actual.member?.hearts ?? actual.live.requiredHearts, expectedHearts);
    if (actual.member) {
      assert.equal(actual.member.cost, Number(row.cost));
      assert.equal(actual.member.yell.count, row.attack === '-' ? null : Number(row.attack));
      const label = { pink: '桃', red: '赤', yellow: '黄', green: '緑', blue: '青', purple: '紫', any: '無' };
      assert.equal(actual.member.bladeHearts.map(v => `${label[v.color]}${v.count}`).join('') || '-', row.blade_heart);
    } else assert.equal(actual.live.score, Number(row.blade_heart));
  }
  assert.equal(source.excludedEnergy.length, 17);
  assert.ok(source.excludedEnergy.every(c => !byNumber.has(c.cardNumber)));
});

test('limited 2026 audit has no missing/excess member or live versions after addition', () => {
  assert.equal(audit.products.length, 10);
  for (const product of audit.products) {
    assert.ok(product.expansion.release_date.replaceAll('.', '-') <= source.asOf);
    const reference = refs.products.find(p => p.label === product.label);
    const actual = cards.filter(c => c.productId === reference.id);
    assert.deepEqual(new Set(actual.map(c => c.cardNumber)), new Set(product.officialCards.map(c => c.cardNumber)));
    assert.deepEqual(product.masterOnly, []);
  }
  // Existing missing rarity metadata is documented, never silently rewritten.
  const priorDifferences = audit.products.flatMap(p => p.rarityDifferences);
  assert.equal(priorDifferences.length, 248);
  for (const difference of priorDifferences) assert.equal(byNumber.get(difference.number).rarity, difference.before);
});

test('import is idempotent and refuses corrupted baseline, duplicate source and future release', () => {
  const result = importSnapshot(cards, refs, source);
  assert.equal(result.added, 0);
  assert.deepEqual(result.cards, cards);
  assert.deepEqual(result.references, refs);
  const changed = structuredClone(cards);
  changed[0].name += 'changed';
  assert.throws(() => importSnapshot(changed, refs, source), /Existing cards changed/);
  const duplicate = structuredClone(source);
  duplicate.cards[1] = duplicate.cards[0];
  assert.throws(() => importSnapshot(cards, refs, duplicate));
  assert.throws(() => importSnapshot(cards, refs, { ...source, asOf: '2026-10-02' }));
  const conflict = structuredClone(cards);
  conflict.at(-1).rarity = 'wrong';
  assert.throws(() => importSnapshot(conflict, refs, source), /Existing version conflict/);
});

test('blade numeric boundary is preserved through import and AI deck output without a five-blade cap', () => {
  for (const count of [0, 5, 6, 7, 8, 9, 12]) assert.equal(officialInteger(String(count)), count);
  for (const value of ['', '-', '6個', 'blade6.png', 'NaN', '-1', '1.5']) assert.throws(() => officialInteger(value));
  for (const [number, blades] of [['PL!-pb2-016-R', 6], ['PL!-pb2-000-DUO', 7], ['PL!-pb2-018-R', 8], ['PL!-pb2-001-R', 9]]) {
    const card = byNumber.get(number);
    assert.equal(card.member.yell.count, blades);
    assert.ok(createAiConsultationText([{ id: baseCardId(number), quantity: 1, card }]).includes(`ブレード：${blades}`));
    assert.ok(matchesFreewordSearch(`${card.name} ${card.cardNumber}`, number));
    assert.ok(matchesNumericFilter(card, 'cost', [String(card.member.cost)]));
  }
});

test('new pair, parallel and reprint versions retain member options, shared deck cap and ownership', () => {
  assert.deepEqual(missingMemberMetadata(refs.members), []);
  for (const base of ['PL!-pb2-000', 'PL!-pb2-016', 'PL!-bp3-019']) {
    const versions = cards.filter(c => baseCardId(c.cardNumber) === base);
    assert.ok(versions.length >= 2);
    assert.equal(groupCardsForDisplay(versions).length, 1);
    const ids = new Map(versions.map(c => [c.id, base]));
    assert.equal(inventoryTotalsByBase({ [versions[0].id]: 2, [versions[1].id]: 3 }, ids).get(base), 5);
    let deck = {};
    for (let i = 0; i < 5; i++) deck = changeDeckQuantity(deck, base, 1);
    assert.equal(deck[base], 4);
  }
  const oldBase = baseCardId(cards[0].cardNumber);
  const state = { version: 2, candidates: [oldBase], decks: [{ id: 'existing', name: '既存', cards: { [oldBase]: 4 } }], activeDeckId: 'existing' };
  assert.deepEqual(normalizeBuilderState(state, new Set(cards.map(c => baseCardId(c.cardNumber)))), state);
});
