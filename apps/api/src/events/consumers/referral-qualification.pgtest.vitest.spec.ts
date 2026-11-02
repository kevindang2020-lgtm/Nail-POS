// referral-qualification.pgtest — the Checkout consumer (Referral Program guide §13): checkout.completed qualifies the referred
// customer's first paid visit and (no approval required) issues ONE reward; the same event again changes nothing; payment.refunded
// reverses it once; a payment of another salon is a security failure. Direct handler calls inside a real transaction.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { ReferralProgram } from '@aipowersalon/customers';
import { ReferralQualificationConsumer } from './referral-qualification.consumer';

const P = 'd7511000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4), REF = id(10), NEW = id(11), XC = id(12);
let db: any; const q = async (s: any) => (await s.execute(db)).rows as any[];
const ev = (eventType: string, tenantId: string, payload: Record<string, unknown>, n: number) => ({ eventId: id(900 + n), eventType, tenantId, aggregateId: String(payload.ticketId ?? payload.refundId ?? ''), payload }) as any;
const consumer = new ReferralQualificationConsumer();
const handle = (e: any) => db.transaction().execute((trx: any) => consumer.handle(e, trx));
let ticket = ''; let payment = '';

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'R', 'rq-751', 'RQ751', 'active'), (${X}, 'X', 'X', 'rq-751x', 'RQ751X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${REF}, ${T}, ${B}, 'Ref', 'One', 'Ref One', '+16095557001', 'active'),
    (${NEW}, ${T}, ${B}, 'New', 'One', 'New One', '+16095557002', 'active'), (${XC}, ${X}, ${BX}, 'X', 'One', 'X One', '+16095557003', 'active')`);
  await q(sql`insert into customer_referrals (tenant_id, customer_id, code) values (${T}, ${REF}, 'RQREF1')`);
  const rp = new ReferralProgram(db);
  await rp.saveSettings({ tenantId: T, branchId: B, userId: id(50), role: 'OWNER', permissions: [] } as any, { rewardType: 'loyalty_points', rewardPoints: 20, requiresApproval: false, expectedVersion: 0 }, async () => undefined);
  await rp.record({ tenantId: T, branchId: B, userId: id(50), role: 'OWNER', permissions: [] } as any, { code: 'RQREF1', referredCustomerId: NEW, idempotencyKey: 'rq-1' });
  ticket = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at) values (${T}, ${B}, ${NEW}, 'paid', 4000, 0, 0, 4000, now()) returning id`))[0].id;
  payment = (await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T}, ${B}, ${ticket}, 'cash', 4000, 0, 'approved') returning id`))[0].id;
}, 240_000);

describe('ReferralQualificationConsumer', () => {
  it('checkout.completed qualifies the first paid visit and issues ONE reward; delivered again → nothing more', async () => {
    await handle(ev(DOMAIN_EVENTS.CHECKOUT_COMPLETED, T, { ticketId: ticket }, 1));
    await handle(ev(DOMAIN_EVENTS.CHECKOUT_COMPLETED, T, { ticketId: ticket }, 2));
    expect((await q(sql`select state from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${NEW}`))[0].state).toBe('REWARD_ISSUED');
    expect((await q(sql`select entry_type, delta from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards'`)).map((r: any) => `${r.entry_type}:${r.delta}`)).toEqual(['earn:20']);
  });
  it('payment.refunded (full) reverses the reward ONCE', async () => {
    const refund = id(700);
    await q(sql`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, status, reason) values (${refund}, ${T}, ${B}, ${payment}, 4000, 'refunded', 'test')`);
    await handle(ev(DOMAIN_EVENTS.PAYMENT_REFUNDED, T, { refundId: refund, paymentId: payment }, 3));
    await handle(ev(DOMAIN_EVENTS.PAYMENT_REFUNDED, T, { refundId: refund, paymentId: payment }, 4));
    expect((await q(sql`select entry_type, delta from loyalty_ledger where tenant_id = ${T} and source_table = 'referral_rewards' order by created_at`)).map((r: any) => `${r.entry_type}:${r.delta}`)).toEqual(['earn:20', 'reverse:-20']);
    expect((await q(sql`select state from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${NEW}`))[0].state).toBe('REVERSED');
  });
  it('a payment of another salon is a security failure (TenantMismatchError), never an award', async () => {
    await expect(handle(ev(DOMAIN_EVENTS.PAYMENT_REFUNDED, X, { refundId: id(701), paymentId: payment }, 5))).rejects.toThrow(/another tenant/);
    await expect(handle(ev(DOMAIN_EVENTS.CHECKOUT_COMPLETED, X, { ticketId: ticket }, 6))).rejects.toThrow(/another salon/);
  });
});
