import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyAuditedPurchaseLinks } from '../lib/purchase-links.ts';
import { cardlaboLinksForDisplay, groupCardsForDisplay } from '../lib/card-grouping.ts';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const raw = read('app/data/cards.json');
const live = read('app/data/live-purchase-links.json');
const links = read('app/data/duo-purchase-links.json');
const audit = read('docs/duo-purchase-links-audit.json');
const rawSnapshot = structuredClone(raw);
const before = applyAuditedPurchaseLinks(raw, live);
const cards = applyAuditedPurchaseLinks(raw, [...live, ...links]);
const duo = raw.filter(c => c.productId === 'product:79a3699c3a78');
const normalize = s => s.normalize('NFKC').replace(/\s/g, '').toLowerCase();

test('DUO audit covers all 96 physical versions with independently verified direct-page identities', () => {
  assert.equal(duo.length, 96);
  assert.equal(duo.filter(c => c.cardType === 'member').length, 56);
  assert.equal(duo.filter(c => c.cardType === 'live').length, 40);
  const records = [...audit.verified, ...audit.unverified];
  assert.deepEqual(new Set(records.map(r => r.cardId)), new Set(duo.map(c => c.id)));
  assert.equal(records.length, 96);
  assert.equal(links.length, audit.verified.length);
  assert.equal(new Set(links.map(r => r.cardId)).size, links.length);
  assert.equal(new Set(links.map(r => r.url)).size, links.length);
  for (const link of links) {
    const card = duo.find(c => c.id === link.cardId);
    const proof = audit.verified.find(r => r.cardId === link.cardId);
    assert.ok(card && proof);
    assert.equal(link.cardNumber, card.cardNumber);
    assert.equal(link.productId, card.productId);
    assert.equal(link.cardType, card.cardType);
    assert.equal(link.url, proof.url);
    assert.equal(proof.httpStatus, 200);
    assert.match(proof.htmlSha256, /^[a-f0-9]{64}$/);
    assert.equal(proof.detailTitle, proof.title);
    assert.match(link.url, /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
    assert.doesNotMatch(proof.title, /※|特価|状態/);
    const match = proof.detailTitle.match(/^【ラブカ】(.+?)【([^】]+)】(.+)$/);
    assert.ok(match);
    const name = ['SEC', 'PP'].includes(card.rarity) ? match[1].replace(/[（(]サイン[）)]$/, '') : match[1];
    assert.equal(normalize(name), normalize(card.name));
    assert.equal(normalize(match[2]), normalize(card.rarity));
    assert.equal(normalize(match[3]), normalize(card.cardNumber));
  }
});

test('only verified DUO purchaseLinks are added; every original field, order and old link is retained', () => {
  assert.equal(cards.length, 1913);
  assert.deepEqual(cards.slice(0, 1817), before.slice(0, 1817));
  for (let i = 1817; i < cards.length; i++) {
    const { purchaseLinks, ...rest } = cards[i];
    assert.deepEqual(rest, raw[i]);
    const record = links.find(r => r.cardId === cards[i].id);
    if (record) assert.deepEqual(purchaseLinks, [{ shopId: 'cardlabo', label: 'カードラボで購入', url: record.url }]);
    else assert.equal(purchaseLinks, undefined);
  }
  assert.deepEqual(raw, rawSnapshot);
  for (const record of audit.unverified) {
    assert.equal(cards.find(c => c.id === record.cardId).purchaseLinks, undefined);
  }
});

test('DUO overlay rejects wrong type/product/number, missing IDs, duplicates and conflicting URLs', () => {
  const sample = links.find(r => r.cardType === 'member');
  assert.ok(sample);
  for (const change of [{cardType: 'live'}, {productId: 'wrong-product'}, {cardNumber: sample.cardNumber + '-wrong'}]) {
    assert.throws(() => applyAuditedPurchaseLinks(raw, [{...sample, ...change}]), /wrong physical card/);
  }
  const {cardType: _type, ...withoutType} = sample;
  assert.throws(() => applyAuditedPurchaseLinks(raw, [withoutType]), /wrong physical card/);
  assert.throws(() => applyAuditedPurchaseLinks(raw, [{...sample, cardId: 'missing'}]), /missing physical card/);
  assert.throws(() => applyAuditedPurchaseLinks(raw, [sample, sample]), /Duplicate/);
  const once = applyAuditedPurchaseLinks(raw, [sample]);
  assert.deepEqual(applyAuditedPurchaseLinks(once, [sample]), once);
  assert.throws(() => applyAuditedPurchaseLinks(once, [{...sample, url: 'https://www.c-labo-online.jp/product/1'}]), /Conflicting/);
});

test('grouped and ungrouped surfaces retain separate DUO R/PP and live URLs without fallback', () => {
  const added = cards.filter(c => c.productId === 'product:79a3699c3a78');
  const grouped = groupCardsForDisplay(added).flatMap(g => cardlaboLinksForDisplay(g.cards));
  const ungrouped = added.flatMap(c => cardlaboLinksForDisplay([c]));
  const pairs = items => items.map(r => `${r.cardId}:${r.url}`).sort();
  assert.deepEqual(pairs(grouped), pairs(links));
  assert.deepEqual(pairs(ungrouped), pairs(links));
  const r = links.find(l => l.cardNumber === 'PL!-pb2-001-R');
  const pp = links.find(l => l.cardNumber === 'PL!-pb2-001-PP');
  assert.ok(r && pp);
  assert.equal(r.url, 'https://www.c-labo-online.jp/product/412488');
  assert.equal(pp.url, 'https://www.c-labo-online.jp/product/412437');
  assert.equal(links.find(l => l.cardNumber === 'PL!-bp3-020-SRL').url, 'https://www.c-labo-online.jp/product/412457');
  assert.notEqual(r.url, pp.url);
  assert.ok(links.some(l => l.cardType === 'live'));
  const missing = {...added[0], id: 'unverified-physical-version', purchaseLinks: undefined};
  assert.deepEqual(cardlaboLinksForDisplay([missing]), []);
  assert.equal(cardlaboLinksForDisplay([missing, added[0]]).some(l => l.cardId === missing.id), false);
});
