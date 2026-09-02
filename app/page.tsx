'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown, ExternalLink, Layers3, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import cardsJson from './data/cards.json';
import referencesJson from './data/reference-data.json';
import type { Card, ReferenceData, SortKey } from './data/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const cards = cardsJson as Card[];
const references = referencesJson as ReferenceData;
const PAGE_SIZE = 48;
const DEFAULT_SORT: SortKey = 'cardNumberAsc';
const commonSortOptions: { value: SortKey; label: string }[] = [
  { value: 'cardNumberAsc', label: 'カード番号：昇順' },
  { value: 'cardNumberDesc', label: 'カード番号：降順' },
  { value: 'nameAsc', label: 'カード名：昇順' },
  { value: 'nameDesc', label: 'カード名：降順' },
  { value: 'productAsc', label: '収録商品：昇順' },
];
const memberSortOptions: { value: SortKey; label: string }[] = [
  { value: 'costAsc', label: 'コスト：低い順' },
  { value: 'costDesc', label: 'コスト：高い順' },
];
const liveSortOptions: { value: SortKey; label: string }[] = [
  { value: 'scoreAsc', label: 'スコア：低い順' },
  { value: 'scoreDesc', label: 'スコア：高い順' },
];
const colorClass: Record<string, string> = { pink: 'heart-pink', red: 'heart-red', yellow: 'heart-yellow', green: 'heart-green', blue: 'heart-blue', purple: 'heart-purple', any: 'heart-any' };

function compareNullable(left: string | number | null, right: string | number | null, direction: 'asc' | 'desc' = 'asc') {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'ja', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function Hearts({ values, blade = false }: { values: { color: string | null; count: number }[]; blade?: boolean }) {
  if (!values.length) return <span className="muted-dash">—</span>;
  return <span className="heart-list">{values.map((value, index) => (
    <span className="heart-value" key={`${value.color}-${index}`}>
      <span aria-hidden="true" className={`${blade ? 'blade-heart' : 'heart'} ${colorClass[value.color ?? 'any']}`}>{blade ? '◆' : value.color === 'any' ? '◇' : '♥'}</span>
      <strong>{value.count}</strong>
    </span>
  ))}</span>;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('all');
  const [memberId, setMemberId] = useState('all');
  const [cardType, setCardType] = useState('all');
  const [productId, setProductId] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const memberById = useMemo(() => new Map(references.members.map((item) => [item.id, item.label])), []);
  const productById = useMemo(() => new Map(references.products.map((item) => [item.id, item.label])), []);
  const sortOptions = cardType === 'member'
    ? [...commonSortOptions, ...memberSortOptions]
    : cardType === 'live'
      ? [...commonSortOptions, ...liveSortOptions]
      : commonSortOptions;

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja');
    return cards
      .filter((card) => groupId === 'all' || card.groupIds.includes(groupId))
      .filter((card) => memberId === 'all' || card.memberIds.includes(memberId))
      .filter((card) => cardType === 'all' || card.cardType === cardType)
      .filter((card) => productId === 'all' || card.productId === productId)
      .filter((card) => !needle || [card.name, card.cardNumber, card.effectText ?? '', productById.get(card.productId) ?? '', ...card.memberIds.map((id) => memberById.get(id) ?? '')].join(' ').toLocaleLowerCase('ja').includes(needle))
      .sort((left, right) => {
        let result = 0;
        if (sortKey === 'cardNumberAsc') result = compareNullable(left.cardNumber, right.cardNumber);
        if (sortKey === 'cardNumberDesc') result = compareNullable(left.cardNumber, right.cardNumber, 'desc');
        if (sortKey === 'nameAsc') result = compareNullable(left.name, right.name);
        if (sortKey === 'nameDesc') result = compareNullable(left.name, right.name, 'desc');
        if (sortKey === 'productAsc') result = compareNullable(productById.get(left.productId) ?? null, productById.get(right.productId) ?? null);
        if (sortKey === 'costAsc') result = compareNullable(left.member?.cost ?? null, right.member?.cost ?? null);
        if (sortKey === 'costDesc') result = compareNullable(left.member?.cost ?? null, right.member?.cost ?? null, 'desc');
        if (sortKey === 'scoreAsc') result = compareNullable(left.live?.score ?? null, right.live?.score ?? null);
        if (sortKey === 'scoreDesc') result = compareNullable(left.live?.score ?? null, right.live?.score ?? null, 'desc');
        return result || compareNullable(left.cardNumber, right.cardNumber);
      });
  }, [cardType, groupId, memberById, memberId, productById, productId, query, sortKey]);

  const resetFilters = () => {
    setQuery(''); setGroupId('all'); setMemberId('all'); setCardType('all'); setProductId('all'); setSortKey(DEFAULT_SORT); setVisibleCount(PAGE_SIZE);
  };
  const changeCardType = (nextCardType: string) => {
    const nextSortOptions = nextCardType === 'member'
      ? [...commonSortOptions, ...memberSortOptions]
      : nextCardType === 'live'
        ? [...commonSortOptions, ...liveSortOptions]
        : commonSortOptions;
    setCardType(nextCardType);
    if (!nextSortOptions.some((option) => option.value === sortKey)) setSortKey(DEFAULT_SORT);
    setVisibleCount(PAGE_SIZE);
  };
  const hasFilters = Boolean(query || groupId !== 'all' || memberId !== 'all' || cardType !== 'all' || productId !== 'all');

  return <main>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#top" aria-label="ラブカ 全カードリスト トップ"><span className="brand-mark" aria-hidden="true"><Layers3 /></span><span><strong>ラブカ</strong><small>ALL CARD LIST</small></span></a>
      <p className="scope-note">メンバー＋ライブカード</p>
    </div></header>

    <section className="intro" id="top"><div>
      <p className="eyebrow"><Sparkles /> LOVE LIVE! OFFICIAL CARD GAME</p>
      <h1>すべての出会いを、<br /><em>ひとつのカードリストに。</em></h1>
      <p className="intro-copy">グループを横断して、カード番号・名前・効果からすばやく探せます。現在はLiella!の483枚を収録しています。</p>
    </div><div className="total-card" aria-label="登録カード総数"><small>CARDS IN MASTER</small><strong>{cards.length}</strong><span>メンバー 399 · ライブ 84</span></div></section>

    <section className="workspace" aria-label="カード検索">
      <nav className="group-switcher" aria-label="グループを切り替え">
        <button className={groupId === 'all' ? 'active' : ''} onClick={() => { setGroupId('all'); setVisibleCount(PAGE_SIZE); }}>すべて <span>{cards.length}</span></button>
        {references.groups.map((group) => {
          const count = cards.filter((card) => card.groupIds.includes(group.id)).length;
          return <button className={groupId === group.id ? 'active' : ''} disabled={!group.enabled} key={group.id} onClick={() => { setGroupId(group.id); setVisibleCount(PAGE_SIZE); }} title={group.enabled ? `${group.label}だけ表示` : '第2段階以降で追加予定'}>{group.label} <span>{count || '準備中'}</span></button>;
        })}
      </nav>

      <div className="filter-panel">
        <div className="search-wrap"><Search aria-hidden="true" /><Input aria-label="カード名、カード番号、効果テキストで検索" className="search-input" onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="カード名・カード番号・効果から検索" type="search" value={query} />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="検索語を消去"><X /></button>}</div>
        <div className="select-grid">
          <label><span>メンバー</span><NativeSelect className="select-control" value={memberId} onChange={(event) => { setMemberId(event.target.value); setVisibleCount(PAGE_SIZE); }}><NativeSelectOption value="all">すべてのメンバー</NativeSelectOption>{references.members.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.label}</NativeSelectOption>)}</NativeSelect></label>
          <label><span>カード種類</span><NativeSelect className="select-control" value={cardType} onChange={(event) => changeCardType(event.target.value)}><NativeSelectOption value="all">すべて</NativeSelectOption><NativeSelectOption value="member">メンバー</NativeSelectOption><NativeSelectOption value="live">ライブ</NativeSelectOption></NativeSelect></label>
          <label><span>収録商品</span><NativeSelect className="select-control" value={productId} onChange={(event) => { setProductId(event.target.value); setVisibleCount(PAGE_SIZE); }}><NativeSelectOption value="all">すべての商品</NativeSelectOption>{references.products.map((product) => <NativeSelectOption key={product.id} value={product.id}>{product.label}</NativeSelectOption>)}</NativeSelect></label>
          <label><span><ArrowUpDown /> 並び順</span><NativeSelect className="select-control" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>{sortOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></label>
        </div>
      </div>

      <div className="result-bar" aria-live="polite"><div><SlidersHorizontal aria-hidden="true" /><strong>{filteredCards.length}</strong><span>枚が見つかりました</span></div>{hasFilters && <Button variant="ghost" onClick={resetFilters}><X /> 条件をクリア</Button>}</div>
      {filteredCards.length ? <div className="card-grid">{filteredCards.slice(0, visibleCount).map((card) => <article className={`card-item ${card.cardType}`} key={card.id}>
        <div className="card-body"><Badge className="type-badge" variant="secondary">{card.cardType === 'member' ? 'MEMBER' : 'LIVE'}</Badge><div className="card-heading"><div><h2>{card.name}</h2><code>{card.cardNumber}</code></div>{card.member && <span className="metric"><small>COST</small>{card.member.cost ?? '—'}</span>}{card.live && <span className="metric score"><small>SCORE</small>{card.live.score ?? '—'}</span>}</div>
          <p className="product-name">{productById.get(card.productId)}</p><dl className="stats">{card.member && <><div><dt>ハート</dt><dd><Hearts values={card.member.hearts} /></dd></div><div><dt>ブレード</dt><dd><Hearts blade values={card.member.bladeHearts} /></dd></div><div><dt>エール</dt><dd>{card.member.yell.count ?? '—'}</dd></div></>}{card.live && <div><dt>必要ハート</dt><dd><Hearts values={card.live.requiredHearts} /></dd></div>}</dl>
          {card.effectText && <p className="effect-text">{card.effectText}</p>}{card.officialUrl && <a className="official-link" href={card.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}
        </div></article>)}</div> : <div className="empty-state"><Search /><h2>該当するカードがありません</h2><p>検索語や絞り込み条件を変更してください。</p><Button onClick={resetFilters}>条件をクリア</Button></div>}
      {visibleCount < filteredCards.length && <div className="load-more"><Button size="lg" variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>さらに表示 <span>{Math.min(PAGE_SIZE, filteredCards.length - visibleCount)}枚</span></Button></div>}
    </section>
    <footer><p>非公式ファンメイドカードリスト · エネルギーカードは収録対象外です</p><p>未登録のレアリティは、確認済み情報のみ順次追加します。</p></footer>
  </main>;
}
