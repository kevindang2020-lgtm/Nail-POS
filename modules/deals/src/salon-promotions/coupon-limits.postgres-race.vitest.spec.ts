// coupon-limits.postgres-race — Coupons & Promotions guide §13 / §21 on REAL Postgres with REAL concurrency (four
// sessions): "two concurrent checkouts cannot exceed coupon limits; payment callback repeats do not post two redemption
// records". Each register runs what CheckoutService.applyOffer runs — candidate() → priceTicket → reserve() (the ledger's
// advisory lock + re-count) — and the payment step runs onPaid(). Fresh random salon per run (the CI race DB is shared).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';

const url = process.env.PG_RACE_URL;
const TAG = `cpr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), SVC = randomUUID(), CAT = randomUUID();
const CUST = Array.from({ length: 10 }, () => randomUUID());

describe.skipIf(!url)('coupon limits and payment callbacks on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const stacks = dbs.map((d) => { const repo = new KyselyDealsRepository(d); const svc = new DealsService(repo); return { svc, co: new DealsCheckoutService(svc, repo.ledger) }; });
  const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.manage'], technicianId: null } as any;
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  async function ticket(cust: string) {
    const t = String((await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values (${T}, ${B}, ${cust}, 'ready_checkout', 5000, 5000) returning id`))[0].id);
    await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${t}, ${SVC}, 'Gel', 5000, 30, 5000)`);
    return t;
  }
  async function apply(i: number, t: string, code: string) {
    const { co } = stacks[i % stacks.length];
    const cand = await co.candidate(ctx, t, { code });
    const lines = (await q(sql`select id, line_total_cents from ticket_service_lines where ticket_id = ${t}`)).map((l) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
    const mine = priceTicket(lines, [cand.offer], await co.policy(ctx)).applied[0];
    return co.reserve(ctx, t, cand, mine);
  }
  async function coupon(title: string, code: string, extra: Record<string, unknown>) {
    const { svc } = stacks[0];
    const v = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title, discountType: 'percent', discountPercent: 20, code, serviceIds: [], ...extra } as any);
    await svc.submit(ctx, v.id); await svc.approve(ctx, v.id); return svc.publish(ctx, v.id);
  }

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 30, 5000)`);
    for (const [i, c] of CUST.entries()) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${c}, ${T}, ${B}, 'C', ${String(i)}, ${'C ' + i}, ${'+1609777' + String(1000 + i)}, 'active')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('a coupon capped at 2, applied at ten registers at once over four sessions → exactly 2 tickets carry it; the rest are refused "sold out"', async () => {
    const c = await coupon('cap two', `CAPTWO${TAG.slice(-4).toUpperCase()}`, { maxRedemptions: 2 });
    const tickets = []; for (const cu of CUST) tickets.push(await ticket(cu));
    const out = await Promise.allSettled(tickets.map((t, i) => apply(i, t, `CAPTWO${TAG.slice(-4).toUpperCase()}`)));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(2);
    const why = (out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[]).map((o) => String(o.reason?.reasons?.[0]?.code ?? o.reason?.message));
    expect(why.every((w) => w === 'sold_out')).toBe(true);
    expect(Number((await q(sql`select count(*)::int n from deal_redemptions where deal_id = ${c.id} and status = 'applied'`))[0].n)).toBe(2);
  });

  it('a single-use code applied at ten registers at once → one ticket only (the code is used once)', async () => {
    const c = await coupon('single code', `ONCE${TAG.slice(-4).toUpperCase()}`, {});
    const code = `SINGLE${TAG.slice(-6).toUpperCase()}`;
    await stacks[0].co['ledger'].insertCodes(T, c.id, { quantity: 1, prefix: null, singleUse: true, purpose: 'manual', campaignId: null, expiresAt: null, userId: OWNER }, [{ hash: (await import('../engine/coupons')).hashCode(T, code), hint: code.slice(-4) }]);
    const tickets = []; for (const cu of CUST) tickets.push(await ticket(cu));
    const out = await Promise.allSettled(tickets.map((t, i) => apply(i, t, code)));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
  });

  it('the payment callback for one ticket delivered 8 times at once → ONE redemption, the count moves once', async () => {
    const c = await coupon('callback', `CALLB${TAG.slice(-4).toUpperCase()}`, {});
    const t = await ticket(CUST[0]);
    await apply(0, t, `CALLB${TAG.slice(-4).toUpperCase()}`);
    await q(sql`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = ${t}`);
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => stacks[i % stacks.length].co.onPaid(ctx, t)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message))).toEqual([]);
    expect(out.reduce((n, o: any) => n + o.value.redeemed, 0)).toBe(1);
    expect(Number((await q(sql`select redemption_count from deals where id = ${c.id}`))[0].redemption_count)).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from deal_redemptions where deal_id = ${c.id} and status = 'redeemed'`))[0].n)).toBe(1);
  });
});
