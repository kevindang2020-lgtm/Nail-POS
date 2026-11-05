// tenant-activity.kysely.repository.ts — Postgres adapter. Reads audit_logs (the existing audit trail) joined to
// tenants for the salon name/code. Guarded so a partial schema degrades to empty rather than throwing. No new table.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TenantActivityRepo } from './tenant-activity.repository';
import type { ActivityRaw } from './tenant-activity-core';

type R = Record<string, any>;

export class KyselyTenantActivityRepo implements TenantActivityRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async all(): Promise<ActivityRaw[]> {
    const rows = await sql<R>`
      select al.id, al.action_type, al.entity_type, al.entity_id, al.tenant_id,
             al.user_id as actor_user_id, al.role as actor_role, al.created_at,
             t.display_name as tenant_name, t.tenant_code as salon_code
      from audit_logs al
      left join tenants t on t.id = al.tenant_id
      order by al.created_at desc
      limit 2000`.execute(this.db).then((r) => r.rows).catch(() => []);
    return rows.map((r): ActivityRaw => ({
      id: String(r.id),
      actionType: String(r.action_type ?? 'event'),
      entityType: r.entity_type ?? null,
      entityId: r.entity_id ? String(r.entity_id) : null,
      tenantId: r.tenant_id ? String(r.tenant_id) : null,
      tenantName: r.tenant_name ?? null,
      salonCode: r.salon_code ?? null,
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      actorRole: r.actor_role ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
