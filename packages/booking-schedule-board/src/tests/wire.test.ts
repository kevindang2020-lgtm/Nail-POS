// The board's production mapping on REAL wire payloads. The JSON in ./fixtures/wire was recorded from the real
// BookingController / BookingService / Kysely repository on PGlite by modules/booking
// `booking-board-wire.pgtest.vitest.spec.ts`, which also fails if the server's wire shape drifts from these files.
import { describe, expect, it } from 'vitest';
import { HostScheduleBridge, MonotonicClock, ProductionBookingDataAdapter, type HttpClient } from '../adapters/ProductionBookingDataAdapter';
import { mapAppointment, mapBlockedTime, mapHostError, mapMatches, mapOpenings, mapScheduleRange, mapStatus, POS_BOOKING_ERROR_CODES, type WireAvailabilityRow, type WireDayGrid, type WireOpenings, type WireTechPage, type WireAppointmentRow, type WireBlockedTime } from '../adapters/posBookingWire';
import { minuteOfDay } from '../domain/time';
import { emptyStore, applyEvent, storeFromRange } from '../state/scheduleStore';
import techPageJson from './fixtures/wire/tech-page.json';
import locateJson from './fixtures/wire/tech-page-locate.json';
import dayGridJson from './fixtures/wire/day-grid.json';
import availabilityJson from './fixtures/wire/availability.json';
import openingsJson from './fixtures/wire/openings.json';
import createdJson from './fixtures/wire/created.json';
import rescheduledJson from './fixtures/wire/rescheduled.json';
import blockedJson from './fixtures/wire/blocked.json';
import conflictJson from './fixtures/wire/error-conflict.json';
import versionJson from './fixtures/wire/error-version.json';
import notSkilledJson from './fixtures/wire/error-not-skilled.json';

const TZ = 'America/New_York';
const page = techPageJson as unknown as WireTechPage;
const grid = dayGridJson as unknown as WireDayGrid;
const scope = { tenantId: 'b0a10000-0000-4000-8000-000000000001', branchId: 'b0a10000-0000-4000-8000-000000000002', timezone: TZ };
const AVA = 'b0a10000-0000-4000-8000-0000000000a1';
const m = (iso: string) => minuteOfDay(iso, grid.date, TZ);

describe('wire → board (recorded from the real booking API)', () => {
  it('maps one server page + its day grid: technicians, working windows, server open ranges, appointments, paging', () => {
    const r = mapScheduleRange(page, grid, scope, 1000);
    expect(r.technicians.map((t) => t.displayName)).toEqual(page.technicians.map((t) => t.name));
    expect(r.technicians.every((t) => t.serviceIds === null)).toBe(true);           // eligibility stays on the server
    expect(r.paging).toMatchObject({ total: page.total, totalAll: page.totalAll, workingCount: page.workingCount, page: 1, pageSize: 12, totalPages: 1 });
    expect(r.paging!.rosterNumbers![AVA]).toBe(1);
    expect(r.branchHours).toEqual({ openAt: grid.openTime, closeAt: grid.closeTime });
    const col = grid.columns.find((c) => c.technicianId === AVA)!;
    // the board draws EXACTLY the server's open ranges (not a re-computation)
    expect(r.availability[AVA].map((g) => [m(g.startAt), m(g.endAt), g.durationMinutes])).toEqual(col.openRanges.map((o) => [o.start, o.end, o.minutes]));
    const working = r.segments.filter((s) => s.technicianId === AVA && s.type === 'working');
    expect(working.map((s) => [m(s.startAt), m(s.endAt)])).toEqual(col.windows.map((w) => [w.start, w.end]));
    const avaRows = (grid.appointments ?? []).filter((a) => a.technicianId === AVA);
    expect(r.appointments.filter((a) => a.technicianId === AVA).map((a) => a.id).sort()).toEqual(avaRows.map((a) => a.appointmentId).sort());
  });
  it('maps an appointment row: HH:MM in the branch zone → ISO, status/source vocabulary, version, price in cents', () => {
    const row = createdJson as unknown as WireAppointmentRow;
    const a = mapAppointment(row, grid.date, scope);
    expect(a.id).toBe(row.appointmentId);
    expect(m(a.startAt)).toBe(10 * 60);
    expect(m(a.endAt)).toBe(10 * 60 + 45);
    expect(a.status).toBe('scheduled');   // 'booked'
    expect(a.source).toBe('pos');         // 'manual'
    expect(a.version).toBe(1);
    expect(a.items[0]).toMatchObject({ serviceId: row.services![0].serviceId, name: 'Gel Polish', durationMinutes: 45, priceCents: 4000 });
    const moved = mapAppointment(rescheduledJson as unknown as WireAppointmentRow, grid.date, scope);
    expect(moved.version).toBe(2);        // the repository now returns the row's real version (was always 1)
    expect(m(moved.startAt)).toBe(9 * 60);
    expect(mapStatus('checked_in')).toBe('arrived');
    expect(mapStatus('in_service')).toBe('in_service');
  });
  it('a blocked-time answer becomes a non-bookable blocked segment', () => {
    const s = mapBlockedTime(blockedJson as unknown as WireBlockedTime, scope);
    expect(s).toMatchObject({ type: 'blocked', technicianId: (blockedJson as { technicianId: string }).technicianId, reason: 'Training' });
    expect(m(s.startAt)).toBe(12 * 60);
    expect(m(s.endAt)).toBe(12 * 60 + 30);
  });
  it('Find an Opening comes from the server’s bookable starts; a run of starts is one gap', () => {
    const rows = availabilityJson as unknown as WireAvailabilityRow[];
    const out = mapOpenings(rows, grid.date, 45, scope, { windowStart: '10:30', windowEnd: '11:30' });
    const ava = out.filter((o) => o.technicianId === AVA);
    // Ava's only start inside 10:30–11:30 is 10:45 (the 45-minute hole before her 11:30 appointment)
    expect(ava.map((o) => m(o.startAt))).toEqual([10 * 60 + 45]);
    expect(ava[0].gapDurationMinutes).toBe(45);
    expect(out.every((o) => m(o.startAt) >= 10 * 60 + 30 && m(o.endAt) <= 11 * 60 + 30)).toBe(true);
  });
  it('Best Matches keeps the server’s ranking (eligible only) and explains it', () => {
    const r = openingsJson as unknown as WireOpenings;
    const matches = mapMatches(r, scope, (k, v) => `${k}:${Object.values(v).join('/')}`);
    expect(matches.map((x) => x.technicianId)).toEqual(r.openings.map((o) => o.technicianId));
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
    expect(matches[0].reasons[0]).toBe(`rank:1/${r.eligibleCount}`);
  });
  it('refusal bodies → domain errors (409 overlap → APPOINTMENT_CONFLICT, stale → SCHEDULE_CHANGED, skill → INELIGIBLE)', () => {
    const asThrown = (j: { status: number; body: { code?: string; message?: string; currentVersion?: number } }) => ({ status: j.status, code: j.body.code, message: j.body.message, currentVersion: j.body.currentVersion });
    expect(mapHostError(asThrown(conflictJson)).code).toBe('APPOINTMENT_CONFLICT');
    const v = mapHostError(asThrown(versionJson));
    expect(v.code).toBe('SCHEDULE_CHANGED');
    expect(v.serverVersion).toBe((versionJson as { body: { currentVersion: number } }).body.currentVersion);
    expect(mapHostError(asThrown(notSkilledJson)).code).toBe('TECHNICIAN_SERVICE_INELIGIBLE');
    // the database's no-overlap refusal reaches the browser only as one of the service's 409 codes — never raw
    for (const c of ['SCHEDULE_CHANGED_ELSEWHERE', 'TECHNICIAN_DOUBLE_BOOKED', 'OVERBOOK_CONFIRMATION_REQUIRED', 'WINDOW_OVERLAPS_APPOINTMENT']) expect(POS_BOOKING_ERROR_CODES[c]).toBe('APPOINTMENT_CONFLICT');
    expect(mapHostError({ status: 500, message: 'duplicate key value violates unique constraint' }).message).not.toMatch(/constraint/);
    expect(mapHostError({ status: 403 }).code).toBe('PERMISSION_DENIED');
  });
  it('the adapter on recorded payloads: one technicians call + one day-grid call per page (never one per column), locate → page index', async () => {
    const calls: string[] = [];
    const http: HttpClient = { async request(_m, path) { calls.push(path); if (path.includes('locate=')) return locateJson as never; return (path.startsWith('/pos/booking/technicians') ? page : grid) as never; } };
    const p = new ProductionBookingDataAdapter({ http, realtime: new HostScheduleBridge(), timezone: () => TZ, loadServices: async () => [] });
    const range = await p.getScheduleRange({ tenantId: scope.tenantId, branchId: scope.branchId, fromDate: grid.date, toDate: grid.date, page: 1, pageSize: 12 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(`technicianIds=${page.technicians.map((t) => t.technicianId).join('%2C')}`);
    expect(range.technicians).toHaveLength(page.technicians.length);
    expect(p.rows.size).toBe((grid.appointments ?? []).length);
    const loc = await p.locateTechnician({ tenantId: scope.tenantId, branchId: scope.branchId, technicianId: 'b0a10000-0000-4000-8000-0000000000d1', date: grid.date, pageSize: 2 });
    expect(loc).toEqual({ pageIndex: 1 });
  });
});

describe('HostScheduleBridge (the POS realtime → the board)', () => {
  it('a resync after a snapshot always outranks it → the board reloads; an event for another date is skipped', () => {
    const clock = new MonotonicClock(() => 5000);   // a frozen wall clock: versions must still strictly increase
    const bridge = new HostScheduleBridge(clock);
    const range = mapScheduleRange(page, grid, scope, clock.next());
    const store = storeFromRange(range);
    const seen: number[] = [];
    let outcome = applyEvent(emptyStore, { tenantId: scope.tenantId, branchId: scope.branchId, date: grid.date, serverVersion: 1, at: '', event: { type: 'schedule.resync' } });
    expect(outcome.needsReload).toBe(false);   // nothing loaded yet
    const off = bridge.subscribe({ tenantId: scope.tenantId, branchId: scope.branchId, date: grid.date }, (e) => { seen.push(e.serverVersion); outcome = applyEvent(store, e); });
    expect(bridge.resync('2031-12-31')).toBe(0);   // another day: not this board
    expect(bridge.resync(grid.date)).toBe(1);
    expect(seen[0]).toBeGreaterThan(range.serverVersion);
    expect(outcome.needsReload).toBe(true);
    off();
    expect(bridge.size).toBe(0);
  });
});
