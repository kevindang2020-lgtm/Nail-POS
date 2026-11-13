// memberships.service.ts — business rules over the repository. Validation uses the pure engine (memberships-core) so a
// plan can never publish with a split that doesn't total 100%, and product types are constrained. Permission enforcement
// lives in the controller guard (pos.memberships.*); this layer adds input validation and tenant-safe shaping.
import type { MembershipsRepositoryPort, MembershipsContext } from './memberships.repository';
import type { MembershipOverview, OverviewFilters, PlanRow, PlanDetail, CreatePlanRequest, PublishVersionRequest, MemberExportRow, PaymentExportRow, RedemptionExportRow, PlanVersionChangePreviewDto, VersionChangeFacts, VersionField } from './memberships.dto';
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
    const facts = body.carryForward ? await this.facts(ctx, planId) : null;
    return this.repo.publishVersion(ctx, planId, this.normalizeVersion(body, facts));
  }

  /** extras Membership Overview 13 · 10 "Smart subscription change preview": the SAME normalisation and validation as
   *  publishVersion (a refused change is refused here too), compared with the current version, and who it affects: live
   *  members keep the version they joined (renewals bill their own version — membership-billing reads cm.plan_version_id),
   *  only people who join after publishing get the new terms. Writes nothing. */
  async previewVersion(ctx: MembershipsContext, planId: string, body: PublishVersionRequest): Promise<PlanVersionChangePreviewDto> {
    const existing = await this.repo.getPlan(ctx, planId);
    if (!existing) throw withCode(new ValidationError('Plan not found'), 'PLAN_NOT_FOUND');
    const facts = await this.facts(ctx, planId);
    const next = this.normalizeVersion(body, body.carryForward ? facts : null);
    const cur = facts.current;
    const FIELDS: VersionField[] = ['priceCents', 'billingInterval', 'intervalCount', 'trialDays', 'enrollmentFeeCents', 'setupFeeCents', 'autoRenew', 'cancellationPolicy',
      'techSplitPct', 'ownerSplitPct', 'allocationTiming', 'creditExpiryDays', 'rolloverAllowed', 'minCommitmentCycles'];
    const val = (o: Record<string, unknown> | null | undefined, f: string): string | number | boolean | null => { const v = o?.[f]; return v === undefined ? null : (v as string | number | boolean | null); };
    const changes = FIELDS.map((f) => ({ field: f, from: val(cur as Record<string, unknown> | null, f), to: val(next as Record<string, unknown>, f) })).filter((c) => (cur ? c.from !== c.to : true));
    const proposedBenefits = next.benefits ?? [];
    const sameBenefits = !!cur && JSON.stringify(proposedBenefits) === JSON.stringify(cur.benefits);
    if (cur && !sameBenefits) changes.push({ field: 'benefits', from: cur.benefits.length, to: proposedBenefits.length });
    const blockers: PlanVersionChangePreviewDto['blockers'] = [];
    if (facts.planStatus === 'archived') blockers.push('plan_archived');
    if (cur && changes.length === 0) blockers.push('no_change');
    const priceCents = Number(next.priceCents ?? 0);
    return {
      planId, blockers, currentVersionNumber: cur?.versionNumber ?? null, nextVersionNumber: facts.nextVersionNumber, changes,
      benefits: { current: cur?.benefits.length ?? 0, proposed: proposedBenefits.length, carriedForward: !!body.carryForward && !(body.benefits && body.benefits.length) && !!cur },
      currentSubscribers: { total: facts.subscribers.reduce((a, x) => a + x.members, 0), byVersion: facts.subscribers, keepTheirTerms: true },
      futureSubscribers: { priceCents, billingInterval: String(next.billingInterval), priceDeltaCents: cur ? priceCents - cur.priceCents : null },
      readOnly: true,
    };
  }

  private async facts(ctx: MembershipsContext, planId: string): Promise<VersionChangeFacts> {
    const f = this.repo.versionChangeFacts ? await this.repo.versionChangeFacts(ctx, planId) : null;
    if (!f) throw withCode(new ValidationError('Plan not found'), 'PLAN_NOT_FOUND');
    return f;
  }

  /** The ONE normalisation + validation of a new version (publish and preview). With carryForward, every term not sent is
   *  the current version's, and its benefits are kept when none are sent. */
  private normalizeVersion(raw: PublishVersionRequest, facts: VersionChangeFacts | null): PublishVersionRequest {
    const sent = Object.fromEntries(Object.entries(raw ?? {}).filter(([k, v]) => v !== undefined && k !== 'carryForward')) as PublishVersionRequest;
    const body: PublishVersionRequest = facts?.current
      ? { ...(({ versionNumber: _v, ...rest }) => rest)(facts.current), ...sent, benefits: sent.benefits && sent.benefits.length ? sent.benefits : facts.current.benefits }
      : sent;
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

    return { ...body, techSplitPct: techSplit, ownerSplitPct: ownerSplit, billingInterval: interval, priceCents: price, isCustomPricing: isCustom };
  }

  // extras Membership Overview 16 · 08 (round 10): the three exports are sensitive (customer names + money). A user confined
  // to some locations exports only those (another location → BRANCH_ACCESS_DENIED; none chosen → their one location), and
  // every export writes one audit row (actor, list, location, row count) — the PII audit event.
  async exportMembers(ctx: MembershipsContext, branchId?: string): Promise<MemberExportRow[]> {
    const b = exportBranch(ctx, branchId); const rows = await this.repo.exportMembers(ctx, b ?? undefined);
    await this.repo.auditExport?.(ctx, 'members', b, rows.length); return rows;
  }
  async exportPayments(ctx: MembershipsContext, branchId?: string): Promise<PaymentExportRow[]> {
    const b = exportBranch(ctx, branchId); const rows = await this.repo.exportPayments(ctx, b ?? undefined);
    await this.repo.auditExport?.(ctx, 'payments', b, rows.length); return rows;
  }
  async exportRedemptions(ctx: MembershipsContext, branchId?: string): Promise<RedemptionExportRow[]> {
    const b = exportBranch(ctx, branchId); const rows = await this.repo.exportRedemptions(ctx, b ?? undefined);
    await this.repo.auditExport?.(ctx, 'redemptions', b, rows.length); return rows;
  }
}

/** the locations the actor may reach: explicit grants first; a BRANCH / SELECTED_BRANCHES scope without grants → the session
 *  branch; a whole-salon user → null (not confined). Decided from the session's grants, never from a role name. */
export function allowedMembershipBranches(ctx: MembershipsContext): string[] | null {
  const ids = (ctx.authz?.branchIds ?? []).filter((b): b is string => !!b);
  if (ids.length) return ids;
  const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
  if (!confined) return null;
  return ctx.branchId ? [ctx.branchId] : [];
}
/** the location an export runs for (null = every location — only for an unconfined user) */
export function exportBranch(ctx: MembershipsContext, requested?: string): string | null {
  const allowed = allowedMembershipBranches(ctx);
  const want = requested || null;
  if (!allowed) return want;
  if (want) { if (!allowed.includes(want)) throw withCode(new ForbiddenError('You do not have access to this location.'), 'BRANCH_ACCESS_DENIED'); return want; }
  if (allowed.length === 1) return allowed[0]!;
  throw withCode(new ForbiddenError('Choose one of your locations to export.'), 'BRANCH_ACCESS_DENIED');
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
