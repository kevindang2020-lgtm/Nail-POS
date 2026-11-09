// ai-plans.pgtest — AI Plans guide (Nov 1 2026) on the REAL schema. The plan storefront tells the truth about a lapsed trial, a
// plan's free trial cannot be re-opened by cancelling (the plan path used to re-trial cancelled packages and re-open the plan),
// and Cancel reports an error when nothing was cancelled instead of answering "ok".
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TenantAiService, TenantAiError } from './tenant-ai.service';
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
});

