// refund-void-producer.pgtest — payment.voided / payment.refunded were declared since Constitution 8 and recorded by
// nothing. Checkout records each ONCE, at the real transition, in the same transaction as the write.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';

const T = '17171717-1717-4171-8171-171717171717', B = '18181818-1818-4181-8181-181818181818';
const CU = '1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d', TK = '19191919-1919-4191-8191-191919191919', P1 = '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a', P2 = '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b';
const ctx = { tenantId: T, branchId: B, userId: '1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c' } as any;
let db: any; let repo: KyselyCheckoutRepository;
const facts = async (type: string) => (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','R','Refund Salon','refund','REFND1','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CU}','${T}','${B}','Rae','Lo','Rae Lo','+16095550177','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TK}','${T}','${B}','${CU}') ON CONFLICT (id) DO NOTHING;
    INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES
      ('${P1}','${T}','${B}','${TK}','card',5000,'approved'), ('${P2}','${T}','${B}','${TK}','card',8000,'approved');
  `);
  repo = new KyselyCheckoutRepository(db, new OutboxWriter());
});

describe('payment.voided / payment.refunded are recorded once, at the real transition', () => {
  it('void -> payment.voided; voiding it again records nothing', async () => {
    await repo.markPaymentVoided(ctx, P1);
    await repo.markPaymentVoided(ctx, P1);
    const v = await facts('payment.voided');
    expect(v.map((r) => r.aggregate_id)).toEqual([P1]);
    expect(v[0].payload_json).toMatchObject({ paymentId: P1, ticketId: TK, method: 'card', amountCents: 5000 });
  });
  it('reserve + finalize -> payment.refunded once (a second finalize records nothing); a released reservation records nothing', async () => {
    const r: any = await repo.reserveRefundAtomic(ctx, { paymentId: P2, capturedCents: 8000, amountCents: 3000, method: 'card', canApprove: true } as any);
    expect(r.ok).toBe(true);
    await repo.finalizeRefund(ctx, r.refundId, 'proc-1');
    await repo.finalizeRefund(ctx, r.refundId, 'proc-1');
    const released: any = await repo.reserveRefundAtomic(ctx, { paymentId: P2, capturedCents: 8000, amountCents: 1000, method: 'card', canApprove: true } as any);
    await repo.releaseRefund(ctx, released.refundId);
    const f = await facts('payment.refunded');
    expect(f.map((x) => x.aggregate_id)).toEqual([r.refundId]);
    expect(f[0].payload_json).toEqual({ refundId: r.refundId, paymentId: P2, amountCents: 3000 });
  });
});
