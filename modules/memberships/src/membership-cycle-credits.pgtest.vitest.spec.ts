// membership-cycle-credits.pgtest — D6 Membership guide (Nov 3 2026): a successful renewal never issued the new cycle's
// credits (a member paid every month and kept only the first month's). Pins the SQL: one 'issued' row per crediting
// benefit (service / add-on → quantity, dollar → amount, discounts → nothing), at most once per cycle.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipBillingRepository } from './membership-billing.kysely.repository';

const T = '7e000000-0000-4000-8000-000000000001', B = '7e000000-0000-4000-8000-0000000000b1', C = '7e000000-0000-4000-8000-0000000000d1';
const P = '7e000000-0000-4000-8000-0000000000e1', V = '7e000000-0000-4000-8000-0000000000f1', M = '7e000000-0000-4000-8000-0000000000a1';
let repo: KyselyMembershipBillingRepository; let pg: any;
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','memcyc','MEMCYC1','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','One');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B}','A','B','A B');
    INSERT INTO membership_plans (id, tenant_id, name, status) VALUES ('${P}','${T}','Gold','active');
    INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number) VALUES ('${V}','${P}','${T}',1);
    INSERT INTO membership_benefits (plan_version_id, tenant_id, benefit_type, label, credits_per_cycle, value_cents, percent) VALUES
      ('${V}','${T}','service_credit','Pedicure',2,0,0), ('${V}','${T}','dollar_credit','$25',0,2500,0), ('${V}','${T}','percent_discount','10% off',0,0,10);
    INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${M}','${T}','${B}','${C}','${P}','${V}','active','M-CYC1');`);
  repo = new KyselyMembershipBillingRepository(kyselyFor(pg));
}, 120_000);

describe('renewal issues the cycle credits', () => {
  it('one row per crediting benefit, once per cycle', async () => {
    expect(await repo.issueCycleCredits(T, M, V, '2026-12-01T00:00:00.000Z')).toBe(2);
    expect(await repo.issueCycleCredits(T, M, V, '2026-12-01T00:00:00.000Z')).toBe(0);   // replay
    expect(await repo.issueCycleCredits(T, M, V, '2027-01-01T00:00:00.000Z')).toBe(2);   // next cycle
    const rows = (await pg.query(`SELECT quantity, amount_cents::int AS a FROM membership_credit_ledger WHERE customer_membership_id = '${M}' AND reason = 'renewal:2026-12-01T00:00:00.000Z' ORDER BY quantity`)).rows;
    expect(rows).toEqual([{ quantity: 0, a: 2500 }, { quantity: 2, a: 0 }]);
  });

  it('the previous cycle\'s unused credits expire at renewal unless the benefit rolls over; held credits stay', async () => {
    const M2 = '7e000000-0000-4000-8000-0000000000a2', V2 = '7e000000-0000-4000-8000-0000000000f2';
    await pg.exec(`INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number) VALUES ('${V2}','${P}','${T}',2);
      INSERT INTO membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle, rollover_allowed) VALUES
        ('7e000000-0000-4000-8000-0000000000b8','${V2}','${T}','service_credit','Mani',2,false), ('7e000000-0000-4000-8000-0000000000b9','${V2}','${T}','service_credit','Pedi',1,true);
      INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${M2}','${T}','${B}','${C}','${P}','${V2}','active','M-CYC2');`);
    expect(await repo.issueCycleCredits(T, M2, V2, '2026-12-01T00:00:00.000Z')).toBe(2);   // Mani 2, Pedi 1
    await pg.exec(`INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, amount_cents, reservation_ref, reason) VALUES
      ('${T}','${M2}','7e000000-0000-4000-8000-0000000000b8','reserved',1,0,'7e000000-0000-4000-8000-00000000f001','booking_reserve')`);   // one Mani held for a booking
    await repo.issueCycleCredits(T, M2, V2, '2027-01-01T00:00:00.000Z');
    await repo.issueCycleCredits(T, M2, V2, '2027-01-01T00:00:00.000Z');   // replay: nothing twice
    const exp = (await pg.query(`SELECT benefit_id, quantity FROM membership_credit_ledger WHERE customer_membership_id = '${M2}' AND entry_type = 'expired'`)).rows;
    expect(exp).toEqual([{ benefit_id: '7e000000-0000-4000-8000-0000000000b8', quantity: 1 }]);   // 2 issued − 1 held; Pedi rolls over
  });
});

describe('D6 §16: first payment on real SQL (Kysely adapter)', () => {
  it('a paid invoice activates a pending membership in one transaction: payment, period, credits, audit; the invoice cannot pay twice', async () => {
    const { MembershipBillingService } = await import('./membership-billing.service');
    const M3 = '7e000000-0000-4000-8000-0000000000a3', M4 = '7e000000-0000-4000-8000-0000000000a4', INV = '7e000000-0000-4000-8000-0000000000c3';
    await pg.exec(`UPDATE membership_plan_versions SET price_cents = 6000, enrollment_fee_cents = 1500, billing_interval = 'month', interval_count = 1 WHERE id = '${V}';
      INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number, auto_renew) VALUES
        ('${M3}','${T}','${B}','${C}','${P}','${V}','pending','M-CYC3', true), ('${M4}','${T}','${B}','${C}','${P}','${V}','pending','M-CYC4', true);
      INSERT INTO invoices (id, tenant_id, branch_id, customer_id, invoice_number, status, issue_date, subtotal_cents, tax_cents, total_cents, paid_at)
        VALUES ('${INV}','${T}','${B}','${C}','INV-0001','paid', current_date, 7500, 0, 7500, now());`);
    const svc = new MembershipBillingService(repo);
    const ctx = { tenantId: T, userId: null, role: 'MANAGER' };
    const st = await svc.firstPaymentState(ctx, M3);
    expect(st).toMatchObject({ awaitingFirstPayment: true, amountDueCents: 7500, cardBillingConfigured: false });
    expect(st.invoices.map((i: any) => i.id)).toEqual([INV]);
    const r = await svc.collectFirstPayment(ctx, M3, { method: 'invoice', invoiceId: INV });
    expect(r).toMatchObject({ status: 'active', amountCents: 7500 });
    const m = (await pg.query(`SELECT status, current_period_end IS NOT NULL AS has_end, next_billing_at IS NOT NULL AS has_next, cycles_billed FROM customer_memberships WHERE id = '${M3}'`)).rows[0];
    expect(m).toEqual({ status: 'active', has_end: true, has_next: true, cycles_billed: 1 });
    expect((await pg.query(`SELECT kind, status, processor, processor_ref, amount_cents::int AS a FROM membership_payments WHERE customer_membership_id = '${M3}'`)).rows)
      .toEqual([{ kind: 'enrollment', status: 'succeeded', processor: 'invoice', processor_ref: INV, a: 7500 }]);
    expect(Number((await pg.query(`SELECT count(*) n FROM membership_credit_ledger WHERE customer_membership_id = '${M3}' AND entry_type = 'issued'`)).rows[0].n)).toBe(2);
    expect((await pg.query(`SELECT action FROM membership_audit WHERE customer_membership_id = '${M3}'`)).rows.map((x: any) => x.action)).toContain('first_payment_collected');
    await expect(svc.collectFirstPayment(ctx, M4, { method: 'invoice', invoiceId: INV })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE' });
    expect((await pg.query(`SELECT status FROM customer_memberships WHERE id = '${M4}'`)).rows[0].status).toBe('pending');
  });
});

describe('Nov 4 2026: the plan\'s rollover switch, "Rollover max (cycles)" and "Credit expiry (days)" are applied', () => {
  const bal = async (m: string, b: string) => Number((await pg.query(`SELECT coalesce(sum(case when entry_type in ('issued','rolled_over','restored') then quantity when entry_type in ('redeemed','expired') then -quantity else 0 end),0)::int n
    FROM membership_credit_ledger WHERE customer_membership_id = '${m}' AND benefit_id = '${b}'`)).rows[0].n);
  it('the plan switch rolls credits over even when the benefit box is off; the max-cycles cap expires the excess', async () => {
    const W3 = '7e000000-0000-4000-8000-0000000000f3', X3 = '7e000000-0000-4000-8000-0000000002a3', BEN = '7e000000-0000-4000-8000-0000000002c3';
    await pg.exec(`INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number, rollover_allowed, rollover_max_cycles) VALUES ('${W3}','${P}','${T}',3,true,2);
      INSERT INTO membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle, rollover_allowed) VALUES ('${BEN}','${W3}','${T}','service_credit','Gel',1,false);
      INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${X3}','${T}','${B}','${C}','${P}','${W3}','active','M-CYX3');`);
    for (const k of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']) await repo.issueCycleCredits(T, X3, W3, k + 'T00:00:00.000Z');
    // never redeemed: at each renewal the carried balance is capped at 2 cycles' worth, then a new cycle is added → 3
    expect(await bal(X3, BEN)).toBe(3);
  });
  it('max cycles 0 = no cap (a plan that rolls over keeps everything, as before)', async () => {
    const W4 = '7e000000-0000-4000-8000-0000000000f4', X4 = '7e000000-0000-4000-8000-0000000002a4', BEN = '7e000000-0000-4000-8000-0000000000c4';
    await pg.exec(`INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number, rollover_allowed, rollover_max_cycles) VALUES ('${W4}','${P}','${T}',4,true,0);
      INSERT INTO membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle) VALUES ('${BEN}','${W4}','${T}','service_credit','Gel',1);
      INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${X4}','${T}','${B}','${C}','${P}','${W4}','active','M-CYX4');`);
    for (const k of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']) await repo.issueCycleCredits(T, X4, W4, k + 'T00:00:00.000Z');
    expect(await bal(X4, BEN)).toBe(4);
  });
  it('credit expiry (days): what is older than N days expires, oldest spent first; once per day; held credits stay', async () => {
    const W5 = '7e000000-0000-4000-8000-0000000000f5', X5 = '7e000000-0000-4000-8000-0000000002a5', BEN = '7e000000-0000-4000-8000-0000000000c5';
    await pg.exec(`INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number, rollover_allowed, credit_expiry_days) VALUES ('${W5}','${P}','${T}',5,true,30);
      INSERT INTO membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle) VALUES ('${BEN}','${W5}','${T}','service_credit','Gel',2);
      INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${X5}','${T}','${B}','${C}','${P}','${W5}','active','M-CYX5');
      INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, amount_cents, reason, created_at) VALUES
        ('${T}','${X5}','${BEN}','issued',2,0,'renewal:old','2026-09-01T00:00:00Z'),
        ('${T}','${X5}','${BEN}','redeemed',1,0,'visit','2026-09-10T00:00:00Z'),
        ('${T}','${X5}','${BEN}','issued',2,0,'renewal:new','2026-10-25T00:00:00Z');`);
    const now = new Date('2026-11-04T12:00:00Z');
    expect(await repo.expireAgedCredits(now)).toBeGreaterThanOrEqual(1);
    expect(await bal(X5, BEN)).toBe(2);                 // the September credit left over (1) expired; the October 2 stay
    expect(await repo.expireAgedCredits(now)).toBe(0);  // once per day
  });
});
