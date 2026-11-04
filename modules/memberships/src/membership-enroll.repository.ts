// membership-enroll.repository.ts — data port for enrollment / reservation / redemption + the in-memory adapter
// (dev/offline/tests). The ledger is append-only; balances are never stored, only derived (via creditBalance) from the
// entries this port returns, which is what makes over-reservation and double-spend impossible.
import type { LifecyclePatch } from './membership-lifecycle-core';

export interface EnrollContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

export interface BenefitRow { benefitId: string; benefitType: string; serviceId: string | null; label: string; creditsPerCycle: number; valueCents: number; allocatedValueCents: number; percent: number }
export interface PlanForEnroll {
  planId: string; planName: string; planVersionId: string; status: string;
  billingInterval: string; intervalCount: number; autoRenew: boolean; trialDays: number;
  techCommissionBasis: string; techSplitPct: number; allocationTiming: string; techFixedCents: number;
  benefits: BenefitRow[];
}
export interface LedgerEntryRow { entryType: string; quantity: number; amountCents: number; benefitId: string | null; reservationRef: string | null }
export interface MembershipLite { membershipId: string; status: string; planVersionId: string | null; planId: string; customerId: string; branchId: string | null; techCommissionBasis: string; techSplitPct: number }
export interface ReservationRow { membershipId: string; benefitId: string | null; serviceId: string | null; quantity: number; amountCents: number; closed: boolean }
export interface CustomerMembershipRow { membershipId: string; planId: string; planName: string | null; status: string; memberNumber: string | null; startedAt: string | null; nextBillingAt: string | null }

export interface InsertMembershipArgs {
  customerId: string; planId: string; planVersionId: string; status: string; assignedTechnicianId: string | null; memberNumber: string;
  startedAt: Date; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; nextBillingAt: Date | null; termEndAt: Date | null;
  autoRenew: boolean; autoRenewConsentAt: Date | null; agreementVersion: string | null; enrolledChannel: string | null;
}
export interface AppendLedgerArgs { membershipId: string; benefitId: string | null; entryType: string; quantity: number; amountCents: number; serviceId: string | null; ticketId: string | null; reservationRef: string | null; reason: string | null }
export interface InsertRedemptionArgs { membershipId: string; ticketId: string | null; serviceLineId: string | null; benefitId: string | null; serviceId: string | null; standardValueCents: number; allocatedValueCents: number; upgradeChargeCents: number; technicianId: string | null; commissionBasisSnapshot: string }
export interface ActivityArgs { membershipId: string; customerId: string; planId: string | null; activityType: string; customerName: string | null; planName: string | null; amountCents: number | null }
export interface AuditArgs { membershipId: string; planId: string | null; planVersionId: string | null; action: string; prevState: string | null; newState: string | null; reason: string | null; result: string }
export interface LifecycleRow { membershipId: string; tenantId: string; status: string; autoRenew: boolean; currentPeriodEnd: string | null; version: number; customerId: string; planId: string | null; planVersionId: string | null; customerName: string | null; planName: string | null }

export interface AvailablePlanRow {
  planId: string; planVersionId: string; name: string; planCode: string | null; description: string | null;
  badge: string | null; isPopular: boolean; isFeatured: boolean; priceCents: number; billingInterval: string;
  intervalCount: number; enrollmentFeeCents: number;
  benefits: Array<{ benefitId: string; label: string; benefitType: string; creditsPerCycle: number; valueCents: number }>;
}

export interface MembershipEnrollRepositoryPort {
  getCustomerName(ctx: EnrollContext, customerId: string): Promise<string | null>;
  getPlanForEnroll(ctx: EnrollContext, planId: string, planVersionId?: string): Promise<PlanForEnroll | null>;
  getAvailablePlansForMember(ctx: EnrollContext): Promise<AvailablePlanRow[]>;
  insertMembership(ctx: EnrollContext, a: InsertMembershipArgs): Promise<{ membershipId: string; memberNumber: string | null }>;
  issueInitialCredits(ctx: EnrollContext, membershipId: string, entries: Array<{ benefitId: string; serviceId: string | null; quantity: number; amountCents: number }>, expiresAt: Date | null): Promise<void>;
  getMembershipLite(ctx: EnrollContext, membershipId: string): Promise<MembershipLite | null>;
  getBenefit(ctx: EnrollContext, planVersionId: string, benefitId: string): Promise<BenefitRow | null>;
  benefitsMeta(ctx: EnrollContext, planVersionId: string): Promise<Array<{ benefitId: string; label: string; benefitType: string; serviceId: string | null }>>;
  ledgerForBenefit(ctx: EnrollContext, membershipId: string, benefitId: string): Promise<LedgerEntryRow[]>;
  ledgerForMembership(ctx: EnrollContext, membershipId: string): Promise<LedgerEntryRow[]>;
  appendLedger(ctx: EnrollContext, e: AppendLedgerArgs): Promise<void>;
  findOpenReservation(ctx: EnrollContext, reservationRef: string): Promise<ReservationRow | null>;
  redemptionExistsForLine(ctx: EnrollContext, serviceLineId: string): Promise<boolean>;
  serviceLineSnapshot(ctx: EnrollContext, serviceLineId: string): Promise<{ serviceId: string | null; priceCents: number } | null>;
  insertRedemption(ctx: EnrollContext, a: InsertRedemptionArgs): Promise<{ redemptionId: string }>;
  listCustomerMemberships(ctx: EnrollContext, customerId: string): Promise<CustomerMembershipRow[]>;
  activeMembershipsForCustomers(ctx: EnrollContext, customerIds: string[]): Promise<Array<{ customerId: string; planName: string | null; status: string }>>;
  loadForLifecycle(ctx: EnrollContext, membershipId: string): Promise<LifecycleRow | null>;
  applyLifecycle(ctx: EnrollContext, membershipId: string, patch: LifecyclePatch, expectedVersion: number): Promise<{ updated: boolean; conflict: boolean }>;
  ticketCustomerId(ctx: EnrollContext, ticketId: string): Promise<string | null>;
  redemptionsForTicket(ctx: EnrollContext, ticketId: string): Promise<Array<{ serviceLineId: string | null; serviceName: string | null; standardValueCents: number; upgradeChargeCents: number }>>;
  addActivity(ctx: EnrollContext, a: ActivityArgs): Promise<void>;
  addAudit(ctx: EnrollContext, a: AuditArgs): Promise<void>;
  /** Run fn in one transaction holding a per-membership lock (benefit reserve / release / redeem). */
  withTransaction?<T>(fn: (repo: MembershipEnrollRepositoryPort) => Promise<T>): Promise<T>;
  withMembershipLock?<T>(ctx: EnrollContext, membershipId: string, fn: (repo: MembershipEnrollRepositoryPort) => Promise<T>): Promise<T>;
}

let SEQ = 1;
const uid = (p: string) => `${p}_${(SEQ++).toString(36)}`;

interface MemRow { membershipId: string; tenantId: string; args: InsertMembershipArgs; status: string; planVersionId: string; techCommissionBasis: string; techSplitPct: number; version: number; cancelAtPeriodEnd?: boolean; canceledAt?: string | null; cancelReason?: string | null; pausedAt?: string | null; pauseResumesAt?: string | null; pausesUsed?: number }
interface LRow extends AppendLedgerArgs { tenantId: string }

export class InMemoryMembershipEnrollRepository implements MembershipEnrollRepositoryPort {
  private customers = new Map<string, string>();           // id -> fullName
  private plans = new Map<string, PlanForEnroll>();         // planId -> plan
  private serviceLines = new Map<string, { serviceId: string | null; priceCents: number; serviceName: string | null }>();
  private tickets = new Map<string, string>();              // ticketId -> customerId
  private memberships = new Map<string, MemRow>();
  readonly ledger: LRow[] = [];
  readonly redemptions: Array<InsertRedemptionArgs & { id: string }> = [];
  readonly activities: ActivityArgs[] = [];
  readonly audits: AuditArgs[] = [];

  seedCustomer(id: string, fullName: string) { this.customers.set(id, fullName); }
  seedPlan(p: PlanForEnroll) { this.plans.set(p.planId, p); }
  seedServiceLine(id: string, snap: { serviceId: string | null; priceCents: number; serviceName?: string | null }) { this.serviceLines.set(id, { serviceId: snap.serviceId, priceCents: snap.priceCents, serviceName: snap.serviceName ?? null }); }
  seedTicket(ticketId: string, customerId: string) { this.tickets.set(ticketId, customerId); }
  membershipStatus(id: string): string | undefined { return this.memberships.get(id)?.status; }

  async ticketCustomerId(_c: EnrollContext, ticketId: string): Promise<string | null> { return this.tickets.get(ticketId) ?? null; }
  async redemptionsForTicket(_c: EnrollContext, ticketId: string): Promise<Array<{ serviceLineId: string | null; serviceName: string | null; standardValueCents: number; upgradeChargeCents: number }>> {
    return this.redemptions.filter((r) => r.ticketId === ticketId).map((r) => ({ serviceLineId: r.serviceLineId, serviceName: r.serviceLineId ? this.serviceLines.get(r.serviceLineId)?.serviceName ?? null : null, standardValueCents: r.standardValueCents, upgradeChargeCents: r.upgradeChargeCents }));
  }
  async activeMembershipsForCustomers(_c: EnrollContext, customerIds: string[]): Promise<Array<{ customerId: string; planName: string | null; status: string }>> {
    const ids = new Set(customerIds);
    const ACTIVE = new Set(['active', 'trial', 'grace', 'comped']);
    const out: Array<{ customerId: string; planName: string | null; status: string }> = [];
    const seen = new Set<string>();
    for (const m of this.memberships.values()) {
      const cid = m.args.customerId;
      if (!ids.has(cid) || !ACTIVE.has(m.status) || seen.has(cid)) continue;
      seen.add(cid);
      out.push({ customerId: cid, planName: this.plans.get(m.args.planId)?.planName ?? null, status: m.status });
    }
    return out;
  }

  async getCustomerName(_c: EnrollContext, customerId: string): Promise<string | null> { return this.customers.get(customerId) ?? null; }

  async loadForLifecycle(_c: EnrollContext, membershipId: string): Promise<LifecycleRow | null> {
    const m = this.memberships.get(membershipId);
    if (!m) return null;
    return { membershipId, tenantId: m.tenantId, status: m.status, autoRenew: m.args.autoRenew, currentPeriodEnd: m.args.currentPeriodEnd ? m.args.currentPeriodEnd.toISOString() : null, version: m.version, customerId: m.args.customerId, planId: m.args.planId, planVersionId: m.planVersionId, customerName: this.customers.get(m.args.customerId) ?? null, planName: this.plans.get(m.args.planId)?.planName ?? null };
  }
  async applyLifecycle(_c: EnrollContext, membershipId: string, patch: LifecyclePatch, expectedVersion: number): Promise<{ updated: boolean; conflict: boolean }> {
    const m = this.memberships.get(membershipId);
    if (!m) return { updated: false, conflict: false };
    if (m.version !== expectedVersion) return { updated: false, conflict: true };
    m.status = patch.status;
    if (patch.autoRenew !== undefined) m.args.autoRenew = patch.autoRenew;
    if (patch.cancelAtPeriodEnd !== undefined) m.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
    if (patch.canceledAt !== undefined) m.canceledAt = patch.canceledAt;
    if (patch.cancelReason !== undefined) m.cancelReason = patch.cancelReason;
    if (patch.pausedAt !== undefined) m.pausedAt = patch.pausedAt;
    if (patch.pauseResumesAt !== undefined) m.pauseResumesAt = patch.pauseResumesAt;
    if (patch.bumpPausesUsed) m.pausesUsed = (m.pausesUsed ?? 0) + 1;
    m.version += 1;
    return { updated: true, conflict: false };
  }
  async getPlanForEnroll(_c: EnrollContext, planId: string): Promise<PlanForEnroll | null> { return this.plans.get(planId) ?? null; }
  async insertMembership(ctx: EnrollContext, a: InsertMembershipArgs): Promise<{ membershipId: string; memberNumber: string | null }> {
    const plan = this.plans.get(a.planId);
    const id = uid('mem');
    this.memberships.set(id, { membershipId: id, tenantId: ctx.tenantId, args: a, status: a.status, planVersionId: a.planVersionId, techCommissionBasis: plan?.techCommissionBasis ?? 'allocated', techSplitPct: plan?.techSplitPct ?? 60, version: 0 });
    return { membershipId: id, memberNumber: a.memberNumber };
  }
  async issueInitialCredits(ctx: EnrollContext, membershipId: string, entries: Array<{ benefitId: string; serviceId: string | null; quantity: number; amountCents: number }>, _e: Date | null): Promise<void> {
    for (const en of entries) this.ledger.push({ tenantId: ctx.tenantId, membershipId, benefitId: en.benefitId, entryType: 'issued', quantity: en.quantity, amountCents: en.amountCents, serviceId: en.serviceId, ticketId: null, reservationRef: null, reason: 'enrollment' });
  }
  async getMembershipLite(_c: EnrollContext, membershipId: string): Promise<MembershipLite | null> {
    const m = this.memberships.get(membershipId); if (!m) return null;
    return { membershipId, status: m.status, planVersionId: m.planVersionId, planId: m.args.planId, customerId: m.args.customerId, branchId: m.args.assignedTechnicianId ? null : null, techCommissionBasis: m.techCommissionBasis, techSplitPct: m.techSplitPct };
  }
  async getBenefit(_c: EnrollContext, planVersionId: string, benefitId: string): Promise<BenefitRow | null> {
    for (const p of this.plans.values()) if (p.planVersionId === planVersionId) { const b = p.benefits.find((x) => x.benefitId === benefitId); if (b) return b; }
    return null;
  }
  async benefitsMeta(_c: EnrollContext, planVersionId: string): Promise<Array<{ benefitId: string; label: string; benefitType: string; serviceId: string | null }>> {
    for (const p of this.plans.values()) if (p.planVersionId === planVersionId) return p.benefits.map((b) => ({ benefitId: b.benefitId, label: b.label, benefitType: b.benefitType, serviceId: b.serviceId }));
    return [];
  }
  async ledgerForBenefit(_c: EnrollContext, membershipId: string, benefitId: string): Promise<LedgerEntryRow[]> {
    return this.ledger.filter((l) => l.membershipId === membershipId && l.benefitId === benefitId).map((l) => ({ entryType: l.entryType, quantity: l.quantity, amountCents: l.amountCents, benefitId: l.benefitId, reservationRef: l.reservationRef }));
  }
  async ledgerForMembership(_c: EnrollContext, membershipId: string): Promise<LedgerEntryRow[]> {
    return this.ledger.filter((l) => l.membershipId === membershipId).map((l) => ({ entryType: l.entryType, quantity: l.quantity, amountCents: l.amountCents, benefitId: l.benefitId, reservationRef: l.reservationRef }));
  }
  async appendLedger(ctx: EnrollContext, e: AppendLedgerArgs): Promise<void> { this.ledger.push({ ...e, tenantId: ctx.tenantId }); }
  async findOpenReservation(_c: EnrollContext, reservationRef: string): Promise<ReservationRow | null> {
    const reserve = this.ledger.find((l) => l.reservationRef === reservationRef && l.entryType === 'reserved');
    if (!reserve) return null;
    const closed = this.ledger.some((l) => l.reservationRef === reservationRef && (l.entryType === 'released' || l.entryType === 'redeemed'));
    return { membershipId: reserve.membershipId, benefitId: reserve.benefitId, serviceId: reserve.serviceId, quantity: reserve.quantity, amountCents: reserve.amountCents, closed };
  }
  async redemptionExistsForLine(_c: EnrollContext, serviceLineId: string): Promise<boolean> { return this.redemptions.some((r) => r.serviceLineId === serviceLineId); }
  async serviceLineSnapshot(_c: EnrollContext, serviceLineId: string): Promise<{ serviceId: string | null; priceCents: number } | null> { return this.serviceLines.get(serviceLineId) ?? null; }
  async insertRedemption(_c: EnrollContext, a: InsertRedemptionArgs): Promise<{ redemptionId: string }> { const id = uid('red'); this.redemptions.push({ ...a, id }); return { redemptionId: id }; }
  async listCustomerMemberships(_c: EnrollContext, customerId: string): Promise<CustomerMembershipRow[]> {
    return [...this.memberships.values()].filter((m) => m.args.customerId === customerId).map((m) => ({ membershipId: m.membershipId, planId: m.args.planId, planName: this.plans.get(m.args.planId)?.planName ?? null, status: m.status, memberNumber: m.args.memberNumber, startedAt: m.args.startedAt.toISOString(), nextBillingAt: m.args.nextBillingAt?.toISOString() ?? null }));
  }
  async addActivity(_c: EnrollContext, a: ActivityArgs): Promise<void> { this.activities.push(a); }
  async addAudit(_c: EnrollContext, a: AuditArgs): Promise<void> { this.audits.push(a); }
  async getAvailablePlansForMember(_c: EnrollContext): Promise<AvailablePlanRow[]> { return []; }
}
