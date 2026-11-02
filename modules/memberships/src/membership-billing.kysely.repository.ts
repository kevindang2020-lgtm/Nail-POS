// membership-billing.kysely.repository.ts — Postgres adapter for the billing engine. recordPayment relies on the UNIQUE
// constraint on membership_payments.idempotency_key (ON CONFLICT DO NOTHING) so a replayed renewal can never
// double-charge or double-advance; everything is scoped by the membership's own tenant_id/branch_id (a system job, not a
// session). Money is integer cents.
import { transitionStatus } from '@aipowersalon/database';
import { CUSTOMER_MEMBERSHIP } from './membership-machine';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MembershipBillingRepositoryPort, BillingMembership, RecordPaymentArgs, AdvanceArgs, DunningArgs, ActivityArgs, AuditArgs } from './membership-billing.repository';

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const d = (v: unknown): Date | null => (v == null ? null : new Date(v as any));

const BILLING_SELECT = `
  select cm.id as membership_id, cm.tenant_id, cm.branch_id, cm.customer_id, c.full_name as customer_name,
         cm.plan_id, p.name as plan_name, cm.plan_version_id, cm.status,
         coalesce(v.price_cents, 0)::bigint as price_cents, coalesce(v.billing_interval, 'month') as billing_interval, coalesce(v.interval_count, 1)::int as interval_count,
         coalesce(v.tech_split_pct, 60)::numeric as tech_split_pct, coalesce(v.allocation_timing, 'on_redemption') as allocation_timing,
         cm.current_period_start, cm.current_period_end, cm.next_billing_at, cm.started_at, coalesce(cm.cycles_billed, 0)::int as cycles_billed, cm.auto_renew
  from customer_memberships cm
  left join membership_plan_versions v on v.id = cm.plan_version_id
  left join membership_plans p on p.id = cm.plan_id
  left join customers c on c.id = cm.customer_id`;

interface Row {
  membership_id: string; tenant_id: string; branch_id: string | null; customer_id: string; customer_name: string | null;
  plan_id: string; plan_name: string | null; plan_version_id: string | null; status: string;
  price_cents: string; billing_interval: string; interval_count: number; tech_split_pct: string; allocation_timing: string;
  current_period_start: any; current_period_end: any; next_billing_at: any; started_at: any; cycles_billed: number; auto_renew: boolean;
}
const toMembership = (r: Row): BillingMembership => ({
  membershipId: r.membership_id, tenantId: r.tenant_id, branchId: r.branch_id, customerId: r.customer_id, customerName: r.customer_name,
  planId: r.plan_id, planName: r.plan_name, planVersionId: r.plan_version_id, status: r.status,
  priceCents: n(r.price_cents), billingInterval: r.billing_interval, intervalCount: n(r.interval_count), techSplitPct: n(r.tech_split_pct), allocationTiming: r.allocation_timing,
  currentPeriodStart: d(r.current_period_start), currentPeriodEnd: d(r.current_period_end), nextBillingAt: d(r.next_billing_at), startedAt: d(r.started_at), cyclesBilled: n(r.cycles_billed), autoRenew: !!r.auto_renew,
});

export class KyselyMembershipBillingRepository implements MembershipBillingRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async getForBilling(membershipId: string): Promise<BillingMembership | null> {
    const res = await sql<Row>`${sql.raw(BILLING_SELECT)} where cm.id = ${membershipId} limit 1`.execute(this.db);
    return res.rows[0] ? toMembership(res.rows[0]) : null;
  }

  async findDue(now: Date, limit: number): Promise<BillingMembership[]> {
    const res = await sql<Row>`${sql.raw(BILLING_SELECT)}
      where cm.next_billing_at is not null and cm.next_billing_at <= ${now} and cm.auto_renew = true
        and cm.status in ('active','grace','past_due','trial')
      order by cm.next_billing_at asc limit ${limit}`.execute(this.db);
    return res.rows.map(toMembership);
  }

  async recordPayment(p: RecordPaymentArgs): Promise<{ paymentId: string; duplicate: boolean }> {
    const ins = await sql<{ id: string }>`
      insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, tax_cents, status, processor, processor_ref, idempotency_key, attempt_number, failure_reason, period_start, period_end, tech_alloc_cents, owner_alloc_cents, settled_at)
      values (${p.tenantId}, ${p.branchId}, ${p.membershipId}, ${p.customerId}, ${p.kind}, ${p.amountCents}, ${p.taxCents}, ${p.status}, ${p.processor}, ${p.processorRef}, ${p.idempotencyKey}, ${p.attemptNumber}, ${p.failureReason}, ${p.periodStart}, ${p.periodEnd}, ${p.techAllocCents}, ${p.ownerAllocCents}, ${p.settled ? new Date() : null})
      on conflict (idempotency_key) do nothing
      returning id`.execute(this.db);
    if (ins.rows[0]) return { paymentId: ins.rows[0].id, duplicate: false };
    const ex = await sql<{ id: string }>`select id from membership_payments where idempotency_key = ${p.idempotencyKey} and tenant_id = ${p.tenantId} limit 1`.execute(this.db);
    return { paymentId: ex.rows[0]?.id ?? '', duplicate: true };
  }

  async advancePeriod(membershipId: string, p: AdvanceArgs): Promise<void> {
    // Phase 12 (#27): through CUSTOMER_MEMBERSHIP — a membership canceled / expired while this renewal ran is refused (409),
    // never revived to active
    await transitionStatus(this.db, CUSTOMER_MEMBERSHIP, { where: { id: membershipId }, to: p.status, set: {
      current_period_start: p.currentPeriodStart, current_period_end: p.currentPeriodEnd, next_billing_at: p.nextBillingAt, cycles_billed: p.cyclesBilled, version: sql`version + 1`, updated_at: sql`now()` } });
  }

  async applyDunning(membershipId: string, p: DunningArgs): Promise<void> {
    await transitionStatus(this.db, CUSTOMER_MEMBERSHIP, { where: { id: membershipId }, to: p.status, set: { next_billing_at: p.nextBillingAt, version: sql`version + 1`, updated_at: sql`now()` } });
  }

  async addActivity(a: ActivityArgs): Promise<void> {
    await sql`insert into membership_activity (tenant_id, branch_id, customer_membership_id, customer_id, plan_id, activity_type, customer_name_snapshot, plan_name_snapshot, amount_cents)
      values (${a.tenantId}, ${a.branchId}, ${a.membershipId}, ${a.customerId}, ${a.planId}, ${a.activityType}, ${a.customerName}, ${a.planName}, ${a.amountCents})`.execute(this.db);
  }

  async addAudit(a: AuditArgs): Promise<void> {
    await sql`insert into membership_audit (tenant_id, branch_id, customer_membership_id, plan_id, actor_user_id, actor_role, action, prev_state, new_state, reason, result)
      values (${a.tenantId}, ${a.branchId}, ${a.membershipId}, ${a.planId}, ${a.actorUserId}, ${a.actorRole}, ${a.action}, ${a.prevState}, ${a.newState}, ${a.reason}, ${a.result})`.execute(this.db);
  }
}
