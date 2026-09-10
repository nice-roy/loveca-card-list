export const MAX_REQUEST_BYTES = 600 * 1024;
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export const SYNC_CODE_LENGTH = 32;
export const SYNC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type SyncRow = {
  keyHash: string;
  payload: string;
  payloadVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export interface SyncStore {
  create(row: SyncRow): Promise<boolean>;
  load(keyHash: string): Promise<SyncRow | null>;
  save(keyHash: string, payload: string, expectedRevision: number, force: boolean, updatedAt: string): Promise<{ status: 'saved'; row: SyncRow } | { status: 'missing' } | { status: 'conflict'; currentRevision: number }>;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSyncCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  if (normalized.length !== SYNC_CODE_LENGTH) return null;
  return /^[A-HJ-NP-Z2-9]{32}$/.test(normalized) ? normalized : null;
}

export function generateSyncCode(randomValues: (array: Uint8Array) => Uint8Array = (array) => crypto.getRandomValues(array)) {
  const bytes = randomValues(new Uint8Array(SYNC_CODE_LENGTH));
  return [...bytes].map((value) => SYNC_CODE_ALPHABET[value & 31]).join('');
}

export async function hashSyncCode(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function validateSyncPayload(value: unknown): { ok: true; payload: string } | { ok: false; message: string } {
  if (!isRecord(value) || value.format !== 'loveca-card-list-state' || value.version !== 3) return { ok: false, message: '対応していない同期データです。' };
  if (typeof value.exportedAt !== 'string' || typeof value.activeDeckId !== 'string') return { ok: false, message: '同期データの基本情報が正しくありません。' };
  if (!Array.isArray(value.decks) || value.decks.length < 1 || value.decks.length > 100) return { ok: false, message: 'デッキ情報が正しくありません。' };
  const deckIds = new Set<string>();
  for (const deck of value.decks) {
    if (!isRecord(deck) || typeof deck.id !== 'string' || !deck.id || typeof deck.name !== 'string' || !deck.name.trim() || deck.name.length > 60 || !Array.isArray(deck.cards) || deck.cards.length > 1000) return { ok: false, message: 'デッキ情報が正しくありません。' };
    if (deckIds.has(deck.id)) return { ok: false, message: 'デッキIDが重複しています。' };
    deckIds.add(deck.id);
    const cardIds = new Set<string>();
    for (const card of deck.cards) {
      if (!isRecord(card) || typeof card.baseCardId !== 'string' || !card.baseCardId || !Number.isInteger(card.count) || Number(card.count) < 1 || Number(card.count) > 4 || cardIds.has(card.baseCardId)) return { ok: false, message: 'デッキのカード情報が正しくありません。' };
      cardIds.add(card.baseCardId);
    }
  }
  if (!deckIds.has(value.activeDeckId)) return { ok: false, message: '選択中のデッキを確認できません。' };
  if (!Array.isArray(value.candidates) || value.candidates.length > 5000 || value.candidates.some((id) => typeof id !== 'string') || new Set(value.candidates).size !== value.candidates.length) return { ok: false, message: '候補カード情報が正しくありません。' };
  if (!Array.isArray(value.inventory) || value.inventory.length > 5000) return { ok: false, message: '所持カード情報が正しくありません。' };
  const inventoryIds = new Set<string>();
  for (const item of value.inventory) {
    if (!isRecord(item) || typeof item.cardId !== 'string' || !item.cardId || !Number.isInteger(item.count) || Number(item.count) < 1 || Number(item.count) > 99 || inventoryIds.has(item.cardId)) return { ok: false, message: '所持カード情報が正しくありません。' };
    inventoryIds.add(item.cardId);
  }
  const payload = JSON.stringify(value);
  return new TextEncoder().encode(payload).byteLength <= MAX_PAYLOAD_BYTES
    ? { ok: true, payload }
    : { ok: false, message: '同期データが大きすぎます。' };
}

async function parseBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: Response }> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return { ok: false, error: json({ error: 'request_too_large', message: '送信データが大きすぎます。' }, 413) };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return { ok: false, error: json({ error: 'request_too_large', message: '送信データが大きすぎます。' }, 413) };
  try {
    const body = JSON.parse(text);
    return isRecord(body) ? { ok: true, body } : { ok: false, error: json({ error: 'invalid_request', message: 'リクエスト形式が正しくありません。' }, 400) };
  } catch {
    return { ok: false, error: json({ error: 'invalid_json', message: 'JSONの形式が正しくありません。' }, 400) };
  }
}

export function createSyncService(store: SyncStore, options: { now?: () => string; generateCode?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const makeCode = options.generateCode ?? generateSyncCode;
  return async (request: Request) => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed', message: 'POSTで送信してください。' }, 405);
    const parsed = await parseBody(request);
    if (parsed.ok === false) return parsed.error;
    const { body } = parsed;

    if (new URL(request.url).pathname === '/sync/create') {
      const validation = validateSyncPayload(body.payload);
      if (validation.ok === false) return json({ error: 'invalid_payload', message: validation.message }, 400);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const code = makeCode();
        const keyHash = await hashSyncCode(code);
        const timestamp = now();
        if (await store.create({ keyHash, payload: validation.payload, payloadVersion: 3, revision: 1, createdAt: timestamp, updatedAt: timestamp })) {
          return json({ code, revision: 1, createdAt: timestamp, updatedAt: timestamp }, 201);
        }
      }
      return json({ error: 'create_failed', message: '同期コードを作成できませんでした。もう一度お試しください。' }, 503);
    }

    const code = normalizeSyncCode(body.code);
    if (!code) return json({ error: 'invalid_code', message: '同期コードの形式を確認してください。' }, 400);
    const keyHash = await hashSyncCode(code);

    if (new URL(request.url).pathname === '/sync/load') {
      const row = await store.load(keyHash);
      if (!row) return json({ error: 'not_found', message: '同期コードを確認できませんでした。' }, 404);
      let payload: unknown;
      try { payload = JSON.parse(row.payload); } catch { return json({ error: 'invalid_cloud_payload', message: 'クラウドデータを読み込めませんでした。' }, 500); }
      const validation = validateSyncPayload(payload);
      if (validation.ok === false) return json({ error: 'invalid_cloud_payload', message: 'クラウドデータを読み込めませんでした。' }, 500);
      return json({ payload, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt });
    }

    if (new URL(request.url).pathname === '/sync/save') {
      const validation = validateSyncPayload(body.payload);
      if (validation.ok === false) return json({ error: 'invalid_payload', message: validation.message }, 400);
      if (!Number.isInteger(body.revision) || Number(body.revision) < 1 || (body.force !== undefined && typeof body.force !== 'boolean')) return json({ error: 'invalid_revision', message: '同期状態を確認できません。先にクラウドから読み込んでください。' }, 400);
      const result = await store.save(keyHash, validation.payload, Number(body.revision), body.force === true, now());
      if (result.status === 'missing') return json({ error: 'not_found', message: '同期コードを確認できませんでした。' }, 404);
      if (result.status === 'conflict') return json({ error: 'revision_conflict', message: '別の端末でクラウドデータが更新されています。', currentRevision: result.currentRevision }, 409);
      return json({ revision: result.row.revision, updatedAt: result.row.updatedAt });
    }

    return json({ error: 'not_found', message: '同期APIを確認できません。' }, 404);
  };
}
