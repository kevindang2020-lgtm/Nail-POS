// membership-billing.repository.ts — data port for the billing engine + the in-memory adapter (dev/offline/tests).
// recordPayment is idempotent on idempotencyKey (mirrors the UNIQUE constraint on membership_payments.idempotency_key):
// a duplicate key returns the existing payment with duplicate:true so a replayed charge never double-writes or
// double-advances state. The Kysely adapter (membership-billing.kysely.repository.ts) is the Postgres implementation.

export interface BillingMembership {
  membershipId: string; tenantId: string; branchId: string | null; customerId: string; customerName: string | null;
  planId: string; planName: string | null; planVersionId: string | null;
  status: string; priceCents: number; billingInterval: string; intervalCount: number; techSplitPct: number; allocationTiming: string;
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null; nextBillingAt: Date | null; startedAt: Date | null; cyclesBilled: number; autoRenew: boolean;
}

export interface RecordPaymentArgs {
  membershipId: string; tenantId: string; branchId: string | null; customerId: string; kind: string; amountCents: number; taxCents: number;
  status: string; processor: string; processorRef: string | null; idempotencyKey: string; attemptNumber: number; failureReason: string | null;
  periodStart: Date | null; periodEnd: Date | null; techAllocCents: number; ownerAllocCents: number; settled: boolean;
}
export interface AdvanceArgs { status: string; currentPeriodStart: Date; currentPeriodEnd: Date; nextBillingAt: Date | null; cyclesBilled: number }
export interface DunningArgs { status: string; nextBillingAt: Date | null; attempt: number }
export interface ActivityArgs { membershipId: string; tenantId: string; branchId: string | null; customerId: string; planId: string | null; activityType: string; customerName: string | null; planName: string | null; amountCents: number | null }
export interface AuditArgs { membershipId: string; tenantId: string; branchId: string | null; planId: string | null; actorUserId: string | null; actorRole: string | null; action: string; prevState: string | null; newState: string | null; reason: string | null; result: string }

export interface MembershipBillingRepositoryPort {
  getForBilling(membershipId: string): Promise<BillingMembership | null>;
  findDue(now: Date, limit: number): Promise<BillingMembership[]>;
  recordPayment(p: RecordPaymentArgs): Promise<{ paymentId: string; duplicate: boolean }>;
  advancePeriod(membershipId: string, p: AdvanceArgs): Promise<void>;
  applyDunning(membershipId: string, p: DunningArgs): Promise<void>;
  addActivity(a: ActivityArgs): Promise<void>;
  addAudit(a: AuditArgs): Promise<void>;
  /** failed renewal attempts recorded for the cycle that started at `periodStart` (the dunning attempt number is this + 1) */
  failedRenewalAttempts?(tenantId: string, membershipId: string, periodStart: Date | null): Promise<number>;
  /** a renewal payment already recorded under this key (a charge that went through but was never applied) */
  paymentByKey?(tenantId: string, membershipId: string, idempotencyKey: string): Promise<{ id: string; status: string } | null>;
}

let SEQ = 1;
const uid = (p: string) => `${p}_${(SEQ++).toString(36)}`;

export class InMemoryMembershipBillingRepository implements MembershipBillingRepositoryPort {
  private memberships = new Map<string, BillingMembership>();
  readonly payments: Array<RecordPaymentArgs & { id: string }> = [];
  readonly activities: ActivityArgs[] = [];
  readonly audits: AuditArgs[] = [];
  private byKey = new Map<string, string>();

  /** test/dev helper — seed a billable membership */
  seed(m: BillingMembership) { this.memberships.set(m.membershipId, { ...m }); }
  snapshot(id: string): BillingMembership | undefined { const m = this.memberships.get(id); return m ? { ...m } : undefined; }

  async getForBilling(membershipId: string): Promise<BillingMembership | null> { const m = this.memberships.get(membershipId); return m ? { ...m } : null; }
  async findDue(now: Date, limit: number): Promise<BillingMembership[]> {
    const billable = new Set(['active', 'grace', 'past_due', 'trial']);
    return [...this.memberships.values()]
      .filter((m) => m.autoRenew && billable.has(m.status) && m.nextBillingAt != null && m.nextBillingAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }
  async recordPayment(p: RecordPaymentArgs): Promise<{ paymentId: string; duplicate: boolean }> {
    const existing = this.byKey.get(p.idempotencyKey);
    if (existing) return { paymentId: existing, duplicate: true };
    const id = uid('mp');
    this.byKey.set(p.idempotencyKey, id);
    this.payments.push({ ...p, id });
    return { paymentId: id, duplicate: false };
  }
  async advancePeriod(membershipId: string, p: AdvanceArgs): Promise<void> {
    const m = this.memberships.get(membershipId); if (!m) return;
    m.status = p.status; m.currentPeriodStart = p.currentPeriodStart; m.currentPeriodEnd = p.currentPeriodEnd; m.nextBillingAt = p.nextBillingAt; m.cyclesBilled = p.cyclesBilled;
  }
  async applyDunning(membershipId: string, p: DunningArgs): Promise<void> {
    const m = this.memberships.get(membershipId); if (!m) return;
    m.status = p.status; m.nextBillingAt = p.nextBillingAt;
  }
  async addActivity(a: ActivityArgs): Promise<void> { this.activities.push(a); }
  async addAudit(a: AuditArgs): Promise<void> { this.audits.push(a); }
  async failedRenewalAttempts(tenantId: string, membershipId: string, periodStart: Date | null): Promise<number> {
    const t = periodStart ? periodStart.getTime() : null;
    return this.payments.filter((x) => x.tenantId === tenantId && x.membershipId === membershipId && x.kind === 'renewal' && x.status === 'failed' && ((x.periodStart ? x.periodStart.getTime() : null) === t)).length;
  }
  async paymentByKey(tenantId: string, membershipId: string, idempotencyKey: string) { const p = this.payments.find((x) => x.tenantId === tenantId && x.membershipId === membershipId && x.idempotencyKey === idempotencyKey); return p ? { id: p.id, status: p.status } : null; }
}
