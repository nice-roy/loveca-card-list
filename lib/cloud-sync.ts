import type { BuilderTransferData } from './builder-transfer';

export const SYNC_CODE_STORAGE_KEY = 'loveca-card-list:sync-code:v1';
export const SYNC_META_STORAGE_KEY = 'loveca-card-list:sync-meta:v1';
export const SYNC_CODE_LENGTH = 32;
export const SYNC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type SyncMetadata = {
  revision: number;
  cloudUpdatedAt: string;
  lastSyncedAt: string;
};

export type SyncSnapshot = {
  payload: BuilderTransferData;
  revision: number;
  createdAt: string;
  updatedAt: string;
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

export function clearSyncConnectionStorage(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(SYNC_CODE_STORAGE_KEY);
  storage.removeItem(SYNC_META_STORAGE_KEY);
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
