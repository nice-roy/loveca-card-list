import { createSyncService, type SyncRow, type SyncStore } from './core';

type D1Result = { meta?: { changes?: number } };
type BoundStatement = { first<T>(): Promise<T | null>; run(): Promise<D1Result> };
type D1DatabaseLike = { prepare(sql: string): { bind(...values: unknown[]): BoundStatement } };

type Env = {
  DB: D1DatabaseLike;
  ALLOWED_ORIGIN?: string;
};

class D1SyncStore implements SyncStore {
  private readonly db: D1DatabaseLike;

  constructor(db: D1DatabaseLike) {
    this.db = db;
  }

  async create(row: SyncRow) {
    try {
      const result = await this.db.prepare('INSERT INTO sync_states (key_hash, payload, payload_version, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.keyHash, row.payload, row.payloadVersion, row.revision, row.createdAt, row.updatedAt).run();
      return Number(result.meta?.changes ?? 0) === 1;
    } catch {
      return false;
    }
  }

  async load(keyHash: string) {
    const row = await this.db.prepare('SELECT key_hash, payload, payload_version, revision, created_at, updated_at FROM sync_states WHERE key_hash = ?')
      .bind(keyHash).first<{ key_hash: string; payload: string; payload_version: number; revision: number; created_at: string; updated_at: string }>();
    return row ? { keyHash: row.key_hash, payload: row.payload, payloadVersion: row.payload_version, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  async save(keyHash: string, payload: string, expectedRevision: number, force: boolean, updatedAt: string) {
    const statement = force
      ? this.db.prepare('UPDATE sync_states SET payload = ?, payload_version = 3, revision = revision + 1, updated_at = ? WHERE key_hash = ?').bind(payload, updatedAt, keyHash)
      : this.db.prepare('UPDATE sync_states SET payload = ?, payload_version = 3, revision = revision + 1, updated_at = ? WHERE key_hash = ? AND revision = ?').bind(payload, updatedAt, keyHash, expectedRevision);
    const result = await statement.run();
    if (Number(result.meta?.changes ?? 0) === 1) return { status: 'saved' as const, row: (await this.load(keyHash)) as SyncRow };
    const current = await this.load(keyHash);
    return current ? { status: 'conflict' as const, currentRevision: current.revision } : { status: 'missing' as const };
  }
}

function corsHeaders(origin: string | null, allowedOrigin: string): Record<string, string> {
  return origin === allowedOrigin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : {};
}

const worker = {
  async fetch(request: Request, env: Env) {
    const allowedOrigin = env.ALLOWED_ORIGIN ?? 'https://loveca-card-list.pages.dev';
    const origin = request.headers.get('origin');
    if (origin && origin !== allowedOrigin) return new Response(JSON.stringify({ error: 'origin_not_allowed', message: 'このサイトからは利用できません。' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const cors = corsHeaders(origin, allowedOrigin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const response = await createSyncService(new D1SyncStore(env.DB))(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  },
};

export default worker;
