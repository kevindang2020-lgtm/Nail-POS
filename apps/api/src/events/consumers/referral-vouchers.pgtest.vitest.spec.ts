// referral-vouchers.pgtest — Refer a Friend / Referral Rewards build (Nov 5 2026, migration 815) on the REAL schema:
// two-sided salon vouchers (friend at activation, referrer after the friend's first PAID visit) issued as customer-bound,
// single-use wallet coupons on the deals discount authority, all inside a HARD campaign budget. R-numbers are the guide's.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReferralProgram, ReferralProgramError } from '@aipowersalon/customers';
import { ReferralVoucherIssuer } from '@aipowersalon/deals';

const P = 'd8150000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2);
const OWNER = id(10), MGR = id(11);
const C = { rita: id(101), nia: id(102), pia: id(103), quinn: id(104), una: id(105), sam: id(106), vic: id(107) };
const ctx = (userId = OWNER) => ({ tenantId: T, branchId: B, userId, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage', 'pos.customers.view'] }) as any;
let db: any; let rp: ReferralProgram; let bare: ReferralProgram; let tk = 0;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audit = async () => undefined;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReferralProgramError ? e.code : (e as any)?.apiCode ?? (e as Error).message; } }
async function cust(cid: string, name: string, phone: string) {
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values (${cid}, ${T}, ${B}, ${name.split(' ')[0]}, ${name.split(' ')[1] ?? ''}, ${name}, ${phone}, ${name.split(' ')[0].toLowerCase() + '@v815.test'}, 'active')`);
}
async function ticket(customer: string, cents: number) {
  const tid = id(5000 + ++tk);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, ticket_number)
    values (${tid}, ${T}, ${B}, ${customer}, 'paid', ${cents}, 0, 0, ${cents}, now(), ${String(7000 + tk)})`);
  await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, card_brand, card_last4) values (${T}, ${B}, ${tid}, 'card', ${cents}, 0, 'approved', 'visa', ${String(2000 + tk)})`);
  return tid;
}
const vouchers = async (referralId: string) => q(sql`select role, state, face_cents, customer_id, coupon_code_id from referral_vouchers where tenant_id = ${T} and referral_id = ${referralId} order by role`);
const coupon = async (cid: string) => (await q(sql`select c.customer_id, c.status, c.single_use, c.code_hint, d.discount_cents, d.kind, d.legacy_source from deal_coupon_codes c join deals d on d.id = c.deal_id where c.id = ${cid}`))[0];
async function setPolicy(b: Record<string, unknown>) { const cur = await rp.settings({ tenantId: T }); return rp.saveSettings(ctx(), { ...b, expectedVersion: cur.version }, audit); }
const record = (referred: string, key: string, refCode = 'RITA10') => rp.record(ctx(), { code: refCode, referredCustomerId: referred, idempotencyKey: key });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); rp = new ReferralProgram(db, new ReferralVoucherIssuer()); bare = new ReferralProgram(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'V', 'Voucher Salon', 'ref-815', 'REF815', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner One', 'owner@v815.test', 'active', 'OWNER'), (${MGR}, ${T}, 'Manager Two', 'mgr@v815.test', 'active', 'MANAGER')`);
  await cust(C.rita, 'Rita Referrer', '+16095551101'); await cust(C.nia, 'Nia New', '+16095551102'); await cust(C.pia, 'Pia Pending', '+16095551103');
  await cust(C.quinn, 'Quinn Queue', '+16095551104'); await cust(C.una, 'Una Unfunded', '+16095551105'); await cust(C.sam, 'Sam Second', '+16095551106'); await cust(C.vic, 'Vic Visit', '+16095551107');
  await q(sql`insert into customer_referrals (tenant_id, customer_id, code) values (${T}, ${C.rita}, 'RITA10'), (${T}, ${C.sam}, 'SAM20')`);
}, 240_000);

describe('policy: two-sided vouchers need both amounts and a hard budget (R020)', () => {
  it('salon_voucher without a budget (or a reward) is refused, never defaulted', async () => {
    expect(await code(setPolicy({ enabled: true, rewardType: 'salon_voucher', friendRewardCents: 1000, referrerRewardCents: 1500 }))).toBe('REFERRAL_POLICY_INVALID');
    expect(await code(setPolicy({ enabled: true, rewardType: 'salon_voucher', friendRewardCents: 1000, budgetTotalCents: 5000 }))).toBe('REFERRAL_POLICY_INVALID');
    expect(await code(setPolicy({ enabled: true, rewardType: 'salon_voucher', friendRewardCents: 1000, referrerRewardCents: 1500, budgetTotalCents: 2000 }))).toBe('REFERRAL_POLICY_INVALID');   // < one referral
    const s = await setPolicy({ enabled: true, rewardType: 'salon_voucher', friendRewardCents: 1000, referrerRewardCents: 1500, budgetTotalCents: 5000, voucherExpiryDays: 60, requiresApproval: false });
    expect(s).toMatchObject({ rewardType: 'salon_voucher', friendRewardCents: 1000, referrerRewardCents: 1500, budgetTotalCents: 5000, voucherExpiryDays: 60, voucherMinSpendCents: 0 });
  });
  it('without the voucher issuer the server refuses to activate (nothing saved, no unfunded promise)', async () => {
    expect(await code(bare.record(ctx(), { code: 'RITA10', referredCustomerId: C.una, idempotencyKey: 'v-bare-1' }))).toBe('REFERRAL_VOUCHERS_UNAVAILABLE');
    expect((await q(sql`select count(*)::int n from referral_redemptions where tenant_id = ${T}`))[0].n).toBe(0);
  });
});

describe('activation → first paid visit → referrer voucher (R035–R041)', () => {
  let niaRef = '';
  it('the checker explains both rewards and the budget left', async () => {
    const c = await rp.check(ctx(), { code: 'RITA10', referredCustomerId: C.nia });
    expect(c.result).toBe('ELIGIBLE_TO_RECORD');
    expect(c.reasons.map((r: any) => r.code)).toEqual(expect.arrayContaining(['budget_available', 'reward_policy']));
    expect(c.reasons.find((r: any) => r.code === 'reward_policy')!.text).toContain('$10.00 voucher');
  });
  it('activation opens the friend voucher (customer-bound single-use coupon, code shown once) and reserves the referrer one', async () => {
    const r: any = await record(C.nia, 'v-nia-1');
    niaRef = r.id;
    expect(r.friendVoucher).toMatchObject({ faceCents: 1000 });
    expect(r.friendVoucher.code).toMatch(/^WELCOME/);
    const v = await vouchers(niaRef);
    expect(v.map((x: any) => `${x.role}:${x.state}:${x.face_cents}`)).toEqual(['friend:AVAILABLE:1000', 'referrer:PENDING:1500']);
    const cp = await coupon(v[0].coupon_code_id);
    expect(cp).toMatchObject({ customer_id: C.nia, status: 'active', single_use: true, discount_cents: 1000, kind: 'coupon', legacy_source: 'referral_friend' });
    expect(String(cp.code_hint)).not.toContain(r.friendVoucher.code);   // only the hash + hint are stored
    // a retry with the same key is the same referral and never a second voucher
    const again: any = await record(C.nia, 'v-nia-1');
    expect(again.duplicate).toBe(true);
    expect((await vouchers(niaRef)).length).toBe(2);
    const s = await rp.summary(ctx());
    expect(s.budget).toMatchObject({ committedCents: 2500, remainingCents: 2500, outstandingCents: 1000, pendingCents: 1500, exhausted: false });
  });
  it('the friend\'s first paid visit issues the referrer voucher once (Rita\'s wallet), no loyalty points', async () => {
    const tid = await ticket(C.nia, 4000);
    const out = await rp.qualifyForTicket(T, tid, 'test');
    expect(out.outcome).toBe('auto_issued');
    const v = await vouchers(niaRef);
    expect(v.map((x: any) => `${x.role}:${x.state}`)).toEqual(['friend:AVAILABLE', 'referrer:AVAILABLE']);
    expect(await coupon(v[1].coupon_code_id)).toMatchObject({ customer_id: C.rita, legacy_source: 'referral_referrer', discount_cents: 1500 });
    const w = (await q(sql`select state, reward_type, amount_cents, ledger_entry_id from referral_rewards where tenant_id = ${T} and referral_id = ${niaRef}`))[0];
    expect(w).toMatchObject({ state: 'ISSUED', reward_type: 'salon_voucher', amount_cents: 1500, ledger_entry_id: null });
    expect((await rp.qualifyForTicket(T, tid, 'test-again')).outcome).toBe('duplicate');
    expect((await q(sql`select count(*)::int n from deal_coupon_codes where tenant_id = ${T}`))[0].n).toBe(2);
  });
  it('a voucher used at Checkout reconciles to REDEEMED; the budget counts it as redeemed', async () => {
    const v = await vouchers(niaRef);
    await q(sql`update deal_coupon_codes set use_count = 1 where id = ${v[0].coupon_code_id}`);
    await rp.reconcileVouchers(db, T);
    expect((await vouchers(niaRef))[0].state).toBe('REDEEMED');
    expect((await rp.summary(ctx())).budget).toMatchObject({ committedCents: 2500, redeemedCents: 1000 });
  });
});

describe('the hard budget (R021, R022) and closing vouchers', () => {
  let piaRef = '';
  it('the second referral fits; the third is refused with nothing saved', async () => {
    piaRef = (await record(C.pia, 'v-pia-1') as any).id;
    expect((await rp.summary(ctx())).budget).toMatchObject({ committedCents: 5000, remainingCents: 0, exhausted: true });
    expect((await rp.check(ctx(), { code: 'RITA10', referredCustomerId: C.quinn })).reasons.map((r: any) => r.code)).toContain('budget_exhausted');
    expect(await code(record(C.quinn, 'v-quinn-1'))).toBe('REFERRAL_BUDGET_EXHAUSTED');
    expect((await q(sql`select count(*)::int n from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${C.quinn}`))[0].n).toBe(0);
  });
  it('rejecting a referral voids the unused friend voucher, releases the pending referrer one and frees the budget', async () => {
    await rp.review(ctx(MGR), piaRef, { action: 'reject', reason: 'Duplicate person, confirmed at the desk' }, audit);
    const v = await vouchers(piaRef);
    expect(v.map((x: any) => `${x.role}:${x.state}`)).toEqual(['friend:VOID', 'referrer:RELEASED']);
    expect((await coupon(v[0].coupon_code_id)).status).toBe('revoked');
    expect((await rp.summary(ctx())).budget).toMatchObject({ committedCents: 2500, exhausted: false });
    expect((await record(C.quinn, 'v-quinn-2') as any).friendVoucher).toBeTruthy();
  });
  it('reversing an issued reward voids the referrer\'s unused voucher (no shortfall)', async () => {
    const ref = (await q(sql`select id from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${C.nia}`))[0].id;
    const w = (await q(sql`select id from referral_rewards where tenant_id = ${T} and referral_id = ${ref}`))[0];
    const out: any = await rp.reverse(ctx(), String(w.id), { reason: 'Visit disputed by the bank' }, audit);
    expect(out).toMatchObject({ reversed: true, shortfall: 0 });
    expect((await vouchers(ref)).map((x: any) => `${x.role}:${x.state}`)).toEqual(['friend:REDEEMED', 'referrer:VOID']);
  });
  it('the per-referrer cap stops one customer collecting more than the owner allows', async () => {
    await setPolicy({ enabled: true, rewardType: 'salon_voucher', friendRewardCents: 1000, referrerRewardCents: 1500, budgetTotalCents: 20000, voucherExpiryDays: 60, requiresApproval: false, perReferrerCap: 2 });
    // Rita has Nia (voided referrer voucher — not counted) + Quinn (pending) = 1 live; one more fits, then the cap
    await record(C.una, 'v-una-1');
    expect(await code(record(C.vic, 'v-vic-1'))).toBe('REFERRAL_REFERRER_CAP');
    expect((await record(C.vic, 'v-vic-2', 'SAM20') as any).friendVoucher).toBeTruthy();   // another referrer is unaffected
  });
  it('health reports the budget and that every open voucher has its wallet coupon', async () => {
    const h = await rp.health(ctx());
    const by = Object.fromEntries(h.items.map((i: any) => [i.key, i.status]));
    expect(by.voucher_issuance).toBe('ready');
    expect(['ready', 'attention_required']).toContain(by.voucher_budget);
  });
});
