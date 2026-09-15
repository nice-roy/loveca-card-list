import { useState } from 'react';
import { Check, CloudDownload, CloudUpload, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatSyncCode, type SyncHistorySummary, type SyncMetadata } from '@/lib/cloud-sync';

export type CloudSyncView = 'main' | 'connect' | 'preview' | 'conflict';
export type CloudSyncMessage = { kind: 'success' | 'error'; text: string } | null;
export type CloudImportPreview = {
  deckCount: number;
  candidateCount: number;
  inventoryCount: number;
  updatedAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: CloudSyncView;
  syncCode: string | null;
  syncCodeInput: string;
  onSyncCodeInputChange: (value: string) => void;
  syncMetadata: SyncMetadata | null;
  busy: boolean;
  copied: boolean;
  hasUnsavedChanges: boolean;
  history: SyncHistorySummary[];
  historyLoading: boolean;
  selectedHistory: SyncHistorySummary | null;
  pendingImport: CloudImportPreview | null;
  forceConfirm: boolean;
  message: CloudSyncMessage;
  onCreate: () => void;
  onShowConnect: () => void;
  onBack: () => void;
  onCheckCode: () => void;
  onCopyCode: () => void;
  onSave: (force: boolean) => void;
  onLoad: () => void;
  onRefreshHistory: () => void;
  onSelectHistory: (history: SyncHistorySummary) => void;
  onRestoreHistory: () => void;
  onDisconnect: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onCancelConflict: () => void;
  onForceConfirmChange: (value: boolean) => void;
};

function formatSyncDate(value?: string) {
  if (!value) return '未確認';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未確認' : date.toLocaleString('ja-JP');
}

export function CloudSyncDialog(props: Props) {
  const {
    open, onOpenChange, view, syncCode, syncCodeInput, onSyncCodeInputChange, syncMetadata,
    busy, copied, hasUnsavedChanges, history, historyLoading, selectedHistory, pendingImport,
    forceConfirm, message, onCreate, onShowConnect, onBack, onCheckCode,
    onCopyCode, onSave, onLoad, onRefreshHistory, onSelectHistory, onRestoreHistory,
    onDisconnect, onConfirmImport, onCancelImport, onCancelConflict, onForceConfirmChange,
  } = props;
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) setDisconnectConfirmOpen(false);
    onOpenChange(next);
  };

  const confirmDisconnect = () => {
    setDisconnectConfirmOpen(false);
    onDisconnect();
  };

  return <><Dialog onOpenChange={handleOpenChange} open={open}>
    <DialogContent className="cloud-sync-dialog">
      <DialogHeader><DialogTitle>クラウド同期</DialogTitle><DialogDescription>デッキ・候補・所持カードを、同期コードを使って手動で共有します。検索条件や表示設定は同期しません。</DialogDescription></DialogHeader>
      {view === 'main' && !syncCode && <div className="cloud-sync-unconnected"><Button disabled={busy} onClick={onCreate} type="button"><CloudUpload />{busy ? '作成中…' : '同期コードを作成'}</Button><Button disabled={busy} onClick={onShowConnect} type="button" variant="outline"><CloudDownload />既存の同期コードを入力</Button><p>同期コードを作成すると、現在の全デッキ・候補・所持カードが初期データとして保存されます。</p></div>}
      {view === 'connect' && <div className="cloud-sync-connect"><div className="data-transfer-heading"><button onClick={onBack} type="button">← 戻る</button><strong>既存コードへ接続</strong></div><label htmlFor="cloud-sync-code-input"><span>同期コード</span><Input autoCapitalize="characters" autoComplete="off" id="cloud-sync-code-input" onChange={(event) => onSyncCodeInputChange(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" spellCheck={false} value={syncCodeInput} /></label><p>コードを確認後、クラウド内容のプレビューを表示します。この時点では端末データを変更しません。</p><Button disabled={busy || !syncCodeInput.trim()} onClick={onCheckCode} type="button">{busy ? '確認中…' : 'クラウド内容を確認'}</Button></div>}
      {view === 'main' && syncCode && <div className="cloud-sync-connected"><div className="cloud-sync-code"><span>同期コード</span><strong>{formatSyncCode(syncCode)}</strong><Button onClick={onCopyCode} size="sm" type="button" variant="outline">{copied ? <Check /> : <Copy />}{copied ? 'コピーしました' : 'コピー'}</Button></div><p className="cloud-sync-warning">このコードを知っている人は同期データへアクセスできます。第三者へ公開せず、安全に保管してください。</p>{hasUnsavedChanges && <p aria-live="polite" className="cloud-sync-local-change">この端末に未保存の変更があります。</p>}<details className="cloud-sync-details"><summary>詳細情報</summary><dl className="cloud-sync-meta"><div><dt>クラウド最終更新</dt><dd>{formatSyncDate(syncMetadata?.cloudUpdatedAt)}</dd></div><div><dt>この端末の最終同期</dt><dd>{formatSyncDate(syncMetadata?.lastSyncedAt)}</dd></div><div><dt>revision</dt><dd>{syncMetadata?.revision ?? '未確認'}</dd></div></dl></details><div className="cloud-sync-actions"><Button disabled={busy || !syncMetadata} onClick={() => onSave(false)} type="button"><CloudUpload /><span className="cloud-sync-action-copy"><strong>{busy ? '処理中…' : 'クラウドへ保存'}</strong><small>この端末 → クラウド</small></span></Button><Button disabled={busy} onClick={onLoad} type="button" variant="outline"><CloudDownload /><span className="cloud-sync-action-copy"><strong>クラウドから読み込み</strong><small>クラウド → この端末</small></span></Button></div>{!syncMetadata && <p className="cloud-sync-note">同期状態を確認するため、先に「クラウドから読み込み」を実行してください。</p>}<section className="cloud-sync-history"><div className="cloud-sync-history-header"><h3>過去の状態</h3><Button disabled={busy || historyLoading} onClick={onRefreshHistory} size="sm" type="button" variant="ghost">{historyLoading ? '確認中…' : '更新'}</Button></div>{historyLoading && history.length === 0 ? <p className="cloud-sync-history-empty">過去の状態を確認しています…</p> : history.length === 0 ? <p className="cloud-sync-history-empty">過去の状態はまだありません</p> : <div className="cloud-sync-history-list">{history.map((item) => <section className={selectedHistory?.id === item.id ? 'selected' : ''} key={item.id}><div><strong>{formatSyncDate(item.savedAt)}</strong><span>元revision {item.sourceRevision}</span><span>デッキ {item.deckCount}件・候補 {item.candidateCount}種類・所持 {item.inventoryCount}種類</span></div><Button aria-pressed={selectedHistory?.id === item.id} disabled={busy} onClick={() => onSelectHistory(item)} size="sm" type="button" variant="outline">内容を見る</Button></section>)}</div>}{selectedHistory && <div className="cloud-sync-history-selected"><strong>{formatSyncDate(selectedHistory.savedAt)} の状態</strong><span>デッキ {selectedHistory.deckCount}件・候補 {selectedHistory.candidateCount}種類・所持 {selectedHistory.inventoryCount}種類</span><Button disabled={busy || !syncMetadata} onClick={onRestoreHistory} size="sm" type="button" variant="outline">この状態に戻す</Button></div>}</section><Button className="cloud-sync-disconnect" disabled={busy} onClick={() => setDisconnectConfirmOpen(true)} size="sm" type="button" variant="ghost">この端末の同期を解除</Button></div>}
      {view === 'preview' && pendingImport && <div className="cloud-sync-preview"><div className="data-transfer-heading"><button onClick={onBack} type="button">← 戻る</button><strong>クラウドから読み込む内容</strong></div><dl><div><dt>デッキ</dt><dd>{pendingImport.deckCount}件</dd></div><div><dt>候補</dt><dd>{pendingImport.candidateCount}種類</dd></div><div><dt>所持登録</dt><dd>{pendingImport.inventoryCount}種類</dd></div><div><dt>クラウド更新</dt><dd>{formatSyncDate(pendingImport.updatedAt)}</dd></div></dl><p>現在のこの端末の全デッキ・候補・所持カードを、クラウド状態で置き換えます。実行直後は1回だけ元に戻せます。</p><div className="cloud-sync-actions"><Button onClick={onConfirmImport} type="button">この内容を読み込む</Button><Button onClick={onCancelImport} type="button" variant="outline">キャンセル</Button></div></div>}
      {view === 'conflict' && <div className="cloud-sync-conflict"><strong>別の端末で更新されています</strong><p>古い状態からの保存は中止しました。最新のクラウドデータを読み込むか、操作をキャンセルしてください。</p><div className="cloud-sync-actions"><Button disabled={busy || !syncCode} onClick={onLoad} type="button"><CloudDownload />最新データを読み込む</Button><Button onClick={onCancelConflict} type="button" variant="outline">キャンセル</Button></div>{!forceConfirm ? <button className="cloud-force-link" onClick={() => onForceConfirmChange(true)} type="button">現在の端末データで上書きする場合</button> : <div className="cloud-force-confirm" role="alert"><strong>本当にクラウドを上書きしますか？</strong><p>別端末の最新データは失われます。</p><div><Button disabled={busy} onClick={() => onSave(true)} type="button" variant="destructive">上書きを実行</Button><Button onClick={() => onForceConfirmChange(false)} type="button" variant="outline">戻る</Button></div></div>}</div>}
      {message && <p aria-live="polite" className={`cloud-sync-message ${message.kind}`}>{message.text}</p>}
      <DialogFooter className="cloud-sync-footer"><DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>
    <Dialog onOpenChange={setDisconnectConfirmOpen} open={disconnectConfirmOpen}>
      <DialogContent className="cloud-disconnect-dialog">
        <DialogHeader><DialogTitle>この端末の同期を解除しますか？</DialogTitle><DialogDescription>この端末と同期コードの関連付けだけを解除します。クラウド上の同期データと、この端末のデッキ・候補・所持カードは削除されません。ほかの端末の同期にも影響しません。</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={() => setDisconnectConfirmOpen(false)} type="button" variant="outline">キャンセル</Button><Button className="cloud-disconnect-confirm" onClick={confirmDisconnect} type="button" variant="destructive">同期を解除</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
