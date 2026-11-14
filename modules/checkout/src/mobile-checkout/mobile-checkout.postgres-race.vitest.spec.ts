// mobile-checkout.postgres-race.vitest.spec.ts — Owner & Manager Payment App mandate §152–§166 on REAL Postgres (TRUE
// concurrency needs it: PGlite is single-session). Opt-in: PG_RACE_URL=postgres://... (a migrated database, ≥ 660).
//   §152 claim race · §153 POS vs phone · §154 twenty taps, one intent, one charge · §155 modification race ·
//   §157 split tender · §158 partial failure · §161 wrong tenant · §162 wrong branch · §163 revoked device ·
//   §14 user binding in SQL · §166 card-data scan (tables + audit) · §216 the CHECKs
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from '../checkout/checkout.kysely.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { CheckoutLockService, LockHeldElsewhereError } from '../checkout-lock/checkout-lock.service';
import { KyselyCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';
import { MobileCheckoutService } from './mobile-checkout.service';
import { KyselyMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { KyselyTtpOnboardingStore } from './ttp-onboarding.kysely';
import { KyselyMobilePayDeviceStore } from './mobile-pay-device.kysely';
import { DeviceBindingError } from './mobile-pay-device';
import { KyselyDevicePairingStore, pairingHash } from './device-pairing';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { OutboxWriter } from '@aipowersalon/events';
import type { Ctx } from '@aipowersalon/permissions';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

const url = process.env.PG_RACE_URL;
const T = 'a7000000-0000-4000-8000-0000000000aa';
const T2 = 'a7000000-0000-4000-8000-0000000000ab';
const B = 'b7000000-0000-4000-8000-0000000000bb';
const B2 = 'b7000000-0000-4000-8000-0000000000bc';
const C = 'd7000000-0000-4000-8000-0000000000dd';
const C2 = 'd7000000-0000-4000-8000-0000000000de';
const CAT = 'c7000000-0000-4000-8000-0000000000cc';
const SVC = 'c7000000-0000-4000-8000-0000000000c1';
const U_OWNER = 'e7000000-0000-4000-8000-0000000000e1';
const U_LISA = 'e7000000-0000-4000-8000-0000000000e2';
const DEV = 'race-iphone-01';
const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'pos.checkout.discount', 'checkout.manage_overrides', 'mobile_checkout.split_payment', 'pos.devices.manage'];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tenantId: T, branchId: B, userId: U_OWNER, role: 'OWNER', permissions: perms, ...over });

class FakeProvider implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  finalizes = 0; verified = true;
  isConfigured() { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { return { provider: this.provider, sessionToken: 'sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { this.finalizes++; await new Promise((r) => setTimeout(r, 5)); return { verified: this.verified, outcome: this.verified ? 'approved' : 'declined', processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
  async lookupTransaction(): Promise<TapToPayLookup> { return { kind: 'not_found' }; }
}

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository; let checkout: CheckoutService; let locks: CheckoutLockService;
let svc: MobileCheckoutService; let provider: FakeProvider; let attempts: KyselyMobilePaymentAttemptRepository; let devices: KyselyMobilePayDeviceStore;

async function newTicket(tenant = T, branch = B, cents = 9775): Promise<string> {
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, ticket_number) values (${tenant}, ${branch}, ${tenant === T ? C : C2}, 'ready_for_payment', ${cents}, 0, 0, ${cents}, ${'R' + Math.floor(Math.random() * 1e6)}) returning id`.execute(db)).rows[0];
  if (tenant === T) await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${tenant}, ${branch}, ${tk.id}, ${SVC}, 'Gel Manicure', ${cents}, 45, ${cents})`.execute(db);
  return String(tk.id);
}
const payments = async (ticketId: string) => (await sql`select id, method, status, amount_cents, payment_surface, device_id, card_brand, card_last4, idempotency_key from payments where ticket_id = ${ticketId} order by created_at`.execute(db)).rows as any[];
const ticketRow = async (ticketId: string) => (await sql`select status, checkout_status, paid_at from tickets where id = ${ticketId}`.execute(db)).rows[0] as any;

describe.skipIf(!url)('Owner & Manager Payment App — real-Postgres races (mandate §152–§166)', () => {
  beforeAll(async () => {
    for (const k of Object.keys(TTP_ENV)) process.env[k] = (TTP_ENV as any)[k];
    pool = new pg.Pool({ connectionString: url, max: 32 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race TTP', 'Race TTP', 'race-ttp', 'RTTP1', 'active'), (${T2}, 'Race TTP 2', 'Race TTP 2', 'race-ttp-2', 'RTTP2', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Cherry Hill', 'active'), (${B2}, ${T2}, 'Elsewhere', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Kim', 'Vo', 'Kim Vo', 'active'), (${C2}, ${T2}, ${B2}, 'Other', 'Guest', 'Other Guest', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 9775) on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) values (${U_OWNER}, ${T}, ${B}, 'Kevin', 'D', 'Kevin D', 'kevin@race.test', 'active', 'OWNER'), (${U_LISA}, ${T}, ${B}, 'Lisa', 'M', 'Lisa M', 'lisa@race.test', 'active', 'MANAGER') on conflict (id) do nothing`.execute(db);
    repo = new KyselyCheckoutRepository(db as any, new OutboxWriter());
    locks = new CheckoutLockService(new KyselyCheckoutLockRepository(db as any));
    const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
    checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime, undefined, undefined, locks);
    attempts = new KyselyMobilePaymentAttemptRepository(db as any);
    devices = new KyselyMobilePayDeviceStore(db as any);
    provider = new FakeProvider();
    const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }) };
    svc = new MobileCheckoutService(db as any, gateways, checkout, locks, attempts, new KyselyTtpOnboardingStore(db as any), devices, provider, undefined, { recorder: new MobileCaptureRecorder(repo, db as any), realtime, outbox: new OutboxWriter() });
    await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), T, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
    await sql`delete from mobile_pay_devices where tenant_id = ${T}`.execute(db);
    await svc.registerDevice(ctx(), { deviceId: DEV, platform: 'ios', tapToPayCapable: true, label: 'Owner iPhone' });
    await svc.setMyDeviceStatus(ctx(), DEV, 'active');
  });
  afterAll(async () => {
    for (const tbl of ['payment_attempts', 'payments', 'checkout_locks', 'ticket_service_lines', 'tickets', 'mobile_pay_devices', 'tenant_tap_to_pay_onboarding', 'audit_logs', 'outbox_events', 'customers']) {
      await sql`delete from ${sql.table(tbl)} where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined);
    }
    await db?.destroy();
    for (const k of Object.keys(TTP_ENV)) delete process.env[k];
  });

  it('§152 claim race: two managers claim the same ticket at once — exactly one CLAIMED, the other refused', async () => {
    const tk = await newTicket();
    const lisa = ctx({ userId: U_LISA, role: 'MANAGER' });
    const results = await Promise.allSettled([svc.acquireLock(ctx(), tk, DEV, 'S-owner'), svc.acquireLock(lisa, tk, undefined, 'S-lisa')]);
    const won = results.filter((r) => r.status === 'fulfilled'); const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1); expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(LockHeldElsewhereError);
    expect((await sql`select count(*)::int as n from checkout_locks where ticket_id = ${tk} and released_at is null`.execute(db)).rows[0]).toEqual({ n: 1 });
  });

  it('§153 POS vs phone: with the phone holding the claim the POS cannot take cash; with the POS paying the phone cannot claim', async () => {
    const tk = await newTicket();
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    await expect(checkout.payCash(ctx() as any, tk, { amountReceivedCents: 20000 })).rejects.toThrow(/mobile device/i);
    expect(await payments(tk)).toHaveLength(0);
    await svc.releaseLock(ctx(), tk, 'S1');
    // the POS now holds the ticket (a pos-source lock) — the phone is refused
    await locks.acquire({ tenantId: T, branchId: B, ticketId: tk, userId: U_LISA, sessionId: 'pos-pay:x', source: 'pos' });
    await expect(svc.acquireLock(ctx(), tk, DEV, 'S2')).rejects.toBeInstanceOf(LockHeldElsewhereError);
    expect((await svc.claimView(ctx(), tk, 'S2'))).toMatchObject({ source: 'pos', ownedByCaller: false });
  });

  it('§154 twenty taps: 20 concurrent intents with one key → ONE payment_attempts row; 20 concurrent capture results → ONE charge, ONE payments row, ticket paid once', async () => {
    const tk = await newTicket();
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    const created = await Promise.all(Array.from({ length: 20 }, () => svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K-' + tk, deviceId: DEV })));
    expect(new Set(created.map((a) => a.id)).size).toBe(1);
    expect((await sql`select count(*)::int as n from payment_attempts where ticket_id = ${tk}`.execute(db)).rows[0]).toEqual({ n: 1 });
    await svc.runReadinessStep(ctx(), 'K-' + tk, DEV);
    await svc.mintDeviceSession(ctx(), 'K-' + tk, DEV);
    provider.finalizes = 0;
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => svc.applyCaptureResult(ctx(), 'K-' + tk, { outcome: 'approved', processorRef: 'sess-' + tk, brand: 'visa', last4: '4242' }, DEV)));
    const confirmed = results.filter((r) => r.status === 'fulfilled' && (r.value as any).to === 'confirmed');
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    const rows = await payments(tk);
    expect(rows.filter((p) => p.status === 'approved')).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'card', payment_surface: 'tap_to_pay_iphone', device_id: DEV, card_brand: 'visa', card_last4: '4242', idempotency_key: 'K-' + tk });
    expect((await ticketRow(tk)).status).toBe('paid');
    // the outbox carries payment.captured + checkout.completed exactly once each
    const ev = (await sql`select event_type, count(*)::int as n from outbox_events where tenant_id = ${T} and (aggregate_id = ${tk} or payload_json->>'ticketId' = ${tk}) group by event_type`.execute(db)).rows as any[];
    expect(ev.find((e) => e.event_type === 'payment.captured')?.n).toBe(1);
    expect(ev.find((e) => e.event_type === 'checkout.completed')?.n).toBe(1);
    expect(ev.find((e) => e.event_type === 'payment.intent_created')?.n).toBe(1);
  });

  it('§155 modification race: the POS changes the total after the phone loaded it — the stale intent cannot mint; the refreshed one can', async () => {
    const tk = await newTicket();
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    const d = await svc.getTicketDetail(ctx(), tk, 'S1');
    const a = await svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K-' + tk, deviceId: DEV, expectedVersion: d.version });
    await svc.runReadinessStep(ctx(), 'K-' + tk, DEV);
    await svc.releaseLock(ctx(), tk, 'S1');   // the front desk tries to edit the ticket (price change via a discount)
    // the open card attempt now blocks the edit outright ("being verified — do not change the total"), so the stale intent can never
    // be minted; the desk cancels the attempt first, then edits
    await expect(checkout.applyDiscount(ctx() as any, tk, { discountCents: 1000, reason: 'price fix' })).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN|PAYMENT_IN_PROGRESS/);
    await svc.cancelAttempt(ctx(), 'K-' + tk);
    await checkout.applyDiscount(ctx() as any, tk, { discountCents: 1000, reason: 'price fix' });
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    await expect(svc.mintDeviceSession(ctx(), 'K-' + tk, DEV)).rejects.toBeTruthy();   // the cancelled / stale intent never mints
    const fresh = await svc.getTicketDetail(ctx(), tk, 'S1');
    expect(fresh.version).not.toBe(d.version);
    expect(fresh.balanceDueCents).toBeLessThan(a.amountCents);
    await svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K2-' + tk, deviceId: DEV, expectedVersion: fresh.version });
    await svc.runReadinessStep(ctx(), 'K2-' + tk, DEV);
    await expect(svc.mintDeviceSession(ctx(), 'K2-' + tk, DEV)).resolves.toMatchObject({ provider: 'fiserv_commercehub' });
  });

  it('§157 / §158 split: $40 cash + $60 Tap to Pay = two tenders, balance 0, ticket paid; a declined $60 leaves $40 paid / $60 due', async () => {
    const tk = await newTicket(T, B, 10000);
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    const cash = await svc.recordCashTender(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'C-' + tk, amountCents: 4000, deviceId: DEV });
    expect(cash).toMatchObject({ duplicate: false, paidCents: 4000, ticketPaid: false });
    expect((await ticketRow(tk)).checkout_status).toBe('payment_in_progress');   // the POS board state (tickets.checkout_status)
    expect((await ticketRow(tk)).status).not.toBe('paid');
    await svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K-' + tk, deviceId: DEV });
    await svc.runReadinessStep(ctx(), 'K-' + tk, DEV);
    provider.verified = false;
    expect((await svc.applyCaptureResult(ctx(), 'K-' + tk, { outcome: 'approved', processorRef: 'x' }, DEV)).to).toBe('declined');
    let rows = await payments(tk);
    expect(rows.filter((p) => p.status === 'partial' && p.method === 'cash')).toHaveLength(1);
    expect(rows.filter((p) => p.method === 'card' && (p.status === 'approved' || p.status === 'partial'))).toHaveLength(0);
    expect((await svc.getTicketDetail(ctx(), tk, 'S1'))).toMatchObject({ paidCents: 4000 });
    provider.verified = true;
    const b = await svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K2-' + tk, deviceId: DEV });
    await svc.runReadinessStep(ctx(), 'K2-' + tk, DEV);
    const r = await svc.applyCaptureResult(ctx(), 'K2-' + tk, { outcome: 'approved', processorRef: 'y' }, DEV);
    expect(r).toMatchObject({ to: 'confirmed', ticketPaid: true, remainingCents: 0 });
    rows = await payments(tk);
    expect(rows.filter((p) => p.status === 'approved' || p.status === 'partial').map((p) => [p.method, Number(p.amount_cents)])).toEqual(expect.arrayContaining([['cash', 4000], ['card', b.amountCents]]));
    expect((await ticketRow(tk)).status).toBe('paid');
  });

  it('§161 / §162 wrong tenant and wrong branch: DENIED (the ticket does not exist for that session)', async () => {
    const foreign = await newTicket(T2, B2);
    await expect(svc.getTicketDetail(ctx(), foreign)).rejects.toThrow(/not found/i);
    await expect(svc.acquireLock(ctx(), foreign, DEV, 'S1')).rejects.toThrow(/not found/i);
    const mine = await newTicket();
    await expect(svc.getTicketDetail(ctx({ branchId: B2 }), mine)).rejects.toThrow(/not found/i);
  });

  it('§163 revoked device: DEVICE_REVOKED on readiness, intent and mint; §14 a second user cannot take the install over in SQL', async () => {
    const tk = await newTicket();
    await svc.acquireLock(ctx(), tk, DEV, 'S1');
    await svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K-' + tk, deviceId: DEV });
    await svc.runReadinessStep(ctx(), 'K-' + tk, DEV);
    await expect(devices.upsertOnRegister(T, { deviceId: DEV, registeredBy: U_LISA })).rejects.toBeInstanceOf(DeviceBindingError);
    await svc.setMyDeviceStatus(ctx(), DEV, 'revoked', 'lost phone');
    expect((await devices.get(T, DEV))).toMatchObject({ status: 'revoked', revokeReason: 'lost phone', boundUserId: U_OWNER });
    expect((await svc.getReadiness(ctx(), DEV)).deviceBlockReason).toBe('DEVICE_REVOKED');
    await expect(svc.mintDeviceSession(ctx(), 'K-' + tk, DEV)).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    await expect(svc.createAttempt(ctx(), tk, { sessionId: 'S1', idempotencyKey: 'K2-' + tk, deviceId: DEV })).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    // compromised can never be re-activated in place (the lifecycle in SQL); Secure Tap to Pay §18: nor can a revoked phone
    await expect(svc.setMyDeviceStatus(ctx(), DEV, 'active')).rejects.toMatchObject({ code: 'invalid_state' });
    await sql`update mobile_pay_devices set status = 'active' where tenant_id = ${T} and device_id = ${DEV}`.execute(db);   // test reset only
    await svc.setMyDeviceStatus(ctx(), DEV, 'compromised', 'jailbreak');
    await expect(svc.setMyDeviceStatus(ctx(), DEV, 'active')).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await devices.get(T, DEV))!.status).toBe('compromised');
    await svc.setMyDeviceStatus(ctx(), DEV, 'revoked', 're-register');
    await sql`update mobile_pay_devices set status = 'active' where tenant_id = ${T} and device_id = ${DEV}`.execute(db);   // test reset only
  });

  it('§166 / §216 card-data scan: no PAN / CVV / track data in payments, payment_attempts, audit or outbox rows; the CHECKs refuse a non-4-digit last4', async () => {
    const pan = '4242424242424242';
    const tables = ['payments', 'payment_attempts', 'audit_logs', 'outbox_events', 'mobile_pay_devices', 'checkout_locks'];
    const versions = ((await sql`select checkout_version as v from checkout_locks where tenant_id in (${T}, ${T2}) and checkout_version is not null
      union select checkout_version from payment_attempts where tenant_id in (${T}, ${T2}) and checkout_version is not null`.execute(db)).rows as any[])
      .map((r) => String(r.v)).filter((v) => /^[0-9a-f]{16}$/.test(v));   // only well-formed version digests are trusted
    for (const t of tables) {
      const rows = (await sql`select ${sql.table(t)}::text as x from ${sql.table(t)} where tenant_id in (${T}, ${T2}) and ${sql.table(t)}::text ~ ${'[0-9]{13,19}'}`.execute(db)).rows as any[];
      // uuids and timestamps never contain 13+ consecutive digits; a stored PAN would. One exception is not card data: a checkout
      // version stamped in epoch milliseconds (13 digits, within ten years of now) — the lock row carries it
      const epochMs = (d: string) => d.length === 13 && Math.abs(Number(d) - Date.now()) < 10 * 365 * 86_400_000;
      // and the checkout VERSION (computeCheckoutVersion: the first 16 hex chars of a sha256) — by chance a hex digest can hold
      // 13+ decimal digits in a row (seen: 9d21724177262485), which is not card data; only runs inside a stored version are excused
      const fromVersion = (d: string) => versions.some((v) => v.includes(d));
      const runs = rows.flatMap((r) => String(r.x).match(/[0-9]{13,19}/g) ?? []).filter((d) => !epochMs(d) && !fromVersion(d));
      expect(runs.length, `${t} carries a 13–19 digit run`).toBe(0);
      const r2 = (await sql`select count(*)::int as n from ${sql.table(t)} where tenant_id in (${T}, ${T2}) and ${sql.table(t)}::text ilike ${'%' + pan + '%'}`.execute(db)).rows[0] as any;
      expect(r2.n).toBe(0);
    }
    const tk = await newTicket();
    await expect(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, card_last4) values (${T}, ${B}, ${tk}, 'card', 100, 0, 0, 0, 'approved', ${pan})`.execute(db)).rejects.toThrow(/chk_payments_card_last4/);
    await expect(sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, card_last4) values (${T}, ${B}, ${tk}, 100, 'tap_to_pay', 'created', ${'chk-' + Date.now()}, '12345')`.execute(db)).rejects.toThrow(/chk_payment_attempts_card_last4/);
    await expect(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, payment_surface) values (${T}, ${B}, ${tk}, 'card', 100, 0, 0, 0, 'approved', 'bluetooth')`.execute(db)).rejects.toThrow(/chk_payments_payment_surface/);
    // §216 a device row cannot name another tenant's branch
    await expect(sql`insert into mobile_pay_devices (tenant_id, device_id, branch_id) values (${T}, 'x-branch', ${B2})`.execute(db)).rejects.toThrow(/cross-tenant/);
  });

  it('Secure Tap to Pay §70 on real Postgres: ten phones racing one pairing code — exactly one registers; a nonce raced ten times is accepted once', async () => {
    const pairings = new KyselyDevicePairingStore(db as any);
    const code = 'race-pair-' + Date.now();
    await pairings.create({ tenantId: T, branchId: B, createdBy: U_OWNER, codeHash: pairingHash(code), expiresAt: new Date(Date.now() + 60_000) });
    const wins = (await Promise.all(Array.from({ length: 10 }, (_, i) => pairings.consume(T, pairingHash(code), { userId: U_OWNER, deviceId: 'racer-' + i }, new Date())))).filter(Boolean);
    expect(wins.length).toBe(1);
    const nonce = 'race-nonce-' + Date.now();
    const accepted = (await Promise.all(Array.from({ length: 10 }, () => devices.consumeNonce!(T, DEV, nonce)))).filter(Boolean);
    expect(accepted.length).toBe(1);
  });
});
