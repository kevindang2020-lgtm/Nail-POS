// ai-invoices-branches.pgtest — Four-Module Completion Guide (Oct 30 2026) AI-01 + AI-02, against the REAL schema (728).
//   AI-01  provider invoice ledger: the guide's acceptance ($59 base, -$10 proration, $3 tax, $0 paid → finalized $52, paid $0,
//          due $52 — never "$59 paid"), later payment, refund, multiple invoices + mid-cycle upgrade, missing finalized invoice
//          (Pending / none — no invented tax), duplicate webhook / retry / out-of-order idempotency, read-only reconciliation
//          runs (fixture client; unconfigured → visible failure), nothing charged, tenant isolation.
//   AI-02  branch operational override: Branch A on, Branch B off with ONE subscription and ONE shared quota; global disable
//          beats a branch enable; an expired entitlement cannot be bypassed; versioned, audited, permission- and tenant-checked.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiUsageScreenRepository, AiUsageScreenError } from './ai-usage-screen.repository';
import { KyselyAiAccessRepo, KyselyAiUsageLogger } from '../../../ai/src/ai/ai-access.kysely.repository';
import { evaluateAiAccess } from '../../../ai/src/ai/ai-access-gate';
import { AiInvoiceLedger, FixtureInvoiceClient, UnconfiguredInvoiceClient, mapStripeInvoiceEvent, invoiceFigures, type ProviderInvoice } from '../../../ai/src/ai/ai-billing-invoices';

const P = 'c5e84728-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), BA = id('b1'), BB = id('b2'), BO = id('b3'), OWNER = id('e1'), MGR = id('e2'), OWNER2 = id('e3');
const OWNER_PERMS = ['ai.use', 'ai.manage', 'subscription.manage', 'reports.export'];
const ctx = { tenantId: T, branchId: BA, userId: OWNER, role: 'OWNER', permissions: OWNER_PERMS };
const manager = { tenantId: T, branchId: BA, userId: MGR, role: 'MANAGER', permissions: ['ai.use'] };
const ctx2 = { tenantId: T2, branchId: BO, userId: OWNER2, role: 'OWNER', permissions: OWNER_PERMS };
const MKT = 'ai_marketing_assistant', BOOK = 'ai_booking_assistant', BIZ = 'ai_business_assistant', RC = 'ai_reception_copilot', INV = 'ai_inventory_assistant';
let pg: any; let db: any; let repo: AiUsageScreenRepository; let ledger: AiInvoiceLedger;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const rows = async (s: string, p: unknown[] = []) => (await q(s, p)).rows;
const audit = async () => undefined;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof AiUsageScreenError ? e.code : String((e as Error).message); } }
const today = new Date().toISOString().slice(0, 10);
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const FIN = ago(1);
const inv = (o: Partial<ProviderInvoice> & { id: string }): ProviderInvoice => ({ status: 'open', currency: 'USD', invoiceDate: today, periodStart: today, periodEnd: today, updatedAt: ago(1), lines: [], ...o });
const acceptance = (o: Partial<ProviderInvoice> = {}) => inv({ id: 'in_accept', number: 'AI-0001', packageCode: MKT, status: 'open', taxCents: 300, totalCents: 5200, amountPaidCents: 0, amountDueCents: 5200,
  finalizedAt: FIN, updatedAt: ago(1), reference: 'AI-0001',
  lines: [{ id: 'li_base', kind: 'subscription', amountCents: 5900, packageCode: MKT, description: 'AI Marketing Assistant (monthly)' },
          { id: 'li_pro', kind: 'proration', amountCents: -1000, packageCode: MKT, description: 'Unused time credit' }], ...o });

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','i7-lotus','I7L001','active'), ($2,'Other LLC','Other Nails','i7-other','I7L002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$4,'Cherry Hill','active','America/New_York'), ($2,$4,'Voorhees','active','America/New_York'), ($3,$5,'Elsewhere','active','America/New_York')`, [BA, BB, BO, T, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$4,'o@i7.test','Pat Owner','OWNER','active'), ($2,$4,'m@i7.test','Mai Manager','MANAGER','active'), ($3,$5,'o2@i7.test','Other Owner','OWNER','active')`, [OWNER, MGR, OWNER2, T, T2]);
  const sub = (t: string, c: string, status: string, price: number, limit: number, extra = '') => q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status, billing_period, price_cents, usage_limit, current_period_starts_at, created_at${extra ? ', trial_starts_at, trial_ends_at' : ''})
    values ($1,$2,$3,'monthly',$4,$5, now() - interval '10 days', now() - interval '40 days'${extra})`, [t, c, status, price, limit]);
  await sub(T, MKT, 'active', 5900, 500);
  await sub(T, BOOK, 'active', 4900, 100);
  await sub(T, RC, 'active', 5900, 2000);
  await sub(T, INV, 'active', 3900, 1000);
  await sub(T, BIZ, 'trialing', 5900, 1000, `, now() - interval '20 days', now() - interval '6 days'`);   // lapsed trial
  await sub(T2, MKT, 'active', 5900, 500);
  db = kyselyFor(pg); repo = new AiUsageScreenRepository(db); ledger = new AiInvoiceLedger(db);
}, 180_000);

describe('AI-01 invoice-backed charges', () => {
  it('guide acceptance: $59 base, -$10 proration, $3 tax, $0 paid → finalized $52, paid $0, due $52 (not $59 paid)', async () => {
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_1', eventType: 'invoice.finalized', tenantId: T, invoice: acceptance() })).outcome).toBe('created');
    const b: any = (await repo.detail(ctx, MKT))!.billing;
    const x = b.invoiced;
    expect(x.recurringCents).toBe(5900);                       // the plan price, shown apart
    expect(x.estimate.assumptions.length).toBeGreaterThan(0);    // the estimate carries its assumptions
    expect(x.currentPeriod.finalizedCents).toBe(5200); expect(x.currentPeriod.paidCents).toBe(0); expect(x.currentPeriod.outstandingCents).toBe(5200);
    expect(x.currentPeriod.taxCents).toBe(300); expect(x.currentPeriod.taxState).toBe('provided'); expect(x.currentPeriod.prorationCents).toBe(-1000);
    const i = x.invoices[0]; expect(i.number).toBe('AI-0001'); expect(i.status).toBe('open'); expect(i.finalized).toBe(true); expect(i.subtotalCents).toBe(5900); expect(i.totalCents).toBe(5200);
    const s: any = (await repo.summary(ctx)).cost;
    expect(s.invoiced.currentPeriod.finalizedCents).toBe(5200); expect(s.invoiced.currentPeriod.paidCents).toBe(0);
    expect(s.basis).not.toBe('reconciled');                    // a finalized invoice is not a payment
    expect((await repo.summary(manager)).cost.visible).toBe(false);   // owner-only
    expect((await repo.detail(manager, MKT))!.billing.visible).toBe(false);
  });
  it('a re-delivered webhook is recorded once; a payment-retry with the same snapshot is unchanged; an older snapshot never wins', async () => {
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_1', eventType: 'invoice.finalized', tenantId: T, invoice: acceptance() })).outcome).toBe('duplicate');
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_2', eventType: 'invoice.payment_failed', tenantId: T, invoice: acceptance({ updatedAt: ago(0.5) }) })).outcome).toBe('unchanged');
    const paid = acceptance({ status: 'paid', amountPaidCents: 5200, amountDueCents: 0, paidAt: ago(0.2), updatedAt: ago(0.2) });
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_3', eventType: 'invoice.paid', tenantId: T, invoice: paid })).outcome).toBe('updated');
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_4', eventType: 'invoice.finalized', tenantId: T, invoice: acceptance({ updatedAt: ago(0.9) }) })).outcome).toBe('stale');
    expect((await rows(`select count(*)::int n from ai_billing_invoice_links where tenant_id = $1`, [T]))[0].n).toBe(1);
    expect((await rows(`select count(*)::int n from ai_billing_invoice_events where tenant_id = $1`, [T]))[0].n).toBe(4);
    expect((await rows(`select count(*)::int n from ai_billing_invoice_line_snapshots where tenant_id = $1`, [T]))[0].n).toBe(2);   // replaced, not doubled
    const x: any = (await repo.detail(ctx, MKT))!.billing.invoiced.currentPeriod;
    expect([x.finalizedCents, x.paidCents, x.outstandingCents]).toEqual([5200, 5200, 0]);
    expect(await code(q(`delete from ai_billing_invoice_events where tenant_id = $1`, [T]))).toMatch(/append-only/);
  });
  it('a refund is listed apart from payments; paid stays the confirmed payment', async () => {
    await ledger.ingest({ provider: 'stripe', eventId: 'evt_5', eventType: 'charge.refunded', tenantId: T, invoice: acceptance({ status: 'paid', amountPaidCents: 5200, amountRefundedCents: 2000, amountDueCents: 0, updatedAt: ago(0.1) }) });
    const x: any = (await repo.detail(ctx, MKT))!.billing.invoiced.currentPeriod;
    expect([x.paidCents, x.refundedCents, x.outstandingCents]).toEqual([5200, 2000, 0]);
  });
  it('multiple invoices and a mid-cycle upgrade: each invoice kept, prorations net, totals add up', async () => {
    await ledger.ingest({ provider: 'stripe', eventId: 'evt_b1', eventType: 'invoice.paid', tenantId: T, invoice: inv({ id: 'in_book_1', number: 'AI-0002', status: 'paid', taxCents: 0, amountPaidCents: 4900, amountDueCents: 0,
      lines: [{ id: 'b1', kind: 'subscription', amountCents: 4900, packageCode: BOOK }] }) });
    await ledger.ingest({ provider: 'stripe', eventId: 'evt_b2', eventType: 'invoice.finalized', tenantId: T, invoice: inv({ id: 'in_book_up', number: 'AI-0003', status: 'open', taxCents: 120, amountPaidCents: 0,
      lines: [{ id: 'u1', kind: 'proration', amountCents: -2450, packageCode: BOOK, description: 'Unused Booking (monthly)' }, { id: 'u2', kind: 'proration', amountCents: 4450, packageCode: BOOK, description: 'Remaining Booking Plus' }] }) });
    const f = invoiceFigures(inv({ id: 'x', taxCents: 120, lines: [{ id: 'u1', kind: 'proration', amountCents: -2450 }, { id: 'u2', kind: 'proration', amountCents: 4450 }] }));
    expect([f.subtotalCents, f.prorationCents, f.totalCents, f.totalSource]).toEqual([0, 2000, 2120, 'computed']);
    const x: any = (await repo.detail(ctx, BOOK))!.billing.invoiced;
    expect(x.invoices.length).toBe(2);
    expect([x.currentPeriod.finalizedCents, x.currentPeriod.paidCents, x.currentPeriod.outstandingCents, x.currentPeriod.prorationCents]).toEqual([4900 + 2120, 4900, 2120, 2000]);
  });
  it('missing finalized invoice: a draft without tax is Pending, a package without any invoice has none — never $0 or invented tax', async () => {
    await ledger.ingest({ provider: 'stripe', eventId: 'evt_d1', eventType: 'invoice.created', tenantId: T, invoice: inv({ id: 'in_rc_draft', status: 'draft', taxCents: null,
      lines: [{ id: 'd1', kind: 'subscription', amountCents: 5900, packageCode: RC }] }) });
    const d: any = (await repo.detail(ctx, RC))!.billing.invoiced;
    expect(d.currentPeriod.finalizedCents).toBeNull(); expect(d.currentPeriod.taxState).toBe('pending'); expect(d.currentPeriod.draftInvoices).toBe(1); expect(d.invoices[0].taxState).toBe('pending');
    const n: any = (await repo.detail(ctx, INV))!.billing.invoiced;
    expect(n.invoices.length).toBe(0); expect(n.currentPeriod.finalizedCents).toBeNull(); expect(n.currentPeriod.taxState).toBe('none'); expect(n.recurringCents).toBe(3900);
    // finalized but the provider sent no tax → Unknown (the total is still the provider's)
    await ledger.ingest({ provider: 'stripe', eventId: 'evt_d2', eventType: 'invoice.finalized', tenantId: T, invoice: inv({ id: 'in_rc_draft', status: 'open', taxCents: null, totalCents: 5900, updatedAt: ago(0.5),
      lines: [{ id: 'd1', kind: 'subscription', amountCents: 5900, packageCode: RC }] }) });
    const u: any = (await repo.detail(ctx, RC))!.billing.invoiced.currentPeriod;
    expect([u.finalizedCents, u.taxCents, u.taxState]).toEqual([5900, null, 'unknown']);
  });
  it('invalid snapshots are rejected and logged, never half-recorded', async () => {
    const r = await ledger.ingest({ provider: 'stripe', eventId: 'evt_bad', eventType: 'invoice.finalized', tenantId: T, invoice: inv({ id: 'in_bad', totalCents: 12.5 as any, lines: [] }) });
    expect(r).toEqual({ outcome: 'rejected', reason: 'non_integer_totalCents' });
    expect((await rows(`select count(*)::int n from ai_billing_invoice_links where provider_invoice_id = 'in_bad'`))[0].n).toBe(0);
    expect((await ledger.ingest({ provider: 'stripe', eventId: 'evt_unknown_t', eventType: 'invoice.finalized', tenantId: id('ff'), invoice: acceptance({ id: 'in_x' }) })).reason).toBe('unknown_tenant');
  });
  it('reconciliation re-reads the provider (read-only), is idempotent, never charges; unconfigured → visible failure', async () => {
    const before = await rows(`select package_code, status, last_payment_status, current_period_starts_at from tenant_ai_subscriptions where tenant_id = $1 order by package_code`, [T]);
    const billingEvents = (await rows(`select count(*)::int n from ai_billing_events`))[0].n;
    const client = new FixtureInvoiceClient({ [T]: [inv({ id: 'in_recon', number: 'AI-0004', status: 'open', taxCents: 0, updatedAt: ago(0.3), lines: [{ id: 'r1', kind: 'subscription', amountCents: 3900, packageCode: INV }] }), acceptance({ status: 'paid', amountPaidCents: 5200, amountRefundedCents: 2000, amountDueCents: 0, updatedAt: ago(0.1) })] }, 'stripe');
    const r1 = await new AiUsageScreenRepository(db, client).reconcileInvoices(ctx, { idempotencyKey: 'recon-key-0001' });
    expect([r1.status, r1.seen, r1.created, r1.unchanged, r1.duplicate]).toEqual(['succeeded', 2, 1, 1, false]);
    const again = await new AiUsageScreenRepository(db, client).reconcileInvoices(ctx, { idempotencyKey: 'recon-key-0001' });
    expect([again.duplicate, again.runId]).toEqual([true, r1.runId]);
    const r2 = await new AiUsageScreenRepository(db, client).reconcileInvoices(ctx, { idempotencyKey: 'recon-key-0002' });
    expect([r2.created, r2.unchanged]).toEqual([0, 2]);
    const none = await repo.reconcileInvoices(ctx, { idempotencyKey: 'recon-key-0003' });
    expect([none.status, none.errorCode]).toEqual(['failed', 'provider_not_configured']);
    const last: any = (await repo.detail(ctx, INV))!.billing.invoiced;
    expect(last.lastRun.status).toBe('failed'); expect(last.providerConfigured).toBe(false); expect(last.currentPeriod.finalizedCents).toBe(3900);
    expect(await code(repo.reconcileInvoices(manager, { idempotencyKey: 'recon-key-0004' }))).toBe('PERMISSION_DENIED');
    expect(await rows(`select package_code, status, last_payment_status, current_period_starts_at from tenant_ai_subscriptions where tenant_id = $1 order by package_code`, [T])).toEqual(before);
    expect((await rows(`select count(*)::int n from ai_billing_events`))[0].n).toBe(billingEvents);   // no status / payment event invented
    expect(new UnconfiguredInvoiceClient().configured).toBe(false);
  });
  it('tenant isolation: the other salon sees none of these invoices and its reconciliation touches only itself', async () => {
    expect(((await repo.detail(ctx2, MKT))!.billing as any).invoiced.invoices.length).toBe(0);
    const c2 = new FixtureInvoiceClient({ [T2]: [acceptance({ id: 'in_t2' })] }, 'stripe');
    await new AiUsageScreenRepository(db, c2).reconcileInvoices(ctx2, { idempotencyKey: 'recon-t2-0001' });
    expect((await rows(`select count(*)::int n from ai_billing_invoice_links where tenant_id = $1`, [T2]))[0].n).toBe(1);
    expect(((await repo.detail(ctx, MKT))!.billing as any).invoiced.invoices.map((i: any) => i.number)).toEqual(['AI-0001']);
  });
  it('a Stripe-shaped invoice webhook maps to the same ledger (tenant / package from metadata)', async () => {
    const m = mapStripeInvoiceEvent({ id: 'evt_s1', type: 'invoice.finalized', created: Math.floor(Date.now() / 1000), data: { object: { object: 'invoice', id: 'in_s1', number: 'S-1', status: 'open', currency: 'usd',
      created: Math.floor(Date.now() / 1000), tax: 300, total: 5200, amount_paid: 0, amount_remaining: 5200, metadata: { tenant_id: T, package_code: MKT },
      lines: { data: [{ id: 'sl1', amount: 5900, proration: false }, { id: 'sl2', amount: -1000, proration: true }] } } } });
    expect(m && m.ok).toBe(true);
    if (m && m.ok) { expect(invoiceFigures(m.value.invoice).totalCents).toBe(5200); expect((await ledger.ingest(m.value)).outcome).toBe('created'); }
    expect(mapStripeInvoiceEvent({ type: 'charge.refunded', data: { object: { object: 'charge' } } })).toBeNull();
  });
});

describe('AI-02 per-branch operational settings', () => {
  const gate = (code: string, branchId: string | null) => new KyselyAiAccessRepo(db).loadSnapshot(T, code, OWNER, { branchId }).then(evaluateAiAccess);
  it('Branch A on, Branch B off: one subscription, one shared quota, branch usage attributed', async () => {
    const d0: any = (await repo.detail(ctx, BOOK))!.settings.branches;
    expect(d0.items.map((b: any) => [b.name, b.override, b.effective, b.version])).toEqual([['Cherry Hill', null, 'on', 0], ['Voorhees', null, 'on', 0]]);
    const r = await repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: false, settings: { autoConfirmBookings: false }, expectedVersion: 0, reason: 'Voorhees front desk books by hand' }, audit);
    expect([r.changed, r.version]).toEqual([true, 1]);
    expect((await gate(BOOK, BA)).allowed).toBe(true);
    const b = await gate(BOOK, BB); expect([b.allowed, b.reason]).toEqual([false, 'branch_disabled']);
    expect((await gate(BOOK, null)).allowed).toBe(true);   // no branch context = salon decision
    const log = new KyselyAiUsageLogger(db);
    const e = (branchId: string | null, n: number) => log.log({ tenantId: T, userId: OWNER, packageCode: BOOK, action: 'invoke', modelProvider: null, modelName: null, inputTokens: 0, outputTokens: 0, usageUnit: 'messages', usageAmount: n, costMicroUsd: 0, status: 'success', createdAt: new Date().toISOString(), branchId });
    await e(BA, 60); await e(BB, 30); await e(null, 5);
    expect((await rows(`select count(*)::int n from tenant_ai_subscriptions where tenant_id = $1 and package_code = $2`, [T, BOOK]))[0].n).toBe(1);
    const snap = await new KyselyAiAccessRepo(db).loadSnapshot(T, BOOK, OWNER, { branchId: BA });
    expect([snap.usage.used, snap.usage.limit]).toEqual([95, 100]);   // tenant-wide: A + B + unattributed
    const over = await new KyselyAiAccessRepo(db).loadSnapshot(T, BOOK, OWNER, { branchId: BA }).then((s) => evaluateAiAccess({ ...s, requestedUsage: 10 }));
    expect(over.reason).toBe('limit_exceeded');                       // Branch A hits the SHARED allowance B helped use
    const d1: any = (await repo.detail(ctx, BOOK))!.settings.branches;
    expect(d1.items.map((x: any) => [x.name, x.effective, x.usedThisPeriod])).toEqual([['Cherry Hill', 'on', 60], ['Voorhees', 'off_branch', 30]]);
    expect([d1.quota.scope, d1.quota.used, d1.quota.unattributed, d1.quota.attribution, d1.billingScope]).toEqual(['shared_tenant', 95, 5, 'partial', 'tenant_subscription']);
    const h = await rows(`select version, from_override, to_override, reason from tenant_ai_branch_settings_history where tenant_id = $1 and package_code = $2`, [T, BOOK]);
    expect(h).toEqual([{ version: 1, from_override: null, to_override: false, reason: 'Voorhees front desk books by hand' }]);
    expect(await code(q(`update tenant_ai_branch_settings_history set reason = 'x' where tenant_id = $1`, [T]))).toMatch(/append-only/);
  });
  it('usage without any branch id reads "attribution unavailable", never a guess', async () => {
    const d: any = (await repo.detail(ctx, MKT))!.settings.branches;
    await q(`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at) values ($1,$2,'generations',40,'success',gen_random_uuid()::text, now() - interval '1 day')`, [T, MKT]);
    const d2: any = (await repo.detail(ctx, MKT))!.settings.branches;
    expect(d.quota.attribution).toBe('no_usage'); expect(d2.quota.attribution).toBe('unavailable'); expect(d2.items.every((x: any) => x.usedThisPeriod === null)).toBe(true);
  });
  it('a global disable beats a branch enable', async () => {
    await repo.setBranchSetting(ctx, RC, BA, { overrideEnabled: true, settings: {}, expectedVersion: 0 }, audit);
    expect((await gate(RC, BA)).allowed).toBe(true);
    await q(`insert into platform_ai_package_settings (package_code, enabled, disabled_reason) values ($1, false, 'Provider maintenance')`, [RC]);
    const g = await gate(RC, BA); expect([g.allowed, g.reason]).toEqual([false, 'package_disabled']);
    expect(await code(repo.setBranchSetting(ctx, RC, BB, { overrideEnabled: true, settings: {}, expectedVersion: 0 }, audit))).toBe('AI_BRANCH_CANNOT_ENABLE');
    const d: any = (await repo.detail(ctx, RC))!.settings.branches;
    expect(d.items.map((x: any) => [x.name, x.override, x.effective])).toEqual([['Cherry Hill', true, 'off_platform'], ['Voorhees', null, 'off_platform']]);
    await q(`delete from platform_ai_package_settings where package_code = $1`, [RC]);
  });
  it('an expired entitlement cannot be bypassed by a branch', async () => {
    expect(await code(repo.setBranchSetting(ctx, BIZ, BA, { overrideEnabled: true, settings: {}, expectedVersion: 0 }, audit))).toBe('AI_BRANCH_CANNOT_ENABLE');
    await q(`insert into tenant_ai_branch_settings (tenant_id, branch_id, package_code, override_enabled) values ($1,$2,$3,true)`, [T, BA, BIZ]);   // even a forced row
    const g = await gate(BIZ, BA); expect([g.allowed, g.reason]).toEqual([false, 'trial_expired']);
    const d: any = (await repo.detail(ctx, BIZ))!.settings.branches;
    expect(d.items.find((x: any) => x.branchId === BA).effective).toBe('off_not_entitled');
    expect((await repo.setBranchSetting(ctx, BIZ, BB, { overrideEnabled: false, settings: {}, expectedVersion: 0 }, audit)).changed).toBe(true);   // turning OFF is always allowed
  });
  it('version, validation, permission, tenant isolation and a failed audit are all enforced', async () => {
    expect(await code(repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: null, settings: {}, expectedVersion: 0 }, audit))).toBe('AI_STATE_CHANGED');   // stale (current 1)
    expect(await code(repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: null, settings: { surprise: true }, expectedVersion: 1 }, audit))).toBe('AI_INVALID_SETTINGS');
    expect(await code(repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: null, settings: { autoConfirmBookings: 'yes' }, expectedVersion: 1 }, audit))).toBe('AI_INVALID_SETTINGS');
    expect(await code(repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: 'off' as any, settings: {}, expectedVersion: 1 }, audit))).toBe('AI_INVALID_SETTINGS');
    expect(await code(repo.setBranchSetting(manager, BOOK, BB, { overrideEnabled: null, settings: {}, expectedVersion: 1 }, audit))).toBe('PERMISSION_DENIED');
    expect(await code(repo.setBranchSetting(ctx, BOOK, BO, { overrideEnabled: false, settings: {}, expectedVersion: 0 }, audit))).toBe('AI_BRANCH_NOT_FOUND');   // other salon's branch
    expect(await code(repo.setBranchSetting(ctx2, BOOK, BB, { overrideEnabled: false, settings: {}, expectedVersion: 1 }, audit))).toBe('AI_BRANCH_NOT_FOUND');
    expect(await code(repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: null, settings: {}, expectedVersion: 1 }, async () => { throw new Error('audit down'); }))).toBe('audit down');
    expect((await rows(`select override_enabled, version from tenant_ai_branch_settings where tenant_id = $1 and branch_id = $2 and package_code = $3`, [T, BB, BOOK]))[0]).toEqual({ override_enabled: false, version: 1 });
    const same = await repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: false, settings: { autoConfirmBookings: false }, expectedVersion: 1 }, audit);
    expect([same.changed, same.version]).toEqual([false, 1]);   // a repeat changes nothing
    const back = await repo.setBranchSetting(ctx, BOOK, BB, { overrideEnabled: null, settings: {}, expectedVersion: 1 }, audit);
    expect(back.version).toBe(2); expect((await gate(BOOK, BB)).reason).not.toBe('branch_disabled');   // Inherit again
    const mgrView: any = (await repo.detail(manager, BOOK))!.settings.branches;
    expect([mgrView.canEdit, mgrView.items.map((x: any) => x.name)]).toEqual([false, ['Cherry Hill']]);   // the manager's own branch only
    expect(((await repo.detail(ctx2, BOOK))!.settings.branches as any).items.map((x: any) => x.name)).toEqual(['Elsewhere']);
  });
});
