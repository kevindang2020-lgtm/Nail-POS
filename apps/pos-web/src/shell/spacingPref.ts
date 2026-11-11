// spacingPref.ts — the person-chosen spacing for THIS device (Nov 10 2026, Kevin: "pick and continue fix all it" — the
// deferred Comfortable / Compact density switch). Standard = the spacing every page is certified with (default). Compact
// only tightens gaps and padding (KPI cards, panels, table cells) — never font sizes, never touch targets — so a page that
// fits in Standard still fits. Stored per device (browser storage), applied as <html data-spacing>.
export type Spacing = 'standard' | 'compact';
const KEY = 'aps.pos.spacing';

export function readSpacing(store: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): Spacing {
  try { return store?.getItem(KEY) === 'compact' ? 'compact' : 'standard'; } catch { return 'standard'; }   // storage blocked: the certified default
}
export function applySpacing(s: Spacing, root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (root) root.setAttribute('data-spacing', s);
}
export function saveSpacing(s: Spacing, store: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  try { store?.setItem(KEY, s); } catch { /* storage blocked: the choice still applies for this visit */ }
  applySpacing(s);
}
