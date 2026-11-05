// reminder-flow-state.kysely.repository.ts — persistence for reminder flow operational status (§43). Platform flow =
// tenant_id null; tenant flow keyed by (tenant_id, reminder_type). Non-swallowing find-then-write upsert against the
// appropriate partial unique index. This gate never deletes any delivery history.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { REMINDER_FLOW_STATE } from '../lifecycles';

export interface FlowStateRow { id: string; tenant_id: string | null; reminder_type: string; status: string; reason: string | null; disabled_at: string | null; updated_at: string }
const COLS = sql`id::text as id, tenant_id::text as tenant_id, reminder_type, status, reason, disabled_at::text as disabled_at, updated_at::text as updated_at`;

export class ReminderFlowStateRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(tenantId: string | null): Promise<FlowStateRow[]> {
    try {
      const q = tenantId
        ? sql`select ${COLS} from reminder_flow_state where tenant_id = ${tenantId} order by reminder_type`
        : sql`select ${COLS} from reminder_flow_state where tenant_id is null order by reminder_type`;
      return (await q.execute(this.db as any)).rows as FlowStateRow[];
    } catch { return []; }
  }

  async get(tenantId: string | null, reminderType: string): Promise<FlowStateRow | null> {
    const q = tenantId
      ? sql`select ${COLS} from reminder_flow_state where tenant_id = ${tenantId} and reminder_type = ${reminderType} limit 1`
      : sql`select ${COLS} from reminder_flow_state where tenant_id is null and reminder_type = ${reminderType} limit 1`;
    const r = (await q.execute(this.db as any)).rows[0] as FlowStateRow | undefined;
    return r ?? null;
  }

  async upsert(tenantId: string | null, i: { reminderType: string; status: string; reason: string | null; disabling: boolean; actorId: string | null }): Promise<void> {
    const existing = await this.get(tenantId, i.reminderType);
    if (existing) {
      await sql`update reminder_flow_state set status = ${i.status}, reason = ${i.reason},
        disabled_by = ${i.disabling ? i.actorId : null}, disabled_at = ${i.disabling ? sql`now()` : null},
        updated_by = ${i.actorId}, updated_at = now() where id = ${existing.id} and ${canMoveToSql(REMINDER_FLOW_STATE, i.status)}`.execute(this.db as any);
    } else {
      await sql`insert into reminder_flow_state (tenant_id, reminder_type, status, reason, disabled_by, disabled_at, updated_by)
        values (${tenantId}, ${i.reminderType}, ${i.status}, ${i.reason}, ${i.disabling ? i.actorId : null}, ${i.disabling ? sql`now()` : null}, ${i.actorId})`.execute(this.db as any);
    }
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, severity: string, metadata: unknown) {
    if (!tenantId) return; // platform-level changes recorded by the flow-state row itself (audit_events.tenant_id NOT NULL)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'reminder_flow', ${summary}, 'ok', ${severity}, ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
