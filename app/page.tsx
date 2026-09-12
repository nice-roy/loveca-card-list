'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Bot, Bookmark, Check, ChevronDown, Cloud, CloudDownload, CloudUpload, Copy, ExternalLink, Layers3, ListPlus, Minus, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import cardsJson from './data/cards.json';
import referencesJson from './data/reference-data.json';
import type { Card, ReferenceData, SortKey } from './data/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { matchesNumericFilter, numericOptions, retainAvailableIds } from '@/lib/numeric-filters';
import { baseCardId, cardVersion, groupCardsForDisplay } from '@/lib/card-grouping';
import { parseCandidateImportText } from '@/lib/candidate-import';
import { matchesFreewordSearch } from '@/lib/freeword-search';
import { BUILDER_STORAGE_KEY, MAX_DECK_QUANTITY, changeDeckQuantity, createAiConsultationText, createDeckId, createDeckRecipeText, duplicateDeckName, emptyDeckForBulkClear, groupDeckEntriesByMetric, nextDefaultDeckName, normalizeBuilderState, removeDeckCardIfSingle, restoreDeckAfterBulkClear, type DeckGroup, type DeckQuantities, type SavedDeck } from '@/lib/deck-builder';
import { createBuilderTransfer, createBuilderTransferText, validateBuilderTransferText, type ValidatedBuilderTransfer } from '@/lib/builder-transfer';
import { groupMemberOptions, type MemberDisplayMode, type MemberOptionGroup } from '@/lib/member-options';
import { isOtherGroupId, isRivalGroupId, matchesGroupFilter, matchesMemberGroupFilter } from '@/lib/group-filter';
import { INVENTORY_STORAGE_KEY, MAX_OWNED_QUANTITY, inventoryTotalsByBase, matchesInventoryFilter, normalizeInventory, setOwnedQuantity, type InventoryFilter, type InventoryQuantities } from '@/lib/inventory';
import { createShortageCardsText, getDeckOwnershipStatuses, getShortageEntries, type DeckOwnershipStatus } from '@/lib/deck-ownership';
import { CARD_TYPE_STORAGE_KEY, normalizeCardTypeFilter, type CardTypeFilter } from '@/lib/card-type-preference';
import { GROUP_STORAGE_KEY, normalizeGroupPreference } from '@/lib/group-preference';
import { heartDisplayLabel, HEART_COLOR_LABELS, splitEffectTextForDisplay, type EffectIcon, type HeartColor } from '@/lib/heart-presentation';
import { clearSyncConnectionStorage, CloudSyncError, createSyncBaseline, createCloudSync, formatSyncCode, getSyncApiUrl, isSyncPayloadDirty, loadCloudSync, loadCloudSyncHistory, normalizeSyncBaseline, normalizeSyncCode, normalizeSyncMetadata, restoreCloudSyncHistory, saveCloudSync, SYNC_BASELINE_STORAGE_KEY, SYNC_CODE_STORAGE_KEY, SYNC_META_STORAGE_KEY, type SyncBaseline, type SyncHistorySummary, type SyncMetadata } from '@/lib/cloud-sync';

const cards = cardsJson as Card[];
const references = referencesJson as ReferenceData;
const selectableGroupIds = new Set(['all', 'other', ...references.groups.filter((group) => group.enabled).map((group) => group.id)]);
const TOP_GROUP_IDS = ['muse', 'aqours', 'nijigasaki', 'liella', 'hasunosora'] as const;
const cardsByBuilderId = new Map<string, Card[]>();
for (const card of cards) {
  const id = baseCardId(card.cardNumber);
  cardsByBuilderId.set(id, [...(cardsByBuilderId.get(id) ?? []), card]);
}
const validBuilderIds = new Set(cardsByBuilderId.keys());
const validVersionIds = new Set(cards.map((card) => card.id));
const versionToBase = new Map(cards.map((card) => [card.id, baseCardId(card.cardNumber)]));
const PAGE_SIZE = 48;
const MEMBER_DISPLAY_MODE_STORAGE_KEY = 'loveca-card-list:member-display-mode:v1';
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
const syncApiUrl = getSyncApiUrl();

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

function readMemberDisplayMode(): MemberDisplayMode {
  try {
    return localStorage.getItem(MEMBER_DISPLAY_MODE_STORAGE_KEY) === 'unit' ? 'unit' : 'schoolYear';
  } catch {
    return 'schoolYear';
  }
}

function readCardTypeFilter(): CardTypeFilter {
  try {
    return normalizeCardTypeFilter(localStorage.getItem(CARD_TYPE_STORAGE_KEY));
  } catch {
    return 'all';
  }
}

function readGroupPreference() {
  try {
    return normalizeGroupPreference(localStorage.getItem(GROUP_STORAGE_KEY), selectableGroupIds);
  } catch {
    return 'all';
  }
}

function readInventory() {
  try {
    const saved = localStorage.getItem(INVENTORY_STORAGE_KEY);
    return saved ? normalizeInventory(JSON.parse(saved), validVersionIds) : {};
  } catch {
    return {};
  }
}

function readSyncCode() {
  try {
    return normalizeSyncCode(localStorage.getItem(SYNC_CODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readSyncMetadata() {
  try {
    const saved = localStorage.getItem(SYNC_META_STORAGE_KEY);
    return saved ? normalizeSyncMetadata(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function readSyncBaseline() {
  try {
    const saved = localStorage.getItem(SYNC_BASELINE_STORAGE_KEY);
    return saved ? normalizeSyncBaseline(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function formatSyncDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ja-JP');
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
    .filter((card) => matchesGroupFilter(card, selectedGroupId))
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
      <span className="heart-color-label">{HEART_COLOR_LABELS[(value.color ?? 'any') as HeartColor] ?? '色不明'}</span>
      <strong>×{value.count}</strong>
    </span>
  ))}</span>;
}

function EffectIconDisplay({ icon }: { icon: EffectIcon }) {
  const label = icon.type === 'heart'
    ? heartDisplayLabel(icon.color)
    : icon.color ? heartDisplayLabel(icon.color, true) : 'ブレード';
  const color = icon.color ?? 'any';
  const suffix = icon.type === 'blade'
    ? icon.all ? 'ALL' : icon.color ? HEART_COLOR_LABELS[icon.color] : ''
    : HEART_COLOR_LABELS[color as HeartColor] ?? '色不明';
  return <span className="effect-icon" aria-label={label} title={label}>
    <span aria-hidden="true" className={`${icon.type === 'blade' ? 'blade-heart' : 'heart'} ${colorClass[color]}`}>{icon.type === 'blade' ? '◆' : color === 'any' ? '◇' : '♥'}</span>
    <span>{suffix}</span>
  </span>;
}

function EffectText({ text, className }: { text: string; className?: string }) {
  return <p className={className}>{splitEffectTextForDisplay(text).map((fragment, index) =>
    fragment.type === 'text'
      ? <span key={index}>{fragment.value}</span>
      : <EffectIconDisplay icon={fragment.icon} key={index} />,
  )}</p>;
}

function InventoryStepper({ label, count, onChange }: { label: string; count: number; onChange: (count: number) => void }) {
  return <div className={`inventory-stepper${count > 0 ? ' owned' : ''}`}>
    <span>所持</span>
    <button aria-label={`${label}の所持枚数を1枚減らす`} disabled={count <= 0} onClick={() => onChange(count - 1)} type="button"><Minus /></button>
    <input aria-label={`${label}の所持枚数`} inputMode="numeric" max={MAX_OWNED_QUANTITY} min={0} onChange={(event) => {
      const next = Number(event.target.value);
      if (Number.isInteger(next) && next >= 0 && next <= MAX_OWNED_QUANTITY) onChange(next);
    }} type="number" value={count} />
    <button aria-label={`${label}の所持枚数を1枚増やす`} disabled={count >= MAX_OWNED_QUANTITY} onClick={() => onChange(count + 1)} type="button"><Plus /></button>
  </div>;
}

function MultiSelect({
  id,
  label,
  emptyLabel,
  options,
  optionGroups,
  memberDisplayMode,
  onMemberDisplayModeChange,
  selectedIds,
  onChange,
  className = '',
}: {
  id: string;
  label: string;
  emptyLabel: string;
  options: { id: string; label: string }[];
  optionGroups?: MemberOptionGroup[];
  memberDisplayMode?: MemberDisplayMode;
  onMemberDisplayModeChange?: (mode: MemberDisplayMode) => void;
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
        {memberDisplayMode && onMemberDisplayModeChange && <div className="member-display-mode" aria-label="メンバー候補の表示分類">
          <span>表示：</span><fieldset aria-label="表示分類を切り替え">
            <button aria-pressed={memberDisplayMode === 'schoolYear'} className={memberDisplayMode === 'schoolYear' ? 'active' : ''} onClick={() => onMemberDisplayModeChange('schoolYear')} type="button">学年</button>
            <button aria-pressed={memberDisplayMode === 'unit'} className={memberDisplayMode === 'unit' ? 'active' : ''} onClick={() => onMemberDisplayModeChange('unit')} type="button">ユニット</button>
          </fieldset>
        </div>}
        <div className={`multi-select-options${optionGroups ? ' grouped-member-options' : ''}`} role="group" aria-labelledby={`${id}-label`}>
          {optionGroups ? optionGroups.map((group) => <section className="member-option-group" key={group.id}>
            {group.label && <h3>{group.label}</h3>}
            {group.sections.map((section) => <section className="member-option-section" key={`${group.id}-${section.id}`}>
              <h4>{section.label}</h4><div className="member-option-grid">{section.options.map((option) => <label className="multi-select-option" key={option.id}>
                <input checked={selectedIds.includes(option.id)} onChange={() => toggle(option.id)} type="checkbox" />
                <span>{option.label}</span>
              </label>)}</div>
            </section>)}
          </section>) : options.map((option) => <label className="multi-select-option" key={option.id}>
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
  const [groupId, setGroupId] = useState(readGroupPreference);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberDisplayMode, setMemberDisplayMode] = useState<MemberDisplayMode>(readMemberDisplayMode);
  const [cardType, setCardType] = useState<CardTypeFilter>(readCardTypeFilter);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [costIds, setCostIds] = useState<string[]>([]);
  const [scoreIds, setScoreIds] = useState<string[]>([]);
  const [groupIdenticalCards, setGroupIdenticalCards] = useState(true);
  const [candidateOnly, setCandidateOnly] = useState(false);
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [inventory, setInventory] = useState<InventoryQuantities>(readInventory);
  const [initialBuilderState] = useState(readBuilderState);
  const [candidateIds, setCandidateIds] = useState<Set<string>>(() => new Set(initialBuilderState.candidates));
  const [decks, setDecks] = useState<SavedDeck[]>(initialBuilderState.decks);
  const [activeDeckId, setActiveDeckId] = useState(initialBuilderState.activeDeckId);
  const [deckOpen, setDeckOpen] = useState(false);
  const [isDesktopDeck, setIsDesktopDeck] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'recipe' | 'ai' | 'error' | null>(null);
  const [shortageDialogOpen, setShortageDialogOpen] = useState(false);
  const [shortageCopyFeedback, setShortageCopyFeedback] = useState<'success' | 'error' | null>(null);
  const [aiCandidateDialogOpen, setAiCandidateDialogOpen] = useState(false);
  const [selectedAiCandidateIds, setSelectedAiCandidateIds] = useState<Set<string>>(new Set());
  const [candidateImportOpen, setCandidateImportOpen] = useState(false);
  const [candidateImportText, setCandidateImportText] = useState('');
  const [candidateImportResult, setCandidateImportResult] = useState<{ recognized: number; added: number; existing: number; unknown: string[]; usedSection: boolean } | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [deckClearConfirmOpen, setDeckClearConfirmOpen] = useState(false);
  const [clearedDeckForUndo, setClearedDeckForUndo] = useState<{ deckId: string; cards: DeckQuantities } | null>(null);
  const [deckManagerOpen, setDeckManagerOpen] = useState(false);
  const [renameDeckId, setRenameDeckId] = useState<string | null>(null);
  const [renameDeckName, setRenameDeckName] = useState('');
  const [deleteDeckId, setDeleteDeckId] = useState<string | null>(null);
  const [dataTransferOpen, setDataTransferOpen] = useState(false);
  const [dataTransferView, setDataTransferView] = useState<'menu' | 'export' | 'import' | 'preview'>('menu');
  const [dataTransferText, setDataTransferText] = useState('');
  const [dataTransferErrors, setDataTransferErrors] = useState<string[]>([]);
  const [dataTransferCopyFeedback, setDataTransferCopyFeedback] = useState<'success' | 'error' | null>(null);
  const [pendingDataImport, setPendingDataImport] = useState<ValidatedBuilderTransfer | null>(null);
  const [importedStateForUndo, setImportedStateForUndo] = useState<{ decks: SavedDeck[]; activeDeckId: string; candidates: string[]; inventory: InventoryQuantities } | null>(null);
  const [importUndoLabel, setImportUndoLabel] = useState('データをインポートしました');
  const [syncCode, setSyncCode] = useState<string | null>(readSyncCode);
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(readSyncMetadata);
  const [syncBaseline, setSyncBaseline] = useState<SyncBaseline | null>(readSyncBaseline);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncView, setSyncView] = useState<'main' | 'connect' | 'preview' | 'conflict'>('main');
  const [syncCodeInput, setSyncCodeInput] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [syncCodeCopied, setSyncCodeCopied] = useState(false);
  const [syncForceConfirm, setSyncForceConfirm] = useState(false);
  const [pendingCloudImport, setPendingCloudImport] = useState<{ code: string; value: ValidatedBuilderTransfer; revision: number; createdAt: string; updatedAt: string } | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncHistorySummary[]>([]);
  const [syncHistoryLoading, setSyncHistoryLoading] = useState(false);
  const [selectedSyncHistory, setSelectedSyncHistory] = useState<SyncHistorySummary | null>(null);
  const [syncHistoryRestoreOpen, setSyncHistoryRestoreOpen] = useState(false);
  const [cloudLoadDirtyConfirmOpen, setCloudLoadDirtyConfirmOpen] = useState(false);
  const [pendingDirtyCloudLoadCode, setPendingDirtyCloudLoadCode] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const activeDeck = decks.find((item) => item.id === activeDeckId) ?? decks[0];
  const deck = activeDeck.cards;
  const setDeck = (next: DeckQuantities | ((current: DeckQuantities) => DeckQuantities)) => {
    setDecks((current) => current.map((item) => item.id === activeDeckId
      ? { ...item, cards: typeof next === 'function' ? next(item.cards) : next }
      : item));
  };
  const memberById = useMemo(() => new Map(references.members.map((item) => [item.id, item.label])), []);
  const productById = useMemo(() => new Map(references.products.map((item) => [item.id, item.label])), []);
  const selectedMemberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const selectedProductIdSet = useMemo(() => new Set(productIds), [productIds]);
  const availableMembers = useMemo(() => references.members.filter((member) => matchesMemberGroupFilter(member, groupId)), [groupId]);
  const memberOptionGroups = useMemo(() => groupMemberOptions(availableMembers, groupId, references.groups, memberDisplayMode), [availableMembers, groupId, memberDisplayMode]);
  const availableProducts = useMemo(() => {
    const availableProductIds = getProductIdsForGroup(groupId);
    return references.products.filter((product) => availableProductIds.has(product.id));
  }, [groupId]);
  const availableCosts = useMemo(() => numericOptions(cards, groupId, 'cost'), [groupId]);
  const availableScores = useMemo(() => numericOptions(cards, groupId, 'score'), [groupId]);
  const memberTotal = useMemo(() => cards.filter((card) => card.cardType === 'member').length, []);
  const liveTotal = useMemo(() => cards.filter((card) => card.cardType === 'live').length, []);
  const rivalGroups = useMemo(() => references.groups.filter((group) => isRivalGroupId(group.id)), []);
  const topGroups = useMemo(() => TOP_GROUP_IDS.map((id) => references.groups.find((group) => group.id === id)).filter((group): group is ReferenceData['groups'][number] => Boolean(group && group.enabled)), []);
  const otherLiveGroup = useMemo(() => references.groups.find((group) => group.id === 'other-live'), []);
  const otherGroupActive = groupId === 'other' || isOtherGroupId(groupId);
  const ownedTotalsByBase = useMemo(() => inventoryTotalsByBase(inventory, versionToBase), [inventory]);
  const hasUnsavedSyncChanges = useMemo(
    () => isSyncPayloadDirty(syncCode, syncBaseline, createBuilderTransfer(decks, activeDeckId, candidateIds, inventory)),
    [activeDeckId, candidateIds, decks, inventory, syncBaseline, syncCode],
  );
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
        version: 2,
        candidates: [...candidateIds],
        decks,
        activeDeckId,
      }));
    } catch {
      // The builder remains usable for the current page even if storage is unavailable.
    }
  }, [activeDeckId, candidateIds, decks]);

  useEffect(() => {
    try {
      localStorage.setItem(MEMBER_DISPLAY_MODE_STORAGE_KEY, memberDisplayMode);
    } catch {
      // The current page remains usable even if storage is unavailable.
    }
  }, [memberDisplayMode]);

  useEffect(() => {
    try {
      localStorage.setItem(CARD_TYPE_STORAGE_KEY, cardType);
    } catch {
      // The current page remains usable even if storage is unavailable.
    }
  }, [cardType]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, groupId);
    } catch {
      // The current page remains usable even if storage is unavailable.
    }
  }, [groupId]);

  useEffect(() => {
    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ version: 1, cards: inventory }));
    } catch {
      // Inventory remains usable for the current page even if storage is unavailable.
    }
  }, [inventory]);

  useEffect(() => {
    try {
      if (syncCode) localStorage.setItem(SYNC_CODE_STORAGE_KEY, syncCode);
      else localStorage.removeItem(SYNC_CODE_STORAGE_KEY);
      if (syncMetadata) localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(syncMetadata));
      else localStorage.removeItem(SYNC_META_STORAGE_KEY);
      if (syncBaseline && syncBaseline.code === syncCode) localStorage.setItem(SYNC_BASELINE_STORAGE_KEY, JSON.stringify(syncBaseline));
      else localStorage.removeItem(SYNC_BASELINE_STORAGE_KEY);
    } catch {
      // Cloud sync stays usable for the current page even if metadata cannot be retained.
    }
  }, [syncBaseline, syncCode, syncMetadata]);

  const filteredCards = useMemo(() => {
    return cards
      .filter((card) => matchesGroupFilter(card, groupId))
      .filter((card) => selectedMemberIdSet.size === 0 || card.memberIds.some((id) => selectedMemberIdSet.has(id)))
      .filter((card) => cardType === 'all' || card.cardType === cardType)
      .filter((card) => cardType !== 'member' || matchesNumericFilter(card, 'cost', costIds))
      .filter((card) => cardType !== 'live' || matchesNumericFilter(card, 'score', scoreIds))
      .filter((card) => selectedProductIdSet.size === 0 || selectedProductIdSet.has(card.productId))
      .filter((card) => !candidateOnly || candidateIds.has(baseCardId(card.cardNumber)))
      .filter((card) => matchesInventoryFilter(inventoryFilter, card.id, baseCardId(card.cardNumber), groupIdenticalCards, inventory, ownedTotalsByBase))
      .filter((card) => matchesFreewordSearch(
        [card.name, card.cardNumber, card.effectText ?? '', productById.get(card.productId) ?? '', ...card.memberIds.map((id) => memberById.get(id) ?? '')].join(' '),
        query,
      ))
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
  }, [candidateIds, candidateOnly, cardType, costIds, scoreIds, groupId, groupIdenticalCards, inventory, inventoryFilter, memberById, ownedTotalsByBase, productById, query, selectedMemberIdSet, selectedProductIdSet, sortKey]);
  const displayGroups = useMemo(() => groupIdenticalCards
    ? groupCardsForDisplay(filteredCards)
    : filteredCards.map((card) => ({ baseCardId: card.cardNumber, cards: [card], representative: card })), [filteredCards, groupIdenticalCards]);

  const resetFilters = () => {
    setQuery(''); setGroupId('all'); setMemberIds([]); setCardType('all'); setProductIds([]); setSortKey(DEFAULT_SORT); setVisibleCount(PAGE_SIZE);
    setCostIds([]); setScoreIds([]); setGroupIdenticalCards(true); setCandidateOnly(false); setInventoryFilter('all');
  };
  const changeCardType = (nextCardType: CardTypeFilter) => {
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
      const validMemberIds = new Set(references.members.filter((member) => matchesMemberGroupFilter(member, nextGroupId)).map((member) => member.id));
      setMemberIds((currentIds) => currentIds.filter((id) => validMemberIds.has(id)));
    }
    setVisibleCount(PAGE_SIZE);
  };
  const updateMemberIds = (nextIds: string[]) => { setMemberIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateProductIds = (nextIds: string[]) => { setProductIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateCostIds = (nextIds: string[]) => { setCostIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateScoreIds = (nextIds: string[]) => { setScoreIds(nextIds); setVisibleCount(PAGE_SIZE); };
  const updateInventory = (versionId: string, count: number) => {
    setImportedStateForUndo(null);
    setInventory((current) => setOwnedQuantity(current, versionId, count));
  };
  const toggleCandidate = (id: string) => {
    setImportedStateForUndo(null);
    setCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const openCandidateImport = () => {
    setCandidateImportText('');
    setCandidateImportResult(null);
    setCandidateImportOpen(true);
  };
  const importCandidates = () => {
    const parsed = parseCandidateImportText(candidateImportText, validBuilderIds);
    const existing = parsed.recognizedIds.filter((id) => candidateIds.has(id));
    const added = parsed.recognizedIds.filter((id) => !candidateIds.has(id));
    if (added.length) {
      setImportedStateForUndo(null);
      setCandidateIds((current) => new Set([...current, ...added]));
    }
    setCandidateImportResult({ recognized: parsed.recognizedIds.length, added: added.length, existing: existing.length, unknown: parsed.unrecognizedCardNumbers, usedSection: parsed.usedBulkCandidateSection });
  };
  const updateDeck = (id: string, delta: number) => {
    setClearedDeckForUndo(null);
    setImportedStateForUndo(null);
    setPendingRemovalId((current) => current === id ? null : current);
    setDeck((current) => changeDeckQuantity(current, id, delta));
  };
  const decreaseDeck = (id: string, quantity: number) => {
    if (quantity === 1) setPendingRemovalId(id);
    else updateDeck(id, -1);
  };
  const confirmDeckRemoval = (id: string) => {
    setClearedDeckForUndo(null);
    setImportedStateForUndo(null);
    setDeck((current) => removeDeckCardIfSingle(current, id));
    setPendingRemovalId(null);
  };
  const resetDeckScopedUndo = () => {
    setClearedDeckForUndo(null);
    setImportedStateForUndo(null);
    setPendingRemovalId(null);
  };
  const switchDeck = (id: string) => {
    if (id === activeDeckId) return;
    resetDeckScopedUndo();
    setActiveDeckId(id);
  };
  const createNewDeck = () => {
    const newDeck = { id: createDeckId(), name: nextDefaultDeckName(decks), cards: {} };
    resetDeckScopedUndo();
    setDecks((current) => [...current, newDeck]);
    setActiveDeckId(newDeck.id);
    setDeckManagerOpen(false);
  };
  const duplicateActiveDeck = () => {
    const duplicate = { id: createDeckId(), name: duplicateDeckName(activeDeck.name, decks), cards: { ...deck } };
    resetDeckScopedUndo();
    setDecks((current) => [...current, duplicate]);
    setActiveDeckId(duplicate.id);
    setDeckManagerOpen(false);
  };
  const startRenameDeck = (item: SavedDeck) => {
    setRenameDeckId(item.id);
    setRenameDeckName(item.name);
  };
  const saveDeckName = () => {
    const name = renameDeckName.trim();
    if (!renameDeckId || !name) return;
    resetDeckScopedUndo();
    setDecks((current) => current.map((item) => item.id === renameDeckId ? { ...item, name } : item));
    setRenameDeckId(null);
  };
  const confirmDeleteDeck = () => {
    if (!deleteDeckId || decks.length <= 1) return;
    const remaining = decks.filter((item) => item.id !== deleteDeckId);
    resetDeckScopedUndo();
    setDecks(remaining);
    if (activeDeckId === deleteDeckId) setActiveDeckId(remaining[0].id);
    setDeleteDeckId(null);
  };
  const deckEntries = useMemo(() => Object.entries(deck)
    .map(([id, quantity]) => ({ id, quantity, card: cardsByBuilderId.get(id)?.[0] }))
    .filter((entry): entry is { id: string; quantity: number; card: Card } => Boolean(entry.card))
    .sort((left, right) => compareNullable(left.id, right.id)), [deck]);
  const deckOwnershipStatuses = useMemo(() => getDeckOwnershipStatuses(deckEntries, ownedTotalsByBase), [deckEntries, ownedTotalsByBase]);
  const shortageEntries = useMemo(() => getShortageEntries(deckOwnershipStatuses), [deckOwnershipStatuses]);
  const ownershipById = useMemo(() => new Map(deckOwnershipStatuses.map((entry) => [entry.id, entry])), [deckOwnershipStatuses]);
  const shortageTotal = shortageEntries.reduce((sum, entry) => sum + entry.shortageQuantity, 0);
  const memberDeckGroups = groupDeckEntriesByMetric(deckEntries.filter((entry) => entry.card.cardType === 'member'), 'cost');
  const liveDeckGroups = groupDeckEntriesByMetric(deckEntries.filter((entry) => entry.card.cardType === 'live'), 'score');
  const deckTotal = deckEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const memberDeckTotal = memberDeckGroups.reduce((sum, group) => sum + group.quantity, 0);
  const liveDeckTotal = liveDeckGroups.reduce((sum, group) => sum + group.quantity, 0);
  const availableAiCandidates = useMemo(() => [...candidateIds]
    .filter((id) => !deck[id])
    .map((id) => ({ id, card: cardsByBuilderId.get(id)?.[0] }))
    .filter((entry): entry is { id: string; card: Card } => Boolean(entry.card))
    .sort((left, right) => compareNullable(left.id, right.id)), [candidateIds, deck]);
  const hasFilters = Boolean(query || groupId !== 'all' || memberIds.length || cardType !== 'all' || productIds.length || costIds.length || scoreIds.length || !groupIdenticalCards || candidateOnly || inventoryFilter !== 'all');
  const finishCopy = async (kind: 'recipe' | 'ai', text: string) => {
    const copied = await copyText(text);
    setCopyFeedback(copied ? kind : 'error');
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };
  const copyDeckRecipe = () => finishCopy('recipe', createDeckRecipeText(deckEntries, activeDeck.name));
  const copyShortageCards = async () => {
    const text = createShortageCardsText(deckOwnershipStatuses);
    if (!text) return;
    const copied = await copyText(text);
    setShortageCopyFeedback(copied ? 'success' : 'error');
    window.setTimeout(() => setShortageCopyFeedback(null), 1800);
  };
  const requestAiCopy = () => {
    if (!availableAiCandidates.length) {
      void finishCopy('ai', createAiConsultationText(deckEntries, [], activeDeck.name, ownedTotalsByBase));
      return;
    }
    setSelectedAiCandidateIds(new Set());
    setAiCandidateDialogOpen(true);
  };
  const copyAiWithCandidates = () => {
    const selectedCandidates = availableAiCandidates.filter((entry) => selectedAiCandidateIds.has(entry.id));
    setAiCandidateDialogOpen(false);
    void finishCopy('ai', createAiConsultationText(deckEntries, selectedCandidates, activeDeck.name, ownedTotalsByBase));
  };
  const toggleAiCandidate = (id: string) => setSelectedAiCandidateIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearDeck = () => {
    const cleared = emptyDeckForBulkClear(deck);
    setDeck(cleared.deck);
    setClearedDeckForUndo({ deckId: activeDeckId, cards: cleared.undoDeck });
    setImportedStateForUndo(null);
    setPendingRemovalId(null);
    setDeckClearConfirmOpen(false);
  };
  const undoDeckClear = () => {
    if (!clearedDeckForUndo || clearedDeckForUndo.deckId !== activeDeckId) return;
    setDeck(restoreDeckAfterBulkClear(clearedDeckForUndo.cards));
    setClearedDeckForUndo(null);
  };
  const openDataTransfer = () => {
    setDataTransferView('menu');
    setDataTransferText('');
    setDataTransferErrors([]);
    setDataTransferCopyFeedback(null);
    setPendingDataImport(null);
    setDataTransferOpen(true);
  };
  const currentSyncPayload = () => createBuilderTransfer(decks, activeDeckId, candidateIds, inventory);
  const setSyncFailure = (error: unknown) => {
    const text = error instanceof CloudSyncError ? error.message : 'クラウド同期に失敗しました。時間をおいてもう一度お試しください。';
    setSyncMessage({ kind: 'error', text });
  };
  const refreshSyncHistory = async (code: string, reportError = true) => {
    setSyncHistoryLoading(true);
    try {
      const result = await loadCloudSyncHistory(syncApiUrl, code);
      setSyncHistory(result.history);
      setSelectedSyncHistory((current) => current ? result.history.find((item) => item.id === current.id) ?? null : null);
    } catch (error) {
      if (reportError) setSyncFailure(error);
    } finally {
      setSyncHistoryLoading(false);
    }
  };
  const openCloudSync = () => {
    setSyncView('main');
    setSyncCodeInput('');
    setSyncMessage(null);
    setSyncCodeCopied(false);
    setSyncForceConfirm(false);
    setPendingCloudImport(null);
    setSelectedSyncHistory(null);
    setSyncHistoryRestoreOpen(false);
    setSyncDialogOpen(true);
    if (syncCode) void refreshSyncHistory(syncCode, false);
  };
  const createSyncConnection = async () => {
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const payload = currentSyncPayload();
      const result = await createCloudSync(syncApiUrl, payload);
      const code = normalizeSyncCode(result.code);
      if (!code) throw new Error('invalid sync code');
      const metadata = { revision: result.revision, cloudUpdatedAt: result.updatedAt, lastSyncedAt: new Date().toISOString() };
      setSyncCode(code);
      setSyncMetadata(metadata);
      setSyncBaseline(createSyncBaseline(code, payload));
      setSyncHistory([]);
      setSyncMessage({ kind: 'success', text: '現在のデータを保存し、同期コードを作成しました。' });
    } catch (error) {
      setSyncFailure(error);
    } finally {
      setSyncBusy(false);
    }
  };
  const prepareCloudImport = async (codeValue: string) => {
    const code = normalizeSyncCode(codeValue);
    if (!code) {
      setSyncMessage({ kind: 'error', text: '同期コードの形式を確認してください。' });
      return;
    }
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await loadCloudSync(syncApiUrl, code);
      const validation = validateBuilderTransferText(JSON.stringify(result.payload), validBuilderIds, validVersionIds);
      if (!validation.ok) {
        setSyncMessage({ kind: 'error', text: `クラウドデータを適用できません：${validation.errors.join('、')}` });
        return;
      }
      setPendingCloudImport({ code, value: validation.value, revision: result.revision, createdAt: result.createdAt, updatedAt: result.updatedAt });
      setSyncView('preview');
    } catch (error) {
      setSyncFailure(error);
    } finally {
      setSyncBusy(false);
    }
  };
  const requestCloudImport = (codeValue: string) => {
    if (hasUnsavedSyncChanges) {
      setPendingDirtyCloudLoadCode(codeValue);
      setCloudLoadDirtyConfirmOpen(true);
      return;
    }
    void prepareCloudImport(codeValue);
  };
  const confirmDirtyCloudLoad = () => {
    const code = pendingDirtyCloudLoadCode;
    setCloudLoadDirtyConfirmOpen(false);
    setPendingDirtyCloudLoadCode(null);
    if (code) void prepareCloudImport(code);
  };
  const saveToCloud = async (force = false) => {
    if (!syncCode || !syncMetadata) {
      setSyncMessage({ kind: 'error', text: '先にクラウドから読み込み、同期状態を確認してください。' });
      return;
    }
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const payload = currentSyncPayload();
      const result = await saveCloudSync(syncApiUrl, syncCode, payload, syncMetadata.revision, force);
      setSyncMetadata({ revision: result.revision, cloudUpdatedAt: result.updatedAt, lastSyncedAt: new Date().toISOString() });
      setSyncBaseline(createSyncBaseline(syncCode, payload));
      setSyncView('main');
      setSyncForceConfirm(false);
      setSyncMessage({ kind: 'success', text: '現在の端末データをクラウドへ保存しました。' });
      await refreshSyncHistory(syncCode, false);
    } catch (error) {
      if (error instanceof CloudSyncError && error.code === 'revision_conflict') {
        setSyncView('conflict');
        setSyncForceConfirm(false);
        setSyncMessage({ kind: 'error', text: '別の端末でクラウドデータが更新されています。自動では上書きしません。' });
      } else setSyncFailure(error);
    } finally {
      setSyncBusy(false);
    }
  };
  const applyCloudState = (code: string, value: ValidatedBuilderTransfer, revision: number, updatedAt: string, undoLabel: string) => {
    setImportedStateForUndo({ decks: decks.map((item) => ({ ...item, cards: { ...item.cards } })), activeDeckId, candidates: [...candidateIds], inventory: { ...inventory } });
    setImportUndoLabel(undoLabel);
    setDecks(value.decks.map((item) => ({ ...item, cards: { ...item.cards } })));
    setActiveDeckId(value.activeDeckId);
    setCandidateIds(new Set(value.candidates));
    setInventory({ ...value.inventory });
    setSyncCode(code);
    setSyncMetadata({ revision, cloudUpdatedAt: updatedAt, lastSyncedAt: new Date().toISOString() });
    setSyncBaseline(createSyncBaseline(code, createBuilderTransfer(value.decks, value.activeDeckId, value.candidates, value.inventory)));
    setClearedDeckForUndo(null);
    setPendingRemovalId(null);
    setDeckOpen(true);
  };
  const confirmCloudImport = () => {
    if (!pendingCloudImport) return;
    applyCloudState(pendingCloudImport.code, pendingCloudImport.value, pendingCloudImport.revision, pendingCloudImport.updatedAt, 'クラウドから読み込みました');
    setPendingCloudImport(null);
    setSyncDialogOpen(false);
  };
  const restoreSelectedCloudHistory = async () => {
    if (!syncCode || !syncMetadata || !selectedSyncHistory) return;
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await restoreCloudSyncHistory(syncApiUrl, syncCode, selectedSyncHistory.id, syncMetadata.revision);
      const validation = validateBuilderTransferText(JSON.stringify(result.payload), validBuilderIds, validVersionIds);
      if (!validation.ok) {
        setSyncMessage({ kind: 'error', text: `復元したクラウドデータを適用できません：${validation.errors.join('、')}` });
        return;
      }
      applyCloudState(syncCode, validation.value, result.revision, result.updatedAt, 'クラウド履歴から復元しました');
      setSyncHistoryRestoreOpen(false);
      setSelectedSyncHistory(null);
      setSyncView('main');
      setSyncMessage({ kind: 'success', text: `revision ${result.restoredFromRevision} の内容を、新しいrevision ${result.revision}として復元しました。` });
      await refreshSyncHistory(syncCode, false);
    } catch (error) {
      setSyncHistoryRestoreOpen(false);
      if (error instanceof CloudSyncError && error.code === 'revision_conflict') {
        setSyncView('conflict');
        setSyncForceConfirm(false);
        setSyncMessage({ kind: 'error', text: '別の端末でクラウドデータが更新されています。履歴復元は実行していません。' });
      } else setSyncFailure(error);
    } finally {
      setSyncBusy(false);
    }
  };
  const copySyncCode = async () => {
    if (!syncCode) return;
    const copied = await copyText(formatSyncCode(syncCode));
    setSyncCodeCopied(copied);
    window.setTimeout(() => setSyncCodeCopied(false), 1800);
  };
  const disconnectCloudSync = () => {
    try {
      clearSyncConnectionStorage(localStorage);
    } catch {
      // The in-memory connection is still removed when storage is unavailable.
    }
    setSyncCode(null);
    setSyncMetadata(null);
    setSyncBaseline(null);
    setSyncCodeInput('');
    setPendingCloudImport(null);
    setSyncHistory([]);
    setSelectedSyncHistory(null);
    setSyncHistoryRestoreOpen(false);
    setCloudLoadDirtyConfirmOpen(false);
    setPendingDirtyCloudLoadCode(null);
    setSyncView('main');
    setSyncMessage({ kind: 'success', text: 'この端末の同期を解除しました。クラウドデータは残っています。' });
  };
  const exportDataText = useMemo(() => createBuilderTransferText(decks, activeDeckId, candidateIds, inventory), [activeDeckId, candidateIds, decks, inventory]);
  const copyDataExport = async () => {
    const copied = await copyText(exportDataText);
    setDataTransferCopyFeedback(copied ? 'success' : 'error');
    window.setTimeout(() => setDataTransferCopyFeedback(null), 1800);
  };
  const downloadDataExport = () => {
    const blob = new Blob([exportDataText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'loveca-card-list-data.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const reviewDataImport = () => {
    const result = validateBuilderTransferText(dataTransferText, validBuilderIds, validVersionIds);
    if (!result.ok) {
      setDataTransferErrors(result.errors);
      setPendingDataImport(null);
      return;
    }
    setDataTransferErrors([]);
    setPendingDataImport(result.value);
    setDataTransferView('preview');
  };
  const confirmDataImport = () => {
    if (!pendingDataImport) return;
    setImportedStateForUndo({ decks: decks.map((item) => ({ ...item, cards: { ...item.cards } })), activeDeckId, candidates: [...candidateIds], inventory: { ...inventory } });
    setImportUndoLabel('データをインポートしました');
    setDecks(pendingDataImport.decks.map((item) => ({ ...item, cards: { ...item.cards } })));
    setActiveDeckId(pendingDataImport.activeDeckId);
    setCandidateIds(new Set(pendingDataImport.candidates));
    setInventory({ ...pendingDataImport.inventory });
    setClearedDeckForUndo(null);
    setPendingRemovalId(null);
    setDataTransferOpen(false);
    setDeckOpen(true);
    setPendingDataImport(null);
  };
  const undoDataImport = () => {
    if (!importedStateForUndo) return;
    setDecks(importedStateForUndo.decks.map((item) => ({ ...item, cards: { ...item.cards } })));
    setActiveDeckId(importedStateForUndo.activeDeckId);
    setCandidateIds(new Set(importedStateForUndo.candidates));
    setInventory({ ...importedStateForUndo.inventory });
    setImportedStateForUndo(null);
  };
  const importDeckPreviews = pendingDataImport?.decks.map((item) => {
    const memberTotal = Object.entries(item.cards).reduce((sum, [id, quantity]) => sum + (cardsByBuilderId.get(id)?.[0]?.cardType === 'member' ? quantity : 0), 0);
    const liveTotal = Object.entries(item.cards).reduce((sum, [id, quantity]) => sum + (cardsByBuilderId.get(id)?.[0]?.cardType === 'live' ? quantity : 0), 0);
    return { ...item, memberTotal, liveTotal, total: memberTotal + liveTotal };
  }) ?? [];
  const importInventoryKinds = pendingDataImport ? Object.keys(pendingDataImport.inventory).length : 0;
  const importInventoryTotal = pendingDataImport ? Object.values(pendingDataImport.inventory).reduce((sum, count) => sum + count, 0) : 0;
  const cloudPreviewDeckCount = pendingCloudImport?.value.decks.length ?? 0;
  const cloudPreviewCandidateCount = pendingCloudImport?.value.candidates.length ?? 0;
  const cloudPreviewInventoryKinds = pendingCloudImport ? Object.keys(pendingCloudImport.value.inventory).length : 0;

  const deckSection = (label: string, metricLabel: 'COST' | 'SCORE', groups: DeckGroup[]) => groups.length > 0 && <section className="deck-section">
    <div className="deck-section-heading"><h3>{label}<span>{groups.reduce((sum, group) => sum + group.quantity, 0)}枚</span></h3></div>
    <div className="deck-groups">{groups.map((group) => <section className="deck-group" key={`${metricLabel}-${group.value ?? 'unknown'}`}>
      <h4 className={`deck-group-heading ${metricLabel === 'SCORE' ? 'live' : ''}`}><span>{metricLabel} <strong>{group.value ?? '—'}</strong></span><em>{group.quantity}枚</em></h4>
      <div className="deck-list">{group.entries.map(({ id, quantity, card }) => {
      const versions = cardsByBuilderId.get(id) ?? [card];
      const memberName = card.memberIds.map((memberId) => memberById.get(memberId)).filter(Boolean).join('・') || card.name;
      const ownership = ownershipById.get(id) as DeckOwnershipStatus;
      return <article className={`deck-row ${card.cardType}`} key={id}>
      <details className="deck-card-details"><summary><div className="deck-card-heading"><strong>{card.cardType === 'member' ? memberName : card.name}</strong><code>{id}</code></div><div className="deck-key-info">{card.member && <><span className="deck-main-metric"><small>COST</small><strong>{card.member.cost ?? '—'}</strong></span><span><small>基本ハート</small><Hearts values={card.member.hearts} /></span><span><small>ブレードハート</small><Hearts blade values={card.member.bladeHearts} /></span><span><small>ブレード</small><strong>{card.member.yell.count ?? '—'}</strong></span></>}{card.live && <><span className="deck-main-metric live"><small>SCORE</small><strong>{card.live.score ?? '—'}</strong></span><span><small>必要ハート</small><Hearts values={card.live.requiredHearts} /></span></>}</div>{card.effectText && <EffectText className="deck-effect-preview" text={card.effectText} />}<span className={`deck-ownership-status${ownership.shortageQuantity > 0 ? ' shortage' : ' complete'}`}>{ownership.shortageQuantity > 0 ? <><strong>不足 {ownership.shortageQuantity}枚</strong><span>所持 {ownership.ownedQuantity} / 必要 {quantity}</span></> : <><strong><Check /> 所持済み</strong><span>所持 {ownership.ownedQuantity} / 必要 {quantity}</span></>}</span><span className="deck-detail-hint">詳細を見る <ChevronDown /></span></summary><div className="deck-detail-body"><div className="deck-full-effect"><span>効果</span>{card.effectText ? <EffectText text={card.effectText} /> : <p>—</p>}</div><div className="deck-version-list">{versions.map((version) => <section className="deck-version" key={version.id}><div><strong>{cardVersion(version.cardNumber) ?? version.rarity ?? '通常版'}</strong><code>{version.cardNumber}</code></div><p><span>収録商品</span>{productById.get(version.productId) ?? '—'}</p><div className="card-links">{version.officialUrl && <a className="official-link" href={version.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{version.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div></section>)}</div></div></details>
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
      <p className="intro-copy">μ&apos;s、Aqours、虹ヶ咲、Liella!、蓮ノ空を中心に、ライバルグループやその他ライブを含む{cards.length}枚を収録しています。</p>
    </div><div className="total-card" aria-label="登録カード総数"><small>CARDS IN MASTER</small><strong>{cards.length}</strong><span>メンバー {memberTotal} · ライブ {liveTotal}</span></div></section>

    <section className="workspace" aria-label="カード検索">
      <nav className="group-switcher" aria-label="グループを切り替え">
        <button className={groupId === 'all' ? 'active' : ''} onClick={() => changeGroup('all')}>すべて <span>{cards.length}</span></button>
        {topGroups.map((group) => {
          const count = cards.filter((card) => card.groupIds.includes(group.id)).length;
          return <button className={groupId === group.id ? 'active' : ''} disabled={!group.enabled} key={group.id} onClick={() => changeGroup(group.id)} title={group.enabled ? `${group.label}だけ表示` : '今後追加予定'}>{group.label} <span>{count || '準備中'}</span></button>;
        })}
        <button className={otherGroupActive ? 'active' : ''} onClick={() => changeGroup('other')} title="ライバルグループとその他ライブを表示">その他 <span>{cards.filter((card) => matchesGroupFilter(card, 'other')).length}</span></button>
      </nav>
      {otherGroupActive && <nav className="rival-group-switcher" aria-label="その他のグループを切り替え">
        <div className="other-group-section"><span>ライバルグループ</span><div><button className={groupId === 'other' ? 'active' : ''} onClick={() => changeGroup('other')} type="button">すべて</button>{rivalGroups.map((group) => <button className={groupId === group.id ? 'active' : ''} key={group.id} onClick={() => changeGroup(group.id)} type="button">{group.label}</button>)}</div></div>
        {otherLiveGroup && <div className="other-group-section"><span>その他ライブ</span><div><button className={groupId === otherLiveGroup.id ? 'active' : ''} onClick={() => changeGroup(otherLiveGroup.id)} type="button">その他ライブ</button></div></div>}
      </nav>}

      <div className="filter-panel">
        <div className="search-wrap"><Search aria-hidden="true" /><Input aria-label="カード名、カード番号、効果テキストで検索" className="search-input" onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="カード名・カード番号・効果から検索" type="search" value={query} />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="検索語を消去"><X /></button>}</div>
        <div className={`select-grid${cardType === 'member' ? ' with-cost-filter' : ''}`}>
          <div className="filter-field card-type-filter"><span className="filter-label" id="card-type-label">カード種類</span><div aria-labelledby="card-type-label" className="card-type-segment" role="group"><button aria-pressed={cardType === 'all'} className={cardType === 'all' ? 'active' : ''} onClick={() => changeCardType('all')} type="button">すべて</button><button aria-pressed={cardType === 'member'} className={cardType === 'member' ? 'active' : ''} onClick={() => changeCardType('member')} type="button">メンバー</button><button aria-pressed={cardType === 'live'} className={cardType === 'live' ? 'active' : ''} onClick={() => changeCardType('live')} type="button">ライブ</button></div></div>
          {cardType !== 'live' && <MultiSelect emptyLabel="すべてのメンバー" id="member-filter" label="メンバー" memberDisplayMode={memberDisplayMode} onChange={updateMemberIds} onMemberDisplayModeChange={setMemberDisplayMode} optionGroups={memberOptionGroups} options={availableMembers} selectedIds={memberIds} />}
          {cardType === 'member' && <MultiSelect key="cost" emptyLabel="すべてのコスト" id="cost-filter" label="コスト" onChange={updateCostIds} options={availableCosts} selectedIds={costIds} />}
          {cardType === 'live' && <MultiSelect key="score" emptyLabel="すべてのスコア" id="score-filter" label="スコア" onChange={updateScoreIds} options={availableScores} selectedIds={scoreIds} />}
          <MultiSelect className="product-filter" emptyLabel="すべての商品" id="product-filter" label="収録商品" onChange={updateProductIds} options={availableProducts} selectedIds={productIds} />
          <label className="filter-field"><span className="filter-label">所持状態</span><NativeSelect className="select-control" value={inventoryFilter} onChange={(event) => { setInventoryFilter(event.target.value as InventoryFilter); setVisibleCount(PAGE_SIZE); }}><NativeSelectOption value="all">すべて</NativeSelectOption><NativeSelectOption value="owned">所持のみ</NativeSelectOption><NativeSelectOption value="unowned">未所持のみ</NativeSelectOption></NativeSelect></label>
          <label className="filter-field"><span className="filter-label"><ArrowUpDown /> 並び順</span><NativeSelect className="select-control" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>{sortOptions.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></label>
        </div>
      </div>

        <div className="result-tools">
        <div className="view-toggles"><label className="group-toggle"><input checked={groupIdenticalCards} onChange={(event) => { setGroupIdenticalCards(event.target.checked); setVisibleCount(PAGE_SIZE); }} type="checkbox" /><span>同一カードをまとめる</span></label><label className="group-toggle candidate-toggle"><input checked={candidateOnly} onChange={(event) => { setCandidateOnly(event.target.checked); setVisibleCount(PAGE_SIZE); }} type="checkbox" /><span>候補のみ表示</span></label><Button className="candidate-import-button" onClick={openCandidateImport} size="sm" type="button" variant="outline"><Bookmark />候補を一括追加</Button><Button className="cloud-sync-button" onClick={openCloudSync} size="sm" type="button" variant="outline"><Cloud />クラウド同期{hasUnsavedSyncChanges ? <span aria-label="この端末に未保存の変更があります" className="cloud-sync-dirty-dot" title="この端末に未保存の変更があります" /> : null}</Button></div>
        <div className="result-bar" aria-live="polite"><div><SlidersHorizontal aria-hidden="true" /><strong>{displayGroups.length}</strong><span>{groupIdenticalCards ? `種を表示（元カード${filteredCards.length}枚）` : '枚が見つかりました'}</span></div>{hasFilters && <Button variant="ghost" onClick={resetFilters}><X /> 条件をクリア</Button>}</div>
      </div>
      {displayGroups.length ? <div className="card-grid">{displayGroups.slice(0, visibleCount).map((group) => {
        const card = group.representative;
        const isGrouped = group.cards.length > 1;
        const productIdsInGroup = new Set(group.cards.map((version) => version.productId));
        const builderId = baseCardId(card.cardNumber);
        const isCandidate = candidateIds.has(builderId);
        const ownedTotal = ownedTotalsByBase.get(builderId) ?? 0;
        const shownOwnedCount = groupIdenticalCards ? ownedTotal : (inventory[card.id] ?? 0);
        return <article className={`card-item ${card.cardType}${shownOwnedCount > 0 ? ' inventory-owned' : ''}`} key={isGrouped ? `${group.baseCardId}:${card.id}` : card.id}>
          <div className="card-body"><Badge className="type-badge" variant="secondary">{card.cardType === 'member' ? 'MEMBER' : 'LIVE'}</Badge><div className="card-heading"><div><h2>{card.name}</h2><code>{isGrouped ? group.baseCardId : card.cardNumber}</code></div>{card.member && <span className="metric"><small>COST</small>{card.member.cost ?? '—'}</span>}{card.live && <span className="metric score"><small>SCORE</small>{card.live.score ?? '—'}</span>}</div>
            {isGrouped && <div className="version-summary"><span>バージョン</span>{group.cards.map((version) => <Badge key={version.id} variant="outline">{cardVersion(version.cardNumber) ?? version.cardNumber}</Badge>)}</div>}
            <p className="product-name">{productIdsInGroup.size === 1 ? productById.get(card.productId) : '収録商品はバージョン別'}</p><dl className="stats">{card.member && <><div><dt>基本ハート</dt><dd><Hearts values={card.member.hearts} /></dd></div><div><dt>ブレードハート</dt><dd><Hearts blade values={card.member.bladeHearts} /></dd></div><div><dt>ブレード</dt><dd>{card.member.yell.count ?? '—'}</dd></div></>}{card.live && <div><dt>必要ハート</dt><dd><Hearts values={card.live.requiredHearts} /></dd></div>}</dl>
            {card.effectText && <EffectText className="effect-text" text={card.effectText} />}
            {groupIdenticalCards ? <><div className={`inventory-total${ownedTotal > 0 ? ' owned' : ''}`}><span>所持合計</span><strong>{ownedTotal}</strong><span>枚</span></div>{!isGrouped && <InventoryStepper count={inventory[card.id] ?? 0} label={card.cardNumber} onChange={(count) => updateInventory(card.id, count)} />}</> : <InventoryStepper count={inventory[card.id] ?? 0} label={card.cardNumber} onChange={(count) => updateInventory(card.id, count)} />}
            <div className="builder-actions"><Button aria-pressed={isCandidate} className={isCandidate ? 'candidate-active' : ''} onClick={() => toggleCandidate(builderId)} size="sm" variant="outline">{isCandidate ? <Check /> : <Bookmark />}{isCandidate ? '候補中' : '候補'}</Button><Button disabled={(deck[builderId] ?? 0) >= MAX_DECK_QUANTITY} onClick={() => updateDeck(builderId, 1)} size="sm"><ListPlus />{(deck[builderId] ?? 0) >= MAX_DECK_QUANTITY ? '4枚採用中' : 'デッキに追加'}</Button></div>
            {isGrouped ? <details className="version-details"><summary>バージョンを見る（{group.cards.length}種）</summary><div className="version-list">{group.cards.map((version) => <section className="version-row" key={version.id}><div><strong>{cardVersion(version.cardNumber) ?? '仕様違い'}</strong><code>{version.cardNumber}</code></div><p><span>レアリティ</span>{version.rarity ?? cardVersion(version.cardNumber) ?? '—'}</p><p><span>収録商品</span>{productById.get(version.productId)}</p><InventoryStepper count={inventory[version.id] ?? 0} label={version.cardNumber} onChange={(count) => updateInventory(version.id, count)} /><div className="card-links">{version.officialUrl && <a className="official-link" href={version.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{version.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div></section>)}</div></details> : <div className="card-links">{card.officialUrl && <a className="official-link" href={card.officialUrl} target="_blank" rel="noreferrer">公式カード情報 <ExternalLink /></a>}{card.purchaseLinks?.filter((link) => link.shopId === 'cardlabo' && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(link.url)).map((link) => <a className="purchase-link" key={`${link.shopId}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">カードラボで購入 <ExternalLink /></a>)}</div>}
          </div></article>;
      })}</div> : <div className="empty-state"><Search /><h2>該当するカードがありません</h2><p>検索語や絞り込み条件を変更してください。</p><Button onClick={resetFilters}>条件をクリア</Button></div>}
      {visibleCount < displayGroups.length && <div className="load-more"><Button size="lg" variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>さらに表示 <span>{Math.min(PAGE_SIZE, displayGroups.length - visibleCount)}種</span></Button></div>}
    </section>
    <footer><p>非公式ファンメイドカードリスト · エネルギーカードは収録対象外です</p><p>未登録のレアリティは、確認済み情報のみ順次追加します。</p></footer>
    </div>
    <Sheet disablePointerDismissal={isDesktopDeck} modal={!isDesktopDeck} onOpenChange={setDeckOpen} open={deckOpen}><SheetTrigger className={`deck-launcher${deckOpen ? ' deck-is-open' : ''}`} aria-label={`デッキを開く、現在${deckTotal}枚`}><ListPlus /><span>デッキ</span><strong>{deckTotal}</strong></SheetTrigger><SheetContent className="deck-sheet" initialFocus={!isDesktopDeck} side="right"><SheetHeader className="deck-header"><SheetTitle>デッキ</SheetTitle><SheetDescription>メンバーはCOST別、ライブはSCORE別に表示しています。</SheetDescription><div className="active-deck-control"><label><span>現在のデッキ</span><NativeSelect value={activeDeckId} onChange={(event) => switchDeck(event.target.value)}>{decks.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></label><Button onClick={() => setDeckManagerOpen(true)} size="sm" type="button" variant="outline">デッキ管理</Button></div><div className="deck-total"><span>合計</span><strong>{deckTotal}</strong><span>枚</span></div>{deckEntries.length > 0 && <div className={`deck-shortage-summary${shortageEntries.length ? ' shortage' : ' complete'}`}><div>{shortageEntries.length ? <><strong>不足カード {shortageEntries.length}種類 / 合計{shortageTotal}枚</strong><span>所持数を更新するとすぐ再計算されます</span></> : <><strong><Check /> 必要カードをすべて所持</strong><span>このデッキの不足カードはありません</span></>}</div>{shortageEntries.length > 0 && <Button onClick={() => setShortageDialogOpen(true)} size="sm" type="button" variant="outline">不足カード一覧</Button>}</div>}<div className="deck-copy-actions"><Button onClick={copyDeckRecipe} size="sm" type="button" variant="outline">{copyFeedback === 'recipe' ? <Check /> : <Copy />}{copyFeedback === 'recipe' ? 'コピーしました' : 'デッキレシピをコピー'}</Button><Button onClick={requestAiCopy} size="sm" type="button" variant="outline">{copyFeedback === 'ai' ? <Check /> : <Bot />}{copyFeedback === 'ai' ? 'コピーしました' : 'AI相談用にコピー'}</Button></div><Button className="deck-clear-button" disabled={!deckEntries.length} onClick={() => setDeckClearConfirmOpen(true)} size="sm" type="button" variant="outline"><Trash2 />デッキを空にする</Button>{clearedDeckForUndo && <div aria-live="polite" className="deck-clear-undo"><span>デッキを空にしました</span><Button onClick={undoDeckClear} size="sm" type="button" variant="outline"><RotateCcw />元に戻す</Button></div>}{importedStateForUndo && <div aria-live="polite" className="deck-clear-undo data-import-undo"><span>{importUndoLabel}</span><Button onClick={undoDataImport} size="sm" type="button" variant="outline"><RotateCcw />元に戻す</Button></div>}<p aria-live="polite" className={`copy-feedback${copyFeedback === 'error' ? ' error' : ''}`}>{copyFeedback === 'error' ? 'コピーできませんでした' : copyFeedback ? 'クリップボードにコピーしました' : ''}</p></SheetHeader><div className="deck-scroll">{deckEntries.length ? <>{deckSection('メンバーカード', 'COST', memberDeckGroups)}{deckSection('ライブカード', 'SCORE', liveDeckGroups)}</> : <div className="deck-empty"><ListPlus /><strong>デッキは空です</strong><p>カード一覧の「デッキに追加」から選べます。</p></div>}</div></SheetContent></Sheet>
    <Dialog onOpenChange={setShortageDialogOpen} open={shortageDialogOpen}><DialogContent className="shortage-dialog"><DialogHeader><DialogTitle>不足カード一覧</DialogTitle><DialogDescription>「{activeDeck.name}」を実物で組むために不足しているカードです。所持数は同一baseCardIdの全バージョンを合算しています。</DialogDescription></DialogHeader><div className="shortage-list">{shortageEntries.map((entry) => <section key={entry.id}><div><strong>{entry.card.name}</strong><code>{entry.id}</code></div><dl><div><dt>必要</dt><dd>{entry.quantity}</dd></div><div><dt>所持</dt><dd>{entry.ownedQuantity}</dd></div><div><dt>不足</dt><dd>{entry.shortageQuantity}</dd></div></dl></section>)}</div><DialogFooter className="shortage-footer"><DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose><Button onClick={copyShortageCards} type="button">{shortageCopyFeedback === 'success' ? <Check /> : <Copy />}{shortageCopyFeedback === 'success' ? 'コピーしました' : '不足カードをコピー'}</Button></DialogFooter>{shortageCopyFeedback === 'error' && <p aria-live="polite" className="shortage-copy-error">コピーできませんでした</p>}</DialogContent></Dialog>
    <Dialog onOpenChange={setAiCandidateDialogOpen} open={aiCandidateDialogOpen}><DialogContent className="ai-candidate-dialog"><DialogHeader><DialogTitle>AI相談に含める候補カード</DialogTitle><DialogDescription>今回のコピーに含めるカードだけ選択してください。元の候補状態は変わりません。</DialogDescription></DialogHeader><div className="ai-candidate-tools"><Button onClick={() => setSelectedAiCandidateIds(new Set(availableAiCandidates.map((entry) => entry.id)))} size="sm" type="button" variant="outline">すべて選択</Button><Button disabled={!selectedAiCandidateIds.size} onClick={() => setSelectedAiCandidateIds(new Set())} size="sm" type="button" variant="outline">すべて解除</Button></div><div className="ai-candidate-list">{availableAiCandidates.map(({ id, card }) => <label className="ai-candidate-option" key={id}><input checked={selectedAiCandidateIds.has(id)} onChange={() => toggleAiCandidate(id)} type="checkbox" /><span><strong>{card.name}</strong><code>{id}</code><small>{card.cardType === 'member' ? `COST ${card.member?.cost ?? '—'}` : `SCORE ${card.live?.score ?? '—'}`}</small></span></label>)}</div><DialogFooter className="ai-candidate-footer"><DialogClose render={<Button type="button" variant="outline" />}>キャンセル</DialogClose><Button onClick={copyAiWithCandidates} type="button"><Copy />この内容でコピー</Button></DialogFooter></DialogContent></Dialog>
    <Dialog onOpenChange={setCandidateImportOpen} open={candidateImportOpen}><DialogContent className="candidate-import-dialog"><DialogHeader><DialogTitle>候補を一括追加</DialogTitle><DialogDescription>AIの「候補一括追加用」ブロック、またはカード番号を貼り付けてください。推奨枚数は候補追加には使用しません。</DialogDescription></DialogHeader><textarea aria-label="候補に追加するカード番号" className="candidate-import-textarea" onChange={(event) => { setCandidateImportText(event.target.value); setCandidateImportResult(null); }} placeholder={'PL!SP-bp1-012 | 澁谷かのん | 4\nPL!SP-bp1-001 | 澁谷かのん | 4'} value={candidateImportText} />{candidateImportResult && <div aria-live="polite" className="candidate-import-result">{candidateImportResult.recognized ? <><strong>{candidateImportResult.recognized}種類を認識しました</strong><span>新しく候補に追加：{candidateImportResult.added}種類</span><span>すでに候補：{candidateImportResult.existing}種類</span>{candidateImportResult.usedSection && <span>「候補一括追加用」セクションを優先して解析しました</span>}{candidateImportResult.unknown.length > 0 && <span>確認できなかったカード：{candidateImportResult.unknown.join('、')}</span>}</> : <><strong>追加できるカード番号を確認できませんでした</strong>{candidateImportResult.unknown.length > 0 && <span>確認できなかったカード：{candidateImportResult.unknown.join('、')}</span>}</>}</div>}<DialogFooter className="candidate-import-footer"><DialogClose render={<Button type="button" variant="outline" />}>キャンセル</DialogClose><Button onClick={importCandidates} type="button"><Bookmark />候補に追加</Button></DialogFooter></DialogContent></Dialog>
    <Dialog onOpenChange={setDataTransferOpen} open={dataTransferOpen}>
      <DialogContent className="data-transfer-dialog">
        <DialogHeader><DialogTitle>データ移行</DialogTitle><DialogDescription>全デッキ・共通候補・所持カードを、別の端末へ移せます。検索条件や表示状態は含まれません。</DialogDescription></DialogHeader>
        {dataTransferView === 'menu' && <div className="data-transfer-menu"><Button onClick={() => setDataTransferView('export')} type="button" variant="outline"><strong>エクスポート</strong><span>全デッキ・候補・所持カードをJSONで書き出す</span></Button><Button onClick={() => setDataTransferView('import')} type="button" variant="outline"><strong>インポート</strong><span>JSONを検証してから保存データを置き換える</span></Button></div>}
        {dataTransferView === 'export' && <><div className="data-transfer-heading"><button onClick={() => setDataTransferView('menu')} type="button">← 戻る</button><strong>エクスポート</strong></div><textarea aria-label="エクスポートするJSON" className="candidate-import-textarea data-transfer-textarea" readOnly value={exportDataText} /><div className="data-transfer-actions"><Button onClick={copyDataExport} type="button">{dataTransferCopyFeedback === 'success' ? <Check /> : <Copy />}{dataTransferCopyFeedback === 'success' ? 'コピーしました' : 'データをコピー'}</Button><Button onClick={downloadDataExport} type="button" variant="outline">JSONファイルとして保存</Button></div>{dataTransferCopyFeedback === 'error' && <p aria-live="polite" className="data-transfer-copy-error">コピーできませんでした</p>}</>}
        {dataTransferView === 'import' && <><div className="data-transfer-heading"><button onClick={() => setDataTransferView('menu')} type="button">← 戻る</button><strong>インポート</strong></div><textarea aria-label="インポートするJSON" className="candidate-import-textarea data-transfer-textarea" onChange={(event) => { setDataTransferText(event.target.value); setDataTransferErrors([]); }} placeholder={'{\n  "format": "loveca-card-list-state",\n  "version": 3,\n  ...\n}'} value={dataTransferText} />{dataTransferErrors.length > 0 && <div aria-live="polite" className="data-transfer-errors"><strong>インポートできませんでした</strong>{dataTransferErrors.map((error) => <span key={error}>・{error}</span>)}</div>}<div className="data-transfer-actions"><Button onClick={reviewDataImport} type="button">内容を確認</Button></div></>}
        {dataTransferView === 'preview' && pendingDataImport && <><div className="data-transfer-heading"><button onClick={() => setDataTransferView('import')} type="button">← 戻る</button><strong>インポートするデータ</strong></div><div className="data-transfer-deck-preview"><strong>{importDeckPreviews.length}デッキ</strong>{importDeckPreviews.map((item) => <section key={item.id}><h3>{item.name}{item.id === pendingDataImport.activeDeckId && <span>選択中</span>}</h3><dl><div><dt>メンバー</dt><dd>{item.memberTotal}枚</dd></div><div><dt>ライブ</dt><dd>{item.liveTotal}枚</dd></div><div><dt>合計</dt><dd>{item.total}枚</dd></div></dl></section>)}</div><div className={`data-transfer-preview-note${!pendingDataImport.hasInventoryData ? ' legacy-warning' : ''}`}><strong>候補：{pendingDataImport.candidates.length}種類</strong><strong>所持：{importInventoryKinds}種類・合計{importInventoryTotal}枚</strong><span>現在の全デッキ・候補・所持情報は、この内容に置き換えられます。</span>{pendingDataImport.sourceVersion === 1 && <span>version 1のデータは「デッキ1」として読み込みます。</span>}{!pendingDataImport.hasInventoryData && <span>このデータには所持カード情報がありません。インポートすると現在の所持情報も消去されます。</span>}</div><div className="data-transfer-actions"><Button onClick={confirmDataImport} type="button">インポートする</Button><Button onClick={() => setDataTransferOpen(false)} type="button" variant="outline">キャンセル</Button></div></>}
        {dataTransferView !== 'preview' && <DialogFooter className="data-transfer-footer"><DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose></DialogFooter>}
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={setSyncDialogOpen} open={syncDialogOpen}>
      <DialogContent className="cloud-sync-dialog">
        <DialogHeader><DialogTitle>クラウド同期</DialogTitle><DialogDescription>デッキ・候補・所持カードを、同期コードを使って手動で共有します。検索条件や表示設定は同期しません。</DialogDescription></DialogHeader>
        {syncView === 'main' && !syncCode && <div className="cloud-sync-unconnected"><Button disabled={syncBusy} onClick={createSyncConnection} type="button"><CloudUpload />{syncBusy ? '作成中…' : '同期コードを作成'}</Button><Button disabled={syncBusy} onClick={() => { setSyncView('connect'); setSyncMessage(null); }} type="button" variant="outline"><CloudDownload />既存の同期コードを入力</Button><p>同期コードを作成すると、現在の全デッキ・候補・所持カードが初期データとして保存されます。</p></div>}
        {syncView === 'connect' && <div className="cloud-sync-connect"><div className="data-transfer-heading"><button onClick={() => setSyncView('main')} type="button">← 戻る</button><strong>既存コードへ接続</strong></div><label htmlFor="cloud-sync-code-input"><span>同期コード</span><Input autoCapitalize="characters" autoComplete="off" id="cloud-sync-code-input" onChange={(event) => { setSyncCodeInput(event.target.value); setSyncMessage(null); }} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" spellCheck={false} value={syncCodeInput} /></label><p>コードを確認後、クラウド内容のプレビューを表示します。この時点では端末データを変更しません。</p><Button disabled={syncBusy || !syncCodeInput.trim()} onClick={() => void prepareCloudImport(syncCodeInput)} type="button">{syncBusy ? '確認中…' : 'クラウド内容を確認'}</Button></div>}
        {syncView === 'main' && syncCode && <div className="cloud-sync-connected"><div className="cloud-sync-code"><span>同期コード</span><strong>{formatSyncCode(syncCode)}</strong><Button onClick={copySyncCode} size="sm" type="button" variant="outline">{syncCodeCopied ? <Check /> : <Copy />}{syncCodeCopied ? 'コピーしました' : 'コピー'}</Button></div><p className="cloud-sync-warning">このコードを知っている人は同期データへアクセスできます。第三者へ公開せず、安全に保管してください。</p>{hasUnsavedSyncChanges && <p aria-live="polite" className="cloud-sync-local-change">この端末に未保存の変更があります。</p>}<dl className="cloud-sync-meta"><div><dt>クラウド最終更新</dt><dd>{formatSyncDate(syncMetadata?.cloudUpdatedAt)}</dd></div><div><dt>この端末の最終同期</dt><dd>{formatSyncDate(syncMetadata?.lastSyncedAt)}</dd></div><div><dt>revision</dt><dd>{syncMetadata?.revision ?? '未確認'}</dd></div></dl><div className="cloud-sync-actions"><Button disabled={syncBusy || !syncMetadata} onClick={() => void saveToCloud(false)} type="button"><CloudUpload />{syncBusy ? '処理中…' : 'クラウドへ保存'}</Button><Button disabled={syncBusy} onClick={() => requestCloudImport(syncCode)} type="button" variant="outline"><CloudDownload />クラウドから読み込み</Button></div>{!syncMetadata && <p className="cloud-sync-note">同期状態を確認するため、先に「クラウドから読み込み」を実行してください。</p>}<section className="cloud-sync-history"><div className="cloud-sync-history-header"><h3>過去の状態</h3><Button disabled={syncBusy || syncHistoryLoading} onClick={() => void refreshSyncHistory(syncCode)} size="sm" type="button" variant="ghost">{syncHistoryLoading ? '確認中…' : '更新'}</Button></div>{syncHistoryLoading && syncHistory.length === 0 ? <p className="cloud-sync-history-empty">過去の状態を確認しています…</p> : syncHistory.length === 0 ? <p className="cloud-sync-history-empty">過去の状態はまだありません</p> : <div className="cloud-sync-history-list">{syncHistory.map((item) => <section className={selectedSyncHistory?.id === item.id ? 'selected' : ''} key={item.id}><div><strong>{formatSyncDate(item.savedAt)}</strong><span>元revision {item.sourceRevision}</span><span>デッキ {item.deckCount}件・候補 {item.candidateCount}種類・所持 {item.inventoryCount}種類</span></div><Button aria-pressed={selectedSyncHistory?.id === item.id} disabled={syncBusy} onClick={() => setSelectedSyncHistory(item)} size="sm" type="button" variant="outline">内容を見る</Button></section>)}</div>}{selectedSyncHistory && <div className="cloud-sync-history-selected"><strong>{formatSyncDate(selectedSyncHistory.savedAt)} の状態</strong><span>デッキ {selectedSyncHistory.deckCount}件・候補 {selectedSyncHistory.candidateCount}種類・所持 {selectedSyncHistory.inventoryCount}種類</span><Button disabled={syncBusy || !syncMetadata} onClick={() => setSyncHistoryRestoreOpen(true)} size="sm" type="button" variant="outline">この状態に戻す</Button></div>}</section><Button className="cloud-sync-disconnect" disabled={syncBusy} onClick={disconnectCloudSync} size="sm" type="button" variant="ghost">この端末の同期を解除</Button></div>}
        {syncView === 'preview' && pendingCloudImport && <div className="cloud-sync-preview"><div className="data-transfer-heading"><button onClick={() => { setPendingCloudImport(null); setSyncView(syncCode ? 'main' : 'connect'); }} type="button">← 戻る</button><strong>クラウドから読み込む内容</strong></div><dl><div><dt>デッキ</dt><dd>{cloudPreviewDeckCount}件</dd></div><div><dt>候補</dt><dd>{cloudPreviewCandidateCount}種類</dd></div><div><dt>所持登録</dt><dd>{cloudPreviewInventoryKinds}種類</dd></div><div><dt>クラウド更新</dt><dd>{formatSyncDate(pendingCloudImport.updatedAt)}</dd></div></dl><p>現在のこの端末の全デッキ・候補・所持カードを、クラウド状態で置き換えます。実行直後は1回だけ元に戻せます。</p><div className="cloud-sync-actions"><Button onClick={confirmCloudImport} type="button">この内容を読み込む</Button><Button onClick={() => setSyncDialogOpen(false)} type="button" variant="outline">キャンセル</Button></div></div>}
        {syncView === 'conflict' && <div className="cloud-sync-conflict"><strong>別の端末で更新されています</strong><p>古い状態からの保存は中止しました。最新のクラウドデータを読み込むか、操作をキャンセルしてください。</p><div className="cloud-sync-actions"><Button disabled={syncBusy || !syncCode} onClick={() => syncCode && requestCloudImport(syncCode)} type="button"><CloudDownload />最新データを読み込む</Button><Button onClick={() => { setSyncView('main'); setSyncMessage(null); setSyncForceConfirm(false); }} type="button" variant="outline">キャンセル</Button></div>{!syncForceConfirm ? <button className="cloud-force-link" onClick={() => setSyncForceConfirm(true)} type="button">現在の端末データで上書きする場合</button> : <div className="cloud-force-confirm" role="alert"><strong>本当にクラウドを上書きしますか？</strong><p>別端末の最新データは失われます。</p><div><Button disabled={syncBusy} onClick={() => void saveToCloud(true)} type="button" variant="destructive">上書きを実行</Button><Button onClick={() => setSyncForceConfirm(false)} type="button" variant="outline">戻る</Button></div></div>}</div>}
        {syncMessage && <p aria-live="polite" className={`cloud-sync-message ${syncMessage.kind}`}>{syncMessage.text}</p>}
        <DialogFooter className="cloud-sync-footer"><DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={(open) => { setCloudLoadDirtyConfirmOpen(open); if (!open) setPendingDirtyCloudLoadCode(null); }} open={cloudLoadDirtyConfirmOpen}>
      <DialogContent className="cloud-load-dirty-dialog">
        <DialogHeader><DialogTitle>クラウドから読み込みますか？</DialogTitle><DialogDescription>この端末にクラウドへ保存していない変更があります。クラウドから読み込むと、この端末の現在データは置き換えられます。</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={() => { setCloudLoadDirtyConfirmOpen(false); setPendingDirtyCloudLoadCode(null); }} type="button" variant="outline">キャンセル</Button><Button onClick={confirmDirtyCloudLoad} type="button">クラウド内容を確認する</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={setSyncHistoryRestoreOpen} open={syncHistoryRestoreOpen}>
      <DialogContent className="cloud-history-restore-dialog">
        <DialogHeader><DialogTitle>過去のクラウド状態へ戻しますか？</DialogTitle><DialogDescription>{selectedSyncHistory ? `${formatSyncDate(selectedSyncHistory.savedAt)}（元revision ${selectedSyncHistory.sourceRevision}）の内容を復元します。` : '選択した過去の状態を復元します。'}</DialogDescription></DialogHeader>
        {selectedSyncHistory && <dl className="cloud-history-restore-summary"><div><dt>デッキ</dt><dd>{selectedSyncHistory.deckCount}件</dd></div><div><dt>候補</dt><dd>{selectedSyncHistory.candidateCount}種類</dd></div><div><dt>所持登録</dt><dd>{selectedSyncHistory.inventoryCount}種類</dd></div></dl>}
        <p className="cloud-history-restore-note">現在のクラウド最新版は置き換わります。復元内容は過去のrevisionへ巻き戻さず、新しいrevisionとして保存されます。復元前の最新版も履歴へ残ります。</p>
        <DialogFooter><Button disabled={syncBusy} onClick={() => setSyncHistoryRestoreOpen(false)} type="button" variant="outline">キャンセル</Button><Button disabled={syncBusy || !selectedSyncHistory || !syncMetadata} onClick={() => void restoreSelectedCloudHistory()} type="button">{syncBusy ? '復元中…' : 'この状態に戻す'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={setDeckManagerOpen} open={deckManagerOpen}>
      <DialogContent className="deck-manager-dialog">
        <DialogHeader><DialogTitle>デッキ管理</DialogTitle><DialogDescription>デッキは自動保存されます。候補カードはすべてのデッキで共通です。</DialogDescription></DialogHeader>
        <div className="deck-manager-actions"><Button onClick={createNewDeck} type="button">新規デッキ作成</Button><Button onClick={duplicateActiveDeck} type="button" variant="outline">現在のデッキを複製</Button></div>
        <div className="deck-manager-list">{decks.map((item) => <section className={item.id === activeDeckId ? 'active' : ''} key={item.id}>{renameDeckId === item.id ? <div className="deck-rename-form"><Input aria-label="新しいデッキ名" maxLength={60} onChange={(event) => setRenameDeckName(event.target.value)} value={renameDeckName} /><Button disabled={!renameDeckName.trim()} onClick={saveDeckName} size="sm" type="button">保存</Button><Button onClick={() => setRenameDeckId(null)} size="sm" type="button" variant="outline">キャンセル</Button></div> : <><button className="deck-manager-select" onClick={() => { switchDeck(item.id); setDeckManagerOpen(false); }} type="button"><strong>{item.name}</strong><span>{Object.values(item.cards).reduce((sum, quantity) => sum + quantity, 0)}枚{item.id === activeDeckId ? '・選択中' : ''}</span></button><div className="deck-manager-row-actions"><Button onClick={() => startRenameDeck(item)} size="sm" type="button" variant="outline">名前変更</Button><Button disabled={decks.length <= 1} onClick={() => setDeleteDeckId(item.id)} size="sm" type="button" variant="outline">削除</Button></div></>}</section>)}</div>
        <DialogFooter className="deck-manager-footer"><DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog onOpenChange={(open) => { if (!open) setDeleteDeckId(null); }} open={Boolean(deleteDeckId)}><DialogContent className="deck-delete-dialog"><DialogHeader><DialogTitle>デッキを削除しますか？</DialogTitle><DialogDescription>「{decks.find((item) => item.id === deleteDeckId)?.name ?? ''}」を削除します。この操作では候補カードは削除されません。</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDeleteDeckId(null)} type="button" variant="outline">キャンセル</Button><Button onClick={confirmDeleteDeck} type="button" variant="destructive">削除する</Button></DialogFooter></DialogContent></Dialog>
    <Dialog onOpenChange={setDeckClearConfirmOpen} open={deckClearConfirmOpen}><DialogContent className="deck-clear-dialog"><DialogHeader><DialogTitle>デッキを空にしますか？</DialogTitle><DialogDescription>「{activeDeck.name}」の現在のデッキ{deckTotal}枚をすべて削除します。候補や他のデッキは変更されません。</DialogDescription></DialogHeader><dl className="deck-clear-summary"><div><dt>メンバー</dt><dd>{memberDeckTotal}枚</dd></div><div><dt>ライブ</dt><dd>{liveDeckTotal}枚</dd></div><div><dt>合計</dt><dd>{deckTotal}枚</dd></div></dl><DialogFooter className="deck-clear-footer"><DialogClose render={<Button type="button" variant="outline" />}>キャンセル</DialogClose><Button onClick={clearDeck} type="button" variant="destructive"><Trash2 />デッキを空にする</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
