import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import references from '../app/data/reference-data.json' with { type: 'json' };
import { baseCardId, groupCardsForDisplay } from '../lib/card-grouping.ts';
import { matchesGroupFilter } from '../lib/group-filter.ts';
import { missingMemberMetadata } from '../lib/member-options.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));
const audited = {
  'a-rise': { total: 7, member: 6, live: 1, cardNumbers: ['PL!-bp5-024-L', 'PL!-bp5-111-R', 'PL!-bp5-111-P＋', 'PL!-bp5-222-R', 'PL!-bp5-222-P＋', 'PL!-bp5-333-R', 'PL!-bp5-333-P＋'] },
  'saint-snow': { total: 6, member: 4, live: 2, cardNumbers: ['PL!S-bp5-022-L', 'PL!S-bp5-023-L', 'PL!S-bp5-111-R', 'PL!S-bp5-111-P＋', 'PL!S-bp5-222-R', 'PL!S-bp5-222-P＋'] },
  'sunny-passion': { total: 5, member: 4, live: 1, cardNumbers: ['PL!SP-bp5-027-L', 'PL!SP-bp5-111-R', 'PL!SP-bp5-111-P＋', 'PL!SP-bp5-222-R', 'PL!SP-bp5-222-P＋'] },
};

test('officially audited rival cards are complete, non-energy records', () => {
  for (const [groupId, expected] of Object.entries(audited)) {
    const actual = cards.filter((card) => card.groupIds.includes(groupId));
    assert.equal(actual.length, expected.total);
    assert.equal(actual.filter((card) => card.cardType === 'member').length, expected.member);
    assert.equal(actual.filter((card) => card.cardType === 'live').length, expected.live);
    assert.deepEqual(actual.map((card) => card.cardNumber), expected.cardNumbers);
    assert.ok(actual.every((card) => card.member || card.live));
  }
});

test('cross-group and rival parent filtering retain official affiliations', () => {
  const awaken = cards.find((card) => card.cardNumber === 'PL!S-bp5-023-L');
  assert.deepEqual(awaken.groupIds, ['aqours', 'saint-snow']);
  assert.equal(cards.filter((card) => matchesGroupFilter(card, 'rivals')).length, 18);
  assert.equal(cards.filter((card) => matchesGroupFilter(card, 'aqours')).length, 305);
});

test('other parent filter combines rival groups and other live cards without changing child filters', () => {
  const other = cards.filter((card) => matchesGroupFilter(card, 'other'));
  assert.ok(other.length > 0);
  assert.ok(other.every((card) => card.groupIds.some((groupId) => ['a-rise', 'saint-snow', 'sunny-passion', 'other-live'].includes(groupId))));
  assert.ok(cards.filter((card) => matchesGroupFilter(card, 'other-live')).every((card) => other.includes(card)));
});

test('rival member references and base-card display grouping are valid', () => {
  assert.deepEqual(missingMemberMetadata(references.members), []);
  assert.deepEqual(references.groups.filter((group) => ['a-rise', 'saint-snow', 'sunny-passion'].includes(group.id)).map((group) => group.label), ['A-RISE', 'Saint Snow', 'Sunny Passion']);
  for (const base of ['PL!-bp5-111', 'PL!S-bp5-111', 'PL!SP-bp5-111']) {
    const versions = cards.filter((card) => baseCardId(card.cardNumber) === base);
    assert.equal(groupCardsForDisplay(versions).length, 1);
  }
});

test('the expanded master has no duplicate identities, missing references, or invalid base ids', () => {
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.cardNumber)).size, cards.length);
  const groupIds = new Set(references.groups.map((group) => group.id));
  const memberIds = new Set(references.members.map((member) => member.id));
  const productIds = new Set(references.products.map((product) => product.id));
  for (const card of cards) {
    assert.notEqual(baseCardId(card.cardNumber), card.cardNumber);
    assert.ok(card.groupIds.length > 0 && card.groupIds.every((id) => groupIds.has(id)));
    assert.ok(memberIds.isSupersetOf(new Set(card.memberIds)));
    assert.ok(productIds.has(card.productId));
    assert.ok(card.cardType === 'member' ? card.member && !card.live : card.live && !card.member);
  }
});
