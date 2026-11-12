// customer-intelligence-center.pgtest — Customer Intelligence guide (Nov 1 2026; migration 763) on the REAL schema.
// CI = counts & reconciliation · LS = list/search/dates/pages · SC = security · HL = health. Every row is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerIntelligenceCenter, CustomerIntelligenceError, CI_STATES } from './customer-intelligence-center';
import { aggregateTenant, DEFAULT_TUNABLES, type TenantScanItem } from './ai-customer-profile-core';
import { RetentionRepository } from '@aipowersalon/customers';

const P = 'c7630000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20);
const C = { never: id(101), once: id(102), regular: id(103), lapsed: id(104), gone: id(105), booked: id(106), archived: id(107), atB2: id(108), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view'], ...o }) as any;
const confinedB2 = () => ctx({ branchId: B2, authz: { scope: 'BRANCH', branchIds: [B2] } });
let db: any; let enabled = true; let clock = Date.now();
const settings = async () => ({ enabled, tunables: DEFAULT_TUNABLES });
let ci: CustomerIntelligenceCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerIntelligenceError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = (cust: string, daysAgo: number, o: { branch?: string; service?: string } = {}) => q(sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
  values (${T}, ${o.branch ?? B}, ${cust}, ${LAN}, 'paid', 4500, ${++tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval) returning id`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); ci = new CustomerIntelligenceCenter(db, settings, () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'ci-763', 'CI763', 'active'), (${X}, 'X', 'Other', 'ci-763x', 'CI763X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@ci.test', 'active', 'OWNER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn')`);
  const people: [string, string, string, string, string | null][] = [
    [C.never, T, B, 'Never Served', '+16095550101'], [C.once, T, B, 'Once Only', '+16095550102'], [C.regular, T, B, 'Regular Rhee', '+16095550103'],
    [C.lapsed, T, B, 'Lapsed Lee', '+16095550104'], [C.gone, T, B, 'Gone Gomez', null], [C.booked, T, B, 'Booked Bui', null], [C.archived, T, B, 'Archived Ash', null],
    [C.atB2, T, B2, 'Second Branch', null], [C.other, X, BX, 'Other Salon', '+16095550101'],
  ];
  for (const [cid, tenant, branch, name, phone] of people)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, created_at) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${phone}, 'active', now() - interval '400 days')`);
  await q(sql`update customers set archived_at = now() where id = ${C.archived}`);
  await visit(C.once, 10);
  for (const d of [70, 40, 10]) await visit(C.regular, d);                      // every 30 days, last 10 days ago → active
  for (const d of [110, 80, 50]) await visit(C.lapsed, d);                      // every 30 days, last 50 days ago → inactive (> 45)
  for (const d of [360, 330, 300]) await visit(C.gone, d);                      // long-term inactive
  for (const d of [200, 170, 140]) await visit(C.booked, d);                    // lapsed, but booked → active
  for (const d of [90, 60, 30]) await visit(C.archived, d);
  for (const d of [100, 70, 40]) await visit(C.atB2, d, { branch: B2 });
  const tid = (await visit(C.regular, 5))[0].id;   // a fourth visit with a named service
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id)
    values (${T}, ${B}, ${tid}, ${id(901)}, 'Gel Manicure', 4500, 45, 4500, ${LAN})`);
  await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
    values (${T}, ${B}, ${LAN}, ${C.booked}, 'x', (now() at time zone 'America/New_York')::date + 5, '10:00', '11:00', 'booked', '[]')`);
  await q(sql`set session_replication_role = origin`);
});

describe('Customer Intelligence — the six cards reconcile', () => {
  it('CI-01 every live profile is in exactly one state; never-served and under-cadence are counted, archived excluded', async () => {
    const r: any = await ci.scan(ctx());
    expect(r.reused).toBe(false);
    const s: any = await ci.summary(ctx());
    expect(s.breakdown.scanned).toBe(7);                      // 8 live (incl. the branch-2 regular) minus none; the archived one is excluded
    expect(s.breakdown.sumOfStates).toBe(s.breakdown.scanned);
    expect(s.breakdown.archivedExcluded).toBe(1);
    expect(s.breakdown).toMatchObject({ neverServed: 1, underCadence: 1 });
    expect(s.cards).toMatchObject({ scanned: 7, withUpcoming: 1 });
    expect(s.breakdown.states.insufficient_history).toBe(2);
    expect(s.cards.active).toBe(s.breakdown.states.active);
    expect(s.cards.inactive).toBe(s.breakdown.states.inactive + s.breakdown.states.long_term_inactive);
    expect(s.cards.duplicateGroups).toBeNull();               // Duplicate Review never scanned here: unknown, not zero
  });
  it('CI-02 one definition: the same counts as the per-customer assistant\'s aggregate over the same visits', async () => {
    const live = await q(sql`select id from customers where tenant_id = ${T} and archived_at is null`);
    const items: TenantScanItem[] = [];
    for (const { id: cid } of live) {
      const v = await q(sql`select coalesce(paid_at, created_at) as at from tickets where tenant_id = ${T} and customer_id = ${cid} and status = 'paid' order by 1`);
      const a = await q(sql`select appt_date::text as d, status from pos_tech_appointments where tenant_id = ${T} and customer_id = ${cid} and appt_date >= (now() at time zone 'America/New_York')::date`);
      items.push({ visits: v.map((x) => ({ date: new Date(x.at).toISOString(), serviceName: '', technicianName: '', totalCents: 0, tipCents: 0 })),
        appointments: a.map((x) => ({ startsAt: `${x.d}T23:59:59.000Z`, serviceName: '', technicianName: '', status: x.status })) });
    }
    const old = aggregateTenant(items, new Date(clock).toISOString(), DEFAULT_TUNABLES);
    const s: any = await ci.summary(ctx());
    expect(s.breakdown.states).toEqual({ active: old.active, rebooking_soon: old.rebookingSoon, due_for_return: old.dueForReturn, inactive: old.inactive, long_term_inactive: old.longTermInactive, insufficient_history: old.insufficientHistory });
    expect(s.cards).toMatchObject({ churnWatch: old.coarseChurnWatch, rebooking: old.rebookingOpportunities, withUpcoming: old.withUpcomingAppointment });
  });
  it('CI-03 Refresh inside 60 s reuses the last scan; later it rescans; a disabled assistant is refused', async () => {
    expect((await ci.scan(ctx()) as any).reused).toBe(true);
    clock += 120_000;
    expect((await ci.scan(ctx()) as any).reused).toBe(false);
    enabled = false;
    expect(await code(ci.summary(ctx()))).toBe('AI_CUSTOMER_PROFILE_DISABLED');
    enabled = true;
  });
});

describe('Customer Intelligence — list, search, dates, pages', () => {
  it('LS-01 status and flag filters use the scan\'s classification', async () => {
    const ids = async (f: any) => (await ci.customers(ctx(), f, { fullContact: false })).items.map((i: any) => i.id).sort();
    expect(await ids({ status: 'never_served' })).toEqual([C.never]);
    expect(await ids({ status: 'active' })).toEqual([C.booked, C.regular].sort());
    expect(await ids({ flag: 'upcoming' })).toEqual([C.booked]);
    expect((await ci.customers(ctx(), { flag: 'churn_watch' }, { fullContact: false })).items.every((i: any) => i.churnWatch)).toBe(true);
  });
  it('LS-02 search: name without accents, phone in any format, technician and service from completed visits', async () => {
    const ids = async (qq: string) => (await ci.customers(ctx(), { q: qq }, { fullContact: false })).items.map((i: any) => i.id);
    expect(await ids('lapsed')).toEqual([C.lapsed]);
    expect(await ids('(609) 555-0103')).toEqual([C.regular]);
    expect(await ids('gel manicure')).toEqual([C.regular]);
    expect((await ids('lan nguyen')).length).toBeGreaterThanOrEqual(5);
    expect(await ids('(609) 555-0101')).toEqual([C.never]);                    // the other salon's same number never appears
  });
  it('LS-03 newest visit first by default, stable pages, masked contact, last-visit date range', async () => {
    const all = await ci.customers(ctx(), { pageSize: 10 }, { fullContact: false });
    const lv = all.items.filter((i: any) => i.lastVisitAt).map((i: any) => i.lastVisitAt);
    expect([...lv].sort().reverse()).toEqual(lv);
    expect(all.items.find((i: any) => i.id === C.regular).phone).toMatch(/•••-0103$/);
    const p1 = await ci.customers(ctx(), { pageSize: 10, page: 1 }, { fullContact: false });
    expect(p1.total).toBe(7);
    const recent = await ci.customers(ctx(), { dateField: 'last_visit', preset: 'last_30' }, { fullContact: false });
    expect(recent.items.map((i: any) => i.id).sort()).toEqual([C.once, C.regular].sort());
    expect(await code(ci.customers(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, { fullContact: false }))).toBe('INTELLIGENCE_INVALID_PERIOD');
  });
  it('LS-04 a customer added after the scan shows as not scanned (never a guessed state)', async () => {
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${id(150)}, ${T}, ${B}, 'New', 'Comer', 'New Comer', 'active')`);
    const r = await ci.customers(ctx(), { status: 'not_scanned' }, { fullContact: false });
    expect(r.items.map((i: any) => i.id)).toEqual([id(150)]);
    expect(r.items[0]).toMatchObject({ scanned: false, status: null, completedVisits: null });
  });
});

describe('Customer Intelligence — security + health', () => {
  it('SC-01 detail is audited; another salon\'s customer is not found; a confined user sees only their branch', async () => {
    audits.length = 0;
    const d: any = await ci.customer(ctx(), C.lapsed, audit);
    expect(d.classification.status).toBe('inactive');
    expect(d.classification.evidence.join(' ')).toMatch(/days since last visit/);
    expect(audits).toEqual([{ customerId: C.lapsed }]);
    expect(await code(ci.customer(ctx(), C.other, audit))).toBe('CUSTOMER_NOT_FOUND');
    expect((await ci.customers(confinedB2(), {}, { fullContact: false })).items.map((i: any) => i.id)).toEqual([C.atB2]);
  });
  it('HL-01 the check reconciles the cards, explains eligibility, flags coverage, and changes nothing', async () => {
    const before = await q(sql`select count(*)::int n from customer_intelligence_snapshots`);
    const r: any = await ci.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.counts_reconcile.state).toBe('PASSED');
    expect(by.snapshot_matches_scan.state).toBe('PASSED');
    expect(by.eligibility.detail).toMatchObject({ neverServed: 1, underCadence: 1 });
    expect(by.coverage.state).toBe('WARNING');                                 // the customer added after the scan
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(await q(sql`select count(*)::int n from customer_intelligence_snapshots`)).toEqual(before);
    expect((await ci.check(ctx()) as any).reused).toBe(true);
    expect(CI_STATES).toHaveLength(6);
  });
  it('CPA-12 (Kevin, Nov 12 2026: churn belongs to Customer Retention) — the summary and each listed customer carry Retention\'s OWN classification', async () => {
    const ret = new RetentionRepository(db);
    const rs: any = await ret.summary(ctx());
    const s: any = await ci.summary(ctx());
    expect(s.retention).toEqual({ atRisk: rs.segments.at_risk, approaching: rs.segments.approaching, active: rs.segments.active, never: rs.segments.never, atRiskDays: rs.period.riskDays, source: 'customer_retention' });
    expect(s.retention.atRisk).toBeGreaterThan(0);
    // per row: exactly the customers Retention's own At Risk list names are at_risk here
    const retAtRisk = new Set((await ret.matchingIds(ctx(), { segment: 'at_risk' })).map(String));
    const list: any = await ci.customers(ctx(), { pageSize: 100 } as any, { fullContact: false });
    for (const it of list.items) expect(it.retention?.segment === 'at_risk').toBe(retAtRisk.has(it.id));
    const by = Object.fromEntries(list.items.map((x: any) => [x.id, x.retention]));
    expect(by[C.gone]).toMatchObject({ segment: 'at_risk' });
    expect(by[C.never]).toMatchObject({ segment: 'never_visited', daysAway: null });
    expect(by[C.regular]).toMatchObject({ segment: 'active' });
  });
});
