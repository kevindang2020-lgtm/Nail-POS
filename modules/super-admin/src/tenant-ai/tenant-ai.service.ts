// tenant-ai.service.ts — tenant-owner AI surface. Shows the 15 packages with THIS tenant's subscription + live access
// state (computed by the same gate the backend enforces), lets an owner start a trial or cancel, and reports usage.
// Honest scope: self-serve can only START A TRIAL (paid activation goes through billing in Phase 4d or Super Admin);
// it never self-grants paid access. Everything is tenant-scoped.
import { evaluateAiAccess, accessReasonLabel, AI_PACKAGES, getAiPackage, AI_PLANS, getAiPlan, planPackages, effectivePlanPriceCents, proratePlanPriceCents } from '@aipowersalon/ai';
import { normalizeAssign } from '../super-admin-ai/ai-admin-core';
import { sql, type Kysely } from 'kysely';
import type { TenantAiRepo } from './tenant-ai.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_AI_PLAN_SUBSCRIPTION } from '../lifecycles';

export class TenantAiError extends Error { constructor(public code: 'forbidden' | 'not_found' | 'bad_request', message: string) { super(message); } }
export interface TenantCtx { tenantId?: string; userId?: string; role?: string; permissions?: string[] }

function requireTenant(ctx: TenantCtx): string { if (!ctx.tenantId) throw new TenantAiError('forbidden', 'tenant_required'); return ctx.tenantId; }
function requireManage(ctx: TenantCtx) {
  const p = ctx.permissions || [];
  if (!(p.includes('ai.manage') || p.includes('subscription.manage'))) throw new TenantAiError('forbidden', 'permission_denied');
}

export class TenantAiService {
  constructor(private readonly repo: TenantAiRepo, private readonly db: Kysely<any> | null = null) {}

  async catalog(ctx: TenantCtx) {
    const tenantId = requireTenant(ctx);
    const perms = ctx.permissions || [];
    const [subs, usage] = await Promise.all([this.repo.listForTenant(tenantId), this.repo.usageForTenant(tenantId)]);
    const subByCode = new Map(subs.map((s) => [s.packageCode, s]));
    const usedByCode = new Map(usage.map((u) => [u.packageCode, u.used]));
    const packages = AI_PACKAGES.map((p) => {
      const sub = subByCode.get(p.code) ?? null;
      const used = usedByCode.get(p.code) ?? 0;
      const decision = evaluateAiAccess({
        tenantStatus: 'active', packageEnabled: true,
        subscription: sub ? { status: sub.status as any, trialEndsAt: sub.trialEndsAt } : null,
        usage: { used, limit: sub?.usageLimit ?? 0, overageEnabled: sub?.overageEnabled ?? false },
        hasPermission: perms.includes('ai.use') || perms.includes('ai.manage'),
        pastDuePolicy: 'block',
      });
      return {
        code: p.code, name: p.name, description: p.description, category: p.category, posArea: p.posArea,
        monthlyPriceCents: p.monthlyPriceCents, includedUsageLimit: p.includedUsageLimit, usageUnit: p.usageUnit, trialDays: p.trialDays,
        subscription: sub ? { status: sub.status, usageLimit: sub.usageLimit, overageEnabled: sub.overageEnabled, trialEndsAt: sub.trialEndsAt } : null,
        used, remainingUsage: decision.remainingUsage,
        accessible: decision.allowed, lockReason: decision.allowed ? null : decision.reason, lockLabel: decision.allowed ? null : accessReasonLabel(decision.reason),
        upgradeRequired: decision.upgradeRequired, trialAvailable: !sub && p.trialDays > 0,
      };
    });
    return { packages };
  }

  async subscriptions(ctx: TenantCtx) {
    const tenantId = requireTenant(ctx);
    return { subscriptions: await this.repo.listForTenant(tenantId) };
  }

  async usage(ctx: TenantCtx) {
    const tenantId = requireTenant(ctx);
    return { usage: await this.repo.usageForTenant(tenantId) };
  }

  /** Self-serve START TRIAL only. Paid activation goes through billing (4d) / Super Admin — never self-granted here. */
  async startTrial(ctx: TenantCtx, packageCode: string) {
    const tenantId = requireTenant(ctx);
    requireManage(ctx);
    const pkg = getAiPackage(packageCode);
    if (!pkg) throw new TenantAiError('bad_request', 'unknown_ai_package');
    if (pkg.trialDays <= 0) throw new TenantAiError('bad_request', 'no_trial_available');
    const existing = await this.repo.getOne(tenantId, packageCode);
    if (existing && existing.status !== 'cancelled' && existing.status !== 'expired') throw new TenantAiError('bad_request', 'already_subscribed');
    const norm = normalizeAssign({ packageCode, trial: true });
    if (!norm.ok) throw new TenantAiError('bad_request', norm.error);
    await this.repo.upsert(tenantId, norm.value);
    return { ok: true as const, packageCode, status: 'trialing' as const, trialEndsAt: norm.value.trialEndsAt };
  }

  async cancel(ctx: TenantCtx, packageCode: string) {
    const tenantId = requireTenant(ctx);
    requireManage(ctx);
    if (!getAiPackage(packageCode)) throw new TenantAiError('bad_request', 'unknown_ai_package');
    const ok = await this.repo.cancel(tenantId, packageCode);
    if (!ok) throw new TenantAiError('not_found', 'subscription_not_found');
    return { ok: true as const };
  }

  // ---- AI plans (bundles) ----
  /** Storefront: the active plans with effective pricing (full → new) and whether this tenant is already on each. */
  async listPlans(ctx: TenantCtx) {
    const tenantId = requireTenant(ctx);
    const subs = await this.repo.listForTenant(tenantId);
    const subByCode = new Map(subs.map((s) => [s.packageCode, s]));
    const settings = new Map<string, any>();
    const planSubs = new Map<string, any>();
    if (this.db) {
      const sRows = await sql<any>`SELECT plan_code, price_cents_override, discount_type, discount_value, active FROM ai_plan_settings`.execute(this.db);
      sRows.rows.forEach((r: any) => settings.set(r.plan_code, r));
      const psRows = await sql<any>`SELECT plan_code, status, price_cents FROM tenant_ai_plan_subscriptions WHERE tenant_id = ${tenantId} AND status <> 'cancelled'`.execute(this.db);
      psRows.rows.forEach((r: any) => planSubs.set(r.plan_code, r));
    }
    const plans = AI_PLANS.filter((pl) => settings.get(pl.code)?.active ?? true).map((pl) => {
      const s = settings.get(pl.code);
      const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(pl.code, { priceCentsOverride: s?.price_cents_override ?? null, discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0 });
      const pkgs = planPackages(pl.code);
      const memberActive = pkgs.length > 0 && pkgs.every((p) => { const st = subByCode.get(p.code)?.status; return st === 'active' || st === 'trialing'; });
      const planSub = planSubs.get(pl.code);
      const subscribed = !!planSub || memberActive;
      const trialAvailable = !subscribed && pkgs.some((p) => p.trialDays > 0 && !subByCode.has(p.code));
      return {
        code: pl.code, name: pl.name, description: pl.description, essential: !!pl.essential,
        fullCents, discountCents, effectiveCents,
        subscribed, status: planSub?.status ?? (subscribed ? 'active' : null), trialAvailable,
        packages: pkgs.map((p) => ({ code: p.code, name: p.name, monthlyPriceCents: p.monthlyPriceCents, usageUnit: p.usageUnit, posArea: p.posArea })),
      };
    });
    return { plans };
  }

  /** Self-serve plan trial: starts a trial for each member package not already active, and records the plan with its
   *  effective price snapshot. Paid plan activation goes through billing / Super Admin (same policy as packages). */
  async startPlanTrial(ctx: TenantCtx, planCode: string) {
    const tenantId = requireTenant(ctx);
    requireManage(ctx);
    const plan = getAiPlan(planCode);
    if (!plan) throw new TenantAiError('bad_request', 'unknown_ai_plan');
    const pkgs = planPackages(planCode);
    let s: any = null;
    if (this.db) { const sRows = await sql<any>`SELECT price_cents_override, discount_type, discount_value FROM ai_plan_settings WHERE plan_code = ${planCode}`.execute(this.db); s = sRows.rows[0]; }
    const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(planCode, { priceCentsOverride: s?.price_cents_override ?? null, discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0 });
    const split = proratePlanPriceCents(planCode, effectiveCents); // member prices sum to the bundle price for a clean trial→paid conversion
    const existing = await this.repo.listForTenant(tenantId);
    const byCode = new Map(existing.map((x) => [x.packageCode, x]));
    let activated = 0;
    for (const p of pkgs) {
      const cur = byCode.get(p.code);
      if (cur && (cur.status === 'active' || cur.status === 'trialing')) continue;
      if (p.trialDays <= 0) continue;
      const priceCents = split.find((x) => x.code === p.code)?.priceCents ?? p.monthlyPriceCents;
      const norm = normalizeAssign({ packageCode: p.code, trial: true, priceCents });
      if (norm.ok) { await this.repo.upsert(tenantId, norm.value); activated++; }
    }
    if (this.db) {
      const trialDays = pkgs.length ? Math.max(0, ...pkgs.map((p) => p.trialDays)) : 0;
      const trialEnds = trialDays > 0 ? sql`now() + ${`${trialDays} days`}::interval` : sql`NULL`;
      await sql`INSERT INTO tenant_ai_plan_subscriptions (tenant_id, plan_code, status, billing_period, price_cents, full_cents, discount_cents, trial_ends_at, current_period_starts_at, started_at)
        VALUES (${tenantId}, ${planCode}, 'trialing', 'monthly', ${effectiveCents}, ${fullCents}, ${discountCents}, ${trialEnds}, now(), now())
        ON CONFLICT (tenant_id, plan_code) DO UPDATE SET status = 'trialing', billing_period = 'monthly', price_cents = ${effectiveCents}, full_cents = ${fullCents}, discount_cents = ${discountCents}, trial_ends_at = ${trialEnds}, current_period_starts_at = now(), cancelled_at = NULL, updated_at = now()
        WHERE ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, 'trialing', 'tenant_ai_plan_subscriptions')} AND tenant_ai_plan_subscriptions.status <> 'active'`.execute(this.db);
    }
    return { ok: true as const, planCode, status: 'trialing' as const, activated };
  }

  async cancelPlan(ctx: TenantCtx, planCode: string) {
    const tenantId = requireTenant(ctx);
    requireManage(ctx);
    if (!getAiPlan(planCode)) throw new TenantAiError('bad_request', 'unknown_ai_plan');
    for (const p of planPackages(planCode)) { await this.repo.cancel(tenantId, p.code).catch(() => undefined); }
    if (this.db) await sql`UPDATE tenant_ai_plan_subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE tenant_id = ${tenantId} AND plan_code = ${planCode} AND ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, 'cancelled')}`.execute(this.db);
    return { ok: true as const };
  }
}
