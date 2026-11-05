// business-category-core.ts — pure helpers for the platform business-category registry. No DB.

export function slugify(name: string): string {
  return (name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function validateCategoryName(name: string): string | null {
  const n = (name || '').trim();
  if (n.length < 2) return 'Name must be at least 2 characters.';
  if (n.length > 80) return 'Name must be 80 characters or fewer.';
  if (/<\s*script/i.test(n)) return 'Name must not contain script.';
  return null;
}

/** Next sort order = 10 past the current maximum (leaves gaps for manual insertion). */
export function nextSortOrder(existing: { sortOrder: number }[]): number {
  return existing.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 10;
}

/** Normalize a requested ordering of ids into evenly-spaced sort_order values. */
export function applyReorder(orderedIds: string[]): { id: string; sortOrder: number }[] {
  return orderedIds.map((id, i) => ({ id, sortOrder: (i + 1) * 10 }));
}
