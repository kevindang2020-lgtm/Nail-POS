// entitlements.service.ts — resolves a tenant's effective limits/features (override > plan default), evaluates them
// against authoritative usage, and applies audited overrides. assertCanCreate() is the reusable enforcement hook for
// resource-creation paths (throws LimitExceededError -> HTTP 409 when a hard limit is reached). Permission-gated writes.
import { Injectable, Inject, Optional } from '@nestjs/common';
import type { EntitlementsRepo, AuditActor } from './entitlements.repository';
import { resolveEffectiveLimit, evaluateLimit, resolveEffectiveFeature, type LimitEvaluation } from './entitlements-core';
import { LIMIT_METRICS } from './plan-mutations-core';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';

export class TenantNotFoundError extends Error {}
export class EntitlementForbiddenError extends Error {}
export class LimitExceededError extends Error {}

export type EntActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';
function requireManage(actor?: EntActor): void {
  if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new EntitlementForbiddenError(`missing permission: ${MANAGE_PERM}`);
}

const FEATURE_OVERRIDE_STATES = ['enabled', 'disabled'];
const PLAN_CONFIG_TTL_SECONDS = 60; // slow-changing plan config; short TTL self-heals after plan edits

@Injectable()
export class EntitlementsService {
  constructor(
    @Inject('EntitlementsRepo') private readonly repo: EntitlementsRepo,
    @Optional() @Inject(TENANT_CACHE) private readonly cache?: TenantCache,
  ) {}

  // Plan CONFIG (catalog + plan limits + plan feature states) depends only on the tenant's plan and changes rarely
  // (only via super-admin plan edits). It is read on every entitlement check, so it's the hot, cacheable slice. Live
  // usage counts and tenant-specific overrides are deliberately NOT cached — they change constantly and drive
  // allow/deny decisions, so caching them would risk wrongly gating resource creation. Short self-healing TTL keeps
  // staleness bounded without needing a cross-tenant bust; plan edits also proactively invalidate (see plans.service).
  private async resolvePlanConfig(tenantId: string, planText: string | null) {
    const load = async () => {
      const catalog = planText ? await this.repo.mapCatalogPlan(planText) : null;
      const planLimits = catalog ? await this.repo.getPlanLimits(catalog.id) : {};
      const planFeatures = catalog ? await this.repo.getPlanFeatureStates(catalog.id) : {};
      return { catalog, planLimits, planFeatures };
    };
    if (!this.cache) return load();
    const key = `plans:config:${planText ?? 'none'}`;
    return this.cache.getOrSet({ tenantId }, key, PLAN_CONFIG_TTL_SECONDS, load);
  }

  private async resolveContext(tenantId: string) {
    if (!(await this.repo.tenantExists(tenantId))) throw new TenantNotFoundError(`tenant not found: ${tenantId}`);
    const planText = await this.repo.getActivePlanText(tenantId);
    const { catalog, planLimits: rawPlanLimits, planFeatures } = await this.resolvePlanConfig(tenantId, planText);
    // Product policy: TECHNICIANS ARE UNLIMITED for every tenant, regardless of plan default or override.
    // Force the metric to an explicit unlimited (null) plan default and drop any technicians override, done
    // cache-safely (shallow copy — never mutate the cached plan config). This keeps enforcement
    // (assertCanCreate), preflight (checkLimit), and the entitlements display all agreeing that tech
    // headcount is uncapped.
    const planLimits: Record<string, number | null> = { ...rawPlanLimits, technicians: null };
    const [overrides, featureOverrides, used] = await Promise.all([
      this.repo.getLimitOverrides(tenantId), this.repo.getFeatureOverrides(tenantId), this.repo.getUsedCounts(tenantId),
    ]);
    const ovByMetric = new Map(overrides.filter((o) => o.metric !== 'technicians').map((o) => [o.metric, o]));
    const fovByKey = new Map(featureOverrides.map((f) => [f.feature_key, f]));
    return { planText, catalog, planLimits, planFeatures, ovByMetric, fovByKey, used };
  }

  async getEntitlements(tenantId: string) {
    const c = await this.resolveContext(tenantId);
    const limits = LIMIT_METRICS.map((metric) => {
      const ov = c.ovByMetric.get(metric);
      const planDefault = metric in c.planLimits ? c.planLimits[metric] : undefined;
      const eff = resolveEffectiveLimit(planDefault, ov ? { limitValue: ov.limit_value, enforcement: (ov.enforcement as any) } : null);
      const used = metric in c.used ? c.used[metric] : null;
      const evaluation: LimitEvaluation = evaluateLimit(eff, used ?? 0);
      return {
        metric,
        planDefault: planDefault === undefined ? null : planDefault,
        planConfigured: planDefault !== undefined,
        override: ov ? { value: ov.limit_value, enforcement: ov.enforcement, reason: ov.reason, expiresAt: ov.expires_at } : null,
        used,
        effectiveValue: eff.value, effectiveSource: eff.source, enforcement: eff.enforcement,
        evaluation: used === null ? { ...evaluation, status: eff.configured ? evaluation.status : 'unconfigured', usedPct: null } : evaluation,
      };
    });
    const featureKeys = Array.from(new Set([...Object.keys(c.planFeatures), ...c.fovByKey.keys()])).sort();
    const features = featureKeys.map((featureKey) => {
      const ov = c.fovByKey.get(featureKey);
      const eff = resolveEffectiveFeature(c.planFeatures[featureKey], (ov?.state as any) ?? null);
      return { featureKey, planState: eff.planState, override: ov?.state ?? null, enabled: eff.enabled, source: eff.source, blocked: eff.blocked };
    });
    return {
      tenantId,
      plan: { text: c.planText, mapped: !!c.catalog, code: c.catalog?.code ?? null, name: c.catalog?.name ?? null },
      limits, features,
    };
  }

  async setLimitOverride(tenantId: string, input: any, actor: EntActor) {
    requireManage(actor);
    if (!(await this.repo.tenantExists(tenantId))) throw new TenantNotFoundError(`tenant not found: ${tenantId}`);
    const metric = String(input?.metric ?? '');
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`metric must be one of: ${LIMIT_METRICS.join(', ')}`);

    if (input?.clear === true) {
      const removed = await this.repo.deleteLimitOverride(tenantId, metric);
      await this.repo.writeAudit(actor, 'super_admin_tenant_limit_override_clear', tenantId, { metric, removed });
      return this.getEntitlements(tenantId);
    }

    let limitValue: number | null;
    if (input?.limitValue === null || input?.limitValue === 'unlimited') limitValue = null;
    else if (Number.isInteger(input?.limitValue) && input.limitValue >= 0) limitValue = input.limitValue;
    else throw new Error('limitValue must be a non-negative integer, null, or "unlimited"');

    const enforcement = input?.enforcement === 'soft' ? 'soft' : input?.enforcement === 'hard' || input?.enforcement === undefined ? 'hard' : (() => { throw new Error('enforcement must be hard or soft'); })();
    const reason = typeof input?.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : (() => { throw new Error('reason is required'); })();
    let expiresAt: string | null = null;
    if (input?.expiresAt) { const d = new Date(input.expiresAt); if (isNaN(d.getTime())) throw new Error('expiresAt must be a valid date'); expiresAt = d.toISOString(); }

    await this.repo.upsertLimitOverride(tenantId, { metric, limitValue, enforcement, reason, expiresAt, createdBy: actor.userId ?? null });
    await this.repo.writeAudit(actor, 'super_admin_tenant_limit_override_set', tenantId, { metric, limitValue, enforcement, reason, expiresAt });
    return this.getEntitlements(tenantId);
  }

  async setFeatureOverride(tenantId: string, input: any, actor: EntActor) {
    requireManage(actor);
    if (!(await this.repo.tenantExists(tenantId))) throw new TenantNotFoundError(`tenant not found: ${tenantId}`);
    const featureKey = typeof input?.featureKey === 'string' && input.featureKey.trim() ? input.featureKey.trim() : (() => { throw new Error('featureKey is required'); })();
    const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 500) : null;

    if (input?.state === 'clear') {
      const removed = await this.repo.deleteFeatureOverride(tenantId, featureKey);
      await this.repo.writeAudit(actor, 'super_admin_tenant_feature_override_clear', tenantId, { featureKey, removed });
      return this.getEntitlements(tenantId);
    }
    if (!FEATURE_OVERRIDE_STATES.includes(input?.state)) throw new Error('state must be enabled, disabled, or clear');
    await this.repo.upsertFeatureOverride(tenantId, { featureKey, state: input.state, reason, expiresAt: null, createdBy: actor.userId ?? null });
    await this.repo.writeAudit(actor, 'super_admin_tenant_feature_override_set', tenantId, { featureKey, state: input.state, reason });
    return this.getEntitlements(tenantId);
  }

  // Records usage for a usage-based metric in a billing period (increment; negative amounts correct). Feeds getUsedCounts
  // so utilization + overage reflect it. Permission-gated + audited.
  async recordUsage(tenantId: string, input: any, actor: EntActor) {
    requireManage(actor);
    if (!(await this.repo.tenantExists(tenantId))) throw new TenantNotFoundError(`tenant not found: ${tenantId}`);
    const metric = String(input?.metric ?? '');
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`metric must be one of: ${LIMIT_METRICS.join(', ')}`);
    if (!Number.isInteger(input?.amount)) throw new Error('amount must be an integer');
    let period = new Date().toISOString().slice(0, 7);
    if (input?.period !== undefined && input?.period !== null && input?.period !== '') {
      if (!/^\d{4}-\d{2}$/.test(String(input.period))) throw new Error('period must be YYYY-MM');
      period = String(input.period);
    }
    const usedValue = await this.repo.recordUsage(tenantId, metric, input.amount, period);
    await this.repo.writeAudit(actor, 'super_admin_tenant_usage_recorded', tenantId, { metric, amount: input.amount, period, usedValue });
    return { tenantId, metric, period, usedValue };
  }

  // Enforcement decision for a single metric (reused by checkLimit endpoint and assertCanCreate).
  async checkLimit(tenantId: string, metric: string) {
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`unknown metric: ${metric}`);
    const c = await this.resolveContext(tenantId);
    const ov = c.ovByMetric.get(metric);
    const planDefault = metric in c.planLimits ? c.planLimits[metric] : undefined;
    const eff = resolveEffectiveLimit(planDefault, ov ? { limitValue: ov.limit_value, enforcement: (ov.enforcement as any) } : null);
    const used = metric in c.used ? c.used[metric] : 0;
    const usedKnown = metric in c.used;
    const evaluation = evaluateLimit(eff, used);
    return { tenantId, metric, used: usedKnown ? used : null, usedKnown, effectiveValue: eff.value, effectiveSource: eff.source, enforcement: eff.enforcement, ...evaluation };
  }

  // Reusable hook for creation paths: throws when a hard limit is reached (only when usage is actually known).
  async assertCanCreate(tenantId: string, metric: string): Promise<void> {
    const r = await this.checkLimit(tenantId, metric);
    if (r.usedKnown && !r.allowed) throw new LimitExceededError(r.reason || `Hard limit reached for ${metric}`);
  }

  // Bulk variant: rejects when adding `additional` resources would exceed a hard cap.
  async assertCapacity(tenantId: string, metric: string, additional: number): Promise<void> {
    if (!Number.isFinite(additional) || additional <= 0) return;
    const r = await this.checkLimit(tenantId, metric);
    if (!r.usedKnown || r.effectiveValue === null || r.enforcement !== 'hard') return; // unmetered/unlimited/soft -> allow
    const remaining = Math.max(0, r.effectiveValue - (r.used ?? 0));
    if (additional > remaining) {
      throw new LimitExceededError(`Hard limit for ${metric}: only ${remaining} of ${additional} can be added (${r.used}/${r.effectiveValue} used). Upgrade the plan or raise the custom limit.`);
    }
  }

  // Read-only plan utilization across active tenants: per-metric used/effective/pct/status (only where usage is known
  // and the limit is finite), plus per-tenant worst status and a platform summary. Honest gaps are simply omitted.
  /** Phase 11 (Constitution 4 §27): the salons the utilization sweep covers, de-duplicated — one per tenant. */
  async utilizationTenantIds(): Promise<string[]> {
    return [...new Set((await this.repo.listActiveTenants()).map((t) => t.id))];
  }

  async getPlanUtilization() {
    const tenants = await this.repo.listActiveTenants();
    let near = 0; let over = 0; let sumMax = 0; let counted = 0;
    const rows = [] as Array<{ tenantId: string; name: string; planText: string | null; planCode: string | null; maxPct: number; worstStatus: 'ok' | 'near' | 'over'; metrics: Array<{ metric: string; used: number; effective: number; pct: number; status: string }> }>;
    for (const t of tenants) {
      const ent = await this.getEntitlements(t.id);
      const metrics = utilizationMetrics(ent);
      const maxPct = metrics.reduce((m, x) => Math.max(m, x.pct), 0);
      const isOver = metrics.some((x) => x.status === 'blocked' || x.status === 'overage' || x.pct >= 100);
      const isNear = !isOver && metrics.some((x) => x.status === 'warning' || x.pct >= 90);
      const worstStatus = isOver ? 'over' : isNear ? 'near' : 'ok';
      if (isOver) over++; else if (isNear) near++;
      if (metrics.length) { sumMax += maxPct; counted++; }
      rows.push({ tenantId: t.id, name: t.name, planText: t.planText, planCode: ent.plan.code, maxPct, worstStatus, metrics });
    }
    rows.sort((a, b) => b.maxPct - a.maxPct);
    return {
      generatedAt: new Date().toISOString(),
      summary: { tenants: tenants.length, tenantsNearLimit: near, tenantsOverLimit: over, avgMaxUtilizationPct: counted ? Math.round(sumMax / counted) : 0 },
      tenants: rows,
    };
  }

  // Captures today's platform utilization summary into the snapshot series (one row per day; re-capture overwrites).
  async snapshotUtilization(actor: EntActor) {
    requireManage(actor);
    const u = await this.getPlanUtilization();
    await this.repo.upsertUtilizationSnapshot({ tenants: u.summary.tenants, tenantsNear: u.summary.tenantsNearLimit, tenantsOver: u.summary.tenantsOverLimit, avgMaxPct: u.summary.avgMaxUtilizationPct });
    await this.repo.writeAudit(actor, 'super_admin_utilization_snapshot', 'platform', u.summary);
    return { capturedOn: new Date().toISOString().slice(0, 10), ...u.summary };
  }

  async getUtilizationTrend(limit = 30) { return this.repo.getUtilizationTrend(limit); }
}

/** The metrics a tenant's utilization is judged on — the ONE mapping, shared by the platform view and the per-tenant usage-alert job. */
export function utilizationMetrics(ent: { limits: Array<{ metric: string; used: number | null; effectiveValue: number | null; evaluation: { usedPct?: number | null; status: string } }> }) {
  return ent.limits
    .filter((l) => l.used !== null && l.effectiveValue !== null)
    .map((l) => ({ metric: l.metric, used: l.used as number, effective: l.effectiveValue as number, pct: l.evaluation.usedPct ?? 0, status: l.evaluation.status }));
}
