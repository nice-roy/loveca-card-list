import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { digest, importLiveHearts, parseLiveHearts } from './import-live-hearts.mjs';
import { applyAuditedLiveHearts } from '../lib/live-hearts.ts';
import { baseCardId } from '../lib/card-grouping.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const cards = read('../app/data/cards.json');
const references = read('../app/data/reference-data.json');
const snapshot = read('../docs/live-hearts/official-live-hearts.json');
const records = read('../app/data/live-hearts.json');

test('all 364 stored live versions match the complete official list and required hearts', () => {
  assert.equal(snapshot.officialTotal, 2882);
  assert.equal(snapshot.officialLiveCount, 368);
  assert.equal(snapshot.pages.length, 29);
  assert.equal(snapshot.baseline.liveCount, 364);
  assert.deepEqual(importLiveHearts(cards, references, snapshot), records);
  const sources = snapshot.pages.flatMap(page => page.lives);
  const byNumber = new Map(sources.map(source => [source.card_number, source]));
  for (const detail of snapshot.detailChecks) {
    const source = byNumber.get(detail.card_number);
    for (const key of Object.keys(source).filter(key => key !== 'expansion_name')) assert.equal(detail[key], source[key], `${detail.card_number}: ${key}`);
  }
  for (const path of ['../docs/bp08/official-bp08.json', '../docs/c1/official-pbll02.json']) {
    for (const source of read(path).cards.filter(card => card.card_kind === 'ライブ')) {
      assert.equal(byNumber.get(source.card_number).attack, source.attack);
      assert.equal(byNumber.get(source.card_number).cost, source.cost);
    }
  }
  assert.deepEqual(snapshot.unlistedVersions.map(row => row.cardNumber), ['PL!S-cl1-010-CL','PL!S-cl1-011-CL','PL!S-cl1-012-CL','PL!S-cl1-013-CL']);
  assert.ok(snapshot.unlistedVersions.every(row => !records.some(record => record.cardNumber === row.cardNumber)));
});

test('ALL, colorless, orange, score and draw remain distinct with exact quantities', () => {
  const get = number => records.find(row => row.cardNumber === number);
  assert.deepEqual(get('PL!-bp8-019-L').bladeHearts, [{color:'any',count:2}]);
  assert.deepEqual(get('PL!-bp3-026-SECL').bladeHearts, [{color:'all',count:1}]);
  assert.deepEqual(get('PL!-bp8-023-L').bladeHearts, [{color:'orange',count:1}]);
  assert.deepEqual(get('PL!-bp8-020-L'), {cardNumber:'PL!-bp8-020-L',bladeHearts:[],specialHeart:'score'});
  assert.deepEqual(get('PL!-bp8-024-L'), {cardNumber:'PL!-bp8-024-L',bladeHearts:[{color:'purple',count:1}],specialHeart:'draw'});
  assert.equal(get('LL-PR-004-PR').specialHeart, null);
  assert.deepEqual(get('PL!SP-bp2-025-SRL').bladeHearts, [{color:'all',count:1}]);
  assert.equal(records.filter(row => row.specialHeart === 'score').length, 56);
  assert.equal(records.filter(row => row.specialHeart === 'draw').length, 91);
  assert.ok(records.every(row => row.bladeHearts.length || row.specialHeart));
  const groups = new Map();
  for (const {cardNumber, ...hearts} of records) {
    const base = baseCardId(cardNumber);
    if (groups.has(base)) assert.deepEqual(hearts, groups.get(base), cardNumber);
    groups.set(base, hearts);
  }
});

test('live supplement preserves every existing card field, member and identifier without mutation', () => {
  const before = digest(cards);
  const enriched = applyAuditedLiveHearts(cards, records);
  assert.equal(digest(cards), before);
  assert.equal(enriched.length, 2054);
  assert.deepEqual(applyAuditedLiveHearts(enriched, records), enriched);
  enriched.forEach((card, index) => {
    if (!card.live) assert.strictEqual(card, cards[index]);
    else {
      const {bladeHearts, specialHeart, ...priorLive} = card.live;
      assert.ok(Array.isArray(bladeHearts));
      assert.ok(['draw','score',null].includes(specialHeart));
      assert.deepEqual({...card, live:priorLive}, cards[index]);
    }
  });
  assert.throws(() => applyAuditedLiveHearts(cards, [...records,records[0]]), /Duplicate/);
  assert.throws(() => applyAuditedLiveHearts(cards, [{...records[0],cardNumber:cards.find(c=>c.member).cardNumber}]), /Unknown/);
  const uncovered = applyAuditedLiveHearts(cards, []);
  assert.equal(uncovered.find(c=>c.live).live.bladeHearts, undefined); // Unknown must never look like verified zero.
});

test('offline import rejects changed identities, counts, missing pages and unknown source formats', () => {
  for (const change of [
    data => {data.pages.pop();},
    data => {data.pages[0].lives[0].card_number='invented';},
    data => {data.pages[0].lives[0].attack='ALL2';},
    data => {data.pages[0].lives[0].cost='スコア2';},
    data => {data.pages[0].lives[0].heart0='99';},
  ]) {
    const bad = structuredClone(snapshot); change(bad);
    assert.throws(() => importLiveHearts(cards,references,bad));
  }
  for (const attack of ['', 'unknown', '無0', 'ALL1無2']) assert.throws(() => parseLiveHearts({card_kind:'ライブ',cost:'-',attack}));
  assert.throws(() => parseLiveHearts({card_kind:'ライブ',cost:'-',attack:'-'}));
});
