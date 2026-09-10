import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import audit from '../app/data/live-card-audit.json' with { type: 'json' };
import targetAudit from '../app/data/nijigasaki-hasunosora-audit.json' with { type: 'json' };
import { baseCardId, groupCardsForDisplay } from '../lib/card-grouping.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));
const liveCards = cards.filter((card) => card.cardType === 'live');
const additions = [
  'PL!SP-pb2-046-L',
  'LL-bp5-001-L',
  'LL-bp5-002-L',
  'LL-PR-004-PR',
];

test('official live audit snapshot records the complete official live-card universe', () => {
  assert.equal(audit.format, 'loveca-card-list-live-audit');
  assert.equal(audit.version, 1);
  assert.equal(audit.baseline.cardCount, 1069);
  assert.equal(audit.baseline.liveCount, 179);
  assert.equal(audit.officialLiveCards.length, 291);
  assert.equal(new Set(audit.officialLiveCards.map((card) => card.cardNumber)).size, 291);
  assert.equal(audit.missing.length, 112);
  assert.equal(audit.missing.filter((card) => card.classification === 'nijigasaki').length, 58);
  assert.equal(audit.missing.filter((card) => card.classification === 'hasunosora').length, 50);
  assert.equal(audit.missing.filter((card) => card.classification === 'special-unclassified').length, 3);
  assert.equal(audit.missing.filter((card) => card.classification === 'series-cross-special').length, 1);
});

test('the original 1069 card records remain byte-for-structure unchanged and approved global lives are appended', () => {
  const original = cards.slice(0, audit.baseline.cardCount);
  const restored = structuredClone(original);
  for (const update of targetAudit.existingCardAffiliationUpdates) {
    const card = restored.find((item) => item.cardNumber === update.cardNumber);
    if (card) card.groupIds = update.before;
  }
  assert.equal(createHash('sha256').update(JSON.stringify(restored)).digest('hex'), audit.baseline.cardsPrefixSha256);
  assert.equal(cards.length, 1817);
  assert.equal(liveCards.length, 291);
  assert.deepEqual(cards.slice(audit.baseline.cardCount, audit.baseline.cardCount + additions.length).map((card) => card.cardNumber), additions);
  assert.ok(cards.slice(audit.baseline.cardCount, audit.baseline.cardCount + additions.length).every((card) => card.cardType === 'live' && card.groupIds.includes('other-live')));
});

test('the four confirmed special lives remain distinct base cards and are reachable through the display category', () => {
  const addedCards = additions.map((number) => cards.find((card) => card.cardNumber === number));
  assert.ok(addedCards.every(Boolean));
  assert.equal(groupCardsForDisplay(addedCards).length, additions.length);
  assert.equal(new Set(addedCards.map((card) => baseCardId(card.cardNumber))).size, additions.length);
  assert.deepEqual(audit.missing.filter((card) => card.addedInThisAudit).map((card) => card.cardNumber), additions);
});
