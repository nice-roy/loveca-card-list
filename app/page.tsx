'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Bot, Bookmark, Check, ChevronDown, Copy, ExternalLink, Layers3, ListPlus, Minus, Plus, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import cardsJson from './data/cards.json';
import referencesJson from './data/reference-data.json';
import type { Card, ReferenceData, SortKey } from './data/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { matchesNumericFilter, numericOptions, retainAvailableIds } from '@/lib/numeric-filters';
import { baseCardId, cardVersion, groupCardsForDisplay } from '@/lib/card-grouping';
import { BUILDER_STORAGE_KEY, MAX_DECK_QUANTITY, changeDeckQuantity, createAiConsultationText, createDeckRecipeText, groupDeckEntriesByMetric, normalizeBuilderState, removeDeckCardIfSingle, type DeckGroup, type DeckQuantities } from '@/lib/deck-builder';

const cards = cardsJson as Card[];
const references = referencesJson as ReferenceData;
const cardsByBuilderId = new Map<string, Card[]>();
for (const card of cards) {
  const id = baseCardId(card.cardNumber);
  cardsByBuilderId.set(id, [...(cardsByBuilderId.get(id) ?? []), card]);
}
const validBuilderIds = new Set(cardsByBuilderId.keys());
const PAGE_SIZE = 48;
const DEFAULT_SORT: SortKey = 'cardNumberAsc';
const commonSortOptions: { value: SortKey; label: string }[] = [
  { value: 'cardNumberAsc', label: 'カード番号：昇順' },
  { value: 'cardNumberDesc', label: 'カード番号：降順' },
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

function readBuilderState() {
  try {
    const saved = localStorage.getItem(BUILDER_STORAGE_KEY);
    return saved
      ? normalizeBuilderState(JSON.parse(saved), validBuilderIds)
      : normalizeBuilderState(null, validBuilderIds);
  } catch {
    return normalizeBuilderState(null, validBuilderIds);
  }
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy method.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.fontSize = '16px';
  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

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
  const [groupIdenticalCards, setGroupIdenticalCards] = useState(true);
  const [candidateOnly, setCandidateOnly] = useState(false);
  const [initialBuilderState] = useState(readBuilderState);
  const [candidateIds, setCandidateIds] = useState<Set<string>>(() => new Set(initialBuilderState.candidates));
  const [deck, setDeck] = useState<DeckQuantities>(initialBuilderState.deck);
  const [deckOpen, setDeckOpen] = useState(false);
  const [isDesktopDeck, setIsDesktopDeck] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'recipe' | 'ai' | 'error' | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
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
    ? [...memberSortOptions, ...commonSortOptions]
    : cardType === 'live'
      ? [...liveSortOptions, ...commonSortOptions]
      : commonSortOptions;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1180px)');
    const syncDeckMode = () => setIsDesktopDeck(mediaQuery.matches);
    syncDeckMode();
    mediaQuery.addEventListener('change', syncDeckMode);
    return () => mediaQuery.removeEventListener('change', syncDeckMode);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify({
        version: 1,
        candidates: [...candidateIds],
        deck,
      }));
    } catch {
      // The builder remains usable for the current page even if storage is unavailable.
    }
  }, [candidateIds, deck]);

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja');
    return cards
      .filter((card) => groupId === 'all' || card.groupIds.includes(groupId))
      .filter((card) => selectedMemberIdSet.size === 0 || card.memberIds.some((id) => selectedMemberIdSet.has(id)))
      .filter((card) => cardType === 'all' || card.cardType === cardType)
      .filter((card) => cardType !== 'member' || matchesNumericFilter(card, 'cost', costIds))
      .filter((card) => cardType !== 'live' || matchesNumericFilter(card, 'score', scoreIds))
      .filter((card) => selectedProductIdSet.size === 0 || selectedProductIdSet.has(card.productId))
      .filter((card) => !candidateOnly || candidateIds.has(baseCardId(card.cardNumber)))
      .filter((card) => !needle || [card.name, card.cardNumber, card.effectText ?? '', productById.get(card.productId) ?? '', ...card.memberIds.map((id) => memberById.get(id) ?? '')].join(' ').toLocaleLowerCase('ja').includes(needle))
      .sort((left, right) => {
        let result = 0;
        if (sortKey === 'cardNumberAsc') result = compareNullable(left.cardNumber, right.cardNumber);
        if (sortKey === 'cardNumberDesc') result = compareNullable(left.cardNumber, right.cardNumber, 'desc');
        if (sortKey === 'costAsc') result = compareNullable(left.member?.cost ?? null, right.member?.cost ?? null);
        if (sortKey === 'costDesc') result = compareNullable(left.member?.cost ?? null, right.member?.cost ?? null, 'desc');
        if (sortKey === 'scoreAsc') result = compareNullable(left.live?.score ?? null, right.live?.score ?? null);
        if (sortKey === 'scoreDesc') result = compareNullable(left.live?.score ?? null, right.live?.score ?? null, 'desc');
        return result || compareNullable(left.cardNumber, right.cardNumber);
      });
  }, [candidateIds, candidateOnly, cardType, costIds, scoreIds, groupId, memberById, productById, query, selectedMemberIdSet, selectedProductIdSet, sortKey]);
  const displayGroups = useMemo(() => groupIdenticalCards
    ? groupCardsForDisplay(filteredCards)
    : filteredCards.map((card) => ({ baseCardId: card.cardNumber, cards: [card], representative: card })), [filteredCards, groupIdenticalCards]);

  const resetFilters = () => {
    setQuery(''); setGroupId('all'); setMemberIds([]); setCardType('all'); setProductIds([]); setSortKey(DEFAULT_SORT); setVisibleCount(PAGE_SIZE);
    setCostIds([]); setScoreIds([]); setGroupIdenticalCards(true); setCandidateOnly(false);
  };
  const changeCardType = (nextCardType: string) => {
    setCardType(nextCardType);
    if (nextCardType !== 'member') setCostIds([]);
    if (nextCardType !== 'live') setScoreIds([]);
    if (nextCardType === 'live') setMemberIds([]);
    setSortKey(nextCardType === 'member' ? 'costAsc' : nextCardType === 'live' ? 'scoreAsc' : DEFAULT_SORT);
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
  const toggleCandidate = (id: string) => {
    setCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const updateDeck = (id: string, delta: number) => {
    setPendingRemovalId((current) => current === id ? null : current);
    setDeck((current) => changeDeckQuantity(current, id, delta));
  };
  const decreaseDeck = (id: string, quantity: number) => {
    if (quantity === 1) setPendingRemovalId(id);
    else updateDeck(id, -1);
  };
  const confirmDeckRemoval = (id: string) => {
    setDeck((current) => removeDeckCardIfSingle(current, id));
    setPendingRemovalId(null);
  };
  const deckEntries = useMemo(() => Object.entries(deck)
    .map(([id, quantity]) => ({ id, quantity, card: cardsByBuilderId.get(id)?.[0] }))
    .filter((entry): entry is { id: string; quantity: number; card: Card } => Boolean(entry.card))
    .sort((left, right) => compareNullable(left.id, right.id)), [deck]);
  const memberDeckGroups = groupDeckEntriesByMetric(deckEntries.filter((entry) => entry.card.cardType === 'member'), 'cost');
  const liveDeckGroups = groupDeckEntriesByMetric(deckEntries.filter((entry) => entry.card.cardType === 'live'), 'score');
  const deckTotal = deckEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const hasFilters = Boolean(query || groupId !== 'all' || memberIds.length || cardType !== 'all' || productIds.length || costIds.length || scoreIds.length || !groupIdenticalCards || candidateOnly);
  const copyDeckText = async (kind: 'recipe' | 'ai') => {
    const text = kind === 'recipe' ? createDeckRecipeText(deckEntries) : createAiConsultationText(deckEntries);
    const copied = await copyText(text);
    setCopyFeedback(copied ? kind : 'error');
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };

  const deckSection = (label: string, metricLabel: 'COST' | 'SCORE', groups: DeckGroup[]) => groups.length > 0 && <section className="deck-section">
    <div className="deck-section-heading"><h3>{label}<span>{groups.reduce((sum, group) => sum + group.quantity, 0)}枚</span></h3></div>
    <div className="deck-groups">{groups.map((group) => <section className="deck-group" key={`${metricLabel}-${group.value ?? 'unknown'}`}>
      <h4 className={`deck-group-heading ${metricLabel === 'SCORE' ? 'live' : ''}`}><span>{metricLabel} <strong>{group.value ?? '—'}</strong></span><em>{group.quantity}枚</em></h4>
      <div className="deck-list">{group.entries.map(({ id, quantity, card }) => {
      const versions = cardsByBuilderId.get(id) ?? [card];
      const memberName = card.memberIds.map((memberId) => memberById.get(memberId)).filter(Boolean).join('・') || card.name;
      return <article className={`deck-row ${card.cardType}`} key={id}>
      <details className="deck-card-details"><summary><div className="deck-card-heading"><strong>{card.cardType === 'member' ? memberName : card.name}</strong><code>{id}</code></div><div className="deck-key-info">{card.member && <><span className="deck-main-metric"><small>COST</small><strong>{card.member.cost ?? '—'}</strong></span><span><small>基本ハート</small><Hearts values={card.member.hearts} /></span><span><small>ブレードハート</small><Hearts blade values={card.member.bladeHearts} /></span><span><small>ブレード</small><strong>{card.member.yell.count ?? '—'}</strong></span></>}{card.live && <><span className="deck-main-metric live"><small>SCORE</small><strong>{card.live.score ?? '—'}</strong></span><span><small>必要ハート</small><Hearts values={card.live.requiredHearts} /></span></>}</div>{card.effectText && <p className="deck-effect-preview">{card.effectText}</p>}<span className="deck-detail-hint">詳細を見る <ChevronDown /></span></summary><div className="deck-detail-body"><div className="deck-full-effect"><span>効果</span><p>{card.effectText ?? '—'}</p></div><div className="deck-version-list">{versions.map((version) => <section className="deck-version" key={version.id}><div><strong>{cardVersion(version.cardNumber) ?? version.rarity ?? '通常版'}</strong><code>{version.cardNumber}</code></div><p><span>収録商品</span>{productById.get(version.productId) ?? '—'}</p><div className="card-links">{version.officialUrl && <a className="official-link" href={version.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{version.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div></section>)}</div></div></details>
      <div className="quantity-control" aria-label={`${card.name}の採用枚数`}>
        <button aria-label={`${card.name}を1枚減らす`} onClick={() => decreaseDeck(id, quantity)} type="button"><Minus /></button>
        <output aria-label={`${quantity}枚`}>{quantity}</output>
        <button aria-label={`${card.name}を1枚増やす`} disabled={quantity >= MAX_DECK_QUANTITY} onClick={() => updateDeck(id, 1)} title={quantity >= MAX_DECK_QUANTITY ? '同一カードは4枚までです' : undefined} type="button"><Plus /></button>
      </div>
      {quantity > MAX_DECK_QUANTITY && <output className="deck-limit-warning">保存済みの{quantity}枚を保持中です。追加はできません。</output>}
      {pendingRemovalId === id && <div aria-label={`${card.name}の削除確認`} aria-modal="false" className="deck-remove-confirm" role="alertdialog"><p>このカードをデッキから削除しますか？</p><div><Button onClick={() => confirmDeckRemoval(id)} size="sm" type="button" variant="destructive">削除</Button><Button onClick={() => setPendingRemovalId(null)} size="sm" type="button" variant="outline">キャンセル</Button></div></div>}
    </article>})}</div>
    </section>)}</div>
  </section>;

  return <main>
    <div className={`catalog-pane${deckOpen ? ' deck-open' : ''}`}>
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

      <div className="result-tools">
        <div className="view-toggles"><label className="group-toggle"><input checked={groupIdenticalCards} onChange={(event) => { setGroupIdenticalCards(event.target.checked); setVisibleCount(PAGE_SIZE); }} type="checkbox" /><span>同一カードをまとめる</span></label><label className="group-toggle candidate-toggle"><input checked={candidateOnly} onChange={(event) => { setCandidateOnly(event.target.checked); setVisibleCount(PAGE_SIZE); }} type="checkbox" /><span>候補のみ表示</span></label></div>
        <div className="result-bar" aria-live="polite"><div><SlidersHorizontal aria-hidden="true" /><strong>{displayGroups.length}</strong><span>{groupIdenticalCards ? `種を表示（元カード${filteredCards.length}枚）` : '枚が見つかりました'}</span></div>{hasFilters && <Button variant="ghost" onClick={resetFilters}><X /> 条件をクリア</Button>}</div>
      </div>
      {displayGroups.length ? <div className="card-grid">{displayGroups.slice(0, visibleCount).map((group) => {
        const card = group.representative;
        const isGrouped = group.cards.length > 1;
        const productIdsInGroup = new Set(group.cards.map((version) => version.productId));
        const builderId = baseCardId(card.cardNumber);
        const isCandidate = candidateIds.has(builderId);
        return <article className={`card-item ${card.cardType}`} key={isGrouped ? `${group.baseCardId}:${card.id}` : card.id}>
          <div className="card-body"><Badge className="type-badge" variant="secondary">{card.cardType === 'member' ? 'MEMBER' : 'LIVE'}</Badge><div className="card-heading"><div><h2>{card.name}</h2><code>{isGrouped ? group.baseCardId : card.cardNumber}</code></div>{card.member && <span className="metric"><small>COST</small>{card.member.cost ?? '—'}</span>}{card.live && <span className="metric score"><small>SCORE</small>{card.live.score ?? '—'}</span>}</div>
            {isGrouped && <div className="version-summary"><span>バージョン</span>{group.cards.map((version) => <Badge key={version.id} variant="outline">{cardVersion(version.cardNumber) ?? version.cardNumber}</Badge>)}</div>}
            <p className="product-name">{productIdsInGroup.size === 1 ? productById.get(card.productId) : '収録商品はバージョン別'}</p><dl className="stats">{card.member && <><div><dt>基本ハート</dt><dd><Hearts values={card.member.hearts} /></dd></div><div><dt>ブレードハート</dt><dd><Hearts blade values={card.member.bladeHearts} /></dd></div><div><dt>ブレード</dt><dd>{card.member.yell.count ?? '—'}</dd></div></>}{card.live && <div><dt>必要ハート</dt><dd><Hearts values={card.live.requiredHearts} /></dd></div>}</dl>
            {card.effectText && <p className="effect-text">{card.effectText}</p>}
            <div className="builder-actions"><Button aria-pressed={isCandidate} className={isCandidate ? 'candidate-active' : ''} onClick={() => toggleCandidate(builderId)} size="sm" variant="outline">{isCandidate ? <Check /> : <Bookmark />}{isCandidate ? '候補中' : '候補'}</Button><Button disabled={(deck[builderId] ?? 0) >= MAX_DECK_QUANTITY} onClick={() => updateDeck(builderId, 1)} size="sm"><ListPlus />{(deck[builderId] ?? 0) >= MAX_DECK_QUANTITY ? '4枚採用中' : 'デッキに追加'}</Button></div>
            {isGrouped ? <details className="version-details"><summary>バージョンを見る（{group.cards.length}種）</summary><div className="version-list">{group.cards.map((version) => <section className="version-row" key={version.id}><div><strong>{cardVersion(version.cardNumber) ?? '仕様違い'}</strong><code>{version.cardNumber}</code></div><p><span>レアリティ</span>{version.rarity ?? cardVersion(version.cardNumber) ?? '—'}</p><p><span>収録商品</span>{productById.get(version.productId)}</p><div className="card-links">{version.officialUrl && <a className="official-link" href={version.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{version.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div></section>)}</div></details> : <div className="card-links">{card.officialUrl && <a className="official-link" href={card.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{card.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div>}
          </div></article>;
      })}</div> : <div className="empty-state"><Search /><h2>該当するカードがありません</h2><p>検索語や絞り込み条件を変更してください。</p><Button onClick={resetFilters}>条件をクリア</Button></div>}
      {visibleCount < displayGroups.length && <div className="load-more"><Button size="lg" variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>さらに表示 <span>{Math.min(PAGE_SIZE, displayGroups.length - visibleCount)}種</span></Button></div>}
    </section>
    <footer><p>非公式ファンメイドカードリスト · エネルギーカードは収録対象外です</p><p>未登録のレアリティは、確認済み情報のみ順次追加します。</p></footer>
    </div>
    <Sheet disablePointerDismissal={isDesktopDeck} modal={!isDesktopDeck} onOpenChange={setDeckOpen} open={deckOpen}><SheetTrigger className={`deck-launcher${deckOpen ? ' deck-is-open' : ''}`} aria-label={`デッキを開く、現在${deckTotal}枚`}><ListPlus /><span>デッキ</span><strong>{deckTotal}</strong></SheetTrigger><SheetContent className="deck-sheet" initialFocus={!isDesktopDeck} side="right"><SheetHeader className="deck-header"><SheetTitle>デッキ</SheetTitle><SheetDescription>メンバーはCOST別、ライブはSCORE別に表示しています。</SheetDescription><div className="deck-total"><span>合計</span><strong>{deckTotal}</strong><span>枚</span></div><div className="deck-copy-actions"><Button onClick={() => copyDeckText('recipe')} size="sm" type="button" variant="outline">{copyFeedback === 'recipe' ? <Check /> : <Copy />}{copyFeedback === 'recipe' ? 'コピーしました' : 'デッキレシピをコピー'}</Button><Button onClick={() => copyDeckText('ai')} size="sm" type="button" variant="outline">{copyFeedback === 'ai' ? <Check /> : <Bot />}{copyFeedback === 'ai' ? 'コピーしました' : 'AI相談用にコピー'}</Button></div><p aria-live="polite" className={`copy-feedback${copyFeedback === 'error' ? ' error' : ''}`}>{copyFeedback === 'error' ? 'コピーできませんでした' : copyFeedback ? 'クリップボードにコピーしました' : ''}</p></SheetHeader><div className="deck-scroll">{deckEntries.length ? <>{deckSection('メンバーカード', 'COST', memberDeckGroups)}{deckSection('ライブカード', 'SCORE', liveDeckGroups)}</> : <div className="deck-empty"><ListPlus /><strong>デッキは空です</strong><p>カード一覧の「デッキに追加」から選べます。</p></div>}</div></SheetContent></Sheet>
  </main>;
}
