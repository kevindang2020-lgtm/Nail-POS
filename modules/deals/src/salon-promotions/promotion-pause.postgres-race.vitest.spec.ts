// promotion-pause.postgres-race — Promotions Management guide §09 "Concurrent actions": a Pause racing Checkout must follow a
// deterministic, documented rule with no partial state. The rule (engine, unchanged): Checkout's reservation reads the
// promotion's status under the deal row lock (SELECT … FOR UPDATE in deals-ledger.apply) and Pause updates that same row, so
// they serialize — an application that reserved BEFORE the pause committed stays on its ticket and is honoured at payment
// (the customer was quoted it); one that comes after is refused "not available". REAL Postgres, four sessions, three rounds.
// Fresh random salon per run (the CI race DB is shared).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';

const url = process.env.PG_RACE_URL;
const TAG = `pmr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), MGR = randomUUID(), SVC = randomUUID(), CAT = randomUUID();
const CUST = Array.from({ length: 8 }, () => randomUUID());

describe.skipIf(!url)('Pause racing Checkout on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const stacks = dbs.map((d) => { const repo = new KyselyDealsRepository(d); const svc = new DealsService(repo); return { svc, co: new DealsCheckoutService(svc, repo.ledger) }; });
  const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.manage'], technicianId: null } as any;
  const ctxM = { ...ctx, userId: MGR, role: 'MANAGER' };
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
  async function promotion(code: string) {
    const { svc } = stacks[0];
    const v = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title: 'race ' + code, discountType: 'percent', discountPercent: 20, code, serviceIds: [] } as any);
    await svc.submit(ctx, v.id); await svc.approve(ctx, v.id); return svc.publish(ctx, v.id);
  }
  const why = (r: any) => String(r?.reasons?.[0]?.code ?? r?.code ?? r?.message ?? r);

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 30, 5000)`);
    for (const [i, c] of CUST.entries()) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${c}, ${T}, ${B}, 'C', ${String(i)}, ${'C ' + i}, ${'+1609888' + String(1000 + i)}, 'active')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  for (const round of [1, 2, 3]) {
    it(`round ${round}: Pause during 8 simultaneous applications → each application either holds its seat or is refused; no partial rows; later ones refused; held ones pay once`, async () => {
      const code = `PR${round}${TAG.slice(-6).toUpperCase()}`;
      const p = await promotion(code);
      const tickets = []; for (const cu of CUST) tickets.push(await ticket(cu));
      const pause = stacks[3].svc.pause(ctx, p.id);
      const out = await Promise.allSettled(tickets.map((t, i) => apply(i, t, code)));
      await pause;
      const ok = out.map((o, i) => ({ o, t: tickets[i] })).filter((x) => x.o.status === 'fulfilled');
      const refused = out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
      // every refusal is the "not available" outcome (paused), never a crash or a half-written reservation
      expect(refused.map((r) => why(r.reason)).filter((w) => !/not_active|DEAL_NOT_AVAILABLE|not available|paused|PAUSED/i.test(w))).toEqual([]);
      const rows = await q(sql`select ticket_id, status from deal_redemptions where deal_id = ${p.id} order by ticket_id`);
      expect(rows.length).toBe(ok.length); expect(rows.every((r) => r.status === 'applied')).toBe(true);
      expect(new Set(rows.map((r) => String(r.ticket_id)))).toEqual(new Set(ok.map((x) => x.t)));
      expect(String((await q(sql`select status from deals where id = ${p.id}`))[0].status)).toBe('paused');
      // after the pause committed: refused, deterministically
      const late = await ticket(CUST[0]);
      expect(why(await apply(0, late, code).then(() => 'ok', (e) => e))).not.toBe('ok');
      // applications made while it was active are honoured at payment — counted once each, never twice
      for (const x of ok) { await q(sql`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = ${x.t}`); await stacks[1].co.onPaid(ctx, x.t); await stacks[2].co.onPaid(ctx, x.t); }
      expect(Number((await q(sql`select redemption_count from deals where id = ${p.id}`))[0].redemption_count)).toBe(ok.length);
      expect(Number((await q(sql`select count(*)::int n from deal_redemptions where deal_id = ${p.id} and status = 'redeemed'`))[0].n)).toBe(ok.length);
    });
  }

  it('the decisive interleaving, forced: judged while active → Pause commits → the reservation is REFUSED (the commit boundary decides, not the quote)', async () => {
    const code = `PIL${TAG.slice(-6).toUpperCase()}`;
    const p = await promotion(code);
    const t = await ticket(CUST[1]);
    const { co } = stacks[1];
    const cand = await co.candidate(ctx, t, { code });   // the cashier saw it as eligible
    const lines = (await q(sql`select id, line_total_cents from ticket_service_lines where ticket_id = ${t}`)).map((l) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
    const mine = priceTicket(lines, [cand.offer], await co.policy(ctx)).applied[0];
    await stacks[2].svc.pause(ctx, p.id);                 // a manager pauses in between
    const r = await co.reserve(ctx, t, cand, mine).then(() => 'ok', (e) => why(e));
    expect(r).not.toBe('ok');
    expect(Number((await q(sql`select count(*)::int n from deal_redemptions where deal_id = ${p.id}`))[0].n)).toBe(0);
  });

  it('two managers press Pause and Resume at the same moment → one consistent final state, the loser told to refresh (no partial update)', async () => {
    const p = await promotion(`PPR${TAG.slice(-6).toUpperCase()}`);
    await stacks[0].svc.pause(ctx, p.id);
    const out = await Promise.allSettled([stacks[1].svc.resume(ctx, p.id), stacks[2].svc.resume(ctxM, p.id), stacks[3].svc.resume(ctx, p.id)]);
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect((out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[]).every((o) => /DEAL_CHANGED_REFRESH|DEAL_STATE_INVALID|changed underneath|Can't resume/.test(String(o.reason?.code ?? o.reason?.message)))).toBe(true);
    expect(String((await q(sql`select status from deals where id = ${p.id}`))[0].status)).toBe('active');
  });
});
