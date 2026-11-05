// Pure validation + filter normalization for Super Admin saved views (§6). No DB/Nest deps. Filters are whitelisted to
// known keys and coerced to safe types so an arbitrary client blob can never be persisted or replayed.

export const SAVED_VIEW_MAX_NAME = 80;
export const SAVED_VIEW_FILTER_KEYS = ['role', 'status', 'tenantId', 'search', 'sort', 'dir'] as const;

export interface SavedViewFilters { role?: string; status?: string; tenantId?: string; search?: string; sort?: string; dir?: 'asc' | 'desc'; pageSize?: number }

// Whitelist + coerce. Unknown keys dropped; strings trimmed; dir constrained; pageSize clamped to 10/25/50; empties omitted.
export function normalizeViewFilters(input: unknown): SavedViewFilters {
  const src = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const out: SavedViewFilters = {};
  for (const k of ['role', 'status', 'tenantId', 'search', 'sort'] as const) {
    const v = src[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  if (typeof src['dir'] === 'string' && src['dir'].trim()) out.dir = src['dir'] === 'desc' ? 'desc' : 'asc';
  const ps = Number(src['pageSize']);
  if ([10, 25, 50].includes(ps)) out.pageSize = ps;
  return out;
}

export interface SavedViewInput { name?: unknown; filters?: unknown; isDefault?: unknown }
export type SavedViewValidation = { ok: true; name: string; filters: SavedViewFilters; isDefault: boolean } | { ok: false; error: string };

export function validateSavedView(input: SavedViewInput): SavedViewValidation {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'a view name is required' };
  if (name.length > SAVED_VIEW_MAX_NAME) return { ok: false, error: `view name must be ${SAVED_VIEW_MAX_NAME} characters or fewer` };
  return { ok: true, name, filters: normalizeViewFilters(input?.filters), isDefault: input?.isDefault === true };
}

// Parse a stored filters_json string back to a normalized filter object (defensive against malformed rows).
export function parseViewFilters(json: string | null | undefined): SavedViewFilters {
  if (!json) return {};
  try { return normalizeViewFilters(JSON.parse(json)); } catch { return {}; }
}
