// payment-webhook-dedupe.pgtest — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider"), on the
// real migrated schema. The same signed event delivered twice — one after the other AND concurrently (a processor retry
// racing the original) — changes the database once; a bad signature changes nothing.
//   • card processors (Fiserv / CardPointe / Clover share POST /webhooks/payments/:processor): refund, settlement,
//     chargeback, status move — counted in payment_refunds / payment_settlements / chargebacks / payment_gateway_events;
//     an event with NO event id is still deduped by its money key (refund id / settlement id / case id);
//   • bank deposits (POST /webhooks/bank/:token): one bank_deposits row per external transaction id.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { PaymentWebhookService, BankWebhookService, KyselyWebhookRepository } from '@aipowersalon/payments';

let pg: any; let db: any;
const TA = 'd1400000-0000-4000-8000-00000000000a', TB = 'd1400000-0000-4000-8000-00000000000b';
const BA = 'd1410000-0000-4000-8000-00000000000a', BB = 'd1410000-0000-4000-8000-00000000000b';
const CA = 'd1420000-0000-4000-8000-00000000000a', KA = 'd1430000-0000-4000-8000-00000000000a';
const ACC = 'd1440000-0000-4000-8000-00000000000a';
const SECRET_A = 'p14-webhook-fixture-a', SECRET_B = 'p14-webhook-fixture-b';   // test fixtures, not credentials
const resolver: any = { resolveTenantByMerchantId: async (mid: string) => mid === 'MID-A' ? { tenantId: TA, webhookSecret: SECRET_A, merchantIdMasked: '***A' } : mid === 'MID-B' ? { tenantId: TB, webhookSecret: SECRET_B, merchantIdMasked: '***B' } : null };
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];
const count = async (table: string, where: string, p: unknown[] = []) => Number((await one(`SELECT count(*)::int c FROM ${table} WHERE ${where}`, p)).c);

async function payment(tenant: string, branch: string, ticket: string, txn: string, status = 'approved'): Promise<string> {
  return (await one(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, status, processor_transaction_id, amount_cents) VALUES ($1, $2, $3, 'card', $4, $5, 2500) RETURNING id`, [tenant, branch, ticket, status, txn])).id;
}
function deliver(processor: string, body: Record<string, unknown>, secret = SECRET_A) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return new PaymentWebhookService(db, resolver).handle(processor, raw, body, sig, { 'x-webhook-signature': sig });
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[TA, 'P14WA'], [TB, 'P14WB']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A'), ('${BB}', '${TB}', 'B')`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'A', 'A', 'A A')`);
  await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${KA}', '${TA}', '${BA}', '${CA}')`);
}, 120_000);

describe.each(['fiserv', 'cardpointe', 'clover'])('card processor %s: the same event twice is applied once', (proc) => {
  it('a refund delivered twice (in sequence) → one refund row, one processed ledger row, the second answer is "duplicate"', async () => {
    const txn = `rr-${proc}-seq`;
    const p = await payment(TA, BA, KA, txn);
    const body = { merchantId: 'MID-A', eventType: 'refund.completed', eventId: `evt-${proc}-seq`, transactionId: txn, refundId: `rf-${proc}-seq`, amountCents: 2500 };
    expect((await deliver(proc, body)).body).toMatchObject({ ok: true, recordedRefund: true, statusApplied: null });   // the original tender keeps its status (audit Nov 3 2026)
    expect((await deliver(proc, body)).body).toMatchObject({ ok: true, duplicate: true });
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(1);
    expect(await count('payment_gateway_events', `event_id = $1 AND processed_at IS NOT NULL`, [body.eventId])).toBe(1);
  });

  it('a refund delivered twice CONCURRENTLY (a retry racing the original) → still one refund row and one processed ledger row', async () => {
    const txn = `rr-${proc}-race`;
    const p = await payment(TA, BA, KA, txn);
    const body = { merchantId: 'MID-A', eventType: 'refund.completed', eventId: `evt-${proc}-race`, transactionId: txn, refundId: `rf-${proc}-race`, amountCents: 2500 };
    const out = await Promise.all([deliver(proc, body), deliver(proc, body), deliver(proc, body)]);
    expect(out.every((o) => o.status === 200)).toBe(true);
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(1);
    expect(await count('payment_gateway_events', `event_id = $1 AND processed_at IS NOT NULL`, [body.eventId])).toBe(1);
    expect(out.filter((o) => (o.body as any).recordedRefund).length).toBe(1);
    expect(out.filter((o) => (o.body as any).duplicate === true).length).toBe(2);   // the losers SAY duplicate (the webhook counters read it)
  });

  it('money in dollars is cents ×100; a partial refund leaves the sale counted; a refund the POS already recorded is not added twice (audit Nov 3 2026)', async () => {
    const txn = `rr-${proc}-usd`;
    const p = await payment(TA, BA, KA, txn);
    const before = (await pg.query(`select status from payments where id = $1`, [p])).rows[0].status;
    await deliver(proc, { merchantId: 'MID-A', eventType: 'refund.completed', eventId: `evt-${proc}-usd`, transactionId: txn, refundId: `rf-${proc}-usd`, amount: '12.50' });
    expect((await pg.query(`select amount_cents from payment_refunds where payment_id = $1`, [p])).rows.map((r: any) => Number(r.amount_cents))).toEqual([1250]);
    expect((await pg.query(`select status from payments where id = $1`, [p])).rows[0].status).toBe(before);
    // the POS refunded $5.00 itself (its own reference); the gateway's callback for it names a different refund id
    await pg.query(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, reason, status, processor_refund_id) values ($1,$2,$3,500,'pos','refunded','pos-ref-${proc}')`, [TA, BA, p]);
    await deliver(proc, { merchantId: 'MID-A', eventType: 'refund.completed', eventId: `evt-${proc}-usd2`, transactionId: txn, refundId: `gw-${proc}-usd2`, amount: '5.00' });
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(2);
    await deliver(proc, { merchantId: 'MID-A', eventType: 'settlement.batch_closed', eventId: `evt-${proc}-usd3`, settlementId: `B-${proc}-usd`, gross: '1164.30', fee: '35.00' });
    expect((await pg.query(`select gross_cents, fee_cents, net_cents from payment_settlements where tenant_id = $1 and settlement_id = $2`, [TA, `B-${proc}-usd`])).rows[0]).toMatchObject({ gross_cents: 116430, fee_cents: 3500, net_cents: 112930 });
  });

  it('a settlement batch delivered twice concurrently → one settlement row', async () => {
    const body = { merchantId: 'MID-A', eventType: 'settlement.batch_closed', eventId: `evt-${proc}-stl`, settlementId: `B-${proc}`, grossCents: 5000 };
    await Promise.all([deliver(proc, body), deliver(proc, body)]);
    expect(await count('payment_settlements', `tenant_id = $1 AND settlement_id = $2`, [TA, `B-${proc}`])).toBe(1);
  });

  it('events with NO event id are deduped by their money key (refund id, settlement id, chargeback case id)', async () => {
    const txn = `rr-${proc}-noid`;
    const p = await payment(TA, BA, KA, txn);
    const refund = { merchantId: 'MID-A', eventType: 'refund.completed', transactionId: txn, refundId: `rf-${proc}-noid`, amountCents: 2500 };
    await Promise.all([deliver(proc, refund), deliver(proc, refund)]);
    await deliver(proc, refund);
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(1);
    const stl = { merchantId: 'MID-A', eventType: 'settlement.completed', settlementId: `B-${proc}-noid`, grossCents: 100 };
    await Promise.all([deliver(proc, stl), deliver(proc, stl)]);
    expect(await count('payment_settlements', `tenant_id = $1 AND settlement_id = $2`, [TA, `B-${proc}-noid`])).toBe(1);
    const cb = { merchantId: 'MID-A', eventType: 'chargeback.created', chargebackId: `CB-${proc}`, amountCents: 900 };
    await Promise.all([deliver(proc, cb), deliver(proc, cb)]);
    expect(await count('chargebacks', `tenant_id = $1 AND chargeback_id = $2`, [TA, `CB-${proc}`])).toBe(1);
  });

  it('a bad signature is refused (401) and applies nothing', async () => {
    const txn = `rr-${proc}-forged`;
    const p = await payment(TA, BA, KA, txn);
    const body = { merchantId: 'MID-A', eventType: 'refund.completed', eventId: `evt-${proc}-forged`, transactionId: txn, refundId: `rf-${proc}-forged`, amountCents: 2500 };
    const res = await deliver(proc, body, SECRET_B);   // signed with ANOTHER salon's secret
    expect(res.status).toBe(401);
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(0);
    expect((await one(`SELECT status FROM payments WHERE id = $1`, [p])).status).toBe('approved');
    expect(await count('payment_gateway_events', `event_id = $1 AND processed_at IS NOT NULL`, [body.eventId])).toBe(0);
  });
});

describe('the same processor event id at two salons is two events (dedupe is per processor, not global)', () => {
  it("salon B's event that happens to reuse salon A's event id is still applied", async () => {
    const cB = (await one(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'B', 'B', 'B B') RETURNING id`, [TB, BB])).id;
    const kB = (await one(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [TB, BB, cB])).id;
    const pA = await payment(TA, BA, KA, 'rr-shared-a'), pB = await payment(TB, BB, kB, 'rr-shared-b');
    await deliver('fiserv', { merchantId: 'MID-A', eventType: 'refund.completed', eventId: 'evt-shared', transactionId: 'rr-shared-a', refundId: 'rf-a', amountCents: 1 });
    await deliver('clover', { merchantId: 'MID-B', eventType: 'refund.completed', eventId: 'evt-shared', transactionId: 'rr-shared-b', refundId: 'rf-b', amountCents: 1 }, SECRET_B);
    expect(await count('payment_refunds', 'payment_id = ANY($1)', [[pA, pB]])).toBe(2);
  });
});

describe('bank deposit webhook: the same deposit twice is one deposit', () => {
  const sealer = testProviderSecrets;
  const T0 = () => Math.floor(Date.now() / 1000);   // signer and verifier read the same process clock (freshness window)
  const sign = (secret: string, raw: string) => { const t = T0(); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; };
  beforeAll(async () => {
    await pg.query(`INSERT INTO bank_webhook_endpoints (tenant_id, bank_account_id, token_hash, signing_secret_enc, status) VALUES ($1, $2, $3, $4, 'active')`,
      [TA, ACC, createHash('sha256').update('tok-p14').digest('hex'), sealer.encrypt('whsec-p14')]);
  });
  const svc = () => new BankWebhookService(new KyselyWebhookRepository(db, sealer as any));
  it('in sequence and concurrently → one bank_deposits row; the repeats answer already_processed', async () => {
    const raw = JSON.stringify({ amountCents: 29100, externalBankTxnId: 'BANK-P14-1', reference: 'ACH-1' });
    const first = await svc().ingest('tok-p14', raw, sign('whsec-p14', raw));
    expect(first).toMatchObject({ status: 200, reason: 'accepted' });
    const again = await Promise.all([svc().ingest('tok-p14', raw, sign('whsec-p14', raw)), svc().ingest('tok-p14', raw, sign('whsec-p14', raw))]);
    expect(again.map((r) => r.reason)).toEqual(['already_processed', 'already_processed']);
    expect(await count('bank_deposits', `tenant_id = $1 AND external_bank_txn_id = 'BANK-P14-1'`, [TA])).toBe(1);
  });
  it('a bad signature is refused and writes nothing', async () => {
    const raw = JSON.stringify({ amountCents: 100, externalBankTxnId: 'BANK-P14-FORGED' });
    expect((await svc().ingest('tok-p14', raw, sign('not-the-secret', raw))).status).toBe(401);
    expect(await count('bank_deposits', `external_bank_txn_id = 'BANK-P14-FORGED'`)).toBe(0);
  });
});

describe('Security Deep Scan E7: the merchant\'s configured processor decides, not the path', () => {
  const cfg: any = { resolveTenantByMerchantId: async (mid: string) => mid === 'MID-A' ? { tenantId: TA, webhookSecret: SECRET_A, merchantIdMasked: '***A', processorType: 'cardpointe' } : null };
  const send = (processor: string, body: Record<string, unknown>) => {
    const raw = JSON.stringify(body); const sig = createHmac('sha256', SECRET_A).update(raw, 'utf8').digest('hex');
    return new PaymentWebhookService(db, cfg).handle(processor, raw, body, sig, { 'x-webhook-signature': sig });
  };
  it('a delivery under another processor family\'s path is refused and applies nothing', async () => {
    const txn = 'rr-e7-family'; const p = await payment(TA, BA, KA, txn);
    const res = await send('clover', { merchantId: 'MID-A', eventType: 'refund.completed', eventId: 'evt-e7-family', transactionId: txn, refundId: 'rf-e7-family', amountCents: 2500 });
    expect(res).toMatchObject({ status: 400, body: { code: 'processor_mismatch' } });
    expect(await count('payment_refunds', 'payment_id = $1', [p])).toBe(0);
  });
  it('the same event re-posted under /fiserv and /cardpointe (same family) is ONE event', async () => {
    const txn = 'rr-e7-replay'; const p = await payment(TA, BA, KA, txn);
    const body = { merchantId: 'MID-A', eventType: 'chargeback.created', eventId: 'evt-e7-replay', transactionId: txn, chargebackId: 'CB-e7', amountCents: 900 };
    expect((await send('cardpointe', body)).body).toMatchObject({ ok: true, recordedChargeback: true });
    expect((await send('fiserv', body)).body).toMatchObject({ ok: true, duplicate: true });
    expect(await count('payment_gateway_events', `event_id = 'evt-e7-replay' AND processed_at IS NOT NULL`)).toBe(1);
    expect((await one(`SELECT processor_type FROM payment_gateway_events WHERE event_id = 'evt-e7-replay' AND processed_at IS NOT NULL`)).processor_type).toBe('cardpointe');
    expect(p).toBeTruthy();
  });
  it('an event with no id, replayed byte-for-byte, is a duplicate (keyed by its signed bytes)', async () => {
    const body = { merchantId: 'MID-A', eventType: 'onboarding.under_review', note: 'e7-noid' };
    expect((await send('cardpointe', body)).body).toMatchObject({ ok: true });
    expect((await send('cardpointe', body)).body).toMatchObject({ ok: true, duplicate: true });
  });
});
