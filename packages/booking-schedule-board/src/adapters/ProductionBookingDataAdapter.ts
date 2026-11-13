/**
 * ProductionBookingDataAdapter — the board on the EXISTING AIPowerSalon booking API (merge Nov 13 2026, spec §6/§41).
 *
 * No mock data, no business rule: every method is one or two calls to an existing `/pos/booking/*` (or
 * `/pos/check-in/*`) route plus a mapper from `posBookingWire.ts`. Tenant and branch come from the signed-in session
 * on the server (the browser never names them); the scope passed in is only echoed into the board's shapes.
 *
 *   getScheduleRange   GET  /pos/booking/technicians (server page) + GET /pos/booking/day-grid (those columns only)
 *   getAvailability    GET  /pos/booking/day-grid?technicianIds=…        (the same open ranges the board draws)
 *   findOpenings       GET  /pos/booking/availability?serviceIds=…        (server eligibility + schedule + holds)
 *   getBestMatches     GET  /pos/booking/openings?serviceIds=…            (eligibility first, then ranked)
 *   createAppointment  POST /pos/booking/appointments                      (Idempotency-Key; technician 'any' → the
 *                                                                          engine's first-available rule)
 *   moveAppointment    POST /pos/booking/appointments/:id/reschedule       (expectedVersion; server re-validates all)
 *   cancelAppointment  POST /pos/booking/appointments/:id/cancel           (reason required by the server)
 *   createWalkIn       POST /pos/check-in/walk-in                          (Idempotency-Key; 'any' → Fair Turn queue)
 *   createBlockedTime  POST /pos/booking/blocked-times                     (audited on the server)
 *   getTechnicianDay   GET  /pos/booking/day-grid?technicianIds=<id>
 *   getServices        injected loader (the host already holds the catalog from GET /pos/booking/state)
 *   locateTechnician   GET  /pos/booking/technicians?locate=<id>           (jump-to-technician)
 *   subscribeSchedule  the host's realtime bridge (SSE + change feed)
 */
import { BookingDomainError } from '../domain/bookingErrors';
import type { Appointment, AppointmentStatus, ISODate, OpeningResult, ScheduleRange, ScheduleSegment, Service, TechnicianDay, TechnicianMatch, Unsubscribe } from '../domain/scheduleTypes';
import { minuteOfDay, minutesToHHmm } from '../domain/time';
import type { RealtimeClient, ScheduleEventEnvelope } from '../realtime/events';
import type {
  AvailabilityResult,
  BookingDataAdapter,
  CancelAppointmentInput,
  CreateAppointmentInput,
  CreateBlockedTimeInput,
  CreateWalkInInput,
  FindOpeningsInput,
  GetAvailabilityInput,
  GetBestMatchesInput,
  GetScheduleRangeInput,
  GetServicesInput,
  GetTechnicianDayInput,
  LocateTechnicianInput,
  MoveAppointmentInput,
  SubscribeScheduleInput,
} from './BookingDataAdapter';
import {
  mapAppointment, mapBlockedTime, mapHostError, mapMatches, mapOpenings, mapScheduleRange, mapServices, mapTechnicianDay, serverSourceOf, serverStatusOf,
  type WireAppointmentRow, type WireAvailabilityRow, type WireBlockedTime, type WireCatalogService, type WireDayGrid, type WireOpenings, type WireScope, type WireTechPage,
} from './posBookingWire';

/** Minimal HTTP surface: the host injects its existing authenticated client (session cookie / tenant headers, its
 *  error mapping). It must THROW on a non-2xx answer with `{ status, code?, message?, currentVersion? }`. */
export interface HttpClient {
  request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
}

/** Host filters the server applies to the day grid (status / source / category / search / deposit / conflicts). */
export interface HostDayGridFilters { status?: string; source?: string; serviceCategory?: string; search?: string; depositStatus?: string; conflictOnly?: boolean }

export interface ProductionAdapterOptions {
  http: HttpClient;
  realtime: RealtimeClient;
  /** the branch's IANA time zone (the salon day) — read at call time */
  timezone: () => string;
  /** the catalog the host already loaded (GET /pos/booking/state filters.services) */
  loadServices: () => Promise<WireCatalogService[]>;
  /** host-side server filters for the day grid, read at call time */
  filters?: () => HostDayGridFilters;
  /** words for Best Matches reasons (the host's language) */
  reasonText?: (key: 'rank' | 'openSlots' | 'roster', vars: Record<string, number>) => string;
  /** shared with the HostScheduleBridge: snapshot and event versions come from ONE strictly increasing clock */
  clock?: MonotonicClock;
  /** called with every page the board loads (the host scopes realtime refreshes and opens rows from it) */
  onRangeLoaded?: (info: { range: ScheduleRange; grid: WireDayGrid; page: WireTechPage }) => void;
}

/** Strictly increasing version source (ms-based). One instance is shared by the adapter (snapshot versions) and the
 *  bridge (event versions), so an event published after a snapshot started always outranks it → the board reloads. */
export class MonotonicClock {
  private last = 0;
  constructor(private readonly now: () => number = Date.now) {}
  next(): number { const v = Math.max(this.last + 1, Math.floor(this.now())); this.last = v; return v; }
}

const BASE = '/pos/booking';
const qs = (o: Record<string, unknown>): string => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};
const defaultReason = (key: 'rank' | 'openSlots' | 'roster', v: Record<string, number>) =>
  key === 'rank' ? `Rank ${v.n} of ${v.total} eligible` : key === 'openSlots' ? `${v.n} open start times left today` : `Roster #${v.n}`;

export class ProductionBookingDataAdapter implements BookingDataAdapter {
  readonly pagesOnServer = true;
  private readonly o: ProductionAdapterOptions;
  private readonly clock: MonotonicClock;
  /** the raw rows of the loaded page (the host opens its full appointment view from them) */
  readonly rows = new Map<string, WireAppointmentRow>();

  constructor(opts: ProductionAdapterOptions) { this.o = opts; this.clock = opts.clock ?? new MonotonicClock(); }

  private scope(i: { tenantId: string; branchId: string }): WireScope { return { tenantId: i.tenantId, branchId: i.branchId, timezone: this.o.timezone() }; }
  private nextVersion(): number { return this.clock.next(); }

  private async call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    try {
      return await this.o.http.request<T>(method, path, body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    } catch (e) {
      if (BookingDomainError.is(e)) throw e;
      if (e instanceof TypeError) throw new BookingDomainError('NETWORK_ERROR');
      throw mapHostError(e);
    }
  }

  private gridPath(date: ISODate, technicianIds: string[], statuses?: AppointmentStatus[]): string {
    const f = this.o.filters?.() ?? {};
    // one status from the board's own filter goes to the server; otherwise the host's toolbar filter
    const boardStatus = statuses?.length === 1 ? serverStatusOf(statuses[0]) : null;
    return `${BASE}/day-grid${qs({ date, technicianIds, status: boardStatus ?? f.status, source: f.source, serviceCategory: f.serviceCategory, search: f.search, depositStatus: f.depositStatus, conflictOnly: f.conflictOnly ? 'true' : undefined })}`;
  }

  async getScheduleRange(i: GetScheduleRangeInput): Promise<ScheduleRange> {
    const version = this.nextVersion();   // taken BEFORE the reads: an event during the read still triggers a reload
    const page = await this.call<WireTechPage>('GET', `${BASE}/technicians${qs({ date: i.fromDate, page: i.page ?? 1, pageSize: i.pageSize, working: i.workingOnly ? 'true' : undefined })}`);
    const ids = page.technicians.map((t) => t.technicianId);
    const grid: WireDayGrid = ids.length
      ? await this.call<WireDayGrid>('GET', this.gridPath(page.date || i.fromDate, ids, i.statuses))
      : { date: page.date || i.fromDate, openTime: '09:00', closeTime: '19:00', columns: [], appointments: [] };
    const range = mapScheduleRange(page, grid, this.scope(i), version);
    this.rows.clear();
    for (const r of grid.appointments ?? []) this.rows.set(r.appointmentId, r);
    this.o.onRangeLoaded?.({ range, grid, page });
    return range;
  }

  async getAvailability(i: GetAvailabilityInput): Promise<AvailabilityResult> {
    const ids = i.technicianIds ?? [];
    const page: WireTechPage = { date: i.date, technicians: [], total: 0, totalAll: 0, workingCount: 0, page: 1, pageSize: ids.length, totalPages: 1 };
    const grid = await this.call<WireDayGrid>('GET', this.gridPath(i.date, ids));
    page.technicians = grid.columns.map((c, k) => ({ technicianId: c.technicianId, name: c.name, rosterNumber: k + 1, avatarUrl: c.avatarUrl ?? null, available: c.available, workingToday: c.windows.length > 0 }));
    const range = mapScheduleRange(page, grid, this.scope(i), this.nextVersion());
    const gaps: AvailabilityResult['gaps'] = {};
    for (const [id, list] of Object.entries(range.availability)) gaps[id] = i.minimumDurationMinutes ? list.filter((g) => g.durationMinutes >= i.minimumDurationMinutes!) : list;
    return { date: range.date, timezone: range.timezone, gaps, serverVersion: range.serverVersion };
  }

  async findOpenings(i: FindOpeningsInput): Promise<OpeningResult[]> {
    const services = await this.getServices(i);
    const duration = i.durationMinutes ?? i.serviceIds.reduce((n, id) => n + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0);
    const rows = await this.call<WireAvailabilityRow[]>('GET', `${BASE}/availability${qs({ date: i.date, serviceIds: i.serviceIds, technicianId: i.technicianId ?? undefined })}`);
    return mapOpenings(rows, i.date, duration, this.scope(i), { windowStart: i.windowStart, windowEnd: i.windowEnd, limit: i.limit });
  }

  async getBestMatches(i: GetBestMatchesInput): Promise<TechnicianMatch[]> {
    const r = await this.call<WireOpenings>('GET', `${BASE}/openings${qs({ date: i.date, serviceIds: i.serviceIds, limit: 10 })}`);
    const matches = mapMatches(r, this.scope(i), this.o.reasonText ?? defaultReason);
    // a requested technician is shown first when the server ranked them (never added when the server did not)
    return i.requestedTechnicianId ? [...matches.filter((m) => m.technicianId === i.requestedTechnicianId), ...matches.filter((m) => m.technicianId !== i.requestedTechnicianId)] : matches;
  }

  async createAppointment(i: CreateAppointmentInput): Promise<Appointment> {
    const tz = this.o.timezone();
    const date = i.startAt.slice(0, 10);
    const body = {
      customerName: i.customerName, customerPhone: i.customerPhone ?? undefined, customerId: i.customerId ?? undefined,
      serviceIds: [...i.serviceIds, ...(i.addOnIds ?? [])], technicianId: i.technicianId === 'any' ? undefined : i.technicianId,
      date, startTime: minutesToHHmm(minuteOfDay(i.startAt, date, tz)), source: serverSourceOf(i.source), notes: i.notes ?? undefined,
    };
    const row = await this.call<WireAppointmentRow>('POST', `${BASE}/appointments`, body, i.idempotencyKey);
    return mapAppointment(row, date, this.scope(i));
  }

  async moveAppointment(i: MoveAppointmentInput): Promise<Appointment> {
    const tz = this.o.timezone();
    const date = i.startAt.slice(0, 10);
    const row = await this.call<WireAppointmentRow>('POST', `${BASE}/appointments/${encodeURIComponent(i.appointmentId)}/reschedule`,
      { startTime: minutesToHHmm(minuteOfDay(i.startAt, date, tz)), date, technicianId: i.technicianId, expectedVersion: i.expectedVersion }, i.idempotencyKey);
    return mapAppointment(row, date, this.scope(i));
  }

  async cancelAppointment(i: CancelAppointmentInput): Promise<void> {
    await this.call<unknown>('POST', `${BASE}/appointments/${encodeURIComponent(i.appointmentId)}/cancel`, { reason: i.reason ?? '' });
  }

  async createWalkIn(i: CreateWalkInInput): Promise<Appointment> {
    // the existing walk-in intake: 'any' leaves the technician to the queue / Fair Turn over the eligible set
    const r = await this.call<{ checkInId?: string; technicianId?: string | null; createdAt?: string }>('POST', '/pos/check-in/walk-in', {
      customerName: i.customerName, customerPhone: i.customerPhone ?? undefined, customerId: i.customerId ?? undefined,
      serviceIds: [...i.serviceIds, ...(i.addOnIds ?? [])], technicianId: i.technicianId === 'any' ? undefined : i.technicianId, notes: i.notes ?? undefined, idempotencyKey: i.idempotencyKey,
    }, i.idempotencyKey);
    const at = r.createdAt ?? new Date().toISOString();
    return { id: r.checkInId ?? '', tenantId: i.tenantId, branchId: i.branchId, customerId: i.customerId ?? null, customerName: i.customerName, technicianId: r.technicianId ?? '', items: [], startAt: at, endAt: at, status: 'arrived', source: 'walk_in', requestedTechnician: i.requestedTechnician, protected: false, version: 0, queueTicketId: r.checkInId ?? null };
  }

  async createBlockedTime(i: CreateBlockedTimeInput): Promise<ScheduleSegment> {
    const tz = this.o.timezone();
    const b = await this.call<WireBlockedTime>('POST', `${BASE}/blocked-times`, {
      technicianId: i.technicianId, date: i.date, startTime: minutesToHHmm(minuteOfDay(i.startAt, i.date, tz)), endTime: minutesToHHmm(minuteOfDay(i.endAt, i.date, tz)),
      reason: i.reason, note: i.notes ?? undefined,
    }, i.idempotencyKey);
    return mapBlockedTime(b, this.scope(i));
  }

  async getTechnicianDay(i: GetTechnicianDayInput): Promise<TechnicianDay> {
    const grid = await this.call<WireDayGrid>('GET', this.gridPath(i.date, [i.technicianId]));
    const c = grid.columns.find((x) => x.technicianId === i.technicianId);
    if (!c) throw new BookingDomainError('NOT_FOUND');
    const page: WireTechPage = { date: grid.date, technicians: [{ technicianId: c.technicianId, name: c.name, rosterNumber: 1, avatarUrl: c.avatarUrl ?? null, available: c.available, workingToday: c.windows.length > 0 }], total: 1, totalAll: 1, workingCount: c.windows.length ? 1 : 0, page: 1, pageSize: 1, totalPages: 1 };
    const day = mapTechnicianDay(mapScheduleRange(page, grid, this.scope(i), this.nextVersion()), i.technicianId);
    if (!day) throw new BookingDomainError('NOT_FOUND');
    return day;
  }

  async getServices(i: GetServicesInput): Promise<Service[]> {
    return mapServices(await this.o.loadServices(), this.scope(i));
  }

  async locateTechnician(i: LocateTechnicianInput): Promise<{ pageIndex: number } | null> {
    const r = await this.call<WireTechPage>('GET', `${BASE}/technicians${qs({ date: i.date, pageSize: i.pageSize, working: i.workingOnly ? 'true' : undefined, locate: i.technicianId })}`);
    return r.located ? { pageIndex: r.located.page - 1 } : null;
  }

  subscribeSchedule(i: SubscribeScheduleInput, handler: (e: ScheduleEventEnvelope) => void): Unsubscribe {
    return this.o.realtime.subscribe({ tenantId: i.tenantId, branchId: i.branchId, date: i.date }, handler);
  }
}

/**
 * The host's realtime as the board's RealtimeClient (spec §25, MERGE-CHECKLIST C16). The POS realtime layer (SSE +
 * the 15 s change-feed safety tick) already decides how much a change touches (`bookingRelevance`); the host calls
 * `resync(date?)` when the visible board must refresh. Each call publishes `schedule.resync` with a version newer than
 * any snapshot taken before it — the board reloads ONLY its current page (never the whole roster) — and an event that
 * names another date is skipped.
 */
export class HostScheduleBridge implements RealtimeClient {
  private readonly subs = new Set<{ date: ISODate; tenantId: string; branchId: string; fn: (e: ScheduleEventEnvelope) => void }>();
  constructor(private readonly clock: MonotonicClock = new MonotonicClock()) {}
  subscribe(sub: { tenantId: string; branchId: string; date: ISODate }, fn: (e: ScheduleEventEnvelope) => void): Unsubscribe {
    const entry = { ...sub, fn };
    this.subs.add(entry);
    return () => { this.subs.delete(entry); };
  }
  /** The board's day changed on the server (or might have) → reload it. `date` limits it to boards on that day. */
  resync(date?: ISODate | null): number {
    let n = 0;
    for (const s of this.subs) {
      if (date && s.date !== date) continue;
      const v = this.clock.next();
      s.fn({ tenantId: s.tenantId, branchId: s.branchId, date: s.date, serverVersion: v, at: new Date(v).toISOString(), event: { type: 'schedule.resync' } });
      n++;
    }
    return n;
  }
  get size(): number { return this.subs.size; }
}
