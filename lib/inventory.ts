export const INVENTORY_STORAGE_KEY = 'loveca-card-list:inventory:v1';
export const MAX_OWNED_QUANTITY = 99;

export type InventoryQuantities = Record<string, number>;
export type InventoryFilter = 'all' | 'owned' | 'unowned';

export function normalizeInventory(value: unknown, validVersionIds: Set<string>): InventoryQuantities {
  const source = value && typeof value === 'object' && !Array.isArray(value) && 'cards' in value
    ? (value as { cards?: unknown }).cards
    : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const inventory: InventoryQuantities = {};
  for (const [versionId, count] of Object.entries(source)) {
    if (!validVersionIds.has(versionId) || !Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_OWNED_QUANTITY) continue;
    inventory[versionId] = count as number;
  }
  return inventory;
}

export function setOwnedQuantity(inventory: InventoryQuantities, versionId: string, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > MAX_OWNED_QUANTITY) return inventory;
  const next = { ...inventory };
  if (count === 0) delete next[versionId];
  else next[versionId] = count;
  return next;
}

export function changeOwnedQuantity(inventory: InventoryQuantities, versionId: string, delta: number) {
  const current = inventory[versionId] ?? 0;
  return setOwnedQuantity(inventory, versionId, Math.max(0, Math.min(MAX_OWNED_QUANTITY, current + delta)));
}

export function inventoryTotalsByBase(inventory: InventoryQuantities, versionToBase: Map<string, string>) {
  const totals = new Map<string, number>();
  for (const [versionId, count] of Object.entries(inventory)) {
    const baseId = versionToBase.get(versionId);
    if (baseId) totals.set(baseId, (totals.get(baseId) ?? 0) + count);
  }
  return totals;
}

export function matchesInventoryFilter(filter: InventoryFilter, versionId: string, baseId: string, groupIdenticalCards: boolean, inventory: InventoryQuantities, totalsByBase: Map<string, number>) {
  if (filter === 'all') return true;
  const owned = groupIdenticalCards ? (totalsByBase.get(baseId) ?? 0) > 0 : (inventory[versionId] ?? 0) > 0;
  return filter === 'owned' ? owned : !owned;
}
