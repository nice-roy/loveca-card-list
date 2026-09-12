export const GROUP_STORAGE_KEY = 'loveca-card-list:group:v1';

export function normalizeGroupPreference(value: unknown, availableGroupIds: ReadonlySet<string>): string {
  if (value === 'rivals' && availableGroupIds.has('other')) return 'other';
  return typeof value === 'string' && availableGroupIds.has(value) ? value : 'all';
}
