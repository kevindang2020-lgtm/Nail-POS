// plans.service.ts — read overview + audited plan mutations. Validation is pure (plan-mutations-core); uniqueness,
// versioning, and audit are enforced here. Every mutation requires the super_admin.subscriptions.manage permission
// (backend-enforced, not just a hidden button) and writes an audit_logs row.
import { Injectable, Inject } from '@nestjs/common';
import type { PlansDataPort, AuditActor, PlanVersionView, PlanSnapshot } from './plans.repository';
import { buildPlansOverview, type PlansOverview } from './plans-overview-core';
import { normalizeCreatePlan, normalizePlanDetailsPatch, validatePricingChange, nextVersionNumber, normalizePlanLimitsUpdate } from './plan-mutations-core';

export class PlanNotFoundError extends Error {}
export class PlanConflictError extends Error {}
export class PlanForbiddenError extends Error {}

export type PlansActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';

function requireManage(actor?: PlansActor): void {
  if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) {
    throw new PlanForbiddenError(`missing permission: ${MANAGE_PERM}`);
  }
}

@Injectable()
export class SuperAdminPlansService {
  constructor(@Inject('PlansDataPort') private readonly repo: PlansDataPort) {}

  async getOverview(): Promise<PlansOverview> {
    const d = await this.repo.getOverviewData();
    return buildPlansOverview(d.planRows, d.limitRows, d.featureCounts, d.subFacts, d.overageRows, d.addOns, d.trialsPromotions, d.tenantSubscriptions, d.featureAdoption, d.utilizationTrend);
  }

  async createPlan(input: unknown, actor: PlansActor): Promise<{ id: string; plan: PlanSnapshot | null; versions: PlanVersionView[] }> {
    requireManage(actor);
    const n = normalizeCreatePlan(input); // throws Error -> 400
    const { codeExists, nameExists } = await this.repo.planKeyExists(n.code, n.name);
    if (codeExists) throw new PlanConflictError(`plan code already exists: ${n.code}`);
    if (nameExists) throw new PlanConflictError(`plan name already exists: ${n.name}`);
    const id = await this.repo.createPlan(n, actor.userId ?? null);
    await this.repo.writeAudit(actor, 'super_admin_plan_create', id, {
      code: n.code, name: n.name, monthlyPriceCents: n.monthly_price_cents, planType: n.plan_type, status: n.status,
    });
    return { id, plan: await this.repo.getPlanSnapshot(id), versions: await this.repo.listVersions(id) };
  }

  async updatePlanDetails(id: string, input: unknown, actor: PlansActor): Promise<PlanSnapshot | null> {
    requireManage(actor);
    const patch = normalizePlanDetailsPatch(input); // throws -> 400
    const before = await this.repo.getPlanSnapshot(id);
    if (!before) throw new PlanNotFoundError(`plan not found: ${id}`);
    const ok = await this.repo.updatePlanDetails(id, patch);
    if (!ok) throw new PlanNotFoundError(`plan not found: ${id}`);
    await this.repo.writeAudit(actor, 'super_admin_plan_update', id, { patch });
    return this.repo.getPlanSnapshot(id);
  }

  async updatePlanLimits(id: string, input: unknown, actor: PlansActor): Promise<PlanSnapshot | null> {
    requireManage(actor);
    const { reason, changes } = normalizePlanLimitsUpdate(input); // throws -> 400
    const before = await this.repo.getPlanSnapshot(id);
    if (!before) throw new PlanNotFoundError(`plan not found: ${id}`);
    await this.repo.updatePlanLimits(id, changes);
    await this.repo.writeAudit(actor, 'super_admin_plan_limits_updated', id, { reason, changes });
    return this.repo.getPlanSnapshot(id);
  }

  async changePricing(id: string, input: unknown, actor: PlansActor): Promise<{ id: string; versionNumber: number; versions: PlanVersionView[] }> {
    requireManage(actor);
    const v = validatePricingChange(input); // requires confirm + reason; throws -> 400
    const snapshot = await this.repo.getPlanSnapshot(id);
    if (!snapshot) throw new PlanNotFoundError(`plan not found: ${id}`);
    const versionNumber = nextVersionNumber(await this.repo.getMaxVersion(id));
    await this.repo.applyPricingChange(id, v, snapshot, versionNumber, actor.userId ?? null);
    await this.repo.writeAudit(actor, 'super_admin_plan_pricing_change', id, {
      fromMonthlyCents: snapshot.monthly_price_cents, toMonthlyCents: v.monthlyPriceCents,
      fromAnnualCents: snapshot.annual_price_cents, toAnnualCents: v.annualPriceCents,
      reason: v.reason, versionNumber, effectiveFrom: v.effectiveFrom.toISOString(),
    });
    return { id, versionNumber, versions: await this.repo.listVersions(id) };
  }

  async listVersions(id: string): Promise<PlanVersionView[]> {
    const snapshot = await this.repo.getPlanSnapshot(id);
    if (!snapshot) throw new PlanNotFoundError(`plan not found: ${id}`);
    return this.repo.listVersions(id);
  }
}
