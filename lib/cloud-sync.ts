import type { BuilderTransferData } from './builder-transfer';

export const SYNC_CODE_STORAGE_KEY = 'loveca-card-list:sync-code:v1';
export const SYNC_META_STORAGE_KEY = 'loveca-card-list:sync-meta:v1';
export const SYNC_BASELINE_STORAGE_KEY = 'loveca-card-list:sync-baseline:v1';
export const SYNC_CODE_LENGTH = 32;
export const SYNC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type SyncMetadata = {
  revision: number;
  cloudUpdatedAt: string;
  lastSyncedAt: string;
};

export type SyncBaseline = {
  version: 1;
  code: string;
  fingerprint: string;
};

export type SyncSnapshot = {
  payload: BuilderTransferData;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type SyncHistorySummary = {
  id: number;
  sourceRevision: number;
  savedAt: string;
  deckCount: number;
  candidateCount: number;
  inventoryCount: number;
};

export type SyncHistoryResult = {
  history: SyncHistorySummary[];
  revision: number;
};

export type SyncHistoryRestoreResult = {
  payload: BuilderTransferData;
  revision: number;
  updatedAt: string;
  restoredFromRevision: number;
};

export class CloudSyncError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentRevision?: number;

  constructor(
    message: string,
    status: number,
    code: string,
    currentRevision?: number,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

export function normalizeSyncCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  if (normalized.length !== SYNC_CODE_LENGTH) return null;
  return /^[A-HJ-NP-Z2-9]{32}$/.test(normalized) ? normalized : null;
}

export function formatSyncCode(value: string) {
  const normalized = normalizeSyncCode(value);
  return normalized ? normalized.match(/.{1,4}/g)?.join('-') ?? normalized : '';
}

export function normalizeSyncMetadata(value: unknown): SyncMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.revision) && Number(item.revision) >= 1
    && typeof item.cloudUpdatedAt === 'string'
    && typeof item.lastSyncedAt === 'string'
    ? { revision: Number(item.revision), cloudUpdatedAt: item.cloudUpdatedAt, lastSyncedAt: item.lastSyncedAt }
    : null;
}

export function createSyncPayloadFingerprint(payload: BuilderTransferData) {
  return JSON.stringify({
    format: payload.format,
    version: payload.version,
    activeDeckId: payload.activeDeckId,
    decks: payload.decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      cards: [...deck.cards].sort((left, right) => left.baseCardId.localeCompare(right.baseCardId, 'ja', { numeric: true })),
    })),
    candidates: [...payload.candidates].sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
    inventory: [...payload.inventory].sort((left, right) => left.cardId.localeCompare(right.cardId, 'ja', { numeric: true })),
  });
}

export function createSyncBaseline(code: string, payload: BuilderTransferData): SyncBaseline {
  return { version: 1, code, fingerprint: createSyncPayloadFingerprint(payload) };
}

export function isSyncPayloadDirty(code: string | null, baseline: SyncBaseline | null, payload: BuilderTransferData) {
  return Boolean(code && baseline?.code === code && baseline.fingerprint !== createSyncPayloadFingerprint(payload));
}

export function normalizeSyncBaseline(value: unknown): SyncBaseline | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const code = normalizeSyncCode(item.code);
  return item.version === 1 && code && typeof item.fingerprint === 'string' && item.fingerprint.length > 0
    ? { version: 1, code, fingerprint: item.fingerprint }
    : null;
}

export function clearSyncConnectionStorage(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(SYNC_CODE_STORAGE_KEY);
  storage.removeItem(SYNC_META_STORAGE_KEY);
  storage.removeItem(SYNC_BASELINE_STORAGE_KEY);
}

export function getSyncApiUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SYNC_API_URL?.replace(/\/$/, '') ?? '';
}

async function request<T>(apiUrl: string, path: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  if (!apiUrl) throw new CloudSyncError('クラウド同期APIが設定されていません。', 0, 'not_configured');
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudSyncError('通信できませんでした。ネットワークを確認して、もう一度お試しください。', 0, 'network_error');
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new CloudSyncError(
      typeof result.message === 'string' ? result.message : 'クラウド同期に失敗しました。',
      response.status,
      typeof result.error === 'string' ? result.error : 'unknown_error',
      Number.isInteger(result.currentRevision) ? Number(result.currentRevision) : undefined,
    );
  }
  return result as T;
}

export function createCloudSync(apiUrl: string, payload: BuilderTransferData, fetcher?: typeof fetch) {
  return request<{ code: string; revision: number; createdAt: string; updatedAt: string }>(apiUrl, '/sync/create', { payload }, fetcher);
}

export function loadCloudSync(apiUrl: string, code: string, fetcher?: typeof fetch) {
  return request<SyncSnapshot>(apiUrl, '/sync/load', { code }, fetcher);
}

export function saveCloudSync(apiUrl: string, code: string, payload: BuilderTransferData, revision: number, force = false, fetcher?: typeof fetch) {
  return request<{ revision: number; updatedAt: string }>(apiUrl, '/sync/save', { code, payload, revision, force }, fetcher);
}

export function loadCloudSyncHistory(apiUrl: string, code: string, fetcher?: typeof fetch) {
  return request<SyncHistoryResult>(apiUrl, '/sync/history', { code }, fetcher);
}

export function restoreCloudSyncHistory(apiUrl: string, code: string, historyId: number, revision: number, fetcher?: typeof fetch) {
  return request<SyncHistoryRestoreResult>(apiUrl, '/sync/history/restore', { code, historyId, revision }, fetcher);
}
