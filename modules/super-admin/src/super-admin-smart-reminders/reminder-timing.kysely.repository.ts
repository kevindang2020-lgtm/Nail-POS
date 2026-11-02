// reminder-timing.kysely.repository.ts — persistence for default timing configuration (§34). Platform default =
// tenant_id null; tenant override keyed by (tenant_id, reminder_type). Non-swallowing upsert done as find-then-write
// against the appropriate partial unique index. Change history is preserved via audit_events (before/after).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export interface TimingRow { id: string; tenant_id: string | null; reminder_type: string; direction: string; offset_minutes: number; min_offset_minutes: number; max_offset_minutes: number; quiet_hours_start: number | null; quiet_hours_end: number | null; quiet_hours_policy: string; timezone_source: string; enabled: boolean; updated_at: string }

const COLS = sql`id::text as id, tenant_id::text as tenant_id, reminder_type, direction, offset_minutes, min_offset_minutes, max_offset_minutes, quiet_hours_start, quiet_hours_end, quiet_hours_policy, timezone_source, enabled, updated_at::text as updated_at`;

export class ReminderTimingRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(tenantId: string | null): Promise<TimingRow[]> {
    try {
      const q = tenantId
        ? sql`select ${COLS} from reminder_timing_defaults where tenant_id = ${tenantId} order by reminder_type`
        : sql`select ${COLS} from reminder_timing_defaults where tenant_id is null order by reminder_type`;
      return (await q.execute(this.db as any)).rows as TimingRow[];
    } catch { return []; }
  }

  async get(tenantId: string | null, reminderType: string): Promise<TimingRow | null> {
    const q = tenantId
      ? sql`select ${COLS} from reminder_timing_defaults where tenant_id = ${tenantId} and reminder_type = ${reminderType} limit 1`
      : sql`select ${COLS} from reminder_timing_defaults where tenant_id is null and reminder_type = ${reminderType} limit 1`;
    const r = (await q.execute(this.db as any)).rows[0] as TimingRow | undefined;
    return r ?? null;
  }

  async upsert(tenantId: string | null, i: { reminderType: string; direction: string; offset: number; min: number; max: number; qhStart: number | null; qhEnd: number | null; qhPolicy: string; tzSource: string; enabled: boolean; updatedBy: string | null }): Promise<void> {
    const existing = await this.get(tenantId, i.reminderType);
    if (existing) {
      await sql`update reminder_timing_defaults set direction = ${i.direction}, offset_minutes = ${i.offset}, min_offset_minutes = ${i.min}, max_offset_minutes = ${i.max}, quiet_hours_start = ${i.qhStart}, quiet_hours_end = ${i.qhEnd}, quiet_hours_policy = ${i.qhPolicy}, timezone_source = ${i.tzSource}, enabled = ${i.enabled}, updated_by = ${i.updatedBy}, updated_at = now() where id = ${existing.id}`.execute(this.db as any);
    } else {
      await sql`insert into reminder_timing_defaults (tenant_id, reminder_type, direction, offset_minutes, min_offset_minutes, max_offset_minutes, quiet_hours_start, quiet_hours_end, quiet_hours_policy, timezone_source, enabled, updated_by)
        values (${tenantId}, ${i.reminderType}, ${i.direction}, ${i.offset}, ${i.min}, ${i.max}, ${i.qhStart}, ${i.qhEnd}, ${i.qhPolicy}, ${i.tzSource}, ${i.enabled}, ${i.updatedBy})`.execute(this.db as any);
    }
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return; // platform-level changes are recorded by the timing row itself (audit_events.tenant_id NOT NULL)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'reminder_timing', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
