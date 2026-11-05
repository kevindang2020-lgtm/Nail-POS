// membership-comms.kysely.repository.ts — Postgres adapter. In-app delivery writes customer_notifications (tenant + customer
// scoped, with a reference for idempotency). The due-reminder read covers active/trial auto-renewing memberships whose
// next billing falls within the window.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MembershipCommsRepositoryPort, CommsContext, MemberCommInfo, DueMember, NotificationInsert } from './membership-comms.repository';

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

export class KyselyMembershipCommsRepository implements MembershipCommsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

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
    const r = await sql<{ id: string; customer_id: string; full_name: string | null; plan_name: string | null; next_billing_at: unknown }>`
      select cm.id, cm.customer_id, c.full_name, p.name as plan_name, cm.next_billing_at
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.tenant_id = ${ctx.tenantId}
        and cm.status in ('active', 'trial') and cm.auto_renew = true
        and cm.next_billing_at is not null
        and cm.next_billing_at >= now()
        and cm.next_billing_at <= now() + make_interval(days => ${withinDays})
      order by cm.next_billing_at asc`.execute(this.db);
    return r.rows.map((x) => ({ membershipId: x.id, customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.next_billing_at) }));
  }

  async membersDueForReminderAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>> {
    // Cross-tenant system/scheduler read (mirrors billing findDue): it selects cm.tenant_id so the caller scopes every
    // write per-tenant. Safe-by-design and recognized by the isolation guard because the statement carries tenant_id.
    const r = await sql<{ tenant_id: string; id: string; customer_id: string; full_name: string | null; plan_name: string | null; next_billing_at: unknown }>`
      select cm.tenant_id, cm.id, cm.customer_id, c.full_name, p.name as plan_name, cm.next_billing_at
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.status in ('active', 'trial') and cm.auto_renew = true
        and cm.next_billing_at is not null
        and cm.next_billing_at >= ${now}
        and cm.next_billing_at <= ${now} + make_interval(days => ${withinDays})
      order by cm.next_billing_at asc limit ${limit}`.execute(this.db);
    return r.rows.map((x) => ({ tenantId: x.tenant_id, membershipId: x.id, customerId: x.customer_id, customerName: x.full_name, planName: x.plan_name, nextBillingAt: iso(x.next_billing_at) }));
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
