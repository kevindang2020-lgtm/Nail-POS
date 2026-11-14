// walkin-selection.ts — CPad 14 Walk-In service selection (SUNMI guide Section 4A): the PURE rules the server applies to
// the branch's existing catalog. No second catalog: the rows come from the same services / service_categories tables the
// POS edits (GoCheckInDataPort.walkInCatalogRows); this file only decides what a customer may see and re-prices what a
// customer picked.
//
//   publicWalkInCatalog   4A.3 / 4A.5 / 4A.10 — active, branch, customer-visible categories and services; public fields only
//   walkInRevision        4A.6 / 4A.8 — the catalog's ETag: any edit (name, price, duration, order, visibility) or switch
//                          change gives a new one, whatever screen made it — no event from the catalog module is needed
//   priceWalkInSelection  4A.4 / 4A.8 — re-price the picked lines against the CURRENT catalog; changed / unavailable lines
//                          are marked, never silently substituted or kept at an old price
//   walkInPayloadHash     4A.7 — the idempotency fingerprint (same checkin_request_id + different payload → refused)
import { createHash } from 'crypto';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import type {
  WalkInCatalog, WalkInCategoryOption, WalkInLineState, WalkInPreview, WalkInPreviewLine, WalkInSelectionLine, WalkInSelectionRules, WalkInServiceOption,
} from '@aipowersalon/api-contracts/customer';
import type { GoCheckInSettings } from './go-check-in.dto';
import type { WalkInBranchKey, WalkInBranchOverride } from '@aipowersalon/api-contracts/tenant';

/** The six switches a location may set for itself (migration 993); everything else stays salon-wide. */
export const WALKIN_BRANCH_KEYS: readonly WalkInBranchKey[] = ['serviceSelectionEnabled', 'technicianPreferenceEnabled', 'walkinRequireServices', 'walkinShowPrices', 'walkinShowDurations', 'walkinAllowAddOns'];
export const EMPTY_BRANCH_OVERRIDE: WalkInBranchOverride = { serviceSelectionEnabled: null, technicianPreferenceEnabled: null, walkinRequireServices: null, walkinShowPrices: null, walkinShowDurations: null, walkinAllowAddOns: null };
/** What a location's displays use: the salon's switches, with each of the location's set (non-null) overrides on top. */
export function withBranchWalkIn(salon: GoCheckInSettings, o: WalkInBranchOverride | null | undefined): GoCheckInSettings {
  if (!o) return salon;
  const out = { ...salon };
  for (const k of WALKIN_BRANCH_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}
/** A PUT body cleaned to the six keys; a key that is neither boolean nor null is dropped (never guessed). */
export function cleanBranchPatch(body: unknown): Partial<WalkInBranchOverride> {
  const out: Partial<WalkInBranchOverride> = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of WALKIN_BRANCH_KEYS) { const v = (body as Record<string, unknown>)[k]; if (v === null || typeof v === 'boolean') out[k] = v; }
  return out;
}

/** One catalog row as the repository reads it (services ⋈ service_categories of THIS tenant and branch). */
export interface WalkInCatalogRow {
  serviceId: string; serviceName: string; description: string | null; priceCents: number; durationMinutes: number;
  serviceStatus: string; archived: boolean; customerVisible: boolean; serviceSort: number;
  categoryId: string; categoryName: string; categoryDescription: string | null; categoryIconKey: string | null; categoryStatus: string; categorySort: number;
}

/** 4A.4: the guest's note — short, plain. */
export const WALKIN_NOTES_MAX = 200;
/** A guest picks at most this many services in one request (a walk-in, not a party booking). */
export const WALKIN_MAX_LINES = 12;
export const WALKIN_MAX_ADDONS_PER_LINE = 6;
/** checkin_request_id: the display's own random id (a UUID fits). */
export const WALKIN_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function walkInRules(s: GoCheckInSettings): WalkInSelectionRules {
  return {
    requireServices: s.walkinRequireServices !== false,
    showPrices: s.walkinShowPrices !== false,
    showDurations: s.walkinShowDurations !== false,
    allowAddOns: s.walkinAllowAddOns !== false,
    allowTechnicianPreference: s.technicianPreferenceEnabled === true,
    notesMaxLength: WALKIN_NOTES_MAX,
  };
}

/** A row a customer may pick: an active, not archived, customer-visible service in an active category. */
// Kevin, Nov 13 2026: the CPad shows the FULL service menu — every active, un-archived service of this branch in an active
// category (the per-service online / customer-app booking flags do not hide a service from walk-ins).
const usable = (r: WalkInCatalogRow) => r.serviceStatus === 'active' && !r.archived && r.categoryStatus === 'active';
const cents = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);

/** The authoritative facts the revision covers (order-stable). */
function revisionFacts(rows: WalkInCatalogRow[], rules: WalkInSelectionRules): unknown {
  const live = rows.filter(usable).map((r) => [r.categoryId, r.categoryName, r.categoryDescription ?? '', r.categoryIconKey ?? '', r.categorySort, r.serviceId, r.serviceName, r.description ?? '', cents(r.priceCents), cents(r.durationMinutes), r.serviceSort]);
  live.sort((a, b) => String(a[5]).localeCompare(String(b[5])));
  return { v: 1, rules, live };
}
export function walkInRevision(rows: WalkInCatalogRow[], rules: WalkInSelectionRules): string {
  return createHash('sha256').update(JSON.stringify(revisionFacts(rows, rules))).digest('hex').slice(0, 32);
}

/**
 * 4A.3: the public catalog. Categories in the salon's order (sort, then name); a category with no pickable service is
 * HIDDEN (never an empty tile shown as bookable); the "Add-ons" category is not a tile — its services are the add-ons a
 * picked service may carry (when the salon allows add-ons). Prices / durations are null when the salon hides them; a
 * zero duration is "not set" and never shown.
 */
export function publicWalkInCatalog(rows: WalkInCatalogRow[], settings: GoCheckInSettings): WalkInCatalog {
  const rules = walkInRules(settings);
  const live = rows.filter(usable).sort((a, b) => a.categorySort - b.categorySort || a.categoryName.localeCompare(b.categoryName) || a.serviceSort - b.serviceSort || a.serviceName.localeCompare(b.serviceName));
  const addOnRows = live.filter((r) => isAddOnCategory(r.categoryName));
  const mains = live.filter((r) => !isAddOnCategory(r.categoryName));
  const price = (r: WalkInCatalogRow) => (rules.showPrices ? cents(r.priceCents) : null);
  const minutes = (r: WalkInCatalogRow) => (rules.showDurations && cents(r.durationMinutes) > 0 ? cents(r.durationMinutes) : null);
  const addOns = rules.allowAddOns ? addOnRows.map((r) => ({ id: r.serviceId, name: r.serviceName, priceCents: price(r), durationMinutes: minutes(r) })) : [];
  const addOnIds = addOns.map((a) => a.id);
  const services: WalkInServiceOption[] = mains.map((r) => ({
    id: r.serviceId, name: r.serviceName, description: r.description?.trim() || null, categoryId: r.categoryId,
    priceCents: price(r), priceIsFrom: false, durationMinutes: minutes(r), addOnIds,
  }));
  const categories: WalkInCategoryOption[] = [];
  for (const r of mains) {
    const c = categories.find((x) => x.id === r.categoryId);
    if (c) c.serviceCount += 1;
    else categories.push({ id: r.categoryId, name: r.categoryName, description: r.categoryDescription?.trim() || null, iconKey: r.categoryIconKey || null, serviceCount: 1 });
  }
  return { revision: walkInRevision(rows, rules), rules, categories, services, addOns };
}

/** The lines a request may carry: de-duplicated by service, bounded, ids only (what the guest saw rides along). */
export function cleanLines(input: unknown): WalkInSelectionLine[] {
  if (!Array.isArray(input)) return [];
  const out: WalkInSelectionLine[] = [];
  for (const raw of input) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const serviceId = typeof l.serviceId === 'string' && l.serviceId.length > 0 && l.serviceId.length <= 64 ? l.serviceId : '';
    if (!serviceId || out.some((x) => x.serviceId === serviceId)) continue;
    const addOnIds = Array.isArray(l.addOnIds) ? [...new Set(l.addOnIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, WALKIN_MAX_ADDONS_PER_LINE) : [];
    const shownPriceCents = l.shownPriceCents === null ? null : Number.isFinite(Number(l.shownPriceCents)) && l.shownPriceCents !== undefined ? cents(l.shownPriceCents) : undefined;
    const shownName = typeof l.shownName === 'string' ? l.shownName.slice(0, 200) : undefined;
    out.push({ serviceId, addOnIds, ...(shownPriceCents !== undefined ? { shownPriceCents } : {}), ...(shownName !== undefined ? { shownName } : {}) });
    if (out.length >= WALKIN_MAX_LINES) break;
  }
  return out;
}

/**
 * 4A.4 / 4A.8: re-price the guest's lines against the current catalog. A line whose service is gone / disabled / hidden
 * (or whose id is an add-on, or another branch's) is `unavailable`; a line whose name or shown price differs from today's
 * is `changed`. Add-ons the salon no longer allows (or that are gone) are `unavailable`. `confirmable` only when every
 * line and add-on is ok AND the guest's revision is the current one. Pure — nothing is written.
 */
export function priceWalkInSelection(catalog: WalkInCatalog, lines: WalkInSelectionLine[], guestRevision: string | null | undefined): WalkInPreview {
  const byId = new Map(catalog.services.map((s) => [s.id, s]));
  const addOnById = new Map(catalog.addOns.map((a) => [a.id, a]));
  const warnings = new Set<string>();
  const out: WalkInPreviewLine[] = lines.map((l) => {
    const s = byId.get(l.serviceId);
    if (!s) { warnings.add('SERVICE_UNAVAILABLE'); return { serviceId: l.serviceId, name: l.shownName ?? '', state: 'unavailable' as WalkInLineState, priceCents: null, durationMinutes: null, addOns: [] }; }
    const changed = (l.shownName !== undefined && l.shownName !== s.name) || (l.shownPriceCents !== undefined && l.shownPriceCents !== s.priceCents);
    if (changed) warnings.add('SERVICE_CHANGED');
    const addOns = (l.addOnIds ?? []).map((id) => {
      const a = addOnById.get(id);
      if (!a || !s.addOnIds.includes(id)) { warnings.add('SERVICE_UNAVAILABLE'); return { id, name: '', state: 'unavailable' as WalkInLineState, priceCents: null, durationMinutes: null }; }
      return { id, name: a.name, state: 'ok' as WalkInLineState, priceCents: a.priceCents, durationMinutes: a.durationMinutes };
    });
    return { serviceId: s.id, name: s.name, state: (changed ? 'changed' : 'ok') as WalkInLineState, priceCents: s.priceCents, durationMinutes: s.durationMinutes, addOns };
  });
  const ok = out.filter((l) => l.state !== 'unavailable');
  const okAddOns = ok.flatMap((l) => l.addOns.filter((a) => a.state === 'ok'));
  const total = catalog.rules.showPrices ? ok.reduce((n, l) => n + (l.priceCents ?? 0), 0) + okAddOns.reduce((n, a) => n + (a.priceCents ?? 0), 0) : null;
  const mins = catalog.rules.showDurations ? ok.reduce((n, l) => n + (l.durationMinutes ?? 0), 0) + okAddOns.reduce((n, a) => n + (a.durationMinutes ?? 0), 0) : 0;
  const revisionStale = !!guestRevision && guestRevision !== catalog.revision;
  if (revisionStale) warnings.add('CATALOG_REVISION_CHANGED');
  if (!lines.length && catalog.rules.requireServices) warnings.add('SERVICES_REQUIRED');
  const allOk = out.every((l) => l.state === 'ok' && l.addOns.every((a) => a.state === 'ok'));
  return {
    revision: catalog.revision, lines: out, estimatedTotalCents: total, estimatedMinutes: mins > 0 ? mins : null,
    confirmable: allOk && !revisionStale && (lines.length > 0 || !catalog.rules.requireServices),
    warnings: [...warnings],
  };
}

/** 4A.7: the request's fingerprint — what the guest asked for, in a stable order. */
export function walkInPayloadHash(p: { customerId?: string; customerName: string; phone?: string; lines: WalkInSelectionLine[]; skipServices: boolean; technicianId?: string; notes?: string; approvedRevision: string }): string {
  const lines = p.lines.map((l) => [l.serviceId, [...(l.addOnIds ?? [])].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const canon = { c: p.customerId ?? '', n: p.customerName, ph: String(p.phone ?? '').replace(/\D/g, '').slice(-10), l: lines, s: p.skipServices, t: p.technicianId ?? '', no: p.notes ?? '', r: p.approvedRevision };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

/** 4A.4: a guest's note — trimmed, single-spaced, bounded; control characters dropped. */
export function cleanNotes(v: unknown): string {
  const printable = Array.from(String(v ?? ''), (ch) => { const c = ch.charCodeAt(0); return c < 32 || c === 127 ? ' ' : ch; }).join('');
  return printable.replace(/\s+/g, ' ').trim().slice(0, WALKIN_NOTES_MAX);
}
