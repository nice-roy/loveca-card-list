/**
 * Splits a free-word query into normalized AND-search terms.
 * Both half-width and full-width spaces are treated as separators.
 */
export function splitFreewordSearchTerms(query: string) {
  return query
    .trim()
    .split(/[\s\u3000]+/u)
    .filter(Boolean)
    .map((term) => term.toLocaleLowerCase('ja'));
}

/**
 * Matches when every query term occurs somewhere in the existing card search text.
 */
export function matchesFreewordSearch(searchText: string, query: string) {
  const terms = splitFreewordSearchTerms(query);
  if (terms.length === 0) return true;

  const normalizedText = searchText.toLocaleLowerCase('ja');
  return terms.every((term) => normalizedText.includes(term));
}
