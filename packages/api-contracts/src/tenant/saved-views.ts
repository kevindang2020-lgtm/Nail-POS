// saved-views.ts — POS saved views (Kevin, Nov 9 2026: the SUNMI guides' optional "Saved Views" / "Smart Filter Presets").
// A saved view is one person's named filters for one POS screen. It holds filter VALUES only; the screen re-runs its own
// query under the person's current permissions, so a view never widens access.

/** A filter value: text, a number, true/false, empty, or a short list of text values (a multi-select). */
export type SavedViewValue = string | number | boolean | null | string[];
export type SavedViewFilters = Record<string, SavedViewValue>;

export interface SavedView {
  id: string;
  /** the screen key, e.g. "money-protection.alerts" */
  surface: string;
  name: string;
  filters: SavedViewFilters;
  /** opened automatically when the screen opens (at most one per screen) */
  isDefault: boolean;
  updatedAt: string;
}
export interface SavedViewList { surface: string; items: SavedView[]; limit: number }

export const SAVED_VIEW_LIMITS = Object.freeze({ perSurface: 20, keys: 30, textLength: 200, listItems: 20, nameLength: 60, bytes: 4096 });
export const SAVED_VIEW_SURFACE = /^[a-z0-9][a-z0-9.-]{1,60}$/;

/** The one validator (server and screen): a flat object of filter values within the limits, else a reason. */
export function checkSavedViewFilters(v: unknown): { ok: true; value: SavedViewFilters } | { ok: false; reason: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: 'filters must be an object' };
  const out: SavedViewFilters = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > SAVED_VIEW_LIMITS.keys) return { ok: false, reason: `at most ${SAVED_VIEW_LIMITS.keys} filters` };
  for (const [k, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(k)) return { ok: false, reason: `bad filter name "${k.slice(0, 40)}"` };
    if (raw === null || typeof raw === 'boolean') { out[k] = raw; continue; }
    if (typeof raw === 'number') { if (!Number.isFinite(raw)) return { ok: false, reason: `${k}: not a number` }; out[k] = raw; continue; }
    if (typeof raw === 'string') { if (raw.length > SAVED_VIEW_LIMITS.textLength) return { ok: false, reason: `${k}: text too long` }; out[k] = raw; continue; }
    if (Array.isArray(raw)) {
      if (raw.length > SAVED_VIEW_LIMITS.listItems || raw.some((x) => typeof x !== 'string' || x.length > SAVED_VIEW_LIMITS.textLength)) return { ok: false, reason: `${k}: list too long or not text` };
      out[k] = raw as string[]; continue;
    }
    return { ok: false, reason: `${k}: unsupported value` };
  }
  if (JSON.stringify(out).length > SAVED_VIEW_LIMITS.bytes) return { ok: false, reason: 'filters too large' };
  return { ok: true, value: out };
}
/** DELETE pos/me/saved-views/:id */
export interface SavedViewDeleted { deleted: true }
