// ai-plans.pgtest — AI Plans guide (Nov 1 2026) on the REAL schema. The plan storefront tells the truth about a lapsed trial, a
// plan's free trial cannot be re-opened by cancelling (the plan path used to re-trial cancelled packages and re-open the plan),
// and Cancel reports an error when nothing was cancelled instead of answering "ok".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TenantAiService, TenantAiError, planStartRefusal } from './tenant-ai.service';
import { KyselyTenantAiRepo } from './tenant-ai.repository';

const T = 'c7710000-0000-4000-8000-000000000001';
const ctx = { tenantId: T, userId: 'c7710000-0000-4000-8000-000000000010', role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
let db: any; let svc: TenantAiService;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof TenantAiError ? e.message : (e as Error).message; } }
const plan = async (c: string) => (await svc.listPlans(ctx)).plans.find((p: any) => p.code === c) as any;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new TenantAiService(new KyselyTenantAiRepo(db), db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'plans-771', 'PL771', 'active')`);
});

describe('AI Plans', () => {
  it('PL-01 a fresh plan offers its trial; starting it shows Trialing with the end date', async () => {
    expect(await plan('plan_money_owner')).toMatchObject({ state: 'trial_available', trialAvailable: true, subscribed: false });
    const r = await svc.startPlanTrial(ctx, 'plan_money_owner');
    expect(r.activated).toBe(3);
    const p = await plan('plan_money_owner');
    expect(p).toMatchObject({ state: 'trialing', subscribed: true, canCancel: true });
    expect(p.trialEndsAt).toBeTruthy();
  });
  it('PL-02 a lapsed plan trial reads "trial_expired" — not "On trial"', async () => {
    await q(sql`update tenant_ai_plan_subscriptions set trial_ends_at = now() - interval '1 day' where tenant_id = ${T} and plan_code = 'plan_money_owner'`);
    await q(sql`update tenant_ai_subscriptions set trial_ends_at = now() - interval '1 day' where tenant_id = ${T}`);
    const p = await plan('plan_money_owner');
    expect(p.state).toBe('trial_expired');
    expect(p.subscribed).toBe(false);
    expect(p.trialAvailable).toBe(false);
  });
  it('PL-03 cancel → start the trial again is refused (one free trial per plan); cancelled packages are not re-trialled', async () => {
    await svc.cancelPlan(ctx, 'plan_money_owner');
    expect((await plan('plan_money_owner')).state).toBe('cancelled');
    expect(await code(svc.startPlanTrial(ctx, 'plan_money_owner'))).toBe('trial_already_used');
    const subs = await q(sql`select package_code, status from tenant_ai_subscriptions where tenant_id = ${T} order by package_code`);
    expect(subs.every((s: any) => s.status === 'cancelled')).toBe(true);
  });
  it('PL-04 a plan whose every member already used its trial offers no plan trial either', async () => {
    // Operations & Insights shares no member with Money & Owner — make all four members "used"
    for (const c of ['ai_analytics_forecasting', 'ai_scheduling_optimizer', 'ai_inventory_assistant', 'ai_voice_transcription'])
      await q(sql`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled) values (gen_random_uuid(), ${T}, ${c}, 'cancelled', 'monthly', 0, 'usd', 0, false)`);
    expect((await plan('plan_operations_insights')).trialAvailable).toBe(false);
    expect(await code(svc.startPlanTrial(ctx, 'plan_operations_insights'))).toBe('trial_already_used');
  });
  it('PL-05 cancelling a plan with nothing live is an error, not "ok"', async () => {
    expect(await code(svc.cancelPlan(ctx, 'plan_booking_calls'))).toBe('subscription_not_found');
  });
  it('PL-06 SUNMI purchase-overlap preview: members the salon already has on their own, with their price (live only; read-only)', async () => {
    await q(sql`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled)
      values (gen_random_uuid(), ${T}, 'ai_customer_profile_assistant', 'active', 'monthly', 3900, 'usd', 0, false)`);
    await q(sql`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled, trial_ends_at)
      values (gen_random_uuid(), ${T}, 'ai_checkout_upsell_assistant', 'trialing', 'monthly', 4900, 'usd', 0, false, now() + interval '5 days')`);
    const p = await plan('plan_client_growth');
    expect(p.subscribed).toBe(false);
    expect(p.overlap.owned.map((x: any) => [x.code, x.status, x.monthlyPriceCents]).sort()).toEqual([['ai_checkout_upsell_assistant', 'trialing', 4900], ['ai_customer_profile_assistant', 'active', 3900]]);
    expect(p.overlap.ownedMonthlyCents).toBe(3900);   // a trial is not yet paid
    // a plan already live has nothing "to buy", so no overlap is shown
    expect((await plan('plan_money_owner')).overlap).toEqual({ owned: [], ownedMonthlyCents: 0 });
  });
  it('extras AI Plans 04: before checkout each plan shows the charge effect — refusal from the same guard startPlanTrial uses, nothing charged today, the price after the trial, what could be paid twice, unused account credits', async () => {
    await q(sql`insert into billing_credits (tenant_id, amount_cents, remaining_cents, status, created_at, expires_at) values (${T}, 5000, 2500, 'active', now(), null), (${T}, 9000, 9000, 'active', now(), now() - interval '1 day'), (${T}, 4000, 0, 'applied', now(), null)`);
    const g = await plan('plan_client_growth');
    expect(g.charge).toEqual({ refusal: null, chargedTodayCents: 0, afterTrialMonthlyCents: g.effectiveCents, possibleDoubleMonthlyCents: 3900, creditsRemainingCents: 2500 });   // expired / applied credits not counted
    const m = await plan('plan_money_owner');   // cancelled in PL-03
    expect(m.charge.refusal).toBe('trial_already_used');
    expect(await code(svc.startPlanTrial(ctx, 'plan_money_owner'))).toBe(m.charge.refusal);   // the preview never promises what the server refuses
    expect(planStartRefusal(null)).toBeNull(); expect(planStartRefusal({ status: 'active' })).toBe('already_subscribed'); expect(planStartRefusal({ status: 'expired' })).toBe('trial_already_used');
  });
  it('extras AI Plans #03: the price is checked against the members bought separately — a real saving is verified; an overridden list price that makes "Save" untrue is flagged; read-only', async () => {
    const p0 = await plan('plan_client_growth');
    const standalone = p0.packages.reduce((a: number, x: any) => a + x.monthlyPriceCents, 0);
    expect(p0.priceCheck).toEqual({ standaloneCents: standalone, realSavingsCents: standalone - p0.effectiveCents, claimedSavingsCents: p0.discountCents,
      state: standalone - p0.effectiveCents <= 0 ? 'no_saving' : p0.discountCents > standalone - p0.effectiveCents ? 'overstated' : 'verified' });
    // Super Admin: 20% off the plan price
    await q(sql`insert into ai_plan_settings (plan_code, price_cents_override, discount_type, discount_value, active) values ('plan_client_growth', null, 'percent', 20, true)
      on conflict (plan_code) do update set price_cents_override = excluded.price_cents_override, discount_type = excluded.discount_type, discount_value = excluded.discount_value`);
    const p1 = await plan('plan_client_growth');
    expect(p1.priceCheck).toMatchObject({ standaloneCents: standalone, claimedSavingsCents: p1.discountCents, realSavingsCents: p1.discountCents, state: 'verified' });
    // the list price is raised above the members' own prices: "Save 20%" is still advertised, the real saving is smaller
    await q(sql`update ai_plan_settings set price_cents_override = ${standalone + 2000} where plan_code = 'plan_client_growth'`);
    const p2 = await plan('plan_client_growth');
    expect(p2.discountCents).toBe(Math.round((standalone + 2000) * 0.2));
    expect(p2.priceCheck.realSavingsCents).toBe(standalone - p2.effectiveCents);
    expect(p2.priceCheck.state).toBe(p2.priceCheck.realSavingsCents <= 0 ? 'no_saving' : 'overstated');
    // no discount at all on a raised price: buying separately is cheaper
    await q(sql`update ai_plan_settings set discount_type = null, discount_value = 0 where plan_code = 'plan_client_growth'`);
    expect((await plan('plan_client_growth')).priceCheck).toMatchObject({ realSavingsCents: -2000, claimedSavingsCents: 0, state: 'no_saving' });
    await q(sql`delete from ai_plan_settings where plan_code = 'plan_client_growth'`);
  });
});


describe('AI Plans #05 — subscription vs readiness split (extras round 9)', () => {
  const KEY = 'GEMINI_API_KEY';
  const was = process.env[KEY];
  const off = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  beforeAll(() => { delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env[KEY]; });
  afterAll(() => { if (was === undefined) delete process.env[KEY]; else process.env[KEY] = was; for (const [k, v] of Object.entries(off)) if (v !== undefined) process.env[k] = v; });
  it('RD-01 no provider key: every plan is provider_down (no_provider_connected) while its commercial state stays as it is', async () => {
    const p = await plan('plan_booking_calls');
    expect(p.readiness).toMatchObject({ state: 'provider_down', provider: { state: 'not_connected', reason: 'no_provider_connected' } });
    expect(['trial_available', 'available']).toContain(p.state);                 // commercial: untouched by readiness
    const trialing = await plan('plan_money_owner');
    expect(trialing.readiness.state).toBe('provider_down');
    expect(trialing.state).not.toBe('provider_down');
  });
  it('RD-02 with a provider: the phone plan needs the receptionist set up; other plans are ready; a ready agent makes it ready', async () => {
    process.env[KEY] = 'present';                                                // presence only — the value is never read
    let p = await plan('plan_booking_calls');
    expect(p.readiness.state).toBe('setup_required');
    expect(p.readiness.packages).toEqual([{ code: 'ai_booking_assistant', state: 'ready', reason: null }, { code: 'ai_phone_call_assistant', state: 'setup_required', reason: 'receptionist_not_set_up' }]);
    expect((await plan('plan_checkin_queue')).readiness).toMatchObject({ state: 'ready', provider: { state: 'connected', reason: null } });
    await q(sql`insert into ai_receptionist_agents (tenant_id, name, status) values (${T}, 'Front desk', 'ready')`);
    p = await plan('plan_booking_calls');
    expect(p.readiness.state).toBe('ready');
  });
  it('RD-03 Super Admin turned an assistant off platform-wide → provider_down for that member; every configured provider in error → provider_error', async () => {
    await q(sql`insert into platform_ai_package_settings (package_code, enabled, disabled_reason) values ('ai_booking_assistant', false, 'maintenance window')`);
    let p = await plan('plan_booking_calls');
    expect(p.readiness.state).toBe('provider_down');
    expect(p.readiness.packages[0]).toEqual({ code: 'ai_booking_assistant', state: 'provider_down', reason: 'turned_off_by_platform' });
    await q(sql`delete from platform_ai_package_settings where package_code = 'ai_booking_assistant'`);
    await q(sql`insert into ai_providers (provider_key, display_name, status) values ('rd-test', 'RD test provider', 'error')`);
    p = await plan('plan_checkin_queue');
    expect(p.readiness).toMatchObject({ state: 'provider_down', provider: { state: 'error', reason: 'provider_error' } });
    await q(sql`delete from ai_providers where provider_key = 'rd-test'`);
  });
});
