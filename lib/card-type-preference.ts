export const CARD_TYPE_STORAGE_KEY = 'loveca-card-list:card-type:v1';

export type CardTypeFilter = 'all' | 'member' | 'live';

export function normalizeCardTypeFilter(value: unknown): CardTypeFilter {
  return value === 'member' || value === 'live' || value === 'all' ? value : 'all';
}
