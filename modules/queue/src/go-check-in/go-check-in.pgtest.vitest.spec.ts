// go-check-in.pgtest.vitest.spec.ts — 23-inch dual-screen spec Unit 7 on the REAL schema (every migration, PGlite):
//   • migration 512: a check-in session belongs to exactly one device — a kiosk or a paired display of ITS salon
//   • §22–§23: the branch's own catalog and prices; §25: the technician facts the screen's choice is built from
//   • §15–§17: the customer's appointments today at this branch — first names, every service
//   • §27: the queue engine's waiting count uses the BRANCH's day (after 8 pm in New Jersey it used to drop the morning)
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyGoCheckInRepository } from './go-check-in.kysely.repository';
import { GoCheckInService } from './go-check-in.service';
import { KyselyCheckInRepository } from '../check-in/check-in.kysely.repository';
import { CheckInService } from '../check-in/check-in.service';

const T = 'e7000000-0000-4000-8000-000000000001', T2 = 'e7000000-0000-4000-8000-000000000002';
const B1 = 'e7000000-0000-4000-8000-0000000000b1', B2 = 'e7000000-0000-4000-8000-0000000000b2', BX = 'e7000000-0000-4000-8000-0000000000b9';
const CAT_M1 = 'e7000000-0000-4000-8000-0000000000c1', CAT_M2 = 'e7000000-0000-4000-8000-0000000000c2', CAT_P2 = 'e7000000-0000-4000-8000-0000000000c3', CAT_A2 = 'e7000000-0000-4000-8000-0000000000c4';
const GEL1 = 'e7000000-0000-4000-8000-0000000000d1', GEL2 = 'e7000000-0000-4000-8000-0000000000d2', PEDI2 = 'e7000000-0000-4000-8000-0000000000d3', ART2 = 'e7000000-0000-4000-8000-0000000000d4', OLD2 = 'e7000000-0000-4000-8000-0000000000d5';
const OLIVIA = 'e7000000-0000-4000-8000-0000000000e1', LISA = 'e7000000-0000-4000-8000-0000000000e2', AVA = 'e7000000-0000-4000-8000-0000000000e3', GONE = 'e7000000-0000-4000-8000-0000000000e4', OTHER = 'e7000000-0000-4000-8000-0000000000e5';
const SOPHIA = 'e7000000-0000-4000-8000-0000000000f1';
const A_MANI = 'e7000000-0000-4000-8000-0000000000a1', A_PEDI = 'e7000000-0000-4000-8000-0000000000a2', A_DONE = 'e7000000-0000-4000-8000-0000000000a3', A_B1 = 'e7000000-0000-4000-8000-0000000000a4';
const D_OK = 'e7000000-0000-4000-8000-000000000101', D_REV = 'e7000000-0000-4000-8000-000000000102', D_MAINT = 'e7000000-0000-4000-8000-000000000103', D_T2 = 'e7000000-0000-4000-8000-000000000104';
const KIOSK = 'e7000000-0000-4000-8000-000000000201';
const TODAY = '2026-10-06', WEEKDAY = 2;   // a Tuesday

let pg: any; let db: any; let repo: KyselyGoCheckInRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  repo = new KyselyGoCheckInRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','e7a','E7A'), ($2,'Other LLC','Other','e7b','E7B')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Cherry Hill'), ($2,$3,'Voorhees'), ($4,$5,'Elsewhere')`, [B1, B2, T, BX, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values ($1,$5,$6,'Manicure',1), ($2,$5,$7,'Manicure',1), ($3,$5,$7,'Pedicure',2), ($4,$5,$7,'Add-ons',3)`, [CAT_M1, CAT_M2, CAT_P2, CAT_A2, T, B1, B2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, sort_order) values
    ($1,$5,$6,$8,'Gel Manicure',45,4500,1), ($2,$5,$7,$9,'Gel Manicure',45,5000,1), ($3,$5,$7,$10,'Spa Pedicure',50,6000,1), ($4,$5,$7,$11,'Nail Art',15,1000,1)`,
    [GEL1, GEL2, PEDI2, ART2, T, B1, B2, CAT_M1, CAT_M2, CAT_P2, CAT_A2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Retired Polish',20,1500,'inactive')`, [OLD2, T, B2, CAT_M2]);
  for (const [id, fn, ln, br, tn] of [[OLIVIA, 'Olivia', 'Tran', B2, T], [LISA, 'Lisa', 'Park', B2, T], [AVA, 'Ava', 'Ng', B2, T], [GONE, 'Gone', 'Away', B2, T], [OTHER, 'Mia', 'Chen', B1, T]]) {
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,$5,$4 || ' ' || $5,'active')`, [id, tn, br, fn, ln]);
  }
  await q(`update technicians set archived_at = now(), status = 'archived' where id = $1`, [GONE]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$5), ($1,$2,$4,$5), ($1,$2,$4,$6)`, [T, B2, OLIVIA, LISA, GEL2, PEDI2]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working, shifts) values
    ($1,$2,$3,$6,'09:00','18:00',true,null), ($1,$2,$4,$6,'09:00','18:00',true,'[{"startTime":"12:00","endTime":"16:00"},{"startTime":"17:00","endTime":"20:00"}]'), ($1,$2,$5,$6,'09:00','18:00',false,null)`,
    [T, B2, OLIVIA, LISA, AVA, WEEKDAY]);
  await q(`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) values ($1,$2,$3,$4,'13:00','14:00','lunch')`, [T, B2, OLIVIA, TODAY]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-10-05', now(), null, 'active')`, [T, B2, AVA]);
  await q(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values ($1,$2,$3,'available', now() - interval '2 hours'), ($1,$2,$3,'on_break', now())`, [T, B2, OLIVIA]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Lane','Sophia Lane')`, [SOPHIA, T, B2]);
  const appt = (id: string, br: string, tech: string, start: string, end: string, status: string, services: any[]) => q(
    `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
     values ($1,$2,$3,$4,$5,'Sophia Lane','phone',$6,$7,$8,$9,45,$10,'not_required')`, [id, T, br, tech, SOPHIA, JSON.stringify(services), TODAY, start, end, status]);
  await appt(A_MANI, B2, OLIVIA, '11:00', '11:45', 'confirmed', [{ serviceId: GEL2, serviceName: 'Gel Manicure', durationMinutes: 45 }]);
  await appt(A_PEDI, B2, LISA, '11:00', '11:50', 'booked', [{ serviceId: PEDI2, serviceName: 'Spa Pedicure', durationMinutes: 50 }, { serviceName: 'Paraffin Dip' }]);
  await appt(A_DONE, B2, OLIVIA, '09:00', '09:45', 'completed', [{ serviceName: 'Polish Change' }]);
  await appt(A_B1, B1, OTHER, '11:00', '12:00', 'booked', [{ serviceName: 'Gel Manicure' }]);
  await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status, revoked_at, maintenance_at) values
    ($1,$5,$6,'Front','paired',null,null), ($2,$5,$6,'Revoked','unpaired',now(),null), ($3,$5,$6,'Serviced','paired',null,now()), ($4,$7,$8,'Theirs','paired',null,null)`,
    [D_OK, D_REV, D_MAINT, D_T2, T, B2, T2, BX]);
  await q(`insert into go_checkin_devices (id, tenant_id, branch_id, device_name, checkin_slug) values ($1,$2,$3,'Door kiosk','e7door')`, [KIOSK, T, B2]);
});

describe('migration 512: one device per check-in session', () => {
  it('a display session (no kiosk) and a kiosk session are both fine; neither, or both, is refused', async () => {
    expect(await repo.createSession({ tenantId: T, branchId: B2, displayDeviceId: D_OK, sessionTokenHash: 'h1' })).toMatchObject({ deviceId: null, displayDeviceId: D_OK, branchId: B2 });
    expect(await repo.createSession({ tenantId: T, branchId: B2, deviceId: KIOSK, sessionTokenHash: 'h2' })).toMatchObject({ deviceId: KIOSK, displayDeviceId: null });
    await expect(q(`insert into go_checkin_sessions (tenant_id, branch_id, session_token_hash) values ($1,$2,'h3')`, [T, B2])).rejects.toThrow(/ck_gcs_one_device/);
    await expect(q(`insert into go_checkin_sessions (tenant_id, branch_id, device_id, display_device_id, session_token_hash) values ($1,$2,$3,$4,'h4')`, [T, B2, KIOSK, D_OK])).rejects.toThrow(/ck_gcs_one_device/);
  });
  it('a display session can only be one of ITS salon\'s displays (composite foreign key)', async () => {
    await expect(q(`insert into go_checkin_sessions (tenant_id, branch_id, display_device_id, session_token_hash) values ($1,$2,$3,'h5')`, [T, B2, D_T2])).rejects.toThrow(/fk_gcs_display_device/);
  });
  it('the display\'s standing, from its own row: paired and in service only; another salon\'s display is not found', async () => {
    expect(await repo.displayDeviceById(T, D_OK)).toEqual({ id: D_OK, tenantId: T, branchId: B2, usable: true });
    expect(await repo.displayDeviceById(T, D_REV)).toMatchObject({ usable: false });
    expect(await repo.displayDeviceById(T, D_MAINT)).toMatchObject({ usable: false });
    expect(await repo.displayDeviceById(T, D_T2)).toBeNull();
  });
});

describe('§22–§23 the branch\'s catalog', () => {
  it('only the branch\'s own active rows, with ITS prices and categories; add-ons flagged; no branch → nothing', async () => {
    expect(await repo.listServices(T, B2)).toEqual([
      { id: GEL2, name: 'Gel Manicure', priceCents: 5000, durationMinutes: 45, category: 'Manicure', isAddOn: false },
      { id: PEDI2, name: 'Spa Pedicure', priceCents: 6000, durationMinutes: 50, category: 'Pedicure', isAddOn: false },
      { id: ART2, name: 'Nail Art', priceCents: 1000, durationMinutes: 15, category: 'Add-ons', isAddOn: true },
    ]);
    expect((await repo.listServices(T, B1)).map((s) => [s.name, s.priceCents])).toEqual([['Gel Manicure', 4500]]);
    expect(await repo.listServices(T, null)).toEqual([]);
    expect(await repo.listServices(T2, B2)).toEqual([]);
  });
});

describe('§25 the technician facts', () => {
  it('roster (active, not archived, this branch), category skills, today\'s shift (incl. split shifts), blocks, punches, latest status', async () => {
    const facts = await repo.kioskTechnicianFacts(T, B2, TODAY, WEEKDAY);
    const by = Object.fromEntries(facts.map((f) => [f.firstName, f]));
    expect(Object.keys(by).sort()).toEqual(['Ava', 'Lisa', 'Olivia']);
    expect(by.Olivia).toMatchObject({ skills: ['Manicure'], shift: { startMinutes: 540, endMinutes: 1080 }, blocks: [{ startMinutes: 780, endMinutes: 840 }], clockedIn: false, liveStatus: 'on_break' });
    expect(by.Lisa.skills.sort()).toEqual(['Manicure', 'Pedicure']);
    expect(by.Lisa.shift).toEqual({ startMinutes: 720, endMinutes: 1200 });   // 12:00–16:00 and 17:00–20:00
    expect(by.Ava).toMatchObject({ shift: null, clockedIn: true });            // off that weekday — but a punch from yesterday is still open
    expect(await repo.kioskTechnicianFacts(T2, B2, TODAY, WEEKDAY)).toEqual([]);
  });
});

describe('§15–§17 the customer\'s appointments today', () => {
  it('each with its technician\'s FIRST name and every service; only this branch, today, the asked statuses', async () => {
    const rows = await repo.findTodayAppointmentsForCustomer(T, B2, SOPHIA, TODAY);
    expect(rows.map((r) => ({ id: r.appointmentId, start: r.startMinutes, items: r.items }))).toEqual([
      { id: A_MANI, start: 660, items: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia' }] },
      { id: A_PEDI, start: 660, items: [{ serviceName: 'Spa Pedicure', technicianName: 'Lisa' }, { serviceName: 'Paraffin Dip', technicianName: 'Lisa' }] },
    ].sort((a, b) => (a.id < b.id ? -1 : 1)).sort((a, b) => a.start - b.start));
    expect(JSON.stringify(rows)).not.toMatch(/Tran|Park/);
    expect((await repo.findTodayAppointmentsForCustomer(T, B2, SOPHIA, TODAY, ['completed'])).map((r) => r.appointmentId)).toEqual([A_DONE]);
    expect(await repo.findTodayAppointmentsForCustomer(T, B2, SOPHIA, '2026-10-07')).toEqual([]);
    expect(await repo.findTodayAppointmentsForCustomer(T2, B2, SOPHIA, TODAY)).toEqual([]);
  });
  it('whose appointment: this tenant and branch, today — another branch\'s, another day\'s or a malformed id is nobody\'s', async () => {
    expect(await repo.appointmentCustomer(T, B2, A_PEDI, TODAY)).toBe(SOPHIA);
    expect(await repo.appointmentCustomer(T, B2, A_B1, TODAY)).toBeNull();
    expect(await repo.appointmentCustomer(T, B2, A_PEDI, '2026-10-05')).toBeNull();
    expect(await repo.appointmentCustomer(T2, B2, A_PEDI, TODAY)).toBeNull();
    expect(await repo.appointmentCustomer(T, B2, "x' or 1=1 --", TODAY)).toBeNull();
  });
});

describe('the display\'s check-in end to end on the real tables (service + repository)', () => {
  it('a display of the salon starts a session for its branch; the visit, the catalog and the technicians come back', async () => {
    const svc = new GoCheckInService(repo as any, undefined);
    svc.now = () => new Date('2026-10-06T14:52:00Z');   // 10:52 at the branch
    await repo.upsertSettings(T, { enabled: true });
    const s = await svc.startDisplaySession({ id: D_OK, tenantId: T, branchId: B2 });
    const row = (await q(`select device_id, display_device_id, branch_id from go_checkin_sessions where id = $1`, [s.sessionId]))[0];
    expect(row).toEqual({ device_id: null, display_device_id: D_OK, branch_id: B2 });
    expect((await svc.todayAppointments(s.sessionId, s.sessionToken, SOPHIA)).appointments[0]).toMatchObject({ startTimeLabel: '11:00 AM', items: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia' }, { serviceName: 'Spa Pedicure', technicianName: 'Lisa' }, { serviceName: 'Paraffin Dip', technicianName: 'Lisa' }] });
    expect((await svc.technicians(s.sessionId, s.sessionToken)).technicians.map((t) => t.name)).toEqual(['Ava', 'Lisa', 'Olivia']);   // nothing chosen: everyone working — Ava off this weekday but clocked in, Lisa from noon
    expect((await svc.technicians(s.sessionId, s.sessionToken, [GEL2])).technicians.map((t) => t.name)).toEqual(['Lisa', 'Olivia']);  // Ava does no manicures
    expect((await svc.technicians(s.sessionId, s.sessionToken, [GEL2, PEDI2])).technicians).toEqual([{ technicianId: LISA, name: 'Lisa', fromLabel: 'From 12:00 PM' }]);
    await q(`update customer_display_devices set revoked_at = now(), pairing_status = 'unpaired' where id = $1`, [D_OK]);
    await expect(svc.services(s.sessionId, s.sessionToken)).rejects.toMatchObject({ code: 'display_unavailable' });
  });
});

describe('§20 the queue keeps a check-in\'s add-on — and a price change — as they were chosen', () => {
  it('written by createRecord and update, read back by the check-in screen (they used to be dropped on the way in)', async () => {
    const ci = new KyselyCheckInRepository(db);
    const ctx = { tenantId: T, branchId: B2, userId: 'display:x', role: 'KIOSK', permissions: [] } as any;
    const lines = [
      { serviceId: GEL2, serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 5000 },
      { serviceId: ART2, serviceName: 'Nail Art', durationMinutes: 15, priceCents: 1000, isAddon: true, parentServiceId: GEL2 },
      { serviceId: PEDI2, serviceName: 'Spa Pedicure', durationMinutes: 50, priceCents: 5500, priceOverrideCents: 5500, overrideReason: 'Short visit' },
    ];
    const row: any = await ci.createRecord(ctx, { checkInId: '', customerName: 'Ethan Walkin', isVip: false, appointmentId: null, source: 'walk_in', services: lines, technicianId: null, technicianName: null, checkedInAtMs: Date.now(), status: 'checked_in', notes: '', updatedAt: new Date().toISOString() } as any);
    const stored = async () => (await q(`select requested_services from pos_queue_items where id = $1`, [row.checkInId]))[0].requested_services;
    expect(await stored()).toEqual([
      { serviceId: GEL2, serviceName: 'Gel Manicure', estimatedDurationMinutes: 45, priceCents: 5000 },
      { serviceId: ART2, serviceName: 'Nail Art', estimatedDurationMinutes: 15, priceCents: 1000, isAddon: true, parentServiceId: GEL2 },
      { serviceId: PEDI2, serviceName: 'Spa Pedicure', estimatedDurationMinutes: 50, priceCents: 5500, priceOverrideCents: 5500, overrideReason: 'Short visit' },
    ]);
    const back: any = await ci.detailRow(ctx, row.checkInId);
    expect(back.services.find((x: any) => x.serviceId === ART2)).toMatchObject({ isAddon: true, parentServiceId: GEL2 });
    expect(back.services.find((x: any) => x.serviceId === PEDI2)).toMatchObject({ priceOverrideCents: 5500, overrideReason: 'Short visit' });
    await ci.update(ctx, row.checkInId, { services: [lines[0], lines[1]] } as any);
    expect((await stored())[1]).toEqual({ serviceId: ART2, serviceName: 'Nail Art', estimatedDurationMinutes: 15, priceCents: 1000, isAddon: true, parentServiceId: GEL2 });
  });
});

describe('Kevin\'s decision (Oct 6 2026): the technician a guest chooses is the ASSIGNED technician', () => {
  it('the queue entry carries the chosen technician as assigned — not as a request for the front desk to confirm', async () => {
    const ci = new KyselyCheckInRepository(db);
    const ctx = { tenantId: T, branchId: B2, userId: 'display:x', role: 'KIOSK', permissions: [] } as any;
    const row: any = await ci.createRecord(ctx, { checkInId: '', customerName: 'Chose Lisa', isVip: false, appointmentId: null, source: 'walk_in', services: [{ serviceId: GEL2, serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 5000 }], technicianId: LISA, technicianName: 'Lisa', checkedInAtMs: Date.now(), status: 'waiting' } as any);
    const [r] = await q(`select assigned_technician_id, requested_technician_id from pos_queue_items where id = $1`, [row.checkInId]);
    expect(r).toEqual({ assigned_technician_id: LISA, requested_technician_id: null });
  });
});

describe('§27 the queue engine counts the BRANCH\'s day', () => {
  it('at 9:30 pm in New Jersey (01:30 UTC the next day) the guests who checked in at 7 pm are still waiting — and counted', async () => {
    const ci = new KyselyCheckInRepository(db);
    ci.now = () => Date.parse('2026-10-06T01:30:00Z');   // Oct 5, 9:30 pm EDT
    await q(`insert into pos_queue_items (tenant_id, branch_id, customer_name, source, requested_services, priority, status, checked_in_at) values
      ($1,$2,'Early One','walk_in','[]','normal','waiting','2026-10-05T23:00:00Z'), ($1,$2,'Early Two','walk_in','[]','normal','waiting','2026-10-05T23:10:00Z'),
      ($1,$2,'Yesterday','walk_in','[]','normal','waiting','2026-10-05T03:00:00Z')`, [T, B1]);
    const ctx = { tenantId: T, branchId: B1, userId: 'u', role: 'OWNER', permissions: [] } as any;
    const state = await ci.query(ctx, {});
    expect(state.kpis.checkedInToday).toBe(2);   // 7 pm and 7:10 pm today — not last night's
    expect(state.kpis.waitingNow).toBe(2);
    const est: any = await ci.waitEstimate(ctx, []);
    expect(est).toMatchObject({ configured: true });
    expect(est.quotedWaitMinutes).toBeGreaterThan(0);   // with the UTC day it counted nobody waiting: 0
  });
});

// Oct 6 2026 (migration 516): a session's 8 lookups / 3 new profiles are counted on its row, so every API instance — and
// an instance that restarted — counts the same allowance. They lived in each instance's memory: two instances doubled it.
describe('the check-in allowances are the session\'s, whichever API instance serves it', () => {
  it('two instances share one session\'s 8 lookups: the ninth is refused on either — and after a restart', async () => {
    const D_ALLOW = 'e7000000-0000-4000-8000-000000000105';
    await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status) values ($1,$2,$3,'Allowance','paired')`, [D_ALLOW, T, B2]);
    await repo.upsertSettings(T, { enabled: true });
    const a = new GoCheckInService(repo as any, undefined), b = new GoCheckInService(repo as any, undefined);
    const s = await a.startDisplaySession({ id: D_ALLOW, tenantId: T, branchId: B2 });
    for (let i = 0; i < 8; i++) await (i % 2 ? b : a).lookupPhone(s.sessionId, s.sessionToken, '856555' + String(1000 + i));
    await expect(b.lookupPhone(s.sessionId, s.sessionToken, '8565559999')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(a.lookupPhone(s.sessionId, s.sessionToken, '8565559998')).rejects.toMatchObject({ code: 'rate_limited' });
    const restarted = new GoCheckInService(repo as any, undefined);
    await expect(restarted.lookupPhone(s.sessionId, s.sessionToken, '8565559997')).rejects.toMatchObject({ code: 'rate_limited' });
    expect((await q(`select lookup_count, create_count from go_checkin_sessions where id = $1`, [s.sessionId]))[0]).toEqual({ lookup_count: 11, create_count: 0 });
    // a new guest's session starts with its own allowance
    const next = await b.startDisplaySession({ id: D_ALLOW, tenantId: T, branchId: B2 });
    await expect(a.lookupPhone(next.sessionId, next.sessionToken, '8565551000')).resolves.toBeDefined();
  });

  it('the count is atomic (ten at once → 1…10) and per kind; a session that does not exist, or is another salon\'s, counts as spent', async () => {
    const row = await repo.createSession({ tenantId: T, branchId: B2, deviceId: KIOSK, sessionTokenHash: 'allow-h' });
    const got = await Promise.all(Array.from({ length: 10 }, () => repo.bumpSessionCounter(T, row.id, 'creates')));
    expect([...got].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await repo.bumpSessionCounter(T, row.id, 'lookups')).toBe(1);
    expect(await repo.bumpSessionCounter(T2, row.id, 'lookups')).toBeGreaterThan(1_000_000);   // another salon cannot touch it
    expect(await repo.bumpSessionCounter(T, row.id, 'lookups')).toBe(2);
    expect(await repo.bumpSessionCounter(T, 'e7000000-0000-4000-8000-00000000dead', 'lookups')).toBeGreaterThan(1_000_000);
  });
});

// Oct 6 2026: a visit of several appointments is checked in ALL OR NOTHING — one transaction. It was one appointment at a
// time, so a failure between two left the visit half checked in until the guest tapped again.
describe('a visit is checked in all or nothing', () => {
  const ctx = { tenantId: T, branchId: B2, userId: 'display:x', role: 'KIOSK', permissions: ['pos.check_in.appointment'] } as any;
  let n = 0;
  async function visit(): Promise<[string, string, string]> {
    n++;
    const cust = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'Vi','Sit' || $3,'Vi Sit' || $3) returning id`, [T, B2, String(n)]))[0].id;
    const ids: string[] = [];
    const h = String(14 + n).padStart(2, '0');   // each visit at its own hour (a technician's appointments may not overlap)
    for (const [tech, start, end, svc, name] of [[OLIVIA, `${h}:00`, `${h}:45`, GEL2, 'Gel Manicure'], [LISA, `${h}:00`, `${h}:50`, PEDI2, 'Spa Pedicure']] as const) {
      ids.push((await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
        values ($1,$2,$3,$4,'Vi Sit','phone',$5,$6,$7,$8,45,'confirmed','not_required') returning id`, [T, B2, tech, cust, JSON.stringify([{ serviceId: svc, serviceName: name, durationMinutes: 45 }]), TODAY, start, end]))[0].id);
    }
    return [cust, ids[0], ids[1]];
  }
  const state = async (ids: string[]) => ({
    queued: Number((await q(`select count(*)::int as n from pos_queue_items where tenant_id = $1 and appointment_id = any($2::uuid[]) and status not in ('cancelled','removed','completed','done')`, [T, ids]))[0].n),
    statuses: (await q(`select status from pos_tech_appointments where id = any($1::uuid[]) order by start_time, id`, [ids])).map((r: any) => r.status).sort(),
  });

  it('both appointments in one go: two queue entries, both appointments "checked in", each change logged — and a second tap changes nothing', async () => {
    const svc = new CheckInService(new KyselyCheckInRepository(db));
    const [, a1, a2] = await visit();
    const out = await svc.visitCheckIn(ctx, [a1, a2]);
    expect(out.map((o) => [o.appointmentId, o.duplicate])).toEqual([[a1, false], [a2, false]]);
    expect(await state([a1, a2])).toEqual({ queued: 2, statuses: ['checked_in', 'checked_in'] });
    expect(Number((await q(`select count(*)::int as n from appointment_change_log where appointment_id = any($1::uuid[]) and field = 'status'`, [[a1, a2]]))[0].n)).toBe(2);
    const again = await svc.visitCheckIn(ctx, [a1, a2]);
    expect(again.map((o) => o.duplicate)).toEqual([true, true]);
    expect(again.map((o) => o.row.checkInId)).toEqual(out.map((o) => o.row.checkInId));
    expect((await state([a1, a2])).queued).toBe(2);
  });

  it('another branch\'s appointment in the list: refused before anything is written; without the right, nothing at all', async () => {
    const svc = new CheckInService(new KyselyCheckInRepository(db));
    const [, a1, a2] = await visit();
    await expect(svc.visitCheckIn(ctx, [a1, A_B1])).rejects.toThrow(/not found/);
    await expect(svc.visitCheckIn({ ...ctx, permissions: [] }, [a1, a2])).rejects.toThrow();
    expect(await state([a1, a2])).toEqual({ queued: 0, statuses: ['confirmed', 'confirmed'] });
  });

  it('a failure on the second appointment leaves NOTHING behind — not the first one either', async () => {
    const repo = new KyselyCheckInRepository(db);
    const real = (repo as any).insertQueueItem.bind(repo); let calls = 0;
    (repo as any).insertQueueItem = async (...args: any[]) => { if (++calls === 2) throw new Error('the server went away'); return real(...args); };
    const svc = new CheckInService(repo);
    const [, a1, a2] = await visit();
    await expect(svc.visitCheckIn(ctx, [a1, a2])).rejects.toThrow(/went away/);
    expect(await state([a1, a2])).toEqual({ queued: 0, statuses: ['confirmed', 'confirmed'] });
    // the guest taps again: the whole visit goes in
    (repo as any).insertQueueItem = real;
    await svc.visitCheckIn(ctx, [a1, a2]);
    expect(await state([a1, a2])).toEqual({ queued: 2, statuses: ['checked_in', 'checked_in'] });
  });

  it('another device checks one of them in at the same moment: this visit rolls back, re-reads, and records only the rest', async () => {
    const repo = new KyselyCheckInRepository(db);
    const svc = new CheckInService(repo);
    const [, a1, a2] = await visit();
    // the other device's entry for a2 lands after this tap looked (the race): this tap's read misses it once
    const realActive = repo.activeCheckIn.bind(repo); let missed = false;
    (repo as any).activeCheckIn = async (c: any, by: any) => { if (by.appointmentId === a2 && !missed) { missed = true; await new KyselyCheckInRepository(db).createVisitRecords(c, [{ checkInId: '', customerName: 'Vi Sit', isVip: false, appointmentId: a2, source: 'appointment', services: [], technicianId: LISA, technicianName: 'Lisa', checkedInAtMs: Date.now(), status: 'checked_in' } as any]); return null; } return realActive(c, by); };
    const out = await svc.visitCheckIn(ctx, [a1, a2]);
    expect(out.map((o) => [o.appointmentId, o.duplicate])).toEqual([[a1, false], [a2, true]]);
    expect(await state([a1, a2])).toEqual({ queued: 2, statuses: ['checked_in', 'checked_in'] });   // one entry each — never two for a2
  });
});
