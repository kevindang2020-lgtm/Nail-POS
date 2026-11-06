// payment-webhook-schemas.pgtest — Security Deep Scan §110 on the real migrated schema. A SIGNED delivery whose shape is
// wrong for its processor changes nothing: no refund, no settlement, no payment status move, no processed claim — the
// delivery is kept in the ledger with the failing field names, and a corrected re-delivery of the same event processes.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentWebhookService } from '@aipowersalon/payments';

let pg: any; let db: any;
const TA = 'd1100000-0000-4000-8000-00000000000a', BA = 'd1110000-0000-4000-8000-00000000000a';
const CA = 'd1120000-0000-4000-8000-00000000000a', KA = 'd1130000-0000-4000-8000-00000000000a';
const SECRET = 'p110-webhook-fixture';   // a test fixture, not a credential
const resolverFor = (processorType?: string): any => ({ resolveTenantByMerchantId: async (mid: string) => mid === 'MID-110' ? { tenantId: TA, webhookSecret: SECRET, merchantIdMasked: '***0', processorType } : null });
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];
const count = async (table: string, where: string, p: unknown[] = []) => Number((await one(`SELECT count(*)::int c FROM ${table} WHERE ${where}`, p)).c);
function deliver(processor: string, body: unknown, configured?: string) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  return new PaymentWebhookService(db, resolverFor(configured)).handle(processor, raw, body, sig, { 'x-webhook-signature': sig });
}
async function payment(txn: string): Promise<string> {
  return (await one(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, status, processor_transaction_id, amount_cents) VALUES ($1, $2, $3, 'card', 'approved', $4, 2500) RETURNING id`, [TA, BA, KA, txn])).id;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${TA}', 'P110', 'P110', 'p110', 'P110', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A')`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'A', 'A', 'A A')`);
  await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${KA}', '${TA}', '${BA}', '${CA}')`);
}, 120_000);

describe('§110: a signed delivery of the wrong shape changes nothing', () => {
  it('a refund with fractional cents → 400 invalid_payload; no refund; the ledger keeps it unprocessed with the field name; the corrected re-delivery processes', async () => {
    const p = await payment('rr-110-a');
    const bad = { merchantId: 'MID-110', eventType: 'refund.completed', eventId: 'evt-110-a', transactionId: 'rr-110-a', refundId: 'rf-110-a', amountCents: 12.5 };
    const out = await deliver('fiserv', bad);
    expect(out).toMatchObject({ status: 400, body: { ok: false, code: 'invalid_payload', errors: [{ field: 'amountCents', rule: 'cents' }] } });
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(0);
    const row = await one(`SELECT processed_at, signature_valid, last_error FROM payment_gateway_events WHERE event_id = 'evt-110-a'`);
    expect(row).toMatchObject({ processed_at: null, signature_valid: true });
    expect(row.last_error).toBe('invalid_payload: amountCents:cents');
    expect((await deliver('fiserv', { ...bad, amountCents: 1250 })).body).toMatchObject({ ok: true, recordedRefund: true });
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(1);
  });

  it('a Clover merchant: a CardPointe transaction name is refused and the payment does not move', async () => {
    await payment('rr-110-b');
    const out = await deliver('clover', { merchantId: 'MID-110', eventType: 'transaction.voided', eventId: 'evt-110-b', retref: 'rr-110-b' }, 'clover');
    expect(out).toMatchObject({ status: 400, body: { code: 'invalid_payload', errors: [{ field: 'retref', rule: 'other_processor_field' }] } });
    expect((await one(`SELECT status FROM payments WHERE processor_transaction_id = 'rr-110-b'`)).status).toBe('approved');
  });

  it('two transaction ids that disagree → refused (the parser would have silently used the first)', async () => {
    await payment('rr-110-c');
    const out = await deliver('cardpointe', { merchantId: 'MID-110', eventType: 'transaction.voided', eventId: 'evt-110-c', transactionId: 'rr-110-c', retref: 'rr-110-OTHER' });
    expect(out).toMatchObject({ status: 400, body: { code: 'invalid_payload', errors: [{ field: 'transactionId|retref', rule: 'conflicting_fields' }] } });
    expect((await one(`SELECT status FROM payments WHERE processor_transaction_id = 'rr-110-c'`)).status).toBe('approved');
  });

  it('a settlement with an object amount → no settlement row', async () => {
    const out = await deliver('fiserv', { merchantId: 'MID-110', eventType: 'settlement.batch_closed', eventId: 'evt-110-d', settlementId: 'B-110-d', grossCents: { $gt: 0 } });
    expect(out.status).toBe(400);
    expect(await count('payment_settlements', `settlement_id = 'B-110-d'`)).toBe(0);
  });

  it('an unknown field is kept, never read, and named back (report mode, the default)', async () => {
    const out = await deliver('fiserv', { merchantId: 'MID-110', eventType: 'onboarding.under_review', eventId: 'evt-110-e', note: 'informational' });
    expect(out).toMatchObject({ status: 200, body: { ok: true, unknownFields: ['note'] } });
  });

  it('an unknown processor path has no schema — its signed delivery is handled as before', async () => {
    const out = await deliver('someprocessor', { merchantId: 'MID-110', eventType: 'onboarding.under_review', eventId: 'evt-110-f', amountCents: 1.5 });
    expect(out.status).toBe(200);
  });
});
