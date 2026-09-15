import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cloudSyncStatusLabels, getCloudSyncEntryStatus } from '../lib/cloud-sync-status.ts';

const page = fs.readFileSync('app/page.tsx', 'utf8');
const entry = fs.readFileSync('main.tsx', 'utf8');
const syncDialog = fs.readFileSync('components/cloud-sync-dialog.tsx', 'utf8');
const syncEntry = fs.readFileSync('components/cloud-sync-entry.tsx', 'utf8');
const globalStyles = fs.readFileSync('app/globals.css', 'utf8');

test('production entry renders the normal application without the mock preview route', () => {
  assert.doesNotMatch(entry, /sync-ui-preview|SyncUiPreview/);
  assert.equal(fs.existsSync('app/sync-ui-preview.tsx'), false);
  assert.equal(fs.existsSync('app/sync-ui-preview.css'), false);
});

test('cloud sync entry uses readable text for every state instead of a color-only dot', () => {
  assert.deepEqual(cloudSyncStatusLabels, {
    unconnected: '未接続',
    connected: '同期済み',
    dirty: '未保存あり',
    'cloud-updated': '更新あり',
    error: 'エラー',
  });
  assert.doesNotMatch(page, /cloud-sync-dirty-dot/);
  assert.match(syncEntry, /cloud-sync-status-label/);
});

test('production state resolves every visible sync status deterministically', () => {
  assert.equal(getCloudSyncEntryStatus({ connected: false, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: false }), 'unconnected');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: false }), 'connected');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: false, hasUnsavedChanges: true }), 'dirty');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: true, hasError: false, hasUnsavedChanges: false }), 'cloud-updated');
  assert.equal(getCloudSyncEntryStatus({ connected: true, hasCloudUpdate: false, hasError: true, hasUnsavedChanges: false }), 'error');
});

test('connected metadata starts collapsed under details information', () => {
  assert.match(syncDialog, /<details className="cloud-sync-details"><summary>詳細情報<\/summary>/);
  assert.doesNotMatch(syncDialog, /<details[^>]+open/);
  for (const label of ['クラウド最終更新', 'この端末の最終同期', 'revision']) {
    assert.match(syncDialog, new RegExp(label));
  }
});

test('cloud sync dialog is the bounded touch-scroll container on small viewports', () => {
  const baseRule = globalStyles.match(/\.cloud-sync-dialog \{[^}]+\}/)?.[0] ?? '';
  assert.match(baseRule, /max-height: calc\(100vh - 24px\)/);
  assert.match(baseRule, /max-height: calc\(100dvh - 24px\)/);
  assert.match(baseRule, /overflow-x: hidden/);
  assert.match(baseRule, /overflow-y: auto/);
  assert.match(baseRule, /overscroll-behavior: contain/);
  assert.match(baseRule, /-webkit-overflow-scrolling: touch/);
  assert.match(globalStyles, /max-height: calc\(100dvh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(globalStyles, /scroll-padding-bottom: max\(14px,env\(safe-area-inset-bottom\)\)/);
  assert.match(globalStyles, /\.cloud-sync-footer \{[^}]*padding-bottom: max\(14px,env\(safe-area-inset-bottom\)\)/);
});

test('save and load actions state the correct data directions without changing the sync scope', () => {
  assert.match(syncDialog, /クラウドへ保存[\s\S]*この端末 → クラウド/);
  assert.match(syncDialog, /クラウドから読み込み[\s\S]*クラウド → この端末/);
  assert.match(syncDialog, /デッキ・候補・所持カード/);
  assert.match(syncDialog, /検索条件や表示設定は同期しません/);
});

test('disconnect confirmation explains its scope and distinguishes the confirm action', () => {
  assert.match(syncDialog, /この端末の同期を解除しますか？/);
  assert.match(syncDialog, /この端末と同期コードの関連付けだけを解除します/);
  assert.match(syncDialog, /クラウド上の同期データと、この端末のデッキ・候補・所持カードは削除されません/);
  assert.match(syncDialog, /ほかの端末の同期にも影響しません/);
  assert.match(syncDialog, /キャンセル/);
  assert.match(syncDialog, /className="cloud-disconnect-confirm"[\s\S]*variant="destructive">同期を解除/);
  assert.match(globalStyles, /\.cloud-disconnect-confirm \{[^}]*background: #fff1f2;[^}]*color: #923f48;/);
});
