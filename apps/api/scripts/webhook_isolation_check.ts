/**
 * webhook_isolation_check.ts — verifies inbound payment-webhook ISOLATION end-to-end.
 * Seeds two tenants (each with its own merchant id + webhook secret) and one payment each, then fires real HTTP
 * webhooks at the running API and asserts: unknown merchant rejected; a webhook for tenant A that references tenant B's
 * transaction NEVER updates B's payment; bad signature is not processed; valid event updates only the owning tenant;
 * duplicate event_id is processed once.
 *
 *   DATABASE_URL=… E2E_BASE_URL=http://127.0.0.1:3001 AUTH_SESSION_SECRET=<same as API> npx tsx apps/api/scripts/webhook_isolation_check.ts
 */
import { createHmac, randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { PaymentGatewayResolver } from '../../../modules/payments/src/payments/payment-gateway.resolver';
import { PaymentReconciliationService } from '../../../modules/payments/src/payments/payment-reconciliation.service';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails.push(label);
};

async function tenant(db: Kysely<DB>, code: string): Promise<{ tid: string; bid: string }> {
  const t = await db.insertInto('tenants').values({ legal_name: `${code} LLC`, display_name: code, tenant_slug: code.toLowerCase(), tenant_code: code, status: 'active' } as any).returning('id').executeTakeFirstOrThrow();
  const tid = (t as any).id as string;
  const b = await db.insertInto('branches').values({ tenant_id: tid, name: code } as any).returning('id').executeTakeFirstOrThrow();
  return { tid, bid: (b as any).id as string };
}
async function payment(db: Kysely<DB>, tid: string, bid: string, txn: string): Promise<string> {
  const p = await db.insertInto('payments').values({ tenant_id: tid, branch_id: bid, ticket_id: randomUUID(), method: 'card', amount_cents: 1000, status: 'approved', processor_transaction_id: txn } as any).returning('id').executeTakeFirstOrThrow();
  return (p as any).id as string;
}
async function payStatus(db: Kysely<DB>, id: string): Promise<string> {
  const r = await db.selectFrom('payments').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return (r as any).status as string;
}
const sign = (secret: string, payload: object) => createHmac('sha256', secret).update(JSON.stringify(payload), 'utf8').digest('hex');

async function post(payload: object, signature: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}/webhooks/payments/fiserv`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature }, body: JSON.stringify(payload),
  });
  let json: any = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const resolver = new PaymentGatewayResolver(db);
  const rid = Date.now().toString().slice(-6);
  console.log(`== payment webhook isolation @ ${BASE} ==`);

  const A = await tenant(db, `WHA${rid}`);
  const B = await tenant(db, `WHB${rid}`);
  const MID_A = `MIDWHA${rid}`, MID_B = `MIDWHB${rid}`;
  const SEC_A = `whsecretA-${rid}`, SEC_B = `whsecretB-${rid}`;
  await resolver.upsertConfig(A.tid, { processorType: 'fiserv', environment: 'sandbox', baseUrl: 'https://a.cardconnect.com', merchantId: MID_A, apiUsername: 'uA', apiPassword: 'pA', webhookSecret: SEC_A, status: 'active' });
  await resolver.upsertConfig(B.tid, { processorType: 'fiserv', environment: 'sandbox', baseUrl: 'https://b.cardconnect.com', merchantId: MID_B, apiUsername: 'uB', apiPassword: 'pB', webhookSecret: SEC_B, status: 'active' });

  const TXN_A = `TXNA-${rid}`, TXN_B = `TXNB-${rid}`;
  const pA = await payment(db, A.tid, A.bid, TXN_A);
  const pB = await payment(db, B.tid, B.bid, TXN_B);

  // (1) Cross-tenant: A's merchant, signed by A, but referencing B's transaction → must NOT touch B's payment.
  const xBody = { merchantId: MID_A, eventType: 'voided', transactionId: TXN_B, eventId: `evtX-${rid}` };
  const x = await post(xBody, sign(SEC_A, xBody));
  ok('cross-tenant webhook accepted but matched no payment', x.status === 200 && (x.json?.matchedPaymentId ?? null) === null, `http ${x.status}`);
  ok("tenant B's payment is UNTOUCHED by tenant A's webhook", (await payStatus(db, pB)) === 'approved');

  // (2) Own transaction → updates only A's payment.
  const oBody = { merchantId: MID_A, eventType: 'voided', transactionId: TXN_A, eventId: `evtOwn-${rid}` };
  const o = await post(oBody, sign(SEC_A, oBody));
  ok('own-tenant valid webhook applied (voided)', o.status === 200 && o.json?.statusApplied === 'voided', `http ${o.status}`);
  ok("tenant A's payment now 'voided'", (await payStatus(db, pA)) === 'voided');

  // (3) Idempotency — same event_id again is not reprocessed.
  const o2 = await post(oBody, sign(SEC_A, oBody));
  ok('duplicate event detected (not reprocessed)', o2.status === 200 && o2.json?.duplicate === true);
  const cnt = await db.selectFrom('payment_gateway_events').select(db.fn.countAll().as('n')).where('event_id', '=', `evtOwn-${rid}`).where('processed_at', 'is not', null).executeTakeFirstOrThrow();
  ok('exactly one processed event for the id', Number((cnt as any).n) === 1, `count=${(cnt as any).n}`);

  // (4) Bad signature → not processed; A's payment must not change to 'settled'.
  const bBody = { merchantId: MID_A, eventType: 'settled', transactionId: TXN_A, eventId: `evtBad-${rid}` };
  const bad = await post(bBody, 'deadbeefbadsignature');
  ok('bad signature rejected (401)', bad.status === 401 && bad.json?.code === 'invalid_signature', `http ${bad.status}`);
  ok("bad-signature event did NOT change the payment", (await payStatus(db, pA)) === 'voided');
  const badRow = await db.selectFrom('payment_gateway_events').select(['signature_valid', 'processed_at']).where('event_id', '=', `evtBad-${rid}`).executeTakeFirst();
  ok('bad-signature event recorded as unverified + unprocessed', !!badRow && (badRow as any).signature_valid === false && (badRow as any).processed_at === null);

  // (5) Unknown merchant → rejected; nothing applied.
  const uBody = { merchantId: `MIDUNKNOWN${rid}`, eventType: 'voided', transactionId: TXN_A, eventId: `evtUnk-${rid}` };
  const unk = await post(uBody, sign('whatever', uBody));
  ok('unknown merchant rejected (400)', unk.status === 400 && unk.json?.code === 'unknown_merchant', `http ${unk.status}`);
  ok("unknown-merchant webhook did NOT change the payment", (await payStatus(db, pA)) === 'voided');

  // (6) Refund ledger — A's own refund lands; a cross-tenant refund (A's merchant, B's txn) lands NOWHERE.
  const refBody = { merchantId: MID_A, eventType: 'refunded', transactionId: TXN_A, eventId: `evtRef-${rid}`, refundId: `RF-${rid}`, amountCents: 500, reason: 'customer' };
  const ref = await post(refBody, sign(SEC_A, refBody));
  ok('own refund recorded', ref.status === 200 && ref.json?.recordedRefund === true, `http ${ref.status}`);
  const xRefBody = { merchantId: MID_A, eventType: 'refunded', transactionId: TXN_B, eventId: `evtRefX-${rid}`, refundId: `RFX-${rid}`, amountCents: 999 };
  const xRef = await post(xRefBody, sign(SEC_A, xRefBody));
  ok('cross-tenant refund recorded nothing', xRef.status === 200 && xRef.json?.recordedRefund === false);
  const aRefunds = await db.selectFrom('payment_refunds').select(db.fn.countAll().as('n')).where('tenant_id', '=', A.tid).executeTakeFirstOrThrow();
  const bRefunds = await db.selectFrom('payment_refunds').select(db.fn.countAll().as('n')).where('tenant_id', '=', B.tid).executeTakeFirstOrThrow();
  ok('tenant A has exactly one refund row', Number((aRefunds as any).n) === 1, `A=${(aRefunds as any).n}`);
  ok('tenant B has NO refund rows (cross-tenant blocked)', Number((bRefunds as any).n) === 0, `B=${(bRefunds as any).n}`);

  // (7) Settlement ledger — batch lands for the resolved tenant; duplicate settlement id is recorded once.
  const setBody = { merchantId: MID_A, eventType: 'settlement_batch', settlementId: `BATCH-${rid}`, grossCents: 10000, feeCents: 300, netCents: 9700, eventId: `evtSet-${rid}` };
  const set1 = await post(setBody, sign(SEC_A, setBody));
  ok('settlement recorded', set1.status === 200 && set1.json?.recordedSettlement === true);
  const set2 = await post({ ...setBody, eventId: `evtSet2-${rid}` }, sign(SEC_A, { ...setBody, eventId: `evtSet2-${rid}` }));
  ok('duplicate settlement id recorded once', set2.json?.recordedSettlement === false);
  const aSettle = await db.selectFrom('payment_settlements').select(db.fn.countAll().as('n')).where('tenant_id', '=', A.tid).executeTakeFirstOrThrow();
  ok('tenant A has exactly one settlement row', Number((aSettle as any).n) === 1, `A=${(aSettle as any).n}`);

  // (8) Reconciliation read is tenant-scoped: A sees its own totals; B sees zero.
  const recon = new PaymentReconciliationService(db);
  const ra = await recon.summary(A.tid);
  ok('A reconciliation totals correct', ra.refunds.count === 1 && ra.refunds.totalCents === 500 && ra.settlements.count === 1 && ra.settlements.grossCents === 10000 && ra.settlements.netCents === 9700, JSON.stringify(ra));
  const rb = await recon.summary(B.tid);
  ok('B reconciliation is empty (isolation)', rb.refunds.count === 0 && rb.settlements.count === 0, JSON.stringify(rb));

  await db.destroy();
  console.log('\n== RESULT ==');
  if (fails.length) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  console.log('ALL WEBHOOK ISOLATION CHECKS PASSED ✓');
}
main().catch((e) => { console.error(e); process.exit(1); });
