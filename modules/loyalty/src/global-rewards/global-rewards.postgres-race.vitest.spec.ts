// global-rewards.postgres-race — LoyaltyRules.pdf T10 / T11 and the Final Completion guide §04 double-spend cases on REAL
// Postgres with REAL concurrency (PGlite is one session, so the pgtest versions prove the guarded write, not a race).
// Four Kysely instances = four separate sessions; every call below runs its own transaction exactly as production does:
//   • earn: 16 concurrent sales on a wallet that funds exactly 10 → 10 EARNED, 6 BLOCKED, wallet 0, never negative
//   • the same checkout delivered 8 times at once → ONE award, ONE wallet debit
//   • 8 salons' Checkouts race to hold the same customer's points (45 points, one 10-point block each) (tender row + hold in one transaction, like
//     recordRewardPaymentAtomic) → only what the balance covers is held; losers leave no tender row
//   • the paid-ticket finalize delivered 6 times at once → ONE payable
// Data: fresh random salons / customer per run (the CI race database is shared). Loyalty ledgers are append-only by
// design (triggers refuse DELETE), so the rows stay; the platform flags this file turns on are restored afterwards.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { GlobalRewardsRepository, type GrCtx } from './global-rewards.repository';
import { earnForTicket } from './rewards-earn';
import { holdForTicket, finalizeForPaidTicket } from './rewards-redemption';
import { GlobalRewardsError } from './global-rewards-core';
import { GR_FLAGS } from './global-rewards-flags';

const url = process.env.PG_RACE_URL;
const TAG = `grr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const SALONS = 8;
const T = Array.from({ length: SALONS }, () => randomUUID());
const B = Array.from({ length: SALONS }, () => randomUUID());
const CUST = Array.from({ length: SALONS }, () => randomUUID());
const USERS = Array.from({ length: SALONS }, () => randomUUID());
const IDV = randomUUID(), OWNER = randomUUID();
const PHONE = '+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6));
const FLAGS = [GR_FLAGS.engine, GR_FLAGS.earn, GR_FLAGS.purchases, GR_FLAGS.redemption];

describe.skipIf(!url)('AI PowerSalon Rewards on real Postgres: concurrent earn, duplicate delivery, holds, finalize', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const repos = dbs.map((d) => new GlobalRewardsRepository(d));
  const on = (i: number) => ({ db: dbs[i % dbs.length], repo: repos[i % repos.length] });
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const owner = (i: number): GrCtx => ({ tenantId: T[i], branchId: B[i], userId: OWNER, role: 'OWNER', permissions: ['pos.settings.edit', 'pos.customers.view'] });
  let flagsBefore: { setting_key: string; value: unknown }[] = [];
  let n = 0;

  async function paidTicket(i: number, cents: number) {
    const t = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at) values (${T[i]}, ${B[i]}, ${CUST[i]}, 'paid', now()) returning id`))[0].id;
    await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T[i]}, ${B[i]}, ${t}, 'cash', ${cents}, 0, 'approved')`);
    return String(t);
  }
  const earn = (i: number, salon: number, ticket: string) => { const c = on(i); return c.db.transaction().execute((trx: any) => earnForTicket(trx, c.repo, { tenantId: T[salon], ticketId: ticket, eventId: 'ev-' + ticket, giftCardChargeCents: 0 })); };
  async function fund(i: number, tokens: number) {
    const r = await repos[0].createPurchase(owner(i), { tokens, idempotencyKey: `${TAG}-fund-${i}-${++n}`, provider: 'sandbox' });
    await repos[0].movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: T[i], source: 'race-test', providerRef: 'sbx_' + r.intentId });
    await repos[0].movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: T[i], source: 'race-test' });
  }
  const wallet = async (i: number) => Number((await q(sql`select available_cents from tenant_token_wallets where tenant_id = ${T[i]}`))[0]?.available_cents ?? 0);
  const acct = async () => { const r = (await q(sql`select available_tenths::int a, reserved_tenths::int h from global_rewards_accounts where identity_id = ${IDV}`))[0]; return { a: Number(r.a), h: Number(r.h) }; };

  beforeAll(async () => {
    flagsBefore = await q(sql`select setting_key, value from platform_settings where setting_key in (${sql.join(FLAGS)})`);
    for (let i = 0; i < SALONS; i++) {
      await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T[i]}, ${TAG + i}, ${'Race Salon ' + i}, ${TAG + '-' + i}, ${(TAG.slice(-9) + i).toUpperCase()}, 'active')`);
      await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B[i]}, ${T[i]}, 'Main', 'America/New_York')`);
      await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${CUST[i]}, ${T[i]}, ${B[i]}, 'Ava', 'Race', 'Ava Race', ${PHONE}, 'active')`);
      await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${USERS[i]}, ${T[i]}, 'Ava Race', ${`${TAG}-${i}@race.test`}, 'active', 'CUSTOMER')`);
    }
    await q(sql`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values (${IDV}, ${PHONE}, 'Ava Race', 'active', now())`);
    for (let i = 0; i < SALONS; i++) await q(sql`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values (${IDV}, ${T[i]}, ${USERS[i]}, ${CUST[i]})`);
    await q(sql`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) values (${IDV}, '2026-10-30', 'customer_app', now(), 'customer_app')`);
    for (const k of FLAGS) await q(sql`insert into platform_settings (setting_key, setting_group, value, value_type) values (${k}, 'loyalty', 'true'::jsonb, 'boolean') on conflict (setting_key) do update set value = excluded.value`);
    for (let i = 0; i < SALONS; i++) await repos[0].setEnrollment(T[i], 'enrolled', { reason: 'race test salon for the rewards network', actorUserId: OWNER });
  }, 120_000);

  afterAll(async () => {
    if (dbs[0]) {
      for (const k of FLAGS) {
        const was = flagsBefore.find((f) => f.setting_key === k);
        if (was) await q(sql`update platform_settings set value = ${JSON.stringify(was.value)}::jsonb where setting_key = ${k}`);
        else await q(sql`delete from platform_settings where setting_key = ${k}`);
      }
    }
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('T10: 16 concurrent $10 sales over four sessions on a wallet that funds exactly 10 → 10 EARNED, 6 BLOCKED, wallet 0, never negative', async () => {
    await fund(0, 1);                                         // 1.00 token; global $5 = 0.5 → a $10 sale costs 0.10
    expect(await wallet(0)).toBe(100);
    const tickets = []; for (let k = 0; k < 16; k++) tickets.push(await paidTicket(0, 1000));
    const out = await Promise.allSettled(tickets.map((t, k) => earn(k, 0, t)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const st = out.map((o: any) => o.value.status);
    expect(st.filter((s) => s === 'EARNED').length).toBe(10);
    expect(st.filter((s) => s === 'BLOCKED_INSUFFICIENT_TOKENS').length).toBe(6);
    expect(await wallet(0)).toBe(0);
    expect(await acct()).toEqual({ a: 100, h: 0 });           // 10 × 1.0 point
    // the wallet ledger agrees with the wallet: one earn_allocation per award, running balance never below zero
    const led = await q(sql`select count(*) filter (where entry_type = 'earn_allocation')::int n, min(balance_after_cents)::int lo from token_wallet_ledger where tenant_id = ${T[0]}`);
    expect({ n: Number(led[0].n), lo: Number(led[0].lo) }).toEqual({ n: 10, lo: 0 });
  });

  it('T11: the same checkout delivered 8 times at once → ONE award, ONE wallet debit', async () => {
    await fund(1, 5);
    const t = await paidTicket(1, 5000);                      // $50 → 5.0 points, 0.50 token
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => earn(k, 1, t)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(out.filter((o: any) => o.value.status === 'EARNED' && o.value.outcome !== 'duplicate').length).toBe(1);
    expect(await wallet(1)).toBe(450);
    expect(Number((await q(sql`select count(*)::int n from reward_earn_transactions where ticket_id = ${t}`))[0].n)).toBe(1);
    expect(await acct()).toEqual({ a: 150, h: 0 });
  });

  it('double spend: 8 salons each hold one reward block at once from 45 points → only what the balance covers is held, never negative, losers leave no tender', async () => {
    await fund(2, 5);
    expect((await earn(0, 2, await paidTicket(2, 30000))).status).toBe('EARNED');   // $300 → +30 points: 45 in all
    const total = (await acct()).a; expect(total).toBe(450);
    const tickets = []; for (let i = 0; i < SALONS; i++) tickets.push(String((await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents) values (${T[i]}, ${B[i]}, ${CUST[i]}, 'payment_in_progress', 5000) returning id`))[0].id));
    const prog = await repos[0].program();
    const blocks = 1, blockTenths = Number(prog.pointsPerRedeemBlock) * 10;     // default 10 points = $1.00
    const holdsFit = Math.floor(total / blockTenths);                            // 4 of 8
    expect(holdsFit).toBeLessThan(SALONS);
    const out = await Promise.allSettled(tickets.map((tk, i) => {
      const c = on(i);
      return c.db.transaction().execute(async (trx: any) => {
        const pay = (await sql<{ id: string }>`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, idempotency_key)
          values (${T[i]}::uuid, ${B[i]}::uuid, ${tk}::uuid, 'global_reward', ${blocks * Number(prog.redeemBlockValueCents)}, 0, 'approved', ${`reward:${TAG}-h${i}`}) returning id`.execute(trx)).rows[0].id;
        return holdForTicket(trx, c.repo, { tenantId: T[i], branchId: B[i], userId: OWNER, role: 'OWNER' }, { ticketId: tk, customerId: CUST[i], blocks, dueCents: 5000, paymentId: pay, idempotencyKey: `${TAG}-h${i}` });
      });
    }));
    const ok = out.map((o, i) => ({ o, i })).filter((x) => x.o.status === 'fulfilled');
    const bad = out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(bad.map((b) => (b.reason instanceof GlobalRewardsError ? b.reason.code : String(b.reason?.message ?? b.reason)))).toEqual(Array(SALONS - holdsFit).fill('REWARDS_POINTS_INSUFFICIENT'));
    expect(ok.length).toBe(holdsFit);
    const a = await acct();
    expect(a.h).toBe(holdsFit * blocks * blockTenths); expect(a.a).toBe(total - a.h); expect(a.a).toBeGreaterThanOrEqual(0);
    for (const { i } of out.map((o, i) => ({ o, i })).filter((x) => x.o.status === 'rejected')) {
      expect(Number((await q(sql`select count(*)::int n from payments where ticket_id = ${tickets[i]} and method = 'global_reward'`))[0].n)).toBe(0);
    }
    // points ledger: balance_after = available + held after the race
    const last = (await q(sql`select balance_after_tenths::int b from global_points_ledger where identity_id = ${IDV} order by created_at desc, id desc limit 1`))[0];
    expect(Number(last.b)).toBe(a.a + a.h);
    (globalThis as any).__grrWinner = { salon: ok[0].i, ticket: tickets[ok[0].i], blocks, blockTenths, cents: blocks * Number(prog.redeemBlockValueCents) };
  });

  it('finalize delivered 6 times at once for the paid ticket → ONE redemption confirmed, ONE payable, points spent once', async () => {
    const w = (globalThis as any).__grrWinner; expect(w).toBeTruthy();
    await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T[w.salon]}, ${B[w.salon]}, ${w.ticket}, 'cash', ${5000 - w.cents}, 0, 'approved')`);
    await q(sql`update tickets set status = 'paid', paid_at = now() where id = ${w.ticket}`);
    const before = await acct();
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => { const c = on(k); return c.db.transaction().execute((trx: any) => finalizeForPaidTicket(trx, c.repo, { tenantId: T[w.salon], ticketId: w.ticket, eventId: 'ev-fin-' + k })); }));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const pay = await q(sql`select status, amount_cents::int amt from merchant_reimbursements where ticket_id = ${w.ticket}`);
    expect(pay.map((p) => ({ status: p.status, amt: Number(p.amt) }))).toEqual([{ status: 'ACCRUED_OWED', amt: w.cents }]);
    const after = await acct();
    expect(after).toEqual({ a: before.a, h: before.h - w.blocks * w.blockTenths });
    expect(Number((await q(sql`select count(*)::int n from reward_redemptions where ticket_id = ${w.ticket} and status = 'CONFIRMED_REDEEMED'`))[0].n)).toBe(1);
  });
});
