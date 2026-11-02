// expense-categories.ts — the short owner categories (mandate §4) and the mapping from any older free-text category.
//
// These ten are the categories a salon owner sees. They are CODE, not rows: every salon has all ten from day one, and a
// tenant can add its own (§5) without ever losing these. An accounting code is a separate mapping behind the category
// (§6) — the owner never needs to know a GL code.
//
// Before this module the platform had three disagreeing lists (the Owner App's lowercase ten, the POS screen's eight
// capitalised ones without Insurance or Software, and OCR posting 'inventory'), and the summary grouped on the raw text —
// so "Supplies" and "supplies" were reported as two categories. One list, one key per category, from here on.

export interface ExpenseCategoryDef { key: string; label: string; sortOrder: number }

/** §4, Kevin's exact words and order. The key is what the database stores; the label is what the owner reads. */
export const DEFAULT_EXPENSE_CATEGORIES: readonly ExpenseCategoryDef[] = Object.freeze([
  { key: 'rent', label: 'Rent / Landlord', sortOrder: 1 },
  { key: 'supplies', label: 'Supplies', sortOrder: 2 },
  { key: 'equipment', label: 'Equipment', sortOrder: 3 },
  { key: 'utilities', label: 'Utilities / Bills', sortOrder: 4 },
  { key: 'marketing', label: 'Marketing', sortOrder: 5 },
  { key: 'repairs', label: 'Repairs / Maintenance', sortOrder: 6 },
  { key: 'insurance', label: 'Insurance', sortOrder: 7 },
  { key: 'software', label: 'Software / Subscriptions', sortOrder: 8 },
  { key: 'payroll', label: 'Payroll', sortOrder: 9 },
  { key: 'other', label: 'Other', sortOrder: 10 },
]);

export const DEFAULT_CATEGORY_KEYS: ReadonlySet<string> = new Set(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.key));
/** §172: the safe fallback. Never force a wrong category just to avoid it. */
export const FALLBACK_CATEGORY = 'other';

/** A custom category's key, from its label: 'Professional Services' → 'professional_services' (the CHECK in 672). */
export function customCategoryKey(label: string): string {
  const k = String(label ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return k.length >= 2 ? k : '';
}

const LEGACY: Record<string, string> = {
  rent: 'rent', landlord: 'rent', 'rent / landlord': 'rent', lease: 'rent', cam: 'rent',
  supplies: 'supplies', supply: 'supplies', inventory: 'supplies', products: 'supplies', product: 'supplies',
  equipment: 'equipment', furniture: 'equipment',
  utilities: 'utilities', utility: 'utilities', bills: 'utilities', 'utilities / bills': 'utilities', electric: 'utilities', internet: 'utilities', phone: 'utilities',
  marketing: 'marketing', advertising: 'marketing', ads: 'marketing',
  maintenance: 'repairs', repairs: 'repairs', repair: 'repairs', 'repairs / maintenance': 'repairs',
  insurance: 'insurance',
  software: 'software', subscriptions: 'software', subscription: 'software', 'software / subscriptions': 'software',
  payroll: 'payroll', wages: 'payroll', salary: 'payroll', salaries: 'payroll',
  other: 'other',
};

/**
 * Any category text a client or an older caller sends → a valid key for this salon. A known key or label passes
 * through; an older word maps (the same table migration 672 applied to stored rows); a tenant's custom key passes when
 * the salon has it; anything else is NOT guessed — it returns null and the caller refuses it (or, for a legacy import,
 * files it under Other with the original words kept in category_raw).
 */
export function normalizeCategory(input: string | null | undefined, customKeys: ReadonlySet<string> = new Set()): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (DEFAULT_CATEGORY_KEYS.has(lower) || customKeys.has(lower)) return lower;
  const byLabel = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.label.toLowerCase() === lower);
  if (byLabel) return byLabel.key;
  if (LEGACY[lower]) return LEGACY[lower];
  const custom = customCategoryKey(raw);
  if (custom && customKeys.has(custom)) return custom;
  return null;
}

export function categoryLabel(key: string, custom: ReadonlyArray<{ key: string; label: string }> = []): string {
  return DEFAULT_EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? custom.find((c) => c.key === key)?.label ?? key;
}
