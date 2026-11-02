// viScan.testkit.ts — test helper for the Vietnamese POS screen tests (mandate WP-C2 / WP-C3): finds English left on a
// screen rendered in Vietnamese. Used only by *.vi.test.tsx files (never imported by the app).
//
// A text node (or a read attribute: placeholder, title, aria-label, alt) counts as leftover English when it has NO
// Vietnamese letter (no non-ASCII letter at all) and contains an ASCII word of ≥ 2 letters that is not allowed. Vietnamese
// text nearly always carries a diacritic, so a node like "Chi nhánh" is skipped as a whole — that is what keeps short
// ASCII-only Vietnamese syllables ("Chi", "tin", "cho") from being mistaken for English.
//
// Always allowed: brand / product names, units and abbreviations the Vietnamese POS keeps as written (BRAND_WORDS).
// Each test adds its fixture data (customer names, plan names typed by the salon, …) as `allow`.
import { POS_VI } from '../i18n/catalog.vi';
import { NAMESPACES_VI } from '../i18n/ns';

/** any character outside 7-bit ASCII (a Vietnamese letter, once the punctuation symbols are removed) */
const hasNonAscii = (s: string) => [...s].some((c) => c.charCodeAt(0) > 127);

export const BRAND_WORDS = [
  'AIPowerSalon', 'POS', 'AI', 'SMS', 'MMS', 'VIP', 'Email', 'email', 'CSV', 'Excel', 'PDF', 'SKU', 'ID', 'PIN', 'QR', 'OK', 'Google', 'Apple',
  'Stripe', 'Twilio', 'Fiserv', 'Wi', 'Fi', 'USD', 'VND', 'AM', 'PM', 'CH', 'SA',
  'English', 'tip', 'Tip', 'Instagram', 'Facebook', 'TikTok',
  'DV',    // approved Vietnamese abbreviation of "dịch vụ" (pos.svc)
  'thg',   // Vietnamese short month in Intl dates ("04 thg 5, 2026")
];

// Vietnamese syllables that happen to be plain ASCII ("Trong ca", "Trang 1 / 1", "Chi tiết"): every ASCII word that
// occurs inside a real Vietnamese catalogue string (one with at least one Vietnamese letter). Built from the catalogues,
// so a new Vietnamese string never needs a hand-kept list; an English word ("active") never occurs in one.
let viSyllables: Set<string> | null = null;
function vietnameseAsciiWords(): Set<string> {
  if (viSyllables) return viSyllables;
  viSyllables = new Set();
  for (const cat of [POS_VI as Record<string, string>, ...NAMESPACES_VI]) {
    for (const v of Object.values(cat)) {
      if (!v || !hasNonAscii(v)) continue;
      for (const w of v.match(/[A-Za-z]{2,}/g) ?? []) viSyllables.add(w.toLowerCase());
    }
  }
  return viSyllables;
}

const READ_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

const isLetterish = (s: string) => /\p{L}/u.test(s);

/** every piece of text a person reads: text nodes + the read attributes; <script>/<style> excluded */
export function readableTexts(root: ParentNode): string[] {
  const out: string[] = [];
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (p && (p.closest('script,style') || p.closest('[aria-hidden="true"]'))) continue;
    const s = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    if (s && isLetterish(s)) out.push(s);
  }
  for (const el of Array.from((root as ParentNode).querySelectorAll('*'))) {
    for (const a of READ_ATTRS) { const v = el.getAttribute(a); if (v && isLetterish(v)) out.push(v.trim()); }
    // a <select>'s chosen option is read even when its text node is hidden by the browser; options are text nodes above
  }
  return out;
}

/** the leftover English pieces of text (empty = the screen reads in Vietnamese) */
export function leftoverEnglish(root: ParentNode, allow: readonly string[] = []): string[] {
  const ok = new Set([...BRAND_WORDS, ...allow.flatMap((a) => a.split(/[^A-Za-z]+/))].filter(Boolean).map((w) => w.toLowerCase()));
  const vi = vietnameseAsciiWords();
  const bad = new Set<string>();
  for (const s of readableTexts(root)) {
    if (hasNonAscii(s.replace(/[—–·…’‘“”•×→←✓✕★€£₫\u00a0−]/g, ''))) continue;   // has a Vietnamese letter → Vietnamese text
    const words = s.match(/[A-Za-z]{2,}/g) ?? [];
    if (words.some((w) => !ok.has(w.toLowerCase()) && !vi.has(w.toLowerCase()))) bad.add(s);
  }
  return [...bad];
}
