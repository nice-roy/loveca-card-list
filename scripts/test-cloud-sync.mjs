import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSyncConnectionStorage, createCloudSync, formatSyncCode, loadCloudSync, normalizeSyncCode, normalizeSyncMetadata, saveCloudSync, SYNC_CODE_STORAGE_KEY, SYNC_META_STORAGE_KEY } from '../lib/cloud-sync.ts';
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
    const next = { ...row, payload, payloadVersion: 3, revision: row.revision + 1, updatedAt };
    this.rows.set(keyHash, next);
    return { status: 'saved', row: structuredClone(next) };
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
  assert.deepEqual(normalizeSyncMetadata({ revision: 2, cloudUpdatedAt: 'a', lastSyncedAt: 'b' }), { revision: 2, cloudUpdatedAt: 'a', lastSyncedAt: 'b' });
  assert.equal(normalizeSyncMetadata({ revision: 0 }), null);
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
    ['loveca-card-list:builder:v1', 'decks'],
    ['loveca-card-list:inventory:v1', 'inventory'],
    ['loveca-card-list:card-type:v1', 'live'],
    ['loveca-card-list:group:v1', 'nijigasaki'],
  ]);
  clearSyncConnectionStorage({ removeItem: (key) => values.delete(key) });
  assert.equal(values.has(SYNC_CODE_STORAGE_KEY), false);
  assert.equal(values.has(SYNC_META_STORAGE_KEY), false);
  assert.equal(values.get('loveca-card-list:builder:v1'), 'decks');
  assert.equal(values.get('loveca-card-list:inventory:v1'), 'inventory');
  assert.equal(values.get('loveca-card-list:card-type:v1'), 'live');
  assert.equal(values.get('loveca-card-list:group:v1'), 'nijigasaki');
});
