// ai-calendar-center.pgtest — AI Calendar Complete Build Guide §18 (T07–T20, T24, T27, T31–T37, T40, T42–T46) on the real
// schema. BookingService's two reads (dayGrid / technicianPage) are stood in by a stub that reads the SAME canonical rows
// through raw SQL and the engine's own pure functions (the Kysely query builder is CI-only here); everything AI Calendar
// itself does — counts, holds, open-slot reconciliation, search, date bases, paging, overlay, health, assistant — is real.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { pbComputeAvailabilityInWindows } from '@aipowersalon/booking';
import { AiCalendarCenter, AiCalendarError, periodRange, phoneDigits, localToday, addDays, reconcileAppointments, type AicCtx } from './ai-calendar-center';

let db: any;
const TZ = 'America/New_York';
const T = randomUUID(), B = randomUUID(), T2 = randomUUID(), B2 = randomUUID();
const TECH = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];   // 3 working, 1 active but no hours
const T2TECH = randomUUID();
const C1 = randomUUID(), C2 = randomUUID(), CX = randomUUID();
const DAY = '2026-11-20';                       // a future Friday: no past-time clamp
const OWNER: AicCtx = { tenantId: T, branchId: B, userId: randomUUID(), role: 'OWNER', permissions: ['pos.booking.view', 'customers.export'] };
const FRONT: AicCtx = { tenantId: T, branchId: B, userId: randomUUID(), role: 'FRONT_DESK', permissions: ['pos.booking.view'] };
const OTHER: AicCtx = { tenantId: T2, branchId: B2, userId: randomUUID(), role: 'OWNER', permissions: ['pos.booking.view'] };
const WORKING = new Set(TECH.slice(0, 3));
const q = (s: any) => s.execute(db);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof AiCalendarError ? e.code : String((e as Error).message); } };

/** BookingService stand-in: same rows, same pure engine functions, same settings defaults (09:00–19:00, 15 / 45 / 5) */
const stubBooking = {
  async dayGrid(ctx: any, date?: string, ids?: string[]) {
    const techs = (await sql<any>`select id, full_name, is_active from technicians where tenant_id = ${ctx.tenantId} and archived_at is null and (${ctx.branchId || null}::uuid is null or branch_id = ${ctx.branchId || null}) order by full_name, id`.execute(db)).rows
      .filter((t: any) => !ids || ids.includes(t.id));
    const appts = (await sql<any>`select id, technician_id, start_time, end_time, status, source, customer_name, services, created_at from pos_tech_appointments where tenant_id = ${ctx.tenantId}
      and (${ctx.branchId || null}::uuid is null or branch_id = ${ctx.branchId || null} or branch_id is null) and appt_date = ${date}::date`.execute(db)).rows;
    const columns = techs.map((t: any) => {
      const windows = t.is_active && WORKING.has(t.id) ? [{ start: 540, end: 1140 }] : [];
      const mine = appts.filter((a: any) => a.technician_id === t.id).map((a: any) => ({ startTime: a.start_time, endTime: a.end_time, status: a.status }));
      return { technicianId: t.id, name: t.full_name, available: t.is_active, windows, blocked: [], openSlotCount: pbComputeAvailabilityInWindows(windows, 15, 45, 5, mine).length };
    });
    return { date, openTime: '09:00', closeTime: '19:00', slotIntervalMinutes: 15, bufferMinutes: 5, defaultServiceDurationMinutes: 45, columns,
      totalOpenSlots: columns.reduce((s: number, c: any) => s + c.openSlotCount, 0),
      appointments: appts.map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status, source: a.source, customerName: a.customer_name, services: a.services, createdAt: a.created_at })) };
  },
  async technicianPage(ctx: any, qy: any) {
    const techs = (await sql<any>`select id, full_name, is_active from technicians where tenant_id = ${ctx.tenantId} and archived_at is null and is_active order by full_name, id`.execute(db)).rows;
    const size = qy.pageSize ?? 12, page = qy.page ?? 1;
    return { date: qy.date, technicians: techs.slice((page - 1) * size, page * size).map((t: any, i: number) => ({ technicianId: t.id, name: t.full_name, rosterNumber: (page - 1) * size + i + 1, workingToday: WORKING.has(t.id) })),
      total: techs.length, totalAll: techs.length, workingCount: techs.filter((t: any) => WORKING.has(t.id)).length, availableNowCount: 2, page, pageSize: size, totalPages: Math.max(1, Math.ceil(techs.length / size)) };
  },
};
let cal: AiCalendarCenter;
async function appt(o: { tech?: string; date?: string; s: string; e: string; status?: string; source?: string; cust?: string | null; name?: string; phone?: string; created?: string; services?: unknown[]; tenant?: string; branch?: string }) {
  const id = randomUUID();
  await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status, created_at, updated_at)
    values (${id}, ${o.tenant ?? T}, ${o.branch ?? B}, ${o.tech ?? TECH[0]}, ${o.cust ?? null}, ${o.name ?? 'Walk In'}, ${o.phone ?? null}, ${o.source ?? 'manual'}, ${JSON.stringify(o.services ?? [{ serviceName: 'Gel Manicure', durationMinutes: 45 }])}::jsonb,
      ${o.date ?? DAY}::date, ${o.s}, ${o.e}, ${minutes(o.s, o.e)}, ${o.status ?? 'booked'}, ${o.created ?? new Date().toISOString()}::timestamptz, ${o.created ?? new Date().toISOString()}::timestamptz)`);
  return id;
}
const minutes = (s: string, e: string) => (Number(e.slice(0, 2)) * 60 + Number(e.slice(3))) - (Number(s.slice(0, 2)) * 60 + Number(s.slice(3)));
const local = (d: string, hm: string) => sql`(${d + ' ' + hm}::timestamp at time zone ${TZ})`;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [t, b, slug] of [[T, B, 'aical-a'], [T2, B2, 'aical-b']]) {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '')}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${b}, ${t}, 'Main', ${TZ})`);
  }
  const names = ['Anna Tran', 'Bella Ng', 'Cora Le', 'Dana Vu'];
  for (let i = 0; i < 4; i++) await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH[i]}, ${T}, ${B}, ${names[i].split(' ')[0]}, ${names[i].split(' ')[1]}, ${names[i]}, true)`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${T2TECH}, ${T2}, ${B2}, 'Other', 'Salon', 'Other Salon Tech', true)`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values (${C1}, ${T}, ${B}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'Ava.Kim@Example.com'),
    (${C2}, ${T}, ${B}, 'Ben', 'Lo', 'Ben Lo', '+16095550199', 'ben@example.com')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values (${CX}, ${T2}, ${B2}, 'Ava', 'Kimball', 'Ava Kimball', '+16095550142', 'ava.kim@example.com')`);
  cal = new AiCalendarCenter(db, stubBooking as any);
});

describe('T31–T37 the four counters, traced to canonical rows', () => {
  it('Appointments excludes cancelled / no-show; AI-Created is canonical source "ai" only; a pending-code hold is never an appointment', async () => {
    await appt({ tech: TECH[0], s: '10:00', e: '11:00', source: 'ai', cust: C1 });
    await appt({ tech: TECH[1], s: '10:00', e: '10:45', source: 'online' });
    await appt({ tech: TECH[2], s: '15:00', e: '16:00', status: 'cancelled', source: 'ai' });
    await appt({ tech: TECH[2], s: '16:00', e: '17:00', status: 'no_show' });
    const aiLinked = await appt({ tech: TECH[1], s: '13:00', e: '13:45', source: 'ai', cust: C2 });
    await q(sql`insert into voice_tool_executions (tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status, related_type, related_id) values (${T}, ${B}, 'call_abc123', ${randomUUID()}, 'book_appointment', 'write', 'succeeded', 'appointment', ${aiLinked})`);
    // a booking still waiting for its six-digit code: a live hold with a booking session — not an appointment
    await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel) values (${T}, ${B}, ${TECH[2]}, ${local(DAY, '12:00')}, ${local(DAY, '13:00')}, now() + interval '10 minutes', 'held', ${randomUUID()}, 'online')`);
    const s = await cal.summary(OWNER, DAY);
    expect({ a: s.appointments, ai: s.aiCreated, linked: s.aiLinkedToCall, x: s.cancelled, ns: s.noShow, pend: s.pendingVerification }).toEqual({ a: 3, ai: 2, linked: 1, x: 1, ns: 1, pend: 1 });
    expect(s.definitions.aiCreated).toMatch(/never counted/);
  });
  it('T32 Open Slots: engine total vs hold-aware value — the 12:00–13:00 hold removes exactly 8 start times on its technician', async () => {
    const s = await cal.summary(OWNER, DAY);
    const g = await stubBooking.dayGrid({ tenantId: T, branchId: B }, DAY);
    expect(s.openSlots.engineValue).toBe(g.totalOpenSlots);
    expect(s.openSlots.value).toBe(g.totalOpenSlots - 8);     // starts 11:15 … 13:00 clash with [12:00,13:00) ± 5-minute buffer
    expect(s.openSlots.columnsCounted).toBe(3);                // Dana is active but has no working hours: no column counted
    expect(s.openSlots.reconciliation.join(' ')).toMatch(/8 start time\(s\) removed because a live booking hold/);
    expect(s.openSlots.definition).toMatch(/45-minute service.*15-minute grid/);
    // round 10 (AI Calendar 03): the same count per technician (sums to the value) with each one's mapped active services
    const by = s.openSlots.byTechnician as Array<{ technicianId: string; name: string | null; openStarts: number; qualifiedServices: number }>;
    expect(by).toHaveLength(3);
    expect(by.reduce((a, x) => a + x.openStarts, 0)).toBe(s.openSlots.value);
    expect(by.every((x) => typeof x.qualifiedServices === 'number')).toBe(true);
    const unmapped = by.filter((x) => !x.qualifiedServices).length;
    expect(s.openSlots.reconciliation.join(' ')).toMatch(unmapped ? /mapped to no active service/ : /Every counted technician is mapped/);
    // map one technician to one active service (and one archived) → exactly that technician counts 1
    const cat = randomUUID(), sv = randomUUID(), old = randomUUID(), tech = by[0].technicianId;
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${cat}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values (${sv}, ${T}, ${B}, ${cat}, 'Gel', 45, 4000, 'active', null), (${old}, ${T}, ${B}, ${cat}, 'Old', 45, 4000, 'active', now())`);
    await q(sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B}, ${tech}, ${sv}), (${T}, ${B}, ${tech}, ${old})`);
    const s2 = await cal.summary(OWNER, DAY);
    const by2 = s2.openSlots.byTechnician as Array<{ technicianId: string; qualifiedServices: number }>;
    expect(by2.find((x) => x.technicianId === tech)!.qualifiedServices).toBe(by.find((x) => x.technicianId === tech)!.qualifiedServices + 1);
    await q(sql`delete from technician_services where tenant_id = ${T} and service_id in (${sv}, ${old})`);
  });
  it('A11 Nov 6: Open Slots counts only inside the branch’s saved opening hours; a saved closed day counts none; removing them restores the engine hours', async () => {
    const full = await cal.summary(OWNER, DAY);
    // Friday (dow 5): saved hours 10:00–16:00
    await q(sql`insert into tenant_location_hours (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed) values (${T}, ${B}, 5, '10:00', '16:00', false)`);
    const s = await cal.summary(OWNER, DAY);
    expect(s.openSlots.savedHours).toBe('10:00–16:00');
    expect(s.openSlots.value!).toBeLessThan(full.openSlots.value!);
    expect(s.openSlots.value! + s.openSlots.hoursExcluded).toBeGreaterThanOrEqual(full.openSlots.value!);
    expect(s.openSlots.engineValue).toBe(full.openSlots.engineValue);                  // Booking's own grid is untouched
    expect(s.openSlots.reconciliation.join(' ')).toMatch(/saved hours 10:00–16:00/);
    await q(sql`update tenant_location_hours set is_closed = true where tenant_id = ${T} and location_id = ${B}`);
    const c = await cal.summary(OWNER, DAY);
    expect(c.openSlots.value).toBe(0); expect(c.openSlots.savedHours).toBe('closed');
    await q(sql`delete from tenant_location_hours where tenant_id = ${T} and location_id = ${B}`);
    expect((await cal.summary(OWNER, DAY)).openSlots.value).toBe(full.openSlots.value);
  });
  it('T32 an expired or converted hold no longer removes availability', async () => {
    const before = (await cal.summary(OWNER, DAY)).openSlots.value!;
    await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status) values (${T}, ${B}, ${TECH[0]}, ${local(DAY, '17:00')}, ${local(DAY, '18:00')}, now() - interval '1 minute', 'held')`);
    expect((await cal.summary(OWNER, DAY)).openSlots.value).toBe(before);
  });
  it('Pending Verification Queue: live holds only, soonest to expire first, with the waiting-for-code and about-to-lapse flags', async () => {
    const pq = await cal.pendingQueue(OWNER);
    expect(pq.items.length).toBeGreaterThan(0);
    expect(pq.items.every((h) => Date.parse(h.expiresAt) > Date.now())).toBe(true);           // the expired 17:00 hold is gone
    const order = pq.items.map((h) => Date.parse(h.expiresAt)); expect([...order].sort((a, b) => a - b)).toEqual(order);
    const coded = pq.items.find((h) => h.pendingCode && h.start === '12:00')!;
    expect(coded).toMatchObject({ channel: 'online', expiringSoon: true }); expect(coded.minutesLeft).toBeLessThanOrEqual(10);
    expect(pq.pendingCode).toBe(pq.items.filter((h) => h.pendingCode).length); expect(pq.timeZone).toBe(TZ);
    const mine = new Set(pq.items.map((h) => h.id)); expect((await cal.pendingQueue(OTHER)).items.some((h) => mine.has(h.id))).toBe(false);   // never another salon's
  });
  it('T33 Technicians On is "scheduled today" (3), not the 4 active records; the legacy number is reported beside it', async () => {
    const s = await cal.summary(OWNER, DAY);
    expect({ v: s.technicians.value, active: s.technicians.activeRoster, metric: s.technicians.metric }).toEqual({ v: 3, active: 4, metric: 'scheduled_today' });
    expect(s.technicians.clockedIn).toBeNull();               // not today: clock-ins are only meaningful for the current day
  });
  it('T33 today: clocked in counts open punches only', async () => {
    const { today } = localToday(TZ);
    await q(sql`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values (${T}, ${B}, ${TECH[0]}, ${today}::date, now() - interval '2 hours', null, 'active'),
      (${T}, ${B}, ${TECH[1]}, ${today}::date, now() - interval '5 hours', now() - interval '1 hour', 'completed')`);
    expect((await cal.summary(OWNER, today)).technicians.clockedIn).toBe(1);
  });
  it('T16 the day defaults to the branch\'s own clock, never the browser', async () => {
    expect((await cal.summary(OWNER)).date).toBe(localToday(TZ).today);
  });
});

describe('T07–T13 search and filters (server-side, tenant-scoped)', () => {
  it('partial name, phone with punctuation and country code, email (case-insensitive), exact appointment id, technician, service', async () => {
    const id = await appt({ tech: TECH[2], s: '09:00', e: '09:45', cust: C1, name: 'Ava Kim', phone: '+16095550142', services: [{ serviceName: 'Pedicure Deluxe', durationMinutes: 45 }] });
    const ids = async (qq: string) => (await cal.list(OWNER, { q: qq, period: 'custom', from: DAY, to: DAY })).items.map((r: any) => r.id);
    expect(await ids('ava')).toContain(id);
    expect(await ids('+1 (609) 555-0142')).toContain(id);
    expect(await ids('ava.kim@example.com')).toContain(id);
    expect(await ids(id)).toEqual([id]);
    expect(await ids('Cora')).toContain(id);
    expect(await ids('pedicure')).toEqual([id]);
  });
  it('T11 source, status and AI-created-only filters', async () => {
    const all = await cal.list(OWNER, { period: 'custom', from: DAY, to: DAY, pageSize: 50 });
    const ai = await cal.list(OWNER, { period: 'custom', from: DAY, to: DAY, aiOnly: 'true', pageSize: 50 });
    expect(ai.items.every((r: any) => r.source === 'ai')).toBe(true);
    expect(ai.total).toBe(all.items.filter((r: any) => r.source === 'ai').length);
    expect((await cal.list(OWNER, { period: 'custom', from: DAY, to: DAY, status: 'cancelled' })).total).toBe(1);
    expect(await code(cal.list(OWNER, { status: 'teleported' }))).toBe('AI_CALENDAR_INVALID_FILTER');
  });
  it('T12 another salon\'s customer with the same phone and email is never returned', async () => {
    const xid = await appt({ tenant: T2, branch: B2, tech: T2TECH, s: '09:00', e: '10:00', cust: CX, name: 'Ava Kimball', phone: '+16095550142' });
    const mine = await cal.list(OWNER, { q: '6095550142', period: 'custom', from: DAY, to: DAY, pageSize: 50 });
    expect(mine.items.map((r: any) => r.id)).not.toContain(xid);
    expect(await code(cal.detail(OWNER, xid))).toBe('AI_CALENDAR_NOT_FOUND');
    expect((await cal.summary(OTHER, DAY)).appointments).toBe(1);
  });
  it('contact details are masked in lists', async () => {
    const r = (await cal.list(OWNER, { q: 'ava', period: 'custom', from: DAY, to: DAY })).items[0];
    expect(r.phone).toBe('•••0142');
  });
});

describe('T14–T20 dates and pagination', () => {
  it('T14/T15 presets and custom range; an inverted range is refused', () => {
    expect(periodRange('week', '2026-10-30')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });   // leap year
    expect(periodRange('year', '2026-10-30')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('custom', '2026-10-30', '2026-12-28', '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });   // cross-year
    expect(() => periodRange('custom', '2026-10-30', '2026-11-05', '2026-11-01')).toThrow(AiCalendarError);
    expect(phoneDigits('+1 (609) 555-0142')).toBe('6095550142');
  });
  it('T16 created-at basis uses salon-local day bounds across the DST change (Nov 1 2026, New York)', async () => {
    const inside = await appt({ tech: TECH[3], date: '2026-11-03', s: '09:00', e: '10:00', created: '2026-11-02T04:30:00Z' });   // Nov 1 23:30 EST
    const after = await appt({ tech: TECH[3], date: '2026-11-03', s: '11:00', e: '12:00', created: '2026-11-02T05:10:00Z' });    // Nov 2 00:10 EST
    const before = await appt({ tech: TECH[3], date: '2026-11-03', s: '13:00', e: '14:00', created: '2026-11-01T03:50:00Z' });   // Oct 31 23:50 EDT
    const got = (await cal.list(OWNER, { basis: 'created', period: 'custom', from: '2026-11-01', to: '2026-11-01', pageSize: 50 })).items.map((r: any) => r.id);
    expect(got).toContain(inside); expect(got).not.toContain(after); expect(got).not.toContain(before);
  });
  it('T17/T18/T20 pages of 10: newest created first, stable tie-break, no duplicates or gaps across pages', async () => {
    const D = '2026-12-04'; const stamp = '2026-11-15T15:00:00Z';
    for (let i = 0; i < 25; i++) await appt({ tech: TECH[i % 3], date: D, s: `${String(9 + Math.floor(i / 3)).padStart(2, '0')}:00`, e: `${String(9 + Math.floor(i / 3)).padStart(2, '0')}:45`, created: i < 5 ? stamp : new Date(Date.UTC(2026, 10, 10, 12, i)).toISOString() });
    const pages = [1, 2, 3].map((p) => cal.list(OWNER, { period: 'custom', from: D, to: D, page: p, pageSize: 10 }));
    const [p1, p2, p3] = await Promise.all(pages);
    expect([p1.total, p1.totalPages, p1.items.length, p2.items.length, p3.items.length]).toEqual([25, 3, 10, 10, 5]);
    const seq = [...p1.items, ...p2.items, ...p3.items];
    expect(new Set(seq.map((r: any) => r.id)).size).toBe(25);
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      expect(a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id)).toBe(true);
    }
    const sched = await cal.list(OWNER, { period: 'custom', from: D, to: D, sort: 'scheduled', pageSize: 50 });
    expect(sched.items.map((r: any) => r.start)).toEqual([...sched.items.map((r: any) => r.start)].sort());
  });
  it('T05/T19 week and month views: salon-local dates in order, day totals', async () => {
    const w = await cal.rangeView(OWNER, { view: 'week', date: DAY });
    expect(w.days.map((d: any) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(w.days.find((d: any) => d.date === DAY).appointments).toBe((await cal.summary(OWNER, DAY)).appointments);
    const m = await cal.rangeView(OWNER, { view: 'month', date: '2028-02-10' });
    expect(m.days).toHaveLength(29);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('T40/T42 overlay, T44 health, T43 assistant', () => {
  it('overlay: canonical fields, AI evidence, masked contact for a role without contact permission, and the view is audited', async () => {
    const id = (await cal.list(OWNER, { q: 'Ben Lo', period: 'custom', from: DAY, to: DAY })).items[0].id;
    const full = await cal.detail(OWNER, id);
    expect(full.overview.aiCreated).toBe(true);
    expect(full.overview.aiEvidence).toMatch(/linked to an AI call/);
    expect(full.customer.phone).toBe('+16095550199');
    const masked = await cal.detail(FRONT, id);
    expect([masked.customer.phone, masked.customer.contactMasked]).toEqual(['•••0199', true]);
    expect(masked.links.openBooking).toBe(`/booking?date=${DAY}&appointmentId=${id}`);
    const n = (await sql<any>`select count(*)::int c from audit_events where tenant_id = ${T} and module = 'ai_calendar' and resource_id = ${id}`.execute(db)).rows[0].c;
    expect(n).toBe(2);
  });
  it('extras #02 Verified Appointment Timeline: held → code sent → verified → booked → confirmed → checked in → completed, each with its stored row id; no code or phone', async () => {
    const id = await appt({ tech: TECH[3], date: '2026-11-25', s: '10:00', e: '10:45', source: 'online', cust: C1, created: '2026-11-20T15:05:00Z' });
    const hold = randomUUID(), vs = randomUUID(), sess = randomUUID();
    await q(sql`insert into booking_holds (id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, converted_appointment_id, created_at)
      values (${hold}, ${T}, ${B}, ${TECH[3]}, ${local('2026-11-25', '10:00')}, ${local('2026-11-25', '10:45')}, '2026-11-20T15:10:00Z', 'converted', ${sess}, 'online', ${id}, '2026-11-20T15:00:00Z')`);
    await q(sql`insert into booking_verification_sessions (id, tenant_id, branch_id, booking_session_id, booking_hold_id, customer_id, phone_hash, phone_mask, channel, status, expires_at, last_sent_at, verified_at, created_at)
      values (${vs}, ${T}, ${B}, ${sess}, ${hold}, ${C1}, 'h4sh', '•••0142', 'online', 'verified', '2026-11-20T15:10:00Z', '2026-11-20T15:01:00Z', '2026-11-20T15:03:00Z', '2026-11-20T15:01:00Z')`);
    const ch = async (from: string | null, to: string, at: string) => { const cid = randomUUID(); await q(sql`insert into appointment_change_log (id, tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, source, created_at)
      values (${cid}, ${T}, ${B}, ${id}, 'status_changed', 'status', ${from}, ${to}, 'pos', ${at}::timestamptz)`); return cid; };
    const c1 = await ch('booked', 'confirmed', '2026-11-21T14:00:00Z'); await ch('confirmed', 'checked_in', '2026-11-25T14:55:00Z'); const c3 = await ch('checked_in', 'completed', '2026-11-25T15:50:00Z');
    await q(sql`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, source) values (${T}, ${B}, ${id}, 'updated', 'notes', 'a', 'b', 'pos')`);   // not a status step
    const d = await cal.detail(OWNER, id);
    expect(d.timeline.map((x) => x.step)).toEqual(['held', 'otp_sent', 'otp_verified', 'booked', 'status:confirmed', 'status:checked_in', 'status:completed']);
    expect(d.timeline[0]!.ref).toEqual({ table: 'booking_holds', id: hold });
    expect(d.timeline[2]!.ref).toEqual({ table: 'booking_verification_sessions', id: vs });
    expect(d.timeline[3]!.ref).toEqual({ table: 'pos_tech_appointments', id });
    expect(d.timeline[4]!.ref.id).toBe(c1); expect(d.timeline[6]!.ref.id).toBe(c3); expect(d.timeline[6]!.detail).toBe('from checked_in');
    expect(JSON.stringify(d.timeline)).not.toMatch(/h4sh|0142/);
    // an appointment with no hold and no recorded change has ONE step: booked (nothing inferred)
    const bare = await appt({ tech: TECH[3], date: '2026-11-26', s: '10:00', e: '10:45', status: 'confirmed' });
    expect((await cal.detail(OWNER, bare)).timeline.map((x) => x.step)).toEqual(['booked']);
  });

  it('health: 8 groups, parity READY, a real overlap is FAILED, the run is recorded and a repeat within 30 s returns it', async () => {
    // legacy data from before the exclusion constraint (this spec's own database only): an unapproved overlap
    await q(sql`alter table pos_tech_appointments drop constraint pos_tech_appointments_no_overlap`);
    await appt({ tech: TECH[0], date: '2026-11-21', s: '10:00', e: '11:00' });
    await appt({ tech: TECH[0], date: '2026-11-21', s: '10:30', e: '11:30' });
    const h = await cal.health(OWNER, DAY);
    expect(h.rateLimited).toBe(false);
    expect(h.checks.map((c: any) => c.group)).toEqual(['Canonical Booking', 'Technician Schedule', 'Holds & OTP', 'AI provenance', 'Realtime events', 'Metrics', 'Conflicts', 'Permission & audit']);
    expect(h.checks.find((c: any) => c.id === 'booking').state).toBe('READY');
    expect(h.checks.find((c: any) => c.id === 'conflicts').state).toBe('FAILED');
    expect(h.overall).toBe('FAILED');
    const again = await cal.health(OWNER, DAY);
    expect([again.rateLimited, again.runId]).toEqual([true, h.runId]);
    expect((await sql<any>`select count(*)::int c from ai_calendar_health_runs where tenant_id = ${T}`.execute(db)).rows[0].c).toBe(1);
  });
  it('assistant: verified openings and staff conflicts with evidence; a code-pending hold expiring soon; nothing is written', async () => {
    await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel) values (${T}, ${B}, ${TECH[1]}, ${local('2026-11-21', '16:00')}, ${local('2026-11-21', '17:00')}, now() + interval '2 minutes', 'held', ${randomUUID()}, 'ai_receptionist')`);
    const before = (await sql<any>`select count(*)::int c, max(updated_at) u from pos_tech_appointments where tenant_id = ${T}`.execute(db)).rows[0];
    const a = await cal.assistant(OWNER, '2026-11-21');
    const kinds = a.cards.map((c: any) => c.kind);
    expect(kinds).toContain('verified_openings'); expect(kinds).toContain('staff_conflict'); expect(kinds).toContain('verification_expiring');
    const conflict = a.cards.find((c: any) => c.kind === 'staff_conflict');
    expect(conflict.proposal.type).toBe('reschedule_review');
    expect(a.cards.find((c: any) => c.kind === 'verification_expiring').evidence.join(' ')).not.toMatch(/\b\d{6}\b/);   // never a code
    const after = (await sql<any>`select count(*)::int c, max(updated_at) u from pos_tech_appointments where tenant_id = ${T}`.execute(db)).rows[0];
    expect(after).toEqual(before);
  });
  it('day view: 12 technicians per page with an X–Y of N label, appointments in service-time order, live holds listed', async () => {
    const d = await cal.dayView(OWNER, { date: DAY });
    expect(d.techPaging.label).toBe('1–4 of 4');
    const starts = d.appointments.map((x: any) => x.start);
    expect(starts).toEqual([...starts].sort());
    expect(d.holds.some((h: any) => h.pendingVerification)).toBe(true);
  });
});

describe('AI Calendar #06 one-click POS Booking reconciliation (read-only)', () => {
  it('reconcileAppointments: one-side ids and status flips; a cancelled row left out by one read is not a discrepancy', () => {
    const r = reconcileAppointments(
      [{ id: 'a', status: 'booked' }, { id: 'b', status: 'confirmed' }, { id: 'c', status: 'cancelled' }, { id: 'd', status: 'booked' }],
      [{ id: 'a', status: 'booked' }, { id: 'b', status: 'checked_in' }, { id: 'e', status: 'booked' }, { id: 'f', status: 'no_show' }]);
    expect(r).toEqual({ onlyCalendar: ['d'], onlyBooking: ['e'], statusDiffers: [{ id: 'b', calendar: 'confirmed', booking: 'checked_in' }], total: 3 });
    expect(reconcileAppointments([{ id: 'a', status: 'booked' }], [{ id: 'a', status: 'booked' }]).total).toBe(0);
  });
  it('health names each discrepancy by appointment id when POS Booking disagrees with the canonical rows, and writes no appointment', async () => {
    const D2 = '2026-11-23';
    const keep = await appt({ tenant: T2, branch: B2, tech: T2TECH, date: D2, s: '10:00', e: '10:45' });
    const dropped = await appt({ tenant: T2, branch: B2, tech: T2TECH, date: D2, s: '11:00', e: '11:45' });
    const flipped = await appt({ tenant: T2, branch: B2, tech: T2TECH, date: D2, s: '12:00', e: '12:45', status: 'confirmed' });
    const ghost = randomUUID();
    // a Booking read that lost one appointment, shows another with a different status and has one AI Calendar never stored
    const skewed = { ...stubBooking, async dayGrid(ctx: any, date?: string) {
      const g: any = await stubBooking.dayGrid(ctx, date);
      const items = g.appointments.filter((a: any) => a.appointmentId !== dropped).map((a: any) => (a.appointmentId === flipped ? { ...a, status: 'checked_in' } : a));
      return { ...g, appointments: [...items, { appointmentId: ghost, technicianId: T2TECH, startTime: '13:00', endTime: '13:45', status: 'booked' }] };
    } };
    const before = (await sql<any>`select count(*)::int c, max(updated_at) u from pos_tech_appointments where tenant_id = ${T2}`.execute(db)).rows[0];
    const h = await new AiCalendarCenter(db, skewed as any).health(OTHER, D2);
    const b = h.checks.find((c: any) => c.id === 'booking');
    expect(b.state).toBe('FAILED');
    expect(b.detail).toContain('1 only in AI Calendar, 1 only in POS Booking, 1 with a different status');
    expect(b.evidence).toContain(`only in AI Calendar: ${dropped}`);
    expect(b.evidence).toContain(`only in POS Booking: ${ghost}`);
    expect(b.evidence).toContain(`${flipped} (AI Calendar confirmed / Booking checked_in)`);
    expect(b.evidence).not.toContain(keep);
    expect((await sql<any>`select count(*)::int c, max(updated_at) u from pos_tech_appointments where tenant_id = ${T2}`.execute(db)).rows[0]).toEqual(before);
  });
});

describe('extras AI Calendar 10 — AI booking provenance & exception review (read only, redacted, stored ids)', () => {
  it('lists failed AI write calls, AI holds that lapsed without an appointment, "ai" appointments with no call link and AI-created appointments not labelled "ai"; nothing else, nothing written', async () => {
    const T3 = randomUUID(), B3 = randomUUID(), TT = randomUUID();
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'aical-c', 'aical-c', 'aical-c', 'AICALC', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B3}, ${T3}, 'Main', ${TZ})`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TT}, ${T3}, ${B3}, 'Eve', 'Ho', 'Eve Ho', true)`);
    const ctx3: AicCtx = { tenantId: T3, branchId: B3, userId: randomUUID(), role: 'OWNER', permissions: ['pos.booking.view'] };
    const tool = async (o: { name: string; kind?: string; status: string; type?: string | null; rel?: string | null; err?: string | null; ago?: string; tenant?: string; branch?: string }) => {
      const id = randomUUID();
      await q(sql`insert into voice_tool_executions (id, tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status, related_type, related_id, error_category, requested_at)
        values (${id}, ${o.tenant ?? T3}, ${o.branch ?? B3}, ${'call_secret_9876'}, ${randomUUID()}, ${o.name}, ${o.kind ?? 'write'}, ${o.status}, ${o.type ?? null}, ${o.rel ?? null}, ${o.err ?? null}, now() - ${o.ago ?? '1 hour'}::interval)`);
      return id;
    };
    const hold = async (o: { live?: boolean; released?: boolean; converted?: string | null; session?: string }) => {
      const id = randomUUID();
      await q(sql`insert into booking_holds (id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, released_at, release_reason, converted_appointment_id)
        values (${id}, ${T3}, ${B3}, ${TT}, ${local('2026-11-28', '10:00')}, ${local('2026-11-28', '11:00')}, ${o.live ? sql`now() + interval '5 minutes'` : sql`now() - interval '5 minutes'`},
          ${o.converted ? 'converted' : o.released ? 'released' : 'held'}, ${o.session ?? randomUUID()}, 'ai_receptionist', ${o.released ? sql`now() - interval '10 minutes'` : null}, ${o.released ? 'customer_hung_up' : null}, ${o.converted ?? null})`);
      return id;
    };
    // 1. a failed AI write call (counted) · a refused READ call (not a booking attempt) · a 40-day-old failure (outside the window) · another salon's failure
    const fail = await tool({ name: 'book_appointment', status: 'failed', err: 'slot_taken' });
    await tool({ name: 'check_availability', kind: 'read', status: 'refused' });
    await tool({ name: 'book_appointment', status: 'failed', ago: '40 days' });
    await tool({ name: 'book_appointment', status: 'failed', tenant: T2, branch: B2 });
    // 2. an AI hold that lapsed with its code expired (counted) · one still live · one that became an appointment (neither counted)
    const lapsed = await hold({ released: true });
    const vs = randomUUID();
    await q(sql`insert into booking_verification_sessions (id, tenant_id, branch_id, booking_session_id, booking_hold_id, phone_hash, phone_mask, channel, status, expires_at)
      values (${vs}, ${T3}, ${B3}, ${randomUUID()}, ${lapsed}, 'h4sh', '•••0142', 'online', 'expired', now() - interval '5 minutes')`);
    const lapsedTool = await tool({ name: 'hold_slot', status: 'succeeded', type: 'slot_hold', rel: lapsed });
    await tool({ name: 'hold_slot', status: 'succeeded', type: 'slot_hold', rel: await hold({ live: true }) });
    const ok = await appt({ tech: TT, date: '2026-11-28', s: '12:00', e: '13:00', source: 'ai', tenant: T3, branch: B3 });
    await tool({ name: 'hold_slot', status: 'succeeded', type: 'slot_hold', rel: await hold({ converted: ok }) });
    await tool({ name: 'book_appointment', status: 'succeeded', type: 'appointment', rel: ok });   // properly linked "ai" appointment
    // 3. an "ai" appointment with no succeeded call link · 4. an AI-created appointment whose source says "online"
    const unlinked = await appt({ tech: TT, date: '2026-11-28', s: '14:00', e: '15:00', source: 'ai', tenant: T3, branch: B3, name: 'Secret Customer', phone: '+16095550111' });
    const mis = await appt({ tech: TT, date: '2026-11-28', s: '16:00', e: '17:00', source: 'online', tenant: T3, branch: B3 });
    const misTool = await tool({ name: 'book_appointment', status: 'succeeded', type: 'appointment', rel: mis });
    const before = (await sql<any>`select (select count(*) from booking_holds where tenant_id = ${T3})::int h, (select count(*) from voice_tool_executions where tenant_id = ${T3})::int v, (select max(updated_at) from pos_tech_appointments where tenant_id = ${T3}) u`.execute(db)).rows[0];

    const r = await cal.provenanceReview(ctx3);
    expect(r.counts).toEqual({ toolFailed: 1, verificationIncomplete: 1, sourceUnlinked: 1, sourceMismatch: 1, total: 4 });
    expect(r).toMatchObject({ windowDays: 30, readOnly: true, timeZone: TZ });
    const by = Object.fromEntries(r.items.map((i) => [i.kind, i]));
    expect(by.tool_failed).toMatchObject({ refs: [{ table: 'voice_tool_executions', id: fail }], detail: { tool: 'book_appointment', result: 'slot_taken', call: '…9876' } });
    expect(by.verification_incomplete.refs).toEqual([{ table: 'booking_holds', id: lapsed }, { table: 'voice_tool_executions', id: lapsedTool }, { table: 'booking_verification_sessions', id: vs }]);
    expect(by.verification_incomplete.detail).toMatchObject({ holdStatus: 'released', releaseReason: 'customer_hung_up', verification: 'expired' });
    expect(by.source_unlinked).toMatchObject({ appointmentId: unlinked, detail: { source: 'ai', appointmentStatus: 'booked' } });
    expect(by.source_mismatch).toMatchObject({ appointmentId: mis, refs: [{ table: 'pos_tech_appointments', id: mis }, { table: 'voice_tool_executions', id: misTool }], detail: { source: 'online' } });
    const text = JSON.stringify(r);
    for (const secret of ['call_secret', 'Secret Customer', '0111', 'h4sh']) expect(text).not.toContain(secret);   // redacted
    expect(text).not.toContain(ok);   // the properly linked AI booking is not an exception
    expect((await cal.provenanceReview(OTHER)).items.every((i) => !i.refs.some((x) => x.id === fail || x.id === lapsed))).toBe(true);
    expect((await sql<any>`select (select count(*) from booking_holds where tenant_id = ${T3})::int h, (select count(*) from voice_tool_executions where tenant_id = ${T3})::int v, (select max(updated_at) from pos_tech_appointments where tenant_id = ${T3}) u`.execute(db)).rows[0]).toEqual(before);
  });
});
