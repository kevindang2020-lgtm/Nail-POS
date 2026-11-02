// memberships.service.ts — business rules over the repository. Validation uses the pure engine (memberships-core) so a
// plan can never publish with a split that doesn't total 100%, and product types are constrained. Permission enforcement
// lives in the controller guard (pos.memberships.*); this layer adds input validation and tenant-safe shaping.
import type { MembershipsRepositoryPort, MembershipsContext } from './memberships.repository';
import type { MembershipOverview, OverviewFilters, PlanRow, PlanDetail, CreatePlanRequest, PublishVersionRequest, MemberExportRow, PaymentExportRow, RedemptionExportRow } from './memberships.dto';
import { PRODUCT_TYPES, isValidSplit } from './memberships-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(m = 'Forbidden') { super(m); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(m = 'Invalid request') { super(m); this.name = 'ValidationError'; } }

const BILLING_INTERVALS = new Set(['month', 'quarter', 'six_month', 'year', 'none', 'custom']);
const ALLOCATION_TIMINGS = new Set(['on_billing', 'on_redemption', 'hybrid']);
const CANCELLATION_POLICIES = new Set(['immediate', 'period_end', 'term_end']);

export class MembershipsService {
  constructor(private readonly repo: MembershipsRepositoryPort) {}

  getOverview(ctx: MembershipsContext, filters: OverviewFilters): Promise<MembershipOverview> {
    const f: OverviewFilters = {
      branchId: filters.branchId || undefined,
      rangeDays: clampInt(filters.rangeDays, 30, 1, 365),
      expiringWindowDays: clampInt(filters.expiringWindowDays, 7, 1, 90),
    };
    return this.repo.overview(ctx, f);
  }

  listPlans(ctx: MembershipsContext, branchId?: string): Promise<PlanRow[]> {
    return this.repo.listPlans(ctx, branchId || undefined);
  }

  async getPlan(ctx: MembershipsContext, planId: string): Promise<PlanDetail> {
    const plan = await this.repo.getPlan(ctx, planId);
    if (!plan) throw withCode(new ValidationError('Plan not found'), 'PLAN_NOT_FOUND');
    return plan;
  }

  async createPlan(ctx: MembershipsContext, body: CreatePlanRequest): Promise<{ planId: string }> {
    const name = (body?.name || '').trim();
    if (!name) throw withCode(new ValidationError('Plan name is required'), 'PLAN_NAME_REQUIRED');
    if (name.length > 120) throw withCode(new ValidationError('Plan name is too long'), 'PLAN_NAME_TOO_LONG');
    const productType = body.productType ?? 'recurring';
    if (!(PRODUCT_TYPES as readonly string[]).includes(productType)) throw new ValidationError('Unknown product type');
    return this.repo.createPlan(ctx, { ...body, name, productType });
  }

  async publishVersion(ctx: MembershipsContext, planId: string, body: PublishVersionRequest): Promise<{ versionId: string; versionNumber: number }> {
    const existing = await this.repo.getPlan(ctx, planId);
    if (!existing) throw withCode(new ValidationError('Plan not found'), 'PLAN_NOT_FOUND');

    const techSplit = numOr(body.techSplitPct, 60);
    const ownerSplit = numOr(body.ownerSplitPct, 40);
    if (!isValidSplit(techSplit, ownerSplit)) throw withCode(new ValidationError('Technician and owner split must total 100%'), 'SPLIT_MUST_TOTAL_100');

    const interval = body.billingInterval ?? 'month';
    if (!BILLING_INTERVALS.has(interval)) throw new ValidationError('Unknown billing interval');

    const isCustom = !!body.isCustomPricing;
    const price = numOr(body.priceCents, 0);
    if (!isCustom && price < 0) throw withCode(new ValidationError('Price cannot be negative'), 'PRICE_NEGATIVE');

    if (body.allocationTiming && !ALLOCATION_TIMINGS.has(body.allocationTiming)) throw new ValidationError('Unknown allocation timing');
    if (body.cancellationPolicy && !CANCELLATION_POLICIES.has(body.cancellationPolicy)) throw new ValidationError('Unknown cancellation policy');

    return this.repo.publishVersion(ctx, planId, {
      ...body, techSplitPct: techSplit, ownerSplitPct: ownerSplit, billingInterval: interval, priceCents: price, isCustomPricing: isCustom,
    });
  }

  exportMembers(ctx: MembershipsContext, branchId?: string): Promise<MemberExportRow[]> { return this.repo.exportMembers(ctx, branchId || undefined); }
  exportPayments(ctx: MembershipsContext, branchId?: string): Promise<PaymentExportRow[]> { return this.repo.exportPayments(ctx, branchId || undefined); }
  exportRedemptions(ctx: MembershipsContext, branchId?: string): Promise<RedemptionExportRow[]> { return this.repo.exportRedemptions(ctx, branchId || undefined); }
}

function clampInt(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
function numOr(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
