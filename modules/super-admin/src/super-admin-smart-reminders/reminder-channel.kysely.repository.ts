// reminder-channel.kysely.repository.ts — persistence for channel + fallback config (§35, §36). Platform default =
// tenant_id null; tenant override keyed by (tenant_id, reminder_type). Non-swallowing find-then-write upsert.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export interface ChannelConfigRow { id: string; tenant_id: string | null; reminder_type: string; primary_channel: string; fallback_channels: string[]; fallback_on: string; max_fallback_attempts: number; stop_on_success: boolean; recheck_suppression: boolean; recheck_quiet_hours: boolean; updated_at: string }
const COLS = sql`id::text as id, tenant_id::text as tenant_id, reminder_type, primary_channel, fallback_channels, fallback_on, max_fallback_attempts, stop_on_success, recheck_suppression, recheck_quiet_hours, updated_at::text as updated_at`;

export class ReminderChannelRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(tenantId: string | null): Promise<ChannelConfigRow[]> {
    try {
      const q = tenantId
        ? sql`select ${COLS} from reminder_channel_config where tenant_id = ${tenantId} order by reminder_type`
        : sql`select ${COLS} from reminder_channel_config where tenant_id is null order by reminder_type`;
      return (await q.execute(this.db as any)).rows as ChannelConfigRow[];
    } catch { return []; }
  }

  async get(tenantId: string | null, reminderType: string): Promise<ChannelConfigRow | null> {
    const q = tenantId
      ? sql`select ${COLS} from reminder_channel_config where tenant_id = ${tenantId} and reminder_type = ${reminderType} limit 1`
      : sql`select ${COLS} from reminder_channel_config where tenant_id is null and reminder_type = ${reminderType} limit 1`;
    const r = (await q.execute(this.db as any)).rows[0] as ChannelConfigRow | undefined;
    return r ?? null;
  }

  async upsert(tenantId: string | null, i: { reminderType: string; primary: string; fallbacks: string[]; fallbackOn: string; maxFallback: number; stopOnSuccess: boolean; recheckSuppression: boolean; recheckQuietHours: boolean; updatedBy: string | null }): Promise<void> {
    const existing = await this.get(tenantId, i.reminderType);
    if (existing) {
      await sql`update reminder_channel_config set primary_channel = ${i.primary}, fallback_channels = ${i.fallbacks}, fallback_on = ${i.fallbackOn}, max_fallback_attempts = ${i.maxFallback}, stop_on_success = ${i.stopOnSuccess}, recheck_suppression = ${i.recheckSuppression}, recheck_quiet_hours = ${i.recheckQuietHours}, updated_by = ${i.updatedBy}, updated_at = now() where id = ${existing.id}`.execute(this.db as any);
    } else {
      await sql`insert into reminder_channel_config (tenant_id, reminder_type, primary_channel, fallback_channels, fallback_on, max_fallback_attempts, stop_on_success, recheck_suppression, recheck_quiet_hours, updated_by)
        values (${tenantId}, ${i.reminderType}, ${i.primary}, ${i.fallbacks}, ${i.fallbackOn}, ${i.maxFallback}, ${i.stopOnSuccess}, ${i.recheckSuppression}, ${i.recheckQuietHours}, ${i.updatedBy})`.execute(this.db as any);
    }
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'reminder_channel_config', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
