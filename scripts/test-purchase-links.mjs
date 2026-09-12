import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import {applyOfficialHeartCorrections} from './heart-data-fixtures.mjs';
import {baseCardId, cardlaboLinksForDisplay, groupCardsForDisplay} from '../lib/card-grouping.ts';

const cards = JSON.parse(fs.readFileSync('app/data/cards.json','utf8'));
const before = JSON.parse(execFileSync('git',['show','5ea459c6326ac7a0c7dbec5638ac36f7a6282b3e:app/data/cards.json'],{encoding:'utf8',maxBuffer:10*1024*1024}));
const audit = JSON.parse(fs.readFileSync('docs/purchase-links-audit.json','utf8'));
const verifiedCards = JSON.parse(execFileSync('git',['show','73927d6824c108cb7a47400dc619994b9d7e4c52:app/data/cards.json'],{encoding:'utf8',maxBuffer:100*1024*1024}));
const groupAudit = JSON.parse(fs.readFileSync('app/data/nijigasaki-hasunosora-audit.json','utf8'));
const pageSource = fs.readFileSync('app/page.tsx','utf8');
const strip = ({purchaseLinks,...rest})=>rest;
test('all pre-existing card fields and ordering are unchanged before appended rival records',()=>{
  const restored=structuredClone(cards.slice(0,before.length));
  for(const update of groupAudit.existingCardAffiliationUpdates){
    const card=restored.find(item=>item.cardNumber===update.cardNumber);
    if(card)card.groupIds=update.before;
  }
  assert.deepEqual(restored.map(strip),applyOfficialHeartCorrections(structuredClone(before),restored).map(strip));
});
test('only Liella and Aqours have verified individual HTTPS purchase links',()=>{
  let count=0;
  for(const card of cards){
    const beforeCard=before.find(c=>c.id===card.id);
    if(card.groupIds.includes('muse')&&beforeCard&&!['LL-bp4-001-R＋'].includes(card.cardNumber)){
      const expected=applyOfficialHeartCorrections([structuredClone(beforeCard)],[card])[0];
      assert.deepEqual(card,expected);
    }
    for(const link of card.purchaseLinks||[]){
      assert.ok(card.groupIds.includes('liella')||card.groupIds.includes('aqours'));
      assert.equal(link.shopId,'cardlabo');
      assert.match(link.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
      assert.ok(audit.registered.some(r=>r.cardId===card.id&&r.cardNumber===card.cardNumber&&r.url===link.url&&r.detailTitle===r.title));
      count++;
    }
  }
  assert.equal(count,audit.registered.length);
  assert.equal(audit.registered.length+audit.unregistered.length,783);
});
test('every historically verified Card Labo link remains attached to the same physical card version',()=>{
  const currentById=new Map(cards.map(card=>[card.id,card]));
  const verified=verifiedCards.flatMap(card=>(card.purchaseLinks||[]).filter(link=>link.shopId==='cardlabo').map(link=>({card,link})));
  assert.equal(verified.length,767);
  for(const {card,link} of verified){
    const current=currentById.get(card.id);
    assert.ok(current,`missing card ${card.id}`);
    assert.equal(current.cardNumber,card.cardNumber);
    assert.ok(current.purchaseLinks?.some(item=>item.shopId===link.shopId&&item.url===link.url),`missing verified link ${card.cardNumber}`);
  }
});
test('grouped display exposes every verified physical-version purchase link without combining versions',()=>{
  const grouped=groupCardsForDisplay(cards);
  const linkedGroups=grouped.filter(group=>group.cards.some(card=>card.purchaseLinks?.some(link=>link.shopId==='cardlabo')));
  const displayed=linkedGroups.flatMap(group=>cardlaboLinksForDisplay(group.cards));
  assert.equal(displayed.length,767);
  assert.equal(new Set(displayed.map(link=>`${link.cardId}:${link.url}`)).size,767);
  assert.ok(linkedGroups.some(group=>group.cards.length>1&&cardlaboLinksForDisplay(group.cards).length>1));
  for(const link of displayed){
    assert.equal(baseCardId(link.cardNumber),baseCardId(cards.find(card=>card.id===link.cardId).cardNumber));
    assert.match(link.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
  }
});
test('grouped cards show purchase links once on the card surface and not again in version details',()=>{
  const groupedSection=pageSource.slice(pageSource.indexOf('{isGrouped && <div className="card-links grouped-card-links">'),pageSource.indexOf('{isGrouped ? <details className="version-details">'));
  const versionDetailsSection=pageSource.slice(pageSource.indexOf('{isGrouped ? <details className="version-details">'),pageSource.indexOf('</details> : <div className="card-links">'));
  assert.match(groupedSection,/groupedPurchaseLinks\.map/);
  assert.match(groupedSection,/カードラボで購入/);
  assert.match(versionDetailsSection,/version\.officialUrl/);
  assert.doesNotMatch(versionDetailsSection,/version\.purchaseLinks/);
  assert.doesNotMatch(versionDetailsSection,/カードラボで購入/);
});
test('pool adds only member/live audited records and keeps card images absent',()=>{
  assert.equal(cards.length,1817);
  assert.equal(cards.filter(c=>c.cardType==='member').length,1526);
  assert.equal(cards.filter(c=>c.cardType==='live').length,291);
  assert.equal(cards.filter(c=>!['member','live'].includes(c.cardType)).length,0);
  assert.deepEqual(cards.slice(0,before.length).map(c=>c.image),before.map(c=>c.image));
  assert.ok(cards.slice(before.length).every(c=>c.image.url===null&&c.image.alt===null));
});
