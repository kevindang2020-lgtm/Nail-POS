// global-rewards-engine.pgtest — the Global Rewards Network engine on the REAL schema (migration 733):
// LoyaltyRules.pdf T01–T12, T19, T24 and the LoyaltyTokens.pdf §13.1 funding / earning matrix.
// Salons: A (global), B (custom), C (global, short wallet). One verified, opted-in customer identity linked to all
// three; one unverified identity (phone only matched, never proven) that must never earn.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalRewardsRepository, type GrCtx } from './global-rewards.repository';
import { earnForTicket, reverseEarnForRefund, TenantMismatchError } from './rewards-earn';
import { GlobalRewardsError } from './global-rewards-core';
import { GR_FLAGS } from './global-rewards-flags';
import { collectFindings } from './rewards-books-check';

const P = 'd7330000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), TC = id('a3'), TX = id('a9');
const BA = id('b1'), BB = id('b2'), BC = id('b3'), BX = id('b9');
const OWNER = id('e1');
const IDV = id('f1'), IDU = id('f2');
const owner = (t: string, b: string, perms = ['pos.settings.edit', 'pos.customers.view']): GrCtx => ({ tenantId: t, branchId: b, userId: OWNER, role: 'OWNER', permissions: perms });
let pg: any; let db: any; let repo: GlobalRewardsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const custOf: Record<string, string> = { [TA]: id('c1'), [TB]: id('c2'), [TC]: id('c3'), [TX]: id('c9') };
const custU = id('c4');
let tk = 0;
async function paidTicket(t: string, b: string, cust: string | null, paidCents: number, paidAt = new Date(), extra: { tax?: number; tip?: number } = {}) {
  const ticket = id('d' + (++tk));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, tax_cents, tip_cents) values ($1,$2,$3,$4,'paid',$5,$6,$7)`, [ticket, t, b, cust, paidAt.toISOString(), extra.tax ?? 0, extra.tip ?? 0]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',$4,$5,'approved')`, [t, b, ticket, paidCents, extra.tip ?? 0]);
  return ticket;
}
const earn = (t: string, ticket: string, gc = 0) => db.transaction().execute((trx: any) => earnForTicket(trx, repo, { tenantId: t, ticketId: ticket, eventId: 'ev-' + ticket, giftCardChargeCents: gc }));
const wallet = async (t: string) => Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [t]))[0]?.available_cents ?? 0);
const points = async () => Number((await q(`select available_tenths from global_rewards_accounts where identity_id = $1`, [IDV]))[0]?.available_tenths ?? 0);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof GlobalRewardsError ? e.code : (e as Error).name + ':' + (e as Error).message; } }
async function setFlag(key: string, on: boolean) {
  await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty',$2::jsonb,'boolean')
    on conflict (setting_key) do update set value = excluded.value`, [key, JSON.stringify(on)]);
}
async function fund(t: string, b: string, tokens: number) {
  const r = await repo.createPurchase(owner(t, b), { tokens, idempotencyKey: 'fund-' + t + '-' + tokens + '-' + Math.random(), provider: 'sandbox' });
  await repo.movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: t, source: 'test', providerRef: 'sbx_' + r.intentId });
  await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: t, source: 'test' });
  return r.intentId;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); repo = new GlobalRewardsRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
    ($1,'A','Salon A','gr-a','GRA001','active'), ($2,'B','Salon B','gr-b','GRB001','active'), ($3,'C','Salon C','gr-c','GRC001','active'), ($4,'X','Salon X','gr-x','GRX001','active')`, [TA, TB, TC, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'A','America/New_York'), ($3,$4,'B','America/New_York'), ($5,$6,'C','America/New_York'), ($7,$8,'X','America/New_York')`, [BA, TA, BB, TB, BC, TC, BX, TX]);
  for (const [t, b] of [[TA, BA], [TB, BB], [TC, BC], [TX, BX]]) {
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+16095550142','active')`, [custOf[t], t, b]);
    await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ava Kim',$3,'active','CUSTOMER')`, [id('7' + t.slice(-2)), t, `ava-${t.slice(-2)}@gr.test`]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Bo','Lee','Bo Lee','+16095550199','active')`, [custU, TA, BA]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Bo Lee','bo@gr.test','active','CUSTOMER')`, [id('7ff'), TA]);
  await q(`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values ($1,'+16095550142','Ava Kim','active',now()), ($2,'+16095550199','Bo Lee','active',NULL)`, [IDV, IDU]);
  for (const t of [TA, TB, TC]) await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDV, t, id('7' + t.slice(-2)), custOf[t]]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDU, TA, id('7ff'), custU]);
  await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) values ($1,'2026-10-30','customer_app',now(),'customer_app'), ($2,'2026-10-30','customer_app',now(),'customer_app')`, [IDV, IDU]);
  for (const k of [GR_FLAGS.engine, GR_FLAGS.earn, GR_FLAGS.purchases, GR_FLAGS.customEarning]) await setFlag(k, true);
  for (const t of [TA, TB, TC]) await repo.setEnrollment(t, 'enrolled', { reason: 'pilot salon for the rewards network', actorUserId: OWNER });
}, 240_000);

describe('rule resolution — addendum T01, T02, T19, T03/T04, T05, T06, T07, T24', () => {
  it('T01 an enrolled salon with no override inherits the live global default', async () => {
    const r = await repo.resolveEarningRule(db, TA, new Date());
    expect(r).toMatchObject({ ok: true, rule: { source: 'GLOBAL_DEFAULT', spendIncrementCents: 500, pointTenthsPerIncrement: 5 } });
    const v = await repo.policyView(owner(TA, BA));
    expect(v).toMatchObject({ mode: 'GLOBAL', effective: { sourceLabel: 'AI PowerSalon Global Default', rateLabel: '$5.00 = 0.5 points' } });
    expect((await q(`select count(*)::int as n from tenant_earning_policy_versions where tenant_id = $1`, [TA]))[0].n).toBe(0);   // no per-tenant copy
  });
  it('T02 a saved draft never changes the effective rule', async () => {
    const d = await repo.saveDraft(owner(TB, BB), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 });
    expect((await repo.resolveEarningRule(db, TB, new Date()) as any).rule.source).toBe('GLOBAL_DEFAULT');
    expect((await repo.policyView(owner(TB, BB))).drafts.map((x: any) => x.id)).toEqual([d.draftId]);
  });
  it('T19 custom flag OFF refuses edits and activation; a receptionist (no settings.edit) is refused', async () => {
    await setFlag(GR_FLAGS.customEarning, false);
    expect(await code(repo.activateCustom(owner(TB, BB), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 }))).toBe('CUSTOM_EARNING_DISABLED');
    expect(await code(repo.saveDraft(owner(TB, BB), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 }))).toBe('CUSTOM_EARNING_DISABLED');
    await setFlag(GR_FLAGS.customEarning, true);
    expect(await code(repo.activateCustom(owner(TB, BB, ['pos.customers.view']), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 }))).toBe('PERMISSION_DENIED');
    // a real session carries the role's grants UN-prefixed ('settings.edit'): the platform rule still grants pos.settings.edit
    expect((await repo.policyView(owner(TB, BB, ['settings.edit', 'customers.view']))).permissions.canEdit).toBe(true);
    expect((await repo.policyView(owner(TB, BB, ['customers.view']))).permissions.canEdit).toBe(false);
  });
  it('T03/T04 B activates $10 = 2 from its draft; A stays global', async () => {
    const d = (await repo.policyView(owner(TB, BB))).drafts[0];
    const r = await repo.activateCustom(owner(TB, BB), { draftId: d.id });
    expect(r).toMatchObject({ scheduled: false, after: { mode: 'CUSTOM', status: 'ACTIVATED' } });
    expect((await repo.resolveEarningRule(db, TB, new Date()) as any).rule).toMatchObject({ source: 'TENANT_OVERRIDE', spendIncrementCents: 1000, pointTenthsPerIncrement: 20 });
    expect((await repo.resolveEarningRule(db, TA, new Date()) as any).rule.source).toBe('GLOBAL_DEFAULT');
    expect((await repo.policyView(owner(TB, BB))).effective).toMatchObject({ sourceLabel: 'My Salon Custom Rule', rateLabel: '$10.00 = 2 points' });
  });
  it('T05 a future global change reaches global-mode salons at its time; the custom salon is untouched', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    await repo.publishGlobalRule({ spendIncrementCents: 1000, pointTenthsPerIncrement: 15, effectiveFrom: tomorrow.toISOString(), reason: 'November promotion rate for every global salon' }, OWNER);
    expect((await repo.resolveEarningRule(db, TA, new Date()) as any).rule.pointTenthsPerIncrement).toBe(5);
    expect((await repo.resolveEarningRule(db, TA, new Date(tomorrow.getTime() + 1000)) as any).rule).toMatchObject({ source: 'GLOBAL_DEFAULT', spendIncrementCents: 1000, pointTenthsPerIncrement: 15 });
    expect((await repo.resolveEarningRule(db, TB, new Date(tomorrow.getTime() + 1000)) as any).rule).toMatchObject({ source: 'TENANT_OVERRIDE', pointTenthsPerIncrement: 20 });
    expect(await repo.globalImpact()).toEqual({ globalModeTenants: 2, customModeTenants: 1 });
  });
  it('T06 a scheduled custom rule shows "Current: Global / Scheduled Custom" and applies only from its time', async () => {
    const at = new Date(Date.now() + 3_600_000);
    await repo.activateCustom(owner(TC, BC), { spendIncrementCents: 2000, pointTenthsPerIncrement: 10, effectiveFrom: at.toISOString() });
    const v = await repo.policyView(owner(TC, BC));
    expect(v.mode).toBe('GLOBAL'); expect(v.scheduled).toHaveLength(1); expect(v.scheduled[0]).toMatchObject({ mode: 'CUSTOM', rateLabel: '$20.00 = 1 point' });
    expect((await repo.resolveEarningRule(db, TC, new Date()) as any).rule.source).toBe('GLOBAL_DEFAULT');
    expect((await repo.resolveEarningRule(db, TC, new Date(at.getTime() + 1)) as any).rule.source).toBe('TENANT_OVERRIDE');
    const cancel = await repo.cancelScheduled(owner(TC, BC), v.scheduled[0].id);
    expect(cancel.canceled.status).toBe('CANCELED');
    expect((await repo.resolveEarningRule(db, TC, new Date(at.getTime() + 1)) as any).rule.source).toBe('GLOBAL_DEFAULT');
  });
  it('no backdating; out-of-policy rates refused', async () => {
    expect(await code(repo.activateCustom(owner(TC, BC), { spendIncrementCents: 1000, pointTenthsPerIncrement: 10, effectiveFrom: '2026-01-01T00:00:00Z' }))).toBe('EARNING_RULE_INVALID');
    expect(await code(repo.activateCustom(owner(TC, BC), { spendIncrementCents: 1000, pointTenthsPerIncrement: 500 }))).toBe('EARNING_RULE_OUT_OF_POLICY');
  });
  it('T24 two simultaneous activations at the same instant: one wins, the other is a clean conflict; no overlapping intervals', async () => {
    const at = new Date(Date.now() + 7_200_000).toISOString();
    // PGlite is ONE connection: two "simultaneous" transactions interleave on it and row locks cannot separate them, so the
    // real race is proven on Postgres (global-rewards.postgres-race). Here the two activations run back to back — same rule.
    const res: string[] = [];
    for (const i of [1, 2]) res.push(await code(repo.activateCustom(owner(TC, BC), { spendIncrementCents: 1000 * i, pointTenthsPerIncrement: 10, effectiveFrom: at })));
    expect(res.sort()).toEqual(['EARNING_POLICY_CONFLICT', 'ok']);
    expect((await q(`select count(*)::int as n from tenant_earning_policy_versions where tenant_id = $1 and status = 'ACTIVATED' and effective_from = $2`, [TC, at]))[0].n).toBe(1);
    const v = await repo.policyView(owner(TC, BC));
    await repo.cancelScheduled(owner(TC, BC), v.scheduled[0].id);
  });
});

describe('Buy Tokens — LoyaltyTokens §2.4 step 1, §5.3–§5.4, T14', () => {
  it('authorized/captured/settlement-pending are NOT spendable; FUNDS_VERIFIED credits exactly once', async () => {
    const r = await repo.createPurchase(owner(TA, BA), { tokens: 100, idempotencyKey: 'buy-A-100-0001', provider: 'sandbox' });
    expect(r.created).toBe(true);
    expect(await repo.createPurchase(owner(TA, BA), { tokens: 100, idempotencyKey: 'buy-A-100-0001', provider: 'sandbox' })).toEqual({ intentId: r.intentId, created: false });   // double click
    expect(await code(repo.createPurchase(owner(TA, BA), { tokens: 50, idempotencyKey: 'buy-A-100-0001', provider: 'sandbox' }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await code(repo.createPurchase(owner(TA, BA), { tokens: 25, idempotencyKey: 'buy-A-025-0002', provider: 'sandbox' }))).toBe('PURCHASE_PENDING_VERIFICATION');   // one in flight
    await repo.movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: TA, source: 'test', providerRef: 'sbx_a_1' });
    expect(await wallet(TA)).toBe(0);
    await repo.movePurchase(r.intentId, 'SETTLEMENT_PENDING', { tenantId: TA, source: 'test' });
    expect(await wallet(TA)).toBe(0);
    expect((await repo.walletSummary(TA)).pendingCents).toBe(10000);
    await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: TA, source: 'test' });
    expect(await wallet(TA)).toBe(10000);
    expect(await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: TA, source: 'test' })).toMatchObject({ changed: false });
    expect(await wallet(TA)).toBe(10000);
    expect(await code(repo.movePurchase(r.intentId, 'PROCESSING', { tenantId: TA, source: 'test' }))).toBe('INVALID_STATE_TRANSITION');
    expect(await code(repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: TB, source: 'test' }))).toBe('RESOURCE_NOT_FOUND');   // another salon's id
    expect((await repo.walletSummary(TA))).toMatchObject({ availableCents: 10000, available: '100.00', pendingCents: 0, alertLevel: 'ok' });
  });
  it('a receptionist cannot buy; an unenrolled salon cannot buy', async () => {
    expect(await code(repo.createPurchase(owner(TA, BA, ['pos.customers.view']), { tokens: 10, idempotencyKey: 'buy-A-rec-0003', provider: 'sandbox' }))).toBe('PERMISSION_DENIED');
    expect(await code(repo.createPurchase(owner(TX, BX), { tokens: 10, idempotencyKey: 'buy-X-010-0004', provider: 'sandbox' }))).toBe('MERCHANT_NOT_ENROLLED');
  });
});

describe('funded earning — LoyaltyTokens §2.4 step 2, §13.1; addendum T03, T09, T10, T11', () => {
  it('Earn $100 at A (global $5 = 0.5): 10 points, wallet 100 → 99, journal moves $1 into rewards liability', async () => {
    const t = await paidTicket(TA, BA, custOf[TA], 11500, new Date(), { tax: 700, tip: 800 });
    const r = await earn(TA, t);
    expect(r).toMatchObject({ status: 'EARNED', pointTenths: 100, backingCents: 100, ruleSource: 'GLOBAL_DEFAULT', walletAfterCents: 9900 });
    expect(await wallet(TA)).toBe(9900); expect(await points()).toBe(100);
    const snap = (await q(`select eligible_cents, rule_source, spend_increment_cents, point_tenths_per_increment, point_tenths, backing_cents from reward_earn_transactions where id = $1`, [r.earnId]))[0];
    expect({ eligible: Number(snap.eligible_cents), source: snap.rule_source, inc: Number(snap.spend_increment_cents), per: Number(snap.point_tenths_per_increment), tenths: Number(snap.point_tenths), backing: Number(snap.backing_cents) })
      .toEqual({ eligible: 10000, source: 'GLOBAL_DEFAULT', inc: 500, per: 5, tenths: 100, backing: 100 });   // tax $7 and tip $8 excluded
  });
  it('three more customers 1 + 5 + 10 points: debits 0.10 + 0.50 + 1.00 → 97.40', async () => {
    for (const c of [1000, 5000, 10000]) expect((await earn(TA, await paidTicket(TA, BA, custOf[TA], c))).status).toBe('EARNED');
    expect(await wallet(TA)).toBe(9740);
  });
  it('T11 the same checkout delivered twice earns once and debits once', async () => {
    const t = await paidTicket(TA, BA, custOf[TA], 2500);
    expect((await earn(TA, t)).status).toBe('EARNED');
    expect((await earn(TA, t)).outcome).toBe('duplicate');
    expect(await wallet(TA)).toBe(9740 - 25);
    expect((await q(`select count(*)::int as n from token_wallet_ledger where tenant_id = $1 and entry_type = 'earn_allocation'`, [TA]))[0].n).toBe(5);
  });
  it('Nov 3 audit — the rewards liability is the platform\'s on every line (earn used to tag it to the salon, redeem did not)', async () => {
    expect(Number((await q(`select count(*)::int n from rewards_journal_lines where account = 'rewards_liability' and tenant_id is not null`))[0].n)).toBe(0);
    expect(Number((await q(`select count(*)::int n from rewards_journal_lines where account = 'rewards_liability'`))[0].n)).toBeGreaterThan(0);
  });
  it('T03 custom B $10 = 2: $100 earns 20 points and debits 2.00 tokens from B (not A)', async () => {
    await fund(TB, BB, 10);
    const before = await points();
    const r = await earn(TB, await paidTicket(TB, BB, custOf[TB], 10000));
    expect(r).toMatchObject({ status: 'EARNED', pointTenths: 200, backingCents: 200, ruleSource: 'TENANT_OVERRIDE' });
    expect(await wallet(TB)).toBe(800); expect(await wallet(TA)).toBe(9715); expect(await points()).toBe(before + 200);
  });
  it('T09 custom needs 2.00 but B has 1.00: blocked — no fallback to the cheaper global rate, no partial points, owner alerted', async () => {
    await earn(TB, await paidTicket(TB, BB, custOf[TB], 30000));   // uses 6.00 → 2.00 left
    await earn(TB, await paidTicket(TB, BB, custOf[TB], 5000));    // uses 1.00 → 1.00 left
    expect(await wallet(TB)).toBe(100);
    const before = await points();
    const r = await earn(TB, await paidTicket(TB, BB, custOf[TB], 10000));
    expect(r).toMatchObject({ status: 'BLOCKED_INSUFFICIENT_TOKENS', pointTenths: 200, backingCents: 200, ruleSource: 'TENANT_OVERRIDE' });
    expect(await wallet(TB)).toBe(100); expect(await points()).toBe(before);
    expect((await q(`select title from owner_alerts where tenant_id = $1 and category = 'loyalty' order by created_at`, [TB])).map((x: any) => x.title)).toContain('Rewards not issued: not enough tokens');
  });
  it('low-funding matrix: wallet 0.05 vs needed 0.10 → no negative balance, no points', async () => {
    await fund(TC, BC, 1);
    for (let i = 0; i < 19; i++) await earn(TC, await paidTicket(TC, BC, custOf[TC], 500));   // 19 × 0.05 = 0.95 → 0.05 left
    expect(await wallet(TC)).toBe(5);
    const r = await earn(TC, await paidTicket(TC, BC, custOf[TC], 1000));
    expect(r.status).toBe('BLOCKED_INSUFFICIENT_TOKENS'); expect(await wallet(TC)).toBe(5);
    // a 1-token wallet starts below the critical line: no new crossing, so no alert spam — only the blocked-issuance alert
    expect((await q(`select title from owner_alerts where tenant_id = $1 and category = 'loyalty'`, [TC])).map((x: any) => x.title)).toEqual(['Rewards not issued: not enough tokens']);
  });
  it('T10 two concurrent sales on a wallet that funds only one: one EARNED, one BLOCKED, never negative', async () => {
    const [t1, t2] = [await paidTicket(TC, BC, custOf[TC], 500), await paidTicket(TC, BC, custOf[TC], 500)];
    // PGlite cannot run two transactions at once (one connection: FOR UPDATE does not separate them) — the concurrent version
    // runs on real Postgres in global-rewards.postgres-race (16 sales over four sessions). Here: back to back, same outcome.
    const res = [await earn(TC, t1), await earn(TC, t2)];
    expect(res.map((r) => r.status).sort()).toEqual(['BLOCKED_INSUFFICIENT_TOKENS', 'EARNED']);
    expect(await wallet(TC)).toBe(0);
    // crossing critical → empty raises exactly one alert
    expect((await q(`select count(*)::int as n from owner_alerts where tenant_id = $1 and title = 'Reward tokens used up'`, [TC]))[0].n).toBe(1);
  });
  it('never earns: an unverified identity, a gift-card-only sale, flags off (no row at all)', async () => {
    expect(await earn(TA, await paidTicket(TA, BA, custU, 10000))).toMatchObject({ status: 'NOT_ELIGIBLE', reason: 'no_verified_rewards_account' });
    expect(await earn(TA, await paidTicket(TA, BA, custOf[TA], 5000), 5000)).toMatchObject({ status: 'NOT_ELIGIBLE', reason: 'below_increment' });
    await setFlag(GR_FLAGS.earn, false);
    const t = await paidTicket(TA, BA, custOf[TA], 10000);
    expect((await earn(TA, t)).outcome).toBe('flag_off');
    expect((await q(`select count(*)::int as n from reward_earn_transactions where ticket_id = $1`, [t]))[0].n).toBe(0);
    await setFlag(GR_FLAGS.earn, true);
  });
  it('T08 a paused program or a suspended salon blocks issuance even for a custom-mode salon', async () => {
    const v = (await repo.program()).version;
    await repo.updateProgram({ earn_paused: true }, v, OWNER);
    expect(await earn(TB, await paidTicket(TB, BB, custOf[TB], 1000))).toMatchObject({ status: 'BLOCKED_POLICY', reason: 'program_earning_paused' });
    await repo.updateProgram({ earn_paused: false }, v + 1, OWNER);
    await repo.setEnrollment(TB, 'suspended', { reason: 'compliance review of salon B', actorUserId: OWNER });
    expect(await earn(TB, await paidTicket(TB, BB, custOf[TB], 1000))).toMatchObject({ status: 'BLOCKED_POLICY', reason: 'merchant_suspended' });
    await repo.setEnrollment(TB, 'enrolled', { reason: 'compliance review completed', actorUserId: OWNER });
  });
  it('a ticket of another salon is a security failure, not an award', async () => {
    const t = await paidTicket(TA, BA, custOf[TA], 1000);
    expect(await code(earn(TB, t))).toMatch(/^TenantMismatchError/);
    expect(TenantMismatchError).toBeTruthy();
  });
});

describe('refunds — guide §8.1, addendum T12', () => {
  it('a refund reverses with the ORIGINAL snapshot after the rule changed; a repeated refund does not reverse twice', async () => {
    const t = await paidTicket(TA, BA, custOf[TA], 10000);
    const e = await earn(TA, t);
    expect(e).toMatchObject({ status: 'EARNED', pointTenths: 100 });
    const w0 = await wallet(TA), p0 = await points();
    const r1 = await db.transaction().execute((trx: any) => reverseEarnForRefund(trx, repo, { tenantId: TA, ticketId: t, refundId: id('r1'), refundedEligibleCents: 5000 }));
    expect(r1).toMatchObject({ outcome: 'reversed', reversedTenths: 50, restoredCents: 50, status: 'PARTIALLY_REVERSED' });
    expect(await db.transaction().execute((trx: any) => reverseEarnForRefund(trx, repo, { tenantId: TA, ticketId: t, refundId: id('r1'), refundedEligibleCents: 5000 }))).toMatchObject({ outcome: 'duplicate' });
    expect(await wallet(TA)).toBe(w0 + 50); expect(await points()).toBe(p0 - 50);
    const r2 = await db.transaction().execute((trx: any) => reverseEarnForRefund(trx, repo, { tenantId: TA, ticketId: t, refundId: id('r2'), refundedEligibleCents: 10000 }));
    expect(r2).toMatchObject({ reversedTenths: 50, status: 'REVERSED' });
  });
});

describe('purchase reversed after funding — LoyaltyTokens (Nov 3 audit P0)', () => {
  it('a reversal takes the tokens back exactly once; a chargeback after they were spent locks the wallet and books the shortfall', async () => {
    const w0 = await wallet(TA);
    const i1 = await fund(TA, BA, 10);
    expect(await wallet(TA)).toBe(w0 + 1000);
    expect(await repo.movePurchase(i1, 'REVERSED', { tenantId: TA, source: 'test' })).toMatchObject({ changed: true });
    expect(await wallet(TA)).toBe(w0);
    expect(await repo.movePurchase(i1, 'REVERSED', { tenantId: TA, source: 'test' })).toMatchObject({ changed: false });
    expect(await wallet(TA)).toBe(w0);
    expect((await q(`select status from tenant_token_wallets where tenant_id = $1`, [TA]))[0].status).toBe('active');

    const before = await wallet(TC);
    const i2 = await fund(TC, BC, 1);
    const e = await earn(TC, await paidTicket(TC, BC, custOf[TC], 10000));   // spends 1.00 token backing 10 points
    expect(e).toMatchObject({ status: 'EARNED', backingCents: 100 });
    const left = await wallet(TC);
    expect(left).toBe(before);
    await repo.movePurchase(i2, 'CHARGED_BACK', { tenantId: TC, source: 'test' });
    expect(await wallet(TC)).toBe(0);
    expect((await q(`select status from tenant_token_wallets where tenant_id = $1`, [TC]))[0].status).toBe('locked');
    const def = Number((await q(`select coalesce(sum(debit_cents) - sum(credit_cents), 0)::bigint as v from rewards_journal_lines l join rewards_journal_entries j on j.id = l.entry_id
      where j.source_id = $1 and j.entry_type = 'purchase_reversed' and l.account = 'funding_deficit_receivable'`, [i2]))[0].v);
    expect(def).toBe(100 - left);
    // a locked wallet is a policy block, never "not enough tokens — Buy Tokens"
    expect(await earn(TC, await paidTicket(TC, BC, custOf[TC], 10000))).toMatchObject({ status: 'BLOCKED_POLICY', reason: 'wallet_locked' });
    const alert = (await q(`select title, metadata from owner_alerts where tenant_id = $1 order by created_at desc limit 1`, [TC]))[0];
    expect(alert.title).toBe('Rewards not issued: token wallet on hold');
    const f = await collectFindings(db, new Date(Date.now() + 60_000));
    expect(f.find((x: any) => x.checkType === 'funding_purchases')?.outcome).toBe('PASS');
  });
});

describe('books balance', () => {
  it('every journal entry balances; rewards liability equals funded outstanding points; the ledgers equal the projections', async () => {
    const tot = (await q(`select sum(debit_cents)::bigint as d, sum(credit_cents)::bigint as c from rewards_journal_lines`))[0];
    expect(tot.d).toBe(tot.c);
    const liab = Number((await q(`select coalesce(sum(credit_cents) - sum(debit_cents), 0)::bigint as v from rewards_journal_lines where account = 'rewards_liability'`))[0].v);
    const outstanding = Number((await q(`select coalesce(sum(available_tenths + reserved_tenths), 0)::bigint as v from global_rewards_accounts`))[0].v);
    expect(liab).toBe(outstanding);   // 1 point-tenth = 1¢ at 10 points = $1
    for (const t of [TA, TB, TC]) {
      const led = Number((await q(`select coalesce(sum(delta_cents), 0)::bigint as v from token_wallet_ledger where tenant_id = $1`, [t]))[0].v);
      expect(led).toBe(await wallet(t));
    }
    const pl = Number((await q(`select coalesce(sum(delta_tenths), 0)::bigint as v from global_points_ledger where identity_id = $1`, [IDV]))[0].v);
    expect(pl).toBe(await points());
    expect(await code(q(`update token_wallet_ledger set delta_cents = 0`))).toMatch(/append-only/);
  });
});
describe('LoyaltyRules §8.2 — T07, T22 (Final Completion guide §13: canonical cases with exact tests)', () => {
  it('T07 return to GLOBAL: historical custom awards + token debits unchanged; the next sale uses the latest global', async () => {
    await setFlag(GR_FLAGS.customEarning, true);
    if ((await repo.policyView(owner(TB, BB))).mode !== 'CUSTOM') await repo.activateCustom(owner(TB, BB), { spendIncrementCents: 1000, pointTenthsPerIncrement: 20 });
    await fund(TB, BB, 10);
    const t1 = await paidTicket(TB, BB, custOf[TB], 10000); await earn(TB, t1);
    const before = (await q(`select rule_source, point_tenths::int p, backing_cents::int b from reward_earn_transactions where ticket_id = $1`, [t1]))[0];
    expect(before.rule_source).toBe('TENANT_OVERRIDE');
    const debitBefore = Number((await q(`select delta_cents from token_wallet_ledger where source_id = (select id::text from reward_earn_transactions where ticket_id = $1)`, [t1]))[0].delta_cents);
    await repo.useGlobal(owner(TB, BB), { confirm: true, reason: 'T07 return to the global rules' });
    const t2 = await paidTicket(TB, BB, custOf[TB], 10000); await earn(TB, t2);
    const after = (await q(`select rule_source, point_tenths::int p from reward_earn_transactions where ticket_id = $1`, [t2]))[0];
    expect(after).toEqual({ rule_source: 'GLOBAL_DEFAULT', p: 100 });   // $100 at the global $5 = 0.5 → 10 points
    expect((await q(`select rule_source, point_tenths::int p, backing_cents::int b from reward_earn_transactions where ticket_id = $1`, [t1]))[0]).toEqual(before);
    expect(Number((await q(`select delta_cents from token_wallet_ledger where source_id = (select id::text from reward_earn_transactions where ticket_id = $1)`, [t1]))[0].delta_cents)).toBe(debitBefore);
  });
  it('T22 the redemption conversion is not editable through the program API, and every issued point keeps its own value snapshot', async () => {
    const p0 = await repo.program();
    expect(await code(repo.updateProgram({ points_per_redeem_block: 20, redeem_block_value_cents: 50 }, p0.version, OWNER))).toBe('VALIDATION_FAILED');   // "Nothing to change": not an editable column
    const p1 = await repo.program(); expect([p1.pointsPerRedeemBlock, p1.redeemBlockValueCents]).toEqual([p0.pointsPerRedeemBlock, p0.redeemBlockValueCents]);
    const snaps = await q(`select count(*)::int n from reward_earn_transactions where status = 'EARNED' and cents_per_point_tenth is null`);
    expect(snaps[0].n).toBe(0);   // each award carries the cents-per-point it was funded at
  });
});
