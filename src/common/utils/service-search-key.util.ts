const SEARCH_STOP_WORDS = new Set([
  'a',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'para',
  'por',
  'um',
  'uma',
]);

/**
 * Canonical key used exclusively by tolerant service search.
 *
 * It deliberately differs from normalized_service_key: articles are removed
 * and all separators are collapsed, so "subleito" and "sub-leito" match.
 */
export function normalizeServiceSearchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => term && !SEARCH_STOP_WORDS.has(term))
    .join('')
    .slice(0, 255);
}
