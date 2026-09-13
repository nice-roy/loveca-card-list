import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import {applyOfficialHeartCorrections} from './heart-data-fixtures.mjs';
import {baseCardId, cardlaboLinksForDisplay, groupCardsForDisplay} from '../lib/card-grouping.ts';
import {applyAuditedPurchaseLinks} from '../lib/purchase-links.ts';

const rawCards = JSON.parse(fs.readFileSync('app/data/cards.json','utf8'));
const auditedLiveLinks = JSON.parse(fs.readFileSync('app/data/live-purchase-links.json','utf8'));
const cards = applyAuditedPurchaseLinks(rawCards,auditedLiveLinks);
const before = JSON.parse(execFileSync('git',['show','5ea459c6326ac7a0c7dbec5638ac36f7a6282b3e:app/data/cards.json'],{encoding:'utf8',maxBuffer:10*1024*1024}));
const audit = JSON.parse(fs.readFileSync('docs/purchase-links-audit.json','utf8'));
const liveAudit = JSON.parse(fs.readFileSync('docs/live-purchase-links-audit.json','utf8'));
const verifiedCards = JSON.parse(execFileSync('git',['show','73927d6824c108cb7a47400dc619994b9d7e4c52:app/data/cards.json'],{encoding:'utf8',maxBuffer:100*1024*1024}));
const groupAudit = JSON.parse(fs.readFileSync('app/data/nijigasaki-hasunosora-audit.json','utf8'));
const pageSource = fs.readFileSync('app/page.tsx','utf8');
const strip = ({purchaseLinks: _purchaseLinks,...rest})=>rest;
test('all pre-existing card fields and ordering are unchanged before appended rival records',()=>{
  const restored=structuredClone(cards.slice(0,before.length));
  for(const update of groupAudit.existingCardAffiliationUpdates){
    const card=restored.find(item=>item.cardNumber===update.cardNumber);
    if(card)card.groupIds=update.before;
  }
  assert.deepEqual(restored.map(strip),applyOfficialHeartCorrections(structuredClone(before),restored).map(strip));
});
test('every Card Labo link is a directly verified HTTPS product URL attached to its audited physical card',()=>{
  const auditedLinks = new Set([
    ...audit.registered.map(record=>`${record.cardId}:${record.url}`),
    ...liveAudit.B.map(record=>`${record.cardId}:${record.url}`),
  ]);
  let count = 0;
  for(const card of cards){
    for(const link of card.purchaseLinks||[]){
      assert.equal(link.shopId,'cardlabo');
      assert.match(link.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
      assert.ok(auditedLinks.has(`${card.id}:${link.url}`),`unaudited link ${card.cardNumber}: ${link.url}`);
      count++;
    }
  }
  assert.equal(count,audit.registered.length+liveAudit.B.length);
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
test('all 291 physical live-card versions have a stable retained, A, B, or C audit result',()=>{
  const liveCards=cards.filter(card=>card.cardType==='live');
  const audited=[...liveAudit.retainedHistorical,...liveAudit.A,...liveAudit.B,...liveAudit.C];
  assert.equal(liveCards.length,291);
  assert.equal(liveAudit.counts.total,291);
  assert.equal(liveAudit.counts.retainedHistorical,134);
  assert.equal(liveAudit.counts.A,0);
  assert.equal(liveAudit.counts.B,157);
  assert.equal(liveAudit.counts.C,0);
  assert.equal(audited.length,291);
  assert.equal(new Set(audited.map(record=>record.cardId)).size,291);
  for(const record of [...liveAudit.retainedHistorical,...liveAudit.B]){
    const card=liveCards.find(item=>item.id===record.cardId);
    assert.ok(card,`missing audited live card ${record.cardNumber}`);
    assert.equal(card.cardNumber,record.cardNumber);
    assert.ok(card.purchaseLinks?.some(link=>link.shopId==='cardlabo'&&link.url===record.url),`missing audited live link ${record.cardNumber}`);
  }
  for(const record of liveAudit.B){
    assert.match(record.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
    assert.ok(record.title.includes(record.cardNumber.replaceAll('＋','+'))||record.title.includes(record.cardNumber));
    assert.ok(record.detailTitle.startsWith(record.title),`direct-page title mismatch ${record.cardNumber}`);
  }
  assert.deepEqual(liveAudit.C,[]);
  const manualExceptions={
    'PL!SP-sd1-026-SRL':'https://www.c-labo-online.jp/product/393393',
    'LL-PR-004-PR':'https://www.c-labo-online.jp/product/338834',
    'PL!HS-pb1-029-L':'https://www.c-labo-online.jp/product/381743',
  };
  for(const [cardNumber,url] of Object.entries(manualExceptions)){
    const record=liveAudit.B.find(item=>item.cardNumber===cardNumber);
    assert.ok(record,`missing manual exception ${cardNumber}`);
    assert.equal(record.url,url);
    assert.equal(record.verificationMethod,'manual-direct-page-exception');
    assert.ok(record.verificationNote);
  }
});
test('audited live-link overlay rejects missing, duplicate, conflicting, and wrong-version records',()=>{
  assert.equal(auditedLiveLinks.length,157);
  assert.equal(new Set(auditedLiveLinks.map(record=>record.cardId)).size,157);
  const sample=auditedLiveLinks[0];
  assert.throws(()=>applyAuditedPurchaseLinks(rawCards,[sample,sample]),/Duplicate audited purchase-link card id/);
  assert.throws(()=>applyAuditedPurchaseLinks(rawCards,[{...sample,cardId:'missing-card'}]),/missing physical card/);
  assert.throws(()=>applyAuditedPurchaseLinks(rawCards,[{...sample,cardNumber:`${sample.cardNumber}-wrong`}]),/wrong physical card/);
  const conflicting=rawCards.map(card=>card.id===sample.cardId?{...card,purchaseLinks:[{shopId:'cardlabo',label:'カードラボで購入',url:'https://www.c-labo-online.jp/product/1'}]}:card);
  assert.throws(()=>applyAuditedPurchaseLinks(conflicting,[sample]),/Conflicting Card Labo URL/);
  const once=applyAuditedPurchaseLinks(rawCards,[sample]);
  const twice=applyAuditedPurchaseLinks(once,[sample]);
  assert.equal(twice.find(card=>card.id===sample.cardId).purchaseLinks.length,1);
});
test('Step! ZERO to ONE keeps its verified URL in grouped and ungrouped display inputs',()=>{
  const card=cards.find(item=>item.cardNumber==='PL!S-bp6-019-L');
  assert.ok(card);
  assert.equal(card.name,'Step! ZERO to ONE');
  const expected='https://www.c-labo-online.jp/product/386698';
  assert.ok(card.purchaseLinks?.some(link=>link.shopId==='cardlabo'&&link.url===expected));
  const group=groupCardsForDisplay(cards).find(item=>item.cards.some(version=>version.id===card.id));
  assert.ok(group);
  assert.ok(cardlaboLinksForDisplay([card]).some(link=>link.cardId===card.id&&link.url===expected));
  assert.ok(cardlaboLinksForDisplay(group.cards).some(link=>link.cardId===card.id&&link.url===expected));
});
test('grouped display exposes every verified physical-version purchase link without combining versions',()=>{
  const grouped=groupCardsForDisplay(cards);
  const linkedGroups=grouped.filter(group=>group.cards.some(card=>card.purchaseLinks?.some(link=>link.shopId==='cardlabo')));
  const displayed=linkedGroups.flatMap(group=>cardlaboLinksForDisplay(group.cards));
  const verifiedCount=audit.registered.length+liveAudit.B.length;
  assert.equal(displayed.length,verifiedCount);
  assert.equal(new Set(displayed.map(link=>`${link.cardId}:${link.url}`)).size,verifiedCount);
  assert.ok(linkedGroups.some(group=>group.cards.length>1&&cardlaboLinksForDisplay(group.cards).length>1));
  for(const link of displayed){
    assert.equal(baseCardId(link.cardNumber),baseCardId(cards.find(card=>card.id===link.cardId).cardNumber));
    assert.match(link.url,/^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
  }
});
test('grouped cards show purchase links once on the card surface and not again in version details',()=>{
  const groupedSection=pageSource.slice(pageSource.indexOf('{isGrouped && <div className="card-links grouped-card-links">'),pageSource.indexOf('{isGrouped ? <details className="version-details">'));
  const versionDetailsSection=pageSource.slice(pageSource.indexOf('{isGrouped ? <details className="version-details">'),pageSource.indexOf('</details> : <div className="card-links">'));
  assert.match(groupedSection,/cardSurfacePurchaseLinks\.map/);
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
