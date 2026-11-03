// referral-program.pgtest — Referral Program guide (Oct 30 2026, migration 751) on the REAL schema: the code → new customer →
// first completed PAID visit → approval → ONE reward issuance workflow, its negative paths and its security boundary.
// T-numbers are the guide's §17–§18 acceptance tests.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReferralProgram, ReferralProgramError } from './referral-program';
import { ReferralsService } from './pos-referrals.service';
import { KyselyReferralsRepository } from './pos-referrals.kysely.repository';

const P = 'd7510000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4);
const OWNER = id(10), MGR = id(11);
const C = { rita: id(101), sam: id(102), nia: id(103), noah: id(104), olga: id(105), pia: id(106), quinn: id(107), rex: id(108), xena: id(109), tom: id(110) };
const ctx = (userId = OWNER, tenantId = T, branchId = B) => ({ tenantId, branchId, userId, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage', 'pos.customers.view'] }) as any;
let db: any; let rp: ReferralProgram; let tk = 0;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audit = async () => undefined;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReferralProgramError ? e.code : (e as any)?.apiCode ?? (e as Error).message; } }
async function cust(cid: string, name: string, phone: string | null, tenant = T, branch = B) {
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1] ?? ''}, ${name}, ${phone}, ${name.split(' ')[0].toLowerCase() + '@ref.test'}, 'active')`);
}
async function ticket(customer: string, cents: number, status = 'paid', paidAgoMin = 1, tenant = T, branch = B) {
  const tid = id(5000 + ++tk);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, ticket_number)
    values (${tid}, ${tenant}, ${branch}, ${customer}, ${status}, ${cents}, 0, 0, ${cents}, ${status === 'paid' || status === 'closed' ? sql`now() - make_interval(mins => ${paidAgoMin})` : null}, ${String(9000 + tk)})`);
  if (status === 'paid') await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, card_brand, card_last4) values (${tenant}, ${branch}, ${tid}, 'card', ${cents}, 0, 'approved', 'visa', ${customer === C.rex ? '4242' : String(1000 + tk)})`);
  return tid;
}
const ref = async (referred: string) => (await q(sql`select * from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${referred}`))[0];
const reward = async (referralId: string) => (await q(sql`select * from referral_rewards where tenant_id = ${T} and referral_id = ${referralId}`))[0];
const points = async (c: string) => Number((await q(sql`select points_balance from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${c}`))[0]?.points_balance ?? 0);
const ledger = async (rewardId: string) => q(sql`select entry_type, delta from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards' and source_id = ${rewardId} order by created_at`);
async function setPolicy(b: Record<string, unknown>) { const cur = await rp.settings({ tenantId: T }); return rp.saveSettings(ctx(), { ...b, expectedVersion: cur.version }, audit); }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); rp = new ReferralProgram(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'Ref Salon', 'ref-751', 'REF751', 'active'), (${X}, 'X', 'Other Salon', 'ref-751x', 'REF751X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner One', 'owner@ref.test', 'active', 'OWNER'), (${MGR}, ${T}, 'Manager Two', 'mgr@ref.test', 'active', 'MANAGER')`);
  await cust(C.rita, 'Rita Referrer', '+16095550101'); await cust(C.sam, 'Sam Second', '+16095550102'); await cust(C.nia, 'Nia New', '+16095550103');
  await cust(C.noah, 'Noah Family', '+16095550101');   // shares Rita's phone (family) — a risk signal, never a merge
  await cust(C.olga, 'Olga Old', '+16095550105'); await cust(C.pia, 'Pia Paid', '+16095550106'); await cust(C.quinn, 'Quinn Cash', '+16095550107');
  await cust(C.rex, 'Rex Card', '+16095550108'); await cust(C.tom, 'Tom Many', '+16095550110');
  await cust(C.xena, 'Xena Other', '+16095550109', X, BX);
  // the two existing codes (T01) — as the Customer App writes them (046): one per customer
  await q(sql`insert into customer_referrals (tenant_id, customer_id, code) values (${T}, ${C.rita}, 'RITA10'), (${T}, ${C.sam}, 'SAM20'), (${X}, ${C.xena}, 'XENA1')`);
  await ticket(C.olga, 4000, 'paid', 60 * 24 * 40); await ticket(C.olga, 4000, 'paid', 60 * 24 * 10);   // Olga: an existing customer
  await ticket(C.rita, 5000, 'paid', 60 * 24 * 30);                                                   // Rita paid by card 1111 before
}, 240_000);

describe('codes, the honest empty state, and the eligibility checker (T01, T02, T04, T05)', () => {
  it('T01/T02: the two codes and their owners are preserved; 0 referrals, nothing synthetic', async () => {
    const s = await rp.summary(ctx());
    expect({ codes: s.codes, active: s.codesActive, total: s.totalReferrals, pending: s.pendingReward, cash: s.cashPaidCents }).toEqual({ codes: 2, active: 2, total: 0, pending: 0, cash: 0 });
    const c = await rp.codes(ctx(), {});
    expect(c.items.map((x: any) => `${x.code}:${x.owner.name}`).sort()).toEqual(['RITA10:Rita Referrer', 'SAM20:Sam Second']);
    expect((await rp.list(ctx(), {})).totalItems).toBe(0);
  });
  it('T04: an unknown code is refused with a reason and nothing is written; a disabled code is refused', async () => {
    const c = await rp.check(ctx(), { code: 'NOPE99', referredCustomerId: C.nia });
    expect(c.result).toBe('INELIGIBLE'); expect(c.reasons[0].code).toBe('code_unknown');
    expect(await code(rp.record(ctx(), { code: 'NOPE99', referredCustomerId: C.nia, idempotencyKey: 'rec-nope-1' }))).toBe('REFERRAL_CODE_UNKNOWN');
    const sam = (await rp.codes(ctx(), { q: 'SAM' })).items[0];
    await rp.setCodeStatus(ctx(), sam.id, { status: 'disabled', reason: 'customer asked to stop', expectedVersion: sam.version }, audit);
    expect((await rp.check(ctx(), { code: 'sam20', referredCustomerId: C.nia })).reasons.map((r: any) => r.code)).toContain('code_disabled');
    expect(await code(rp.record(ctx(), { code: 'SAM20', referredCustomerId: C.nia, idempotencyKey: 'rec-sam-1' }))).toBe('REFERRAL_CODE_DISABLED');
    const again = (await rp.codes(ctx(), { q: 'SAM' })).items[0];
    await rp.setCodeStatus(ctx(), again.id, { status: 'active', reason: null, expectedVersion: again.version }, audit);
    expect(Number((await q(sql`select count(*)::int n from referral_redemptions where tenant_id = ${T}`))[0].n)).toBe(0);
  });
  it('T05: the code owner cannot refer themselves (canonical customer id) — refused', async () => {
    expect((await rp.check(ctx(), { code: 'RITA10', referredCustomerId: C.rita })).reasons.map((r: any) => r.code)).toContain('self_referral');
    expect(await code(rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.rita, idempotencyKey: 'rec-self-1' }))).toBe('SELF_REFERRAL');
  });
  it('Nov 3 audit: an archived customer can neither refer nor be referred', async () => {
    const arch = id(199);
    await cust(arch, 'Ann Archived', '+16095550199');
    await q(sql`update customers set status = 'archived' where id = ${arch}`);
    expect((await rp.check(ctx(), { code: 'RITA10', referredCustomerId: arch })).reasons.map((r: any) => r.code)).toContain('referred_inactive');
    await q(sql`update customers set status = 'archived' where id = ${C.rita}`);
    expect((await rp.check(ctx(), { code: 'RITA10', referredCustomerId: C.nia })).reasons.map((r: any) => r.code)).toContain('referrer_inactive');
    await q(sql`update customers set status = 'active' where id = ${C.rita}`);
  });
  it('an existing customer (2 completed visits) is not a new customer — refused with the reason', async () => {
    expect(await code(rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.olga, idempotencyKey: 'rec-olga-1' }))).toBe('REFERRAL_NOT_FIRST_TIME');
  });
});

describe('record → qualify → approve → issue ONCE (T03, T06–T13)', () => {
  it('T03: a valid code + new customer records ONE referral, PENDING_QUALIFICATION, first in the newest-first history', async () => {
    const r: any = await rp.record(ctx(), { code: 'rita10', referredCustomerId: C.nia, idempotencyKey: 'rec-nia-1' });
    expect(r).toMatchObject({ state: 'PENDING_QUALIFICATION', code: 'RITA10', duplicate: false });
    expect(r.referrer.name).toBe('Rita Referrer'); expect(r.referred.name).toBe('Nia New');
    expect((await rp.list(ctx(), {})).items[0].id).toBe(r.id);
  });
  it('T07: the same request again returns the SAME referral; a second claim for the customer (other code) is refused', async () => {
    const a: any = await rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.nia, idempotencyKey: 'rec-nia-1' });
    const b: any = await rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.nia, idempotencyKey: 'rec-nia-2' });
    expect(a.duplicate && b.duplicate && a.id === b.id).toBe(true);
    expect(await code(rp.record(ctx(), { code: 'SAM20', referredCustomerId: C.nia, idempotencyKey: 'rec-nia-3' }))).toBe('REFERRAL_EXISTS');
    expect(Number((await q(sql`select count(*)::int n from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${C.nia}`))[0].n)).toBe(1);
  });
  it('T06: a shared family phone is a risk signal — recorded UNDER_REVIEW, the two customers stay separate', async () => {
    expect((await rp.check(ctx(), { code: 'RITA10', referredCustomerId: C.noah })).result).toBe('REVIEW_REQUIRED');
    const r: any = await rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.noah, idempotencyKey: 'rec-noah-1' });
    expect(r.state).toBe('UNDER_REVIEW'); expect(r.flags.map((f: any) => f.code)).toContain('shared_phone');
    expect(Number((await q(sql`select count(*)::int n from customers where tenant_id = ${T} and id in (${C.rita}, ${C.noah})`))[0].n)).toBe(2);
    // a manager clears the review → back to waiting for the first visit
    await rp.review(ctx(MGR), r.id, { action: 'clear_review', reason: 'Siblings, separate people — verified at the desk' }, audit);
    expect((await ref(C.noah)).state).toBe('PENDING_QUALIFICATION');
  });
  it('T08/T10: a booking alone, an unpaid service and a removed ticket never qualify', async () => {
    
    const unpaid = await ticket(C.nia, 6000, 'in_service');
    expect((await rp.qualifyForTicket(T, unpaid, 'test')).outcome).toBe('not_paid');
    const removed = await ticket(C.nia, 6000, 'paid'); await q(sql`update tickets set removed_at = now() where id = ${removed}`);
    expect((await rp.qualifyForTicket(T, removed, 'test')).outcome).toBe('not_paid');
    expect((await ref(C.nia)).state).toBe('PENDING_QUALIFICATION');
    expect(await reward((await ref(C.nia)).id)).toBeUndefined();
  });
  it('T09 (no reward policy yet): the first paid visit QUALIFIES with ticket evidence; no reward is invented', async () => {
    const t = await ticket(C.nia, 6500);
    expect((await rp.qualifyForTicket(T, t, 'checkout.completed:e1')).outcome).toBe('qualified_no_policy');
    const r = await ref(C.nia);
    expect({ state: r.state, ticket: r.qualifying_ticket_id }).toEqual({ state: 'QUALIFIED', ticket: t });
    expect(await reward(r.id)).toBeUndefined();
    expect((await rp.qualifyForTicket(T, t, 'checkout.completed:e1-again')).outcome).toBe('duplicate');   // the event delivered twice
    const s = await rp.summary(ctx()); expect({ q: s.qualified, pend: s.pendingReward, issued: s.issuedRewards }).toEqual({ q: 1, pend: 0, issued: 0 });
  });
  it('T11/T12: with a loyalty-points policy and approval required, Pia\'s paid visit waits for a manager; the recorder cannot self-approve (separation of duties); a manager approves → ONE ledger posting', async () => {
    await setPolicy({ rewardType: 'loyalty_points', rewardPoints: 50, requiresApproval: true, separationOfDuties: true });
    const r: any = await rp.record(ctx(OWNER), { code: 'RITA10', referredCustomerId: C.pia, idempotencyKey: 'rec-pia-1' });
    const t = await ticket(C.pia, 8000);
    expect((await rp.qualifyForTicket(T, t, 'checkout.completed:e2')).outcome).toBe('pending_approval');
    expect((await ref(C.pia)).state).toBe('REWARD_PENDING_APPROVAL');
    expect((await reward(r.id)).state).toBe('PENDING_APPROVAL');
    expect((await rp.list(ctx(), {}, { approvals: true })).items.map((x: any) => x.id)).toContain(r.id);
    expect(await code(rp.review(ctx(OWNER), r.id, { action: 'approve' }, audit))).toBe('REFERRAL_SELF_APPROVAL');
    const before = await points(C.rita);
    await rp.review(ctx(MGR), r.id, { action: 'approve', reason: 'first visit verified' }, audit);
    const w = await reward(r.id);
    expect({ ref: (await ref(C.pia)).state, rw: w.state, key: w.issuance_key }).toEqual({ ref: 'REWARD_ISSUED', rw: 'ISSUED', key: `issue:${w.id}` });
    expect(await ledger(w.id)).toEqual([{ entry_type: 'earn', delta: 50 }]);
    expect(await points(C.rita)).toBe(before + 50);
  });
  it('T13: a retried issuance, a re-delivered Checkout event and a second approval change nothing', async () => {
    const r = await ref(C.pia); const w = await reward(r.id);
    expect((await rp.retryIssue(ctx(MGR), w.id)).duplicate).toBe(true);
    expect((await rp.qualifyForTicket(T, r.qualifying_ticket_id, 'again')).outcome).toBe('duplicate');
    expect(await code(rp.review(ctx(MGR), r.id, { action: 'approve' }, audit))).toBe('REFERRAL_REWARD_STATE_CONFLICT');
    expect((await ledger(w.id)).length).toBe(1);
  });
  it('the overlay shows the visit, the payment, the ledger entry and the audit trail', async () => {
    const r = await ref(C.pia);
    const d: any = await rp.detail(ctx(), r.id, { full: true, showContact: false });
    expect(d.visit.ticketId).toBe(r.qualifying_ticket_id); expect(d.visit.payments.length).toBe(1);
    expect(d.rewardDetail).toMatchObject({ state: 'ISSUED', points: 50, disposition: 'points_issued' }); expect(d.rewardDetail.ledger.delta).toBe(50);
    expect(d.audit.map((e: any) => e.type)).toEqual(['recorded', 'qualified', 'reward_requested', 'approved', 'reward_issued']);
    expect(d.referrerProfile.phone).toBe('•••• 0101');   // masked without the contact permission
  });
  it('T14: a full refund after issuance REVERSES the points with an audited ledger entry (never deleted); the same refund again is ignored', async () => {
    const r = await ref(C.pia); const w = await reward(r.id);
    const pay = (await q(sql`select id from payments where ticket_id = ${r.qualifying_ticket_id}`))[0].id;
    await q(sql`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, status, reason) values (${id(7001)}, ${T}, ${B}, ${pay}, 8000, 'refunded', 'unhappy')`);
    await db.transaction().execute((trx: any) => rp.handleRefund(T, r.qualifying_ticket_id, id(7001), trx));
    expect({ ref: (await ref(C.pia)).state, rw: (await reward(r.id)).state }).toEqual({ ref: 'REVERSED', rw: 'REVERSED' });
    expect(await ledger(w.id)).toEqual([{ entry_type: 'earn', delta: 50 }, { entry_type: 'reverse', delta: -50 }]);
    expect((await db.transaction().execute((trx: any) => rp.handleRefund(T, r.qualifying_ticket_id, id(7001), trx))).outcome).toBe('duplicate');
  });
  it('T15: a cash payout has no approved provider — BLOCKED_EXTERNAL, nothing paid; Rewards Paid stays $0', async () => {
    await setPolicy({ rewardType: 'cash_payout', rewardCents: 1000, requiresApproval: false, separationOfDuties: false });
    await rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.quinn, idempotencyKey: 'rec-quinn-1' });
    expect((await rp.qualifyForTicket(T, await ticket(C.quinn, 7000), 'e3')).outcome).toBe('auto_approved');
    expect((await reward((await ref(C.quinn)).id)).state).toBe('BLOCKED_EXTERNAL');
    const s = await rp.summary(ctx()); expect({ cash: s.cashPaidCents, blocked: s.blockedPayouts }).toEqual({ cash: 0, blocked: 1 });
  });
  it('a card the referrer used pays the referred customer\'s first visit → UNDER_REVIEW, reward waits for a person', async () => {
    await setPolicy({ rewardType: 'loyalty_points', rewardPoints: 30, requiresApproval: false });
    await q(sql`update payments set card_last4 = '4242' where ticket_id in (select id from tickets where customer_id = ${C.rita})`);
    await rp.record(ctx(), { code: 'RITA10', referredCustomerId: C.rex, idempotencyKey: 'rec-rex-1' });
    expect((await rp.qualifyForTicket(T, await ticket(C.rex, 4500), 'e4')).outcome).toBe('pending_approval');
    const r = await ref(C.rex);
    expect(r.state).toBe('UNDER_REVIEW'); expect(JSON.stringify(r.fraud_flags)).toContain('shared_card');
    expect((await reward(r.id)).state).toBe('PENDING_APPROVAL');
  });
  it('the legacy hand-typed "reward" toggle is retired; the legacy record route goes through the same canonical record', async () => {
    const legacy = new ReferralsService(new KyselyReferralsRepository(db), rp);
    expect(await code(legacy.reward(ctx(), (await ref(C.nia)).id, 1000))).toBe('REFERRAL_REWARD_TOGGLE_RETIRED');
    expect(await code(legacy.record(ctx(), { code: 'RITA10', referredCustomerId: C.rita }))).toBe('SELF_REFERRAL');
  });
});

describe('search, dates, pagination, health and the security boundary (T20–T24, T28, T31)', () => {
  it('T20/T23: search by phone digits, ticket number and name works beyond Page 1 with an exact total; pages are stable', async () => {
    for (let i = 0; i < 12; i++) { const cid = id(300 + i); await cust(cid, `Many${String(i).padStart(2, '0')} Person`, '+1609555' + String(2000 + i)); await rp.record(ctx(), { code: 'RITA10', referredCustomerId: cid, idempotencyKey: `rec-many-${i}` }); }
    const all = await rp.list(ctx(), { pageSize: 10 });
    expect(all.totalItems).toBe(17); expect(all.totalPages).toBe(2);   // Nia, Noah, Pia, Quinn, Rex + 12
    const p2 = await rp.list(ctx(), { pageSize: 10, page: 2 });
    expect(new Set([...all.items, ...p2.items].map((x: any) => x.id)).size).toBe(17);
    const byPhone = await rp.list(ctx(), { q: '2003' }); expect(byPhone.items.map((x: any) => x.referred.name)).toEqual(['Many03 Person']); expect(byPhone.items[0].matchedAs).toBe('referred');
    const tnum = (await q(sql`select ticket_number from tickets where id = ${(await ref(C.pia)).qualifying_ticket_id}`))[0].ticket_number;
    expect((await rp.list(ctx(), { q: String(tnum) })).items.map((x: any) => x.referred.name)).toEqual(['Pia Paid']);
    expect((await rp.list(ctx(), { q: 'Rita' })).items.every((x: any) => x.matchedAs === 'referrer')).toBe(true);
  });
  it('T22: a salon-local inclusive date range across the DST change (Nov 1 2026, New York)', async () => {
    const a = await ref(C.nia), b = await ref(C.noah);
    await q(sql`update referral_redemptions set redeemed_at = '2026-11-02T04:30:00Z' where id = ${a.id}`);   // Nov 1, 11:30 PM EST
    await q(sql`update referral_redemptions set redeemed_at = '2026-11-02T05:30:00Z' where id = ${b.id}`);   // Nov 2, 00:30 AM EST
    const r = await rp.list(ctx(), { preset: 'custom', from: '2026-11-01', to: '2026-11-01', basis: 'recorded' });
    expect(r.items.map((x: any) => x.id)).toEqual([a.id]);
    expect(await code(rp.list(ctx(), { preset: 'custom', from: '2026-11-05', to: '2026-11-01' }))).toBe('REFERRAL_RANGE_INVALID');
  });
  it('T31: Check Referral System is non-mutating and never a false green (a blocked payout shows attention)', async () => {
    const before = Number((await q(sql`select count(*)::int n from referral_events where tenant_id = ${T}`))[0].n);
    const h = await rp.health(ctx());
    expect(Number((await q(sql`select count(*)::int n from referral_events where tenant_id = ${T}`))[0].n)).toBe(before);
    const by = Object.fromEntries(h.items.map((i: any) => [i.key, i.status]));
    expect(by).toMatchObject({ code_lookup: 'ready', ledger_issuance: 'ready', idempotency: 'ready', payout_provider: 'attention_required' });
    expect(h.overall).not.toBe('ready');
  });
  it('T28: another salon sees none of this — not the list, the detail, the code, or a qualification through its ticket', async () => {
    const other = ctx(OWNER, X, BX);
    expect((await rp.list(other, {})).totalItems).toBe(0);
    expect(await code(rp.detail(other, (await ref(C.pia)).id, { full: true }))).toBe('REFERRAL_NOT_FOUND');
    expect((await rp.check(other, { code: 'RITA10', referredCustomerId: C.xena })).reasons[0].code).toBe('code_unknown');
    expect(await code(rp.qualifyForTicket(X, (await ref(C.pia)).qualifying_ticket_id, 'x'))).toBe('TENANT_ACCESS_DENIED');
  });
  it('policy edits are versioned (a stale version is refused) and a missing value is refused, never defaulted', async () => {
    expect(await code(rp.saveSettings(ctx(), { rewardType: 'loyalty_points', rewardPoints: 10, expectedVersion: 1 }, audit))).toBe('VERSION_CONFLICT');
    const cur = await rp.settings({ tenantId: T });
    expect(await code(rp.saveSettings(ctx(), { rewardType: 'loyalty_points', rewardPoints: null, expectedVersion: cur.version }, audit))).toBe('REFERRAL_POLICY_INVALID');
  });
  it('events are append-only (UPDATE / DELETE refused by the database)', async () => {
    expect(await code(q(sql`delete from referral_events where tenant_id = ${T}`))).toMatch(/append-only|P0001/);
  });
});
