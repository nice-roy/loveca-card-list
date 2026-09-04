'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ExternalLink, Layers3, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import cardsJson from './data/cards.json';
import referencesJson from './data/reference-data.json';
import type { Card, ReferenceData, SortKey } from './data/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matchesNumericFilter, numericOptions, retainAvailableIds } from '@/lib/numeric-filters';

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

function getProductIdsForGroup(selectedGroupId: string) {
  return new Set(cards
    .filter((card) => selectedGroupId === 'all' || card.groupIds.includes(selectedGroupId))
    .map((card) => card.productId));
}

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

function MultiSelect({
  id,
  label,
  emptyLabel,
  options,
  selectedIds,
  onChange,
  className = '',
}: {
  id: string;
  label: string;
  emptyLabel: string;
  options: { id: string; label: string }[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  className?: string;
}) {
  const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
  const summary = selectedOptions.length === 0
    ? emptyLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length}件選択中`;
  const toggle = (optionId: string) => {
    onChange(selectedIds.includes(optionId)
      ? selectedIds.filter((selectedId) => selectedId !== optionId)
      : [...selectedIds, optionId]);
  };

  return <div className={`filter-field multi-select-field ${className}`}>
    <span className="filter-label" id={`${id}-label`}>{label}</span>
    <Popover>
      <PopoverTrigger aria-labelledby={`${id}-label ${id}-summary`} className="multi-select-trigger">
        <span id={`${id}-summary`}>{summary}</span><ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="multi-select-menu">
        <div className="multi-select-header"><span>複数選択できます</span><button disabled={!selectedIds.length} onClick={() => onChange([])} type="button">すべて解除</button></div>
        <div className="multi-select-options" role="group" aria-labelledby={`${id}-label`}>
          {options.map((option) => <label className="multi-select-option" key={option.id}>
            <input checked={selectedIds.includes(option.id)} onChange={() => toggle(option.id)} type="checkbox" />
            <span>{option.label}</span>
          </label>)}
        </div>
      </PopoverContent>
    </Popover>
    {selectedOptions.length > 0 && <div className="selected-chips" aria-label={`${label}の選択中条件`}>
      <button className="filter-chip clear-all-chip" onClick={() => onChange([])} type="button">すべて解除</button>
      {selectedOptions.map((option) => <button aria-label={`${option.label}を解除`} className="filter-chip" key={option.id} onClick={() => toggle(option.id)} type="button"><span>{option.label}</span><X aria-hidden="true" /></button>)}
    </div>}
  </div>;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('all');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [cardType, setCardType] = useState('all');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [costIds, setCostIds] = useState<string[]>([]);
  const [scoreIds, setScoreIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const memberById = useMemo(() => new Map(references.members.map((item) => [item.id, item.label])), []);
  const productById = useMemo(() => new Map(references.products.map((item) => [item.id, item.label])), []);
  const selectedMemberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const selectedProductIdSet = useMemo(() => new Set(productIds), [productIds]);
  const availableMembers = useMemo(() => groupId === 'all'
    ? references.members
    : references.members.filter((member) => member.groupId === groupId), [groupId]);
  const availableProducts = useMemo(() => {
    const availableProductIds = getProductIdsForGroup(groupId);
    return references.products.filter((product) => availableProductIds.has(product.id));
  }, [groupId]);
  const availableCosts = useMemo(() => numericOptions(cards, groupId, 'cost'), [groupId]);
  const availableScores = useMemo(() => numericOptions(cards, groupId, 'score'), [groupId]);
  const memberTotal = useMemo(() => cards.filter((card) => card.cardType === 'member').length, []);
  const liveTotal = useMemo(() => cards.filter((card) => card.cardType === 'live').length, []);
  const enabledGroupLabels = useMemo(() => references.groups.filter((group) => group.enabled).map((group) => group.label), []);
  const sortOptions = cardType === 'member'
    ? [...commonSortOptions, ...memberSortOptions]
    : cardType === 'live'
      ? [...commonSortOptions, ...liveSortOptions]
      : commonSortOptions;

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja');
    return cards
      .filter((card) => groupId === 'all' || card.groupIds.includes(groupId))
      .filter((card) => selectedMemberIdSet.size === 0 || card.memberIds.some((id) => selectedMemberIdSet.has(id)))
      .filter((card) => cardType === 'all' || card.cardType === cardType)
      .filter((card) => cardType !== 'member' || matchesNumericFilter(card, 'cost', costIds))
      .filter((card) => cardType !== 'live' || matchesNumericFilter(card, 'score', scoreIds))
      .filter((card) => selectedProductIdSet.size === 0 || selectedProductIdSet.has(card.productId))
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
  }, [cardType, costIds, scoreIds, groupId, memberById, productById, query, selectedMemberIdSet, selectedProductIdSet, sortKey]);

  const resetFilters = () => {
    setQuery(''); setGroupId('all'); setMemberIds([]); setCardType('all'); setProductIds([]); setSortKey(DEFAULT_SORT); setVisibleCount(PAGE_SIZE);
    setCostIds([]); setScoreIds([]);
  };
  const changeCardType = (nextCardType: string) => {
    const nextSortOptions = nextCardType === 'member'
      ? [...commonSortOptions, ...memberSortOptions]
      : nextCardType === 'live'
        ? [...commonSortOptions, ...liveSortOptions]
        : commonSortOptions;
    setCardType(nextCardType);
    if (nextCardType !== 'member') setCostIds([]);
    if (nextCardType !== 'live') setScoreIds([]);
    if (nextCardType === 'live') setMemberIds([]);
    if (!nextSortOptions.some((option) => option.value === sortKey)) setSortKey(DEFAULT_SORT);
    setVisibleCount(PAGE_SIZE);
  };
  const changeGroup = (nextGroupId: string) => {
    setGroupId(nextGroupId);
    setCostIds((currentIds) => retainAvailableIds(currentIds, numericOptions(cards, nextGroupId, 'cost')));
    setScoreIds((currentIds) => retainAvailableIds(currentIds, numericOptions(cards, nextGroupId, 'score')));
    const validProductIds = getProductIdsForGroup(nextGroupId);
    setProductIds((currentIds) => currentIds.filter((id) => validProductIds.has(id)));
    if (nextGroupId !== 'all') {
      const validMemberIds = new Set(references.members.filter((member) => member.groupId === nextGroupId).map((member) => member.id));
      setMemberIds((currentIds) => currentIds.filter((id) => validMemberIds.has(id)));
    }
    setVisibleCount(PAGE_SIZE);
  };
  const updateMemberIds = (nextIds: string[]) => { setMemberIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateProductIds = (nextIds: string[]) => { setProductIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateCostIds = (nextIds: string[]) => { setCostIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateScoreIds = (nextIds: string[]) => { setScoreIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const hasFilters = Boolean(query || groupId !== 'all' || memberIds.length || cardType !== 'all' || productIds.length || costIds.length || scoreIds.length);

  return <main>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#top" aria-label="ラブカ 全カードリスト トップ"><span className="brand-mark" aria-hidden="true"><Layers3 /></span><span><strong>ラブカ</strong><small>ALL CARD LIST</small></span></a>
      <p className="scope-note">メンバー＋ライブカード</p>
    </div></header>

    <section className="intro" id="top"><div>
      <p className="eyebrow"><Sparkles /> LOVE LIVE! OFFICIAL CARD GAME</p>
      <h1>すべての出会いを、<br /><em>ひとつのカードリストに。</em></h1>
      <p className="intro-copy">グループを横断して、カード番号・名前・効果からすばやく探せます。現在は{enabledGroupLabels.join('・')}の{cards.length}枚を収録しています。</p>
    </div><div className="total-card" aria-label="登録カード総数"><small>CARDS IN MASTER</small><strong>{cards.length}</strong><span>メンバー {memberTotal} · ライブ {liveTotal}</span></div></section>

    <section className="workspace" aria-label="カード検索">
      <nav className="group-switcher" aria-label="グループを切り替え">
        <button className={groupId === 'all' ? 'active' : ''} onClick={() => changeGroup('all')}>すべて <span>{cards.length}</span></button>
        {references.groups.map((group) => {
          const count = cards.filter((card) => card.groupIds.includes(group.id)).length;
          return <button className={groupId === group.id ? 'active' : ''} disabled={!group.enabled} key={group.id} onClick={() => changeGroup(group.id)} title={group.enabled ? `${group.label}だけ表示` : '今後追加予定'}>{group.label} <span>{count || '準備中'}</span></button>;
        })}
      </nav>

      <div className="filter-panel">
        <div className="search-wrap"><Search aria-hidden="true" /><Input aria-label="カード名、カード番号、効果テキストで検索" className="search-input" onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="カード名・カード番号・効果から検索" type="search" value={query} />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="検索語を消去"><X /></button>}</div>
        <div className={`select-grid${cardType === 'member' ? ' with-cost-filter' : ''}`}>
          <label className="filter-field"><span className="filter-label">カード種類</span><NativeSelect className="select-control" value={cardType} onChange={(event) => changeCardType(event.target.value)}><NativeSelectOption value="all">すべて</NativeSelectOption><NativeSelectOption value="member">メンバー</NativeSelectOption><NativeSelectOption value="live">ライブ</NativeSelectOption></NativeSelect></label>
          {cardType !== 'live' && <MultiSelect emptyLabel="すべてのメンバー" id="member-filter" label="メンバー" onChange={updateMemberIds} options={availableMembers} selectedIds={memberIds} />}
          {cardType === 'member' && <MultiSelect key="cost" emptyLabel="すべてのコスト" id="cost-filter" label="コスト" onChange={updateCostIds} options={availableCosts} selectedIds={costIds} />}
          {cardType === 'live' && <MultiSelect key="score" emptyLabel="すべてのスコア" id="score-filter" label="スコア" onChange={updateScoreIds} options={availableScores} selectedIds={scoreIds} />}
          <MultiSelect className="product-filter" emptyLabel="すべての商品" id="product-filter" label="収録商品" onChange={updateProductIds} options={availableProducts} selectedIds={productIds} />
          <label className="filter-field"><span className="filter-label"><ArrowUpDown /> 並び順</span><NativeSelect className="select-control" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>{sortOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></label>
        </div>
      </div>

      <div className="result-bar" aria-live="polite"><div><SlidersHorizontal aria-hidden="true" /><strong>{filteredCards.length}</strong><span>枚が見つかりました</span></div>{hasFilters && <Button variant="ghost" onClick={resetFilters}><X /> 条件をクリア</Button>}</div>
      {filteredCards.length ? <div className="card-grid">{filteredCards.slice(0, visibleCount).map((card) => <article className={`card-item ${card.cardType}`} key={card.id}>
        <div className="card-body"><Badge className="type-badge" variant="secondary">{card.cardType === 'member' ? 'MEMBER' : 'LIVE'}</Badge><div className="card-heading"><div><h2>{card.name}</h2><code>{card.cardNumber}</code></div>{card.member && <span className="metric"><small>COST</small>{card.member.cost ?? '—'}</span>}{card.live && <span className="metric score"><small>SCORE</small>{card.live.score ?? '—'}</span>}</div>
          <p className="product-name">{productById.get(card.productId)}</p><dl className="stats">{card.member && <><div><dt>基本ハート</dt><dd><Hearts values={card.member.hearts} /></dd></div><div><dt>ブレードハート</dt><dd><Hearts blade values={card.member.bladeHearts} /></dd></div><div><dt>ブレード</dt><dd>{card.member.yell.count ?? '—'}</dd></div></>}{card.live && <div><dt>必要ハート</dt><dd><Hearts values={card.live.requiredHearts} /></dd></div>}</dl>
          {card.effectText && <p className="effect-text">{card.effectText}</p>}<div className="card-links">{card.officialUrl && <a className="official-link" href={card.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{card.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div>
        </div></article>)}</div> : <div className="empty-state"><Search /><h2>該当するカードがありません</h2><p>検索語や絞り込み条件を変更してください。</p><Button onClick={resetFilters}>条件をクリア</Button></div>}
      {visibleCount < filteredCards.length && <div className="load-more"><Button size="lg" variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>さらに表示 <span>{Math.min(PAGE_SIZE, filteredCards.length - visibleCount)}枚</span></Button></div>}
    </section>
    <footer><p>非公式ファンメイドカードリスト · エネルギーカードは収録対象外です</p><p>未登録のレアリティは、確認済み情報のみ順次追加します。</p></footer>
  </main>;
}
