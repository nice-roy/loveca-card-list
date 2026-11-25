import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { engineModule, type Box, type CameraSession, type ScanTiming } from './camera-session';

type Point = { x: number; y: number };
export type CameraRow = { number: number; thumb: string; options: string[]; id: string; qty: number; excluded: boolean };
type Layout = [number, number];
let knownLayouts: Record<number, Layout[]> = {};
export type Arrangement = { count: number; index: number };
type Props = {
  arrangement: Arrangement; onArrangement: (value: Arrangement) => void;
  session: CameraSession; onResults: (rows: CameraRow[], timing?: ScanTiming) => void; onDirty: (value: boolean) => void;
};
function thumbnail(photo: HTMLCanvasElement, region: Box) {
  const thumb = document.createElement('canvas');
  const ratio = Math.min(128 / region.width, 128 / region.height);
  thumb.width = Math.max(1, Math.round(region.width * ratio));
  thumb.height = Math.max(1, Math.round(region.height * ratio));
  thumb.getContext('2d')!.drawImage(photo, region.x, region.y, region.width, region.height, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.8);
}
export function CameraCapture({ arrangement, onArrangement, session, onResults, onDirty }: Props) {
  const { count, index } = arrangement;
  const [layouts, setLayouts] = useState<Record<number, Layout[]>>(knownLayouts);
  const splitGrid = useRef<((box: Box, columns: number, rows: number, count: number) => Box[]) | null>(null);
  const photo = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0), locked = useRef(false);
  const [photoSize, setPhotoSize] = useState<{ width: number; height: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]), [target, setTarget] = useState<number | null>(null);
  const [corner, setCorner] = useState<Point | null>(null);
  const [outline, setOutline] = useState<{ start: Point; end: Point } | null>(null);
  const [failed, setFailed] = useState(false);
  const down = useRef<Point | null>(null);
  const layout = layouts[count]?.[index] || [3, 2];
  useEffect(() => {
    let active = true;
    Promise.all([engineModule('grid-config'), engineModule('grid-regions')]).then(([a, b]) => {
      if (active) { splitGrid.current = b.splitRegionGrid; knownLayouts = a.GRID_LAYOUTS; setLayouts(knownLayouts); }
    }).catch(() => { if (active) setMessage('枠を準備できませんでした。通信状態を確認して、撮影画面を開き直してください。'); });
    const hide = () => { if (document.hidden) stopCamera(); };
    document.addEventListener('visibilitychange', hide);
    return () => {
      active = false; generation.current++; document.removeEventListener('visibilitychange', hide);
      stream.current?.getTracks().forEach(track => track.stop());
      session.clearProgress();
    };
  }, [session]);
  function stopCamera() {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    setPreview(false);
  }
  async function openCamera() {
    const ticket = ++generation.current;
    try {
      stopCamera(); setMessage('カメラを準備しています。');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 } }, audio: false });
      if (ticket !== generation.current || document.hidden) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; video.current!.srcObject = media; setPreview(true);
      await video.current!.play(); setMessage('');
    } catch { if (ticket === generation.current) { stopCamera(); setMessage('カメラを開けませんでした。ブラウザーでカメラを許可するか、保存した写真を選んでください。'); } }
  }
  function installPhoto(source: CanvasImageSource, width: number, height: number) {
    if (!width || !height) throw new Error('写真を読み取れませんでした。');
    const scale = Math.min(1, 3200 / Math.max(width, height));
    const canvas = photo.current!;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, canvas.width, canvas.height);
    setPhotoSize({ width: canvas.width, height: canvas.height }); onDirty(true); stopCamera(); resetBoxes(); setMessage('');
  }
  function rotatePhoto() {
    const canvas = photo.current!;
    const rotated = document.createElement('canvas');
    rotated.width = canvas.height;
    rotated.height = canvas.width;
    const context = rotated.getContext('2d')!;
    context.translate(rotated.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(canvas, 0, 0);
    canvas.width = rotated.width;
    canvas.height = rotated.height;
    canvas.getContext('2d')!.drawImage(rotated, 0, 0);
    rotated.width = rotated.height = 0;
    setPhotoSize({ width: canvas.width, height: canvas.height });
    resetBoxes(); setMessage('');
  }
  async function readFile(file?: File) {
    if (!file) return;
    const ticket = ++generation.current;
    if (file.size > 15 * 1024 * 1024) { setMessage('15MB以下の写真を選んでください。'); return; }
    stopCamera();
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (ticket !== generation.current) return;
      if (img.naturalWidth * img.naturalHeight > 24_000_000) throw Error('24MP以下の写真を選んでください。');
      installPhoto(img, img.naturalWidth, img.naturalHeight);
    } catch (err) { if (ticket === generation.current) setMessage(err instanceof Error && err.message.startsWith('24MP') ? err.message : '写真を開けませんでした。JPEGまたはPNGの写真を選んでください。'); }
    finally { URL.revokeObjectURL(url); }
  }
  function resetBoxes() { setBoxes([]); setTarget(null); setCorner(null); setOutline(null); setFailed(false); down.current = null; }
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect(), canvas = photo.current!;
    return { x: canvas.width * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: canvas.height * Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function finishBox(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || !down.current || busy) return;
    const start = down.current, end = point(event); down.current = null;
    setOutline(null);
    const touch = event.pointerType === 'touch';
    const tap = Math.hypot(start.x - end.x, start.y - end.y) * event.currentTarget.getBoundingClientRect().width / photo.current!.width < (touch ? 9 : 5);
    if (touch && !tap) return;
    if (tap && !corner) { setCorner(start); return; }
    const first = tap ? corner! : start;
    setCorner(null);
    const box = { id: 'manual', x: Math.min(first.x, end.x), y: Math.min(first.y, end.y), width: Math.abs(first.x - end.x), height: Math.abs(first.y - end.y) };
    try {
      if (Math.min(box.width, box.height) < 20) throw Error('枠が小さすぎます。もう一度囲んでください。');
      if (target === null) setBoxes(splitGrid.current!(box, layout[0], layout[1], count).map((b, i) => ({ ...b, id: 'card-' + i })));
      else setBoxes(previous => previous.map((b, i) => i === target ? { ...box, id: b.id } : b));
      setTarget(null); setMessage('');
    } catch (err) { setMessage((err as Error).message); }
  }
  async function recognize() {
    if (locked.current || boxes.length !== count) return;
    locked.current = true; setBusy(true); setFailed(false); setMessage('照合を準備しています。');
    const ticket = ++generation.current;
    const start = performance.now();
    try {
      const { engine, setupMs } = await session.prepare(status => { if (generation.current === ticket) setMessage(status); });
      if (generation.current !== ticket) return;
      const ready = performance.now();
      const data = await engine.recognizeRegions(photo.current!, boxes);
      const matched = performance.now();
      if (generation.current !== ticket) return;
      const rows = data.regions.map((r, i) => ({
        number: i + 1, thumb: thumbnail(photo.current!, r.region), options: r.candidates.map(c => c.cardId),
        id: r.candidates.length === 1 && r.candidates[0].evidence !== 'visual_fallback' ? r.candidates[0].cardId : '', qty: 1, excluded: false,
      }));
      const backends = [...new Set(data.regions.map(r => r.diagnostics?.matchBackend || 'unknown'))];
      onResults(rows, { setupMs, waitMs: ready-start, matchMs: matched-ready, elapsedMs: performance.now()-start, phases: data.timingsMs, backends });
    } catch (err) { if (ticket === generation.current) { setFailed(true); setMessage('照合できませんでした。' + (err as Error).message); } }
    finally { if (ticket === generation.current) { session.clearProgress(); locked.current = false; setBusy(false); } }
  }
  async function cancel() {
    ++generation.current; await session.reset();
    locked.current = false; setBusy(false); setMessage('照合を中止しました。枠はそのまま使えます。');
  }
  return <>
    <fieldset hidden={preview} disabled={busy}><legend>カードの並べ方</legend><div className="cam-line">
      <label>撮る枚数<select value={count} onChange={e => { onArrangement({ count: +e.target.value, index: 0 }); resetBoxes(); }}>{Array.from({ length: 20 }, (_, i) => <option key={i} value={i + 1}>{i + 1}枚</option>)}</select></label>
      <label>並べ方<select disabled={!layouts[count]} value={index} onChange={e => { onArrangement({ count, index: +e.target.value }); resetBoxes(); }}>{layouts[count]?.map(([cols, rows], i) => <option key={i} value={i}>横{cols}枚 × 縦{rows}段</option>)}</select></label>
    </div></fieldset>
    <div className="cam-line" hidden={preview}>{window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? <button type="button" disabled={busy} onClick={openCamera}>カメラで撮る</button>
      : <label className="cam-file">カメラで撮る<input aria-label="カメラで撮る" type="file" accept="image/*" capture="environment" disabled={busy} onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>}
      <label className="cam-file">保存した写真を選ぶ<input type="file" accept="image/*" disabled={busy} onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
    <section className="cam-viewfinder" hidden={!preview} aria-label="撮影プレビュー">
      <video ref={video} playsInline muted className="cam-video" />
      <div className="cam-shutter"><button className="cam-primary" onClick={() => { const v = video.current!; if (v.videoWidth) installPhoto(v, v.videoWidth, v.videoHeight); }}>この写真を使う</button><button onClick={stopCamera}>カメラを閉じる</button></div>
    </section>
    <div hidden={!photoSize || preview}>
      <p>{target !== null ? (target + 1) + '番のカードの左上と右下を順に選んでください。' : boxes.length ? '枠を確認してください。直すときは下の番号を選びます。' : 'カード全体の左上と右下を順に選んでください。'}</p>
      <div className="cam-photo"><canvas ref={photo} /><svg role="img" aria-label="カードの範囲" viewBox={'0 0 ' + (photoSize?.width || 300) + ' ' + (photoSize?.height || 150)} preserveAspectRatio="none"
        onPointerDown={e => { if (e.isPrimary && !busy && (!boxes.length || target !== null)) { down.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); } }}
        onPointerMove={e => { if (e.isPrimary && e.pointerType !== 'touch' && down.current) setOutline({ start: corner || down.current, end: point(e) }); }}
        onPointerCancel={() => { down.current = null; setOutline(null); }} onPointerUp={finishBox}>
        {boxes.map((b, i) => <g key={b.id}><rect x={b.x} y={b.y} width={b.width} height={b.height} className={target === i ? 'active' : ''}/><text x={b.x + b.width * .04} y={b.y + b.height * .18} fontSize={Math.max(14, Math.min(b.width, b.height) * .16)}>{i + 1}</text></g>)}
        {outline && <rect className="active" x={Math.min(outline.start.x, outline.end.x)} y={Math.min(outline.start.y, outline.end.y)} width={Math.abs(outline.start.x - outline.end.x)} height={Math.abs(outline.start.y - outline.end.y)}/>}
        {corner && <circle cx={corner.x} cy={corner.y} r={Math.max(5, (photo.current?.width || 0) / 100)} fill="#fc566e"/>}
      </svg></div>
      {!boxes.length && <button className="cam-rotate" type="button" disabled={busy} onClick={rotatePhoto}>写真を右に90°回転</button>}
      {boxes.length > 0 && <div className="cam-line cam-targets">{boxes.map((b, i) => <button key={b.id} disabled={busy} aria-pressed={target === i} aria-label={(i + 1) + '番の枠を直す'} onClick={() => { setTarget(i); setCorner(null); }}>{i + 1}</button>)}<button disabled={busy} onClick={resetBoxes}>全体を囲み直す</button></div>}
      {boxes.length === count && !busy && <button className="cam-primary" onClick={recognize}>{count}枚を照合</button>}
    </div>
    <p role="status">{message}</p>{busy && <button onClick={cancel}>照合を中止</button>}
    {failed && !busy && boxes.length === count && <button onClick={() => onResults(boxes.map((b, i) => ({ number: i + 1, thumb: thumbnail(photo.current!, b), options: [], id: '', qty: 1, excluded: false })))}>この写真のカードを手動で探す</button>}
  </>;
}
