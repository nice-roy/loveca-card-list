import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cloudSyncStatusLabels, getCloudSyncEntryStatus } from '../lib/cloud-sync-status.ts';

const preview = fs.readFileSync('app/sync-ui-preview.tsx', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');
const entry = fs.readFileSync('main.tsx', 'utf8');
const syncDialog = fs.readFileSync('components/cloud-sync-dialog.tsx', 'utf8');
const syncEntry = fs.readFileSync('components/cloud-sync-entry.tsx', 'utf8');
const globalStyles = fs.readFileSync('app/globals.css', 'utf8');

test('sync UI Preview is route-scoped and reuses the production presentation component', () => {
  assert.match(entry, /\/sync-ui-preview/);
  assert.match(preview, /CloudSyncDialog/);
  assert.match(page, /CloudSyncDialog/);
  assert.match(preview, /CloudSyncEntry/);
  assert.match(page, /CloudSyncEntry/);
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

test('cloud sync entry uses readable text for every state instead of a color-only dot', () => {
  for (const label of ['未接続', '同期済み', '未保存あり', '更新あり', 'エラー']) {
    assert.ok(Object.values(cloudSyncStatusLabels).includes(label));
  }
  assert.doesNotMatch(page, /cloud-sync-dirty-dot/);
  assert.match(syncEntry, /cloud-sync-status-label/);
});

test('production and mock inputs resolve every visible sync status deterministically', () => {
  assert.equal(getCloudSyncEntryStatus({ connected: false, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: false }), 'unconnected');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: false }), 'connected');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: true }), 'dirty');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: true, hasError: false, hasUnsavedChanges: false }), 'cloud-updated');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: true, hasUnsavedChanges: false }), 'error');
});

test('connected sync metadata starts collapsed under details information', () => {
  assert.match(syncDialog, /<details className="cloud-sync-details"><summary>詳細情報<\/summary>/);
  assert.doesNotMatch(syncDialog, /<details[^>]+open/);
  for (const label of ['クラウド最終更新', 'この端末の最終同期', 'revision']) {
    assert.match(syncDialog, new RegExp(label));
  }
});

test('cloud sync dialog is the bounded touch-scroll container on small viewports', () => {
  const baseRule = globalStyles.match(/\.cloud-sync-dialog \{[^}]+\}/)?.[0] ?? '';
  assert.match(baseRule, /max-height: calc\(100dvh - 24px\)/);
  assert.match(baseRule, /overflow-x: hidden/);
  assert.match(baseRule, /overflow-y: auto/);
  assert.match(baseRule, /overscroll-behavior: contain/);
  assert.match(baseRule, /-webkit-overflow-scrolling: touch/);

  assert.match(globalStyles, /max-height: calc\(100dvh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(globalStyles, /scroll-padding-bottom: max\(14px,env\(safe-area-inset-bottom\)\)/);
  assert.match(globalStyles, /\.cloud-sync-footer \{[^}]*padding-bottom: max\(14px,env\(safe-area-inset-bottom\)\)/);
});
