import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

const cards = JSON.parse(fs.readFileSync('app/data/cards.json','utf8'));
const before = JSON.parse(execFileSync('git',['show','5ea459c6326ac7a0c7dbec5638ac36f7a6282b3e:app/data/cards.json'],{encoding:'utf8',maxBuffer:10*1024*1024}));
const audit = JSON.parse(fs.readFileSync('docs/purchase-links-audit.json','utf8'));
const strip = ({purchaseLinks,...rest})=>rest;
test('all existing card fields and ordering are unchanged',()=>assert.deepEqual(cards.map(strip),before.map(strip)));
test('only Liella and Aqours have verified individual HTTPS purchase links',()=>{
  let count=0;
  for(const card of cards){
    if(card.groupIds.includes('muse'))assert.deepEqual(card,before.find(c=>c.id===card.id));
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
test('pool stays 1051, member 876/live 175, no energy or card images added',()=>{
  assert.equal(cards.length,1051);
  assert.equal(cards.filter(c=>c.cardType==='member').length,876);
  assert.equal(cards.filter(c=>c.cardType==='live').length,175);
  assert.equal(cards.filter(c=>!['member','live'].includes(c.cardType)).length,0);
  assert.deepEqual(cards.map(c=>c.image),before.map(c=>c.image));
});
