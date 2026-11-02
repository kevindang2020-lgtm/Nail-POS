// technicians-screen.pgtest — the Technicians Management Center read model (Oct 30 2026) against the REAL schema, seeded
// with the photographed team: Vishal verma (active, on shift and available, one 5★ review), Kevin Dang and CD T6805 (active,
// off today). "3 Active Today vs 2 Off Today" were account-active vs working; the screen now says which is which.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechniciansScreenRepository } from './technicians-screen.repository';

const P = 'te7a0000-0000-4000-8000-0000000'.replace('te7a', 'fe7a');
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const VISHAL = id('c1'), KEVIN = id('c2'), CD = id('c3'), OTHER = id('c9'), GEL = id('d1'), PEDI = id('d2'), CAT = id('d9');
const owner = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['technicians.view', 'technicians.edit', 'technicians.view_pay', 'customers.view'] };
const desk = { ...owner, role: 'FRONT_DESK', permissions: ['technicians.view', 'customers.view'] };
let pg: any; let repo: TechniciansScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tec-a','TEA001','active'), ($2,'Other LLC','Other','tec-b','TEB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'owner@tec.test','Pat Owner','OWNER','active')`, [U, T]);
  const tech = (tid: string, f: string, l: string, ph: string, days: number, tenant = T, br = B) => q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status, is_active, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',true, now() - make_interval(days => $10))`, [tid, tenant, br, f, l, `${f} ${l}`, '+1' + ph, `(${ph.slice(0, 3)}) ${ph.slice(3, 6)}-${ph.slice(6)}`, `${f.toLowerCase()}@tec.test`, days]);
  await tech(VISHAL, 'Vishal', 'verma', '8565551234', 30); await tech(KEVIN, 'Kevin', 'Dang', '8565552222', 20); await tech(CD, 'CD', 'T6805', '8565553333', 10);
  await tech(OTHER, 'Vishal', 'Elsewhere', '8565551234', 5, T2, BX);
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state) values
    ($1,$2,$3,'ACTIVE','CLOCKED_IN','ON_SHIFT','AVAILABLE','IDLE'), ($1,$2,$4,'ACTIVE','CLOCKED_OUT','OFF_SHIFT','OFF_SHIFT','IDLE'), ($1,$2,$5,'ACTIVE','CLOCKED_OUT','OFF_SHIFT','OFF_SHIFT','IDLE')`, [T, B, VISHAL, KEVIN, CD]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$3,$4,$5,'Gel Manicure',45,5500,'active'), ($2,$3,$4,$5,'Classic Pedicure',50,4800,'active')`, [GEL, PEDI, T, B, CAT]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true), ($1,$2,$3,$5,false)`, [T, B, VISHAL, GEL, PEDI]);
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment) values ($1,$2,$3,5,'Lovely')`, [T, B, VISHAL]);
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment, is_spam) values ($1,$2,$3,1,'spam',true)`, [T, B, KEVIN]);
  // two paid lines today for Vishal (one 40 % commission snapshot), one open ticket that must not count
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Mai','Le','Mai Le')`, [id('aa1'), T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, paid_at, subtotal_cents, total_cents) values ($1,$3,$4,$5,101,'paid', now(), 0, 0), ($2,$3,$4,$5,102,'in_service', null, 0, 0)`, [id('f1'), id('f2'), T, B, id('aa1')]);
  const line = (tk: string, sid: string, name: string, cents: number, ctype: string | null, cval: number | null) => q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot, line_kind, quantity, status)
    values ($1,$2,$3,$4,$5,$6,$7,45,$7,$8,$9,'service',1,'done')`, [T, B, tk, sid, VISHAL, name, cents, ctype, cval]);
  await line(id('f1'), GEL, 'Gel Manicure', 5500, 'percent', 40); await line(id('f1'), PEDI, 'Classic Pedicure', 4800, null, null); await line(id('f2'), GEL, 'Gel Manicure', 5500, 'percent', 40);
  await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,1200)`, [T, B, id('f1'), VISHAL]);
  await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status, reason) values ($1,$2,$3, now() + interval '3 days', now() + interval '4 days', 'pending', 'family')`, [T, B, KEVIN]);
  await q(`insert into technician_certifications (tenant_id, technician_id, name, issuer, issued_at, expires_at, verification_status) values ($1,$2,'Gel Certification','OPI', current_date - 300, current_date + 20, 'VERIFIED')`, [T, VISHAL]);
  await q(`insert into technician_status_events (tenant_id, branch_id, technician_id, old_status, new_status, reason, changed_by_user_id) values ($1,$2,$3,'inactive','active','returned',$4)`, [T, B, KEVIN, U]);
  repo = new TechniciansScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Technicians — the eight KPIs say what they count', () => {
  it('active accounts ≠ on shift; rating shows its sample; commission is the line snapshot; approvals are real; open positions not configured', async () => {
    const d = await repo.dashboard(owner, { preset: 'today' });
    expect(d.kpis).toMatchObject({ totalTeam: 3, activeAccounts: 3, onShiftNow: 1, availableNow: 1, offToday: 2, avgRating: 5, ratingCount: 1, servicesCompleted: 2,
      commissionEstCents: 2200, commissionLinesWithoutSnapshot: 1, pendingApprovals: 1, openPositions: null, missingServiceMapping: 2 });
    expect(d.productivityToday).toMatchObject({ servicesCompleted: 2, revenueCents: 10300, commissionEstCents: 2200, tipsCents: 1200 });
    expect(d.bands).toEqual({ excellent: 1, veryGood: 0, good: 0, needs: 0, unrated: 2 });   // the spam 1★ never counts
    expect(d.topPerformers.map((t) => [t.name, t.rating, t.ratingCount, t.servicesCompleted])).toEqual([['Vishal verma', 5, 1, 2]]);
    expect(d.certifications).toMatchObject({ valid: 1, expiringSoon: 1, expired: 0 });
    expect(d.insights.map((i) => i.kind)).toEqual(expect.arrayContaining(['unmapped', 'cert_expiring', 'approvals', 'unrated']));
    expect(d.birthdays).toEqual({ recorded: false });
  });
  it('pay figures are hidden without the pay permission', async () => {
    const d = await repo.dashboard(desk, { preset: 'today' });
    expect(d.kpis.commissionEstCents).toBeNull(); expect(d.productivityToday.revenueCents).toBeNull();
  });
});

describe('Technician Directory', () => {
  it('newest first; phone in any format; service name; id prefix; never another salon', async () => {
    const all = await repo.directory(owner, {});
    expect(all.items.map((x) => x.name)).toEqual(['CD T6805', 'Kevin Dang', 'Vishal verma']);
    expect(all.roles).toMatchObject({ all: 3 });
    for (const ph of ['8565551234', '(856) 555-1234', '856-555-1234', '+1 856 555 1234']) {
      const r = await repo.directory(owner, { q: ph });
      expect(r.items.map((x) => x.name)).toEqual(['Vishal verma']); expect(r.items[0]!.matchedVia).toBe('phone');
    }
    const gel = await repo.directory(owner, { q: 'gel' });
    expect(gel.items.map((x) => [x.name, x.matchedVia, x.matchedServices])).toEqual([['Vishal verma', 'service', ['Gel Manicure']]]);
    expect((await repo.directory(owner, { q: KEVIN })).items.map((x) => [x.name, x.matchedVia])).toEqual([['Kevin Dang', 'id']]);
  });
  it('shift / mapping / band filters; contact masked for the front desk; status labels say working vs account', async () => {
    expect((await repo.directory(owner, { shift: 'available' })).items.map((x) => x.name)).toEqual(['Vishal verma']);
    expect((await repo.directory(owner, { shift: 'off' })).totalItems).toBe(2);
    expect((await repo.directory(owner, { missingMapping: '1' })).items.map((x) => x.name)).toEqual(['CD T6805', 'Kevin Dang']);
    expect((await repo.directory(owner, { band: 'unrated' })).totalItems).toBe(2);
    const v = (await repo.directory(owner, { q: 'vishal' })).items[0]!;
    expect(v).toMatchObject({ status: 'active', working: 'available', qualifiedServices: 2, rating: 5, ratingCount: 1, servicesToday: 2, phone: '(856) 555-1234', contactMasked: false });
    const m = (await repo.directory(desk, { q: 'vishal' })).items[0]!;
    expect(m.phone).toBe('••• 1234'); expect(m.email).toBeNull();
    expect((await repo.directory(owner, { page: 9, pageSize: 2 })).page).toBe(2);
  });
});

describe('Profile overlay tabs · history · certifications · mapping assistant', () => {
  it('service history is paid lines only; history merges status events; certifications sort by expiry', async () => {
    const h = await repo.serviceHistory(owner, VISHAL, { preset: 'today' });
    expect(h.items.map((x) => x.service).sort()).toEqual(['Classic Pedicure', 'Gel Manicure']);
    const ev = await repo.history(owner, { technicianId: KEVIN });
    expect(ev.items[0]).toMatchObject({ technician: 'Kevin Dang', kind: 'status:inactive→active', actor: 'Pat Owner' });
    const c = await repo.certifications(owner, { state: 'expiring' });
    expect(c.items.map((x) => [x.technician, x.name, x.verified])).toEqual([['Vishal verma', 'Gel Certification', true]]);
    await expect(repo.serviceHistory(owner, OTHER, {})).rejects.toMatchObject({ status: 404 });
  });
  it('the mapping review lists the whole catalog, never pre-ticked for an unmapped technician', async () => {
    const r = await repo.mappingReview(owner, KEVIN);
    expect(r.services.map((s) => [s.name, s.mapped])).toEqual([['Classic Pedicure', false], ['Gel Manicure', false]]);
    const v = await repo.mappingReview(owner, VISHAL);
    expect(v.services.every((s) => s.mapped)).toBe(true);
    expect(v.services.find((s) => s.name === 'Gel Manicure')!.performedBefore).toBe(2);
  });
});
