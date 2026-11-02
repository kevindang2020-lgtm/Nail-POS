// communications-announcements.kysely.repository.ts — persistence for Send Platform Announcement (§24). Non-swallowing
// on the write path (genuine DB errors propagate). Recipient estimate is REAL: it counts active tenant users in the
// targeted scope holding the requested roles, and can NEVER include customers (the caller validates roles; this query
// also hard-excludes CUSTOMER as defence in depth).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export class CommunicationsAnnouncementsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Count active tenant users matching the requested roles within the target scope. Customers are always excluded. */
  async recipientEstimate(roles: string[], scope: 'all_tenants' | 'selected', tenantIds: string[]): Promise<number> {
    const r = (await sql`
      select count(*)::int as c from users
      where role = any(${roles}) and role <> 'CUSTOMER' and (status is null or status <> 'disabled')
        ${scope === 'selected' ? sql`and tenant_id = any(${tenantIds}::uuid[])` : sql``}`.execute(this.db as any)).rows[0] as { c: number };
    return r?.c ?? 0;
  }

  async tenantsExist(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const r = (await sql`select count(*)::int as c from tenants where id = any(${ids}::uuid[])`.execute(this.db as any)).rows[0] as { c: number };
    return r?.c ?? 0;
  }

  async findByIdempotency(key: string): Promise<{ id: string; recipient_estimate: number; status: string } | null> {
    const r = (await sql`select id::text as id, recipient_estimate, status from platform_announcements where idempotency_key = ${key} limit 1`.execute(this.db as any)).rows[0] as { id: string; recipient_estimate: number; status: string } | undefined;
    return r ?? null;
  }

  async insertAnnouncement(i: { title: string; subject: string | null; body: string; channel: string; priority: string; recipientRoles: string[]; targetScope: string; targetTenantIds: string[]; status: string; scheduledAt: string | null; recipientEstimate: number; idempotencyKey: string | null; createdBy: string | null }): Promise<{ id: string }> {
    const r = (await sql`
      insert into platform_announcements
        (title, subject, body, channel, priority, recipient_roles, target_scope, target_tenant_ids, status, scheduled_at, recipient_estimate, idempotency_key, created_by)
      values (${i.title}, ${i.subject}, ${i.body}, ${i.channel}, ${i.priority}, ${i.recipientRoles}, ${i.targetScope}, ${i.targetTenantIds}::uuid[], ${i.status}, ${i.scheduledAt}, ${i.recipientEstimate}, ${i.idempotencyKey}, ${i.createdBy})
      returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
    return r;
  }

  async recent(limit = 8): Promise<{ id: string; title: string; channel: string; status: string; recipient_estimate: number; created_at: string }[]> {
    try {
      return (await sql`select id::text as id, title, channel, status, recipient_estimate, created_at::text as created_at from platform_announcements order by created_at desc limit ${limit}`.execute(this.db as any)).rows as any[];
    } catch { return []; }
  }

  /** Per-tenant audit for a targeted announcement (tenant_id is NOT NULL in audit_events). */
  async writeAuditForTenant(tenantId: string, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'communications', ${action}, 'platform_announcement', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
