import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Card } from '@/app/data/schema';
import { MAX_OWNED_QUANTITY, type InventoryQuantities } from '@/lib/inventory';
import { CameraCapture, type Arrangement, type CameraRow } from './camera-capture';
import { createCameraSession, type ScanTiming } from './camera-session';
import './camera-inventory.css';

export type Addition = { id: string; before: number; qty: number };
type Props = { cards: Card[]; inventory: InventoryQuantities; onCommit: (items: Addition[]) => Promise<void>; onClose: () => void };
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja').trim();
const label = (card: Card) => card.name + '　' + card.cardNumber;
const seconds = (ms: number) => (ms / 1000).toFixed(1) + '秒';

function AdditionStepper({ title, target, inputLabel = title, value, onChange }: {
  title: string; target: string; inputLabel?: string; value: string; onChange: (value: string) => void;
}) {
  const id = useId();
  const count = Number(value);
  const step = (delta: number) => {
    const next = Math.max(1, Math.min(MAX_OWNED_QUANTITY, Math.trunc(count) + delta));
    onChange(String(next));
  };
  return <div className="cam-quantity">
    <label htmlFor={id}>{title}</label>
    <div className="cam-stepper">
      <button type="button" aria-label={target + 'を1枚減らす'} disabled={count <= 1} onClick={() => step(-1)}>−</button>
      <input id={id} aria-label={inputLabel} type="number" inputMode="numeric" min={1} max={MAX_OWNED_QUANTITY} step={1} value={value} onChange={e => onChange(e.target.value)} />
      <button type="button" aria-label={target + 'を1枚増やす'} disabled={count >= MAX_OWNED_QUANTITY} onClick={() => step(1)}>＋</button>
    </div>
  </div>;
}

export function CameraInventory({ cards, inventory, onCommit, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [stage, setStage] = useState<'capture' | 'review' | 'done'>('capture');
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false);
  const [arrangement, setArrangement] = useState<Arrangement>({ count: 6, index: 0 });
  const [rows, setRows] = useState<CameraRow[]>([]);
  const [bulkQty, setBulkQty] = useState('1');
  const summary = useRef<HTMLElement>(null);
  const [search, setSearch] = useState<number | null>(null), [query, setQuery] = useState('');
  const [limits, setLimits] = useState<Record<string, { before: number; wanted: number }>>({});
  const [saved, setSaved] = useState(0), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [timing, setTiming] = useState<ScanTiming>();
  const photoReadyAt = useRef(0);
  const [finishMs, setFinishMs] = useState(0);
  const savingRef = useRef(false);
  const byId = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const liveIds = useMemo(() => cards.filter(card => card.cardType === 'live').map(card => card.id), [cards]);
  const session = useMemo(() => createCameraSession(liveIds), [liveIds]);
  useEffect(() => {
    // Overlap the initial transfer and index build with camera and crop selection.
    // A failed preload is retried by the normal recognition action.
    void session.prepare().catch(() => {});
    return () => { void session.reset(); };
  }, [session]);
  const matches = useMemo(() => {
    const term = normalize(query);
    return term ? cards.filter(card => normalize(label(card)).includes(term)).slice(0, 30) : [];
  }, [cards, query]);
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  useEffect(() => { heading.current?.focus(); if (dialog.current) dialog.current.scrollTop = 0; }, [stage]);
  function requestClose() { if (!savingRef.current) { if (dirty && stage !== 'done') setDiscard(true); else onClose(); } }
  function updateRow(number: number, change: Partial<CameraRow>) {
    setRows(prev => prev.map(row => row.number === number ? { ...row, ...change } : row));
    setError('');
  }
  const sums = new Map<string, number>();
  const selectedRows = rows.filter(row => !row.excluded && byId.has(row.id));
  for (const row of selectedRows) sums.set(row.id, (sums.get(row.id) || 0) + row.qty);
  const perCard = Number(bulkQty);
  const validBulkQty = Number.isInteger(perCard) && perCard >= 1 && perCard <= MAX_OWNED_QUANTITY;
  function applyBulkQty() {
    if (!validBulkQty || !selectedRows.length) return;
    setRows(rows.map(row => !row.excluded && byId.has(row.id) ? { ...row, qty: perCard } : row));
    setLimits({});
    setError('');
  }
  const groups = Array.from(sums, ([id, wanted]) => {
    const before = inventory[id] || 0, room = MAX_OWNED_QUANTITY - before;
    const capped = limits[id]?.before === before && limits[id]?.wanted === wanted;
    return { id, before, wanted, room, qty: capped ? Math.min(room, wanted) : wanted, capped };
  });
  const unresolved = rows.filter(r => !r.excluded && (!byId.has(r.id) || !Number.isInteger(r.qty) || r.qty < 1 || r.qty > 99)).length;
  const total = groups.reduce((sum, g) => sum + g.qty, 0);
  const canSave = !unresolved && total > 0 && groups.every(g => g.qty <= g.room);
  async function save() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try { await onCommit(groups.map(({ id, before, qty }) => ({ id, before, qty }))); setFinishMs(performance.now() - photoReadyAt.current); setSaved(total); setRows([]); setDirty(false); setStage('done'); }
    catch (err) { setError((err as Error).message); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="camera-dialog" aria-labelledby="camera-title" onCancel={e => { e.preventDefault(); requestClose(); }}>
    <header><h2 id="camera-title" tabIndex={-1} ref={heading}>{stage === 'capture' ? '写真から所持に追加' : stage === 'review' ? '版と追加枚数を確認' : '登録完了'}</h2><button aria-label="閉じる" disabled={saving} onClick={requestClose}>閉じる</button></header>
    {discard && <section className="cam-alert" role="alert"><strong>今回の写真と確認内容を破棄して戻りますか？</strong><div className="cam-line"><button onClick={() => setDiscard(false)}>編集を続ける</button><button onClick={onClose}>破棄して戻る</button></div></section>}
    <div inert={discard || undefined}>
    {stage === 'capture' && <CameraCapture arrangement={arrangement} onArrangement={setArrangement} session={session} onDirty={value => { setDirty(value); if (value) photoReadyAt.current = performance.now(); }} onResults={(values, scanTime) => { setTiming(scanTime); setRows(values.map(r => ({ ...r, id: byId.has(r.id) ? r.id : '', options: r.options.filter(id => byId.has(id)) }))); setStage('review'); }} />}
    {stage !== 'capture' && timing && <section className="cam-timing">
      <p>準備待ち {seconds(timing.waitMs)} ／ 照合 {seconds(timing.matchMs)}</p>
      <details><summary>時間の内訳</summary>
        <p>照合ボタンから候補の準備完了まで {seconds(timing.elapsedMs)}。初期準備全体は {seconds(timing.setupMs)}（撮影中の先読みを含む）。</p>
        <p>画像の特徴抽出 {seconds(timing.phases.prepare)} ／ 候補探し {seconds(timing.phases.retrieve)} ／ 詳細比較 {seconds(timing.phases.verify)}。照合全体のうちブラウザー再開待ち {seconds(timing.phases.yieldWait)}。</p>
        <p>特徴点の照合方式　{timing.backends.map(mode => ({ fast: '高速', classic: '従来', mixed: '高速・従来併用', none: '該当なし' })[mode as 'fast' | 'classic' | 'mixed' | 'none'] ?? '未判定').join(' ／ ')}{typeof timing.phases.verifyDetail?.geometry === 'number' && '。位置合わせ ' + seconds(timing.phases.verifyDetail.geometry)}。</p>
        {stage === 'done' && <p>写真の読み込み完了から所持登録まで {seconds(finishMs)}（枠調整と版確認を含む）。</p>}
      </details>
    </section>}
    {stage === 'review' && <fieldset disabled={saving}><legend className="cam-sr">カードの確認</legend><p>実物と照らして、版と枚数を確認してください。</p>
      <button className="cam-quiet" onClick={() => {
        summary.current?.focus({ preventScroll: true });
        summary.current?.scrollIntoView({ block: 'start' });
      }}>枚数の一括設定・合計へ</button>
      <ol className="cam-rows">{rows.map(row => <li key={row.number}>
        <div className="cam-row-title"><img src={row.thumb} alt={row.number + '番の撮影範囲'} /><strong>{row.number}番　{row.excluded ? '今回は対象外' : byId.get(row.id)?.name || '版を選んでください'}</strong></div>
        {!row.excluded && <>
          <label>カードの版<select aria-label={row.number + '番の版'} value={row.id} onChange={e => updateRow(row.number, { id: e.target.value })}>
            <option value="">選んでください</option>{[...new Set([...row.options, row.id])].filter(id => byId.has(id)).map(id => <option key={id} value={id}>{label(byId.get(id)!)}</option>)}
          </select></label>
          <div className="cam-line"><AdditionStepper title="追加枚数" target={row.number + '番'} inputLabel={row.number + '番の追加枚数'} value={row.qty ? String(row.qty) : ''} onChange={value => updateRow(row.number, { qty: Number(value) })} />
          <button onClick={() => { setSearch(search === row.number ? null : row.number); setQuery(''); }}>番号・名前で探す</button></div>
          {search === row.number && <section className="cam-search"><input autoFocus type="search" aria-label="全カードから検索" placeholder="カード番号または名前" value={query} onChange={e => setQuery(e.target.value)}/>
            {query && !matches.length && <p>一致するカードがありません。</p>}
            {matches.length === 30 && <p>30件まで表示しています。番号で絞り込めます。</p>}
            <ul>{matches.map(card => <li key={card.id}><button onClick={() => { updateRow(row.number, { id: card.id }); setSearch(null); }}>{label(card)}</button></li>)}</ul>
          </section>}
        </>}
        <button className="cam-quiet" onClick={() => { updateRow(row.number, { excluded: !row.excluded }); setSearch(null); }}>{row.excluded ? '登録対象に戻す' : '今回は外す'}</button>
      </li>)}</ol>
      <section ref={summary} tabIndex={-1} className="cam-summary" aria-label="枚数の一括設定と合計">
        <h3>追加枚数をまとめて設定</h3>
        <div className="cam-line cam-bulk"><AdditionStepper title="1枠あたりの追加枚数" target="一括設定" value={bulkQty} onChange={setBulkQty} />
          <button type="button" disabled={!validBulkQty || !selectedRows.length} onClick={applyBulkQty}>版を選んだ{selectedRows.length}枠に適用</button></div>
        <h3>版ごとの合計</h3>{groups.map(g => <div key={g.id}>
        <strong>{label(byId.get(g.id)!)}</strong>
        {g.qty > g.room ? <section className="cam-alert"><p>現在{g.before}枚。{g.room ? '追加できるのはあと' + g.room + '枚です。' : '上限の99枚に達しています。'}</p>
          {g.room > 0 && <button onClick={() => setLimits({ ...limits, [g.id]: { before: g.before, wanted: g.wanted } })}>{g.room}枚だけ追加</button>}
          <button onClick={() => setRows(rs => rs.map(r => r.id === g.id ? { ...r, excluded: true } : r))}>この版は今回は外す</button></section>
          : <p>所持 {g.before}枚　＋{g.qty}枚　→　<strong>{g.before + g.qty}枚</strong>{g.capped && g.qty < g.wanted ? '（上限まで）' : ''}</p>}
      </div>)}<p>追加予定 {total}枚 ／ 今回外した枠 {rows.filter(r => r.excluded).length}件</p>
      {unresolved > 0 && <p>あと{unresolved}件の版・枚数を確認してください。</p>}
      {error && <p role="alert">{error}</p>}
      <button className="cam-primary" disabled={!canSave || saving} onClick={save}>{total}枚をまとめて追加</button></section>
    </fieldset>}
    {stage === 'done' && <section><p role="status" className="cam-success">所持枚数に<strong>{saved}枚</strong>追加しました。</p><div className="cam-line"><button className="cam-primary" onClick={() => { setBulkQty('1'); setLimits({}); setSearch(null); setError(''); setStage('capture'); }}>次のカードを登録</button><button onClick={onClose}>カード一覧に戻る</button></div></section>}
    </div>
  </dialog>;
}
