// business-alert-incidents.ts — A2 AI Business Alerts guide, the parts the Nov 3 build listed as "not built" (Nov 6 2026;
// migration 826): incidents, notifications, escalation, delivery log, per-rule severity / recipients / quiet hours / cooldown.
//
//   • INCIDENTS — every TRIGGERED evaluation opens an incident: open → investigating → resolved, or snoozed until a time
//     (it wakes up as open). Assign to a staff member of this salon, notes, reopen. Each change is an optimistic-versioned
//     update (a stale screen gets 409) and leaves a line in the incident log.
//   • NOTIFICATIONS — on a trigger, per the rule's channels: in_app always lands in the Owner app Alerts inbox
//     (owner_alerts); email / SMS go to the rule's recipients (default: the salon's active owners and managers) through the
//     salon's own messenger. Cooldown: a rule that re-triggers within its cooldown is recorded, not re-sent. Quiet hours (the
//     salon's local time): email / SMS are SKIPPED with that reason, in-app still lands. Every attempt is a delivery row —
//     sent, skipped (why) or failed (why); nothing is reported as sent that the messenger did not take.
//   • ESCALATION — a CRITICAL incident still open (not acknowledged, assigned-and-investigating, snoozed or resolved) 30
//     minutes after it opened is sent once more to the salon's owners (kind 'escalation'), outside quiet hours.
// Nothing here changes a sale, an appointment, a price or a schedule.
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { assertTransition, branchTimeZone, canMoveToSql, defineStateMachine } from '@aipowersalon/database';
import { localHour } from '@aipowersalon/date-time';
import type { AiBusinessContext } from './ai-business.dto';

type Row = Record<string, any>;
export const BUSINESS_ALERT_INCIDENTS = 'BusinessAlertIncidents';
export class AlertIncidentError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); } }
export const INCIDENT_ACTIONS = ['acknowledge', 'investigate', 'resolve', 'snooze', 'reopen', 'assign'] as const;
/** A2 incident lifecycle (migration 826): ONE transition table for ai_business_alert_events.incident_status. An event
 *  becomes an incident when it triggers (NULL → 'open', the initial state — like an insert). Acknowledge / investigate,
 *  snooze and resolve are allowed from any live state (a second acknowledge or snooze refreshes it); only a resolved or
 *  snoozed incident reopens; the snooze sweep wakes snoozed → open. */
export const AI_BUSINESS_INCIDENT_LIFECYCLE = defineStateMachine({
  name: 'ai_business_incident', table: 'ai_business_alert_events', column: 'incident_status',
  states: ['open', 'investigating', 'snoozed', 'resolved'],
  transitions: {
    open: ['investigating', 'snoozed', 'resolved'],
    investigating: ['investigating', 'snoozed', 'resolved'],
    snoozed: ['open', 'investigating', 'snoozed', 'resolved'],
    resolved: ['open'],
  },
  initial: ['open'],
});

export const INCIDENT_STATUSES = ['all', 'open', 'investigating', 'snoozed', 'resolved', 'active'] as const;
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export const ALERT_CHANNELS = ['in_app', 'email', 'sms'] as const;
export const ESCALATE_AFTER_MINUTES = 30;
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const has = (ctx: AiBusinessContext, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);

/** The salon's one send path (packages/notifications TenantMessenger), declared narrowly. */
export interface AlertMessenger {
  sendSms(req: { tenantId: string | null; branchId?: string | null; to: string; body: string; purpose: 'notification' }): Promise<{ sent: boolean; status: string; reason?: string; notificationId?: string; providerId?: string }>;
  sendEmail?(req: { tenantId: string; branchId?: string | null; to: string; subject: string; body: string; purpose: 'notification'; idempotencyKey?: string | null }): Promise<{ sent: boolean; status: string; reason?: string; notificationId?: string; providerId?: string }>;
}

/** Salon-local hour inside [start, end)? start == end → no quiet window. */
export function inQuiet(now: Date, start: number, end: number, tz: string): boolean {
  if (start === end) return false;
  const h = localHour(now, tz);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

const METRIC_LABEL: Record<string, string> = { net_sales: 'Net sales', average_ticket: 'Average ticket', completed_appointments: 'Completed appointments', cancellation_rate: 'Cancellation rate', no_show_rate: 'No-show rate', customer_retention: 'Customer retention' };
const MONEY = new Set(['net_sales', 'average_ticket']);
const RATE = new Set(['cancellation_rate', 'no_show_rate', 'customer_retention']);
export function formatAlertValue(metric: string, v: unknown): string {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return '—';
  if (MONEY.has(metric)) return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (RATE.has(metric)) return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  return n.toLocaleString('en-US');
}
export function alertMessage(r: { title: string; metric_id: string; operator: string; threshold: unknown; value: unknown; severity: string; escalation?: boolean }): { subject: string; body: string } {
  const what = `${METRIC_LABEL[r.metric_id] ?? r.metric_id} is ${formatAlertValue(r.metric_id, r.value)} (${r.operator === 'lt' ? 'below' : 'above'} ${formatAlertValue(r.metric_id, r.threshold)})`;
  const tag = r.severity === 'critical' ? '[Critical] ' : r.severity === 'info' ? '' : '[Warning] ';
  const pre = r.escalation ? 'Still open after 30 minutes — ' : '';
  return { subject: `${tag}${r.escalation ? 'Still open: ' : ''}${r.title}`, body: `${pre}${r.title}: ${what}. Open AI Business → Alerts to review.` };
}

export class BusinessAlertIncidents {
  constructor(private readonly db: Kysely<any>, private readonly messenger: AlertMessenger | null = null, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: AiBusinessContext) {
    if (!ctx?.tenantId || !ctx?.userId) throw new AlertIncidentError('Not signed in.', 'AUTH_REQUIRED', 401);
    if (!has(ctx, 'pos.ai_business.view')) throw new AlertIncidentError('Your role cannot use AI Business.', 'PERMISSION_DENIED', 403);
  }
  private scope(ctx: AiBusinessContext, alias: 'a' | 'e') {
    const B = isUuid(ctx.branchId) ? String(ctx.branchId) : null;
    if (!B) return sql`true`;
    return alias === 'a' ? sql`a.branch_id = ${B}::uuid` : sql`e.branch_id = ${B}::uuid`;
  }
  private async log(tenantId: string, eventId: string, kind: string, body: string, author: string | null, trx: Kysely<any> = this.db) {
    await sql`insert into ai_business_alert_incident_notes (tenant_id, event_id, kind, body, author_user_id) values (${tenantId}, ${eventId}::uuid, ${kind}, ${body.slice(0, 1000)}, ${isUuid(author) ? author : null})`.execute(trx);
  }

  // ── rule delivery settings ─────────────────────────────────────────────────────────────────────────────────────
  async setDelivery(ctx: AiBusinessContext, alertId: string, b: Row) {
    this.need(ctx);
    if (!isUuid(alertId)) throw new AlertIncidentError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const sev = b.severity == null ? null : String(b.severity);
    if (sev != null && !(ALERT_SEVERITIES as readonly string[]).includes(sev)) throw new AlertIncidentError('Severity must be info, warning or critical.', 'VALIDATION_FAILED');
    let channels: string[] | null = null;
    if (b.channels != null) {
      if (!Array.isArray(b.channels) || !b.channels.length || b.channels.some((c: unknown) => !(ALERT_CHANNELS as readonly string[]).includes(String(c)))) throw new AlertIncidentError('Choose at least one of: in-app, email, SMS.', 'VALIDATION_FAILED');
      channels = [...new Set(b.channels.map(String))];
    }
    const hour = (v: unknown, f: string) => { if (v == null) return null; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 23) throw new AlertIncidentError(`${f} must be an hour from 0 to 23.`, 'VALIDATION_FAILED'); return n; };
    const qs = hour(b.quietHoursStart, 'Quiet hours start'), qe = hour(b.quietHoursEnd, 'Quiet hours end');
    let cooldown: number | null = null;
    if (b.cooldownMinutes != null) { cooldown = Number(b.cooldownMinutes); if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 10080) throw new AlertIncidentError('Cooldown must be 0 to 10080 minutes.', 'VALIDATION_FAILED'); }
    let recipients: string[] | null = null;
    if (b.recipientUserIds != null) {
      if (!Array.isArray(b.recipientUserIds) || b.recipientUserIds.length > 20 || b.recipientUserIds.some((x: unknown) => !isUuid(x))) throw new AlertIncidentError('Recipients must be up to 20 staff accounts.', 'VALIDATION_FAILED');
      recipients = [...new Set(b.recipientUserIds.map(String))];
      if (recipients.length) {
        const ok = (await sql<Row>`select count(*)::int as n from users where tenant_id = ${ctx.tenantId} and id = any(${recipients}::uuid[]) and coalesce(status, 'active') = 'active'`.execute(this.db)).rows[0];
        if (Number(ok?.n) !== recipients.length) throw new AlertIncidentError('A recipient is not an active staff account of this salon.', 'VALIDATION_FAILED');
      }
    }
    const r = (await sql<Row>`update ai_business_alerts a set
        severity = coalesce(${sev}, a.severity), channels = coalesce(${channels}::text[], a.channels),
        recipient_user_ids = coalesce(${recipients}::uuid[], a.recipient_user_ids),
        quiet_hours_start = coalesce(${qs}::smallint, a.quiet_hours_start), quiet_hours_end = coalesce(${qe}::smallint, a.quiet_hours_end),
        cooldown_minutes = coalesce(${cooldown}::int, a.cooldown_minutes)
      where a.tenant_id = ${ctx.tenantId} and a.id = ${alertId}::uuid and a.archived_at is null and ${this.scope(ctx, 'a')}
      returning a.id, a.severity, a.channels, a.recipient_user_ids, a.quiet_hours_start, a.quiet_hours_end, a.cooldown_minutes`.execute(this.db)).rows[0];
    if (!r) throw new AlertIncidentError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    return this.deliveryView(r);
  }
  private deliveryView(r: Row) {
    return { alertId: String(r.id), severity: r.severity, channels: r.channels ?? ['in_app'], recipientUserIds: (r.recipient_user_ids ?? []).map(String),
      quietHoursStart: Number(r.quiet_hours_start), quietHoursEnd: Number(r.quiet_hours_end), cooldownMinutes: Number(r.cooldown_minutes) };
  }
  async delivery(ctx: AiBusinessContext, alertId: string) {
    this.need(ctx);
    if (!isUuid(alertId)) throw new AlertIncidentError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const r = (await sql<Row>`select a.id, a.severity, a.channels, a.recipient_user_ids, a.quiet_hours_start, a.quiet_hours_end, a.cooldown_minutes from ai_business_alerts a
      where a.tenant_id = ${ctx.tenantId} and a.id = ${alertId}::uuid and ${this.scope(ctx, 'a')}`.execute(this.db)).rows[0];
    if (!r) throw new AlertIncidentError('Alert not found.', 'BC_ALERT_NOT_FOUND', 404);
    const staff = (await sql<Row>`select u.id, u.full_name, u.role, u.email is not null as has_email, u.normalized_phone is not null as has_phone from users u
      where u.tenant_id = ${ctx.tenantId} and coalesce(u.status, 'active') = 'active' and u.role in ('OWNER', 'MANAGER', 'TENANT_ADMIN') order by u.full_name limit 200`.execute(this.db)).rows;
    return { ...this.deliveryView(r), staff: staff.map((s) => ({ userId: String(s.id), name: s.full_name, role: s.role, hasEmail: !!s.has_email, hasPhone: !!s.has_phone })) };
  }

  // ── notify on a trigger ────────────────────────────────────────────────────────────────────────────────────────
  /** Called once for each event whose state changed to 'triggered'. Opens the incident and sends per the rule. */
  async onTriggered(tenantId: string, eventId: string, kind: 'trigger' | 'escalation' = 'trigger') {
    const e = (await sql<Row>`select e.id, e.alert_id, e.branch_id, e.value, e.threshold, e.metric_id, e.operator, e.evaluated_at,
        a.title, a.severity, coalesce(a.channels, array[a.channel]) as channels, a.recipient_user_ids, a.quiet_hours_start, a.quiet_hours_end, a.cooldown_minutes
      from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id and a.tenant_id = e.tenant_id
      where e.tenant_id = ${tenantId} and e.id = ${eventId}::uuid`.execute(this.db)).rows[0];
    if (!e) return [];
    // the incident's initial state ('open') is written with the triggered event row itself (business-center.ts evaluate)
    const now = new Date(this.now());
    const out: { channel: string; status: string; reason?: string | null; recipient?: string | null }[] = [];
    const record = async (channel: string, status: 'sent' | 'skipped' | 'failed', reason: string | null, userId: string | null = null, recipient: string | null = null, ref: string | null = null) => {
      await sql`insert into ai_business_alert_deliveries (tenant_id, event_id, alert_id, channel, recipient_user_id, recipient, kind, status, reason, provider_ref)
        values (${tenantId}, ${eventId}::uuid, ${e.alert_id}, ${channel}, ${userId}, ${recipient}, ${kind}, ${status}, ${reason}, ${ref})`.execute(this.db);
      out.push({ channel, status, reason, recipient });
    };
    // cooldown: a recent SENT trigger delivery for this rule (other event) → record, do not re-send
    if (kind === 'trigger' && Number(e.cooldown_minutes) > 0) {
      const recent = (await sql<Row>`select 1 from ai_business_alert_deliveries d where d.tenant_id = ${tenantId} and d.alert_id = ${e.alert_id} and d.event_id <> ${eventId}::uuid
        and d.kind = 'trigger' and d.status = 'sent' and d.created_at > ${new Date(now.getTime() - Number(e.cooldown_minutes) * 60_000)} limit 1`.execute(this.db)).rows[0];
      if (recent) { for (const c of e.channels as string[]) await record(c, 'skipped', 'cooldown'); await this.log(tenantId, eventId, 'notify', `Not sent: the rule triggered within its ${e.cooldown_minutes}-minute cooldown.`, null); return out; }
    }
    const msg = alertMessage({ title: String(e.title), metric_id: String(e.metric_id), operator: String(e.operator), threshold: e.threshold, value: e.value, severity: String(e.severity), escalation: kind === 'escalation' });
    const channels: string[] = kind === 'escalation' ? [...new Set(['in_app', ...(e.channels as string[]).filter((c) => c !== 'in_app')])] : (e.channels as string[]);
    if (channels.includes('in_app')) {
      const sev = e.severity === 'critical' ? 'critical' : e.severity === 'info' ? 'info' : 'warning';
      const oa = (await sql<Row>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
        values (${tenantId}, ${e.branch_id ?? null}, 'ai_business_alert', ${sev}, 'new', ${msg.subject}, ${msg.body}, ${JSON.stringify({ eventId, alertId: String(e.alert_id), kind })}::jsonb) returning id`.execute(this.db)).rows[0];
      await record('in_app', 'sent', null, null, null, String(oa.id));
    }
    const wantEmail = channels.includes('email'), wantSms = channels.includes('sms');
    if (wantEmail || wantSms) {
      const tz = await branchTimeZone(this.db, tenantId, e.branch_id ? String(e.branch_id) : null);
      const quiet = inQuiet(now, Number(e.quiet_hours_start), Number(e.quiet_hours_end), tz);
      const ids: string[] = (e.recipient_user_ids ?? []).map(String);
      const people = (await sql<Row>`select u.id, u.email, u.normalized_phone from users u where u.tenant_id = ${tenantId} and coalesce(u.status, 'active') = 'active'
        and ${ids.length && kind === 'trigger' ? sql`u.id = any(${ids}::uuid[])` : kind === 'escalation' ? sql`u.role in ('OWNER', 'TENANT_ADMIN')` : sql`u.role in ('OWNER', 'MANAGER', 'TENANT_ADMIN')`}
        order by u.id limit 20`.execute(this.db)).rows;
      for (const p of people) {
        for (const ch of (['email', 'sms'] as const).filter((c) => (c === 'email' ? wantEmail : wantSms))) {
          const to = ch === 'email' ? p.email : p.normalized_phone;
          if (!to) { await record(ch, 'skipped', ch === 'email' ? 'no_email' : 'no_phone', String(p.id)); continue; }
          if (quiet) { await record(ch, 'skipped', 'quiet_hours', String(p.id), to); continue; }
          if (!this.messenger || (ch === 'email' && !this.messenger.sendEmail)) { await record(ch, 'failed', 'messaging_not_available', String(p.id), to); continue; }
          try {
            const r = ch === 'email'
              ? await this.messenger.sendEmail!({ tenantId, branchId: e.branch_id ?? null, to, subject: msg.subject, body: msg.body, purpose: 'notification', idempotencyKey: `ai-alert:${eventId}:${kind}:${p.id}` })
              : await this.messenger.sendSms({ tenantId, branchId: e.branch_id ?? null, to, body: msg.body, purpose: 'notification' });
            if (r.sent) await record(ch, 'sent', null, String(p.id), to, r.notificationId ?? r.providerId ?? null);
            else await record(ch, 'failed', `${r.status}${r.reason ? ': ' + r.reason : ''}`, String(p.id), to);
          } catch (err) { await record(ch, 'failed', String((err as Error)?.message ?? err).slice(0, 200), String(p.id), to); }
        }
      }
      if (!people.length) await record(wantEmail ? 'email' : 'sms', 'skipped', 'no_recipients');
    }
    const sent = out.filter((d) => d.status === 'sent').length, skipped = out.filter((d) => d.status === 'skipped').length, failed = out.filter((d) => d.status === 'failed').length;
    await this.log(tenantId, eventId, kind === 'escalation' ? 'escalate' : 'notify', `${kind === 'escalation' ? 'Escalated' : 'Notified'}: ${sent} sent, ${skipped} skipped, ${failed} failed.`, null);
    return out;
  }

  /** Background: wake snoozed incidents whose time came; escalate critical incidents still open after 30 minutes (once). */
  async sweep(): Promise<{ woke: number; escalated: number }> {
    const now = new Date(this.now());
    const woke = (await sql<Row>`update ai_business_alert_events set incident_status = 'open', snoozed_until = null, incident_version = incident_version + 1
      where incident_status = 'snoozed' and ${canMoveToSql(AI_BUSINESS_INCIDENT_LIFECYCLE, 'open')} and snoozed_until <= ${now} returning id, tenant_id`.execute(this.db)).rows;
    for (const w of woke) await this.log(String(w.tenant_id), String(w.id), 'status', 'Snooze ended — the incident is open again.', null);
    const due = (await sql<Row>`select e.id, e.tenant_id from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id
      where e.incident_status = 'open' and e.escalated_at is null and e.acknowledged_at is null and a.severity = 'critical'
        and e.evaluated_at <= ${new Date(now.getTime() - ESCALATE_AFTER_MINUTES * 60_000)} order by e.evaluated_at limit 100`.execute(this.db)).rows;
    let escalated = 0;
    for (const d of due) {
      const claimed = (await sql<Row>`update ai_business_alert_events set escalated_at = ${now} where id = ${d.id}::uuid and escalated_at is null returning id`.execute(this.db)).rows[0];
      if (!claimed) continue;
      await this.onTriggered(String(d.tenant_id), String(d.id), 'escalation'); escalated++;
    }
    return { woke: woke.length, escalated };
  }

  // ── incident actions ───────────────────────────────────────────────────────────────────────────────────────────
  async act(ctx: AiBusinessContext, eventId: string, b: Row) {
    this.need(ctx);
    if (!isUuid(eventId)) throw new AlertIncidentError('Incident not found.', 'BC_EVENT_NOT_FOUND', 404);
    const action = String(b.action ?? '');
    if (!(INCIDENT_ACTIONS as readonly string[]).includes(action)) throw new AlertIncidentError('Unknown action.', 'VALIDATION_FAILED');
    const v = Number(b.expectedVersion);
    if (!Number.isInteger(v) || v < 1) throw new AlertIncidentError('The incident version is required.', 'VERSION_REQUIRED', 422);
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
    const T = ctx.tenantId, me = isUuid(ctx.userId) ? String(ctx.userId) : null;
    return this.db.transaction().execute(async (trx) => {
      const e = (await sql<Row>`select e.id, e.incident_status, e.incident_version, e.acknowledged_at from ai_business_alert_events e
        where e.tenant_id = ${T} and e.id = ${eventId}::uuid and ${this.scope(ctx, 'e')} for update`.execute(trx)).rows[0];
      if (!e || !e.incident_status) throw new AlertIncidentError('Incident not found.', 'BC_EVENT_NOT_FOUND', 404);
      if (Number(e.incident_version) !== v) throw new AlertIncidentError('This incident changed on another screen — reload it.', 'VERSION_CONFLICT', 409);
      const st = String(e.incident_status);
      let set = sql``, line = '';
      const target = action === 'acknowledge' || action === 'investigate' ? 'investigating' : action === 'resolve' ? 'resolved' : action === 'snooze' ? 'snoozed' : action === 'reopen' ? 'open' : null;
      if (action === 'acknowledge' || action === 'investigate') {
        if (st === 'resolved') throw new AlertIncidentError('The incident is resolved — reopen it first.', 'INCIDENT_RESOLVED', 409);
        set = sql`incident_status = 'investigating', snoozed_until = null, acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, ${me}::uuid), ack_note = coalesce(ack_note, ${note || null})`;
        line = 'Investigating.';
      } else if (action === 'resolve') {
        if (st === 'resolved') throw new AlertIncidentError('The incident is already resolved.', 'INCIDENT_RESOLVED', 409);
        if (note.length < 3) throw new AlertIncidentError('Say how it was resolved.', 'VALIDATION_FAILED');
        set = sql`incident_status = 'resolved', snoozed_until = null, resolved_at = now(), resolved_by = ${me}::uuid, resolution_note = ${note}, acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, ${me}::uuid)`;
        line = 'Resolved.';
      } else if (action === 'snooze') {
        if (st === 'resolved') throw new AlertIncidentError('The incident is resolved — reopen it first.', 'INCIDENT_RESOLVED', 409);
        const mins = Number(b.snoozeMinutes);
        if (![30, 60, 120, 240, 480, 1440].includes(mins)) throw new AlertIncidentError('Snooze for 30 min, 1, 2, 4, 8 or 24 hours.', 'VALIDATION_FAILED');
        set = sql`incident_status = 'snoozed', snoozed_until = ${new Date(this.now() + mins * 60_000)}`;
        line = `Snoozed for ${mins >= 60 ? `${mins / 60} h` : `${mins} min`}.`;
      } else if (action === 'reopen') {
        if (st !== 'resolved' && st !== 'snoozed') throw new AlertIncidentError('Only a resolved or snoozed incident can be reopened.', 'VALIDATION_FAILED');
        set = sql`incident_status = 'open', snoozed_until = null, resolved_at = null, resolved_by = null, resolution_note = null`;
        line = 'Reopened.';
      } else {   // assign
        const who = b.assigneeUserId == null ? null : String(b.assigneeUserId);
        if (who != null) {
          if (!isUuid(who)) throw new AlertIncidentError('Pick a staff member.', 'VALIDATION_FAILED');
          const u = (await sql<Row>`select full_name from users where tenant_id = ${T} and id = ${who}::uuid and coalesce(status, 'active') = 'active'`.execute(trx)).rows[0];
          if (!u) throw new AlertIncidentError('That staff member is not active in this salon.', 'VALIDATION_FAILED');
          line = `Assigned to ${u.full_name}.`;
        } else line = 'Unassigned.';
        set = sql`assignee_user_id = ${who}::uuid`;
      }
      if (target) assertTransition(AI_BUSINESS_INCIDENT_LIFECYCLE, st, target);   // after the friendly refusals above: the lifecycle is the last word
      const r = (await sql<Row>`update ai_business_alert_events set ${set}, incident_version = incident_version + 1 where id = ${eventId}::uuid returning incident_status, incident_version`.execute(trx)).rows[0];
      await this.log(T, eventId, action === 'assign' ? 'assign' : 'status', note && action !== 'resolve' ? `${line} ${note}` : action === 'resolve' ? `${line} ${note}` : line, me, trx);
      return { eventId, incidentStatus: r.incident_status, version: Number(r.incident_version) };
    });
  }
  async addNote(ctx: AiBusinessContext, eventId: string, b: Row) {
    this.need(ctx);
    const note = typeof b.note === 'string' ? b.note.trim() : '';
    if (!note) throw new AlertIncidentError('Write a note.', 'VALIDATION_FAILED');
    const e = isUuid(eventId) ? (await sql<Row>`select e.id from ai_business_alert_events e where e.tenant_id = ${ctx.tenantId} and e.id = ${eventId}::uuid and e.incident_status is not null and ${this.scope(ctx, 'e')}`.execute(this.db)).rows[0] : null;
    if (!e) throw new AlertIncidentError('Incident not found.', 'BC_EVENT_NOT_FOUND', 404);
    await this.log(ctx.tenantId, eventId, 'note', note, ctx.userId);
    return { ok: true };
  }
  async detail(ctx: AiBusinessContext, eventId: string) {
    this.need(ctx);
    const e = isUuid(eventId) ? (await sql<Row>`select e.id, e.alert_id, e.metric_id, e.operator, e.value, e.threshold, e.evaluated_at, e.incident_status, e.incident_version, e.assignee_user_id, e.snoozed_until,
        e.acknowledged_at, e.resolved_at, e.resolution_note, e.escalated_at, a.title, a.severity, ua.full_name as assignee_name, ur.full_name as resolved_by_name, uk.full_name as acknowledged_by_name
      from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id
      left join users ua on ua.id = e.assignee_user_id and ua.tenant_id = e.tenant_id left join users ur on ur.id = e.resolved_by and ur.tenant_id = e.tenant_id
      left join users uk on uk.id = e.acknowledged_by and uk.tenant_id = e.tenant_id
      where e.tenant_id = ${ctx.tenantId} and e.id = ${eventId}::uuid and ${this.scope(ctx, 'e')}`.execute(this.db)).rows[0] : null;
    if (!e) throw new AlertIncidentError('Incident not found.', 'BC_EVENT_NOT_FOUND', 404);
    const notes = (await sql<Row>`select n.kind, n.body, n.created_at, u.full_name from ai_business_alert_incident_notes n left join users u on u.id = n.author_user_id and u.tenant_id = n.tenant_id
      where n.tenant_id = ${ctx.tenantId} and n.event_id = ${eventId}::uuid order by n.created_at, n.id`.execute(this.db)).rows;
    const del = (await sql<Row>`select d.channel, d.kind, d.status, d.reason, d.recipient, d.created_at, u.full_name from ai_business_alert_deliveries d left join users u on u.id = d.recipient_user_id and u.tenant_id = d.tenant_id
      where d.tenant_id = ${ctx.tenantId} and d.event_id = ${eventId}::uuid order by d.created_at, d.id`.execute(this.db)).rows;
    return {
      eventId: String(e.id), alertId: String(e.alert_id), title: e.title, severity: e.severity, metricId: e.metric_id, operator: e.operator,
      value: e.value == null ? null : Number(e.value), threshold: Number(e.threshold), display: { value: formatAlertValue(e.metric_id, e.value), threshold: formatAlertValue(e.metric_id, e.threshold) },
      evaluatedAt: iso(e.evaluated_at), incidentStatus: e.incident_status, version: Number(e.incident_version),
      assignee: e.assignee_user_id ? { userId: String(e.assignee_user_id), name: e.assignee_name ?? null } : null,
      snoozedUntil: iso(e.snoozed_until), acknowledgedAt: iso(e.acknowledged_at), acknowledgedBy: e.acknowledged_by_name ?? null,
      resolvedAt: iso(e.resolved_at), resolvedBy: e.resolved_by_name ?? null, resolutionNote: e.resolution_note ?? null, escalatedAt: iso(e.escalated_at),
      log: notes.map((n) => ({ kind: n.kind, body: n.body, at: iso(n.created_at), by: n.full_name ?? (n.kind === 'notify' || n.kind === 'escalate' ? 'System' : null) })),
      deliveries: del.map((d) => ({ channel: d.channel, kind: d.kind, status: d.status, reason: d.reason ?? null, to: d.full_name ?? d.recipient ?? null, at: iso(d.created_at) })),
    };
  }
  async list(ctx: AiBusinessContext, f: Row) {
    this.need(ctx);
    const status = (INCIDENT_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : 'active';
    const limit = Math.min(100, Math.max(1, Number(f.limit) || 25)), page = Math.max(1, Number(f.page) || 1);
    const cond = status === 'all' ? sql`e.incident_status is not null` : status === 'active' ? sql`e.incident_status in ('open', 'investigating', 'snoozed')` : sql`e.incident_status = ${status}`;
    const where = sql`${cond} and ${this.scope(ctx, 'e')}`;
    const total = Number((await sql<Row>`select count(*)::int as n from ai_business_alert_events e where e.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n ?? 0);
    const rows = (await sql<Row>`select e.id, e.metric_id, e.value, e.threshold, e.evaluated_at, e.incident_status, e.incident_version, e.snoozed_until, a.title, a.severity, u.full_name as assignee
      from ai_business_alert_events e join ai_business_alerts a on a.id = e.alert_id left join users u on u.id = e.assignee_user_id and u.tenant_id = e.tenant_id
      where e.tenant_id = ${ctx.tenantId} and ${where} order by case e.incident_status when 'open' then 0 when 'investigating' then 1 when 'snoozed' then 2 else 3 end, e.evaluated_at desc, e.id
      limit ${limit} offset ${(page - 1) * limit}`.execute(this.db)).rows;
    const counts = (await sql<Row>`select e.incident_status as s, count(*)::int as n from ai_business_alert_events e where e.tenant_id = ${ctx.tenantId} and e.incident_status is not null and ${this.scope(ctx, 'e')} group by 1`.execute(this.db)).rows;
    return { status, page, limit, total, counts: Object.fromEntries(counts.map((c) => [c.s, Number(c.n)])),
      items: rows.map((r) => ({ eventId: String(r.id), title: r.title, severity: r.severity, incidentStatus: r.incident_status, version: Number(r.incident_version), evaluatedAt: iso(r.evaluated_at),
        snoozedUntil: iso(r.snoozed_until), assignee: r.assignee ?? null, display: { value: formatAlertValue(r.metric_id, r.value), threshold: formatAlertValue(r.metric_id, r.threshold) } })) };
  }
}
