// global-rewards.pgtest — the network's consumer through the REAL outbox → publisher → consumer runner path
// (LoyaltyTokens.pdf §6.1–§6.2, §8.1; LoyaltyRules.pdf T11, T12): checkout.completed earns once per ticket, a redelivery
// or a second producer earns nothing more, a cross-tenant ticket is a SECURITY dead letter, and payment.refunded
// reverses with the original snapshot exactly once per refund.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, TenantMismatchError } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { GlobalRewardsConsumer } from './global-rewards.consumer';
import { GlobalRewardsRepository, GR_FLAGS, holdForTicket } from '@aipowersalon/loyalty';
import { sql } from 'kysely';

const P = 'd7340000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), CUST = id('c1'), CUST2 = id('c2'), IDV = id('f1'), OWNER = id('e1');
let pg: any; let db: any; let runner: ConsumerRunner; let publisher: OutboxPublisher; let consumer: GlobalRewardsConsumer; let repo: GlobalRewardsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const completed = (ticketId: string, tenantId = T) => createDomainEvent({ eventType: DOMAIN_EVENTS.CHECKOUT_COMPLETED, tenantId, branchId: B, aggregateType: 'ticket', aggregateId: ticketId,
  actorType: 'user', correlationId: `ticket:${ticketId}`, payload: { ticketId, status: 'paid' } });
const wallet = async () => Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [T]))[0]?.available_cents ?? 0);
const pts = async () => Number((await q(`select available_tenths from global_rewards_accounts where identity_id = $1`, [IDV]))[0]?.available_tenths ?? 0);

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg); consumer = new GlobalRewardsConsumer(); repo = new GlobalRewardsRepository(db);
  const registry = new ConsumerRegistry(); registry.register(consumer);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'G','Glow','gr-c-1','GRC101','active'), ($2,'L','Luxe','gr-c-2','GRC102','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Main','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+16095550177','active'), ($4,$5,$6,'Ava','Kim','Ava Kim','+16095550177','active')`, [CUST, T, B, CUST2, T2, B2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ava Kim','ava-c@gr.test','active','CUSTOMER')`, [id('71'), T]);
  await q(`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values ($1,'+16095550177','Ava Kim','active',now())`, [IDV]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDV, T, id('71'), CUST]);
  await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) values ($1,'2026-10-30','customer_app',now(),'customer_app')`, [IDV]);
  for (const k of [GR_FLAGS.engine, GR_FLAGS.earn, GR_FLAGS.purchases]) await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty','true'::jsonb,'boolean') on conflict (setting_key) do update set value = excluded.value`, [k]);
  await repo.setEnrollment(T, 'enrolled', { reason: 'consumer test salon enrolment', actorUserId: OWNER });
  const pi = await repo.createPurchase({ tenantId: T, branchId: B, userId: OWNER, permissions: ['pos.settings.edit'] }, { tokens: 10, idempotencyKey: 'cons-fund-0001', provider: 'sandbox' });
  await repo.movePurchase(pi.intentId, 'PAYMENT_CONFIRMED', { tenantId: T, source: 'test', providerRef: 'sbx_cons' });
  await repo.movePurchase(pi.intentId, 'FUNDS_VERIFIED', { tenantId: T, source: 'test' });
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid',now()), ($5,$6,$7,$8,'paid',now())`, [id('d1'), T, B, CUST, id('d2'), T2, B2, CUST2]);
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,$4,'card',10000,0,'approved')`, [id('91'), T, B, id('d1')]);
}, 240_000);

describe('loyalty.global_rewards consumer', () => {
  it('checkout.completed through the outbox earns once: 10 points, 1.00 token from the earning salon', async () => {
    await new OutboxWriter().write(db, completed(id('d1'))); await publisher.tick();
    expect(await pts()).toBe(100); expect(await wallet()).toBe(900);
  });
  it('T11 a redelivery / a second producer for the same ticket earns nothing more', async () => {
    const r = await runner.run(consumer, completed(id('d1')));
    expect(r.status).toBe('processed');
    expect(await pts()).toBe(100); expect(await wallet()).toBe(900);
  });
  it('§14 a ticket of another salon is a SECURITY dead letter — nothing awarded', async () => {
    const r = await runner.run(consumer, completed(id('d2'), T));
    expect(r.status).toBe('dead_lettered');
    if (r.status === 'dead_lettered') expect(r.errorClass).toBe('SECURITY');
    expect(await pts()).toBe(100);
  });
  it('T12 payment.refunded reverses with the original snapshot, once per refund', async () => {
    const rf = (await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status) values ($1,$2,$3,4000,'refunded') returning id`, [T, B, id('91')]))[0].id;
    const ev = createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_REFUNDED, tenantId: T, branchId: B, aggregateType: 'payment_refund', aggregateId: rf, actorType: 'user', payload: { refundId: rf, paymentId: id('91'), amountCents: 4000 } });
    await new OutboxWriter().write(db, ev); await publisher.tick();
    expect(await pts()).toBe(60);           // $60 left → 6 points under the original $5 = 0.5 rule
    expect(await wallet()).toBe(940);       // the 4 unused points' backing returns to the earning salon
    await runner.run(consumer, ev);
    expect(await pts()).toBe(60); expect(await wallet()).toBe(940);
  });
});

// The outbox publisher / consumer runner above need the full query builder (CI). The handler itself is raw SQL, so the
// same business cases also run here by calling handle() inside one transaction, exactly as the runner does.
describe('loyalty.global_rewards handler (direct, same transaction contract as the runner)', () => {
  const direct = new GlobalRewardsConsumer(async () => 0);   // no gift-card value on these tickets
  const handle = (e: any) => db.transaction().execute((trx: any) => direct.handle(e, trx));
  it('earns once per ticket; a second delivery adds nothing; a refund reverses once', async () => {
    const tk = id('d5');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid',now())`, [tk, T, B, CUST]);
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,$4,'card',5000,0,'approved')`, [id('95'), T, B, tk]);
    const p0 = await pts(), w0 = await wallet();
    await handle(completed(tk)); await handle(completed(tk));
    expect(await pts()).toBe(p0 + 50); expect(await wallet()).toBe(w0 - 50);
    const rf = (await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status) values ($1,$2,$3,5000,'refunded') returning id`, [T, B, id('95')]))[0].id;
    const ev = createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_REFUNDED, tenantId: T, branchId: B, aggregateType: 'payment_refund', aggregateId: rf, actorType: 'user', payload: { refundId: rf, paymentId: id('95'), amountCents: 5000 } });
    await handle(ev); await handle(ev);
    expect(await pts()).toBe(p0); expect(await wallet()).toBe(w0);
  });
  it('a ticket of another salon throws the platform TenantMismatchError (a SECURITY dead letter in the runner)', async () => {
    await expect(handle(completed(id('d2'), T))).rejects.toBeInstanceOf(TenantMismatchError);
  });
  // Final Completion guide §04–§05 through the real consumer: the paid-ticket event confirms the held reward once, and a
  // refund of the reward tender (payment.refunded on a 'global_reward' payment) returns the points and adjusts the payable
  it('checkout.completed finalizes a held reward once; a refund of the reward tender reverses it once (payable ADJUSTED)', async () => {
    await q(`update global_rewards_accounts set opted_in_at = now(), consent_source = 'customer_app' where identity_id = $1`, [IDV]);
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty','true'::jsonb,'boolean') on conflict (setting_key) do update set value = excluded.value`, [GR_FLAGS.redemption]);
    // self-contained: earn 10 points first ($100 paid at the global $5 = 0.5)
    const seed = id('d8'); await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid',now())`, [seed, T, B, CUST]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',10000,0,'approved')`, [T, B, seed]);
    await handle(completed(seed));
    const tk = id('d7'); await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values ($1,$2,$3,$4,'payment_in_progress',2000)`, [tk, T, B, CUST]);
    const before = await pts(); expect(before).toBeGreaterThanOrEqual(100);
    const pay = await db.transaction().execute(async (trx: any) => {
      const p = (await sql<{ id: string }>`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, idempotency_key) values (${T}::uuid, ${B}::uuid, ${tk}::uuid, 'global_reward', 100, 0, 'approved', 'reward:cons-1') returning id`.execute(trx)).rows[0].id;
      await holdForTicket(trx, repo, { tenantId: T, branchId: B, userId: OWNER }, { ticketId: tk, customerId: CUST, blocks: 1, dueCents: 2000, paymentId: p, idempotencyKey: 'cons-1' });
      return p;
    });
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',1900,0,'approved')`, [T, B, tk]);
    await q(`update tickets set status = 'paid', paid_at = now() where id = $1`, [tk]);
    await handle(completed(tk)); await handle(completed(tk));
    expect((await q(`select status from reward_redemptions where payment_id = $1`, [pay]))[0].status).toBe('CONFIRMED_REDEEMED');
    expect((await q(`select count(*)::int n, min(status) s from merchant_reimbursements where ticket_id = $1`, [tk]))[0]).toEqual({ n: 1, s: 'ACCRUED_OWED' });
    // earning ran on the $19 the customer paid (the reward tender earns nothing): 19 → 3 × $5 → 1.5 points
    expect(await pts()).toBe(before - 100 + 15);
    const rf = id('e7'); await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, reason, status) values ($1,$2,$3,$4,100,'test','refunded')`, [rf, T, B, pay]);
    const ev = createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_REFUNDED, tenantId: T, branchId: B, aggregateType: 'payment_refund', aggregateId: rf, actorType: 'user', payload: { refundId: rf, paymentId: pay, amountCents: 100 } });
    await handle(ev); await handle(ev);
    expect(await pts()).toBe(before + 15);
    expect((await q(`select status from merchant_reimbursements where ticket_id = $1`, [tk]))[0].status).toBe('ADJUSTED');
    // the earn on this ticket was NOT reversed by the reward refund
    expect((await q(`select status from reward_earn_transactions where ticket_id = $1`, [tk]))[0].status).toBe('EARNED');
  });
});
