'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { groupProductOptions, PRODUCT_SORT_OPTIONS, type ProductOption, type ProductSort } from '@/lib/product-filter';

export function ProductFilter({ options, selectedIds, onChange }: {
  options: ProductOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProductSort>('numberDesc');
  const listRef = useRef<HTMLDivElement>(null);
  const openingScroll = useRef<{ left: number; top: number } | null>(null);
  const groups = useMemo(() => groupProductOptions(options, query, sort), [options, query, sort]);
  const selected = options.filter((option) => selectedIds.includes(option.id));
  const matchingCount = groups.reduce((count, group) => count + group.options.length, 0);
  const summary = selected.length === 0 ? 'すべての商品' : selected.length === 1 ? selected[0].label : `${selected.length}件選択中`;
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  const restoreScroll = () => {
    if (openingScroll.current) window.scrollTo({ ...openingScroll.current, behavior: 'instant' });
  };

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, sort]);

  return <div className="filter-field multi-select-field product-filter">
    <span className="filter-label" id="product-filter-label">収録商品</span>
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) {
        openingScroll.current = { left: window.scrollX, top: window.scrollY };
        setQuery('');
      }
      restoreScroll();
      setOpen(nextOpen);
    }} onOpenChangeComplete={() => restoreScroll()}>
      <DialogTrigger aria-labelledby="product-filter-label product-filter-summary" className="multi-select-trigger">
        <span id="product-filter-summary">{summary}</span><ChevronDown aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="product-picker-dialog" showCloseButton={false} initialFocus={() => {
        restoreScroll();
        // 検索入力の自動フォーカスでスマホのキーボードを開かない。
        listRef.current?.focus({ preventScroll: true });
        return false;
      }}>
        <DialogHeader className="product-picker-header">
          <div><DialogTitle>収録商品を選ぶ</DialogTitle><DialogClose aria-label="収録商品の選択を閉じる" render={<Button size="icon-sm" type="button" variant="ghost" />}><X aria-hidden="true" /></DialogClose></div>
          <DialogDescription>複数選択できます。商品名や略号で検索し、並び順を切り替えられます。</DialogDescription>
          <div className="product-picker-tools">
            <label className="product-picker-search"><Search aria-hidden="true" /><input aria-label="商品名・略号で検索" placeholder="商品名・略号で検索（BP8、まじかる…）" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="商品検索をクリア" type="button" onClick={() => setQuery('')}><X aria-hidden="true" /></button>}</label>
            <label className="product-picker-sort"><span>商品の並び順</span><select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}>{PRODUCT_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <div className="product-picker-status"><span aria-live="polite">{matchingCount}商品を表示・選択中 {selected.length}件</span><button type="button" disabled={!selected.length} onClick={() => onChange([])}>すべて解除</button></div>
        </DialogHeader>
        <div aria-label="商品一覧" className="product-picker-list" ref={listRef} tabIndex={0}>
          {matchingCount === 0 ? <p className="product-picker-empty">一致する商品がありません。検索語を変えてください。</p> : groups.map((group) => <section className="product-picker-section" key={group.id}>
            {group.label && <h3>{group.label}</h3>}
            {group.options.map((option) => <label className="product-picker-option" key={option.id}>
              <input aria-label={option.label} type="checkbox" checked={selectedIds.includes(option.id)} onChange={() => toggle(option.id)} />
              <span>{option.code && <span className="product-picker-code">{option.code}</span>}<span className="product-picker-name">{option.name}</span></span>
            </label>)}
          </section>)}
        </div>
        <div className="product-picker-footer"><span>選択中 {selected.length}件</span><DialogClose render={<Button type="button" />}>完了</DialogClose></div>
      </DialogContent>
    </Dialog>
    {selected.length > 0 && <div className="selected-chips" aria-label="収録商品の選択中条件">
      <button className="filter-chip clear-all-chip" onClick={() => onChange([])} type="button">すべて解除</button>
      {selected.map((option) => <button aria-label={`${option.label}を解除`} className="filter-chip" key={option.id} onClick={() => toggle(option.id)} type="button"><span>{option.label}</span><X aria-hidden="true" /></button>)}
    </div>}
  </div>;
}
