import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const preview = fs.readFileSync('app/sync-ui-preview.tsx', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');
const entry = fs.readFileSync('main.tsx', 'utf8');

test('sync UI Preview is route-scoped and reuses the production presentation component', () => {
  assert.match(entry, /\/sync-ui-preview/);
  assert.match(preview, /CloudSyncDialog/);
  assert.match(page, /CloudSyncDialog/);
});

test('sync UI Preview contains no API, Worker, D1, or persistent-storage access', () => {
  for (const forbidden of [
    'VITE_SYNC_API_URL',
    'getSyncApiUrl',
    'createCloudSync',
    'loadCloudSync',
    'saveCloudSync',
    'loadCloudSyncHistory',
    'restoreCloudSyncHistory',
    'fetch(',
    'XMLHttpRequest',
    'localStorage',
    'sessionStorage',
    'workers.dev',
  ]) {
    assert.equal(preview.includes(forbidden), false, `Preview must not contain ${forbidden}`);
  }
});

test('sync UI Preview exposes every required fixture state', () => {
  for (const label of ['未接続', '同期済み', '未保存変更あり', 'クラウド側に更新あり', 'エラー', '保存履歴あり', '保存履歴なし']) {
    assert.match(preview, new RegExp(label));
  }
});
