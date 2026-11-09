// payment-channels-center.pgtest — Three Ways to Pay SUNMI guide (Nov 9 2026) on the REAL schema.
// PC = three channels always returned · server-derived states · the ticket's ledger status · cross-channel holds · scope ·
// the read-only check. The router and the Tap to Pay facts are FAKES (no provider is ever called); every row is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentChannelsCenter, PaymentChannelsError, type PcGatewayPort, type PcTapToPayPort } from './payment-channels-center';

const P = 'c8440000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), C = id(10), U = id(11), CAT = id(20), SVC = id(21);
const ctx = (branchId = B) => ({ tenantId: T, branchId, userId: U, role: 'OWNER', permissions: ['pos.checkout.view'] });
let db: any;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function ticket(o: { branch?: string; status?: string; paid?: boolean } = {}): Promise<string> {
  const r = await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at)
    values (${T}, ${o.branch ?? B}, ${C}, ${o.status ?? 'ready_checkout'}, 5000, 0, 0, 5000, ${o.paid ? sql`now()` : null}) returning id`);
  const tid = String(r[0].id);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${o.branch ?? B}, ${tid}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`);
  return tid;
}
const gw = (o: Partial<{ term: { config: unknown | null; reason?: string; blockedReason?: string }; ttpMid: boolean; tok: { available: boolean; reason?: string }; env: 'sandbox' | 'production'; paused: boolean }> = {}): PcGatewayPort & { calls: string[] } => {
  const calls: string[] = [];
  return { calls,
    async resolve() { calls.push('resolve'); return { configured: true, status: 'active', environment: o.env ?? 'sandbox', merchantIdMasked: '••••4321', scope: 'tenant', pausedByPlatform: !!o.paused }; },
    async resolveTerminalConfig() { calls.push('terminal'); return o.term ?? { config: { secret: 'never-returned' } }; },
    async resolveTapToPayMerchant() { calls.push('ttp'); return o.ttpMid === false ? null : { merchantId: 'x' }; },
    async tokenizerUrl() { calls.push('tok'); return o.tok ?? { available: true }; },
  };
};
const ttp = (o: Partial<{ onboarded: boolean; apple: string; off: 'platform' | null; phones: { online: boolean; capable: boolean }[] }> = {}): PcTapToPayPort => ({
  async getTapToPayOnboarding() { return { appleEntitlementStatus: o.apple ?? 'approved', commerceHubStatus: 'active', onboarded: o.onboarded ?? true, credentialsPresent: true }; },
  async tapToPayOffReason() { return o.off ?? null; },
  async deviceStatusForPos() { return (o.phones ?? [{ online: true, capable: true }]).map((p, i) => ({ deviceId: 'dev-' + i, label: `Kevin iPhone ${i}`, userName: 'Kevin', online: p.online, status: 'active', tapToPayCapable: p.capable, lastSeenAt: new Date().toISOString() })); },
});
const center = (g = gw(), t = ttp()) => new PaymentChannelsCenter(db, g, t);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof PaymentChannelsError ? e.code : (e as Error).message; } }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'pc-844', 'PC844', 'active'), (${X}, 'X', 'Other', 'pc-844x', 'PC844X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main'), (${B2}, ${T}, 'Second'), (${BX}, ${X}, 'Other')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000)`);
  await q(sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, terminal_type, last_ping_at, last_ping_ok, last_seen_at) values ('term-main', ${T}, ${B}, 'Front desk Compact', 'paired', 'C032UQ12345678', 'clover_compact', now() - interval '5 minutes', true, now() - interval '2 minutes')`);
  await q(sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values ('term-b2', ${T}, ${B2}, 'No serial yet', 'paired', null)`);
}, 180_000);

describe('Three Ways to Pay — channel readiness', () => {
  it('PC-01 always three channels, in order, ready from server facts; the HSN is masked and no credential leaks', async () => {
    const g = gw(); const r = await center(g).channels(ctx());
    expect(r.channels.map((c) => c.key)).toEqual(['clover_compact', 'tap_to_pay_iphone', 'customer_app']);
    expect(r.channels.map((c) => c.state)).toEqual(['ready', 'ready', 'ready']);
    expect(r.channels[0].mode).toBe('uat'); expect(r.channels[0].reason).toBe('UAT_TEST_LANE');   // a test lane, never "certified"
    expect(r.channels[0].facts.hsnMasked).toBe('••••5678');
    expect(r.channels[0].facts.lastSuccessfulPingAt).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('never-returned');
    expect(JSON.stringify(r)).not.toContain('C032UQ12345678');
    expect(r.merchant.masked).toBe('••••4321');
    expect(r.liveMode).toBe(false);
  });
  it('PC-02 a channel that cannot take money stays visible with its reason (never hidden)', async () => {
    const r = await center(gw({ term: { config: null, reason: 'PRODUCTION_NOT_APPROVED', blockedReason: 'MERCHANT_NOT_BOARDED' }, tok: { available: false, reason: 'gateway_not_configured' } }), ttp({ onboarded: false, apple: 'pending' })).channels(ctx());
    expect(r.channels).toHaveLength(3);
    expect(r.channels[0]).toMatchObject({ state: 'provider_pending', reason: 'MERCHANT_NOT_BOARDED', actionAllowed: false });
    expect(r.channels[1]).toMatchObject({ state: 'provider_pending', reason: 'APPLE_ENTITLEMENT_PENDING', actionAllowed: false });
    expect(r.channels[2]).toMatchObject({ state: 'setup_required', reason: 'TOKENIZER_GATEWAY_NOT_CONFIGURED', actionAllowed: false });
    const b2 = await center().channels(ctx(B2));
    expect(b2.channels[0]).toMatchObject({ state: 'setup_required', reason: 'TERMINAL_HSN_MISSING' });
    const paused = await center(gw({ paused: true })).channels(ctx());
    expect(paused.channels[0].state).toBe('blocked'); expect(paused.channels[2].state).toBe('blocked');
    const killed = await center(gw(), ttp({ off: 'platform' })).channels(ctx());
    expect(killed.channels[1]).toMatchObject({ state: 'blocked', reason: 'TAP_TO_PAY_OFF_PLATFORM' });
    const offline = await center(gw(), ttp({ phones: [{ online: false, capable: true }] })).channels(ctx());
    expect(offline.channels[1]).toMatchObject({ state: 'unavailable', reason: 'NO_PHONE_ONLINE' });
    await q(sql`insert into skip_line_checkout_settings (tenant_id, feature_enabled) values (${T}, false)`);
    const off = await center().channels(ctx());
    expect(off.channels[2]).toMatchObject({ state: 'setup_required', reason: 'APP_PAYMENTS_OFF' });
    await q(sql`delete from skip_line_checkout_settings where tenant_id = ${T}`);
  });
});

describe('Three Ways to Pay — the ticket and cross-channel holds', () => {
  it('PC-03 an unpaid ticket: server due in cents, every ready channel may act', async () => {
    const tid = await ticket();
    await q(sql`insert into customer_payment_methods (tenant_id, customer_id, gateway, token, brand, last4, is_default, token_source, verified_at) values (${T}, ${C}, 'test-gateway', 'tok-fixture-1', 'VISA', '1111', true, 'hosted_iframe', now())`);
    await q(sql`insert into customer_payment_methods (tenant_id, customer_id, gateway, token, brand, last4, is_default, token_source, revoked_at) values (${T}, ${C}, 'test-gateway', 'tok-fixture-2', 'VISA', '2222', false, 'hosted_iframe', now())`);
    const r = await center().channels(ctx(), tid);
    expect(r.ticket).toMatchObject({ id: tid, status: 'unpaid', paidCents: 0, hasCustomer: true });
    expect(r.channels[2].facts.customerSavedCards).toBe(1);   // a revoked card does not count; no token ever leaves
    expect(JSON.stringify(r)).not.toContain('tok-fixture');
    expect(r.ticket!.dueCents).toBeGreaterThanOrEqual(5000);
    expect(r.channels.every((c) => c.actionAllowed)).toBe(true);
  });
  it('PC-04 a payment in progress on one channel holds the other two (no second tender)', async () => {
    const tid = await ticket();
    await q(sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, payment_surface) values (${T}, ${B}, ${tid}, 5000, 'card', 'awaiting_customer_tap', ${'pc-' + tid}, 'tap_to_pay_iphone')`);
    const r = await center().channels(ctx(), tid);
    expect(r.ticket).toMatchObject({ status: 'in_progress', inProgressVia: 'tap_to_pay_iphone' });
    expect(r.channels.map((c) => c.actionHeldBy)).toEqual(['payment_in_progress', 'payment_in_progress', 'payment_in_progress']);
  });
  it('PC-05 UNKNOWN is never paid and never declined — verify first', async () => {
    const tid = await ticket();
    await q(sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, payment_surface) values (${T}, ${B}, ${tid}, 5000, 'card', 'unknown', ${'pcu-' + tid}, 'clover_compact')`);
    const r = await center().channels(ctx(), tid);
    expect(r.ticket).toMatchObject({ status: 'unknown', inProgressVia: 'clover_compact', paidVia: null });
    expect(r.channels.every((c) => c.actionHeldBy === 'verify_first' && !c.actionAllowed)).toBe(true);
  });
  it('PC-06 paid in the Customer App: the ledger says so and Clover / iPhone are held', async () => {
    const tid = await ticket({ status: 'paid', paid: true });
    await q(sql`insert into payment_intents (tenant_id, branch_id, ticket_id, customer_id, amount_cents, method, status, processor_ref) values (${T}, ${B}, ${tid}, ${C}, 5000, 'card', 'succeeded', 'RR-APP-1')`);
    await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents, processor_transaction_id, approved_at) values (${T}, ${B}, ${tid}, 'card', 5000, 0, 0, 0, 'approved', 0, 'RR-APP-1', now())`);
    const r = await center().channels(ctx(), tid);
    expect(r.ticket).toMatchObject({ status: 'paid', paidVia: 'customer_app', paidCents: 5000, balanceCents: 0 });
    expect(r.ticket!.paidAt).toBeTruthy();
    expect(r.channels.every((c) => c.actionHeldBy === 'ticket_paid')).toBe(true);
  });
  it('PC-07 a partial payment shows the remaining balance; every channel sees only what is left', async () => {
    const tid = await ticket();
    await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents) values (${T}, ${B}, ${tid}, 'cash', 2000, 0, 0, 0, 'approved', 0)`);
    const r = await center().channels(ctx(), tid);
    expect(r.ticket).toMatchObject({ status: 'partially_paid', paidCents: 2000 });
    expect(r.ticket!.balanceCents).toBe(r.ticket!.dueCents! - 2000);
    expect(r.channels.every((c) => c.actionAllowed)).toBe(true);
  });
  it('PC-08 scope: another location\'s ticket, a bad id, another salon\'s ticket', async () => {
    const other = await ticket({ branch: B2 });
    expect(await code(center().channels(ctx(), other))).toBe('PAYMENT_CHANNELS_OTHER_LOCATION');
    expect(await code(center().channels(ctx(), 'not-a-uuid'))).toBe('PAYMENT_CHANNELS_TICKET_INVALID');
    const xc = (await q(sql`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, status) values (${X}, ${BX}, 'X', 'Y', 'X Y', 'active') returning id`))[0].id;
    const xt = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${X}, ${BX}, ${xc}, 'open', 100, 0, 0, 100) returning id`))[0].id;
    expect(await code(center().channels(ctx(), String(xt)))).toBe('TICKET_NOT_FOUND');
  });
});

describe('Check Three Payment Channels', () => {
  it('PC-09 read-only: never charges, reports UAT and the production gate honestly, flags unknown payments', async () => {
    const before = (await q(sql`select (select count(*) from payments)::int p, (select count(*) from payment_attempts)::int a, (select count(*) from payment_intents)::int i`))[0];
    const g = gw();
    const r = await center(g).check(ctx());
    const after = (await q(sql`select (select count(*) from payments)::int p, (select count(*) from payment_attempts)::int a, (select count(*) from payment_intents)::int i`))[0];
    expect(after).toEqual(before);
    expect(g.calls.every((c) => ['resolve', 'terminal', 'ttp', 'tok'].includes(c))).toBe(true);   // reads only
    const by = Object.fromEntries(r.checks.map((c) => [c.key, c]));
    expect(by.clover_compact.state).toBe('WARNING'); expect(by.clover_compact.reason).toBe('UAT_TEST_LANE');
    expect(by.live_mode).toMatchObject({ state: 'PROVIDER_APPROVAL_PENDING', reason: 'PRODUCTION_PAYMENTS_DISABLED' });
    expect(by.unknown_payments.state).toBe('WARNING'); expect(by.unknown_payments.count).toBeGreaterThanOrEqual(1);
    expect(by.terminal_ping.state).toBe('PASSED');
    expect(by.no_side_effects.state).toBe('PASSED');
    expect(r.overall).not.toBe('PASSED');   // never a generic "all working" while UAT / approvals are open
  });
});
