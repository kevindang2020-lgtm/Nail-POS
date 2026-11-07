// wallet-topup.postgres-race.vitest.spec.ts — Remaining-work mandate P1-1 / B-79 (Oct 23 2026) on REAL PostgreSQL: a top-up
// whose answer was lost is settled by whoever gets there first — the customer's retry, the customer's "Check status", the
// staff Verify, two stranded sweepers — all at once. Exactly ONE moves the intent to APPROVED and the wallet is credited
// exactly ONCE; the card is never charged again. And ten simultaneous taps with one client key reach the processor ONCE.
// PGlite is one session and cannot show a race, so this needs PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { WalletLedgerService, KyselyWalletLedgerRepository } from '@aipowersalon/customers';
import { WalletTopupService } from './customer-payments.service';
import { KyselyWalletTopupIntentStore } from './wallet-topup-intents';
import { PaymentWebhookService } from '../payments/payment-webhook.service';
import { createHmac } from 'node:crypto';

const url = process.env.PG_RACE_URL;
const T = 'a6790000-0000-4000-8000-0000000000aa';
const B = 'b6790000-0000-4000-8000-0000000000bb';
const C = 'c6790000-0000-4000-8000-0000000000cc';
const PM = 'd6790000-0000-4000-8000-0000000000dd';
let db: Kysely<any>; let pool: pg.Pool;

const methods = { resolveCustomerId: async () => C, getToken: async () => ({ token: '9418594164541111', expMonth: 12, expYear: 2030 }) } as any;
function processor(answer: 'throw' | 'approve') {
  const charges: any[] = []; const inquiries: string[] = [];
  return { charges, inquiries, p: {
    name: 'cardpointe',
    async authorizeAndCapture(i: any) { charges.push(i); await new Promise((r) => setTimeout(r, 50)); if (answer === 'throw') throw new Error('socket hang up'); return { approved: true, declined: false, retref: 'RT-LIVE', respstat: 'A' }; },
    async inquireByOrderId(orderId: string) { inquiries.push(orderId); return { transactions: [{ retref: 'RT-INQ', approved: true, declined: false, amountCents: 5000 }] }; },
  } };
}
const svcFor = (p: any) => new WalletTopupService({ resolve: async () => ({ processor: p }), effectiveMerchant: async () => ({ configured: true, processor: p, merchantIdHash: 'mid-hash', scope: 'tenant', merchantAccountId: null, environment: 'sandbox' }) } as any, methods,
  new WalletLedgerService(new KyselyWalletLedgerRepository(db as any)), new KyselyWalletTopupIntentStore(db as any), { strandedMs: 15 * 60_000 });
const credits = async () => Number(((await sql<any>`select count(*)::int n, coalesce(sum(amount_cents),0)::int s from customer_wallet_ledger where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows[0] as any).n);
const balance = async () => Number(((await sql<any>`select coalesce(sum(amount_cents),0)::int s from customer_wallet_ledger where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows[0] as any).s);

describe.skipIf(!url)('wallet top-up intents on real Postgres (B-79)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'TopUp Salon', 'TopUp Salon', 'topup-salon-679', 'TUP679', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Vy', 'Tran', 'Vy Tran') on conflict (id) do nothing`.execute(db);
  });
  beforeEach(async () => {
    await sql`delete from wallet_topup_intents where tenant_id = ${T}`.execute(db);
    await sql`delete from customer_wallet_ledger where tenant_id = ${T}`.execute(db);
    await sql`delete from payment_gateway_events where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from wallet_topup_intents where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from customer_wallet_ledger where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from payment_gateway_events where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('a lost answer, then client retry + customer Check status + staff Verify + two sweepers at once → ONE approval, ONE credit, no second charge', async () => {
    const live = processor('throw');
    const first = await svcFor(live.p).topUp({ tenantId: T, userId: 'u' }, { amountCents: 5000, paymentMethodId: PM, clientKey: 'tap-race-1' });
    expect(first).toMatchObject({ ok: false, status: 'UNKNOWN' });
    const id = first.intentId!;
    await sql`update wallet_topup_intents set created_at = now() - interval '30 minutes' where id = ${id}`.execute(db);   // stranded

    // a gate holds the intent row so every settler's conditional UPDATE queues behind it, then opens
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select 1 from wallet_topup_intents where id = $1 for update', [id]);
    const rec = processor('approve');
    const runs = Promise.all([
      svcFor(rec.p).topUp({ tenantId: T, userId: 'u' }, { amountCents: 5000, paymentMethodId: PM, clientKey: 'tap-race-1' }),   // the app's retry
      svcFor(rec.p).verifyMine({ tenantId: T, userId: 'u' }, id),                                                                 // customer "Check status"
      svcFor(rec.p).verifyForStaff(T, C, id),                                                                                     // staff Verify
      svcFor(rec.p).sweepStranded(),                                                                                              // worker 1
      svcFor(rec.p).sweepStranded(),                                                                                              // worker 2
    ]);
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    await runs;

    const row: any = (await sql`select status, processor_transaction_id, settled_by, attempt from wallet_topup_intents where id = ${id}`.execute(db)).rows[0];
    expect(row).toMatchObject({ status: 'APPROVED', processor_transaction_id: 'RT-INQ', attempt: 1 });
    expect(['verify', 'sweep']).toContain(row.settled_by);
    expect(await credits()).toBe(1);
    expect(await balance()).toBe(5000);
    expect(rec.charges).toHaveLength(0);          // nobody charged the card again
    expect(live.charges).toHaveLength(1);
    const ledger: any = (await sql`select idempotency_key, reference from customer_wallet_ledger where tenant_id = ${T}`.execute(db)).rows[0];
    expect(ledger).toMatchObject({ idempotency_key: `topup:${id}`, reference: 'RT-INQ' });
  });

  it('ten simultaneous taps with ONE client key → ONE intent, ONE processor call, ONE credit', async () => {
    const live = processor('approve');
    const rs = await Promise.all(Array.from({ length: 10 }, () => svcFor(live.p).topUp({ tenantId: T, userId: 'u' }, { amountCents: 5000, paymentMethodId: PM, clientKey: 'tap-race-2' }).catch((e) => ({ ok: false, message: String(e?.message ?? e) }))));
    expect(live.charges).toHaveLength(1);
    expect(Number(((await sql<any>`select count(*)::int n from wallet_topup_intents where tenant_id = ${T}`.execute(db)).rows[0] as any).n)).toBe(1);
    expect(await credits()).toBe(1);
    expect(await balance()).toBe(5000);
    expect(rs.filter((r: any) => r.ok).length).toBeGreaterThanOrEqual(1);
    for (const r of rs as any[]) expect(r.declined).toBeUndefined();   // the losers are "being confirmed" or approved — never declined
  });
  // §15 / §16 / §58 (Oct 27 2026): the processor's signed webhook joins the race as the FOURTH kind of settler — through the
  // real PaymentWebhookService (merchant → salon, HMAC, the event claim) into the same conditional settle and ledger key.
  const SECRET = 'wallet-race-webhook-fixture';   // a test fixture, not a credential
  const webhookResolver: any = { resolveTenantByMerchantId: async (mid: string) => (mid === 'MID-TOPUP' ? { tenantId: T, webhookSecret: SECRET, merchantIdMasked: '***UP', processorType: 'cardpointe' } : null) };
  const deliver = (svc: WalletTopupService, body: Record<string, unknown>) => {
    const raw = JSON.stringify(body); const sig = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
    return new PaymentWebhookService(db as any, webhookResolver, () => svc).handle('cardpointe', raw, body, sig, { 'x-webhook-signature': sig });
  };

  it('a lost answer, then the processor webhook (twice, two event ids) + staff Verify + customer Check + a sweeper at once → ONE approval, ONE credit', async () => {
    const live = processor('throw');
    const first = await svcFor(live.p).topUp({ tenantId: T, userId: 'u' }, { amountCents: 5000, paymentMethodId: PM, clientKey: 'tap-race-wh' });
    expect(first).toMatchObject({ ok: false, status: 'UNKNOWN' });
    const id = first.intentId!;
    await sql`update wallet_topup_intents set created_at = now() - interval '30 minutes' where id = ${id}`.execute(db);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select 1 from wallet_topup_intents where id = $1 for update', [id]);
    const rec = processor('approve');
    const evt = (n: number) => ({ merchantId: 'MID-TOPUP', eventType: 'transaction.approved', eventId: `wh-${id}-${n}`, retref: 'RT-INQ', orderid: id, respstat: 'A', amount: '50.00' });
    const runs = Promise.all([
      deliver(svcFor(rec.p), evt(1)),                                   // the processor's webhook
      deliver(svcFor(rec.p), evt(2)),                                   // …delivered again under another event id
      svcFor(rec.p).verifyForStaff(T, C, id),                           // staff Verify
      svcFor(rec.p).verifyMine({ tenantId: T, userId: 'u' }, id),      // customer "Check status"
      svcFor(rec.p).sweepStranded(),                                    // the worker
    ]);
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const [w1, w2] = await runs;
    expect(w1.status).toBe(200); expect(w2.status).toBe(200);
    expect((w1.body as any).topUp?.intentId).toBe(id); expect((w2.body as any).topUp?.intentId).toBe(id);
    const row: any = (await sql`select status, settled_by, attempt from wallet_topup_intents where id = ${id}`.execute(db)).rows[0];
    expect(row).toMatchObject({ status: 'APPROVED', attempt: 1 });
    expect(['webhook', 'verify', 'sweep']).toContain(row.settled_by);
    expect(await credits()).toBe(1);
    expect(await balance()).toBe(5000);
    expect(rec.charges).toHaveLength(0);
    expect(live.charges).toHaveLength(1);
    const events = Number(((await sql<any>`select count(*)::int n from payment_gateway_events where tenant_id = ${T} and processed_at is not null`.execute(db)).rows[0] as any).n);
    expect(events).toBe(2);   // both deliveries recorded; only one moved money
  });

  it('webhook ALONE settles a lost answer (no Verify, no sweep): APPROVED by webhook, one credit; the same event replayed is a duplicate', async () => {
    const live = processor('throw');
    const first = await svcFor(live.p).topUp({ tenantId: T, userId: 'u' }, { amountCents: 5000, paymentMethodId: PM, clientKey: 'tap-race-wh2' });
    const id = first.intentId!;
    const rec = processor('approve');
    const body = { merchantId: 'MID-TOPUP', eventType: 'transaction.approved', eventId: `wh-solo-${id}`, retref: 'RT-WH', orderid: id, respstat: 'A', amount: '50.00' };
    const [a, b] = await Promise.all([deliver(svcFor(rec.p), body), deliver(svcFor(rec.p), body)]);
    expect([a.body, b.body].filter((x: any) => x.duplicate).length).toBe(1);
    const row: any = (await sql`select status, settled_by, processor_transaction_id from wallet_topup_intents where id = ${id}`.execute(db)).rows[0];
    expect(row).toMatchObject({ status: 'APPROVED', settled_by: 'webhook', processor_transaction_id: 'RT-WH' });
    expect(await credits()).toBe(1);
    expect(rec.inquiries).toHaveLength(0);
  });
});
