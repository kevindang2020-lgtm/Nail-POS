// posBookingApi.ts — tenant POS Booking API client (canonical, master appointment module). Same-origin; tenant/branch/
import type { BookingDraftView } from '@aipowersalon/api-contracts';
import type { BookingFilters, BookingTechnicianQuery, BookingTechnicianPage, BookingOpeningsResponse } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';   // the wire contract (Constitution 13 §15)
// role from session. Supersedes the earlier four-method stub on wrong paths. Create/reschedule may return 409 with a
// conflict payload; move/start endpoints are idempotent server-side.
export class ApiError extends Error {
  constructor(message: string, public status: number, public conflictingAppointmentId?: string,
              /** Smooth Refresh spec §12/§14: APPOINTMENT_CONFLICT | VERSION_CONFLICT | OVERBOOK_CONFIRMATION_REQUIRED */
              public code?: string, public currentVersion?: number) { super(message); this.name = 'ApiError'; }
}
/** Spec §12: the words the front desk sees when another device won the race or changed the appointment first. */
export const bookingRaceMessage = (): string => t('pos.this_time_was_just_booked_or_x5cn');
export function bookingConflictText(e: any, fallback?: string): string {
  if (e?.status !== 409) return e?.message || fallback || t('ops.booking.saveFailed');   // the default read at call time (never at import)
  if (e.code === 'APPOINTMENT_CONFLICT' || e.code === 'VERSION_CONFLICT') return bookingRaceMessage();
  return e.message || t('pos.that_time_conflicts_with_another_appointment');
}
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
import { localizedOr } from '../i18n/error-text';
const BASE = apiUrl('/pos/booking');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => status === 409 ? new ApiError(localizedOr(message, body, t('pos.scheduling_conflict')), 409, body?.conflictingAppointmentId, body?.code, typeof body?.currentVersion === 'number' ? body.currentVersion : undefined) : new ApiError(message, status) });
function qs(f: Record<string, unknown>): string { const p = new URLSearchParams(); Object.keys(f).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (aid: string, action: string, body?: unknown) => http<any>('/appointments/' + id(aid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
/** Price override for a single service line item within a booking */
export interface BookingPriceOverride {
  serviceId: string;
  overridePriceCents: number;
  reason?: string;
  approvedBy?: string;
}

/** Add-on attached to a specific service within a booking */
export interface BookingAddOn {
  addOnId: string;
  parentServiceId: string;
  overridePriceCents?: number;
}

/** Full appointment creation body with price-override and add-on support */
export interface CreateAppointmentBody {
  customerName: string;
  customerPhone?: string;
  serviceIds: string[];
  technicianId?: string;
  date?: string;
  startTime: string;
  source?: string;
  notes?: string;
  partySize?: number;
  addOns?: BookingAddOn[];
  priceOverrides?: BookingPriceOverride[];
}

/** Update body — partial, anything omitted is unchanged */
export interface UpdateAppointmentBody {
  serviceIds?: string[];
  technicianId?: string;
  date?: string;
  startTime?: string;
  notes?: string;
  partySize?: number;
  addOns?: BookingAddOn[];
  priceOverrides?: BookingPriceOverride[];
}

/** Permission result for the current user */
export interface BookingPermissions {
  canOverridePrice: boolean;
  canEditCatalog: boolean;
  canManageAddOns: boolean;
  role: string;
}

// B-22: the draft wire shape is the API's (api-contracts BookingDraftView) — not mirrored here (architecture §15)
type BookingDraft = BookingDraftView;

export const posBookingApi = {
  state: (f: BookingFilters = {}) => http<any>('/state' + qs(f as Record<string, unknown>)),
  kpis: () => http<any>('/kpis'),
  appointments: (f: BookingFilters = {}) => http<any>('/appointments' + qs(f as Record<string, unknown>)),
  appointment: (aid: string) => http<any>('/appointments/' + id(aid)),
  // mandate §31: Idempotency-Key per intent (createIntentKeys) — a retry of the same booking replays, never books twice
  create: (body: CreateAppointmentBody | unknown, idempotencyKey?: string) => http<any>('/appointments', { method: 'POST', body: JSON.stringify(body), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) }),
  update: (aid: string, body: UpdateAppointmentBody | unknown) => http<any>('/appointments/' + id(aid), { method: 'PATCH', body: JSON.stringify(body) }),
  checkConflict: (body: unknown) => http<any>('/conflicts/check', { method: 'POST', body: JSON.stringify(body) }),
  availability: (q: { date?: string; serviceIds?: string[]; technicianId?: string; branchId?: string; technicianIds?: string[] }) => http<any>('/availability' + qs({ date: q.date, serviceIds: (q.serviceIds || []).join(','), technicianId: q.technicianId, branchId: q.branchId, technicianIds: q.technicianIds?.length ? q.technicianIds.join(',') : undefined })),
  integrationStatus: () => http<any>('/integration-status'),
  // B-22 (Oct 22 2026): Save Draft keeps the New Booking form as a REAL draft (booking_holds kind 'draft') — never an appointment
  drafts: {
    list: () => http<{ drafts: BookingDraft[] }>('/drafts'),
    get: (draftId: string) => http<BookingDraft>('/drafts/' + id(draftId)),
    save: (payload: unknown) => http<BookingDraft>('/drafts', { method: 'POST', body: JSON.stringify({ payload }) }),
    discard: (draftId: string) => http<{ ok: boolean }>('/drafts/' + id(draftId), { method: 'DELETE' }),
    converted: (draftId: string) => http<{ ok: boolean }>('/drafts/' + id(draftId) + '/converted', { method: 'POST', body: '{}' }),
  },
  /** 200-technician mandate (Oct 23 2026): pass the VISIBLE page's technician ids — columns + the whole day's appointments
   *  for those technicians (and the unassigned column) only. Without ids: every technician (older callers). */
  dayGrid: (date?: string, technicianIds?: string[], f: BookingFilters = {}) => http<any>('/day-grid' + qs({ search: f.search, status: f.status, source: f.source, serviceCategory: f.serviceCategory, depositStatus: f.depositStatus, conflictOnly: f.conflictOnly, date, technicianIds: technicianIds?.length ? technicianIds.join(',') : undefined })),
  /** 200-technician mandate: the board's technician columns, paged on the server (12 a page) — search, working, status,
   *  skill and exact-service filters, and `locate` (the page that holds one technician). */
  technicians: (q: BookingTechnicianQuery = {}) => http<BookingTechnicianPage>('/technicians' + qs({ date: q.date, page: q.page, pageSize: q.pageSize, search: q.search, working: q.working ? 'true' : undefined, status: q.status, skill: q.skill, locate: q.locate, serviceIds: q.serviceIds?.length ? q.serviceIds.join(',') : undefined })),
  /** Find an Opening / Best Matches on the server: eligible technicians only, ranked; top `limit` + hasMore (View More). */
  openings: (q: { date?: string; serviceIds?: string[]; limit?: number; offset?: number }) => http<BookingOpeningsResponse>('/openings' + qs({ date: q.date, serviceIds: (q.serviceIds || []).join(',') || undefined, limit: q.limit, offset: q.offset })),
  /** Smooth Refresh spec §25: what changed since `since` (opaque cursor). 409 RESYNC_REQUIRED → reload the snapshot. */
  // §100: the feed reports its own size (the serialized answer's length ≈ bytes on the wire before compression).
  changes: (since?: string) => http<{ appointments: any[]; cursor: string; serverTime: string; hasMore?: boolean }>('/changes' + qs({ since }))
    .then((r) => Object.assign(r, { __bytes: JSON.stringify(r).length })),
  reschedule: (aid: string, body: unknown) => post(aid, 'reschedule', body),
  cancel: (aid: string, body: unknown) => post(aid, 'cancel', body),
  noShow: (aid: string, body: unknown) => post(aid, 'no-show', body),
  /** Decision 38: the customer is in the salon, not yet checked in (pos.booking.check_in). */
  markArrived: (aid: string) => post(aid, 'arrived'),
  assignTechnician: (aid: string, body: unknown) => post(aid, 'assign-technician', body),
  moveToQueue: (aid: string) => post(aid, 'move-to-queue'),
  startService: (aid: string) => post(aid, 'start-service'),
  // §9 blocked-time / break write path (permission-gated + audited server-side)
  addBlockedTime: (body: { technicianId: string; date?: string; startTime: string; endTime: string; reason?: string; note?: string; managerOverride?: boolean }) => http<{ blockId: string }>('/blocked-times', { method: 'POST', body: JSON.stringify(body) }),
  removeBlockedTime: (blockId: string) => http<{ removed: boolean }>('/blocked-times/' + id(blockId), { method: 'DELETE' }),
  // §4 permissions — fetches the current user's pricing/catalog permission set from the session
  permissions: () => http<BookingPermissions>('/permissions').catch(() => ({ canOverridePrice: false, canEditCatalog: false, canManageAddOns: false, role: 'staff' } as BookingPermissions)),
};
export type { BookingFilters };
