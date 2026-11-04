import { memberNumber } from './membership-enroll-core';
// membership-enroll.kysely.repository.ts — Postgres adapter for enrollment / reservation / redemption. All reads/writes
// are tenant-scoped; the ledger is append-only (inserts only), and the redemption insert is guarded by the service plus
// the unique index from migration 171. Money is integer cents.
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_MEMBERSHIP } from './membership-machine';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  MembershipEnrollRepositoryPort, EnrollContext, PlanForEnroll, BenefitRow, LedgerEntryRow, MembershipLite, ReservationRow,
  CustomerMembershipRow, InsertMembershipArgs, AppendLedgerArgs, InsertRedemptionArgs, ActivityArgs, AuditArgs, LifecycleRow,
  AvailablePlanRow,
} from './membership-enroll.repository';
import type { LifecyclePatch } from './membership-lifecycle-core';

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

export class KyselyMembershipEnrollRepository implements MembershipEnrollRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}

  async withMembershipLock<T>(ctx: EnrollContext, membershipId: string, fn: (repo: MembershipEnrollRepositoryPort) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'membership_benefit:' + ctx.tenantId + ':' + membershipId}))`.execute(trx);
      return fn(new KyselyMembershipEnrollRepository(trx, this.outbox));
    });
  }
  /** membership.activated / membership.canceled — declared since Constitution 8, recorded by nothing until now. */
  private async membershipFact(exec: any, ctx: EnrollContext, type: string, membershipId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(exec, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined,
      aggregateType: 'customer_membership', aggregateId: membershipId, actorId: ctx.userId || undefined, actorType: 'user', payload: { membershipId, ...payload } }));
  }

  async getCustomerName(ctx: EnrollContext, customerId: string): Promise<string | null> {
    const r = await sql<{ full_name: string }>`select full_name from customers where (id::text = ${customerId} or user_id::text = ${customerId}) and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    return r.rows[0]?.full_name ?? null;
  }

  async getPlanForEnroll(ctx: EnrollContext, planId: string, planVersionId?: string): Promise<PlanForEnroll | null> {
    const head = await sql<{
      plan_id: string; name: string; status: string; version_id: string | null; billing_interval: string | null; interval_count: number | null;
      auto_renew: boolean | null; trial_days: number | null; tech_commission_basis: string | null; tech_split_pct: string | null; allocation_timing: string | null; tech_fixed_cents: string | null;
    }>`
      select p.id as plan_id, p.name, p.status,
             ${planVersionId ? sql`${planVersionId}::uuid` : sql`p.current_version_id`} as version_id,
             v.billing_interval, v.interval_count, v.auto_renew, v.trial_days, v.tech_commission_basis, v.tech_split_pct, v.allocation_timing, v.tech_fixed_cents
      from membership_plans p
      left join membership_plan_versions v on v.id = ${planVersionId ? sql`${planVersionId}::uuid` : sql`p.current_version_id`}
      where p.id = ${planId} and p.tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const h = head.rows[0];
    if (!h || !h.version_id) return null;
    const bres = await sql<{ benefit_id: string; benefit_type: string; service_id: string | null; label: string; credits_per_cycle: number; value_cents: string; allocated_value_cents: string; percent: string }>`
      select id as benefit_id, benefit_type, service_id, label, credits_per_cycle, value_cents, allocated_value_cents, percent
      from membership_benefits where plan_version_id = ${h.version_id} and tenant_id = ${ctx.tenantId} order by sort_order asc`.execute(this.db);
    const benefits: BenefitRow[] = bres.rows.map((b) => ({ benefitId: b.benefit_id, benefitType: b.benefit_type, serviceId: b.service_id, label: b.label, creditsPerCycle: n(b.credits_per_cycle), valueCents: n(b.value_cents), allocatedValueCents: n(b.allocated_value_cents), percent: n(b.percent) }));
    return {
      planId: h.plan_id, planName: h.name, planVersionId: h.version_id, status: h.status,
      billingInterval: h.billing_interval ?? 'month', intervalCount: n(h.interval_count), autoRenew: !!h.auto_renew, trialDays: n(h.trial_days),
      techCommissionBasis: h.tech_commission_basis ?? 'allocated', techSplitPct: n(h.tech_split_pct) || 60, allocationTiming: h.allocation_timing ?? 'on_redemption', techFixedCents: n(h.tech_fixed_cents), benefits,
    };
  }

  async insertMembership(ctx: EnrollContext, a: InsertMembershipArgs): Promise<{ membershipId: string; memberNumber: string | null }> {
    return this.db.transaction().execute(async (trx) => {
    const cust = await sql<{ id: string }>`select id from customers where (id::text = ${a.customerId} or user_id::text = ${a.customerId}) and tenant_id = ${ctx.tenantId} limit 1`.execute(trx);
    const resolvedCustomerId = cust.rows[0]?.id || a.customerId;

    let branchId = ctx.branchId || null;
    if (!branchId) {
      const bRow = await sql<{ id: string }>`select id from branches where tenant_id = ${ctx.tenantId} and status = 'active' order by created_at asc limit 1`.execute(trx);
      branchId = bRow.rows[0]?.id || null;
    }

    // Member numbers are unique per salon (migration 785). Allocate under a per-salon lock so two enrollments at once
    // cannot pick the same number; a random number that already exists is drawn again.
    await sql`select pg_advisory_xact_lock(hashtext(${'member_number:' + ctx.tenantId}))`.execute(trx);
    let memberNum = a.memberNumber;
    for (let i = 0; memberNum && i < 8; i++) {
      const taken = await sql<{ x: number }>`select 1 as x from customer_memberships where tenant_id = ${ctx.tenantId} and member_number = ${memberNum} limit 1`.execute(trx);
      if (!taken.rows.length) break;
      memberNum = memberNumber();
    }
    const r = await sql<{ id: string }>`
      insert into customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, assigned_technician_id, member_number, started_at, current_period_start, current_period_end, next_billing_at, term_end_at, auto_renew, auto_renew_consent_at, agreement_version, enrolled_channel, enrolled_by_user_id)
      values (${ctx.tenantId}, ${branchId}, ${resolvedCustomerId}, ${a.planId}, ${a.planVersionId}, ${a.status}, ${a.assignedTechnicianId}, ${memberNum}, ${a.startedAt}, ${a.currentPeriodStart}, ${a.currentPeriodEnd}, ${a.nextBillingAt}, ${a.termEndAt}, ${a.autoRenew}, ${a.autoRenewConsentAt}, ${a.agreementVersion}, ${a.enrolledChannel}, ${ctx.userId || null})
      returning id`.execute(trx);
    const membershipId = r.rows[0].id;
    // an enrollment that starts ACTIVE is the activation (a pending one is not — yet)
    if (a.status === 'active') await this.membershipFact(trx, ctx, DOMAIN_EVENTS.MEMBERSHIP_ACTIVATED, membershipId, { customerId: resolvedCustomerId, planId: a.planId, planVersionId: a.planVersionId });
    return { membershipId, memberNumber: memberNum };
    });
  }

  async issueInitialCredits(ctx: EnrollContext, membershipId: string, entries: Array<{ benefitId: string; serviceId: string | null; quantity: number; amountCents: number }>, expiresAt: Date | null): Promise<void> {
    for (const e of entries) {
      await sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, service_id, quantity, amount_cents, expires_at, reason, created_by_user_id)
        values (${ctx.tenantId}, ${membershipId}, ${e.benefitId}, 'issued', ${e.serviceId}, ${e.quantity}, ${e.amountCents}, ${expiresAt}, 'enrollment', ${ctx.userId || null})`.execute(this.db);
    }
  }

  async getMembershipLite(ctx: EnrollContext, membershipId: string): Promise<MembershipLite | null> {
    const r = await sql<{ membership_id: string; status: string; plan_version_id: string | null; plan_id: string; customer_id: string; branch_id: string | null; tech_commission_basis: string | null; tech_split_pct: string | null }>`
      select cm.id as membership_id, cm.status, cm.plan_version_id, cm.plan_id, cm.customer_id, cm.branch_id, v.tech_commission_basis, v.tech_split_pct
      from customer_memberships cm left join membership_plan_versions v on v.id = cm.plan_version_id
      where cm.id = ${membershipId} and cm.tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const h = r.rows[0];
    if (!h) return null;
    return { membershipId: h.membership_id, status: h.status, planVersionId: h.plan_version_id, planId: h.plan_id, customerId: h.customer_id, branchId: h.branch_id, techCommissionBasis: h.tech_commission_basis ?? 'allocated', techSplitPct: n(h.tech_split_pct) || 60 };
  }

  async getBenefit(ctx: EnrollContext, planVersionId: string, benefitId: string): Promise<BenefitRow | null> {
    const r = await sql<{ benefit_id: string; benefit_type: string; service_id: string | null; label: string; credits_per_cycle: number; value_cents: string; allocated_value_cents: string; percent: string }>`
      select id as benefit_id, benefit_type, service_id, label, credits_per_cycle, value_cents, allocated_value_cents, percent
      from membership_benefits where id = ${benefitId} and plan_version_id = ${planVersionId} and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const b = r.rows[0];
    return b ? { benefitId: b.benefit_id, benefitType: b.benefit_type, serviceId: b.service_id, label: b.label, creditsPerCycle: n(b.credits_per_cycle), valueCents: n(b.value_cents), allocatedValueCents: n(b.allocated_value_cents), percent: n(b.percent) } : null;
  }

  async benefitsMeta(ctx: EnrollContext, planVersionId: string): Promise<Array<{ benefitId: string; label: string; benefitType: string; serviceId: string | null }>> {
    const r = await sql<{ benefit_id: string; label: string; benefit_type: string; service_id: string | null }>`
      select id as benefit_id, label, benefit_type, service_id from membership_benefits where plan_version_id = ${planVersionId} and tenant_id = ${ctx.tenantId} order by sort_order asc`.execute(this.db);
    return r.rows.map((b) => ({ benefitId: b.benefit_id, label: b.label, benefitType: b.benefit_type, serviceId: b.service_id }));
  }

  async ledgerForBenefit(ctx: EnrollContext, membershipId: string, benefitId: string): Promise<LedgerEntryRow[]> {
    const r = await sql<{ entry_type: string; quantity: number; amount_cents: string; benefit_id: string | null; reservation_ref: string | null }>`
      select entry_type, quantity, amount_cents, benefit_id, reservation_ref from membership_credit_ledger
      where customer_membership_id = ${membershipId} and benefit_id = ${benefitId} and tenant_id = ${ctx.tenantId}`.execute(this.db);
    return r.rows.map((x) => ({ entryType: x.entry_type, quantity: n(x.quantity), amountCents: n(x.amount_cents), benefitId: x.benefit_id, reservationRef: x.reservation_ref }));
  }

  async ledgerForMembership(ctx: EnrollContext, membershipId: string): Promise<LedgerEntryRow[]> {
    const r = await sql<{ entry_type: string; quantity: number; amount_cents: string; benefit_id: string | null; reservation_ref: string | null }>`
      select entry_type, quantity, amount_cents, benefit_id, reservation_ref from membership_credit_ledger
      where customer_membership_id = ${membershipId} and tenant_id = ${ctx.tenantId}`.execute(this.db);
    return r.rows.map((x) => ({ entryType: x.entry_type, quantity: n(x.quantity), amountCents: n(x.amount_cents), benefitId: x.benefit_id, reservationRef: x.reservation_ref }));
  }

  async appendLedger(ctx: EnrollContext, e: AppendLedgerArgs): Promise<void> {
    await sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, service_id, quantity, amount_cents, ticket_id, reservation_ref, reason, created_by_user_id)
      values (${ctx.tenantId}, ${e.membershipId}, ${e.benefitId}, ${e.entryType}, ${e.serviceId}, ${e.quantity}, ${e.amountCents}, ${e.ticketId}, ${e.reservationRef}, ${e.reason}, ${ctx.userId || null})`.execute(this.db);
  }

  async findOpenReservation(ctx: EnrollContext, reservationRef: string): Promise<ReservationRow | null> {
    const r = await sql<{ customer_membership_id: string; benefit_id: string | null; service_id: string | null; quantity: number; amount_cents: string }>`
      select customer_membership_id, benefit_id, service_id, quantity, amount_cents from membership_credit_ledger
      where reservation_ref = ${reservationRef} and entry_type = 'reserved' and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const res = r.rows[0];
    if (!res) return null;
    const closed = await sql<{ exists: boolean }>`select exists(select 1 from membership_credit_ledger where reservation_ref = ${reservationRef} and entry_type in ('released','redeemed') and tenant_id = ${ctx.tenantId}) as exists`.execute(this.db);
    return { membershipId: res.customer_membership_id, benefitId: res.benefit_id, serviceId: res.service_id, quantity: n(res.quantity), amountCents: n(res.amount_cents), closed: !!closed.rows[0]?.exists };
  }

  async redemptionExistsForLine(ctx: EnrollContext, serviceLineId: string): Promise<boolean> {
    const r = await sql<{ exists: boolean }>`select exists(select 1 from membership_redemptions where service_line_id = ${serviceLineId} and tenant_id = ${ctx.tenantId}) as exists`.execute(this.db);
    return !!r.rows[0]?.exists;
  }

  async serviceLineSnapshot(ctx: EnrollContext, serviceLineId: string): Promise<{ serviceId: string | null; priceCents: number } | null> {
    const r = await sql<{ service_id: string | null; price_cents_snapshot: string }>`select service_id, price_cents_snapshot from ticket_service_lines where id = ${serviceLineId} and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const x = r.rows[0];
    return x ? { serviceId: x.service_id, priceCents: n(x.price_cents_snapshot) } : null;
  }

  async insertRedemption(ctx: EnrollContext, a: InsertRedemptionArgs): Promise<{ redemptionId: string }> {
    const r = await sql<{ id: string }>`
      insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, service_line_id, benefit_id, service_id, standard_value_cents, allocated_value_cents, upgrade_charge_cents, technician_id, commission_basis_snapshot)
      values (${ctx.tenantId}, ${ctx.branchId || null}, ${a.membershipId}, ${a.ticketId}, ${a.serviceLineId}, ${a.benefitId}, ${a.serviceId}, ${a.standardValueCents}, ${a.allocatedValueCents}, ${a.upgradeChargeCents}, ${a.technicianId}, ${a.commissionBasisSnapshot})
      returning id`.execute(this.db);
    return { redemptionId: r.rows[0].id };
  }

  async listCustomerMemberships(ctx: EnrollContext, customerId: string): Promise<CustomerMembershipRow[]> {
    const cust = await sql<{ id: string }>`select id from customers where (id::text = ${customerId} or user_id::text = ${customerId}) and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const resolvedCustomerId = cust.rows[0]?.id || customerId;

    const r = await sql<{ membership_id: string; plan_id: string; plan_name: string | null; status: string; member_number: string | null; started_at: any; next_billing_at: any }>`
      select cm.id as membership_id, cm.plan_id, p.name as plan_name, cm.status, cm.member_number, cm.started_at, cm.next_billing_at
      from customer_memberships cm left join membership_plans p on p.id = cm.plan_id
      where (cm.customer_id = ${resolvedCustomerId} or cm.customer_id = ${customerId}) and cm.tenant_id = ${ctx.tenantId} and cm.status not in ('canceled','expired')
      order by cm.started_at desc nulls last`.execute(this.db);
    return r.rows.map((x) => ({ membershipId: x.membership_id, planId: x.plan_id, planName: x.plan_name, status: x.status, memberNumber: x.member_number, startedAt: iso(x.started_at), nextBillingAt: iso(x.next_billing_at) }));
  }

  async ticketCustomerId(ctx: EnrollContext, ticketId: string): Promise<string | null> {
    // Security Deep Scan §75: a ticket is a record of ONE location — another location's session reads no coverage for it
    const r = await sql<{ customer_id: string }>`select customer_id from tickets where id = ${ticketId} and tenant_id = ${ctx.tenantId} and (${ctx.branchId || null}::uuid is null or branch_id = ${ctx.branchId || null}::uuid) limit 1`.execute(this.db);
    return r.rows[0]?.customer_id ?? null;
  }

  async redemptionsForTicket(ctx: EnrollContext, ticketId: string): Promise<Array<{ serviceLineId: string | null; serviceName: string | null; standardValueCents: number; upgradeChargeCents: number }>> {
    const r = await sql<{ service_line_id: string | null; service_name: string | null; standard_value_cents: string; upgrade_charge_cents: string }>`
      select rd.service_line_id, tsl.service_name_snapshot as service_name, rd.standard_value_cents, rd.upgrade_charge_cents
      from membership_redemptions rd left join ticket_service_lines tsl on tsl.id = rd.service_line_id
      where rd.ticket_id = ${ticketId} and rd.tenant_id = ${ctx.tenantId}`.execute(this.db);
    return r.rows.map((x) => ({ serviceLineId: x.service_line_id, serviceName: x.service_name, standardValueCents: n(x.standard_value_cents), upgradeChargeCents: n(x.upgrade_charge_cents) }));
  }

  async activeMembershipsForCustomers(ctx: EnrollContext, customerIds: string[]): Promise<Array<{ customerId: string; planName: string | null; status: string }>> {
    if (!customerIds.length) return [];
    // distinct on (customer_id) ... order by started_at desc => the single most-recent active membership per customer
    // (a LEFT JOIN would multiply a check-in/queue row per membership; this returns exactly one row per customer).
    const r = await sql<{ customer_id: string; plan_name: string | null; status: string }>`
      select distinct on (cm.customer_id) cm.customer_id, p.name as plan_name, cm.status
      from customer_memberships cm left join membership_plans p on p.id = cm.plan_id
      where cm.tenant_id = ${ctx.tenantId} and cm.customer_id::text = any(${customerIds}) and cm.status in ('active','trial','grace','comped')
      order by cm.customer_id, cm.started_at desc nulls last`.execute(this.db);
    return r.rows.map((x) => ({ customerId: x.customer_id, planName: x.plan_name, status: x.status }));
  }

  async loadForLifecycle(ctx: EnrollContext, membershipId: string): Promise<LifecycleRow | null> {
    const r = await sql<{ id: string; tenant_id: string; status: string; auto_renew: boolean; current_period_end: unknown; version: number; customer_id: string; plan_id: string | null; plan_version_id: string | null; full_name: string | null; plan_name: string | null }>`
      select cm.id, cm.tenant_id, cm.status, cm.auto_renew, cm.current_period_end, cm.version, cm.customer_id, cm.plan_id, cm.plan_version_id,
        c.full_name, p.name as plan_name
      from customer_memberships cm
      left join customers c on c.id = cm.customer_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.id = ${membershipId} and cm.tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const x = r.rows[0];
    if (!x) return null;
    return { membershipId: x.id, tenantId: x.tenant_id, status: x.status, autoRenew: !!x.auto_renew, currentPeriodEnd: iso(x.current_period_end), version: n(x.version), customerId: x.customer_id, planId: x.plan_id, planVersionId: x.plan_version_id, customerName: x.full_name, planName: x.plan_name };
  }

  async applyLifecycle(ctx: EnrollContext, membershipId: string, patch: LifecyclePatch, expectedVersion: number): Promise<{ updated: boolean; conflict: boolean }> {
    const sets = [sql`status = ${patch.status}`, sql`version = version + 1`, sql`updated_at = now()`];
    if (patch.autoRenew !== undefined) sets.push(sql`auto_renew = ${patch.autoRenew}`);
    if (patch.cancelAtPeriodEnd !== undefined) sets.push(sql`cancel_at_period_end = ${patch.cancelAtPeriodEnd}`);
    if (patch.canceledAt !== undefined) sets.push(sql`canceled_at = ${patch.canceledAt}`);
    if (patch.cancelReason !== undefined) sets.push(sql`cancel_reason = ${patch.cancelReason}`);
    if (patch.termEndAt !== undefined) sets.push(sql`term_end_at = ${patch.termEndAt}`);
    if (patch.pausedAt !== undefined) sets.push(sql`paused_at = ${patch.pausedAt}`);
    if (patch.pauseResumesAt !== undefined) sets.push(sql`pause_resumes_at = ${patch.pauseResumesAt}`);
    if (patch.bumpPausesUsed) sets.push(sql`pauses_used = pauses_used + 1`);
    // Build the SET on its own line so the UPDATE template below stays a single flat statement (no nested sql`` inside it).
    const setClause = sql.join(sets, sql`, `);
    // Optimistic concurrency: the update only lands if the version still matches (HTTP 409 otherwise). tenant_id in the
    // WHERE keeps it tenant-scoped (and satisfies the isolation guard).
    return this.db.transaction().execute(async (trx) => {
    const r = await sql<{ id: string; customer_id: string; plan_id: string }>`update customer_memberships set ${setClause} where id = ${membershipId} and tenant_id = ${ctx.tenantId} and version = ${expectedVersion} and ${canMoveToSql(CUSTOMER_MEMBERSHIP, patch.status)} returning id, customer_id, plan_id`.execute(trx);
    // an immediate cancel is the fact; a cancel AT PERIOD END leaves the membership active until the billing run ends it
    if (r.rows.length && patch.status === 'canceled') await this.membershipFact(trx, ctx, DOMAIN_EVENTS.MEMBERSHIP_CANCELED, membershipId, { customerId: r.rows[0].customer_id, planId: r.rows[0].plan_id, reason: patch.cancelReason ? 'given' : null });
    return { updated: r.rows.length > 0, conflict: r.rows.length === 0 };
    });
  }

  async addActivity(ctx: EnrollContext, a: ActivityArgs): Promise<void> {
    let branchId = ctx.branchId || null;
    if (!branchId) {
      const bRow = await sql<{ id: string }>`select id from branches where tenant_id = ${ctx.tenantId} and status = 'active' order by created_at asc limit 1`.execute(this.db);
      branchId = bRow.rows[0]?.id || null;
    }
    await sql`insert into membership_activity (tenant_id, branch_id, customer_membership_id, customer_id, plan_id, activity_type, customer_name_snapshot, plan_name_snapshot, amount_cents)
      values (${ctx.tenantId}, ${branchId}, ${a.membershipId}, ${a.customerId}, ${a.planId}, ${a.activityType}, ${a.customerName}, ${a.planName}, ${a.amountCents})`.execute(this.db);
  }

  async addAudit(ctx: EnrollContext, a: AuditArgs): Promise<void> {
    let branchId = ctx.branchId || null;
    if (!branchId) {
      const bRow = await sql<{ id: string }>`select id from branches where tenant_id = ${ctx.tenantId} and status = 'active' order by created_at asc limit 1`.execute(this.db);
      branchId = bRow.rows[0]?.id || null;
    }
    await sql`insert into membership_audit (tenant_id, branch_id, customer_membership_id, plan_id, plan_version_id, customer_id, actor_user_id, actor_role, action, prev_state, new_state, reason, result)
      values (${ctx.tenantId}, ${branchId}, ${a.membershipId}, ${a.planId}, ${a.planVersionId}, null, ${ctx.userId || null}, ${ctx.role || null}, ${a.action}, ${a.prevState}, ${a.newState}, ${a.reason}, ${a.result})`.execute(this.db);
  }

  async getAvailablePlansForMember(ctx: EnrollContext): Promise<AvailablePlanRow[]> {
    const plans = await sql<{
      plan_id: string; name: string; plan_code: string | null; description: string | null; badge: string | null;
      is_popular: boolean; is_featured: boolean; plan_version_id: string; price_cents: string;
      billing_interval: string; interval_count: number; enrollment_fee_cents: string;
    }>`
      select p.id as plan_id, p.name, p.plan_code, p.description, p.badge, p.is_popular, p.is_featured,
             pv.id as plan_version_id, pv.price_cents, pv.billing_interval, pv.interval_count, pv.enrollment_fee_cents
      from membership_plans p
      join membership_plan_versions pv on pv.id = p.current_version_id
      where p.tenant_id = ${ctx.tenantId}
        and p.status = 'active'
        and p.member_visible = true
        and pv.is_published = true
      order by p.is_popular desc, p.created_at desc
    `.execute(this.db);

    if (!plans.rows.length) return [];

    const versionIds = plans.rows.map((p) => p.plan_version_id).filter(Boolean);
    const benefits = versionIds.length
      ? await sql<{
          benefit_id: string; plan_version_id: string; label: string; benefit_type: string;
          credits_per_cycle: number; value_cents: string;
        }>`
          select id as benefit_id, plan_version_id, label, benefit_type, credits_per_cycle, value_cents
          from membership_benefits
          where tenant_id = ${ctx.tenantId}
            and plan_version_id in (${sql.join(versionIds.map((id) => sql`${id}::uuid`))})
          order by sort_order asc
        `.execute(this.db)
      : { rows: [] };

    const benefitsByVersion = new Map<string, Array<{ benefitId: string; label: string; benefitType: string; creditsPerCycle: number; valueCents: number }>>();
    for (const b of benefits.rows) {
      const arr = benefitsByVersion.get(b.plan_version_id) || [];
      arr.push({
        benefitId: b.benefit_id,
        label: b.label,
        benefitType: b.benefit_type,
        creditsPerCycle: Number(b.credits_per_cycle || 0),
        valueCents: Number(b.value_cents || 0),
      });
      benefitsByVersion.set(b.plan_version_id, arr);
    }

    return plans.rows.map((p) => ({
      planId: p.plan_id,
      planVersionId: p.plan_version_id,
      name: p.name,
      planCode: p.plan_code,
      description: p.description,
      badge: p.badge,
      isPopular: Boolean(p.is_popular),
      isFeatured: Boolean(p.is_featured),
      priceCents: Number(p.price_cents || 0),
      billingInterval: p.billing_interval || 'month',
      intervalCount: Number(p.interval_count || 1),
      enrollmentFeeCents: Number(p.enrollment_fee_cents || 0),
      benefits: benefitsByVersion.get(p.plan_version_id) || [],
    }));
  }
}
