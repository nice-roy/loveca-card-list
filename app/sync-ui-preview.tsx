'use client';

import { useState } from 'react';
import { CloudSyncDialog, type CloudImportPreview, type CloudSyncMessage, type CloudSyncView } from '@/components/cloud-sync-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SyncHistorySummary, SyncMetadata } from '@/lib/cloud-sync';
import './sync-ui-preview.css';

type Scenario = 'unconnected' | 'connected' | 'dirty' | 'cloud-updated' | 'error' | 'history' | 'no-history';
type Confirmation = 'restore' | 'disconnect' | null;

const MOCK_CODE = 'MOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCK';
const MOCK_METADATA: SyncMetadata = {
  revision: 12,
  cloudUpdatedAt: '2026-09-15T12:34:00.000Z',
  lastSyncedAt: '2026-09-15T12:36:00.000Z',
};
const MOCK_HISTORY: SyncHistorySummary[] = [
  { id: 3, sourceRevision: 11, savedAt: '2026-09-15T11:20:00.000Z', deckCount: 3, candidateCount: 18, inventoryCount: 124 },
  { id: 2, sourceRevision: 10, savedAt: '2026-09-14T21:45:00.000Z', deckCount: 2, candidateCount: 14, inventoryCount: 119 },
];
const MOCK_IMPORT: CloudImportPreview = { deckCount: 3, candidateCount: 18, inventoryCount: 124, updatedAt: '2026-09-15T12:34:00.000Z' };

const scenarios: { id: Scenario; label: string; description: string }[] = [
  { id: 'unconnected', label: '未接続', description: '同期コードをまだ作成していない状態' },
  { id: 'connected', label: '同期済み', description: '同期済みで未保存変更がない状態' },
  { id: 'dirty', label: '未保存変更あり', description: 'この端末にクラウド未保存の変更がある状態' },
  { id: 'cloud-updated', label: 'クラウド側に更新あり', description: '別端末更新との競合を検知した状態' },
  { id: 'error', label: 'エラー', description: '通信エラー表示の確認用' },
  { id: 'history', label: '保存履歴あり', description: '履歴選択と復元確認を操作できる状態' },
  { id: 'no-history', label: '保存履歴なし', description: '履歴がまだない同期済み状態' },
];

export default function SyncUiPreview() {
  const [scenario, setScenario] = useState<Scenario>('unconnected');
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<CloudSyncView>('main');
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<SyncHistorySummary[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<SyncHistorySummary | null>(null);
  const [pendingImport, setPendingImport] = useState<CloudImportPreview | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [message, setMessage] = useState<CloudSyncMessage>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const applyScenario = (next: Scenario) => {
    const connected = next !== 'unconnected';
    setScenario(next);
    setSyncCode(connected ? MOCK_CODE : null);
    setMetadata(connected ? MOCK_METADATA : null);
    setDirty(next === 'dirty');
    setHistory(next === 'history' ? MOCK_HISTORY : []);
    setSelectedHistory(null);
    setPendingImport(null);
    setCodeInput('');
    setCopied(false);
    setForceConfirm(false);
    setMessage(next === 'error' ? { kind: 'error', text: '通信できませんでした。ネットワークを確認して、もう一度お試しください。' } : null);
    setView(next === 'cloud-updated' ? 'conflict' : 'main');
    setOpen(true);
  };

  const showImportPreview = () => {
    setPendingImport(MOCK_IMPORT);
    setMessage(null);
    setView('preview');
  };

  return <main className="sync-preview-page">
    <header className="sync-preview-hero">
      <span>PREVIEW ONLY · MOCK</span>
      <h1>クラウド同期UI 安全確認</h1>
      <p>このページはmock／fixtureだけで動作します。Worker・D1・同期APIへの通信や、実在する同期コードの使用はありません。</p>
    </header>
    <section className="sync-preview-scenarios" aria-label="確認する同期状態">
      <h2>確認する状態</h2>
      <div>{scenarios.map((item) => <button aria-pressed={scenario === item.id} key={item.id} onClick={() => applyScenario(item.id)} type="button"><strong>{item.label}</strong><span>{item.description}</span></button>)}</div>
      <Button onClick={() => setOpen(true)} type="button">選択中の同期UIを開く</Button>
    </section>
    <section className="sync-preview-safety">
      <h2>安全仕様</h2>
      <ul><li>表示する同期コード・日時・履歴・件数はすべてfixtureです。</li><li>保存・読み込み・復元・解除は、この画面内のReact stateだけを変更します。</li><li>ブラウザを再読み込みすると初期状態へ戻ります。</li></ul>
    </section>

    <CloudSyncDialog
      busy={false}
      copied={copied}
      forceConfirm={forceConfirm}
      hasUnsavedChanges={dirty}
      history={history}
      historyLoading={false}
      message={message}
      onBack={() => { setPendingImport(null); setView(syncCode ? 'main' : codeInput ? 'connect' : 'main'); }}
      onCancelConflict={() => { setView('main'); setMessage(null); setForceConfirm(false); }}
      onCancelImport={() => { setPendingImport(null); setView('main'); }}
      onCheckCode={showImportPreview}
      onConfirmImport={() => { setPendingImport(null); setSyncCode(MOCK_CODE); setMetadata(MOCK_METADATA); setDirty(false); setView('main'); setMessage({ kind: 'success', text: 'mockデータをこのPreview画面へ読み込みました。' }); }}
      onCopyCode={() => setCopied(true)}
      onCreate={() => { setSyncCode(MOCK_CODE); setMetadata(MOCK_METADATA); setHistory([]); setView('main'); setMessage({ kind: 'success', text: 'mock同期コードを作成しました。' }); }}
      onDisconnect={() => setConfirmation('disconnect')}
      onForceConfirmChange={setForceConfirm}
      onLoad={showImportPreview}
      onOpenChange={setOpen}
      onRefreshHistory={() => setMessage({ kind: 'success', text: 'mock履歴を更新しました。' })}
      onRestoreHistory={() => setConfirmation('restore')}
      onSave={(force) => { setDirty(false); setForceConfirm(false); setView('main'); setMessage({ kind: 'success', text: force ? 'mockクラウド状態を上書きしました。' : 'mockクラウドへ保存しました。' }); }}
      onSelectHistory={setSelectedHistory}
      onShowConnect={() => { setView('connect'); setMessage(null); }}
      onSyncCodeInputChange={(value) => { setCodeInput(value); setMessage(null); }}
      open={open}
      pendingImport={pendingImport}
      previewNotice="安全なmock Previewです。表示上の操作は実APIへ送信されません。"
      selectedHistory={selectedHistory}
      syncCode={syncCode}
      syncCodeInput={codeInput}
      syncMetadata={metadata}
      view={view}
    />

    <Dialog onOpenChange={(next) => !next && setConfirmation(null)} open={confirmation !== null}>
      <DialogContent className="cloud-history-restore-dialog">
        <DialogHeader><DialogTitle>{confirmation === 'restore' ? '過去のクラウド状態へ戻しますか？' : 'この端末の同期を解除しますか？'}</DialogTitle><DialogDescription>{confirmation === 'restore' ? '選択したmock履歴を新しいrevisionとして復元します。' : 'mock上の接続表示だけを未接続へ戻します。'}</DialogDescription></DialogHeader>
        <p className="sync-preview-confirm-note">Preview内の状態変化だけです。Worker・D1・同期APIへは送信されません。</p>
        <DialogFooter><Button onClick={() => setConfirmation(null)} type="button" variant="outline">キャンセル</Button><Button onClick={() => { if (confirmation === 'restore') { setSelectedHistory(null); setMessage({ kind: 'success', text: '選択したmock履歴を復元しました。' }); } else { applyScenario('unconnected'); setMessage({ kind: 'success', text: 'mock同期を解除しました。' }); } setConfirmation(null); }} type="button">{confirmation === 'restore' ? 'この状態に戻す' : '同期を解除'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
}
