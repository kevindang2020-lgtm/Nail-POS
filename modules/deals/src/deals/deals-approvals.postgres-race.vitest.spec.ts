// deals-approvals.postgres-race — Deals & Offers guide §12 / §18 "Financial safety: concurrent limit, duplicate callbacks"
// and §9 approvals on REAL Postgres with REAL concurrency (four sessions):
//   • a salon DEAL (not a coupon: no code) with a usage limit of 3, applied at eight registers at once → exactly 3 tickets
//   • the paid callback for one ticket delivered six times at once → one redeemed row, counted once
//   • two managers approving the same technician proposal at the same moment → one decision row, one transition
// Fresh random salon per run (the CI race database is shared).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DealsService } from './deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';

const url = process.env.PG_RACE_URL;
const TAG = `dor${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), MGR1 = randomUUID(), MGR2 = randomUUID(), TECHUSER = randomUUID(), TECH = randomUUID();
const SVC = randomUUID(), CAT = randomUUID();
const CUST = Array.from({ length: 8 }, () => randomUUID());

describe.skipIf(!url)('Deals & Offers limits, paid callbacks and approvals on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const stacks = dbs.map((d) => { const repo = new KyselyDealsRepository(d); const svc = new DealsService(repo); return { svc, co: new DealsCheckoutService(svc, repo.ledger) }; });
  const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.manage'], technicianId: null } as any;
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  async function ticket(cust: string) {
    const t = String((await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values (${T}, ${B}, ${cust}, 'ready_checkout', 1000, 1000) returning id`))[0].id);
    await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${t}, ${SVC}, 'Polish', 1000, 30, 1000)`);
    return t;
  }
  async function apply(i: number, t: string, dealId: string) {
    const { co } = stacks[i % stacks.length];
    const cand = await co.candidate(ctx, t, { dealId });
    const lines = (await q(sql`select id, line_total_cents from ticket_service_lines where ticket_id = ${t}`)).map((l) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
    const mine = priceTicket(lines, [cand.offer], await co.policy(ctx)).applied[0];
    return co.reserve(ctx, t, cand, mine);
  }

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Polish', 30, 1000)`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Lisa', 'Tran', 'Lisa Tran')`);
    for (const [i, c] of CUST.entries()) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${c}, ${T}, ${B}, 'C', ${String(i)}, ${'C ' + i}, ${'+1609888' + String(1000 + i)}, 'active')`);
    await stacks[0].svc.updateSettings(ctx, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10 } as any);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  let springId = '';
  it('Spring time 5% with a limit of 3, applied at eight registers at once → exactly 3 tickets carry it, each $0.50 off', async () => {
    const { svc } = stacks[0];
    const v = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'deal', title: 'Spring time', discountType: 'percent', discountPercent: 5, serviceIds: [SVC], maxRedemptions: 3 } as any);
    await svc.submit(ctx, v.id); await svc.approve(ctx, v.id); springId = (await svc.publish(ctx, v.id)).id;
    const tickets = []; for (const cu of CUST) tickets.push(await ticket(cu));
    const out = await Promise.allSettled(tickets.map((t, i) => apply(i, t, springId)));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(3);
    const why = (out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[]).map((o) => String(o.reason?.reasons?.[0]?.code ?? o.reason?.message));
    expect(why.every((w) => w === 'sold_out')).toBe(true);
    expect((await q(sql`select amount_discounted_cents::int a from deal_redemptions where deal_id = ${springId} and status = 'applied'`)).map((r) => r.a)).toEqual([50, 50, 50]);
  });

  it('one ticket\'s paid callback delivered six times at once → one redeemed row, the deal counted once', async () => {
    const t = String((await q(sql`select ticket_id from deal_redemptions where deal_id = ${springId} and status = 'applied' order by created_at limit 1`))[0].ticket_id);
    await q(sql`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = ${t}`);
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => stacks[i % stacks.length].co.onPaid(ctx, t)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(Number((await q(sql`select count(*)::int n from deal_redemptions where deal_id = ${springId} and ticket_id = ${t} and status = 'redeemed'`))[0].n)).toBe(1);
    expect(Number((await q(sql`select redemption_count from deals where id = ${springId}`))[0].redemption_count)).toBe(1);
  });

  it('two managers approve the same technician proposal at the same moment → one approval decision, approved once', async () => {
    const tech = { ...ctx, userId: TECHUSER, role: 'TECHNICIAN', technicianId: TECH };
    const p = await stacks[0].svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa 8%', discountType: 'percent', discountPercent: 8, serviceIds: [SVC] } as any);
    expect(p.status).toBe('pending_approval');
    const out = await Promise.allSettled([MGR1, MGR2, MGR1, MGR2].map((m, i) => stacks[i].svc.approve({ ...ctx, userId: m, role: 'MANAGER' }, p.id)));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from deal_approvals where deal_id = ${p.id} and decision = 'approved'`))[0].n)).toBe(1);
    expect(String((await q(sql`select status from deals where id = ${p.id}`))[0].status)).toBe('approved');
  });
});
