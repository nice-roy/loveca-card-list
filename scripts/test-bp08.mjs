import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { digest, importSnapshot } from './import-bp08.mjs';
import { baseCardId, groupCardsForDisplay, cardlaboLinksForDisplay } from '../lib/card-grouping.ts';
import { changeDeckQuantity, normalizeBuilderState, formatEffectTextForAi } from '../lib/deck-builder.ts';
import { inventoryTotalsByBase } from '../lib/inventory.ts';
import { matchesGroupFilter, matchesMemberGroupFilter } from '../lib/group-filter.ts';
import { missingMemberMetadata } from '../lib/member-options.ts';
import { productFilterOption } from '../lib/product-filter.ts';
import { splitEffectTextForDisplay } from '../lib/heart-presentation.ts';
import { applyAuditedPurchaseLinks } from '../lib/purchase-links.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const cards = read('../app/data/cards.json');
const refs = read('../app/data/reference-data.json');
const snapshot = read('../docs/bp08/official-bp08.json');
const additions = cards.slice(snapshot.baseline.count);
const links = read('../app/data/bp08-purchase-links.json');
const audit = read('../docs/bp08/purchase-links-audit.json');
const oldLinks = [...read('../app/data/live-purchase-links.json'), ...read('../app/data/duo-purchase-links.json')];
const normalize = s => s.normalize('NFKC').replace(/\s/g, '').toLowerCase();

test('BP08 preserves the exact 1913-card baseline, references and every existing purchase link', () => {
  assert.equal(digest(cards.slice(0, 1913)), snapshot.baseline.cardsSha256);
  assert.equal(cards.length, 2054);
  assert.equal(new Set(cards.map(c => c.id)).size, 2054);
  assert.equal(new Set(cards.map(c => c.cardNumber)).size, 2054);
  assert.equal(additions.length, 141);
  assert.equal(additions.filter(c => c.member).length, 108);
  assert.equal(additions.filter(c => c.live).length, 33);
  assert.ok(additions.every(c => c.image.url === null && c.image.alt === null && !c.purchaseLinks));
  const before = applyAuditedPurchaseLinks(cards, oldLinks);
  const after = applyAuditedPurchaseLinks(cards, [...oldLinks, ...links]);
  assert.deepEqual(after.slice(0, 1913), before.slice(0, 1913));
  assert.deepEqual(after.map(({purchaseLinks, ...rest}) => rest), before.map(({purchaseLinks, ...rest}) => rest));
  assert.deepEqual(importSnapshot(cards, refs, snapshot), {cards, references: refs, added: 0});
});

test('every official physical version, effect, number and modeled stat matches BP08 exactly', () => {
  assert.deepEqual(new Set(additions.map(c => c.cardNumber)), new Set(snapshot.cards.map(c => c.card_number)));
  const heartFields = { heart01: 'pink', heart02: 'red', heart03: 'yellow', heart04: 'green', heart05: 'blue', heart06: 'purple', heart0: 'any' };
  const groupIds = { "μ's": 'muse', '虹ヶ咲': 'nijigasaki', '蓮ノ空': 'hasunosora' };
  const labels = { pink: '桃', red: '赤', yellow: '黄', green: '緑', blue: '青', purple: '紫', any: '無' };
  for (const row of snapshot.cards) {
    const card = additions.find(c => c.cardNumber === row.card_number);
    assert.equal(card.name, row.card_name);
    assert.equal(card.rarity, row.rare);
    assert.equal(card.effectText, row.text.trim() || null);
    assert.deepEqual(card.groupIds, row.group_name.split('/').map(g => groupIds[g]));
    assert.equal(new URL(card.officialUrl).searchParams.get('cardno'), row.card_number);
    assert.deepEqual(card.member?.hearts ?? card.live.requiredHearts, Object.entries(heartFields).filter(([k]) => Number(row[k]) > 0).map(([k, color]) => ({color, count: Number(row[k])})));
    if (card.member) {
      assert.equal(card.member.cost, Number(row.cost));
      assert.equal(card.member.yell.count, row.attack === '-' ? null : Number(row.attack));
      assert.equal(card.member.bladeHearts.map(h => `${labels[h.color]}${h.count}`).join('') || '-', row.blade_heart);
    } else assert.equal(card.live.score, Number(row.blade_heart));
  }
  assert.ok(snapshot.excludedEnergy.every(e => !cards.some(c => c.cardNumber === e.card_number)));
  assert.deepEqual(Object.fromEntries(['P','N','L','R','SECL','R+','P+','SEC'].map(r => [r, additions.filter(c => c.rarity === r).length])), { P:29, N:29, L:21, R:19, SECL:12, 'R+':11, 'P+':10, SEC:10 });
});

test('BP08 importer refuses altered baselines, duplicates, future dates and unconfirmed values', () => {
  const badCards = structuredClone(cards); badCards[0].name += 'changed';
  assert.throws(() => importSnapshot(badCards, refs, snapshot), /Existing cards changed/);
  const badRefs = structuredClone(refs); badRefs.groups[0].label += 'changed';
  assert.throws(() => importSnapshot(cards, badRefs, snapshot), /Existing references changed/);
  for (const mutate of [s => s.cards[1] = s.cards[0], s => s.asOf = '2026-11-13', s => s.cards[0].cost = 'unknown']) {
    const source = structuredClone(snapshot); mutate(source);
    assert.throws(() => importSnapshot(cards, refs, source));
  }
  const conflict = structuredClone(cards); conflict.at(-1).rarity = 'wrong';
  assert.throws(() => importSnapshot(conflict, refs, snapshot), /Existing version conflict/);
});

test('BP8 product, cross-group member, parallel ownership and old deck state remain usable', () => {
  const product = refs.products.find(p => p.id === additions[0].productId);
  assert.equal(productFilterOption(product).label, 'BP8｜ブースターパック まじかる♡とり～と');
  const cross = additions.find(c => c.cardNumber === 'LL-bp8-001-R＋');
  const member = refs.members.find(m => m.id === cross.memberIds[0]);
  for (const group of ['muse','nijigasaki','hasunosora']) {
    assert.ok(matchesGroupFilter(cross, group)); assert.ok(matchesMemberGroupFilter(member, group));
  }
  assert.deepEqual(missingMemberMetadata(refs.members), []);
  for (const base of ['PL!-bp8-003','PL!N-bp8-001','PL!HS-bp8-004','PL!-bp3-026']) {
    const versions = cards.filter(c => baseCardId(c.cardNumber) === base);
    assert.ok(versions.length >= 2); assert.equal(groupCardsForDisplay(versions).length, 1);
    assert.equal(inventoryTotalsByBase({[versions[0].id]:2,[versions[1].id]:3},new Map(versions.map(c => [c.id,base]))).get(base), 5);
    let deck = {}; for (let i=0;i<5;i++) deck = changeDeckQuantity(deck,base,1); assert.equal(deck[base],4);
  }
  const oldBase = baseCardId(cards[0].cardNumber);
  const state = {version:2,candidates:[oldBase],decks:[{id:'old',name:'既存',cards:{[oldBase]:4}}],activeDeckId:'old'};
  assert.deepEqual(normalizeBuilderState(state,new Set(cards.map(c => baseCardId(c.cardNumber)))),state);
});

test('orange blade hearts in Snow halation retain their explicit color and readable AI text', () => {
  for (const rarity of ['L','SECL']) {
    const card = cards.find(c => c.cardNumber === `PL!-bp8-023-${rarity}`);
    const fragments = splitEffectTextForDisplay(card.effectText);
    assert.equal(fragments.filter(f => f.type === 'icon' && f.icon.type === 'blade' && f.icon.color === 'orange').length,2);
    assert.ok(formatEffectTextForAi(card).includes('橙ブレードハート'));
  }
});

test('all 141 BP08 purchase links identify the exact physical version on an independently checked page', () => {
  assert.equal(links.length,141); assert.equal(audit.verified.length,141); assert.deepEqual(audit.unverified,[]);
  assert.deepEqual(new Set(links.map(l => l.cardNumber)),new Set(additions.map(c => c.cardNumber)));
  assert.equal(new Set(links.map(l => l.url)).size,141);
  for (const link of links) {
    const card = additions.find(c => c.id === link.cardId);
    const proof = audit.verified.find(r => r.cardId === link.cardId);
    assert.equal(link.cardNumber,card.cardNumber); assert.equal(link.cardType,card.cardType); assert.equal(link.productId,card.productId);
    assert.equal(link.url,proof.url); assert.equal(proof.httpStatus,200); assert.equal(proof.title,proof.detailTitle);
    assert.match(proof.htmlSha256,/^[a-f0-9]{64}$/); assert.match(link.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
    assert.doesNotMatch(proof.title,/※|特価|状態/);
    const match = proof.title.match(/^【ラブカ】(.+?)【([^】]+)】(.+)$/); assert.ok(match);
    const name = ['SEC','PP'].includes(card.rarity) ? match[1].replace(/[（(]サイン[）)]$/,'') : match[1];
    const exceptions = {'PL!-bp8-020-L':['ぶる～べりぃ♡とれいん','ぶる〜べりぃ？とれいん'], 'PL!-bp8-025-L':['にこぷり♡女子道','にこぷり？女子道']};
    if (exceptions[card.cardNumber]) {
      assert.deepEqual([card.name,name],exceptions[card.cardNumber]);
      assert.equal(proof.nameException.officialName,card.name); assert.equal(proof.nameException.shopName,name);
    } else { assert.equal(normalize(name),normalize(card.name)); assert.equal(proof.nameException,undefined); }
    assert.equal(normalize(match[2]),normalize(card.rarity)); assert.equal(normalize(match[3]),normalize(card.cardNumber));
  }
  const linked = applyAuditedPurchaseLinks(cards,links).slice(1913);
  const pairs = rows => rows.map(r => `${r.cardId}:${r.url}`).sort();
  assert.deepEqual(pairs(groupCardsForDisplay(linked).flatMap(g => cardlaboLinksForDisplay(g.cards))),pairs(links));
  assert.deepEqual(pairs(linked.flatMap(c => cardlaboLinksForDisplay([c]))),pairs(links));
  for (const change of [{cardType:'energy'},{productId:'wrong'},{cardNumber:'wrong'}]) assert.throws(() => applyAuditedPurchaseLinks(cards,[{...links[0],...change}]),/wrong physical card/);
});
