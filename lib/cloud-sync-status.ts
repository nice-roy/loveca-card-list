export type CloudSyncEntryStatus = 'unconnected' | 'connected' | 'dirty' | 'cloud-updated' | 'error';

export const cloudSyncStatusLabels: Record<CloudSyncEntryStatus, string> = {
  unconnected: '未接続',
  connected: '同期済み',
  dirty: '未保存あり',
  'cloud-updated': '更新あり',
  error: 'エラー',
};

type CloudSyncEntryState = {
  connected: boolean;
  hasCloudUpdate: boolean;
  hasError: boolean;
  hasUnsavedChanges: boolean;
};

export function getCloudSyncEntryStatus({ connected, hasCloudUpdate, hasError, hasUnsavedChanges }: CloudSyncEntryState): CloudSyncEntryStatus {
  if (hasError) return 'error';
  if (hasCloudUpdate) return 'cloud-updated';
  if (!connected) return 'unconnected';
  return hasUnsavedChanges ? 'dirty' : 'connected';
}
