// ai-usage-screen.pgtest — AI Usage & Limits Complete Build Guide (Oct 30 2026), against the REAL schema.
//   §7   states: a lapsed trial is Trial expired (no Cancel); Cancelled has no Cancel; Past due is not a renewal;
//        Disabled by admin (global switch or tenant row) offers neither trial nor upgrade; an unknown code is kept
//   §12/13 search · status / category filters · 8 per page · stable catalog order
//   §14  usage = success rows since the subscription's period start (the gate's rule); units never mixed
//   §10  80 / 90 / 100 % alerts recorded once per period × threshold, never charging or upgrading
//   §9   cost = subscription prices (yearly ÷ 12, labelled), trials not cost, past due flagged, "subscription records"
//        unless every paying package has a payment this period; hidden from roles without subscription.manage
//   §7   start trial / cancel: server-validated, confirmed, idempotent, audited in the transaction (audit failure → no change)
//   §15  history newest first, filters, invalid range, CSV with redacted references
//   §16  tenant isolation · the access gate enforces the Super Admin switch · the switch needs a reason and a version
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiUsageScreenRepository, AiUsageScreenError } from './ai-usage-screen.repository';
import { displayStateOf } from './ai-usage-states';
import { KyselyAiAccessRepo } from '../../../ai/src/ai/ai-access.kysely.repository';
import { evaluateAiAccess } from '../../../ai/src/ai/ai-access-gate';
import { AiAdminService, AiAdminError } from '../super-admin-ai/ai-admin.service';

const P = 'c5e84000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), OWNER = id('e1');
const OWNER_PERMS = ['ai.use', 'ai.manage', 'subscription.manage', 'reports.export'];
const ctx = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: OWNER_PERMS };
const manager = { tenantId: T, userId: id('e2'), role: 'MANAGER', permissions: ['ai.use'] };
const ctx2 = { tenantId: T2, userId: id('e3'), role: 'OWNER', permissions: OWNER_PERMS };
let pg: any; let db: any; let repo: AiUsageScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const noAudit = async () => undefined;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof AiUsageScreenError || e instanceof AiAdminError ? (e as any).code === 'bad_request' || (e as any).code === 'not_found' ? (e as Error).message : (e as any).code : String((e as Error).message); } }

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','au-lotus','AUL001','active'), ($2,'Other LLC','Other Nails','au-other','AUL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  const sub = (tenant: string, code: string, status: string, o: { price?: number; period?: string; limit?: number; trialEnd?: string | null; trialStart?: string | null; periodStart?: string } = {}) =>
    q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status, billing_period, price_cents, usage_limit, trial_starts_at, trial_ends_at, current_period_starts_at, created_at)
       values ($1,$2,$3,$4,$5,$6, ${o.trialStart ?? 'null'}, ${o.trialEnd ?? 'null'}, ${o.periodStart ?? "now() - interval '10 days'"}, now() - interval '20 days')`, [tenant, code, status, o.period ?? 'monthly', o.price ?? 0, o.limit ?? 0]);
  await sub(T, 'ai_business_assistant', 'trialing', { price: 5900, limit: 1000, trialStart: "now() - interval '16 days'", trialEnd: "now() - interval '2 days'" });
  await sub(T, 'ai_marketing_assistant', 'active', { price: 5900, limit: 500 });
  await sub(T, 'ai_customer_profile_assistant', 'active', { price: 46800, period: 'yearly', limit: 2000 });
  await sub(T, 'ai_checkout_upsell_assistant', 'active', { price: 4900, limit: 3000 });
  await sub(T, 'ai_reception_copilot', 'cancelled', { price: 5900, limit: 2000 });
  await sub(T, 'ai_fraud_money_protection', 'past_due', { price: 6900, limit: 10000 });
  await sub(T, 'ai_inventory_assistant', 'trialing', { price: 3900, limit: 1000, trialStart: "now() - interval '3 days'", trialEnd: "now() + interval '11 days'" });
  await sub(T, 'ai_ocr_receipt_scanner', 'disabled', { price: 2900, limit: 500 });
  await sub(T, 'ai_analytics_forecasting', 'expired', { price: 7900, limit: 500, trialStart: "now() - interval '40 days'", trialEnd: "now() - interval '26 days'" });
  await sub(T, 'ai_legacy_package_x', 'active', { price: 1000, limit: 0 });
  await sub(T2, 'ai_marketing_assistant', 'active', { price: 5900, limit: 500 });
  await q(`insert into platform_ai_package_settings (package_code, enabled, disabled_reason) values ('ai_voice_transcription', false, 'Provider maintenance')`);
  const use = (tenant: string, code: string, amount: number, ago: string, status = 'success', unit = 'calls') => q(`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at)
    values ($1,$2,$3,$4,$5, gen_random_uuid()::text, now() - $6::interval)`, [tenant, code, unit, amount, status, ago]);
  await use(T, 'ai_marketing_assistant', 400, '2 days', 'success', 'generations');          // 80 %
  await use(T, 'ai_marketing_assistant', 50, '1 day', 'failed', 'generations');             // failed: not counted
  await use(T, 'ai_customer_profile_assistant', 1800, '3 days', 'success', 'messages');     // 90 %
  await use(T, 'ai_checkout_upsell_assistant', 3000, '1 day');                              // 100 %
  await use(T, 'ai_checkout_upsell_assistant', 900, '20 days');                             // previous period: not counted
  await use(T2, 'ai_marketing_assistant', 500, '1 day', 'success', 'generations');
  await q(`insert into ai_billing_events (event_id, tenant_id, package_code, event_type, provider, payment_status, applied, created_at) values ('ev-m-1', $1, 'ai_marketing_assistant', 'payment_succeeded', 'cardpointe', 'paid', true, now() - interval '5 days')`, [T]);
  db = kyselyFor(pg); repo = new AiUsageScreenRepository(db);
}, 180_000);

describe('§7 states and actions', () => {
  it('every stored situation maps to one honest state with only valid actions', async () => {
    const all = (await repo.packages(ctx, { pageSize: 24 })).items;
    const by = Object.fromEntries(all.map((c) => [c.code, c]));
    expect(by.ai_business_assistant!.state).toBe('trial_expired'); expect(by.ai_business_assistant!.actions).not.toContain('cancel');
    expect(by.ai_reception_copilot!.state).toBe('cancelled'); expect(by.ai_reception_copilot!.actions).not.toContain('cancel'); expect(by.ai_reception_copilot!.actions).toContain('reactivate');
    expect(by.ai_fraud_money_protection!.state).toBe('past_due'); expect(by.ai_fraud_money_protection!.actions).toContain('update_billing');
    expect(by.ai_inventory_assistant!.state).toBe('trialing'); expect(by.ai_inventory_assistant!.trial.daysLeft).toBeGreaterThanOrEqual(10);
    expect(by.ai_review_reputation_assistant!.state).toBe('trial_available'); expect(by.ai_review_reputation_assistant!.primaryAction).toBe('start_trial');
    expect(by.ai_voice_transcription!.state).toBe('disabled_by_admin'); expect(by.ai_voice_transcription!.actions).toEqual(['view_details']); expect(by.ai_voice_transcription!.disabledReason).toBe('Provider maintenance');
    expect(by.ai_ocr_receipt_scanner!.state).toBe('disabled_by_admin');
    expect(by.ai_analytics_forecasting!.state).toBe('trial_expired');
    expect(by.ai_legacy_package_x!.known).toBe(false); expect(by.ai_legacy_package_x!.category).toBe('unknown');   // kept, not dropped
    expect(displayStateOf({ globallyEnabled: true, sub: { status: 'weird', trialEndsAt: null, trialStartsAt: null }, trialDays: 14, trialEverStarted: false, everPaid: false })).toBe('unable_to_verify');
    const mgr = (await repo.packages(manager, { pageSize: 24 })).items.find((c) => c.code === 'ai_marketing_assistant')!;
    expect(mgr.actions).toEqual(['view_details', 'open_module']);   // no cancel / billing actions without the permissions
  });
});

describe('§12/§13 catalog paging, search, filters', () => {
  it('8 per page in catalog order; search and filters cover the whole catalog', async () => {
    const p1 = await repo.packages(ctx, {}); const p2 = await repo.packages(ctx, { page: 2 });
    expect(p1.pageSize).toBe(8); expect(p1.totalItems).toBe(16); expect(p1.totalPages).toBe(2);
    expect(p1.items[0]!.code).toBe('ai_booking_assistant'); expect(p2.items.at(-1)!.code).toBe('ai_legacy_package_x');
    expect(new Set([...p1.items, ...p2.items].map((c) => c.code)).size).toBe(16);
    expect((await repo.packages(ctx, { page: 9 })).page).toBe(2);
    expect((await repo.packages(ctx, { q: 'ocr' })).items.map((c) => c.code)).toEqual(['ai_ocr_receipt_scanner']);
    expect((await repo.packages(ctx, { q: 'receipt' })).items.map((c) => c.code).sort()).toEqual(['ai_checkout_upsell_assistant', 'ai_ocr_receipt_scanner']);   // description + POS area
    expect((await repo.packages(ctx, { q: 'front desk' })).items.length).toBeGreaterThan(0);
    expect((await repo.packages(ctx, { category: 'finance' })).items.map((c) => c.code).sort()).toEqual(['ai_fraud_money_protection', 'ai_ocr_receipt_scanner']);
    const tr = await repo.packages(ctx, { status: 'trial_expired' }); expect(tr.items.map((c) => c.code).sort()).toEqual(['ai_analytics_forecasting', 'ai_business_assistant']);
    expect(tr.counts.active).toBe(4); expect(tr.counts.disabled).toBe(2);
    const usage = (await repo.packages(ctx, { sort: 'usage' })).items.map((c) => c.code);
    expect(usage[0]).toBe('ai_checkout_upsell_assistant');
  });
});

describe('§14/§10 usage and alerts', () => {
  it('counts successful usage since the period start; alerts once per threshold', async () => {
    const by = Object.fromEntries((await repo.packages(ctx, { pageSize: 24 })).items.map((c) => [c.code, c]));
    expect(by.ai_marketing_assistant!.usage).toMatchObject({ used: 400, limit: 500, unit: 'generations', percent: 80, level: 'warn_80', remaining: 100 });
    expect(by.ai_customer_profile_assistant!.usage).toMatchObject({ used: 1800, unit: 'messages', level: 'critical_90' });
    expect(by.ai_checkout_upsell_assistant!.usage).toMatchObject({ used: 3000, level: 'exhausted_100', remaining: 0 });   // the 900 of the previous period are not counted
    expect(by.ai_legacy_package_x!.usage.level).toBe('unlimited');
    expect(by.ai_reception_copilot!.usage).toMatchObject({ used: null, level: 'not_metered' });
    await repo.summary(ctx); await repo.summary(ctx);
    const a = (await q(`select package_code, threshold from ai_usage_alerts where tenant_id = $1 order by package_code, threshold`, [T])).rows.map((r: any) => `${r.package_code}:${r.threshold}`);
    expect(a).toEqual(['ai_checkout_upsell_assistant:80', 'ai_checkout_upsell_assistant:90', 'ai_checkout_upsell_assistant:100', 'ai_customer_profile_assistant:80', 'ai_customer_profile_assistant:90', 'ai_marketing_assistant:80']);
    const sub = (await q(`select status, usage_limit from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_checkout_upsell_assistant'`, [T])).rows[0];
    expect(sub).toMatchObject({ status: 'active', usage_limit: 3000 });   // no automatic upgrade or new limit
    const s = await repo.summary(ctx);
    expect(s.alerts.map((x) => `${x.code}:${x.threshold}`)).toEqual(['ai_checkout_upsell_assistant:100', 'ai_customer_profile_assistant:90', 'ai_marketing_assistant:80']);   // one line per package
    await repo.acknowledgeAlert(ctx, s.alerts[0]!.id);   // covers 80 / 90 / 100 of that package
    expect((await repo.summary(ctx)).alerts.map((x) => x.code)).toEqual(['ai_customer_profile_assistant', 'ai_marketing_assistant']);
    expect((await q(`select count(*)::int n from ai_usage_alerts where tenant_id = $1 and package_code = 'ai_checkout_upsell_assistant' and acknowledged_at is null`, [T])).rows[0].n).toBe(0);
    expect(await code(repo.acknowledgeAlert(ctx2, s.alerts[1]!.id))).toBe('AI_ALERT_NOT_FOUND');   // another salon cannot touch it
  });
});

describe('§9 monthly cost', () => {
  it('sums subscription prices honestly and hides them from roles without billing access', async () => {
    const s = await repo.summary(ctx);
    expect(s.cost.visible).toBe(true);
    if (!s.cost.visible) return;
    // active 5900 + yearly 46800/12 = 3900 + 4900 + legacy 1000 + past due 6900 — trials (inventory) are not cost
    expect(s.cost.recurringMonthlyCents).toBe(5900 + 3900 + 4900 + 1000 + 6900);
    expect(s.cost.lines.find((l) => l.code === 'ai_customer_profile_assistant')).toMatchObject({ period: 'yearly', cents: 46800, monthlyEquivalentCents: 3900 });
    expect(s.cost.trials.map((t) => t.code)).toEqual(['ai_inventory_assistant']);
    expect(s.cost.basis).toBe('subscription_records');   // only marketing has a payment this period
    expect(s.cost.estimatedOverageCents).toBe(0);
    expect(s.kpis).toMatchObject({ totalPackages: 16, activeSubscriptions: 4, pastDue: 1, trialing: 1, trialExpired: 2 });
    expect((await repo.summary(manager)).cost.visible).toBe(false);
  });
});

describe('§7 actions', () => {
  it('start trial: eligibility checked on the server, idempotent, audited in the transaction', async () => {
    const audits: unknown[] = [];
    const a = async (_t: unknown, m: Record<string, unknown>) => { audits.push(m); };
    expect(await code(repo.startTrial(ctx, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0001', confirm: false }, a))).toBe('AI_CONFIRMATION_REQUIRED');
    expect(await code(repo.startTrial(manager, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0001', confirm: true }, a))).toBe('PERMISSION_DENIED');
    expect(await code(repo.startTrial(ctx, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0001', confirm: true }, async () => { throw new Error('audit down'); }))).toBe('audit down');
    expect((await q(`select count(*)::int n from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_review_reputation_assistant'`, [T])).rows[0].n).toBe(0);   // rolled back
    const r1 = await repo.startTrial(ctx, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0001', confirm: true }, a);
    const r2 = await repo.startTrial(ctx, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0001', confirm: true }, a);
    expect(r1).toMatchObject({ ok: true, duplicate: false, status: 'trialing' }); expect(r2).toMatchObject({ duplicate: true });
    expect(audits).toHaveLength(1);
    expect(await code(repo.startTrial(ctx, 'ai_review_reputation_assistant', { idempotencyKey: 'k-trial-0002', confirm: true }, a))).toBe('AI_TRIAL_NOT_ELIGIBLE');
    expect(await code(repo.startTrial(ctx, 'ai_reception_copilot', { idempotencyKey: 'k-trial-0003', confirm: true }, a))).toBe('AI_TRIAL_NOT_ELIGIBLE');   // cancelled ≠ a new trial
    expect(await code(repo.startTrial(ctx, 'ai_voice_transcription', { idempotencyKey: 'k-trial-0004', confirm: true }, a))).toBe('AI_ACTION_NOT_ALLOWED');  // disabled by admin
  });

  it('cancel: only a live subscription, re-checked against the state the user saw', async () => {
    expect(await code(repo.cancel(ctx, 'ai_reception_copilot', { idempotencyKey: 'k-can-0001', confirm: true }, noAudit))).toBe('AI_ACTION_NOT_ALLOWED');
    expect(await code(repo.cancel(ctx, 'ai_business_assistant', { idempotencyKey: 'k-can-0002', confirm: true }, noAudit))).toBe('AI_ACTION_NOT_ALLOWED');   // lapsed trial
    expect(await code(repo.cancel(ctx, 'ai_marketing_assistant', { idempotencyKey: 'k-can-0003', confirm: true, expectedStatus: 'trialing' }, noAudit))).toBe('AI_STATE_CHANGED');
    const c1 = await repo.cancel(ctx, 'ai_marketing_assistant', { idempotencyKey: 'k-can-0004', confirm: true, expectedStatus: 'active' }, noAudit);
    const c2 = await repo.cancel(ctx, 'ai_marketing_assistant', { idempotencyKey: 'k-can-0004', confirm: true, expectedStatus: 'active' }, noAudit);
    expect(c1).toMatchObject({ status: 'cancelled', duplicate: false }); expect(c2.duplicate).toBe(true);
    expect((await q(`select status from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_marketing_assistant'`, [T2])).rows[0].status).toBe('active');   // other salon untouched
    await expect(q(`delete from tenant_ai_subscription_events where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
    const d = await repo.detail(ctx, 'ai_marketing_assistant');
    expect(d!.history.some((h) => h.type === 'cancelled' && h.from === 'active')).toBe(true);
    expect(d!.billing.visible).toBe(true);
    expect((await repo.detail(manager, 'ai_marketing_assistant'))!.billing.visible).toBe(false);
  });
});

describe('§15 usage history', () => {
  it('newest first, filtered, paged; CSV redacts references', async () => {
    const h = await repo.history(ctx, { preset: 'month', pageSize: 2 });
    const all = await repo.history(ctx, { preset: 'year', pageSize: 50 });
    expect(all.items.every((r, i) => i === 0 || r.at! <= all.items[i - 1]!.at!)).toBe(true);
    expect(all.items.every((r) => r.code !== undefined)).toBe(true);
    expect(h.pageSize).toBe(2);
    const failed = await repo.history(ctx, { preset: 'year', status: 'error' });
    expect(failed.items.map((r) => r.status)).toEqual(['failed']); expect(failed.items[0]!.counted).toBe(false);
    const cur = await repo.history(ctx, { basis: 'current_period', packageCode: 'ai_checkout_upsell_assistant' });
    expect(cur.items.map((r) => r.quantity)).toEqual([3000]);
    expect(await code(repo.history(ctx, { preset: 'custom', from: '2026-10-30', to: '2026-10-01' }))).toBe('AI_INVALID_PERIOD');
    const csv = await repo.historyCsv(ctx, { preset: 'year' });
    expect(csv.csv.split('\n')[0]).toMatch(/^Time \(UTC\),Package/);
    expect(csv.csv).toMatch(/…[0-9a-f-]{6}/);
    expect((await repo.history(ctx2, { preset: 'year' })).items.every((r) => r.code === 'ai_marketing_assistant')).toBe(true);
    expect((await repo.history(ctx2, { preset: 'year' })).totalItems).toBe(1);
  });
});

describe('AI Center reconcile (guide 1a93f016)', () => {
  it('explains the old Active/On Trial/Running counts; the gate agrees with every honest state', async () => {
    const r = await repo.reconcile(ctx, { AI_ENTITLEMENT_ENFORCEMENT: 'observe' } as any);
    expect(r.old.onTrial).toBe(r.rows.filter((x: any) => x.storedStatus === 'trialing').length);
    expect(r.old.running).toBe(r.old.active + r.old.onTrial);
    const lapsed = r.rows.find((x: any) => x.code === 'ai_business_assistant');
    expect(lapsed).toMatchObject({ storedStatus: 'trialing', state: 'trial_expired', oldLabel: 'trial', oldCountedRunning: true });
    expect(lapsed.gate.allowed).toBe(false);
    expect(r.staleTrialRows).toBeGreaterThanOrEqual(1);
    expect(r.rows.find((x: any) => x.code === 'ai_reception_copilot').gate.allowed).toBe(false);
    expect(r.rows.filter((x: any) => x.mismatch).map((x: any) => [x.code, x.state, x.gate.reason])).toEqual([]);
    expect(r.gateMismatches).toBe(0);
    expect(r.rows.find((x: any) => x.code === 'ai_checkout_upsell_assistant')).toMatchObject({ state: 'active', limitReached: true });
    expect(r.enforcement).toEqual({ modelCalls: 'always', featureRoutes: 'observe' });
    expect(r.rows.some((x: any) => x.code === 'ai_marketing_assistant' && x.monthEvents >= 0)).toBe(true);
    const other = await repo.reconcile(ctx2, {} as any);
    expect(other.rows.find((x: any) => x.code === 'ai_business_assistant')?.storedStatus ?? null).not.toBe('trialing');
    const chk = await repo.check(ctx);
    const keys = (chk as any).checks.map((c: any) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['gate_matches_state', 'feature_routes_gated']));
    expect((chk as any).checks.find((c: any) => c.key === 'gate_matches_state').state).toBe('PASSED');
  });
});

describe('§16 global switch', () => {
  it('the access gate enforces it; changing it needs a reason and the current version', async () => {
    const access = new KyselyAiAccessRepo(db);
    expect(evaluateAiAccess(await access.loadSnapshot(T, 'ai_customer_profile_assistant', OWNER)).reason).not.toBe('package_disabled');
    const admin = new AiAdminService({} as any, db);
    expect(await code(admin.setPackageAvailability({ userId: id('f9') }, 'ai_customer_profile_assistant', { enabled: false, expectedVersion: 0 }))).toBe('reason_required');
    expect(await code(admin.setPackageAvailability({ userId: id('f9') }, 'ai_customer_profile_assistant', { enabled: false, reason: 'Model recall', expectedVersion: 3 }))).toBe('version_conflict');
    await admin.setPackageAvailability({ userId: id('f9') }, 'ai_customer_profile_assistant', { enabled: false, reason: 'Model recall', expectedVersion: 0 });
    expect(evaluateAiAccess(await access.loadSnapshot(T, 'ai_customer_profile_assistant', OWNER)).reason).toBe('package_disabled');
    const card = (await repo.packages(ctx, { q: 'profile' })).items[0]!;
    expect(card.state).toBe('disabled_by_admin');
    const audit = (await sql<any>`select action_type from audit_logs where entity_type = 'ai_package' and entity_id = 'ai_customer_profile_assistant'`.execute(db)).rows;
    expect(audit.map((r: any) => r.action_type)).toEqual(['super_admin_ai_package_disabled']);
    expect((await admin.packageAvailability()).items.find((i) => i.code === 'ai_customer_profile_assistant')).toMatchObject({ enabled: false, version: 1 });
  });
});

describe('Extras · AI Usage Limits 02 — effective entitlement explainer (read-only)', () => {
  it('why: the gate\'s own decision beside the platform switch, the subscription row, the trial, the plans that list it and the last provider event', async () => {
    await q(`insert into tenant_ai_plan_subscriptions (tenant_id, plan_code, status, started_at) values ($1, 'plan_client_growth', 'active', now() - interval '20 days')`, [T]);
    const before = (await q(`select package_code, status from tenant_ai_subscriptions where tenant_id = $1 order by package_code`, [T])).rows;
    const live = (await repo.detail(ctx, 'ai_inventory_assistant'))!.why;     // a running trial
    expect(live).toMatchObject({ entitled: true, gate: { allowed: true, reason: 'ok' }, state: 'trialing', platform: { enabled: true, disabledReason: null },
      subscription: { status: 'trialing' }, lastVerified: null });
    expect(live.trial?.daysLeft).toBeGreaterThan(0);
    // paid yearly, but the Super Admin switched the package off earlier in this file ("Model recall"): the switch decides
    const profile = (await repo.detail(ctx, 'ai_customer_profile_assistant'))!.why;
    expect(profile).toMatchObject({ entitled: false, gate: { allowed: false, reason: 'package_disabled' }, state: 'disabled_by_admin', platform: { enabled: false, disabledReason: 'Model recall' },
      subscription: { status: 'active', period: 'yearly', priceSource: 'subscription' }, trial: null });
    expect(profile.plans).toEqual([{ code: 'plan_client_growth', name: 'Client & Growth', status: 'active', trialEndsAt: null, cancelledAt: null }]);
    const lapsed = (await repo.detail(ctx, 'ai_business_assistant'))!.why;   // stored "trialing", trial ended 2 days ago
    expect(lapsed).toMatchObject({ entitled: false, state: 'trial_expired', subscription: { status: 'trialing' } });
    expect(lapsed.gate.allowed).toBe(false); expect(lapsed.trial?.endsAt).toBeTruthy();
    const off = (await repo.detail(ctx, 'ai_voice_transcription'))!.why;      // Super Admin switch off, never subscribed
    expect(off).toMatchObject({ entitled: false, platform: { enabled: false, disabledReason: 'Provider maintenance' }, subscription: null });
    expect(off.gate.allowed).toBe(false);
    const full = (await repo.detail(ctx, 'ai_checkout_upsell_assistant'))!.why;   // active but this period's allowance is used up
    expect(full).toMatchObject({ state: 'active', entitled: false, gate: { reason: 'limit_exceeded' } });
    const stored = (await q(`select provider, event_type from ai_billing_events where tenant_id = $1 and package_code = 'ai_marketing_assistant' order by created_at desc limit 1`, [T])).rows[0];
    expect((await repo.detail(ctx, 'ai_marketing_assistant'))!.why.lastVerified).toMatchObject({ provider: stored.provider, eventType: stored.event_type });
    expect((await q(`select package_code, status from tenant_ai_subscriptions where tenant_id = $1 order by package_code`, [T])).rows).toEqual(before);   // nothing changed
    // another salon: its own row only
    expect((await repo.detail(ctx2, 'ai_customer_profile_assistant'))!.why).toMatchObject({ entitled: false, subscription: null, plans: [{ code: 'plan_client_growth', status: null }] });
  });
});
