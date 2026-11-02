// owner-live-ops-queries.pgtest — executes the Owner App's floor/live-operations counts against the real
// migrated schema.
//
// owner.kysely.repository.ts is the LARGEST uncovered surface in the silent-SQL report: 87 queries. Its floor
// counts are five independent `.catch(() => 0)` promises, which is the most dangerous shape in the codebase —
// a wrong column name does not blank the Owner dashboard, it reports **an empty salon**. Nobody investigates a
// quiet Tuesday. Every assertion below is "NOT zero", because zero is exactly what a broken query looks like.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyOwnerRepository } from './owner.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import type { OwnerContext } from './owner.dto';

const T = '22222222-2222-2222-2222-222222222222';
const B = '33333333-3333-3333-3333-333333333333';
const C = '55555555-5555-5555-5555-555555555555';
let repo: KyselyOwnerRepository;
let pg: any;

const ctx = (): OwnerContext => ({ tenantId: T, userId: 'u1', role: 'OWNER', permissions: [] } as never);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Live Ops Salon LLC', 'Live Ops Salon', 'live-ops', 'LIVEOPS', 'active')
    ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status)
    VALUES ('${B}', '${T}', 'Main', 'active')
    ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new KyselyOwnerRepository(kyselyFor(pg) as never);
  // Seed the five facts the floor counts measure. Column names come from db/migrations — that is the point.
  await pg.exec(`
    INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, checked_in_at)
    VALUES (gen_random_uuid(), '${T}', '${B}', 'Walk-in Guest', 'waiting', now());
  `);
  // tickets.customer_id is NOT NULL — the real schema refuses a shortcut, which is the whole point of the test.
  await pg.exec(`
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name)
    VALUES ('${C}', '${T}', '${B}', 'Ada', 'Rowe', 'Ada Rowe')
    ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, service_done_at, ready_checkout_at)
    VALUES (gen_random_uuid(), '${T}', '${B}', '${C}', 'in_service', now(), now());
  `);
});

describe('Owner floor counts execute against the real schema', () => {
  it('a waiting guest is COUNTED — zero here would read as an empty salon, not a broken query', async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    expect(c.waiting).toBeGreaterThan(0);
  });

  it('a guest in service is counted', async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    expect(c.serving).toBeGreaterThan(0);
  });

  it("today's completed services are counted — the date_trunc/timezone SQL actually runs", async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    expect(c.servicesToday).toBeGreaterThan(0);
  });

  it('ready-to-checkout is counted', async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    expect(c.readyToCheckout).toBeGreaterThan(0);
  });

  it("today's check-ins are counted", async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    expect(c.checkInsToday).toBeGreaterThan(0);
  });

  it('every count is a NUMBER, not a string — pg returns count(*) as text and n() must coerce it', async () => {
    const c = await repo.ownerFloorCounts(ctx(), B, 'UTC');
    for (const [k, v] of Object.entries(c)) expect(typeof v, k).toBe('number');
  });

  it('another tenant sees NONE of it — the tenant filter is real, not decorative', async () => {
    const other = { ...ctx(), tenantId: '44444444-4444-4444-4444-444444444444' } as OwnerContext;
    const c = await repo.ownerFloorCounts(other, null, 'UTC');
    expect(c.waiting).toBe(0);
    expect(c.serving).toBe(0);
  });
});

describe('Owner live operations executes against the real schema', () => {
  it('returns a shape without throwing, and the queries behind it actually run', async () => {
    const live = await repo.ownerLiveOperations(ctx(), B, 'UTC');
    expect(live).toBeTruthy();
    expect(typeof live).toBe('object');
  });
});

// Oct 12 2026 merge (other chat, workforce audit #28): the Live Team view — every active technician in scope with the
// authoritative workforce state (579) and today's sales + tips from the immutable compensation snapshots.
describe('Owner live operations — team (real schema)', () => {
  const TECH = '66666666-6666-4666-8666-666666666661', TECH2 = '66666666-6666-4666-8666-666666666662', OTHER_T = '44444444-4444-4444-4444-444444444444';
  beforeAll(async () => {
    await pg.exec(`
      INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) VALUES
        ('${TECH}', '${T}', '${B}', 'Ana', 'Lee', 'Ana Lee', true), ('${TECH2}', '${T}', '${B}', 'Bea', 'Kim', 'Bea Kim', true) ON CONFLICT DO NOTHING;
      INSERT INTO technician_workforce_state (tenant_id, branch_id, technician_id, clock_status, shift_status, queue_status) VALUES
        ('${T}', '${B}', '${TECH}', 'CLOCKED_IN', 'ON_SHIFT', 'AVAILABLE') ON CONFLICT (tenant_id, technician_id) DO UPDATE SET clock_status = 'CLOCKED_IN', shift_status = 'ON_SHIFT', queue_status = 'AVAILABLE';
      INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('66666666-6666-4666-8666-6666666666c1', '${T}', '${B}', 'Nails') ON CONFLICT DO NOTHING;
      INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ('66666666-6666-4666-8666-6666666666d1', '${T}', '${B}', '66666666-6666-4666-8666-6666666666c1', 'Gel', 30, 4000) ON CONFLICT DO NOTHING;
      INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES ('66666666-6666-4666-8666-6666666666e1', '${T}', '${B}', '${C}', 'paid') ON CONFLICT DO NOTHING;
      INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) VALUES
        ('66666666-6666-4666-8666-6666666666f1', '${T}', '${B}', '66666666-6666-4666-8666-6666666666e1', '66666666-6666-4666-8666-6666666666d1', 'Gel', 4000, 30, 4000) ON CONFLICT DO NOTHING;
      INSERT INTO ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, discount_cents, card_tip_cents, cash_tip_cents) VALUES
        ('${T}', '${B}', '66666666-6666-4666-8666-6666666666e1', '66666666-6666-4666-8666-6666666666f1', '${TECH}', 'v1', 4000, 500, 700, 300);
    `);
  });
  it('lists every active technician with clock/queue state and today\'s sales + tips (snapshots, net of discount)', async () => {
    const live = await repo.ownerLiveOperations(ctx(), B, 'UTC');
    const ana = live.team.find((r) => r.technicianId === TECH);
    expect(ana).toMatchObject({ technicianName: 'Ana Lee', clockStatus: 'CLOCKED_IN', queueStatus: 'AVAILABLE', salesTodayCents: 3500, tipsTodayCents: 1000 });
    expect(live.team.find((r) => r.technicianId === TECH2)).toMatchObject({ clockStatus: null, salesTodayCents: 0, tipsTodayCents: 0 });
    for (const r of live.team) expect(typeof r.salesTodayCents).toBe('number');
  });
  it('another tenant sees none of the team', async () => {
    const live = await repo.ownerLiveOperations({ ...ctx(), tenantId: OTHER_T } as OwnerContext, null, 'UTC');
    expect(live.team).toEqual([]);
  });
});

// Oct 13 2026 (FLOW duplicate D5 merged): the owner's staff sales commission is the compensation SNAPSHOT's cents
// (+ posted reversals) — it used to be a float re-pricing of the lines (line_total × stamped rate / 100.0).
describe('Owner staff sales commission reads the payroll authority (real schema)', () => {
  const TECH = '66666666-6666-4666-8666-666666666661';
  const T3 = '66666666-6666-4666-8666-6666666666e3', L3 = '66666666-6666-4666-8666-6666666666f3';
  beforeAll(async () => {
    await pg.exec(`
      INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, paid_at) VALUES ('${T3}', '${T}', '${B}', '${C}', 'paid', now()) ON CONFLICT DO NOTHING;
      INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) VALUES
        ('${L3}', '${T}', '${B}', '${T3}', '66666666-6666-4666-8666-6666666666d1', '${TECH}', 'Gel', 4000, 30, 4000, 'percent', 60) ON CONFLICT DO NOTHING;
      -- the authority priced this line with an authored 50 % rule on a $35 commissionable basis (after a $5 discount): $17.50, not 60 % × $40 = $24
      INSERT INTO ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, discount_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, cash_tip_cents) VALUES
        ('${T}', '${B}', '${T3}', '${L3}', '${TECH}', 'v1', 4000, 500, 3500, 'percent', 50, 1750, 0, 0);
      INSERT INTO compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source) VALUES
        ('${T}', '${B}', '${TECH}', '${T3}', 'refund_reversal', -250, 'goodwill refund', 'posted', 'refund');
    `);
  });
  it('commission = snapshot earnings + posted reversals (exact cents); sales and services still from the lines', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString(), to = new Date(Date.now() + 3600_000).toISOString();
    const rows = await repo.staffSales(ctx(), B, { fromIso: from, toIso: to } as never);
    const ana = rows.find((r) => r.technicianId === TECH)!;
    expect(ana.salesCents).toBe(4000);
    expect(ana.servicesCompleted).toBe(1);
    expect(ana.commissionCents).toBe(1750 - 250);
    expect((await repo.staffSales(ctx(), '99999999-9999-4999-8999-999999999999', { fromIso: from, toIso: to } as never)).find((r) => r.technicianId === TECH)).toBeUndefined();
  });
});

// 200-technician mandate §2 (Oct 27 2026): Live Operations read the team and the in-service list in windows of 1,000.
// Both are server pages now — the team searched by name (vi_fold, accent-insensitive) and filtered by queue status.
describe('Owner live operations at 1,000 technicians — one page each (real schema)', () => {
  const T2 = '77777777-7777-4777-8777-000000000001', B2 = '77777777-7777-4777-8777-000000000002', C2 = '77777777-7777-4777-8777-000000000003';
  const ctx2 = (): OwnerContext => ({ tenantId: T2, userId: 'u2', role: 'OWNER', permissions: [] } as never);
  const tid = (g: string) => `('77777777-7777-4777-8777-' || lpad(${g}::text, 12, '0'))::uuid`;
  beforeAll(async () => {
    await pg.exec(`
      INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T2}', 'Big Owner LLC', 'Big Owner', 'big-owner-live', 'BIGOWN1', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B2}', '${T2}', 'Main', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C2}', '${T2}', '${B2}', 'Lan', 'Tran', 'Lan Tran') ON CONFLICT DO NOTHING;
      INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active)
        SELECT ${tid('(g + 100)')}, '${T2}', '${B2}', 'Tech', lpad(g::text, 4, '0'), CASE WHEN g = 7 THEN 'Nguyễn Thị Hương' ELSE 'Tech ' || lpad(g::text, 4, '0') END, true FROM generate_series(1, 1000) g;
      INSERT INTO technician_workforce_state (tenant_id, branch_id, technician_id, clock_status, shift_status, queue_status)
        SELECT '${T2}', '${B2}', ${tid('(g + 100)')}, 'CLOCKED_IN', 'ON_SHIFT', CASE WHEN g % 10 = 0 THEN 'BREAK' ELSE 'AVAILABLE' END FROM generate_series(1, 1000) g;
      INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, serving_started_at)
        SELECT gen_random_uuid(), '${T2}', '${B2}', '${C2}', 'in_service', ${tid('(g + 100)')}, now() - (g || ' minutes')::interval FROM generate_series(1, 60) g;
    `);
  }, 120_000);
  const maxTechList = (o: any): number => Object.entries(o || {}).reduce((m, [k, v]) => Math.max(m, Array.isArray(v) && /team|techQueue/.test(k) ? v.length : v && typeof v === 'object' ? maxTechList(v) : 0), 0);

  it('the first page of each, the totals; never more than one page of technicians', async () => {
    const live = await repo.ownerLiveOperations(ctx2(), B2, 'UTC');
    expect(live.team).toHaveLength(25);
    expect(live.team[0].technicianName).toBe('Nguyễn Thị Hương');   // name order: "N…" sorts before "T…"
    expect(live.totals!.team).toBe(1000);
    expect(live.teamPage).toEqual({ page: 1, pageSize: 25, total: 1000, totalPages: 40 });
    expect(live.techQueue).toHaveLength(25);
    expect(live.totals!.techQueue).toBe(60);
    expect(live.techQueuePage).toEqual({ page: 1, pageSize: 25, total: 60, totalPages: 3 });
    expect(maxTechList(live)).toBeLessThanOrEqual(25);
  });
  it('later pages, the size cap (50), accent-insensitive search, status filter, who each technician is serving', async () => {
    const p40 = await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { teamPage: 40 });
    expect(p40.team).toHaveLength(25); expect(p40.team[24].technicianName).toBe('Tech 1000');
    const tq3 = await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { techQueuePage: 3 });
    expect(tq3.techQueue).toHaveLength(10);
    expect((await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { teamPageSize: 5000 })).team).toHaveLength(50);
    const vi = await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { teamSearch: 'nguyen thi' });
    expect(vi.team.map((r) => r.technicianName)).toEqual(['Nguyễn Thị Hương']);
    expect(vi.teamPage!.total).toBe(1); expect(vi.totals!.team).toBe(1000);
    const brk = await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { teamStatus: 'BREAK' });
    expect(brk.teamPage!.total).toBe(100); expect(brk.team.every((r) => r.queueStatus === 'BREAK')).toBe(true);
    const t1 = (await repo.ownerLiveOperations(ctx2(), B2, 'UTC', { teamSearch: 'Tech 0001' })).team[0];
    expect(t1.currentCustomerName).toBe(null);   // the ticket has no queue item, so no customer name — but the read runs
  });
  // VietnamesePOS §41 (Oct 28 2026 audit): the Owner app's ticket search matched names with plain ILIKE — "nguyen" missed "Nguyễn"
  it('the ticket search finds a technician\'s and a customer\'s name without accents', async () => {
    const byTech = await repo.ownerTicketsList(ctx2(), { search: 'nguyen thi huong', page: 1, pageSize: 50 } as never);
    expect(byTech.total).toBe(1);
    const byCustomer = await repo.ownerTicketsList(ctx2(), { search: 'LAN TRÂN', page: 1, pageSize: 50 } as never);
    expect(byCustomer.total).toBe(60);
  });
});
