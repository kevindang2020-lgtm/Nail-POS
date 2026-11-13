// global-rewards-redemption.pgtest — cross-salon redemption, holds, payables and payouts on the REAL schema (733 + 734).
// Final Completion guide §03–§05 + §16 acceptance; LoyaltyRules.pdf T13, T15; token groups "Redemption" and "Payables".
// Salon A earns (funds) the points; Salon B and Salon C accept them. Holds are placed exactly as Checkout places them:
// the 'global_reward' tender row and the hold in ONE transaction.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalRewardsRepository, type GrCtx } from './global-rewards.repository';
import { earnForTicket } from './rewards-earn';
import { earnEstimate, holdForTicket, releaseHold, finalizeForPaidTicket, reverseRedemptionForRefund, redemptionQuote, requestPayout, applyPayoutSettlement, markPayoutEligible, type PayoutProvider } from './rewards-redemption';
import { expireHolds } from './global-rewards-checkout';
import { GlobalRewardsError } from './global-rewards-core';
import { GR_FLAGS } from './global-rewards-flags';
import { GlobalRewardsService } from './global-rewards.service';

const P = 'd7340000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), TC = id('a3');
const BA = id('b1'), BB = id('b2'), BC = id('b3');
const OWNER = id('e1'), SA = id('e9');
const IDV = id('f1'), IDN = id('f2');   // verified + opted in; verified but NOT opted in
const custOf: Record<string, string> = { [TA]: id('c1'), [TB]: id('c2'), [TC]: id('c3') };
const custN = id('c4');
const owner = (t: string, b: string): GrCtx => ({ tenantId: t, branchId: b, userId: OWNER, role: 'OWNER', permissions: ['pos.settings.edit', 'pos.customers.view'] });
let pg: any; let db: any; let repo: GlobalRewardsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const program = { pointsPerRedeemBlock: 10, redeemBlockValueCents: 100 };
let tk = 0;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof GlobalRewardsError ? e.code : (e as Error).name + ':' + (e as Error).message; } }
async function setFlag(key: string, on: boolean) {
  await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty',$2::jsonb,'boolean') on conflict (setting_key) do update set value = excluded.value`, [key, JSON.stringify(on)]);
}
const acct = async (identity = IDV) => (await q(`select available_tenths::int a, reserved_tenths::int h from global_rewards_accounts where identity_id = $1`, [identity]))[0];
const ledgerSum = async () => Number((await q(`select coalesce(sum(delta_tenths),0)::int s from global_points_ledger where identity_id = $1`, [IDV]))[0].s);
async function openTicket(t: string, b: string, cust: string, totalCents: number) {
  const ticket = id('d' + (++tk));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values ($1,$2,$3,$4,'payment_in_progress',$5)`, [ticket, t, b, cust, totalCents]);
  return ticket;
}
/** exactly what Checkout's recordRewardPaymentAtomic does: tender row + hold in ONE transaction */
async function applyReward(t: string, b: string, ticket: string, cust: string, blocks: number, dueCents: number, key: string) {
  return db.transaction().execute(async (trx: any) => {
    const pay = (await sql<{ id: string }>`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, idempotency_key)
      values (${t}::uuid, ${b}::uuid, ${ticket}::uuid, 'global_reward', ${blocks * 100}, 0, 'approved', ${'reward:' + key}) returning id`.execute(trx)).rows[0].id;
    const h = await holdForTicket(trx, repo, { tenantId: t, branchId: b, userId: OWNER, role: 'OWNER' }, { ticketId: ticket, customerId: cust, blocks, dueCents, paymentId: pay, idempotencyKey: key });
    return { ...h, paymentId: pay };
  });
}
async function payRest(t: string, b: string, ticket: string, cents: number) {
  if (cents > 0) await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',$4,0,'approved')`, [t, b, ticket, cents]);
  await q(`update tickets set status = 'paid', paid_at = now() where id = $1`, [ticket]);
}
const finalize = (t: string, ticket: string) => db.transaction().execute((trx: any) => finalizeForPaidTicket(trx, repo, { tenantId: t, ticketId: ticket, eventId: 'ev-' + ticket }));
const unbalanced = async () => Number((await q(`select count(*)::int n from (select entry_id from rewards_journal_lines group by entry_id having sum(debit_cents) <> sum(credit_cents)) x`))[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); repo = new GlobalRewardsRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','rd-a','RDA001','active'), ($2,'B','Salon B','rd-b','RDB001','active'), ($3,'C','Salon C','rd-c','RDC001','active')`, [TA, TB, TC]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'A','America/New_York'), ($3,$4,'B','America/New_York'), ($5,$6,'C','America/New_York')`, [BA, TA, BB, TB, BC, TC]);
  for (const [t, b] of [[TA, BA], [TB, BB], [TC, BC]]) {
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+16095550142','active')`, [custOf[t], t, b]);
    await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ava Kim',$3,'active','CUSTOMER')`, [id('7' + t.slice(-2)), t, `ava-${t.slice(-2)}@rd.test`]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'No','Optin','No Optin','+16095550177','active')`, [custN, TB, BB]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'No Optin','no@rd.test','active','CUSTOMER')`, [id('7ee'), TB]);
  await q(`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values ($1,'+16095550142','Ava Kim','active',now()), ($2,'+16095550177','No Optin','active',now())`, [IDV, IDN]);
  for (const t of [TA, TB, TC]) await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDV, t, id('7' + t.slice(-2)), custOf[t]]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDN, TB, id('7ee'), custN]);
  // explicit opt-in (guide §10): only IDV consented; IDN has a verified phone but never joined
  await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) values ($1,'2026-10-30','customer_app',now(),'customer_app')`, [IDV]);
  for (const k of [GR_FLAGS.engine, GR_FLAGS.earn, GR_FLAGS.purchases, GR_FLAGS.redemption]) await setFlag(k, true);
  for (const t of [TA, TB, TC]) await repo.setEnrollment(t, 'enrolled', { reason: 'pilot salon for the rewards network', actorUserId: SA });
  // Salon A funds and earns: 20 tokens, then a $1,000 sale at the global $5 = 0.5 → 100 points (10.00 tokens of backing)
  const r = await repo.createPurchase(owner(TA, BA), { tokens: 20, idempotencyKey: 'fund-salon-a-001', provider: 'sandbox' });
  await repo.movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: TA, source: 'test', providerRef: 'sbx_' + r.intentId });
  await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: TA, source: 'test' });
  const sale = id('d900');
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid',now())`, [sale, TA, BA, custOf[TA]]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',100000,0,'approved')`, [TA, BA, sale]);
  await db.transaction().execute((trx: any) => earnForTicket(trx, repo, { tenantId: TA, ticketId: sale, eventId: 'ev-sale', giftCardChargeCents: 0 }));
}, 240_000);

describe('guide §04 example: 100 points, Salon B holds 50, ticket paid, no payout provider', () => {
  let ticket = ''; let hold: any;
  it('quote: verified + opted in customer; at most what the ticket owes, in whole $1 blocks', async () => {
    expect(await acct()).toEqual({ a: 1000, h: 0 });   // 100.0 points (tenths)
    ticket = await openTicket(TB, BB, custOf[TB], 4000);
    const qt: any = await redemptionQuote(db, repo, { tenantId: TB, customerId: custOf[TB], dueCents: 4000 });
    expect(qt.available).toBe(true); expect(qt.maxBlocks).toBe(10);   // 100 points = $10 but … (due $40 → limited by points)
    const no: any = await redemptionQuote(db, repo, { tenantId: TB, customerId: custN, dueCents: 4000 });
    expect(no.available).toBe(false); expect(no.code).toBe('REWARDS_NOT_OPTED_IN');
  });
  it('Salon B holds 50 points: 50 available / 50 held; a provisional $5 tender, no payable yet', async () => {
    hold = await applyReward(TB, BB, ticket, custOf[TB], 5, 4000, 'k-b-1');
    expect(hold.pointTenths).toBe(500); expect(hold.valueCents).toBe(500);
    expect(await acct()).toEqual({ a: 500, h: 500 });
    expect((await q(`select count(*)::int n from merchant_reimbursements where tenant_id = $1`, [TB]))[0].n).toBe(0);
    // the same request key again (a retried tap) returns the same hold — no second hold, no second tender row
    const again = await db.transaction().execute((trx: any) => holdForTicket(trx, repo, { tenantId: TB, branchId: BB, userId: OWNER }, { ticketId: ticket, customerId: custOf[TB], blocks: 5, dueCents: 4000, paymentId: hold.paymentId, idempotencyKey: 'k-b-1' }));
    expect(again.replay).toBe(true); expect(await acct()).toEqual({ a: 500, h: 500 });
    expect(await code(db.transaction().execute((trx: any) => holdForTicket(trx, repo, { tenantId: TB, branchId: BB, userId: OWNER }, { ticketId: ticket, customerId: custOf[TB], blocks: 3, dueCents: 4000, paymentId: hold.paymentId, idempotencyKey: 'k-b-1' })))).toBe('IDEMPOTENCY_KEY_REUSED');
    // one live reward per ticket
    expect(await code(applyReward(TB, BB, ticket, custOf[TB], 1, 3500, 'k-b-2'))).toBe('REWARD_RESERVATION_CONFLICT');
    // extras GLOBAL LOYALTY REWARDS 06 (round 10): the open hold shows as HELD points / value on Salon B's funding-vs-liability
    expect((await repo.walletSummary(TB)).fundingVsLiability).toMatchObject({ heldRedemptions: 1, heldPointTenths: 500, heldValueCents: 500, salonPayablesOwedCents: 0 });
  });
  it('an unpaid ticket finalizes nothing; ticket paid → 50 remaining / 0 held, $5 owed to Salon B (ACCRUED_OWED), books balance', async () => {
    expect((await finalize(TB, ticket)).outcome).toBe('not_paid');
    await payRest(TB, BB, ticket, 3500);
    const f = await finalize(TB, ticket); expect(f.outcome).toBe('confirmed');
    expect(await acct()).toEqual({ a: 500, h: 0 });
    const mr = (await q(`select status, amount_cents::int amt, tenant_id from merchant_reimbursements where redemption_id = $1`, [hold.redemptionId]))[0];
    expect(mr).toEqual({ status: 'ACCRUED_OWED', amt: 500, tenant_id: TB });
    expect(await ledgerSum()).toBe(500);   // 1000 earned − 500 redeemed
    expect(await unbalanced()).toBe(0);
    // T13: accepting points never debits Salon B's token wallet
    expect((await q(`select count(*)::int n from token_wallet_ledger where tenant_id = $1`, [TB]))[0].n).toBe(0);
    // extras GLOBAL LOYALTY REWARDS 06 (round 10): Salon B's funding vs liability shows the $5 owed by the network beside a
    // wallet that funded nothing — two ledgers, side by side, never netted
    expect((await repo.walletSummary(TB)).fundingVsLiability).toMatchObject({ backedFundingCents: 0, heldRedemptions: 0, salonPayablesOpen: 1, salonPayablesOwedCents: 500, combined: false });
  });
  it('a duplicated paid-ticket event confirms nothing twice (one redemption, one payable, one ledger row)', async () => {
    expect((await finalize(TB, ticket)).outcome).toBe('none');
    expect((await q(`select count(*)::int n from merchant_reimbursements where redemption_id = $1`, [hold.redemptionId]))[0].n).toBe(1);
    expect((await q(`select count(*)::int n from global_points_ledger where source_id = $1`, [hold.redemptionId]))[0].n).toBe(1);
  });
  it('no payout provider: requestPayout refuses (BLOCKED_EXTERNAL) and the payable stays owed — never PAID', async () => {
    const mrId = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [hold.redemptionId]))[0].id;
    expect(await db.transaction().execute((trx: any) => markPayoutEligible(trx, { reimbursementId: mrId, actorUserId: SA }))).toBe(true);
    expect(await code(requestPayout(db, null, { reimbursementId: mrId, actorUserId: SA, idempotencyKey: 'po-1' }))).toBe('PAYOUT_PROVIDER_UNAVAILABLE');
    expect((await q(`select status from merchant_reimbursements where id = $1`, [mrId]))[0].status).toBe('PAYOUT_ELIGIBLE');
    // the database itself refuses a hand-written PAID (no settled payout attempt)
    expect(await code(q(`update merchant_reimbursements set status = 'PAID', provider_ref = 'manual', paid_at = now(), payout_attempt_id = gen_random_uuid() where id = $1`, [mrId]))).toMatch(/PAID requires a SETTLED payout attempt/);
  });
});

describe('concurrency, release, expiry (guide §04 failure cases, §16)', () => {
  it('Salon B and Salon C race for the same 50 points: exactly one hold succeeds, available never negative', async () => {
    const tb = await openTicket(TB, BB, custOf[TB], 5000), tc = await openTicket(TC, BC, custOf[TC], 5000);
    // PGlite is one connection, so true concurrency is proven on real Postgres (global-rewards.postgres-race "double spend");
    // here Salon B holds first and Salon C second — the second must be refused the same way.
    const settle = (p: Promise<any>): Promise<PromiseSettledResult<any>> => p.then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }));
    const res = [await settle(applyReward(TB, BB, tb, custOf[TB], 5, 5000, 'race-b')), await settle(applyReward(TC, BC, tc, custOf[TC], 5, 5000, 'race-c'))];
    const ok = res.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1);
    const failed = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as GlobalRewardsError).code).toBe('REWARDS_POINTS_INSUFFICIENT');
    expect(await acct()).toEqual({ a: 0, h: 500 });
    // the loser left no tender row behind (its transaction rolled back)
    const loserTicket = (ok[0] as PromiseFulfilledResult<any>).value && res[0].status === 'fulfilled' ? tc : tb;
    expect((await q(`select count(*)::int n from payments where ticket_id = $1 and method = 'global_reward'`, [loserTicket]))[0].n).toBe(0);
    // release the winner (cashier removed it): points back, a released hold can never be confirmed later
    const winner = (ok[0] as PromiseFulfilledResult<any>).value;
    const rel = await db.transaction().execute((trx: any) => releaseHold(trx, { tenantId: res[0].status === 'fulfilled' ? TB : TC, userId: OWNER }, { redemptionId: winner.redemptionId, to: 'RELEASED', reason: 'removed' }));
    expect(rel?.pointTenths).toBe(500); expect(await acct()).toEqual({ a: 500, h: 0 });
    const again = await db.transaction().execute((trx: any) => releaseHold(trx, { tenantId: res[0].status === 'fulfilled' ? TB : TC, userId: OWNER }, { redemptionId: winner.redemptionId, to: 'EXPIRED', reason: 'late' }));
    expect(again).toBeNull();   // one terminal action wins
  });
  it('expiry: an unpaid ticket past the deadline → EXPIRED, tender voided; a paid one is finalized; an unresolved card keeps the hold', async () => {
    const t1 = await openTicket(TC, BC, custOf[TC], 3000); const h1 = await applyReward(TC, BC, t1, custOf[TC], 1, 3000, 'exp-1');
    const t2 = await openTicket(TC, BC, custOf[TC], 3000); const h2 = await applyReward(TC, BC, t2, custOf[TC], 1, 3000, 'exp-2');
    const t3 = await openTicket(TC, BC, custOf[TC], 3000); const h3 = await applyReward(TC, BC, t3, custOf[TC], 1, 3000, 'exp-3');
    await payRest(TC, BC, t2, 2900);   // paid before the sweep — the event may simply not have run yet
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'card',2900,0,'processing')`, [TC, BC, t3]);
    const r = await expireHolds(db, new Date(Date.now() + 3600_000));
    expect(r).toEqual({ expired: 1, finalized: 1, kept: 1 });
    expect((await q(`select status from reward_redemptions where id = $1`, [h1.redemptionId]))[0].status).toBe('EXPIRED');
    expect((await q(`select status from payments where id = $1`, [h1.paymentId]))[0].status).toBe('voided');
    expect((await q(`select status from reward_redemptions where id = $1`, [h2.redemptionId]))[0].status).toBe('CONFIRMED_REDEEMED');
    expect((await q(`select status from reward_redemptions where id = $1`, [h3.redemptionId]))[0].status).toBe('HELD');
    // an expired hold is never confirmed by a late paid event
    await payRest(TC, BC, t1, 3000);
    expect((await finalize(TC, t1)).outcome).toBe('none');
    // tidy: release the protective hold once the card failed
    await q(`update payments set status = 'failed' where ticket_id = $1 and method = 'card'`, [t3]);
    expect((await expireHolds(db, new Date(Date.now() + 3600_000))).expired).toBe(1);
    const a = await acct(); expect(a.h).toBe(0); expect(a.a + a.h).toBe(await ledgerSum());
  });
});

describe('refunds and payouts (guide §05, T15)', () => {
  let mrId = ''; let pay = ''; let ticket = '';
  it('refund of the reward tender before payout: points back, payable ADJUSTED, replay changes nothing', async () => {
    ticket = await openTicket(TB, BB, custOf[TB], 2000); const h = await applyReward(TB, BB, ticket, custOf[TB], 2, 2000, 'rf-1'); pay = h.paymentId;
    await payRest(TB, BB, ticket, 1800); await finalize(TB, ticket);
    mrId = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [h.redemptionId]))[0].id;
    const before = await acct();
    const r1 = await db.transaction().execute((trx: any) => reverseRedemptionForRefund(trx, program, { tenantId: TB, rewardPaymentId: pay, refundId: 'refund-1', refundedCents: 100 }));
    expect(r1).toMatchObject({ outcome: 'reversed', cents: 100 });
    expect((await acct()).a).toBe(before.a + 100);
    expect((await q(`select status, adjusted_cents::int adj from merchant_reimbursements where id = $1`, [mrId]))[0]).toEqual({ status: 'ACCRUED_OWED', adj: 100 });
    expect((await db.transaction().execute((trx: any) => reverseRedemptionForRefund(trx, program, { tenantId: TB, rewardPaymentId: pay, refundId: 'refund-1', refundedCents: 100 }))).outcome).toBe('duplicate');
    await db.transaction().execute((trx: any) => reverseRedemptionForRefund(trx, program, { tenantId: TB, rewardPaymentId: pay, refundId: 'refund-2', refundedCents: 200 }));
    expect((await q(`select status, adjusted_cents::int adj from merchant_reimbursements where id = $1`, [mrId]))[0]).toEqual({ status: 'ADJUSTED', adj: 200 });
    expect((await q(`select status from reward_redemptions where payment_id = $1`, [pay]))[0].status).toBe('REVERSED');
    expect(await unbalanced()).toBe(0);
  });
  it('verified provider settlement is the ONLY path to PAID; mismatch → ON_HOLD + alert; a refund after payout = OFFSET claim', async () => {
    const t = await openTicket(TC, BC, custOf[TC], 1000); const h = await applyReward(TC, BC, t, custOf[TC], 1, 1000, 'po-a'); await payRest(TC, BC, t, 900); await finalize(TC, t);
    const id1 = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [h.redemptionId]))[0].id;
    await db.transaction().execute((trx: any) => markPayoutEligible(trx, { reimbursementId: id1, actorUserId: SA }));
    // a TEST adapter standing in for a future approved provider (no such provider exists in code: payoutProviderFromEnv() → null)
    const fake: PayoutProvider = { name: 'test-verified-provider', submit: async (p) => ({ status: 'SUBMITTED', providerPayoutId: 'po_' + p.attemptId }) };
    const sent: any = await requestPayout(db, fake, { reimbursementId: id1, actorUserId: SA, idempotencyKey: 'po-a-1' });
    expect(sent.status).toBe('SUBMITTED');
    expect((await q(`select status from merchant_reimbursements where id = $1`, [id1]))[0].status).toBe('PAYOUT_PENDING');
    const settle = (over: any) => db.transaction().execute((trx: any) => applyPayoutSettlement(trx, { provider: 'test-verified-provider', providerEventId: 'evt-' + Math.random(), providerPayoutId: 'po_' + sent.attemptId, outcome: 'SETTLED', settlementRef: 'stl_1', amountCents: 100, signatureVerified: true, ...over }));
    expect((await settle({ signatureVerified: false })).outcome).toBe('unverified');
    expect((await q(`select status from merchant_reimbursements where id = $1`, [id1]))[0].status).toBe('PAYOUT_PENDING');
    expect((await settle({ providerEventId: 'evt-ok' })).outcome).toBe('paid');
    expect((await q(`select status, provider_ref from merchant_reimbursements where id = $1`, [id1]))[0]).toEqual({ status: 'PAID', provider_ref: 'stl_1' });
    expect((await settle({ providerEventId: 'evt-ok' })).outcome).toBe('duplicate');
    // extras GLOBAL LOYALTY REWARDS 09 (round 10): an identical replay raises nothing; a replay CLAIMING something else (a
    // FAILED for the paid payout, another amount under a new event id) changes nothing and is raised review-first, once per event
    const alerts = async () => (await q(`select signal, severity, evidence from loyalty_fraud_alerts where signal = 'duplicate_callback' and tenant_id = $1 order by created_at`, [TC]));
    expect(await alerts()).toEqual([]);
    expect((await settle({ providerEventId: 'evt-ok', outcome: 'FAILED' })).outcome).toBe('duplicate');
    expect((await settle({ providerEventId: 'evt-ok', outcome: 'FAILED' })).outcome).toBe('duplicate');   // the same replay again: still one alert
    expect((await settle({ providerEventId: 'evt-new', amountCents: 5000 })).outcome).toBe('duplicate');
    const al = await alerts();
    expect(al.map((a: any) => [a.signal, a.severity])).toEqual([['duplicate_callback', 'high'], ['duplicate_callback', 'high']]);
    expect(al[0].evidence).toMatchObject({ providerEventId: 'evt-ok', applied: { outcome: 'SETTLED', amountCents: 100, settlementRef: 'stl_1' }, claimed: { outcome: 'FAILED' } });
    expect(al[1].evidence).toMatchObject({ providerEventId: 'evt-new', claimed: { outcome: 'SETTLED', amountCents: 5000 } });
    expect((await q(`select status, provider_ref from merchant_reimbursements where id = $1`, [id1]))[0]).toEqual({ status: 'PAID', provider_ref: 'stl_1' });   // nothing moved
    // refund after payout: recovery claim, the payout is never rewritten
    await db.transaction().execute((trx: any) => reverseRedemptionForRefund(trx, program, { tenantId: TC, rewardPaymentId: h.paymentId, refundId: 'refund-po', refundedCents: 100 }));
    expect((await q(`select status from merchant_reimbursements where id = $1`, [id1]))[0].status).toBe('OFFSET');
    expect((await q(`select kind, amount_cents::int amt from reimbursement_adjustments where reimbursement_id = $1`, [id1]))).toEqual([{ kind: 'OFFSET_CLAIM', amt: 100 }]);
    // mismatched settlement on another payable → ON_HOLD + payout_anomaly alert, never PAID
    const t2 = await openTicket(TC, BC, custOf[TC], 1000); const h2 = await applyReward(TC, BC, t2, custOf[TC], 1, 1000, 'po-b'); await payRest(TC, BC, t2, 900); await finalize(TC, t2);
    const id2 = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [h2.redemptionId]))[0].id;
    await db.transaction().execute((trx: any) => markPayoutEligible(trx, { reimbursementId: id2, actorUserId: SA }));
    const s2: any = await requestPayout(db, fake, { reimbursementId: id2, actorUserId: SA, idempotencyKey: 'po-b-1' });
    const m = await db.transaction().execute((trx: any) => applyPayoutSettlement(trx, { provider: 'test-verified-provider', providerEventId: 'evt-mm', providerPayoutId: 'po_' + s2.attemptId, outcome: 'SETTLED', settlementRef: 'stl_2', amountCents: 999, signatureVerified: true }));
    expect(m.outcome).toBe('mismatch');
    expect((await q(`select status from merchant_reimbursements where id = $1`, [id2]))[0].status).toBe('ON_HOLD');
    expect((await q(`select signal from loyalty_fraud_alerts where dedupe_key = $1`, ['payout_mismatch:' + s2.attemptId]))[0].signal).toBe('payout_anomaly');
    // a sandbox "settlement" can never satisfy the database, even written by hand
    expect(await code(q(`update payout_attempts set status = 'SETTLED', provider = 'sandbox', settlement_ref = 'x', settled_amount_cents = amount_cents, signature_verified = true, settled_at = now() where id = $1`, [s2.attemptId]))).toMatch(/ck_pa_settled_proof/);
    // Nov 3 audit: a payable put ON_HOLD while its payout was in flight, then the provider settles — never PAID, an alert for finance
    const t3 = await openTicket(TC, BC, custOf[TC], 1000); const h3 = await applyReward(TC, BC, t3, custOf[TC], 1, 1000, 'po-c'); await payRest(TC, BC, t3, 900); await finalize(TC, t3);
    const id3 = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [h3.redemptionId]))[0].id;
    await db.transaction().execute((trx: any) => markPayoutEligible(trx, { reimbursementId: id3, actorUserId: SA }));
    const s3: any = await requestPayout(db, fake, { reimbursementId: id3, actorUserId: SA, idempotencyKey: 'po-c-1' });
    await q(`update merchant_reimbursements set status = 'ON_HOLD', hold_reason = 'finance review' where id = $1`, [id3]);
    const r3 = await db.transaction().execute((trx: any) => applyPayoutSettlement(trx, { provider: 'test-verified-provider', providerEventId: 'evt-c', providerPayoutId: 'po_' + s3.attemptId, outcome: 'SETTLED', settlementRef: 'stl_3', amountCents: 100, signatureVerified: true }));
    expect(r3.outcome).toBe('mismatch');
    expect((await q(`select status from merchant_reimbursements where id = $1`, [id3]))[0].status).toBe('ON_HOLD');
    expect((await q(`select count(*)::int n from loyalty_fraud_alerts where dedupe_key = $1`, ['payout_state:' + s3.attemptId]))[0].n).toBe(1);
    expect(await unbalanced()).toBe(0);
  });
  it('points ledger = account total; flags off for redemption → no new holds, existing liabilities untouched (T23)', async () => {
    const a = await acct(); expect(a.a + a.h).toBe(await ledgerSum());
    await setFlag(GR_FLAGS.redemption, false);
    const t = await openTicket(TB, BB, custOf[TB], 1000);
    expect(await code(applyReward(TB, BB, t, custOf[TB], 1, 1000, 'off-1'))).toBe('LOYALTY_DISABLED');
    expect((await q(`select count(*)::int n from merchant_reimbursements`))[0].n).toBeGreaterThan(0);
    await setFlag(GR_FLAGS.redemption, true);
  });
});

describe('daily books check + fraud signals (guide §07, §09)', () => {
  it('a clean network: no FAILED check; owed payables without a payout provider are an UNKNOWN finding, never auto-paid', async () => {
    const { runBooksCheck, listFindings } = await import('./rewards-books-check');
    const r = await runBooksCheck(db, { trigger: 'manual', runKey: 'manual:test-clean', requestedBy: SA });
    const f = await listFindings(db, { runId: r.runId, outcome: null, pageSize: 100 });
    const byCheck = Object.fromEntries((await q(`select check_type, outcome from rewards_recon_findings where run_id = $1`, [r.runId])).map((x: any) => [x.check_type, x.outcome]));
    expect(byCheck.journal_balanced).toBe('PASS'); expect(byCheck.points_projection).toBe('PASS'); expect(byCheck.wallet_projection).toBe('PASS');
    expect(byCheck.liability_vs_points).toBe('PASS'); expect(byCheck.payables_vs_journal).toBe('PASS'); expect(byCheck.payouts_settled).toBe('PASS');
    expect(byCheck.redemptions_paid).toBe('PASS'); expect(byCheck.funding_purchases).toBe('PASS'); expect(byCheck.earn_backing).toBe('PASS');
    expect(byCheck.payout_provider).toBe('UNKNOWN');
    expect(r.status).toBe('UNKNOWN'); expect(f.items.every((x: any) => x.outcome !== 'FAILED')).toBe(true);
  });
  it('the same run key never runs twice; the daily job catches up missed days and shares the manual checker', async () => {
    const { runBooksCheck, dailyBooksCheck } = await import('./rewards-books-check');
    const a = await runBooksCheck(db, { trigger: 'scheduled', runKey: 'daily:2026-10-29', cutoff: new Date('2026-10-29T04:00:00Z') });
    const b = await runBooksCheck(db, { trigger: 'scheduled', runKey: 'daily:2026-10-29', cutoff: new Date('2026-10-29T04:00:00Z') });
    expect(b.replay).toBe(true); expect(b.runId).toBe(a.runId);
    const d = await dailyBooksCheck(db, new Date('2026-10-31T15:00:00Z'));
    expect(d.ran).toEqual(['2026-10-28', '2026-10-30', '2026-10-31']);   // 29th already ran
    expect((await dailyBooksCheck(db, new Date('2026-10-31T16:00:00Z'))).ran).toEqual([]);
  });
  it('a tampered wallet is detected (FAILED + platform alert); nothing is auto-corrected', async () => {
    const { runBooksCheck } = await import('./rewards-books-check');
    await q(`update tenant_token_wallets set available_cents = available_cents + 123 where tenant_id = $1`, [TA]);
    const r = await runBooksCheck(db, { trigger: 'manual', runKey: 'manual:tamper', requestedBy: SA });
    expect(r.status).toBe('FAILED');
    const f = (await q(`select outcome, tenant_id, delta_cents::int d from rewards_recon_findings where run_id = $1 and check_type = 'wallet_projection'`, [r.runId]))[0];
    expect(f).toEqual({ outcome: 'FAILED', tenant_id: TA, d: 123 });
    expect((await q(`select severity from alerts where dedupe_key = $1`, ['rewards_books:manual:tamper']))[0].severity).toBe('critical');
    expect(Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [TA]))[0].available_cents) % 1000).not.toBe(0);   // still tampered: no silent fix
    await q(`update tenant_token_wallets set available_cents = available_cents - 123 where tenant_id = $1`, [TA]);   // test cleanup only
  });
  it('fraud signals are review-first: concurrent cross-salon holds raise an alert with evidence; points untouched', async () => {
    const { detectFraud, listFraudAlerts, reviewFraudAlert } = await import('./rewards-books-check');
    const before = await acct();
    await detectFraud(db);
    const al = await listFraudAlerts(db, {});
    const ccs = al.items.find((x: any) => x.signal === 'concurrent_cross_salon');
    expect(ccs).toBeTruthy(); expect(ccs.customerRef).toMatch(/^C-/); expect(ccs.evidence.redemptionIds.length).toBe(2);
    expect(await acct()).toEqual(before);
    const reviewed = await reviewFraudAlert(db, { alertId: ccs.id, to: 'DISMISSED', note: 'Same customer, two visits on one day', actorUserId: SA });
    expect(reviewed?.status).toBe('DISMISSED');
    expect((await q(`select action_type from audit_logs where entity_id = $1`, [ccs.id]))[0].action_type).toBe('loyalty.fraud_alert_reviewed');
  });
});

describe('LoyaltyRules §8.2 — T13 exactly as written', () => {
  it('T13 customer earns 20 points at a CUSTOM salon (C: $10 = 2) and redeems $2 at a GLOBAL salon (A): A gets ONE $2 payable and no token debit for accepting', async () => {
    await setFlag(GR_FLAGS.customEarning, true);
    await repo.activateCustom(owner(TC, BC), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 });
    const r = await repo.createPurchase(owner(TC, BC), { tokens: 5, idempotencyKey: 'fund-salon-c-t13', provider: 'sandbox' });
    await repo.movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: TC, source: 'test', providerRef: 'sbx_' + r.intentId });
    await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: TC, source: 'test' });
    const sale = id('d950');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid',now())`, [sale, TC, BC, custOf[TC]]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',10000,0,'approved')`, [TC, BC, sale]);
    const before = await acct();
    await db.transaction().execute((trx: any) => earnForTicket(trx, repo, { tenantId: TC, ticketId: sale, eventId: 'ev-t13', giftCardChargeCents: 0 }));
    const e = (await q(`select rule_source, point_tenths::int p, backing_cents::int b from reward_earn_transactions where ticket_id = $1`, [sale]))[0];
    expect(e).toEqual({ rule_source: 'TENANT_OVERRIDE', p: 200, b: 200 });   // 20 points, 2.00 tokens from C
    expect((await acct()).a).toBe(before.a + 200);
    const walletA0 = Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [TA]))[0].available_cents);
    const ledA0 = (await q(`select count(*)::int n from token_wallet_ledger where tenant_id = $1`, [TA]))[0].n;
    const t = await openTicket(TA, BA, custOf[TA], 3000); const h = await applyReward(TA, BA, t, custOf[TA], 2, 3000, 't13-a'); await payRest(TA, BA, t, 2800); await finalize(TA, t);
    expect((await q(`select tenant_id, amount_cents::int amt, status from merchant_reimbursements where redemption_id = $1`, [h.redemptionId]))).toEqual([{ tenant_id: TA, amt: 200, status: 'ACCRUED_OWED' }]);
    expect(Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [TA]))[0].available_cents)).toBe(walletA0);
    expect((await q(`select count(*)::int n from token_wallet_ledger where tenant_id = $1`, [TA]))[0].n).toBe(ledA0);
    expect(await unbalanced()).toBe(0);
    // extras Global Loyalty Rewards 02 (Money Flow Explorer): the redemption traces to the token-backed earning at C, the hold on
    // A's ticket, A's payable (no payout yet) and its journal entries — read-only, stable references, no customer identity
    const { lineage } = await import('./rewards-books-check');
    const ln: any = await lineage(db, h.redemptionId);
    expect(ln.redemption).toMatchObject({ id: h.redemptionId, redeemingSalonId: TA, ticketId: t, valueCents: 200, status: 'CONFIRMED_REDEEMED' });
    expect(ln.funding.find((f: any) => f.earningSalonId === TC)).toMatchObject({ pointTenths: 200, backingCents: 200, ruleSource: 'TENANT_OVERRIDE' });
    expect(ln.payable).toMatchObject({ status: 'ACCRUED_OWED', amountCents: 200, adjustedCents: 0 });
    expect(ln.payouts).toEqual([]);
    expect(ln.journal.length).toBeGreaterThan(0);
    expect(ln.journal.every((j: any) => j.source.startsWith('reward_redemptions:' + h.redemptionId))).toBe(true);
    expect(JSON.stringify(ln)).not.toContain(IDV);   // the customer's identity id never leaves
  });
});

// C1 audit (Nov 4 2026) §4.4: Super Admin pauses a suspected compromised account — redeeming stops; lifting it restores it
describe('Super Admin suspends a rewards account', () => {
  it('suspended → no redemption quote; reason required; reactivate restores; audited', async () => {
    const svc = new GlobalRewardsService(repo, null, null);
    expect(await code(svc.setAccountStatus(IDV, 'suspended', 'short', SA))).toBe('VALIDATION_FAILED');
    expect(await svc.setAccountStatus(IDV, 'suspended', 'Phone number reported stolen', SA)).toEqual({ identityId: IDV, status: 'suspended' });
    const t = await openTicket(TB, BB, custOf[TB], 4000);
    expect(t).toBeTruthy();
    const no: any = await redemptionQuote(db, repo, { tenantId: TB, customerId: custOf[TB], dueCents: 4000 });
    expect(no.available).toBe(false);
    expect(await code(svc.setAccountStatus(IDV, 'suspended', 'Phone number reported stolen', SA))).toBe('EARNING_POLICY_CONFLICT');
    const alertId = (await q(`insert into loyalty_fraud_alerts (signal, severity, confidence, dedupe_key, identity_id, evidence) values ('unusual_spend', 'high', 0.9, 'c1-test-' || $1::text, $1::uuid, '{}'::jsonb) returning id`, [IDV]))[0].id;
    expect(await svc.setAccountStatusForAlert(alertId, 'active', 'Owner confirmed the phone is back', SA)).toEqual({ alertId, status: 'active' });
    expect(((await redemptionQuote(db, repo, { tenantId: TB, customerId: custOf[TB], dueCents: 4000 })) as any).available).toBe(true);
    const acts = (await q(`select action_type from audit_logs where entity_id::text = $1 order by created_at`, [IDV])).map((r: any) => String(r.action_type));
    expect(acts.some((a: string) => a.endsWith('account_suspended'))).toBe(true); expect(acts.some((a: string) => a.endsWith('account_reactivated'))).toBe(true);
  });
});

// C1 audit (Nov 4 2026) §4.3: the expected earning shown at Checkout before payment (never a write)
describe('earning estimate at checkout', () => {
  it('a verified, opted-in customer sees what the sale would earn; no customer / not joined → unavailable', async () => {
    const before = Number((await q(`select count(*)::int n from reward_earn_transactions`))[0].n);
    const e: any = await earnEstimate(db, repo, { tenantId: TB, customerId: custOf[TB], eligibleCents: 10000 });
    const r: any = (await repo.resolveEarningRule(db, TB, new Date()) as any).rule;
    expect(e).toMatchObject({ available: true, estimate: true, eligibleCents: 10000, pointTenths: Math.floor(10000 / r.spendIncrementCents) * r.pointTenthsPerIncrement });
    expect(await earnEstimate(db, repo, { tenantId: TB, customerId: null, eligibleCents: 10000 })).toEqual({ available: false, reason: 'no_customer' });
    expect(await earnEstimate(db, repo, { tenantId: TB, customerId: custN, eligibleCents: 10000 })).toEqual({ available: false, reason: 'not_opted_in' });
    expect(Number((await q(`select count(*)::int n from reward_earn_transactions`))[0].n)).toBe(before);
  });
});

describe("extras GLOBAL LOYALTY REWARDS 07 + 10 — the salon's own reimbursements: drill-down evidence + stale-provider indicator", () => {
  it('each payable says its stage and why, with provider attempts, adjustments and journal lines; waiting vs unknown provider answers; own salon only; writes nothing', async () => {
    const { salonPayables } = await import('./rewards-salon-payables');
    // two more payouts at Salon C: one the provider accepted (still waiting for settlement), one with NO answer (UNKNOWN)
    const mk = async (key: string) => {
      const t = await openTicket(TC, BC, custOf[TC], 1000); const h = await applyReward(TC, BC, t, custOf[TC], 1, 1000, key); await payRest(TC, BC, t, 900); await finalize(TC, t);
      const pid = (await q(`select id from merchant_reimbursements where redemption_id = $1`, [h.redemptionId]))[0].id;
      await db.transaction().execute((trx: any) => markPayoutEligible(trx, { reimbursementId: pid, actorUserId: SA }));
      return pid as string;
    };
    const waitingId = await mk('sp-wait'); const unknownId = await mk('sp-unknown');
    await requestPayout(db, { name: 'test-verified-provider', submit: async (p) => ({ status: 'SUBMITTED', providerPayoutId: 'po_' + p.attemptId }) }, { reimbursementId: waitingId, actorUserId: SA, idempotencyKey: 'sp-wait-1' });
    await requestPayout(db, { name: 'test-verified-provider', submit: async () => { throw new Error('timeout'); } }, { reimbursementId: unknownId, actorUserId: SA, idempotencyKey: 'sp-unknown-1' });
    // a paid ticket whose reward hold was never confirmed (the paid-ticket step did not run): an unreconciled exception
    // (fixture: the customer has no points left, so the left-behind hold row is written directly — it is what the queue reads)
    const tu = await openTicket(TC, BC, custOf[TC], 1000); await payRest(TC, BC, tu, 1000);
    const hu = { redemptionId: (await q(`insert into reward_redemptions (tenant_id, branch_id, ticket_id, identity_id, point_tenths, value_cents, status, idempotency_key, expires_at)
      values ($1,$2,$3,$4,100,100,'HELD','sp-unrec',now() + interval '1 hour') returning id`, [TC, BC, tu, IDV]))[0].id as string };
    const snap = async () => q(`select id, status, version from merchant_reimbursements order by id`);
    const before = await snap();

    const r = await salonPayables(db, TC, { pageSize: 25 }, false);
    expect(r.provider).toEqual({ connected: false, state: 'BLOCKED_EXTERNAL' });
    expect(r.settlement.lastVerifiedAt).not.toBeNull();             // the one verified settlement (stl_1)
    // waiting = attempts the provider accepted but never settled: the new one + the earlier mismatched one (its payable is ON_HOLD,
    // its attempt is still SUBMITTED — the provider's amount did not match, so nothing settled)
    expect(r.settlement.waitingOnProvider).toBe(2);
    expect(r.settlement.unknownAnswer).toBe(1);
    expect(r.settlement.oldestUnknownSince).not.toBeNull();
    const byId = Object.fromEntries(r.items.map((x) => [x.id, x]));
    expect(byId[waitingId]).toMatchObject({ status: 'PAYOUT_PENDING', stage: 'PROCESSING', why: 'pending_provider_answer' });
    expect(byId[unknownId]).toMatchObject({ status: 'PAYOUT_PENDING', stage: 'PROCESSING', why: 'pending_provider_unknown' });
    expect(byId[unknownId].attempts[0]).toMatchObject({ status: 'UNKNOWN', failureCode: 'PROVIDER_NO_ANSWER', settlementRef: null });
    // the paid-then-refunded payable: settled attempt with its reference, the offset claim, and the salon-side journal lines
    const paid = r.items.find((x) => x.attempts.some((a) => a.settlementRef === 'stl_1'))!;
    expect(paid).toMatchObject({ status: 'OFFSET', stage: 'CLOSED', why: 'offset_refund_after_payout', settlementRef: 'stl_1', owedCents: 100 });
    expect(paid.attempts[0]).toMatchObject({ status: 'SETTLED', signatureVerified: true, amountCents: 100 });
    expect(paid.adjustments).toEqual([expect.objectContaining({ kind: 'OFFSET_CLAIM', amountCents: 100 })]);
    expect(paid.journal.map((j) => [j.entryType, j.account, j.debitCents, j.creditCents])).toEqual([
      ['redemption_committed', 'reimbursement_payable', 0, 100], ['reimbursement_paid', 'reimbursement_payable', 100, 0], ['reimbursement_offset', 'merchant_recovery_receivable', 100, 0]]);
    // the mismatched settlement is an exception with its hold reason, never PAID
    const held = r.items.filter((x) => x.status === 'ON_HOLD');
    expect(held.length).toBe(2); expect(held.every((x) => x.stage === 'EXCEPTION' && x.why === 'on_hold_finance_review' && !!x.holdReason)).toBe(true);
    // totals per status agree with the rows; status filter
    expect(r.totals.reduce((s, t) => s + t.count, 0)).toBe(r.total);
    const onHold = await salonPayables(db, TC, { status: 'ON_HOLD' }, false);
    expect(onHold.total).toBe(2); expect(onHold.items.every((x) => x.status === 'ON_HOLD')).toBe(true);
    // own salon only: B sees none of C's payables or attempts; A has none and no verified settlement
    const b = await salonPayables(db, TB, { pageSize: 25 }, false);
    expect(b.items.some((x) => byId[x.id])).toBe(false);
    expect(b.settlement).toMatchObject({ lastVerifiedAt: null, waitingOnProvider: 0, unknownAnswer: 0 });
    expect(b.items.find((x) => x.status === 'PAYOUT_ELIGIBLE')).toMatchObject({ stage: 'PAYABLE', why: 'eligible_no_provider', owedCents: 500 });
    expect(b.items.find((x) => x.status === 'ADJUSTED')).toMatchObject({ stage: 'CLOSED', why: 'adjusted_refund_before_payout', owedCents: 0 });
    const a = await salonPayables(db, TA, {}, false);   // T13: A accepted $2 and has one owed payable
    expect(a.items).toEqual([expect.objectContaining({ status: 'ACCRUED_OWED', stage: 'PAYABLE', why: 'owed_no_provider', owedCents: 200, attempts: [] })]);
    expect(a.items.some((x) => byId[x.id])).toBe(false);
    // extras Global Loyalty Rewards 07: the exception queue — expired holds (the two from the expiry test), the unreconciled paid
    // ticket, and the disputed reversal (the payout that was refunded after it was paid → OFFSET claim of $1.00)
    const xq = r.exceptionQueue;
    expect(xq.expiredHolds.count).toBe(2); expect(xq.expiredHolds.items.every((x) => x.valueCents === 100 && !!x.at)).toBe(true);
    expect(xq.unreconciledPaid).toEqual({ count: 1, items: [expect.objectContaining({ redemptionId: hu.redemptionId, ticketId: tu, valueCents: 100 })] });
    expect(xq.disputedReversals.items.find((x) => x.payableId === paid.id)).toMatchObject({ status: 'OFFSET', reversedCents: 100 });
    expect(b.exceptionQueue.unreconciledPaid.count).toBe(0);
    expect(b.exceptionQueue.expiredHolds.items.some((x) => xq.expiredHolds.items.some((y) => y.redemptionId === x.redemptionId))).toBe(false);
    expect(await snap()).toEqual(before);   // read-only
  });
  it('extras GLOBAL LOYALTY REWARDS 16: the owner finance export — purchases, allocations, payables with exception flags, source ids, rule and date basis; audited; another salon sees none', async () => {
    const svc = new GlobalRewardsService(repo, null, null);
    const today = (await q(`select to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD') d`))[0].d as string;
    const before = await q(`select id, status, version from merchant_reimbursements order by id`);
    const out: any = await svc.financeExport(owner(TC, BC), { from: '2026-01-01', to: today });
    expect(out.format).toBe('csv'); expect(out.filename).toBe(`rewards-network-finance-2026-01-01-to-${today}.csv`);
    const [head, ...lines] = out.csv.trim().split('\n');
    expect(head).toBe('record_type,record_id,occurred_at_utc,salon_day,date_basis,status,exception,amount_usd,balance_after_usd,source_table,source_id,rule,provider_ref_last6,note');
    expect(lines.length).toBe(out.rows);
    const cols = (l: string) => l.split(',');
    const nPay = Number((await q(`select count(*)::int n from merchant_reimbursements where tenant_id = $1`, [TC]))[0].n);
    const nPur = Number((await q(`select count(*)::int n from token_purchase_intents where tenant_id = $1`, [TC]))[0].n);
    const nLed = Number((await q(`select count(*)::int n from token_wallet_ledger where tenant_id = $1`, [TC]))[0].n);
    expect(out.counts).toMatchObject({ payables: nPay, purchases: nPur, allocations: nLed });
    const pay = lines.filter((l: string) => l.startsWith('reimbursement_payable,'));
    expect(pay.length).toBe(nPay);
    // ON_HOLD and OFFSET are exceptions; a pending payout is not
    expect(pay.filter((l: string) => cols(l)[5] === 'ON_HOLD').every((l: string) => cols(l)[6] === 'yes')).toBe(true);
    expect(pay.filter((l: string) => cols(l)[5] === 'PAYOUT_PENDING').every((l: string) => cols(l)[6] === 'no')).toBe(true);
    expect(out.counts.exceptions).toBe(pay.filter((l: string) => cols(l)[6] === 'yes').length + lines.filter((l: string) => l.startsWith('token_purchase,') && cols(l)[6] === 'yes').length);
    // the settled payable keeps only the last 6 of its settlement reference; source = its redemption
    const settled = pay.find((l: string) => l.includes('last_payout_attempt=SETTLED') && cols(l)[5] === 'OFFSET')!;
    expect(cols(settled)[12]).toBe('stl_1'); expect(cols(settled)[9]).toBe('reward_redemptions');
    // a points-funded allocation names the custom rule that applied (T13: Salon C on a custom rule)
    const alloc = lines.find((l: string) => l.startsWith('wallet_earn_allocation,'))!;
    expect(cols(alloc)[9]).toBe('reward_earn_transactions'); expect(cols(alloc)[11]).toMatch(/^TENANT_OVERRIDE:[0-9a-f-]{36}$/);
    expect(cols(alloc)[4]).toBe('created (America/New_York)');
    expect(cols(alloc)[3]).toBe(today);
    // audited, nothing else written; another salon's export holds none of C's rows; a day range before any activity is empty
    const au = await q(`select metadata from audit_events where tenant_id = $1 and module = 'loyalty' and action = 'network_finance_exported'`, [TC]);
    expect(au.length).toBe(1); expect(au[0].metadata).toMatchObject({ rows: out.rows, payables: nPay, timeZone: 'America/New_York' });
    expect(await q(`select id, status, version from merchant_reimbursements order by id`)).toEqual(before);
    const other: any = await svc.financeExport(owner(TB, BB), { from: '2026-01-01', to: today });
    const cIds = new Set(pay.map((l: string) => cols(l)[1]));
    expect(other.csv.split('\n').some((l: string) => cIds.has(cols(l)[1] ?? ''))).toBe(false);
    expect((await svc.financeExport(owner(TC, BC), { from: '2020-01-01', to: '2020-01-31' })).rows).toBe(0);
    await expect(svc.financeExport(owner(TC, BC), { from: today, to: '2020-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('extras GLOBAL LOYALTY REWARDS 12 (round 10) — employee self-awards are queued for review', () => {
  it('points earned at a salon where a staff member has the same phone raise ONE review-first alert with evidence; nothing changes on the account', async () => {
    const { detectFraud, listFraudAlerts } = await import('./rewards-books-check');
    const earnA = (await q(`select id from reward_earn_transactions where tenant_id = $1 and identity_id = $2 and status = 'EARNED' order by created_at limit 1`, [TA, IDV]))[0]?.id;
    expect(earnA).toBeTruthy();
    const before = await acct();
    expect((await listFraudAlerts(db, {})).items.filter((x: any) => x.signal === 'employee_self_award')).toHaveLength(0);
    // a technician at Salon A with the earning identity's phone; a customer-role user with that phone elsewhere is NOT staff
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, is_active, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+16095550142',true,'active')`, [id('ad1'), TA, BA]);
    await q(`update users set normalized_phone = '+16095550142' where id = $1`, [id('7' + TB.slice(-2))]);
    await detectFraud(db);
    const al = (await listFraudAlerts(db, {})).items.filter((x: any) => x.signal === 'employee_self_award');
    expect(al.length).toBeGreaterThanOrEqual(1);
    const mine = al.find((x: any) => x.evidence?.earnId === earnA);
    expect(mine).toBeTruthy(); expect(mine.evidence.matchedStaff).toEqual(['technician']); expect(mine.evidence.pointTenths).toBeGreaterThan(0);
    expect(al.every((x: any) => x.evidence.matchedStaff.length > 0)).toBe(true);
    await detectFraud(db);   // deduplicated by evidence: the same earn never raises twice
    expect((await listFraudAlerts(db, {})).items.filter((x: any) => x.signal === 'employee_self_award' && x.evidence?.earnId === earnA)).toHaveLength(1);
    expect(await acct()).toEqual(before);
  });
});


describe('extras GLOBAL LOYALTY REWARDS 14 (round 10) — rule-change simulator: old vs new funding exposure', () => {
  it('re-prices the last 30 days of GLOBAL-rule sales with the same earn function under the rule in force and the proposed one; writes nothing', async () => {
    const { computeEarn } = await import('./global-rewards-core');
    const program = await repo.program();
    const current = (await repo.globalRuleAt(db, new Date()))!;
    expect(current).toBeTruthy();
    const rows = await q(`select eligible_cents::int as e from reward_earn_transactions where rule_source = 'GLOBAL_DEFAULT' and status in ('EARNED','NOT_ELIGIBLE','BLOCKED_INSUFFICIENT_TOKENS','PARTIALLY_REVERSED') and effective_at >= now() - interval '30 days'`);
    expect(rows.length).toBeGreaterThan(0);
    const same = await repo.globalExposure(current, current, program);
    expect(same).toMatchObject({ days: 30, sales: rows.length, differenceCents: 0 });
    expect(same.currentBackingCents).toBe(rows.reduce((a: number, r: any) => a + computeEarn(r.e, current, program).backingCents, 0));
    const richer = { ...current, pointTenthsPerIncrement: current.pointTenthsPerIncrement * 2 };
    const ex = await repo.globalExposure(current, richer, program);
    expect(ex.proposedBackingCents).toBe(rows.reduce((a: number, r: any) => a + computeEarn(r.e, richer, program).backingCents, 0));
    expect(ex.proposedBackingCents).toBeGreaterThanOrEqual(ex.currentBackingCents);
    expect(ex.differenceCents).toBe(ex.proposedBackingCents - ex.currentBackingCents);
    // through the Super Admin preview: the exposure rides with the $5–$100 rows and the salon impact; nothing written
    const before = (await q(`select count(*)::int n from global_earning_rule_versions`))[0].n;
    const svc = new GlobalRewardsService(repo, null, null);
    const pv: any = await svc.previewGlobal({ spendIncrementCents: current.spendIncrementCents, pointTenthsPerIncrement: current.pointTenthsPerIncrement, minEligibleCents: current.minEligibleCents, perTicketCapTenths: current.perTicketCapTenths });
    expect(pv.exposure).toMatchObject({ days: 30, differenceCents: 0, sales: rows.length });
    expect((await q(`select count(*)::int n from global_earning_rule_versions`))[0].n).toBe(before);
  });
});

describe('extras GLOBAL LOYALTY REWARDS 11 (round 10) — idempotency conflict center', () => {
  it('a re-sent purchase key is recorded as a replay (same purchase, no second intent); a reused key for a different purchase as a conflict; the log is append-only', async () => {
    const { listIdempotencyEvents } = await import('./super-admin-idempotency.repository');
    const intents0 = (await q(`select count(*)::int n from token_purchase_intents where tenant_id = $1`, [TB]))[0].n;
    const a = await repo.createPurchase(owner(TB, BB), { tokens: 5, idempotencyKey: 'idem-center-key-001', provider: 'sandbox' });
    const b = await repo.createPurchase(owner(TB, BB), { tokens: 5, idempotencyKey: 'idem-center-key-001', provider: 'sandbox' });
    expect(b.intentId).toBe(a.intentId);
    await expect(repo.createPurchase(owner(TB, BB), { tokens: 7, idempotencyKey: 'idem-center-key-001', provider: 'sandbox' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await q(`select count(*)::int n from token_purchase_intents where tenant_id = $1`, [TB]))[0].n).toBe(intents0 + 1);
    const all = await listIdempotencyEvents(db, {});
    const mine = all.items.filter((x) => x.tenantId === TB && x.scope === 'token_purchase');
    expect(mine.map((x) => x.outcome).sort()).toEqual(['conflict', 'replay']);
    expect(mine.every((x) => x.keyRef === '…'.concat('-key-001') && x.repeats === 2 && x.resourceId === a.intentId)).toBe(true);
    expect(mine.find((x) => x.outcome === 'conflict')!.detail).toMatchObject({ repeatedTokenCents: 700 });
    expect((await listIdempotencyEvents(db, { outcome: 'conflict' })).items.every((x) => x.outcome === 'conflict')).toBe(true);
    expect(all.conflicts).toBeGreaterThanOrEqual(1);
    await expect(q(`update rewards_idempotency_events set outcome = 'replay'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from rewards_idempotency_events`)).rejects.toThrow(/append-only/);
  });
});

// extras GLOBAL LOYALTY REWARDS 14 (round 10): the network state carries per-feature readiness read from the real configuration
describe('Readiness Control Center', () => {
  it('with no funding or payout provider connected, Buy Tokens and salon payouts are BLOCKED_EXTERNAL; earning / redemption follow the flags', async () => {
    const st: any = await new GlobalRewardsService(repo, null, null).state({ tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.view', 'pos.settings.edit'] });
    const by = Object.fromEntries(st.readiness.map((f: any) => [f.feature, f]));
    expect(Object.keys(by).sort()).toEqual(['custom_earning', 'earning', 'redemption', 'salon_payouts', 'token_purchases']);
    expect(by.token_purchases).toEqual({ feature: 'token_purchases', state: 'BLOCKED_EXTERNAL', evidence: ['no_funding_provider_connected'] });
    expect(by.salon_payouts.state).toBe('BLOCKED_EXTERNAL');
    expect(by.earning.state).toBe(st.flags.engine && st.flags.earn && !st.program.earnPaused && st.enrollment.status === 'enrolled' ? 'PRODUCTION_READY' : 'CODE_READY');
    expect(st.funding).toEqual({ provider: null, sandbox: false, available: false });
  });
});
