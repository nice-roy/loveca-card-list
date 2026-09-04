import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = 'app/data/cards.json';
const cards = JSON.parse(fs.readFileSync(path, 'utf8'));
const report = JSON.parse(fs.readFileSync('work/purchase-links/report.json', 'utf8'));
const byId = new Map(cards.map(c=>[c.id,c]));
assert.equal(new Set(report.registered.map(r=>r.cardId)).size, report.registered.length);
for (const record of report.registered) {
  const card = byId.get(record.cardId);
  assert.ok(card && (card.groupIds.includes('liella') || card.groupIds.includes('aqours')));
  assert.equal(card.cardNumber, record.cardNumber);
  assert.match(record.url, /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/);
  card.purchaseLinks = [...(card.purchaseLinks || []).filter(l=>l.shopId!=='cardlabo'), {shopId:'cardlabo',label:'カードラボで購入',url:record.url}];
}
fs.writeFileSync(path, JSON.stringify(cards,null,2)+'\n');
fs.mkdirSync('docs', {recursive:true});
fs.writeFileSync('docs/purchase-links-audit.json', JSON.stringify(report,null,2)+'\n');
console.log('Imported',report.registered.length,'verified links; no other card fields changed.');
