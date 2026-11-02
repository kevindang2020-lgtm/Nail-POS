// reminder-overrides.kysely.repository.ts — persistence for tenant reminder customizations (§42). Overrides live in
// their own table, keyed by (tenant_id, reminder_type); reverting deletes the row. Non-swallowing writes.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export interface OverrideRow { id: string; tenant_id: string; reminder_type: string; enabled: boolean; direction: string | null; offset_minutes: number | null; channels: string[] | null; quiet_hours_policy: string | null; approval_state: string; updated_at: string }

const COLS = sql`id::text as id, tenant_id::text as tenant_id, reminder_type, enabled, direction, offset_minutes, channels, quiet_hours_policy, approval_state, updated_at::text as updated_at`;

export class ReminderOverridesRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(tenantId: string): Promise<OverrideRow[]> {
    try { return (await sql`select ${COLS} from reminder_tenant_overrides where tenant_id = ${tenantId} order by reminder_type`.execute(this.db as any)).rows as OverrideRow[]; } catch { return []; }
  }

  async get(tenantId: string, reminderType: string): Promise<OverrideRow | null> {
    const r = (await sql`select ${COLS} from reminder_tenant_overrides where tenant_id = ${tenantId} and reminder_type = ${reminderType} limit 1`.execute(this.db as any)).rows[0] as OverrideRow | undefined;
    return r ?? null;
  }

  async upsert(tenantId: string, i: { reminderType: string; enabled: boolean; direction: string | null; offset: number | null; channels: string[] | null; quietPolicy: string | null; approvalState: string; updatedBy: string | null }): Promise<void> {
    await sql`insert into reminder_tenant_overrides (tenant_id, reminder_type, enabled, direction, offset_minutes, channels, quiet_hours_policy, approval_state, updated_by, updated_at)
      values (${tenantId}, ${i.reminderType}, ${i.enabled}, ${i.direction}, ${i.offset}, ${i.channels}, ${i.quietPolicy}, ${i.approvalState}, ${i.updatedBy}, now())
      on conflict (tenant_id, reminder_type) do update set
        enabled = excluded.enabled, direction = excluded.direction, offset_minutes = excluded.offset_minutes,
        channels = excluded.channels, quiet_hours_policy = excluded.quiet_hours_policy, approval_state = excluded.approval_state,
        updated_by = excluded.updated_by, updated_at = now()`.execute(this.db as any);
  }

  async remove(tenantId: string, reminderType: string): Promise<number> {
    const r = (await sql`delete from reminder_tenant_overrides where tenant_id = ${tenantId} and reminder_type = ${reminderType}`.execute(this.db as any)) as any;
    return Number(r?.numAffectedRows ?? r?.numDeletedRows ?? 0);
  }

  async writeAudit(tenantId: string, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'reminder_tenant_override', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
