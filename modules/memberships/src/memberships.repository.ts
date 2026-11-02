// memberships.repository.ts — the data port the service depends on, plus the in-memory adapter (dev/offline/tests).
// The Kysely adapter (memberships.kysely.repository.ts) is the production implementation against Postgres. Both compute
// the overview identically in shape; on empty data the overview is all zeros/empties — never faked.
import type {
  MembershipOverview, OverviewFilters, PlanRow, PlanDetail, CreatePlanRequest, PublishVersionRequest,
  MemberExportRow, PaymentExportRow, RedemptionExportRow,
} from './memberships.dto';

export interface MembershipsContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

export interface MembershipsRepositoryPort {
  overview(ctx: MembershipsContext, f: OverviewFilters): Promise<MembershipOverview>;
  listPlans(ctx: MembershipsContext, branchId?: string): Promise<PlanRow[]>;
  getPlan(ctx: MembershipsContext, planId: string): Promise<PlanDetail | null>;
  createPlan(ctx: MembershipsContext, input: CreatePlanRequest): Promise<{ planId: string }>;
  publishVersion(ctx: MembershipsContext, planId: string, input: PublishVersionRequest): Promise<{ versionId: string; versionNumber: number }>;
  exportMembers(ctx: MembershipsContext, branchId?: string): Promise<MemberExportRow[]>;
  exportPayments(ctx: MembershipsContext, branchId?: string): Promise<PaymentExportRow[]>;
  exportRedemptions(ctx: MembershipsContext, branchId?: string): Promise<RedemptionExportRow[]>;
}

function emptyKpis(windowDays: number) {
  return {
    totalMembers: 0, newMembersThisMonth: 0, activeMembers: 0, activePctOfTotal: 0,
    membershipRevenueCents: 0, revenueDeltaPct: null, expiringSoon: 0, expiringWindowDays: windowDays,
    canceledThisMonth: 0, canceledDeltaPct: null,
  };
}

let SEQ = 1;
const uid = (p: string) => `${p}_${(SEQ++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

interface MemPlan { id: string; tenantId: string; branchId: string | null; name: string; planCode: string | null; productType: string; description: string | null; badge: string | null; isPopular: boolean; isFeatured: boolean; memberVisible: boolean; status: string; currentVersionId: string | null; }
interface MemVersion { id: string; planId: string; versionNumber: number; input: PublishVersionRequest; isPublished: boolean; }

export class InMemoryMembershipsRepository implements MembershipsRepositoryPort {
  private plans: MemPlan[] = [];
  private versions: MemVersion[] = [];

  private scoped(ctx: MembershipsContext) { return this.plans.filter((p) => p.tenantId === ctx.tenantId); }
  private currentVersion(plan: MemPlan): MemVersion | null { return this.versions.find((v) => v.id === plan.currentVersionId) ?? null; }

  private toRow(plan: MemPlan): PlanRow {
    const v = this.currentVersion(plan);
    return {
      planId: plan.id, name: plan.name, description: plan.description, productType: plan.productType,
      billingInterval: v?.input.billingInterval ?? 'month', intervalCount: v?.input.intervalCount ?? 1,
      priceCents: v?.input.priceCents ?? 0, isCustomPricing: v?.input.isCustomPricing ?? false,
      status: plan.status, isPopular: plan.isPopular, badge: plan.badge, memberCount: 0, revenueCents: 0,
    };
  }

  async overview(ctx: MembershipsContext, f: OverviewFilters): Promise<MembershipOverview> {
    const rangeDays = f.rangeDays ?? 30;
    return {
      kpis: emptyKpis(f.expiringWindowDays ?? 7),
      plans: this.scoped(ctx).filter((p) => p.status !== 'archived').map((p) => this.toRow(p)),
      members: [], activity: [], revenueSeries: [], statusBreakdown: [], planDistribution: [], topServices: [],
      rangeDays,
    };
  }

  async listPlans(ctx: MembershipsContext, branchId?: string): Promise<PlanRow[]> {
    return this.scoped(ctx)
      .filter((p) => p.status !== 'archived')
      .filter((p) => !branchId || p.branchId === null || p.branchId === branchId)
      .map((p) => this.toRow(p));
  }

  async getPlan(ctx: MembershipsContext, planId: string): Promise<PlanDetail | null> {
    const plan = this.scoped(ctx).find((p) => p.id === planId);
    if (!plan) return null;
    const v = this.currentVersion(plan);
    const row = this.toRow(plan);
    return {
      ...row, branchId: plan.branchId, currentVersionId: plan.currentVersionId,
      version: v ? {
        versionNumber: v.versionNumber, billingInterval: v.input.billingInterval ?? 'month', intervalCount: v.input.intervalCount ?? 1,
        priceCents: v.input.priceCents ?? 0, isCustomPricing: v.input.isCustomPricing ?? false, autoRenew: v.input.autoRenew ?? true,
        termType: v.input.termType ?? 'none', termDays: v.input.termDays ?? null, techSplitPct: v.input.techSplitPct ?? 60,
        ownerSplitPct: v.input.ownerSplitPct ?? 40, allocationTiming: v.input.allocationTiming ?? 'on_redemption',
        cancellationPolicy: v.input.cancellationPolicy ?? 'period_end', isPublished: v.isPublished,
        benefits: (v.input.benefits ?? []).map((b) => ({ benefitType: b.benefitType, label: b.label, creditsPerCycle: b.creditsPerCycle ?? 0, valueCents: b.valueCents ?? 0, percent: b.percent ?? 0, allocatedValueCents: b.allocatedValueCents ?? 0 })),
      } : null,
    };
  }

  async createPlan(ctx: MembershipsContext, input: CreatePlanRequest): Promise<{ planId: string }> {
    const id = uid('plan');
    this.plans.push({
      id, tenantId: ctx.tenantId, branchId: input.branchId ?? null, name: input.name, planCode: input.planCode ?? null,
      productType: input.productType ?? 'recurring', description: input.description ?? null, badge: input.badge ?? null,
      isPopular: !!input.isPopular, isFeatured: !!input.isFeatured, memberVisible: input.memberVisible ?? true,
      status: 'draft', currentVersionId: null,
    });
    return { planId: id };
  }

  async publishVersion(ctx: MembershipsContext, planId: string, input: PublishVersionRequest): Promise<{ versionId: string; versionNumber: number }> {
    const plan = this.scoped(ctx).find((p) => p.id === planId);
    if (!plan) throw new Error('plan not found');
    const versionNumber = this.versions.filter((v) => v.planId === planId).length + 1;
    const id = uid('ver');
    this.versions.push({ id, planId, versionNumber, input, isPublished: true });
    plan.currentVersionId = id;
    plan.status = 'active';
    return { versionId: id, versionNumber };
  }

  async exportMembers(): Promise<MemberExportRow[]> { return []; }
  async exportPayments(): Promise<PaymentExportRow[]> { return []; }
  async exportRedemptions(): Promise<RedemptionExportRow[]> { return []; }
}
