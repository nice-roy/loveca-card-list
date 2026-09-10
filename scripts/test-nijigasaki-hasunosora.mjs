import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import audit from '../app/data/nijigasaki-hasunosora-audit.json' with { type: 'json' };
import liveAudit from '../app/data/live-card-audit.json' with { type: 'json' };
import { baseCardId, groupCardsForDisplay } from '../lib/card-grouping.ts';
import { changeDeckQuantity } from '../lib/deck-builder.ts';
import { getDeckOwnershipStatuses } from '../lib/deck-ownership.ts';
import { matchesGroupFilter, matchesMemberGroupFilter } from '../lib/group-filter.ts';
import { inventoryTotalsByBase } from '../lib/inventory.ts';
import { groupMemberOptions, missingMemberMetadata } from '../lib/member-options.ts';

const cards = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));
const references = JSON.parse(readFileSync(new URL('../app/data/reference-data.json', import.meta.url), 'utf8'));

test('official group snapshots and the preceding live audit are completely represented', () => {
  assert.equal(audit.format, 'loveca-card-list-nijigasaki-hasunosora-audit');
  assert.deepEqual({ member: audit.groups.nijigasaki.officialMemberCount, live: audit.groups.nijigasaki.officialLiveCount, total: audit.groups.nijigasaki.officialTotal }, { member: 396, live: 58, total: 454 });
  assert.deepEqual({ member: audit.groups.hasunosora.officialMemberCount, live: audit.groups.hasunosora.officialLiveCount, total: audit.groups.hasunosora.officialTotal }, { member: 245, live: 50, total: 295 });
  assert.deepEqual({ existing: audit.uniqueExistingRecords, added: audit.uniqueAddedRecords }, { existing: 4, added: 744 });
  for (const groupId of ['nijigasaki', 'hasunosora']) {
    const expected = audit.groups[groupId];
    const actual = cards.filter((card) => card.groupIds.includes(groupId));
    assert.equal(actual.length, expected.officialTotal);
    assert.equal(actual.filter((card) => card.cardType === 'member').length, expected.officialMemberCount);
    assert.equal(actual.filter((card) => card.cardType === 'live').length, expected.officialLiveCount);
    assert.deepEqual(new Set(actual.map((card) => card.cardNumber)), new Set(expected.cardNumbers));
  }
  assert.deepEqual(new Set(cards.filter((card) => card.cardType === 'live').map((card) => card.cardNumber)), new Set(liveAudit.officialLiveCards.map((card) => card.cardNumber)));
});

test('the verified 1073-card baseline is retained except for four official affiliation additions', () => {
  const restored = structuredClone(cards.slice(0, audit.baseline.cardCount));
  for (const update of audit.existingCardAffiliationUpdates) {
    restored.find((card) => card.cardNumber === update.cardNumber).groupIds = update.before;
  }
  assert.equal(createHash('sha256').update(JSON.stringify(restored)).digest('hex'), audit.baseline.cardsSha256);
  assert.equal(audit.existingCardAffiliationUpdates.length, 4);
});

test('the expanded card master has valid unique identities and references', () => {
  assert.deepEqual({ total: cards.length, member: cards.filter((card) => card.cardType === 'member').length, live: cards.filter((card) => card.cardType === 'live').length }, { total: 1817, member: 1526, live: 291 });
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.cardNumber)).size, cards.length);
  const groupIds = new Set(references.groups.map((item) => item.id));
  const memberIds = new Set(references.members.map((item) => item.id));
  const productIds = new Set(references.products.map((item) => item.id));
  for (const card of cards) {
    assert.notEqual(baseCardId(card.cardNumber), card.cardNumber);
    assert.ok(card.groupIds.length && card.groupIds.every((id) => groupIds.has(id)));
    assert.ok(card.memberIds.every((id) => memberIds.has(id)));
    assert.ok(productIds.has(card.productId));
    assert.equal(card.cardType === 'member', Boolean(card.member) && !card.live);
    assert.equal(card.cardType === 'live', Boolean(card.live) && !card.member);
  }
});

test('official heart fields retain their confirmed color mapping', () => {
  const poppinUp = cards.find((card) => card.cardNumber === 'PL!N-bp1-026-SECL');
  assert.deepEqual(poppinUp.live.requiredHearts, [{ color: 'yellow', count: 1 }, { color: 'any', count: 2 }]);
});

test('group and member filters expose both groups including cross-group member choices', () => {
  for (const groupId of ['nijigasaki', 'hasunosora']) {
    assert.equal(references.groups.find((group) => group.id === groupId)?.enabled, true);
    assert.ok(cards.some((card) => matchesGroupFilter(card, groupId)));
    assert.ok(references.members.some((member) => matchesMemberGroupFilter(member, groupId)));
  }
  const cross = references.members.find((member) => member.label === '上原歩夢&澁谷かのん&日野下花帆');
  assert.ok(matchesMemberGroupFilter(cross, 'nijigasaki'));
  assert.ok(matchesMemberGroupFilter(cross, 'hasunosora'));
});

test('officially verified unit metadata is complete while school years stay unasserted', () => {
  assert.deepEqual(missingMemberMetadata(references.members), []);
  const expectedUnits = {
    nijigasaki: ['A・ZU・NA', 'QU4RTZ', 'R3BIRTH', 'DiverDiva', '複数メンバー'],
    hasunosora: ['スリーズブーケ', 'DOLLCHESTRA', 'みらくらぱーく！', 'Edel Note', '複数メンバー'],
  };
  for (const [groupId, labels] of Object.entries(expectedUnits)) {
    const options = references.members.filter((member) => matchesMemberGroupFilter(member, groupId));
    const school = groupMemberOptions(options, groupId, references.groups, 'schoolYear')[0];
    const unit = groupMemberOptions(options, groupId, references.groups, 'unit')[0];
    assert.ok(school.sections.some((section) => section.label === '学年なし'));
    assert.deepEqual(unit.sections.map((section) => section.label), labels);
    assert.equal(unit.sections.filter((section) => section.label !== '複数メンバー').flatMap((section) => section.options).length, groupId === 'nijigasaki' ? 12 : 11);
  }
});

test('representative variants group, ownership aggregates, deck cap and shortage calculation remain shared', () => {
  for (const base of ['PL!N-bp5-001', 'PL!HS-bp5-001']) {
    const versions = cards.filter((card) => baseCardId(card.cardNumber) === base);
    assert.ok(versions.length >= 4);
    assert.equal(groupCardsForDisplay(versions).length, 1);
    const totals = inventoryTotalsByBase({ [versions[0].id]: 2, [versions[1].id]: 2 }, new Map(versions.map((card) => [card.id, baseCardId(card.cardNumber)])));
    assert.equal(totals.get(base), 4);
    let deck = {};
    for (let index = 0; index < 5; index += 1) deck = changeDeckQuantity(deck, base, 1);
    assert.equal(deck[base], 4);
    assert.equal(getDeckOwnershipStatuses([{ id: base, quantity: 4, card: versions[0] }], totals)[0].shortageQuantity, 0);
  }
});
