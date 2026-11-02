// ai-plans-admin.service.ts — Super-Admin management of the five AI plans. Lists each plan with its default (summed)
// full price, any manual price override, its discount, the resulting effective (new) price, and member packages; and
// sets a plan's price override / discount / active flag. Plan pricing lives in ai_plan_settings (global). Audited.
import { sql, type Kysely } from 'kysely';
import { AI_PLANS, getAiPlan, planFullPriceCents, effectivePlanPriceCents, planPeriodPriceCents, planPackages, proratePlanPriceCents, type AiDiscountType, type AiBillingPeriod } from '@aipowersalon/ai';
import { normalizeAssign } from './ai-admin-core';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_AI_PLAN_SUBSCRIPTION } from '../lifecycles';

export class AiPlansAdminError extends Error { constructor(public code: 'not_found' | 'bad_request', message: string) { super(message); } }
export interface PlansAdminCtx { userId?: string; ip?: string }
type SubWriter = { upsert(tenantId: string, v: any): Promise<void>; cancel(tenantId: string, code: string): Promise<boolean> };
const periodOf = (p: any): AiBillingPeriod => (p === 'yearly' ? 'yearly' : 'monthly');

interface PlanSettingRow { plan_code: string; price_cents_override: number | null; discount_type: AiDiscountType; discount_value: number; active: boolean; annual_months: number }

export class AiPlansAdminService {
  constructor(private readonly db: Kysely<any> | null = null, private readonly subs: SubWriter | null = null) {}

  private async settings(): Promise<Map<string, PlanSettingRow>> {
    if (!this.db) return new Map();
    const rows = await sql<PlanSettingRow>`SELECT plan_code, price_cents_override, discount_type, discount_value, active, annual_months FROM ai_plan_settings`.execute(this.db);
    return new Map(rows.rows.map((r) => [r.plan_code, r]));
  }

  /** Read one plan's pricing inputs (override/discount/annual months) from settings. */
  private async pricingFor(planCode: string): Promise<{ pricing: { priceCentsOverride: number | null; discountType: AiDiscountType; discountValue: number }; annualMonths: number }> {
    let s: any = null;
    if (this.db) { const r = await sql<any>`SELECT price_cents_override, discount_type, discount_value, annual_months FROM ai_plan_settings WHERE plan_code = ${planCode}`.execute(this.db); s = r.rows[0]; }
    return { pricing: { priceCentsOverride: s?.price_cents_override ?? null, discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0 }, annualMonths: s?.annual_months ?? 12 };
  }

  async listPlans() {
    const map = await this.settings();
    const roll = new Map<string, { active: number; trialing: number; mrr: number }>();
    if (this.db) {
      const rs = await sql<any>`SELECT plan_code, status, billing_period, COUNT(*)::int AS n, COALESCE(SUM(price_cents),0)::int AS sum FROM tenant_ai_plan_subscriptions WHERE status <> 'cancelled' GROUP BY plan_code, status, billing_period`.execute(this.db);
      rs.rows.forEach((r: any) => {
        const e = roll.get(r.plan_code) ?? { active: 0, trialing: 0, mrr: 0 };
        if (r.status === 'active') { e.active += r.n; e.mrr += r.billing_period === 'yearly' ? Math.round(r.sum / 12) : r.sum; }
        else if (r.status === 'trialing') e.trialing += r.n;
        roll.set(r.plan_code, e);
      });
    }
    const plans = AI_PLANS.map((pl) => {
      const s = map.get(pl.code);
      const pricing = { priceCentsOverride: s?.price_cents_override ?? null, discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0 };
      const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(pl.code, pricing);
      const annualMonths = s?.annual_months ?? 12;
      const yr = planPeriodPriceCents(pl.code, pricing, 'yearly', annualMonths);
      const r = roll.get(pl.code);
      return {
        code: pl.code, name: pl.name, description: pl.description, essential: !!pl.essential, sortOrder: pl.sortOrder,
        defaultFullCents: planFullPriceCents(pl.code),
        priceCentsOverride: s?.price_cents_override ?? null,
        discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0,
        fullCents, discountCents, effectiveCents, active: s?.active ?? true,
        annualMonths, yearlyPriceCents: yr.periodCents, annualSavingsCents: yr.annualSavingsCents,
        activeSubscribers: r?.active ?? 0, trialingSubscribers: r?.trialing ?? 0, mrrCents: r?.mrr ?? 0,
        packages: planPackages(pl.code).map((p) => ({ code: p.code, name: p.name, monthlyPriceCents: p.monthlyPriceCents, usageUnit: p.usageUnit })),
      };
    });
    return { plans };
  }

  async updatePlan(ctx: PlansAdminCtx, planCode: string, body: any) {
    if (!getAiPlan(planCode)) throw new AiPlansAdminError('not_found', 'unknown_ai_plan');
    if (!this.db) throw new AiPlansAdminError('bad_request', 'database_unavailable');
    const override = body?.priceCentsOverride;
    const priceCentsOverride = override == null || override === '' ? null : Math.max(0, Math.round(Number(override)));
    if (priceCentsOverride != null && !Number.isFinite(priceCentsOverride)) throw new AiPlansAdminError('bad_request', 'invalid_price');
    const discountType: AiDiscountType = body?.discountType === 'percent' || body?.discountType === 'flat' ? body.discountType : null;
    let discountValue = Math.max(0, Math.round(Number(body?.discountValue) || 0));
    if (discountType === 'percent' && discountValue > 100) discountValue = 100;
    if (discountType === null) discountValue = 0;
    const active = body?.active === undefined ? true : !!body.active;
    const annualMonths = body?.annualMonths === undefined ? 12 : Math.max(1, Math.min(12, Math.round(Number(body.annualMonths) || 12)));

    await sql`INSERT INTO ai_plan_settings (plan_code, price_cents_override, discount_type, discount_value, active, annual_months, updated_at)
      VALUES (${planCode}, ${priceCentsOverride}, ${discountType}, ${discountValue}, ${active}, ${annualMonths}, now())
      ON CONFLICT (plan_code) DO UPDATE SET price_cents_override = ${priceCentsOverride}, discount_type = ${discountType}, discount_value = ${discountValue}, active = ${active}, annual_months = ${annualMonths}, updated_at = now()`.execute(this.db);
    await this.audit(ctx, 'super_admin_ai_plan_updated', planCode, { priceCentsOverride, discountType, discountValue, active, annualMonths });
    const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(planCode, { priceCentsOverride, discountType, discountValue });
    return { ok: true as const, planCode, priceCentsOverride, discountType, discountValue, active, annualMonths, fullCents, discountCents, effectiveCents };
  }

  /** Paid (or trial) plan activation for one tenant. Each member package is priced as its prorated share of the plan's
   *  period price (monthly = effective; yearly = effective × annual months) so the per-package MRR rollup equals the
   *  discounted bundle. Records the plan with its period, trial end (for trials), and current paid window. */
  async assignPlanToTenant(ctx: PlansAdminCtx, planCode: string, tenantId: string, opts?: { trial?: boolean; billingPeriod?: AiBillingPeriod }) {
    if (!getAiPlan(planCode)) throw new AiPlansAdminError('not_found', 'unknown_ai_plan');
    if (!this.db || !this.subs) throw new AiPlansAdminError('bad_request', 'database_unavailable');
    if (!tenantId) throw new AiPlansAdminError('bad_request', 'tenant_required');
    const trial = !!opts?.trial;
    const period = periodOf(opts?.billingPeriod);
    const { pricing, annualMonths } = await this.pricingFor(planCode);
    const pp = planPeriodPriceCents(planCode, pricing, period, annualMonths);
    const split = proratePlanPriceCents(planCode, pp.periodCents);
    const status = trial ? 'trialing' : 'active';
    const pkgs = planPackages(planCode);
    let activated = 0;
    for (const p of pkgs) {
      const priceCents = split.find((x) => x.code === p.code)?.priceCents ?? p.monthlyPriceCents;
      const norm = normalizeAssign({ packageCode: p.code, status, priceCents, billingPeriod: period });
      if (norm.ok) { await this.subs.upsert(tenantId, norm.value); activated++; }
    }
    const trialDays = trial && pkgs.length ? Math.max(0, ...pkgs.map((p) => p.trialDays)) : 0;
    const trialEnds = trial && trialDays > 0 ? sql`now() + ${`${trialDays} days`}::interval` : sql`NULL`;
    const periodEnds = sql`now() + ${period === 'yearly' ? '1 year' : '1 month'}::interval`;
    await sql`INSERT INTO tenant_ai_plan_subscriptions (tenant_id, plan_code, status, billing_period, price_cents, full_cents, discount_cents, trial_ends_at, current_period_starts_at, current_period_ends_at, started_at)
      VALUES (${tenantId}, ${planCode}, ${status}, ${period}, ${pp.periodCents}, ${pp.fullCents}, ${pp.discountCents}, ${trialEnds}, now(), ${periodEnds}, now())
      ON CONFLICT (tenant_id, plan_code) DO UPDATE SET status = ${status}, billing_period = ${period}, price_cents = ${pp.periodCents}, full_cents = ${pp.fullCents}, discount_cents = ${pp.discountCents}, trial_ends_at = ${trialEnds}, current_period_starts_at = now(), current_period_ends_at = ${periodEnds}, cancelled_at = NULL, updated_at = now() WHERE ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, status, 'tenant_ai_plan_subscriptions')}`.execute(this.db);
    await this.audit(ctx, 'super_admin_ai_plan_assigned', planCode, { tenantId, status, billingPeriod: period, periodCents: pp.periodCents, activated }, tenantId);
    return { ok: true as const, planCode, tenantId, status, billingPeriod: period, periodCents: pp.periodCents, monthlyEquivalentCents: pp.monthlyEquivalentCents, activated, memberPrices: split };
  }

  /** Convert a tenant's trialing plan to paid (active), optionally switching billing period. Re-prices the member
   *  packages and the plan to the chosen period and opens a fresh paid window. */
  async convertPlanToPaid(ctx: PlansAdminCtx, planCode: string, tenantId: string, opts?: { billingPeriod?: AiBillingPeriod }) {
    if (!getAiPlan(planCode)) throw new AiPlansAdminError('not_found', 'unknown_ai_plan');
    if (!this.db || !this.subs) throw new AiPlansAdminError('bad_request', 'database_unavailable');
    if (!tenantId) throw new AiPlansAdminError('bad_request', 'tenant_required');
    const cur = await sql<any>`SELECT status, billing_period FROM tenant_ai_plan_subscriptions WHERE tenant_id = ${tenantId} AND plan_code = ${planCode}`.execute(this.db);
    const row = cur.rows[0];
    if (!row) throw new AiPlansAdminError('not_found', 'plan_subscription_not_found');
    const period = periodOf(opts?.billingPeriod ?? row.billing_period);
    const { pricing, annualMonths } = await this.pricingFor(planCode);
    const pp = planPeriodPriceCents(planCode, pricing, period, annualMonths);
    const split = proratePlanPriceCents(planCode, pp.periodCents);
    let activated = 0;
    for (const p of planPackages(planCode)) {
      const priceCents = split.find((x) => x.code === p.code)?.priceCents ?? p.monthlyPriceCents;
      const norm = normalizeAssign({ packageCode: p.code, status: 'active', priceCents, billingPeriod: period });
      if (norm.ok) { await this.subs.upsert(tenantId, norm.value); activated++; }
    }
    const periodEnds = sql`now() + ${period === 'yearly' ? '1 year' : '1 month'}::interval`;
    await sql`UPDATE tenant_ai_plan_subscriptions SET status = 'active', billing_period = ${period}, price_cents = ${pp.periodCents}, full_cents = ${pp.fullCents}, discount_cents = ${pp.discountCents}, trial_ends_at = NULL, current_period_starts_at = now(), current_period_ends_at = ${periodEnds}, updated_at = now() WHERE tenant_id = ${tenantId} AND plan_code = ${planCode} AND ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, 'active')}`.execute(this.db);
    await this.audit(ctx, 'super_admin_ai_plan_converted', planCode, { tenantId, billingPeriod: period, periodCents: pp.periodCents, from: row.status }, tenantId);
    return { ok: true as const, planCode, tenantId, status: 'active' as const, billingPeriod: period, periodCents: pp.periodCents, activated };
  }

  /** Convert every plan whose trial has lapsed (trial_ends_at <= now) to paid. Returns how many were converted.
   *  Intended to be run on a schedule; safe to call repeatedly. */
  async convertExpiredTrials(ctx?: PlansAdminCtx) {
    if (!this.db || !this.subs) throw new AiPlansAdminError('bad_request', 'database_unavailable');
    const due = await sql<any>`SELECT tenant_id, plan_code FROM tenant_ai_plan_subscriptions WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()`.execute(this.db);
    let converted = 0;
    for (const r of due.rows) { try { await this.convertPlanToPaid(ctx || {}, String(r.plan_code), String(r.tenant_id)); converted++; } catch { /* skip individual failures */ } }
    return { ok: true as const, converted };
  }

  async cancelTenantPlan(ctx: PlansAdminCtx, planCode: string, tenantId: string) {
    if (!getAiPlan(planCode)) throw new AiPlansAdminError('not_found', 'unknown_ai_plan');
    if (!this.db || !this.subs) throw new AiPlansAdminError('bad_request', 'database_unavailable');
    if (!tenantId) throw new AiPlansAdminError('bad_request', 'tenant_required');
    for (const p of planPackages(planCode)) { await this.subs.cancel(tenantId, p.code).catch(() => undefined); }
    await sql`UPDATE tenant_ai_plan_subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE tenant_id = ${tenantId} AND plan_code = ${planCode} AND ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, 'cancelled')}`.execute(this.db);
    await this.audit(ctx, 'super_admin_ai_plan_unassigned', planCode, { tenantId }, tenantId);
    return { ok: true as const };
  }

  /** Which plans a given tenant is currently on (status per plan), for the Super-Admin assign UI. */
  async tenantPlans(tenantId: string) {
    if (!tenantId) throw new AiPlansAdminError('bad_request', 'tenant_required');
    const map = new Map<string, any>();
    if (this.db) {
      const rows = await sql<any>`SELECT plan_code, status, price_cents, billing_period, trial_ends_at FROM tenant_ai_plan_subscriptions WHERE tenant_id = ${tenantId} AND status <> 'cancelled'`.execute(this.db);
      rows.rows.forEach((r: any) => map.set(r.plan_code, r));
    }
    const plans = AI_PLANS.map((pl) => { const r = map.get(pl.code); return { code: pl.code, name: pl.name, status: r?.status ?? null, priceCents: r?.price_cents ?? null, billingPeriod: r?.billing_period ?? null, trialEndsAt: r?.trial_ends_at ?? null }; });
    return { tenantId, plans };
  }

  private async audit(ctx: PlansAdminCtx, action: string, planCode: string, meta?: Record<string, unknown>, tenantId: string | null = null) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: (tenantId || null), user_id: (ctx.userId || null), role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'ai_plan', entity_id: planCode, metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => undefined);
  }
}
