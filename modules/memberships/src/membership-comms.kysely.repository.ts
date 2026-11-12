// membership-comms.kysely.repository.ts — Postgres adapter. In-app delivery writes customer_notifications (tenant + customer
// scoped, with a reference for idempotency). The due-reminder read covers active/trial auto-renewing memberships whose
// next billing falls within the window.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MembershipCommsRepositoryPort, CommsContext, MemberCommInfo, DueMember, NotificationInsert } from './membership-comms.repository';

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

export class KyselyMembershipCommsRepository implements MembershipCommsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async smsOptedOut(ctx: CommsContext, phones: string[]): Promise<Set<string>> {
    if (!phones.length) return new Set();
    const r = await sql<{ address: string }>`select address from notification_opt_outs where tenant_id = ${ctx.tenantId} and channel = 'sms' and address = any(${phones}::text[])`.execute(this.db);
    return new Set(r.rows.map((x) => x.address));
  }

  async memberCommInfo(ctx: CommsContext, membershipId: string): Promise<MemberCommInfo | null> {
    const r = await sql<{ customer_id: string; full_name: string | null; plan_name: string | null; next_billing_at: unknown; status: string }>`
      select cm.customer_id, c.full_name, p.name as plan_name, cm.next_billing_at, cm.status
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.id = ${membershipId} and cm.tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    const x = r.rows[0];
    return x ? { customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.next_billing_at), status: x.status } : null;
  }

  async membersDueForReminder(ctx: CommsContext, withinDays: number): Promise<DueMember[]> {
    const r = await sql<{ id: string; customer_id: string; full_name: string | null; plan_name: string | null; next_billing_at: unknown; phone: string | null; salon_name: string | null; branch_id: string | null }>`
      select cm.id, cm.customer_id, c.full_name, p.name as plan_name, cm.next_billing_at, c.normalized_phone as phone, t.display_name as salon_name, cm.branch_id
      from customer_memberships cm
      join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id
      join tenants t on t.id = cm.tenant_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.tenant_id = ${ctx.tenantId}
        and cm.status in ('active', 'trial') and cm.auto_renew = true
        and cm.next_billing_at is not null
        and cm.next_billing_at >= now()
        and cm.next_billing_at <= now() + make_interval(days => ${withinDays})
      order by cm.next_billing_at asc`.execute(this.db);
    return r.rows.map((x) => ({ membershipId: x.id, customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.next_billing_at), phone: x.phone ?? null, salonName: x.salon_name ?? null, branchId: x.branch_id ?? null }));
  }

  async membersDueForReminderAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>> {
    // Cross-tenant system/scheduler read (mirrors billing findDue): it selects cm.tenant_id so the caller scopes every
    // write per-tenant. Safe-by-design and recognized by the isolation guard because the statement carries tenant_id.
    const r = await sql<{ tenant_id: string; id: string; customer_id: string; full_name: string | null; plan_name: string | null; next_billing_at: unknown; phone: string | null; salon_name: string | null; branch_id: string | null }>`
      select cm.tenant_id, cm.id, cm.customer_id, c.full_name, p.name as plan_name, cm.next_billing_at, c.normalized_phone as phone, t.display_name as salon_name, cm.branch_id
      from customer_memberships cm
      join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id
      join tenants t on t.id = cm.tenant_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.status in ('active', 'trial') and cm.auto_renew = true
        and cm.next_billing_at is not null
        and cm.next_billing_at >= ${now}
        and cm.next_billing_at <= ${now}::timestamptz + make_interval(days => ${withinDays})
      order by cm.next_billing_at asc limit ${limit}`.execute(this.db);
    return r.rows.map((x) => ({ tenantId: x.tenant_id, membershipId: x.id, customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.next_billing_at), phone: x.phone ?? null, salonName: x.salon_name ?? null, branchId: x.branch_id ?? null }));
  }

  /** §151: memberships that END inside the window without renewing — a fixed term (term_end_at), or the current period of a
   *  membership set to cancel at period end / with auto-renew off. Cross-tenant like the renewal read (tenant_id selected). */
  async membersExpiringAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>> {
    const r = await sql<{ tenant_id: string; id: string; customer_id: string; full_name: string | null; plan_name: string | null; ends_at: unknown; phone: string | null; salon_name: string | null; branch_id: string | null }>`
      select * from (
        select cm.tenant_id, cm.id, cm.customer_id, c.full_name, p.name as plan_name, c.normalized_phone as phone, t.display_name as salon_name, cm.branch_id,
          coalesce(cm.term_end_at, case when cm.cancel_at_period_end = true or cm.auto_renew = false then cm.current_period_end end) as ends_at
        from customer_memberships cm
        join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id
        join tenants t on t.id = cm.tenant_id
        left join membership_plans p on p.id = cm.plan_id
        where cm.status not in ('canceled', 'expired', 'completed', 'pending')
      ) x
      where x.ends_at is not null and x.ends_at >= ${now} and x.ends_at <= ${now}::timestamptz + make_interval(days => ${withinDays})
      order by x.ends_at asc limit ${limit}`.execute(this.db);
    return r.rows.map((x) => ({ tenantId: x.tenant_id, membershipId: x.id, customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.ends_at), phone: x.phone ?? null, salonName: x.salon_name ?? null, branchId: x.branch_id ?? null }));
  }

  /** One row per (tenant, customer, reference) even when two sweeps race: a transaction-scoped advisory lock on the
   *  reference serialises them, the second sees the first's row and inserts nothing. */
  async insertNotificationOnce(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':' + customerId + ':' + n.reference}, 0))`.execute(trx);
      const hit = await sql<{ one: number }>`select 1 as one from customer_notifications where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and reference = ${n.reference} limit 1`.execute(trx);
      if (hit.rows.length) return false;
      await sql`insert into customer_notifications (tenant_id, customer_id, type, title, body, reference) values (${ctx.tenantId}, ${customerId}, ${n.type}, ${n.title}, ${n.body}, ${n.reference})`.execute(trx);
      return true;
    });
  }

  async notificationExists(ctx: CommsContext, customerId: string, reference: string): Promise<boolean> {
    const r = await sql<{ one: number }>`select 1 as one from customer_notifications where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and reference = ${reference} limit 1`.execute(this.db);
    return r.rows.length > 0;
  }

  async insertNotification(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<void> {
    await sql`
      insert into customer_notifications (tenant_id, customer_id, type, title, body, reference)
      values (${ctx.tenantId}, ${customerId}, ${n.type}, ${n.title}, ${n.body}, ${n.reference})`.execute(this.db);
  }
}
