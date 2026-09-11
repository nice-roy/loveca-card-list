import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSyncConnectionStorage, createCloudSync, createSyncBaseline, createSyncPayloadFingerprint, formatSyncCode, isSyncPayloadDirty, loadCloudSync, loadCloudSyncHistory, normalizeSyncBaseline, normalizeSyncCode, normalizeSyncMetadata, restoreCloudSyncHistory, saveCloudSync, SYNC_BASELINE_STORAGE_KEY, SYNC_CODE_STORAGE_KEY, SYNC_META_STORAGE_KEY } from '../lib/cloud-sync.ts';
import { createSyncService, generateSyncCode, hashSyncCode, validateSyncPayload } from '../sync-worker/core.ts';

const basePayload = {
  format: 'loveca-card-list-state',
  version: 3,
  exportedAt: '2026-09-10T00:00:00.000Z',
  activeDeckId: 'deck-1',
  decks: [{ id: 'deck-1', name: 'デッキ1', cards: [{ baseCardId: 'PL!SP-bp1-001', count: 4 }] }],
  candidates: ['PL!SP-bp1-002'],
  inventory: [{ cardId: 'PL!SP-bp1-001-R', count: 2 }],
};

class MemoryStore {
  rows = new Map();
  history = new Map();
  nextHistoryId = 1;
  async create(row) {
    if (this.rows.has(row.keyHash)) return false;
    this.rows.set(row.keyHash, structuredClone(row));
    return true;
  }
  async load(keyHash) {
    return this.rows.has(keyHash) ? structuredClone(this.rows.get(keyHash)) : null;
  }
  async save(keyHash, payload, expectedRevision, force, updatedAt) {
    const row = this.rows.get(keyHash);
    if (!row) return { status: 'missing' };
    if (!force && row.revision !== expectedRevision) return { status: 'conflict', currentRevision: row.revision };
    this.archive(row);
    const next = { ...row, payload, payloadVersion: 3, revision: row.revision + 1, updatedAt };
    this.rows.set(keyHash, next);
    return { status: 'saved', row: structuredClone(next) };
  }
  archive(row) {
    const items = this.history.get(row.keyHash) ?? [];
    items.push({ id: this.nextHistoryId++, keyHash: row.keyHash, sourceRevision: row.revision, payload: row.payload, payloadVersion: row.payloadVersion, savedAt: row.updatedAt });
    this.history.set(row.keyHash, items.slice(-5));
  }
  async listHistory(keyHash) {
    return structuredClone([...(this.history.get(keyHash) ?? [])].reverse());
  }
  async restore(keyHash, historyId, expectedRevision, updatedAt) {
    const row = this.rows.get(keyHash);
    if (!row) return { status: 'missing' };
    if (row.revision !== expectedRevision) return { status: 'conflict', currentRevision: row.revision };
    const target = (this.history.get(keyHash) ?? []).find((item) => item.id === historyId);
    if (!target) return { status: 'history_missing' };
    this.archive(row);
    const next = { ...row, payload: target.payload, payloadVersion: target.payloadVersion, revision: row.revision + 1, updatedAt };
    this.rows.set(keyHash, next);
    return { status: 'restored', row: structuredClone(next), restoredFromRevision: target.sourceRevision };
  }
}

function fetchFrom(service) {
  return (url, init) => service(new Request(url, init));
}

test('sync codes have 160 bits of random input, normalize separators, and hash before storage', async () => {
  const code = generateSyncCode((bytes) => { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; });
  assert.equal(code.length, 32);
  assert.equal(normalizeSyncCode(formatSyncCode(code).toLowerCase()), code);
  assert.equal(normalizeSyncCode('bad-code'), null);
  assert.match(await hashSyncCode(code), /^[a-f0-9]{64}$/);
  assert.equal(SYNC_CODE_STORAGE_KEY, 'loveca-card-list:sync-code:v1');
  assert.equal(SYNC_META_STORAGE_KEY, 'loveca-card-list:sync-meta:v1');
  assert.equal(SYNC_BASELINE_STORAGE_KEY, 'loveca-card-list:sync-baseline:v1');
  assert.deepEqual(normalizeSyncMetadata({ revision: 2, cloudUpdatedAt: 'a', lastSyncedAt: 'b' }), { revision: 2, cloudUpdatedAt: 'a', lastSyncedAt: 'b' });
  assert.equal(normalizeSyncMetadata({ revision: 0 }), null);
});

test('sync baseline compares only version 3 sync data and returns clean after an exact revert', () => {
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const baseline = createSyncBaseline(code, basePayload);
  assert.deepEqual(normalizeSyncBaseline(baseline), baseline);
  assert.equal(normalizeSyncBaseline({ ...baseline, code: 'bad' }), null);
  assert.equal(isSyncPayloadDirty(code, null, basePayload), true, 'an existing connection without a recorded baseline must be saved or loaded once');
  assert.equal(isSyncPayloadDirty(null, baseline, basePayload), false, 'an unconnected device never shows an unsaved sync state');

  const reorderedEquivalent = {
    ...basePayload,
    exportedAt: '2026-09-11T00:00:00.000Z',
    candidates: [...basePayload.candidates].reverse(),
    inventory: [...basePayload.inventory].reverse(),
    decks: basePayload.decks.map((deck) => ({ ...deck, cards: [...deck.cards].reverse() })),
  };
  assert.equal(createSyncPayloadFingerprint(reorderedEquivalent), baseline.fingerprint);

  const changedCandidate = { ...basePayload, candidates: [...basePayload.candidates, 'PL!SP-bp1-003'] };
  const changedInventory = { ...basePayload, inventory: [{ cardId: 'PL!SP-bp1-001-R', count: 3 }] };
  const changedDeckCards = { ...basePayload, decks: [{ ...basePayload.decks[0], cards: [{ baseCardId: 'PL!SP-bp1-001', count: 3 }] }] };
  const changedDeckName = { ...basePayload, decks: [{ ...basePayload.decks[0], name: '試作デッキ' }] };
  const changedActiveDeck = { ...basePayload, activeDeckId: 'deck-2', decks: [...basePayload.decks, { id: 'deck-2', name: 'デッキ2', cards: [] }] };
  for (const changed of [changedCandidate, changedInventory, changedDeckCards, changedDeckName, changedActiveDeck]) {
    assert.notEqual(createSyncPayloadFingerprint(changed), baseline.fingerprint);
    assert.equal(isSyncPayloadDirty(code, baseline, changed), true);
  }
  assert.equal(isSyncPayloadDirty(code, createSyncBaseline(code, changedDeckCards), changedDeckCards), false, 'a successful save records the changed deck as clean');
  assert.equal(isSyncPayloadDirty(code, baseline, changedDeckCards), true, 'a rejected save keeps the prior baseline and remains dirty');
  assert.equal(createSyncPayloadFingerprint({ ...changedCandidate, candidates: basePayload.candidates }), baseline.fingerprint);
  assert.equal(isSyncPayloadDirty(code, baseline, { ...changedCandidate, candidates: basePayload.candidates }), false);
});

test('worker validates version 3 snapshots and rejects malformed payloads', () => {
  assert.equal(validateSyncPayload(basePayload).ok, true);
  assert.equal(validateSyncPayload({ ...basePayload, decks: [{ id: 'deck-1', name: '空デッキ', cards: [] }], candidates: [], inventory: [] }).ok, true);
  assert.equal(validateSyncPayload({
    ...basePayload,
    activeDeckId: 'deck-2',
    decks: [basePayload.decks[0], { id: 'deck-2', name: '試作', cards: [{ baseCardId: 'PL!SP-bp1-002', count: 1 }] }],
  }).ok, true);
  assert.equal(validateSyncPayload({ ...basePayload, version: 2 }).ok, false);
  assert.equal(validateSyncPayload({ ...basePayload, decks: [{ ...basePayload.decks[0], cards: [{ baseCardId: 'x', count: 5 }] }] }).ok, false);
  assert.equal(validateSyncPayload({ ...basePayload, inventory: [{ cardId: 'x', count: 100 }] }).ok, false);
});

test('create, cross-device load, save, conflict protection, force save, and disconnect-safe storage work', async () => {
  const store = new MemoryStore();
  const fixedCode = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tick = 0;
  const service = createSyncService(store, { generateCode: () => fixedCode, now: () => `2026-09-10T00:00:0${tick++}.000Z` });
  const fetcher = fetchFrom(service);
  const created = await createCloudSync('https://sync.example', basePayload, fetcher);
  assert.equal(created.code, fixedCode);
  assert.equal(created.revision, 1);
  assert.equal(store.rows.size, 1);
  assert.equal(store.rows.has(fixedCode), false);

  const loadedOnDeviceB = await loadCloudSync('https://sync.example', formatSyncCode(fixedCode), fetcher);
  assert.deepEqual(loadedOnDeviceB.payload, basePayload);
  const changed = { ...basePayload, candidates: [...basePayload.candidates, 'PL!SP-bp1-003'] };
  const savedOnDeviceB = await saveCloudSync('https://sync.example', fixedCode, changed, loadedOnDeviceB.revision, false, fetcher);
  assert.equal(savedOnDeviceB.revision, 2);

  await assert.rejects(() => saveCloudSync('https://sync.example', fixedCode, basePayload, created.revision, false, fetcher), (error) => error.status === 409 && error.code === 'revision_conflict' && error.currentRevision === 2);
  const forced = await saveCloudSync('https://sync.example', fixedCode, basePayload, created.revision, true, fetcher);
  assert.equal(forced.revision, 3);
  assert.deepEqual((await loadCloudSync('https://sync.example', fixedCode, fetcher)).payload, basePayload);
});

test('successful saves retain only the previous five cloud snapshots', async () => {
  const store = new MemoryStore();
  const fixedCode = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tick = 0;
  const service = createSyncService(store, { generateCode: () => fixedCode, now: () => `2026-09-10T00:00:${String(tick++).padStart(2, '0')}.000Z` });
  const fetcher = fetchFrom(service);
  const created = await createCloudSync('https://sync.example', basePayload, fetcher);
  let revision = created.revision;
  for (let index = 1; index <= 6; index += 1) {
    const payload = { ...basePayload, candidates: [`save-${index}`] };
    revision = (await saveCloudSync('https://sync.example', fixedCode, payload, revision, false, fetcher)).revision;
  }
  const result = await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher);
  assert.equal(result.revision, 7);
  assert.equal(result.history.length, 5);
  assert.deepEqual(result.history.map((item) => item.sourceRevision), [6, 5, 4, 3, 2]);
  assert.deepEqual(result.history[0], {
    id: 6,
    sourceRevision: 6,
    savedAt: '2026-09-10T00:00:05.000Z',
    deckCount: 1,
    candidateCount: 1,
    inventoryCount: 1,
  });
});

test('history restore archives the current state, increments revision, and rejects stale restores', async () => {
  const store = new MemoryStore();
  const fixedCode = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tick = 0;
  const service = createSyncService(store, { generateCode: () => fixedCode, now: () => `2026-09-10T00:01:${String(tick++).padStart(2, '0')}.000Z` });
  const fetcher = fetchFrom(service);
  let revision = (await createCloudSync('https://sync.example', basePayload, fetcher)).revision;
  const payload2 = { ...basePayload, candidates: ['revision-2'] };
  revision = (await saveCloudSync('https://sync.example', fixedCode, payload2, revision, false, fetcher)).revision;
  const payload3 = { ...basePayload, candidates: ['revision-3'] };
  revision = (await saveCloudSync('https://sync.example', fixedCode, payload3, revision, false, fetcher)).revision;
  const before = await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher);
  const revision1 = before.history.find((item) => item.sourceRevision === 1);
  assert.ok(revision1);

  const restored = await restoreCloudSyncHistory('https://sync.example', fixedCode, revision1.id, revision, fetcher);
  assert.equal(restored.revision, 4);
  assert.equal(restored.restoredFromRevision, 1);
  assert.deepEqual(restored.payload, basePayload);
  const after = await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher);
  assert.equal(after.history[0].sourceRevision, 3);
  assert.deepEqual(JSON.parse((await store.listHistory(await hashSyncCode(fixedCode)))[0].payload), payload3);

  await assert.rejects(
    () => restoreCloudSyncHistory('https://sync.example', fixedCode, revision1.id, revision, fetcher),
    (error) => error.status === 409 && error.code === 'revision_conflict' && error.currentRevision === 4,
  );
  assert.equal((await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher)).history.length, 3);
});

test('history restore keeps the pre-restore latest state while pruning to five generations', async () => {
  const store = new MemoryStore();
  const fixedCode = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tick = 0;
  const service = createSyncService(store, { generateCode: () => fixedCode, now: () => `2026-09-10T00:02:${String(tick++).padStart(2, '0')}.000Z` });
  const fetcher = fetchFrom(service);
  let revision = (await createCloudSync('https://sync.example', basePayload, fetcher)).revision;
  for (let index = 2; index <= 7; index += 1) {
    revision = (await saveCloudSync('https://sync.example', fixedCode, { ...basePayload, candidates: [`revision-${index}`] }, revision, false, fetcher)).revision;
  }
  const before = await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher);
  const revision2 = before.history.find((item) => item.sourceRevision === 2);
  assert.ok(revision2);

  const restored = await restoreCloudSyncHistory('https://sync.example', fixedCode, revision2.id, revision, fetcher);
  assert.equal(restored.revision, 8);
  assert.equal(restored.restoredFromRevision, 2);
  assert.deepEqual(restored.payload.candidates, ['revision-2']);
  const after = await loadCloudSyncHistory('https://sync.example', fixedCode, fetcher);
  assert.equal(after.history.length, 5);
  assert.deepEqual(after.history.map((item) => item.sourceRevision), [7, 6, 5, 4, 3]);
  assert.deepEqual((await loadCloudSync('https://sync.example', fixedCode, fetcher)).payload, restored.payload);
});

test('invalid and missing codes never mutate cloud or local data', async () => {
  const store = new MemoryStore();
  const service = createSyncService(store);
  const fetcher = fetchFrom(service);
  await assert.rejects(() => loadCloudSync('https://sync.example', 'bad', fetcher), (error) => error.status === 400 && error.code === 'invalid_code');
  await assert.rejects(() => loadCloudSync('https://sync.example', 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', fetcher), (error) => error.status === 404 && error.code === 'not_found');
  assert.equal(store.rows.size, 0);
});

test('worker rejects malformed requests and oversized snapshots without writing', async () => {
  const store = new MemoryStore();
  const service = createSyncService(store);
  const malformed = await service(new Request('https://sync.example/sync/create', { method: 'POST', body: '{' }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'invalid_json');

  const oversizedPayload = { ...basePayload, candidates: Array.from({ length: 5001 }, (_, index) => `card-${index}`) };
  const oversized = await service(new Request('https://sync.example/sync/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: oversizedPayload }),
  }));
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error, 'invalid_payload');
  assert.equal(store.rows.size, 0);
});

test('disconnect removes only sync credentials and leaves user data and UI preferences intact', () => {
  const values = new Map([
    [SYNC_CODE_STORAGE_KEY, 'secret'],
    [SYNC_META_STORAGE_KEY, '{"revision":1}'],
    [SYNC_BASELINE_STORAGE_KEY, '{"version":1}'],
    ['loveca-card-list:builder:v1', 'decks'],
    ['loveca-card-list:inventory:v1', 'inventory'],
    ['loveca-card-list:card-type:v1', 'live'],
    ['loveca-card-list:group:v1', 'nijigasaki'],
  ]);
  clearSyncConnectionStorage({ removeItem: (key) => values.delete(key) });
  assert.equal(values.has(SYNC_CODE_STORAGE_KEY), false);
  assert.equal(values.has(SYNC_META_STORAGE_KEY), false);
  assert.equal(values.has(SYNC_BASELINE_STORAGE_KEY), false);
  assert.equal(values.get('loveca-card-list:builder:v1'), 'decks');
  assert.equal(values.get('loveca-card-list:inventory:v1'), 'inventory');
  assert.equal(values.get('loveca-card-list:card-type:v1'), 'live');
  assert.equal(values.get('loveca-card-list:group:v1'), 'nijigasaki');
});
