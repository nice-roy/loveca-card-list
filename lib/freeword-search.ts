/**
 * Splits a free-word query into normalized AND-search terms.
 * Both half-width and full-width spaces are treated as separators.
 */
export function splitFreewordSearchTerms(query: string) {
  return query
    .trim()
    .split(/[\s\u3000]+/u)
    .filter(Boolean)
    .map(normalizeFreewordSearchText);
}

/**
 * Normalizes only case and whitespace for free-word comparison.
 * Display strings remain untouched; this lets names match with or without
 * half-width, full-width, or repeated spaces.
 */
export function normalizeFreewordSearchText(value: string) {
  return value
    .toLocaleLowerCase('ja')
    .replace(/[\s\u3000]+/gu, '');
}

/**
 * Matches when every query term occurs somewhere in the existing card search text.
 */
export function matchesFreewordSearch(searchText: string, query: string) {
  const terms = splitFreewordSearchTerms(query);
  if (terms.length === 0) return true;

  const normalizedText = normalizeFreewordSearchText(searchText);
  return terms.every((term) => normalizedText.includes(term));
}
