// payment-webhook-inbox-failure.pgtest — Payments mandate §45 / §158 (wave 3), on the real schema: when a verified, new
// delivery's business processing THROWS after the claim, the inbox row keeps the delivery with its error and attempt
// count and RELEASES the claim, the processor is answered 500 (retry), and the retry processes the event once.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentWebhookService } from '@aipowersalon/payments';

let pg: any; let db: any;
const TA = 'd1500000-0000-4000-8000-00000000000a', BA = 'd1510000-0000-4000-8000-00000000000a', CA = 'd1520000-0000-4000-8000-00000000000a', KA = 'd1530000-0000-4000-8000-00000000000a';
const SECRET_A = 'p15-webhook-fixture-a';   // test fixture, not a credential
const resolver: any = { resolveTenantByMerchantId: async (mid: string) => (mid === 'MID-A' ? { tenantId: TA, webhookSecret: SECRET_A, merchantIdMasked: '***A' } : null) };
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];

function deliver(svc: PaymentWebhookService, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET_A).update(raw, 'utf8').digest('hex');
  return svc.handle('fiserv', raw, body, sig, { 'x-webhook-signature': sig });
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${TA}', 'P15WA', 'P15WA', 'p15wa', 'P15WA', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A')`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'A', 'A', 'A A')`);
  await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${KA}', '${TA}', '${BA}', '${CA}')`);
  await pg.exec(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, status, processor_transaction_id, amount_cents) VALUES ('${TA}', '${BA}', '${KA}', 'card', 'approved', 'txn-fail-1', 2500)`);
}, 120_000);

describe('webhook inbox — processing failure after the claim (§45)', () => {
  it('500 + the row keeps attempts/last_error and releases its claim; the retry applies the event once', async () => {
    const svc = new PaymentWebhookService(db, resolver);
    // sabotage the first run's effects: the refund insert path throws (a transient DB error stand-in)
    const real = (svc as any).applyEffects.bind(svc);
    let calls = 0;
    (svc as any).applyEffects = async (a: any) => { calls++; if (calls === 1) throw new Error('simulated: payment_refunds unavailable'); return real(a); };
    const body = { merchantId: 'MID-A', eventType: 'refund.completed', eventId: 'evt-fail-1', transactionId: 'txn-fail-1', refundId: 'rf-fail-1', amountCents: 2500 };

    const first = await deliver(svc, body);
    expect(first.status).toBe(500);
    expect(first.body).toMatchObject({ ok: false, code: 'processing_failed' });
    const row = await one(`SELECT processed_at, processing_attempts, last_error FROM payment_gateway_events WHERE tenant_id = $1 AND event_id = $2`, [TA, 'evt-fail-1']);
    expect(row.processed_at).toBeNull();                       // claim released → the retry can process
    expect(Number(row.processing_attempts)).toBe(1);
    expect(row.last_error).toMatch(/simulated: payment_refunds unavailable/);
    expect(Number((await one(`SELECT count(*)::int c FROM payment_refunds WHERE tenant_id = $1`, [TA])).c)).toBe(0);   // nothing applied

    const retry = await deliver(svc, body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, recordedRefund: true });
    expect(Number((await one(`SELECT count(*)::int c FROM payment_refunds WHERE tenant_id = $1`, [TA])).c)).toBe(1);
    const rows = await pg.query(`SELECT processed_at, processing_attempts, last_error FROM payment_gateway_events WHERE tenant_id = $1 AND event_id = $2 ORDER BY created_at`, [TA, 'evt-fail-1']);
    expect(rows.rows.length).toBe(2);                           // the failed delivery stays visible (§158), the retry is its own processed row
    expect(rows.rows.filter((r: any) => r.processed_at !== null).length).toBe(1);
    expect((await deliver(svc, body)).body).toMatchObject({ duplicate: true });   // a third delivery is a duplicate
  });
});
