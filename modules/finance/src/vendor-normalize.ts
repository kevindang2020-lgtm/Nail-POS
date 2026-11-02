// vendor-normalize.ts — one vendor behind many spellings (mandate §44–46).
//
// "HOME DEPOT #4102", "THE HOME DEPOT" and "Home Depot" are one vendor. The receipt's own words are evidence and are
// kept as written (expenses.vendor); this produces the comparison form used to find the salon's vendor and to key its
// learned category rules. Careful by design (§45): it removes store numbers, punctuation, a leading "the" and legal
// suffixes — it never merges two names that differ in a real word.

const LEGAL_SUFFIX = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|lp|llp|pc|pllc)\b\.?$/;
const STORE_NO = /(\s*(#|no\.?|store|str|location|loc)\s*\d+[a-z]?\b)|(\s+\d{3,}$)/g;

export function normalizeVendorName(raw: string | null | undefined): string {
  let s = String(raw ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/&/g, ' and ').replace(/['’`]/g, '');
  s = s.replace(STORE_NO, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL_SUFFIX, '').trim();
  s = s.replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}

/** Token overlap 0..1 between two normalized names — for "did you mean" vendor suggestions, never for silent merges. */
export function vendorSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeVendorName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeVendorName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let common = 0; for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

/** The salon's vendor for these receipt words: an exact normalized match, else null (a near match is a suggestion). */
export function matchVendor<V extends { id: string; name: string }>(raw: string | null | undefined, vendors: readonly V[]): { vendor: V | null; suggestions: V[] } {
  const norm = normalizeVendorName(raw);
  if (!norm) return { vendor: null, suggestions: [] };
  const exact = vendors.find((v) => normalizeVendorName(v.name) === norm) ?? null;
  if (exact) return { vendor: exact, suggestions: [] };
  const suggestions = vendors.map((v) => ({ v, s: vendorSimilarity(raw ?? '', v.name) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.v);
  return { vendor: null, suggestions };
}
