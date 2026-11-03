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
import { logException } from '@aipowersalon/observability';

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
    // Super Admin's global availability (migration 723) — the same switch the access gate enforces
    const off = new Set<string>(this.db ? (await sql<any>`select package_code from platform_ai_package_settings where not enabled`.execute(this.db).then((r) => r.rows.map((x: any) => String(x.package_code)))
      .catch((e: unknown) => { logException(e, { where: 'tenant-ai.catalog.package_settings', tenantId }); return [] as string[]; })) : []);
    const packageEnabled = (code: string) => !off.has(code);
    const subByCode = new Map(subs.map((s) => [s.packageCode, s]));
    const usedByCode = new Map(usage.map((u) => [u.packageCode, u.used]));
    const packages = AI_PACKAGES.map((p) => {
      const sub = subByCode.get(p.code) ?? null;
      const used = usedByCode.get(p.code) ?? 0;
      const decision = evaluateAiAccess({
        tenantStatus: 'active', packageEnabled: packageEnabled(p.code),
        subscription: sub ? { status: sub.status, trialEndsAt: sub.trialEndsAt } : null,
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
        upgradeRequired: decision.upgradeRequired, trialAvailable: !sub && p.trialDays > 0 && packageEnabled(p.code),
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
    // AI Usage & Limits guide §7: one free trial per package per salon — a cancelled or expired package is not re-trialled
    // (it used to be, so cancel → trial again gave unlimited free months).
    if (existing) throw new TenantAiError('bad_request', existing.status === 'cancelled' || existing.status === 'expired' ? 'trial_already_used' : 'already_subscribed');
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
      // every plan row (cancelled ones too): a cancelled plan's free trial has been used (AI Plans guide, Nov 2 2026)
      const psRows = await sql<any>`SELECT plan_code, status, price_cents, trial_ends_at, cancelled_at FROM tenant_ai_plan_subscriptions WHERE tenant_id = ${tenantId}`.execute(this.db);
      psRows.rows.forEach((r: any) => planSubs.set(r.plan_code, r));
    }
    const plans = AI_PLANS.filter((pl) => settings.get(pl.code)?.active ?? true).map((pl) => {
      const s = settings.get(pl.code);
      const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(pl.code, { priceCentsOverride: s?.price_cents_override ?? null, discountType: s?.discount_type ?? null, discountValue: s?.discount_value ?? 0 });
      const pkgs = planPackages(pl.code);
      // a member counts as live only if active, or trialing with its trial not yet ended (a lapsed trial is not live)
      const memberActive = pkgs.length > 0 && pkgs.every((p) => { const m = subByCode.get(p.code); if (!m) return false;
        return m.status === 'active' || (m.status === 'trialing' && !(m.trialEndsAt && new Date(m.trialEndsAt).getTime() < Date.now())); });
      const planRow = planSubs.get(pl.code);
      const planSub = planRow && planRow.status !== 'cancelled' ? planRow : null;
      // the ONE honest state (the AI Usage screen's rule): a lapsed trial is "trial_expired", never "trialing"
      const trialEndsAt = planSub?.trial_ends_at ? new Date(planSub.trial_ends_at) : null;
      const lapsed = planSub?.status === 'trialing' && trialEndsAt != null && trialEndsAt.getTime() < Date.now();
      const subscribed = (!!planSub && !lapsed) || memberActive;
      // a plan trial is offered only while the plan was never trialled AND at least one member never had a trial
      const trialAvailable = !subscribed && !planRow && pkgs.some((p) => p.trialDays > 0 && !subByCode.has(p.code));
      const state = lapsed ? 'trial_expired' : planSub ? (planSub.status === 'trialing' ? 'trialing' : planSub.status === 'active' ? 'active' : planSub.status === 'past_due' || planSub.status === 'unpaid' ? 'past_due' : String(planSub.status))
        : memberActive ? 'active' : planRow?.status === 'cancelled' ? 'cancelled' : trialAvailable ? 'trial_available' : 'available';
      return {
        code: pl.code, name: pl.name, description: pl.description, essential: !!pl.essential,
        fullCents, discountCents, effectiveCents,
        subscribed, status: planSub?.status ?? (subscribed ? 'active' : null), trialAvailable,
        state, trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null, cancelledAt: planRow?.cancelled_at ? new Date(planRow.cancelled_at).toISOString() : null,
        canCancel: subscribed || lapsed,
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
    // AI Plans guide (Nov 2 2026): one free trial per plan per salon, and a member package is trialled only if it never had one —
    // the plan path used to re-trial cancelled packages and re-open a cancelled plan's trial (cancel → trial again, forever)
    if (this.db) {
      const prior = (await sql<any>`SELECT status FROM tenant_ai_plan_subscriptions WHERE tenant_id = ${tenantId} AND plan_code = ${planCode}`.execute(this.db)).rows[0];
      if (prior) throw new TenantAiError('bad_request', prior.status === 'cancelled' || prior.status === 'expired' ? 'trial_already_used' : 'already_subscribed');
    }
    const existing = await this.repo.listForTenant(tenantId);
    const byCode = new Map(existing.map((x) => [x.packageCode, x]));
    if (!pkgs.some((p) => p.trialDays > 0 && !byCode.has(p.code))) throw new TenantAiError('bad_request', 'trial_already_used');
    let activated = 0;
    for (const p of pkgs) {
      const cur = byCode.get(p.code);
      if (cur) continue;   // active / trialing stays as it is; cancelled / expired already used its trial
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
    // a failed cancel is an error, and "ok" means something was actually cancelled (Nov 2 2026: errors were swallowed)
    let cancelled = 0;
    for (const p of planPackages(planCode)) { if (await this.repo.cancel(tenantId, p.code)) cancelled++; }
    if (this.db) {
      const r: any = await sql`UPDATE tenant_ai_plan_subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE tenant_id = ${tenantId} AND plan_code = ${planCode} AND status <> 'cancelled' AND ${canMoveToSql(TENANT_AI_PLAN_SUBSCRIPTION, 'cancelled')}`.execute(this.db);
      cancelled += Number(r?.numAffectedRows ?? r?.numUpdatedOrDeletedRows ?? 0);
    }
    if (!cancelled) throw new TenantAiError('not_found', 'subscription_not_found');
    return { ok: true as const, cancelled };
  }
}
