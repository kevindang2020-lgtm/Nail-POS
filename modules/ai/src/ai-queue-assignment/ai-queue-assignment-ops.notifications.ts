// ai-queue-assignment-ops.notifications.ts — BUILD_PLAN Phase 6: who hears about a queue alert, and how.
//
//   • Realtime (every alert change): the branch's boards, on the platform bus (identifiers only).
//   • A HIGH or CRITICAL alert (raised, or escalated into that band): one owner alert (owner_alerts — the Owner app's
//     alert feed) + a push to the branch's managers through the platform push service. Once per alert per severity
//     (queue_alerts.notified_severity, migration 527) — never every minute the scan still sees the same long wait.
//     The text is built from the alert type and minutes only: NEVER a guest's name or phone (it lands on lock screens).
import { sql, type Kysely } from 'kysely';
import type { PushService } from '@aipowersalon/communications';
import { SEVERITY_RANK, type AlertSeverity } from './ai-queue-assignment-detection';
import type { AlertRecord } from './ai-queue-assignment-alerts.repository';
import type { AssignmentEmitterPort } from './ai-queue-assignment.ports';

export type OpsRealtimeEvent = 'alert_raised' | 'alert_acknowledged' | 'alert_resolved' | 'record_repaired' | 'settings_changed' | 'auto_killed';
/** The ops names → the AI layer's ONE emitter's names (ai-queue-assignment.adapters.ts maps those onto the registry). */
const ASSIGNMENT_NAME: Record<OpsRealtimeEvent, string> = {
  alert_raised: 'queue.alert_raised', alert_acknowledged: 'queue.alert_acknowledged', alert_resolved: 'queue.alert_resolved',
  record_repaired: 'queue.record_repaired', settings_changed: 'queue.assignment_settings_changed', auto_killed: 'queue.auto_assignment_killed',
};
export interface OpsEmitterPort { emit(scope: { tenantId: string; branchId: string | null }, event: OpsRealtimeEvent, payload: Record<string, unknown>): void }
/** §343: no second direct-emission site. A branch-scoped change goes through the AI layer's existing emitter; a
 *  salon-wide change (no branch: the tenant kill switch, salon-level settings) is NOT pushed from here — its domain event
 *  (QUEUE_AUTO_ASSIGNMENT_DISABLED / QUEUE_ASSIGNMENT_SETTINGS_CHANGED, written in the same transaction) reaches the
 *  owner's room through the realtime projection. */
export class RealtimeOpsEmitter implements OpsEmitterPort {
  constructor(private readonly inner?: AssignmentEmitterPort | null) {}
  emit(scope: { tenantId: string; branchId: string | null }, event: OpsRealtimeEvent, payload: Record<string, unknown>): void {
    if (!scope.branchId) return;
    try { this.inner?.emit({ tenantId: scope.tenantId, branchId: scope.branchId } as any, ASSIGNMENT_NAME[event], payload); }
    catch { /* realtime is best-effort; the outbox event is the durable record */ }
  }
}
export class RecordingOpsEmitter implements OpsEmitterPort {
  events: { scope: { tenantId: string; branchId: string | null }; event: OpsRealtimeEvent; payload: Record<string, unknown> }[] = [];
  emit(scope: { tenantId: string; branchId: string | null }, event: OpsRealtimeEvent, payload: Record<string, unknown>) { this.events.push({ scope, event, payload }); }
}

export const NOTIFY_FROM: AlertSeverity = 'high';
/** Should this alert (now at `alert.severity`) notify? Only into high/critical, and only past what was already sent. */
export function needsNotification(a: Pick<AlertRecord, 'severity' | 'notifiedSeverity' | 'status'>): boolean {
  if (a.status === 'resolved') return false;
  if (SEVERITY_RANK[a.severity] < SEVERITY_RANK[NOTIFY_FROM]) return false;
  return !a.notifiedSeverity || SEVERITY_RANK[a.severity] > SEVERITY_RANK[a.notifiedSeverity];
}

const TYPE_LABEL: Record<string, string> = {
  waiting_too_long: 'Long wait', unassigned: 'Guest without a technician', congestion: 'Queue backed up', stuck_record: 'Stuck queue record',
  late_appointment: 'Late appointment', long_service: 'Service running long', overloaded_technician: 'Technician overloaded',
};
/** The words of the notification — type label + the alert's own plain-words reason (built by the detection core from
 *  minutes and counts only) + the location name. Exported for the test that proves no guest data gets in. */
export function notificationText(a: Pick<AlertRecord, 'type' | 'severity' | 'reason'>, branchName: string | null): { title: string; body: string } {
  const label = TYPE_LABEL[a.type] ?? 'Queue alert';
  return { title: `${a.severity === 'critical' ? 'Critical: ' : ''}${label}${branchName ? ` — ${branchName}` : ''}`.slice(0, 64), body: a.reason.slice(0, 178) };
}

export interface QueueAlertNotifierPort { notify(alert: AlertRecord): Promise<{ ownerAlert: boolean; pushed: number }> }

export class KyselyQueueAlertNotifier implements QueueAlertNotifierPort {
  constructor(private readonly db: Kysely<any>, private readonly push: Pick<PushService, 'dispatchToUser'> | null = null) {}
  async notify(a: AlertRecord): Promise<{ ownerAlert: boolean; pushed: number }> {
    const b = ((await sql`select name from branches where id = ${a.branchId} and tenant_id = ${a.tenantId}`.execute(this.db).catch(() => ({ rows: [] }))).rows as any[])[0];
    const { title, body } = notificationText(a, b?.name ?? null);
    let ownerAlert = false;
    try {
      await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
                values (${a.tenantId}, ${a.branchId}, 'queue_alert', ${a.severity}, 'new', ${title}, ${body},
                        ${JSON.stringify({ alertId: a.id, type: a.type, queueEntryId: a.queueEntryId })}::jsonb, 'all')`.execute(this.db);
      ownerAlert = true;
    } catch { /* an alert never blocks the scan that found it */ }
    let pushed = 0;
    if (this.push) {
      const managers = ((await sql`select id from users where tenant_id = ${a.tenantId} and role = 'MANAGER' and status = 'active'
                                     and (branch_id = ${a.branchId} or branch_id is null)`.execute(this.db).catch(() => ({ rows: [] }))).rows as any[]);
      for (const m of managers) {
        const r = await this.push.dispatchToUser(a.tenantId, String(m.id), { title, body, reference: 'queue_alert', category: 'QUEUE_CONGESTION', data: { kind: 'queue_alert', alertId: a.id, branchId: a.branchId, type: a.type } }).catch(() => null);
        if (r && r.sent > 0) pushed++;
      }
    }
    return { ownerAlert, pushed };
  }
}
export class RecordingAlertNotifier implements QueueAlertNotifierPort {
  sent: AlertRecord[] = [];
  async notify(a: AlertRecord) { this.sent.push({ ...a }); return { ownerAlert: true, pushed: 0 }; }
}
