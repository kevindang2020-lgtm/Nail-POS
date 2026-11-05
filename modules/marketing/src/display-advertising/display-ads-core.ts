// display-ads-core.ts — 23-inch dual-screen spec §51–§66, §75, §78–§79, §111: the PURE rules of customer-display
// advertising. No I/O: the service feeds it rows and the clock; every decision that matters — what an owner may save,
// when an ad is ACTIVE, what a display plays right now, who may manage which branch — is made here and unit-tested.
//
// Time: an ad's dates are SALON CALENDAR dates and its daily hours are wall-clock times, both read in the branch's own
// time zone (businessDate/zonedParts). "Oct 1 – Nov 30, Mon–Fri, 10:00–17:00" means that at every branch, whatever
// zone the server runs in. Statuses SCHEDULED/ACTIVE/EXPIRED are derived, never stored, so nothing has to sweep them.
import {
  DISPLAY_AD_FIT_MODES, DISPLAY_AD_MIME_TYPES, DISPLAY_AD_PLATFORM_SETTINGS, DISPLAY_AD_QR_KINDS, DISPLAY_AD_QR_LABELS, DISPLAY_AD_RULES,
  type DisplayAdFitMode, type DisplayAdQrKind,
} from '@aipowersalon/api-contracts';
import type { CustomerDisplayAd, CustomerDisplayAdPlaylist, CustomerDisplayAdsOffReason } from '@aipowersalon/api-contracts/customer';
import type { DisplayAdStatus, DisplayAdsBranchOverride, DisplayAdsLimits, DisplayAdsTenantSettings } from '@aipowersalon/api-contracts/tenant';
import { addDays, businessDate, isYmd, localDateTimeToEpochMs, minutesSinceMidnight, zonedParts } from '@aipowersalon/date-time';

// ── errors (registered codes only — packages/api-contracts/src/errors.ts) ─────────────────────────────────────────
export type DisplayAdErrorCode =
  | 'VALIDATION_FAILED' | 'RESOURCE_NOT_FOUND' | 'VERSION_CONFLICT' | 'CONFLICT' | 'BRANCH_ACCESS_DENIED'
  | 'PERMISSION_DENIED' | 'PLAN_LIMIT_REACHED' | 'PAYLOAD_TOO_LARGE' | 'FEATURE_UNAVAILABLE';
export const DISPLAY_AD_ERROR_STATUS: Readonly<Record<DisplayAdErrorCode, number>> = {
  VALIDATION_FAILED: 400, RESOURCE_NOT_FOUND: 404, VERSION_CONFLICT: 409, CONFLICT: 409, BRANCH_ACCESS_DENIED: 403,
  PERMISSION_DENIED: 403, PLAN_LIMIT_REACHED: 402, PAYLOAD_TOO_LARGE: 413, FEATURE_UNAVAILABLE: 403,
};
export class DisplayAdError extends Error {
  constructor(readonly code: DisplayAdErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DisplayAdError';
  }
}
const invalid = (field: string, message: string): never => { throw new DisplayAdError('VALIDATION_FAILED', message, { field }); };

// ── the editable fields of an ad ──────────────────────────────────────────────────────────────────────────────────
export interface AdFields {
  name: string; mediaId: string | null; fullscreenMediaId: string | null;
  headline: string | null; subheadline: string | null; description: string | null; ctaText: string | null;
  qrKind: DisplayAdQrKind | null; qrUrl: string | null;
  fitMode: DisplayAdFitMode; focalX: number; focalY: number;
  startDate: string | null; endDate: string | null; daysOfWeek: number[] | null;
  dailyStartTime: string | null; dailyEndTime: string | null;
  displayDurationSeconds: number | null; priority: number;
  allBranches: boolean; branchIds: string[];
}
export const BLANK_AD_FIELDS: Readonly<AdFields> = Object.freeze({
  name: '', mediaId: null, fullscreenMediaId: null, headline: null, subheadline: null, description: null, ctaText: null,
  qrKind: null, qrUrl: null, fitMode: 'cover', focalX: 0.5, focalY: 0.5, startDate: null, endDate: null, daysOfWeek: null,
  dailyStartTime: null, dailyEndTime: null, displayDurationSeconds: null, priority: 0, allBranches: true, branchIds: [],
}) as Readonly<AdFields>;
/** §76: a change to any of these is also audited as a schedule change. */
export const SCHEDULE_FIELDS = ['startDate', 'endDate', 'daysOfWeek', 'dailyStartTime', 'dailyEndTime'] as const;
export const TARGETING_FIELDS = ['allBranches', 'branchIds'] as const;

export type StoredStatus = 'draft' | 'published' | 'paused' | 'archived';
export interface AdRecord extends AdFields {
  id: string; tenantId: string; version: number; status: StoredStatus;
  publishedAt: string | null; pausedAt: string | null; archivedAt: string | null;
  createdAt: string; updatedAt: string; createdBy: string | null; updatedBy: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
// control characters, zero-width characters and bidirectional overrides (text spoofing) are never kept
// eslint-disable-next-line no-control-regex -- deliberate: these are exactly the characters being removed
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const TAG_LIKE = /<\s*[a-zA-Z!/?]/;

/** §77: ad text is plain text — trimmed, single-spaced, no markup, within its length. '' and null clear it. */
export function cleanText(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null) return required ? invalid(field, `${label(field)} is required.`) : null;
  if (typeof v !== 'string') return invalid(field, `${label(field)} must be text.`);
  const s = v.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return required ? invalid(field, `${label(field)} is required.`) : null;
  if (TAG_LIKE.test(s)) return invalid(field, `${label(field)} cannot contain HTML or code.`);
  if (s.length > max) return invalid(field, `${label(field)} must be ${max} characters or fewer.`);
  return s;
}
function label(field: string): string {
  const L: Record<string, string> = { name: 'Ad name', headline: 'Headline', subheadline: 'Subheadline', description: 'Description', ctaText: 'Call-to-action' };
  return L[field] ?? field;
}

/** A real calendar date 'YYYY-MM-DD' (2000–2100). */
export function isCalendarDate(s: unknown): s is string {
  if (!isYmd(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
function hhmm(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const m = minutesSinceMidnight(typeof v === 'string' ? v : null);
  if (m === null) return invalid(field, 'Times must look like 10:00 or 17:30.');
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** §78 "Validate destination": an https address on a public host (no credentials, no IP, no local name, standard port);
 *  an Instagram code must actually point at Instagram. Returns the normalized URL. */
export function validateQrUrl(kind: DisplayAdQrKind, raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return invalid('qr.url', 'Enter the web address the QR code should open.');
  const s = raw.trim();
  if (s.length > DISPLAY_AD_RULES.text.qrUrl) return invalid('qr.url', `The QR address must be ${DISPLAY_AD_RULES.text.qrUrl} characters or fewer.`);
  let u: URL;
  try { u = new URL(s); } catch { return invalid('qr.url', 'The QR address must be a full web address starting with https://'); }
  if (u.protocol !== 'https:') return invalid('qr.url', 'The QR address must start with https://');
  if (u.username || u.password) return invalid('qr.url', 'The QR address must not contain a user name or password.');
  if (u.port && u.port !== '443') return invalid('qr.url', 'The QR address must use the standard web port.');
  const host = u.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':');
  if (isIp || !host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
    return invalid('qr.url', 'The QR address must point to a public website.');
  }
  if (kind === 'instagram' && !['instagram.com', 'www.instagram.com', 'instagr.am'].includes(host)) {
    return invalid('qr.url', 'An Instagram QR code must point to an instagram.com address.');
  }
  return u.toString();
}

function intIn(v: unknown, field: string, min: number, max: number, message: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return invalid(field, message);
  return v;
}
function unit(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return invalid(field, 'The focus point must be between 0 and 1.');
  return Math.round(v * 1000) / 1000;
}
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Merge an owner's input over the current fields and validate the RESULT (a partial update can break a rule together
 * with what is already stored — an end date before the stored start date). Only the named keys are read: anything
 * else the request carries is ignored (G4 — no client object reaches a write whole).
 */
export function applyAdInput(base: Readonly<AdFields>, input: unknown, opts: { requireName?: boolean } = {}): AdFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('body', 'The request body must be an object.');
  const i = input as Record<string, unknown>;
  const T = DISPLAY_AD_RULES.text;
  const next: AdFields = { ...base, daysOfWeek: base.daysOfWeek ? [...base.daysOfWeek] : null, branchIds: [...base.branchIds] };

  if (has(i, 'name') || opts.requireName) next.name = cleanText(i.name, 'name', T.name, true) as string;
  for (const [k, max] of [['headline', T.headline], ['subheadline', T.subheadline], ['description', T.description], ['ctaText', T.ctaText]] as const) {
    if (has(i, k)) next[k] = cleanText(i[k], k, max);
  }
  for (const k of ['mediaId', 'fullscreenMediaId'] as const) {
    if (!has(i, k)) continue;
    const v = i[k];
    if (v === null || v === '') next[k] = null;
    else if (isUuid(v)) next[k] = v.toLowerCase();
    else invalid(k, 'Unknown image.');
  }
  if (has(i, 'qr')) {
    const q = i.qr;
    if (q === null) { next.qrKind = null; next.qrUrl = null; }
    else if (typeof q === 'object' && !Array.isArray(q)) {
      const kind = (q as Record<string, unknown>).kind;
      if (!(DISPLAY_AD_QR_KINDS as readonly unknown[]).includes(kind)) invalid('qr.kind', 'Choose what the QR code is for.');
      next.qrKind = kind as DisplayAdQrKind;
      next.qrUrl = validateQrUrl(kind as DisplayAdQrKind, (q as Record<string, unknown>).url);
    } else invalid('qr', 'The QR code must be { kind, url } or null.');
  }
  if (has(i, 'fitMode')) {
    if (!(DISPLAY_AD_FIT_MODES as readonly unknown[]).includes(i.fitMode)) invalid('fitMode', 'Fit must be cover, contain or smart crop.');
    next.fitMode = i.fitMode as DisplayAdFitMode;
  }
  if (has(i, 'focalX')) next.focalX = unit(i.focalX, 'focalX');
  if (has(i, 'focalY')) next.focalY = unit(i.focalY, 'focalY');
  for (const k of ['startDate', 'endDate'] as const) {
    if (!has(i, k)) continue;
    const v = i[k];
    if (v === null || v === '') next[k] = null;
    else if (isCalendarDate(v)) next[k] = v;
    else invalid(k, 'Dates must be real calendar dates (YYYY-MM-DD).');
  }
  if (has(i, 'daysOfWeek')) {
    const v = i.daysOfWeek;
    if (v === null) next.daysOfWeek = null;
    else if (Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      const days = [...new Set(v as number[])].sort((a, b) => a - b);
      next.daysOfWeek = days.length === 0 || days.length === 7 ? null : days;   // none or all = every day
    } else invalid('daysOfWeek', 'Days must be numbers 0 (Sunday) to 6 (Saturday).');
  }
  if (has(i, 'dailyStartTime')) next.dailyStartTime = hhmm(i.dailyStartTime, 'dailyStartTime');
  if (has(i, 'dailyEndTime')) next.dailyEndTime = hhmm(i.dailyEndTime, 'dailyEndTime');
  if (has(i, 'displayDurationSeconds')) {
    const v = i.displayDurationSeconds; const D = DISPLAY_AD_RULES.durationSeconds;
    next.displayDurationSeconds = v === null ? null : intIn(v, 'displayDurationSeconds', D.min, D.max, `Display time must be ${D.min}–${D.max} seconds.`);
  }
  if (has(i, 'priority')) next.priority = intIn(i.priority, 'priority', DISPLAY_AD_RULES.priority.min, DISPLAY_AD_RULES.priority.max, 'Priority must be a whole number from 0 to 100.');
  if (has(i, 'allBranches')) {
    if (typeof i.allBranches !== 'boolean') invalid('allBranches', 'allBranches must be true or false.');
    next.allBranches = i.allBranches as boolean;
  }
  if (has(i, 'branchIds')) {
    const v = i.branchIds;
    if (!Array.isArray(v) || !v.every(isUuid)) invalid('branchIds', 'Unknown branch.');
    next.branchIds = [...new Set((v as string[]).map((b) => b.toLowerCase()))].sort();
  }

  // rules over the merged result
  if (next.allBranches) next.branchIds = [];
  else if (next.branchIds.length === 0) invalid('branchIds', 'Choose at least one branch, or All branches.');
  if (next.startDate && next.endDate && next.startDate > next.endDate) invalid('endDate', 'The end date must be on or after the start date.');
  if ((next.dailyStartTime === null) !== (next.dailyEndTime === null)) invalid('dailyEndTime', 'Set both a start and an end time, or neither.');
  if (next.dailyStartTime && next.dailyEndTime && next.dailyStartTime >= next.dailyEndTime) invalid('dailyEndTime', 'The end time must be after the start time.');
  if (!next.name) invalid('name', 'Ad name is required.');
  return next;
}

/** The fields whose value differs (for the audit trail). Arrays compare by content. */
export function changedFields(a: Readonly<AdFields>, b: Readonly<AdFields>): (keyof AdFields)[] {
  return (Object.keys(BLANK_AD_FIELDS) as (keyof AdFields)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
export const pickFields = (r: Readonly<AdFields>): AdFields => {
  const out = {} as AdFields;
  for (const k of Object.keys(BLANK_AD_FIELDS) as (keyof AdFields)[]) (out as unknown as Record<string, unknown>)[k] = Array.isArray(r[k]) ? [...(r[k] as unknown[])] : r[k];
  return out;
};

// ── status and schedule (§64–§65) ──────────────────────────────────────────────────────────────────────────────────
export interface ScheduledAd {
  status: StoredStatus; mediaId: string | null;
  startDate: string | null; endDate: string | null; daysOfWeek: number[] | null; dailyStartTime: string | null; dailyEndTime: string | null;
}

/** §64: DRAFT / SCHEDULED / ACTIVE / PAUSED / EXPIRED / ARCHIVED, in the salon's time zone. A paused campaign whose end
 *  date has passed reads EXPIRED (resuming it would show nothing). */
export function effectiveStatus(ad: Pick<ScheduledAd, 'status' | 'startDate' | 'endDate'>, tz: string, now: Date): DisplayAdStatus {
  if (ad.status === 'archived') return 'ARCHIVED';
  if (ad.status === 'draft') return 'DRAFT';
  const today = businessDate(tz, now);
  if (ad.endDate && today > ad.endDate) return 'EXPIRED';
  if (ad.status === 'paused') return 'PAUSED';
  if (ad.startDate && today < ad.startDate) return 'SCHEDULED';
  return 'ACTIVE';
}

/** §65 "Backend resolves whether it should currently display": published, has its image, inside its dates, on an allowed
 *  weekday and inside its daily hours [start, end). */
export function isShowingNow(ad: ScheduledAd, tz: string, now: Date): boolean {
  if (ad.status !== 'published' || !ad.mediaId) return false;
  const today = businessDate(tz, now);
  if (ad.startDate && today < ad.startDate) return false;
  if (ad.endDate && today > ad.endDate) return false;
  const p = zonedParts(now, tz);
  if (ad.daysOfWeek && ad.daysOfWeek.length > 0 && !ad.daysOfWeek.includes(p.weekday)) return false;
  if (ad.dailyStartTime && ad.dailyEndTime) {
    const m = p.hour * 60 + p.minute;
    const s = minutesSinceMidnight(ad.dailyStartTime) ?? 0, e = minutesSinceMidnight(ad.dailyEndTime) ?? 24 * 60;
    if (m < s || m >= e) return false;
  }
  return true;
}

/** The next instant at which any published ad could start or stop showing: the next local midnight (dates, weekdays)
 *  for ads that have dates or weekdays, and today's daily start/end times still ahead. null = nothing will change. */
export function nextScheduleChangeMs(ads: ScheduledAd[], tz: string, now: Date): number | null {
  const nowMs = now.getTime();
  const today = businessDate(tz, now);
  const midnight = localDateTimeToEpochMs(addDays(today, 1), '00:00', tz);
  let best = Infinity;
  const consider = (t: number) => { if (Number.isFinite(t) && t > nowMs + 500 && t < best) best = t; };
  for (const ad of ads) {
    if (ad.status !== 'published' || !ad.mediaId) continue;
    if (ad.startDate || ad.endDate || ad.daysOfWeek) consider(midnight);
    if (ad.dailyStartTime && ad.dailyEndTime) {
      consider(localDateTimeToEpochMs(today, ad.dailyStartTime, tz));
      consider(localDateTimeToEpochMs(today, ad.dailyEndTime, tz));
    }
  }
  return best === Infinity ? null : best;
}

// ── settings layers (§7, §59, §110–§111) ───────────────────────────────────────────────────────────────────────────
export const DEFAULT_TENANT_AD_SETTINGS: Readonly<DisplayAdsTenantSettings> = Object.freeze({
  enabled: true, defaultDurationSeconds: DISPLAY_AD_RULES.durationSeconds.default,
  fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: DISPLAY_AD_RULES.fullScreenIdleAfterSeconds.default,
});
const obj = (j: unknown): Record<string, unknown> => {
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return {}; } }
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
};
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** The salon-wide row of tenant_settings category 'customer-display-ads' (missing keys → defaults; out of range → clamped). */
export function parseTenantAdSettings(j: unknown): DisplayAdsTenantSettings {
  const o = obj(j); const d = DEFAULT_TENANT_AD_SETTINGS; const D = DISPLAY_AD_RULES.durationSeconds; const F = DISPLAY_AD_RULES.fullScreenIdleAfterSeconds;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    defaultDurationSeconds: clampInt(o.defaultDurationSeconds, D.min, D.max, d.defaultDurationSeconds),
    fullScreenIdleAdsEnabled: typeof o.fullScreenIdleAdsEnabled === 'boolean' ? o.fullScreenIdleAdsEnabled : d.fullScreenIdleAdsEnabled,
    fullScreenIdleAfterSeconds: clampInt(o.fullScreenIdleAfterSeconds, F.min, F.max, d.fullScreenIdleAfterSeconds),
  };
}
/** A branch row can only switch a capability OFF for that branch (the layers are AND-ed): false = off, anything else = follow the salon. */
export function parseBranchOverride(j: unknown): DisplayAdsBranchOverride {
  const o = obj(j);
  return { enabled: o.enabled === false ? false : null, fullScreenIdleAdsEnabled: o.fullScreenIdleAdsEnabled === false ? false : null };
}

/** Validate a settings change. Tenant scope: enabled / defaultDurationSeconds / fullScreenIdleAdsEnabled / afterSeconds.
 *  Branch scope: enabled and fullScreenIdleAdsEnabled only, each false (off for this branch) or null (follow the salon). */
export function applySettingsInput(scope: 'tenant' | 'branch', current: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  const D = DISPLAY_AD_RULES.durationSeconds; const F = DISPLAY_AD_RULES.fullScreenIdleAfterSeconds;
  if (scope === 'tenant') {
    for (const k of ['enabled', 'fullScreenIdleAdsEnabled'] as const) {
      if (!has(input, k)) continue;
      if (typeof input[k] !== 'boolean') invalid(k, `${k} must be true or false.`);
      next[k] = input[k];
    }
    if (has(input, 'defaultDurationSeconds')) next.defaultDurationSeconds = intIn(input.defaultDurationSeconds, 'defaultDurationSeconds', D.min, D.max, `The default display time must be ${D.min}–${D.max} seconds.`);
    if (has(input, 'fullScreenIdleAfterSeconds')) next.fullScreenIdleAfterSeconds = intIn(input.fullScreenIdleAfterSeconds, 'fullScreenIdleAfterSeconds', F.min, F.max, `Full-screen ads may start after ${F.min}–${F.max} seconds of inactivity.`);
  } else {
    for (const k of ['enabled', 'fullScreenIdleAdsEnabled'] as const) {
      if (!has(input, k)) continue;
      const v = input[k];
      if (v === false) next[k] = false;
      else if (v === null || v === true) delete next[k];   // true = follow the salon (a branch cannot turn on what the salon turned off)
      else invalid(k, `${k} must be false (off for this branch) or null (follow the salon).`);
    }
    for (const k of ['defaultDurationSeconds', 'fullScreenIdleAfterSeconds']) if (has(input, k)) invalid(k, 'That setting is salon-wide.');
  }
  return next;
}

/** §110: the Super Admin platform limits, from stored platform_settings values (code defaults when unset; clamped). */
export function parsePlatformLimits(stored: Readonly<Record<string, unknown>>): DisplayAdsLimits {
  const def = (k: string) => DISPLAY_AD_PLATFORM_SETTINGS.find((d) => d.key === k)!;
  const num = (k: string) => { const d = def(k); return clampInt(stored[k], d.min ?? 0, d.max ?? Number.MAX_SAFE_INTEGER, d.default as number); };
  const rawTypes = has(stored, 'display_ads.allowed_mime_types') ? stored['display_ads.allowed_mime_types'] : def('display_ads.allowed_mime_types').default;
  const list = Array.isArray(rawTypes) ? rawTypes.map(String) : typeof rawTypes === 'string' ? rawTypes.split(',') : [];
  const allowed = [...new Set(list.map((t) => t.trim().toLowerCase()).map((t) => (t === 'image/jpg' ? 'image/jpeg' : t)))]
    .filter((t) => (DISPLAY_AD_MIME_TYPES as readonly string[]).includes(t));
  const fs = stored['display_ads.fullscreen_idle_allowed'];
  return {
    maxAds: num('display_ads.max_ads_per_tenant'),
    maxFileBytes: num('display_ads.max_file_size_mb') * 1024 * 1024,
    storageLimitBytes: num('display_ads.storage_limit_mb') * 1024 * 1024,
    allowedMimeTypes: allowed,
    fullScreenIdleAllowed: typeof fs === 'boolean' ? fs : fs === 'false' ? false : fs === 'true' ? true : (def('display_ads.fullscreen_idle_allowed').default as boolean),
  };
}

// ── who may manage what (§62–§63) ──────────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN Phase 9: "owner" here means the salon-wide reach (§62) — the tenant-wide scope permission the session carries
// (owner.branches.compare, via hasTenantWideScope), computed once when the actor is built. It used to be role === 'OWNER',
// so an owner-level template with the reach denied still managed every branch, and nobody else could be given it.
export interface AdActor { role: string; branchId: string; userId: string | null; tenantWide: boolean }
export const isOwner = (a: Pick<AdActor, 'tenantWide'>) => a.tenantWide === true;
/** Owners manage every branch; anyone else (a branch manager) only the branch they are signed in to. */
export function authorizedBranchIds(actor: AdActor, tenantBranchIds: readonly string[]): string[] {
  return isOwner(actor) ? [...tenantBranchIds] : tenantBranchIds.filter((b) => b === actor.branchId);
}
/** Owners see every ad; a branch manager sees the ads that play at their branch (all-branches ads and their own). */
export function canSeeAd(ad: Pick<AdFields, 'allBranches' | 'branchIds'>, actor: AdActor): boolean {
  return isOwner(actor) || ad.allBranches || ad.branchIds.includes(actor.branchId);
}
/** A branch manager may change only an ad that targets exactly their branch — never an all-branches ad, never one that
 *  also plays elsewhere (pausing it would reach into another branch). */
export function canManageAd(ad: Pick<AdFields, 'allBranches' | 'branchIds'>, actor: AdActor): boolean {
  if (isOwner(actor)) return true;
  return !!actor.branchId && !ad.allBranches && ad.branchIds.length > 0 && ad.branchIds.every((b) => b === actor.branchId);
}
/** The targeting an actor wants to save: every branch must be the salon's own, and a branch manager may target only
 *  their own branch. */
export function assertTargeting(next: Pick<AdFields, 'allBranches' | 'branchIds'>, actor: AdActor, tenantBranchIds: ReadonlySet<string>): void {
  for (const b of next.branchIds) if (!tenantBranchIds.has(b)) throw new DisplayAdError('VALIDATION_FAILED', 'Unknown branch.', { field: 'branchIds' });
  if (isOwner(actor)) return;
  if (next.allBranches) throw new DisplayAdError('BRANCH_ACCESS_DENIED', 'Only the salon owner can show an ad at every branch.');
  if (!actor.branchId || next.branchIds.some((b) => b !== actor.branchId)) throw new DisplayAdError('BRANCH_ACCESS_DENIED', 'You can only target your own branch.');
}

// ── the playlist a display plays (§47, §58–§60, §79, §111, §114) ───────────────────────────────────────────────────
export interface PlaylistImage { url: string; width: number; height: number }
export interface PlaylistMedia { large: PlaylistImage; medium: PlaylistImage; suggestedFocalX: number; suggestedFocalY: number }
export interface PlaylistAd extends ScheduledAd, Pick<AdFields, 'fitMode' | 'focalX' | 'focalY' | 'headline' | 'subheadline' | 'description' | 'ctaText' | 'qrKind' | 'qrUrl' | 'displayDurationSeconds' | 'priority'> {
  id: string; version: number; publishedAt: string | null; createdAt: string;
  media: PlaylistMedia | null; fullscreenMedia: PlaylistMedia | null;
}
export interface PlaylistContext {
  /** Platform availability + plan entitlement (§111 layers 1–2). */
  available: boolean;
  tenant: DisplayAdsTenantSettings;
  branch: DisplayAdsBranchOverride | null;
  /** null = not a device (the POS preview of a branch). */
  deviceAdsEnabled: boolean | null;
  fullScreenIdleAllowed: boolean;
  tz: string; now: Date;
}
const MAX_REFRESH_S = 900, MIN_REFRESH_S = 5;

/** FNV-1a — a short, stable fingerprint (not a security hash). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function playlistOrder(a: PlaylistAd, b: PlaylistAd): number {
  return (b.priority - a.priority)
    || ((a.publishedAt ? Date.parse(a.publishedAt) : Infinity) - (b.publishedAt ? Date.parse(b.publishedAt) : Infinity))
    || (Date.parse(a.createdAt) - Date.parse(b.createdAt))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The display's DTO for one ad — the image the panel needs, the text, the QR and how long to show it. Nothing else. */
export function toDisplayAd(ad: PlaylistAd & { media: PlaylistMedia }, defaultDurationSeconds: number): CustomerDisplayAd {
  const smart = ad.fitMode === 'smart_crop';
  return {
    id: ad.id, version: ad.version,
    image: { ...ad.media.medium }, imageLarge: { ...ad.media.large },
    fullscreenImage: ad.fullscreenMedia ? { ...ad.fullscreenMedia.large } : null,
    fit: ad.fitMode,
    focalX: smart ? ad.media.suggestedFocalX : ad.focalX, focalY: smart ? ad.media.suggestedFocalY : ad.focalY,
    headline: ad.headline, subheadline: ad.subheadline, description: ad.description, ctaText: ad.ctaText,
    qr: ad.qrKind && ad.qrUrl ? { label: DISPLAY_AD_QR_LABELS[ad.qrKind], url: ad.qrUrl } : null,
    durationSeconds: ad.displayDurationSeconds ?? defaultDurationSeconds,
  };
}

/** §111 in order — platform → plan → salon → branch → device — then the ads showing right now, in rotation order. */
export function resolvePlaylist(ads: readonly PlaylistAd[], c: PlaylistContext): CustomerDisplayAdPlaylist {
  const off: CustomerDisplayAdsOffReason | null = !c.available ? 'not_available'
    : !c.tenant.enabled ? 'disabled_by_salon'
      : c.branch?.enabled === false ? 'disabled_for_branch'
        : c.deviceAdsEnabled === false ? 'disabled_for_display'
          : null;
  const generatedAt = c.now.toISOString();
  if (off) {
    const playlistVersion = fnv1a(JSON.stringify({ off }));
    return { enabled: false, offReason: off, ads: [], fullScreenIdle: { enabled: false, afterSeconds: c.tenant.fullScreenIdleAfterSeconds }, playlistVersion, generatedAt, refreshAfterSeconds: MAX_REFRESH_S, validUntil: null };
  }
  const showing = ads.filter((a): a is PlaylistAd & { media: PlaylistMedia } => !!a.media && isShowingNow(a, c.tz, c.now)).sort(playlistOrder);
  const out = showing.map((a) => toDisplayAd(a, c.tenant.defaultDurationSeconds));
  const fullScreenIdle = {
    enabled: c.fullScreenIdleAllowed && c.tenant.fullScreenIdleAdsEnabled && c.branch?.fullScreenIdleAdsEnabled !== false,
    afterSeconds: c.tenant.fullScreenIdleAfterSeconds,
  };
  const next = nextScheduleChangeMs([...ads], c.tz, c.now);
  const refreshAfterSeconds = next === null ? MAX_REFRESH_S : Math.min(MAX_REFRESH_S, Math.max(MIN_REFRESH_S, Math.ceil((next - c.now.getTime()) / 1000) + 1));
  const playlistVersion = fnv1a(JSON.stringify({ a: out.map((a) => [a.id, a.version, a.durationSeconds]), f: fullScreenIdle }));
  // §72/§114: an offline display trusts its saved list only until the next schedule boundary (null: none is scheduled)
  const validUntil = next === null ? null : new Date(next).toISOString();
  return { enabled: true, offReason: null, ads: out, fullScreenIdle, playlistVersion, generatedAt, refreshAfterSeconds, validUntil };
}

/** §109 status counts for the analytics header. */
export function countStatuses(ads: readonly Pick<ScheduledAd, 'status' | 'startDate' | 'endDate'>[], tz: string, now: Date) {
  const c = { active: 0, scheduled: 0, expired: 0, paused: 0, drafts: 0 };
  for (const a of ads) {
    const s = effectiveStatus(a, tz, now);
    if (s === 'ACTIVE') c.active++; else if (s === 'SCHEDULED') c.scheduled++; else if (s === 'EXPIRED') c.expired++;
    else if (s === 'PAUSED') c.paused++; else if (s === 'DRAFT') c.drafts++;
  }
  return c;
}

// ── status transitions (§64) ───────────────────────────────────────────────────────────────────────────────────────
export type AdAction = 'publish' | 'pause' | 'archive' | 'restore';
/** What each action does from each stored status; null = not allowed. */
export function transition(from: StoredStatus, action: AdAction): StoredStatus | null {
  switch (action) {
    case 'publish': return from === 'draft' || from === 'paused' ? 'published' : null;
    case 'pause': return from === 'published' ? 'paused' : null;
    case 'archive': return from === 'archived' ? null : 'archived';
    case 'restore': return from === 'archived' ? 'draft' : null;
    default: return null;
  }
}
