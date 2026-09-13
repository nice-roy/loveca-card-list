import { useEffect, useMemo, useState } from 'react';
import './mobile-ui-mock.css';

type Variant = 'a' | 'b' | 'c';
type Sheet = 'search' | 'filter' | 'sort' | null;
type MockCard = { type: 'メンバー' | 'ライブ'; group: string; name: string; number: string; metric: string; hearts: string; blade: string; product: string };

const mockCards: MockCard[] = [
  { type: 'メンバー', group: 'Liella!', name: '澁谷かのん', number: 'PL!SP-bp6-001-R', metric: 'COST 4', hearts: 'ピンク ♥×2', blade: 'ブレード：紫 ◆×1', product: 'ブースターパック vol.6' },
  { type: 'ライブ', group: 'Liella!', name: 'Step! ZERO to ONE', number: 'PL!S-bp6-019-L', metric: 'SCORE 5', hearts: 'ピンク ♥×3', blade: 'ブレード：青 ◆×1', product: 'ブースターパック vol.6' },
  { type: 'メンバー', group: 'Aqours', name: '高海千歌', number: 'PL!A-bp5-003-R', metric: 'COST 3', hearts: 'オレンジ ♥×2', blade: 'ブレード：赤 ◆×1', product: 'ブースターパック vol.5' },
  { type: 'ライブ', group: 'Aqours', name: 'Live with a smile!', number: 'LL-bp5-001-L', metric: 'SCORE 6', hearts: '青 ♥×2', blade: 'ブレード：ALL ◆×1', product: 'ブースターパック vol.5' },
  { type: 'メンバー', group: "μ's", name: '高坂穂乃果', number: 'PL!-bp4-002-R', metric: 'COST 4', hearts: 'オレンジ ♥×3', blade: 'ブレード：黄 ◆×1', product: 'ブースターパック vol.4' },
  { type: 'ライブ', group: '虹ヶ咲', name: 'ダイヤモンドプリンセスの憂鬱', number: 'PL!-bp4-026-L', metric: 'SCORE 4', hearts: '緑 ♥×2', blade: 'ブレード：緑 ◆×1', product: 'ブースターパック vol.4' },
  { type: 'メンバー', group: '虹ヶ咲', name: '優木せつ菜', number: 'PL!N-bp7-008-R', metric: 'COST 5', hearts: '赤 ♥×2', blade: 'ブレード：赤 ◆×2', product: 'ブースターパック vol.7' },
  { type: 'ライブ', group: '蓮ノ空', name: '全方位キュン♡', number: 'PL!HS-pb1-029-L', metric: 'SCORE 5', hearts: '紫 ♥×2', blade: 'ブレード：紫 ◆×1', product: 'プレミアムブースター' },
  { type: 'メンバー', group: '蓮ノ空', name: '日野下花帆', number: 'PL!HS-bp3-004-R', metric: 'COST 2', hearts: 'ピンク ♥×2', blade: 'ブレード：ピンク ◆×1', product: 'ブースターパック vol.3' },
  { type: 'ライブ', group: 'Liella!', name: '私のSymphony', number: 'PL!SP-sd1-026-SRL', metric: 'SCORE 7', hearts: 'ピンク ♥×3', blade: 'ブレード：ALL ◆×1', product: 'スタートデッキ' },
  { type: 'メンバー', group: 'Aqours', name: '桜内梨子', number: 'PL!A-bp2-006-R', metric: 'COST 3', hearts: '青 ♥×2', blade: 'ブレード：青 ◆×1', product: 'ブースターパック vol.2' },
  { type: 'ライブ', group: "μ's", name: '愛♡スクリ〜ム！', number: 'LL-PR-004-PR', metric: 'SCORE 6', hearts: '黄 ♥×2', blade: 'ブレード：ALL ◆×1', product: 'プロモーションカード' },
];

const variants: Record<Variant, { title: string; subtitle: string }> = {
  a: { title: 'A案：極薄sticky操作バー', subtitle: '常時残すのは1行だけ。押した項目だけ上に開く。' },
  b: { title: 'B案：スクロールで自動コンパクト化', subtitle: '最初は展開、閲覧中だけ1行に縮む。' },
  c: { title: 'C案：極薄3ボタン＋ボトムシート', subtitle: '普段は最小。詳細操作は下から出す。' },
};

function route(variant?: Variant) {
  return variant ? `/mobile-ui-mock?variant=${variant}` : '/mobile-ui-mock';
}

function MockCardView({ card }: { card: MockCard }) {
  return <article className={`mock-card ${card.type === 'ライブ' ? 'live' : ''}`}>
    <div className="mock-card-top"><span className="mock-type">{card.type}</span><span>{card.group}</span></div>
    <div className="mock-card-heading"><div><h2>{card.name}</h2><code>{card.number}</code></div><strong>{card.metric}</strong></div>
    <dl><div><dt>基本ハート</dt><dd>{card.hearts}</dd></div><div><dt>ブレード</dt><dd>{card.blade}</dd></div><div><dt>収録商品</dt><dd>{card.product}</dd></div></dl>
    <div className="mock-card-links"><button type="button">↗ 公式カード情報</button><button type="button">↗ Card Labo購入</button></div>
  </article>;
}

function Home() {
  return <main className="mock-home">
    <p className="mock-kicker">iPhone SE2 / Safari 比較専用</p>
    <h1>スマホUI<br /><em>比較モック</em></h1>
    <p>実際にスクロール・検索・絞り込み・並び順変更を試して、カードを見る面積と操作の邪魔さを比べてください。</p>
    <div className="mock-choice-list">
      {(Object.entries(variants) as [Variant, typeof variants.a][]).map(([key, item]) => <a href={route(key)} key={key}><strong>{item.title}</strong><span>{item.subtitle}</span><b>試す →</b></a>)}
    </div>
    <small>このページは比較専用です。Productionのカード一覧・データ・同期には影響しません。</small>
  </main>;
}

function CompactBar({ onOpen, active, className = '' }: { onOpen: (sheet: Exclude<Sheet, null>) => void; active: Sheet; className?: string }) {
  return <div className={`mock-compact-bar ${className}`} aria-label="カード操作">
    <button className={active === 'search' ? 'active' : ''} onClick={() => onOpen('search')} type="button">⌕ <span>検索</span></button>
    <button className={active === 'filter' ? 'active' : ''} onClick={() => onOpen('filter')} type="button">☷ <span>絞り込み</span></button>
    <button className={active === 'sort' ? 'active' : ''} onClick={() => onOpen('sort')} type="button">↕ <span>並び順</span></button>
  </div>;
}

function InlinePanel({ sheet, search, setSearch, type, setType, sort, setSort, onClose }: { sheet: Exclude<Sheet, null>; search: string; setSearch: (value: string) => void; type: string; setType: (value: string) => void; sort: string; setSort: (value: string) => void; onClose: () => void }) {
  return <div className="mock-inline-panel" aria-label={`${sheet}のパネル`}>
    <div><strong>{sheet === 'search' ? 'カードを探す' : sheet === 'filter' ? '絞り込み' : '並び順'}</strong><button aria-label="パネルを閉じる" onClick={onClose} type="button">×</button></div>
    {sheet === 'search' && <input autoFocus aria-label="カード検索" placeholder="カード名・番号で検索" value={search} onChange={(event) => setSearch(event.target.value)} />}
    {sheet === 'filter' && <div className="mock-segment"><button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')} type="button">すべて</button><button className={type === 'メンバー' ? 'active' : ''} onClick={() => setType('メンバー')} type="button">メンバー</button><button className={type === 'ライブ' ? 'active' : ''} onClick={() => setType('ライブ')} type="button">ライブ</button></div>}
    {sheet === 'sort' && <select aria-label="並び順" value={sort} onChange={(event) => setSort(event.target.value)}><option value="number">カード番号順</option><option value="name">名前順</option><option value="metric">COST / SCORE順</option></select>}
  </div>;
}

function BottomSheet({ sheet, close, search, setSearch, draftType, setDraftType, draftGroup, setDraftGroup, sort, setSort, applyFilter, resetFilter }: { sheet: Exclude<Sheet, null>; close: () => void; search: string; setSearch: (value: string) => void; draftType: string; setDraftType: (value: string) => void; draftGroup: string; setDraftGroup: (value: string) => void; sort: string; setSort: (value: string) => void; applyFilter: () => void; resetFilter: () => void }) {
  return <div className="mock-sheet-layer" role="presentation" onMouseDown={close}>
    <section className="mock-bottom-sheet" onMouseDown={(event) => event.stopPropagation()} aria-label={`${sheet}シート`}>
      <div className="mock-sheet-grab" /><header><div><small>カード一覧</small><h2>{sheet === 'search' ? '検索' : sheet === 'filter' ? '絞り込み' : '並び順'}</h2></div><button aria-label="シートを閉じる" onClick={close} type="button">×</button></header>
      {sheet === 'search' && <input autoFocus aria-label="カード検索" placeholder="カード名・番号で検索" value={search} onChange={(event) => setSearch(event.target.value)} />}
      {sheet === 'filter' && <div className="mock-filter-sheet"><fieldset><legend>カード種別</legend><div className="mock-segment"><button className={draftType === 'all' ? 'active' : ''} onClick={() => setDraftType('all')} type="button">すべて</button><button className={draftType === 'メンバー' ? 'active' : ''} onClick={() => setDraftType('メンバー')} type="button">メンバー</button><button className={draftType === 'ライブ' ? 'active' : ''} onClick={() => setDraftType('ライブ')} type="button">ライブ</button></div></fieldset><fieldset><legend>グループ</legend><div className="mock-chip-list">{['all', 'Liella!', 'Aqours', "μ's", '虹ヶ咲', '蓮ノ空'].map(group => <button className={draftGroup === group ? 'active' : ''} onClick={() => setDraftGroup(group)} type="button" key={group}>{group === 'all' ? 'すべて' : group}</button>)}</div></fieldset><fieldset><legend>追加条件（操作感確認用）</legend><div className="mock-disabled-options"><button type="button">コスト</button><button type="button">基本ハート</button><button type="button">ブレード</button><button type="button">収録商品</button></div></fieldset><footer><button onClick={resetFilter} type="button">リセット</button><button className="primary" onClick={applyFilter} type="button">適用</button></footer></div>}
      {sheet === 'sort' && <div className="mock-sort-options">{[['number','カード番号順'],['name','名前順'],['metric','COST / SCORE順']].map(([value,label]) => <label key={value}><input checked={sort === value} name="sort" onChange={() => setSort(value)} type="radio" value={value} />{label}</label>)}</div>}
    </section>
  </div>;
}

function VariantPage({ variant }: { variant: Variant }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [group, setGroup] = useState('all');
  const [draftType, setDraftType] = useState('all');
  const [draftGroup, setDraftGroup] = useState('all');
  const [sort, setSort] = useState('number');
  const [compact, setCompact] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);

  useEffect(() => {
    if (variant !== 'b') return;
    const update = () => setCompact(window.scrollY > 150);
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [variant]);

  const open = (next: Exclude<Sheet, null>) => setSheet(current => current === next && variant !== 'c' ? null : next);
  const visibleCards = useMemo(() => [...mockCards, ...mockCards, ...mockCards].filter(card => (type === 'all' || card.type === type) && (group === 'all' || card.group === group) && `${card.name} ${card.number}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name, 'ja') : sort === 'metric' ? a.metric.localeCompare(b.metric, 'ja', { numeric: true }) : a.number.localeCompare(b.number, 'ja', { numeric: true })), [group, search, sort, type]);
  const applyFilter = () => { setType(draftType); setGroup(draftGroup); setSheet(null); };
  const resetFilter = () => { setDraftType('all'); setDraftGroup('all'); setType('all'); setGroup('all'); };
  const activeSheet = sheet;

  return <main className={`mobile-mock variant-${variant}`}>
    <header className="mock-brand"><a href={route()}>← 比較トップ</a><p>ラブカ</p><strong>ALL CARD LIST</strong><span>{variants[variant].title}</span></header>
    {variant === 'b' ? <div className={`mock-b-controls ${compact ? 'compact' : 'expanded'}`}><div className="mock-b-expanded"><label>⌕ 検索<input aria-label="カード検索" placeholder="カード名・番号" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="mock-b-row"><button onClick={() => open('filter')} type="button">☷ 絞り込み</button><button onClick={() => open('sort')} type="button">↕ 並び順</button></div></div><CompactBar active={activeSheet} className="mock-b-compact" onOpen={open} /></div> : <div className="mock-sticky-controls"><CompactBar active={activeSheet} onOpen={open} />{variant === 'a' && sheet && <InlinePanel onClose={() => setSheet(null)} search={search} setSearch={setSearch} sheet={sheet} setSort={setSort} setType={setType} sort={sort} type={type} />}</div>}
    {variant === 'b' && sheet && <div className="mock-b-inline"><InlinePanel onClose={() => setSheet(null)} search={search} setSearch={setSearch} sheet={sheet} setSort={setSort} setType={setType} sort={sort} type={type} /></div>}
    <section className="mock-list-heading"><p>{variants[variant].subtitle}</p><strong>{visibleCards.length}枚</strong></section>
    <section className="mock-card-list">{visibleCards.map((card,index) => <><MockCardView card={card} key={`${card.number}-${index}`} />{index === 5 && <aside className="mock-inline-ad" key="ad">インライン広告枠<br /><small>固定しない比較用表示</small></aside>}</>)}</section>
    <button className="mock-deck-fab" onClick={() => setDeckOpen(true)} type="button">▣ <span>デッキ</span><b>4</b></button>
    {deckOpen && <div className="mock-deck-popover" role="dialog"><strong>デッキ 4</strong><span>コンパクトFABの位置確認用です。</span><button onClick={() => setDeckOpen(false)} type="button">閉じる</button></div>}
    {variant === 'c' && sheet && <BottomSheet applyFilter={applyFilter} close={() => setSheet(null)} draftGroup={draftGroup} draftType={draftType} resetFilter={resetFilter} search={search} setDraftGroup={setDraftGroup} setDraftType={setDraftType} setSearch={setSearch} setSort={setSort} sheet={sheet} sort={sort} />}
  </main>;
}

export default function MobileUiMock() {
  const value = new URLSearchParams(window.location.search).get('variant');
  return value === 'a' || value === 'b' || value === 'c' ? <VariantPage variant={value} /> : <Home />;
}
