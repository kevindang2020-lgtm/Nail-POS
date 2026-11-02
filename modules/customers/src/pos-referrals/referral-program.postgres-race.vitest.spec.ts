// referral-program.postgres-race — Referral Program guide (Oct 30 2026, migration 751) T07 / T13 on REAL Postgres with REAL
// concurrency (PGlite is one session). Four Kysely instances = four sessions; every call runs its own transaction as production does:
//   • 8 simultaneous "Record referral" taps for one new customer → ONE referral, every caller gets the same id, none fails
//   • the Checkout event delivered 8 times at once → ONE qualification, ONE reward, ONE loyalty ledger posting
//   • two managers approving at once (6 taps) → ONE decision, ONE posting; the rest get a clear state conflict
//   • the same refund delivered 6 times at once → ONE reversal entry
// Data: a fresh random salon per run (the CI race database is shared). The loyalty ledger and referral events are append-only by
// design, so rows stay; nothing global is changed.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ReferralProgram, ReferralProgramError } from './referral-program';

const url = process.env.PG_RACE_URL;
const TAG = `rfr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID();
const REF = randomUUID(), NEW1 = randomUUID(), NEW2 = randomUUID(), M1 = randomUUID(), M2 = randomUUID();
const ph = () => '+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6));

describe.skipIf(!url)('Referral Program on real Postgres: one referral, one reward, one posting under concurrency', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const rps = dbs.map((d) => new ReferralProgram(d));
  const on = (i: number) => rps[i % rps.length];
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const ctx = (userId: string) => ({ tenantId: T, branchId: B, userId, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] }) as any;
  const reason = (o: PromiseSettledResult<unknown>) => (o.status === 'rejected' ? ((o as PromiseRejectedResult).reason instanceof ReferralProgramError ? (o as PromiseRejectedResult).reason.code : String((o as PromiseRejectedResult).reason?.message ?? (o as PromiseRejectedResult).reason)) : 'ok');
  async function paid(customer: string, cents: number) {
    const t = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at) values (${T}, ${B}, ${customer}, 'paid', ${cents}, 0, 0, ${cents}, now()) returning id`))[0].id;
    const p = (await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T}, ${B}, ${t}, 'cash', ${cents}, 0, 'approved') returning id`))[0].id;
    return { ticket: String(t), payment: String(p) };
  }
  async function policy(b: Record<string, unknown>) { const cur = await rps[0].settings({ tenantId: T }); await rps[0].saveSettings(ctx(M1), { ...b, expectedVersion: cur.version }, async () => undefined); }

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    for (const [cid, name] of [[REF, 'Race Referrer'], [NEW1, 'Race NewOne'], [NEW2, 'Race NewTwo']] as const)
      await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${cid}, ${T}, ${B}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${ph()}, 'active')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${M1}, ${T}, 'Race M1', ${TAG + '-m1@race.test'}, 'active', 'MANAGER'), (${M2}, ${T}, 'Race M2', ${TAG + '-m2@race.test'}, 'active', 'MANAGER')`);
    await q(sql`insert into customer_referrals (tenant_id, customer_id, code) values (${T}, ${REF}, ${TAG.toUpperCase()})`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('T07: 8 simultaneous Record taps for one new customer → ONE referral; every tap returns it; none fails', async () => {
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => on(k).record(ctx(M1), { code: TAG, referredCustomerId: NEW1, idempotencyKey: `${TAG}-rec-${k}` })));
    expect(out.map(reason)).toEqual(Array(8).fill('ok'));
    const ids = new Set(out.map((o: any) => o.value.id));
    expect(ids.size).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${NEW1}`))[0].n)).toBe(1);
    expect(out.filter((o: any) => !o.value.duplicate).length).toBe(1);
  });

  it('T13: the Checkout event delivered 8 times at once → ONE qualification, ONE reward, ONE ledger posting', async () => {
    await policy({ rewardType: 'loyalty_points', rewardPoints: 40, requiresApproval: false });
    const { ticket } = await paid(NEW1, 6000);
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => on(k).qualifyForTicket(T, ticket, `race-${k}`)));
    expect(out.map(reason)).toEqual(Array(8).fill('ok'));
    const outcomes = out.map((o: any) => o.value.outcome).sort();
    expect(outcomes.filter((x) => x === 'auto_issued').length).toBe(1);
    expect(outcomes.filter((x) => x === 'duplicate').length).toBe(7);
    const rw = await q(sql`select id, state from referral_rewards where tenant_id = ${T}`);
    expect(rw.map((r: any) => r.state)).toEqual(['ISSUED']);
    expect((await q(sql`select delta from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards' and source_id = ${rw[0].id}`)).map((r: any) => Number(r.delta))).toEqual([40]);
  });

  it('T11/T13: two managers approve at once (6 taps) → ONE decision, ONE posting', async () => {
    await policy({ rewardType: 'loyalty_points', rewardPoints: 25, requiresApproval: true });
    const r: any = await rps[0].record(ctx(M1), { code: TAG, referredCustomerId: NEW2, idempotencyKey: `${TAG}-rec-n2` });
    const { ticket, payment } = await paid(NEW2, 5000);
    expect((await rps[1].qualifyForTicket(T, ticket, 'race-n2')).outcome).toBe('pending_approval');
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => on(k).review(ctx(k % 2 ? M2 : M1), r.id, { action: 'approve', reason: 'race' }, async () => undefined)));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(out.filter((o) => o.status === 'rejected').map(reason)).toEqual(Array(5).fill('REFERRAL_REWARD_STATE_CONFLICT'));
    const w = (await q(sql`select id, state from referral_rewards where tenant_id = ${T} and referral_id = ${r.id}`))[0];
    expect(w.state).toBe('ISSUED');
    expect((await q(sql`select count(*)::int n from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards' and source_id = ${w.id}`))[0].n).toBe(1);
    // T14 under concurrency: the same refund delivered 6 times at once → ONE reversal entry
    const refundId = randomUUID();
    await q(sql`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, status, reason) values (${refundId}, ${T}, ${B}, ${payment}, 5000, 'refunded', 'race')`);
    const rv = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => dbs[k % dbs.length].transaction().execute((trx: any) => on(k).handleRefund(T, ticket, refundId, trx))));
    expect(rv.map(reason)).toEqual(Array(6).fill('ok'));
    expect((await q(sql`select entry_type, delta from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards' and source_id = ${w.id} order by created_at`)).map((x: any) => `${x.entry_type}:${x.delta}`)).toEqual(['earn:25', 'reverse:-25']);
  });
});
