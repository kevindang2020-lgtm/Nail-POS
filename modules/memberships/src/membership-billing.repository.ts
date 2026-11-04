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
  /** issue the new cycle's credits (one 'issued' ledger row per crediting benefit of the plan version), at most once per
   *  cycle (keyed on cycleKey); returns how many rows were written */
  issueCycleCredits?(tenantId: string, membershipId: string, planVersionId: string, cycleKey: string): Promise<number>;
  /** the first payment's amount (one period's price + the enrollment fee, integer cents) */
  firstPaymentAmount?(tenantId: string, membershipId: string): Promise<number>;
  /** a PAID invoice of this salon for this customer, of at least the amount, not already used by another membership payment */
  paidInvoiceFor?(tenantId: string, customerId: string, invoiceId: string): Promise<{ id: string; totalCents: number; number: string; used: boolean } | null>;
  /** the customer's paid invoices that are not yet used by a membership payment (newest first) */
  eligibleInvoices?(tenantId: string, customerId: string): Promise<Array<{ id: string; number: string; totalCents: number; paidAt: string | null }>>;
  hasSavedCard?(tenantId: string, customerId: string): Promise<boolean>;
  /** declined first-payment attempts so far (each attempt uses its own processor key: a decline is never replayed) */
  firstPaymentFailures?(tenantId: string, membershipId: string): Promise<number>;
  /** ONE transaction: the payment row (idempotent on its key), pending → active with the first period, the first credits,
   *  activity and audit. duplicate = the key was already used (nothing else is written). */
  applyFirstPayment?(a: FirstPaymentArgs): Promise<{ applied: boolean; duplicate: boolean; paymentId: string }>;
}
export interface FirstPaymentArgs {
  membership: BillingMembership; actorUserId: string | null; actorRole: string | null; amountCents: number; processor: string; processorRef: string | null;
  idempotencyKey: string; periodStart: Date; periodEnd: Date | null; nextBillingAt: Date | null; method: string;
}

let SEQ = 1;
const uid = (p: string) => `${p}_${(SEQ++).toString(36)}`;

export class InMemoryMembershipBillingRepository implements MembershipBillingRepositoryPort {
  private memberships = new Map<string, BillingMembership>();
  readonly payments: Array<RecordPaymentArgs & { id: string }> = [];
  readonly activities: ActivityArgs[] = [];
  readonly audits: AuditArgs[] = [];
  private byKey = new Map<string, string>();
  readonly cycleCredits = new Set<string>();
  firstPaymentCents = 0; savedCard = false; readonly invoices: Array<{ id: string; tenantId: string; customerId: string; number: string; totalCents: number; paid: boolean }> = [];
  async firstPaymentAmount(): Promise<number> { return this.firstPaymentCents; }
  async hasSavedCard(): Promise<boolean> { return this.savedCard; }
  async firstPaymentFailures(_t: string, id: string): Promise<number> { return this.payments.filter((p) => p.membershipId === id && p.kind === 'enrollment' && p.status === 'failed').length; }
  async paidInvoiceFor(t: string, c: string, id: string) { const i = this.invoices.find((x) => x.id === id && x.tenantId === t && x.customerId === c && x.paid); if (!i) return null; return { id: i.id, totalCents: i.totalCents, number: i.number, used: this.payments.some((p) => p.processor === 'invoice' && p.processorRef === id && p.status === 'succeeded') }; }
  async eligibleInvoices(t: string, c: string) { return this.invoices.filter((x) => x.tenantId === t && x.customerId === c && x.paid && !this.payments.some((p) => p.processor === 'invoice' && p.processorRef === x.id && p.status === 'succeeded')).map((x) => ({ id: x.id, number: x.number, totalCents: x.totalCents, paidAt: null })); }
  async applyFirstPayment(a: FirstPaymentArgs) {
    if (this.byKey.has(a.idempotencyKey)) return { applied: false, duplicate: true, paymentId: this.byKey.get(a.idempotencyKey)! };
    const m = this.memberships.get(a.membership.membershipId); if (!m || m.status !== 'pending') return { applied: false, duplicate: false, paymentId: '' };
    const r = await this.recordPayment({ membershipId: m.membershipId, tenantId: m.tenantId, branchId: m.branchId, customerId: m.customerId, kind: 'enrollment', amountCents: a.amountCents, taxCents: 0, status: 'succeeded', processor: a.processor, processorRef: a.processorRef, idempotencyKey: a.idempotencyKey, attemptNumber: 1, failureReason: null, periodStart: a.periodStart, periodEnd: a.periodEnd, techAllocCents: 0, ownerAllocCents: 0, settled: true });
    m.status = 'active'; m.currentPeriodStart = a.periodStart; m.currentPeriodEnd = a.periodEnd; m.nextBillingAt = a.nextBillingAt; m.cyclesBilled = 1; m.startedAt = a.periodStart;
    this.cycleCredits.add(m.membershipId + '|first');
    return { applied: true, duplicate: false, paymentId: r.paymentId };
  }
  async issueCycleCredits(_t: string, membershipId: string, _v: string, cycleKey: string): Promise<number> {
    const k = membershipId + '|' + cycleKey; if (this.cycleCredits.has(k)) return 0; this.cycleCredits.add(k); return 1;
  }

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
