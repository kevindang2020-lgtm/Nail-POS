// check-in-rules.ts — 23-inch dual-screen spec §20–§27: the rules about a customer's own check-in that the server, the
// POS and the customer display must read the same way. Realm-neutral (the POS walk-in and the kiosk server both use it).

/**
 * §20 add-ons: an add-on is a catalog service in the salon's "Add-ons" category — the POS walk-in's own convention,
 * now one function. Case, spaces and hyphens are ignored ("Add-ons", "Add Ons", "ADDONS", "Add-on").
 */
export function isAddOnCategory(name: unknown): boolean {
  const k = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return k === 'addons' || k === 'addon';
}

/** §26–§27: the wait shown to a guest is a band this wide, from the queue engine's estimate — computed by the server. */
export const CHECK_IN_WAIT_BAND_MINUTES = 10;

/** Dual-Screen mandate §118–§119: the languages a salon may offer on its customer display. English and Vietnamese. */
export const CUSTOMER_DISPLAY_LANGUAGES = ['en', 'vi'] as const;
export type CustomerDisplayLanguage = (typeof CUSTOMER_DISPLAY_LANGUAGES)[number];
/** The owner's choice, cleaned: known languages, no repeats, the salon's default FIRST, at least one. Null: unusable
 *  (not a list, an unknown language, or empty) — the caller refuses it rather than guessing. */
export function normalizeDisplayLanguages(input: unknown): CustomerDisplayLanguage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: CustomerDisplayLanguage[] = [];
  for (const raw of input) {
    const l = String(raw ?? '').trim().toLowerCase();
    if (!(CUSTOMER_DISPLAY_LANGUAGES as readonly string[]).includes(l)) return null;
    if (!out.includes(l as CustomerDisplayLanguage)) out.push(l as CustomerDisplayLanguage);
  }
  return out;
}
