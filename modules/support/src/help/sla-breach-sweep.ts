// sla-breach-sweep.ts — background job that flags first-response SLA breaches. It marks overdue, un-replied,
// non-terminal tickets with a one-time idempotent 'sla_breached' audit event (the read-time SLA badge already
// shows breaches live; this gives a durable, timestamped record for triage/reporting and a future notify hook).
// It does NOT notify or spend credits — notifications stay manual/triager-initiated by design. The scheduler that
// drives it (env-gated; off in dev/test/CI) lives in sla-breach-sweep.scheduler.ts so this stays dependency-light.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { computeSla } from './support-tickets.service';

export const SLA_BREACH_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function slaBreachSweepCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.SLA_BREACH_SWEEP_CRON || ''));
}

export const SLA_BREACH_DETAIL = 'first-response SLA breached';

/** Breach notifications are opt-in (separate from the sweep itself), default off. */
export function breachNotifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.SLA_BREACH_NOTIFY || ''));
}

/** Pure: the message sent to tenant owners/managers when a ticket breaches its first-response SLA. */
export function composeBreachNotice(ticketNumber: string, subject: string): { subject: string; body: string } {
  return {
    subject: `[${ticketNumber}] First-response SLA breached`,
    body: `Heads up — support ticket ${ticketNumber} ("${subject}") has not received a first response within its target time. Please review and respond in the Help Center.`,
  };
}

/** Delivery port — implemented in sla-breach-notifier.ts (which pulls in NotificationsService). Kept as an
 * interface here so the job + pure logic stay dependency-light and DB-free testable. */
export interface BreachNotifier {
  notify(args: { ticketId: string; tenantId: string; ticketNumber: string; subject: string }): Promise<void>;
}

/** Pure gate the sweep applies per candidate before flagging — reuses the same read-time SLA state, so the
 * background flag can never disagree with the badge the UI shows. */
export function shouldFlagBreach(args: { status: string; hasAgentReply: boolean; createdAt: string | null; targetMinutes: number | null; now: number }): boolean {
  if (args.hasAgentReply) return false;
  return computeSla({ createdAt: args.createdAt, targetMinutes: args.targetMinutes, firstAgentResponseAt: null, status: args.status, now: args.now }).state === 'breached';
}

export class SlaBreachSweepJob {
  constructor(private readonly db: Kysely<DB> | null, private readonly notifier: BreachNotifier | null = null) {}

  async sweep(nowIso: string = new Date().toISOString(), limit = 500): Promise<{ scanned: number; swept: number }> {
    if (!this.db) return { scanned: 0, swept: 0 };
    let scanned = 0, swept = 0;
    try {
      const res = await sql<any>`
        SELECT t.id, t.tenant_id, t.ticket_number, t.subject, t.status, t.created_at, t.response_target_minutes
        FROM support_tickets t
        WHERE t.status NOT IN ('resolved','closed','canceled')
          AND NOT EXISTS (SELECT 1 FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.author_kind = 'agent')
          AND NOT EXISTS (SELECT 1 FROM support_ticket_events e WHERE e.ticket_id = t.id AND e.kind = 'sla_breached')
          AND (t.created_at + (COALESCE(t.response_target_minutes, 480)::text || ' minutes')::interval) < ${nowIso}::timestamptz
        ORDER BY t.created_at ASC
        LIMIT ${limit}`.execute(this.db);
      const rows = (res as any).rows || [];
      const now = Date.parse(nowIso);
      for (const t of rows) {
        scanned++;
        const createdIso = t.created_at ? new Date(t.created_at).toISOString() : null;
        if (!shouldFlagBreach({ status: t.status, hasAgentReply: false, createdAt: createdIso, targetMinutes: t.response_target_minutes ?? null, now })) continue;
        try {
          await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                    VALUES (${t.id}, ${t.tenant_id}, 'sla_breached', ${SLA_BREACH_DETAIL}, ${null})`.execute(this.db);
          swept++;
          // One-time notify happens only here, right after the idempotent flag insert (so it fires once per ticket).
          if (this.notifier) { try { await this.notifier.notify({ ticketId: t.id, tenantId: t.tenant_id, ticketNumber: t.ticket_number, subject: t.subject }); } catch { /* notify is best-effort */ } }
        } catch { /* skip this ticket; never abort the whole sweep */ }
      }
      return { scanned, swept };
    } catch { return { scanned, swept }; }
  }
}
