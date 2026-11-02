// reminders.kysely.repository.ts — Postgres adapter. Raw SQL to avoid editing generated kysely.types.
// Config lives in reminder_settings; idempotency in appointment_reminders_sent; appointments read from
// pos_tech_appointments; timezone from tenant_settings (business-branch JSON), salon name from tenants.display_name.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { RemindersDataPort, ReminderConfig, ApptCandidateRow, TenantMeta, ReminderDispatchPort, ClaimInput, ClaimResult, DispatchFinish } from './reminders.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { REMINDER_DISPATCH } from '../communications-lifecycles';
import { logException } from '@aipowersalon/observability';
import { AUTO_RETRYABLE_REASONS, MAX_AUTO_ATTEMPTS, type QuietHours } from './reminder-core';
import { DEFAULT_CONFIG } from './reminders.repository';
import type { ReminderChannel } from './reminder-core';

const DEFAULT_TZ = process.env.REMINDERS_DEFAULT_TZ || 'America/New_York';

export class KyselyRemindersRepository implements RemindersDataPort {
  readonly dispatch: ReminderDispatchPort;
  constructor(private readonly db: Kysely<DB>) { this.dispatch = new KyselyReminderDispatch(db as unknown as Kysely<any>); }

  async listEnabledTenants(): Promise<ReminderConfig[]> {
    const res = await sql<ReminderConfig>`
      SELECT rs.tenant_id AS "tenantId", rs.enabled, rs.lead_minutes AS "leadMinutes", rs.window_minutes AS "windowMinutes", rs.channel, rs.ladder_minutes AS "ladderMinutes"
      FROM reminder_settings rs JOIN tenants t ON t.id = rs.tenant_id
      WHERE rs.enabled = true AND t.status = 'active'   -- Constitution 7 §19: no scheduled messages from a suspended / closed salon
    `.execute(this.db);
    return res.rows as unknown as ReminderConfig[];
  }
  async getConfig(tenantId: string): Promise<ReminderConfig> {
    const res = await sql<ReminderConfig>`
      SELECT tenant_id AS "tenantId", enabled, lead_minutes AS "leadMinutes", window_minutes AS "windowMinutes", channel, ladder_minutes AS "ladderMinutes"
      FROM reminder_settings WHERE tenant_id = ${tenantId} LIMIT 1
    `.execute(this.db);
    return (res.rows[0] as unknown as ReminderConfig) ?? { tenantId, ...DEFAULT_CONFIG };
  }
  async upsertConfig(tenantId: string, patch: Partial<Omit<ReminderConfig, 'tenantId'>>): Promise<ReminderConfig> {
    const cur = await this.getConfig(tenantId);
    const n = { ...cur, ...patch };
    const ladder = Array.isArray(n.ladderMinutes) && n.ladderMinutes.length ? n.ladderMinutes : null;
    await sql`
      INSERT INTO reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel, ladder_minutes)
      VALUES (${tenantId}, ${n.enabled}, ${n.leadMinutes}, ${n.windowMinutes}, ${n.channel}, ${ladder}::int[])
      ON CONFLICT (tenant_id) DO UPDATE SET enabled = ${n.enabled}, lead_minutes = ${n.leadMinutes}, window_minutes = ${n.windowMinutes}, channel = ${n.channel}, ladder_minutes = ${ladder}::int[], updated_at = now()
    `.execute(this.db);
    return { tenantId, enabled: n.enabled, leadMinutes: n.leadMinutes, windowMinutes: n.windowMinutes, channel: n.channel as ReminderChannel, ladderMinutes: ladder };
  }
  async tenantMeta(tenantId: string): Promise<TenantMeta> {
    const nameRes = await sql<{ display_name: string }>`SELECT display_name FROM tenants WHERE id = ${tenantId} LIMIT 1`.execute(this.db);
    const tzRes = await sql<{ tz: string | null }>`
      -- settings_json, NOT value. tenant_settings (migration 016) has no value column at all, so this
      -- SELECT threw — and unlike most reads in this codebase it has NO .catch(), so tenantMeta() REJECTED and
      -- the whole appointment-reminder send failed. Reminders were not going out late; they were not going out.
      SELECT (settings_json ->> 'timezone') AS tz FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND category = 'business-branch' LIMIT 1
    `.execute(this.db);
    return { salonName: nameRes.rows[0]?.display_name || 'Your Salon', timezone: tzRes.rows[0]?.tz || DEFAULT_TZ };
  }
  async dueCandidates(tenantId: string, fromDate: string, toDate: string): Promise<ApptCandidateRow[]> {
    const res = await sql<ApptCandidateRow & { services: any }>`
      SELECT a.id AS "appointmentId", to_char(a.appt_date, 'YYYY-MM-DD') AS "apptDate", a.start_time AS "startTime",
             a.status, a.customer_name AS "customerName",
             -- Phase 3 (audit E8): the customer's CURRENT number when the appointment is linked to a customer — the
             -- copy on the appointment was taken at booking time and went stale when the number changed.
             coalesce(c.normalized_phone, a.customer_phone) AS "customerPhone", c.email AS "customerEmail", c.user_id AS "customerUserId", c.preferred_language AS "customerLanguage", a.services,
             a.branch_id AS "branchId", a.customer_id AS "customerId", c.first_name AS "customerFirstName", tc.full_name AS "technicianName"
      FROM pos_tech_appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN technicians tc ON tc.id = a.technician_id AND tc.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId} AND a.status = 'booked' AND a.appt_date BETWEEN ${fromDate}::date AND ${toDate}::date
    `.execute(this.db);
    return res.rows.map((r) => ({
      appointmentId: r.appointmentId, apptDate: r.apptDate, startTime: r.startTime, status: r.status,
      customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: r.customerEmail ?? null, customerUserId: (r as any).customerUserId ?? null, customerLanguage: r.customerLanguage ?? null,
      serviceName: Array.isArray(r.services) && r.services[0] ? (r.services[0].serviceName || r.services[0].name) : undefined,
      branchId: r.branchId ?? null, customerId: r.customerId ?? null, customerFirstName: r.customerFirstName ?? null, technicianName: r.technicianName ?? null, services: r.services,
    }));
  }
  async listSent(tenantId: string, appointmentIds: string[], leadMinutes: number): Promise<string[]> {
    if (appointmentIds.length === 0) return [];
    const res = await sql<{ appointment_id: string }>`
      SELECT appointment_id FROM appointment_reminders_sent
      WHERE tenant_id = ${tenantId} AND appointment_id = ANY(${appointmentIds}::uuid[]) AND lead_minutes = ${leadMinutes}
    `.execute(this.db);
    return res.rows.map((r) => r.appointment_id);
  }
  async markSent(tenantId: string, appointmentId: string, leadMinutes: number): Promise<void> {
    await sql`
      INSERT INTO appointment_reminders_sent (tenant_id, appointment_id, lead_minutes) VALUES (${tenantId}, ${appointmentId}, ${leadMinutes})
      ON CONFLICT (tenant_id, appointment_id, lead_minutes) DO NOTHING
    `.execute(this.db);
  }
  async recordAttempt(tenantId: string, appointmentId: string, channel: ReminderChannel, status: 'sent' | 'failed' | 'blocked', error?: string): Promise<void> {
    try {
      await sql`
        INSERT INTO appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error)
        VALUES (${tenantId}, ${appointmentId}, ${channel}, ${status}, ${error ?? null})
      `.execute(this.db);
    } catch { /* delivery-status logging must never break the send loop */ }
  }
}


/** the appointment's start as a UTC instant, from its salon-local date + time */
const startAt = (tz: string) => sql`((a.appt_date::text || ' ' || left(a.start_time, 5))::timestamp AT TIME ZONE ${tz})`;
const occOf = sql`(to_char(a.appt_date, 'YYYY-MM-DD') || ' ' || left(a.start_time, 5))`;

/** 747 — the claim-before-send dispatch record (appointment_reminders_sent) + the event trail (appointment_reminder_attempts). */
export class KyselyReminderDispatch implements ReminderDispatchPort {
  constructor(private readonly db: Kysely<any>) {}

  private async event(x: Kysely<any>, e: { tenantId: string; appointmentId: string; dispatchId: string | null; channel: string; status: string; error?: string | null; notificationId?: string | null; kind?: string; actorUserId?: string | null; idempotencyKey?: string | null; occurrenceKey?: string | null; note?: string | null }) {
    await sql`INSERT INTO appointment_reminder_attempts (tenant_id, appointment_id, channel, status, error, dispatch_id, notification_id, kind, actor_user_id, idempotency_key, occurrence_key, note)
      VALUES (${e.tenantId}, ${e.appointmentId}, ${e.channel}, ${e.status}, ${e.error ?? null}, ${e.dispatchId}, ${e.notificationId ?? null}, ${e.kind ?? 'automatic'}, ${e.actorUserId ?? null}, ${e.idempotencyKey ?? null}, ${e.occurrenceKey ?? null}, ${e.note ?? null})`.execute(x);
  }

  async claim(c: ClaimInput): Promise<ClaimResult> {
    return this.db.transaction().execute(async (trx: Kysely<any>) => {
      // the appointment row lock serialises this claim with a concurrent reschedule / cancel of the same appointment
      const a = (await sql<{ status: string; occ: string; future: boolean }>`
        SELECT a.status, ${occOf} AS occ, (${startAt(c.tz)} > now()) AS future
        FROM pos_tech_appointments a WHERE a.id = ${c.appointmentId}::uuid AND a.tenant_id = ${c.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
      if (!a || a.status !== 'booked' || a.occ !== c.occurrenceKey || !a.future) return { stale: true as const };
      const retryable = sql.join([...AUTO_RETRYABLE_REASONS]);
      const r = (await sql<{ id: string; state: string; inserted: boolean }>`
        INSERT INTO appointment_reminders_sent AS d (tenant_id, appointment_id, lead_minutes, occurrence_key, state, reason, channel, branch_id, customer_id,
          intended_send_at, appt_start_at, attempt_count, reminded_at, created_at, updated_at)
        VALUES (${c.tenantId}, ${c.appointmentId}, ${c.leadMinutes}, ${c.occurrenceKey}, ${c.state}, ${c.reason}, ${c.channel}, ${c.branchId}, ${c.customerId},
          to_timestamp(${c.intendedSendAtMs / 1000}), to_timestamp(${c.apptStartMs / 1000}), ${c.state === 'claimed' ? 1 : 0}, now(), now(), now())
        ON CONFLICT (tenant_id, appointment_id, lead_minutes, occurrence_key) DO UPDATE
          SET state = 'claimed', reason = NULL, attempt_count = d.attempt_count + 1, channel = excluded.channel, updated_at = now()
          WHERE excluded.state = 'claimed' AND ${canMoveToSql(REMINDER_DISPATCH, 'claimed', 'd')} AND (
            d.state = 'deferred'
            OR (d.state = 'failed' AND d.reason IN (${retryable}) AND d.attempt_count < ${MAX_AUTO_ATTEMPTS}
                AND d.updated_at < now() - make_interval(mins => 10 * d.attempt_count)))
        RETURNING d.id, d.state, (xmax = 0) AS inserted`.execute(trx)).rows[0];
      if (!r) return null;
      await this.event(trx, { tenantId: c.tenantId, appointmentId: c.appointmentId, dispatchId: r.id, channel: c.channel, status: r.state === 'claimed' ? 'claimed' : r.state, error: c.reason, occurrenceKey: c.occurrenceKey, kind: 'automatic' });
      return { id: r.id, state: r.state };
    });
  }

  async revalidate(tenantId: string, dispatchId: string, _nowMs: number): Promise<boolean> {
    return this.db.transaction().execute(async (trx: Kysely<any>) => {
      const d = (await sql<{ state: string; appointment_id: string; occurrence_key: string; channel: string }>`
        SELECT state, appointment_id, occurrence_key, channel FROM appointment_reminders_sent WHERE id = ${dispatchId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
      if (!d || d.state !== 'claimed') return false;   // a staff cancel (or anything else) got there first
      const tz = await this.tzOf(trx, tenantId);
      const a = (await sql<{ ok: boolean }>`
        SELECT (a.status = 'booked' AND ${occOf} = ${d.occurrence_key} AND ${startAt(tz)} > now()) AS ok
        FROM pos_tech_appointments a WHERE a.id = ${d.appointment_id}::uuid AND a.tenant_id = ${tenantId}::uuid`.execute(trx)).rows[0];
      if (a?.ok) return true;
      await sql`UPDATE appointment_reminders_sent SET state = 'cancelled', reason = 'appointment_changed', updated_at = now()
        WHERE id = ${dispatchId}::uuid AND tenant_id = ${tenantId}::uuid AND ${canMoveToSql(REMINDER_DISPATCH, 'cancelled')}`.execute(trx);
      await this.event(trx, { tenantId, appointmentId: d.appointment_id, dispatchId, channel: d.channel, status: 'cancelled', error: 'appointment_changed', occurrenceKey: d.occurrence_key, kind: 'system' });
      return false;
    });
  }

  async finish(tenantId: string, dispatchId: string, f: DispatchFinish): Promise<void> {
    await this.db.transaction().execute(async (trx: Kysely<any>) => {
      const d = (await sql<{ appointment_id: string; occurrence_key: string; channel: string }>`
        UPDATE appointment_reminders_sent SET state = ${f.state}, reason = ${f.reason}, notification_id = coalesce(${f.notificationId ?? null}::uuid, notification_id),
          updated_at = now(), updated_by = ${f.actorUserId ?? null}
        WHERE id = ${dispatchId}::uuid AND tenant_id = ${tenantId}::uuid AND ${canMoveToSql(REMINDER_DISPATCH, f.state)}
        RETURNING appointment_id, occurrence_key, channel`.execute(trx)).rows[0];
      if (!d) return;
      const status = f.state === 'submitted' ? 'sent' : f.state === 'failed' ? 'failed' : f.state === 'skipped' ? (f.reason === 'opted_out' ? 'blocked' : 'skipped') : 'cancelled';
      await this.event(trx, { tenantId, appointmentId: d.appointment_id, dispatchId, channel: d.channel, status, error: f.reason, notificationId: f.notificationId ?? null,
        kind: f.kind ?? 'automatic', actorUserId: f.actorUserId ?? null, idempotencyKey: f.idempotencyKey ?? null, occurrenceKey: d.occurrence_key, note: f.note ?? null });
    });
  }

  async deferred(tenantId: string, leadMinutes: number): Promise<{ appointmentId: string; occurrenceKey: string }[]> {
    const tz = await this.tzOf(this.db, tenantId);
    const r = await sql<{ appointment_id: string; occurrence_key: string }>`
      SELECT d.appointment_id, d.occurrence_key FROM appointment_reminders_sent d
      JOIN pos_tech_appointments a ON a.id = d.appointment_id AND a.tenant_id = d.tenant_id
      WHERE d.tenant_id = ${tenantId}::uuid AND d.lead_minutes = ${leadMinutes} AND d.state = 'deferred'
        AND a.status = 'booked' AND ${occOf} = d.occurrence_key AND ${startAt(tz)} > now()
      ORDER BY d.intended_send_at LIMIT 500`.execute(this.db);
    return r.rows.map((x) => ({ appointmentId: x.appointment_id, occurrenceKey: x.occurrence_key }));
  }

  async quietHours(tenantId: string): Promise<QuietHours | null> {
    // Super Admin Smart Reminders (283/284): the salon's own timing row for 'upcoming_appointment', else the platform
    // default; a tenant override may change only the policy. Nothing configured → no quiet hours (today's behaviour).
    const r = (await sql<{ qs: number | null; qe: number | null; policy: string | null; opolicy: string | null }>`
      SELECT t.quiet_hours_start AS qs, t.quiet_hours_end AS qe, t.quiet_hours_policy AS policy,
        (SELECT o.quiet_hours_policy FROM reminder_tenant_overrides o WHERE o.tenant_id = ${tenantId}::uuid AND o.reminder_type = 'upcoming_appointment' AND o.enabled AND o.approval_state = 'approved') AS opolicy
      FROM reminder_timing_defaults t
      WHERE t.reminder_type = 'upcoming_appointment' AND t.enabled AND (t.tenant_id = ${tenantId}::uuid OR t.tenant_id IS NULL)
      ORDER BY (t.tenant_id IS NULL) LIMIT 1`.execute(this.db)).rows[0];
    if (!r || r.qs == null || r.qe == null) return null;
    const policy = (r.opolicy || r.policy || 'defer') as QuietHours['policy'];
    return { start: Number(r.qs), end: Number(r.qe), policy: policy === 'skip' || policy === 'send' ? policy : 'defer' };
  }

  async recoverStale(tenantId: string): Promise<number> {
    const tz = await this.tzOf(this.db, tenantId);
    return this.db.transaction().execute(async (trx: Kysely<any>) => {
      const rows = (await sql<{ id: string; appointment_id: string; occurrence_key: string; channel: string; changed: boolean }>`
        SELECT d.id, d.appointment_id, d.occurrence_key, d.channel,
          NOT coalesce((SELECT a.status = 'booked' AND ${occOf} = d.occurrence_key AND ${startAt(tz)} > now() FROM pos_tech_appointments a WHERE a.id = d.appointment_id AND a.tenant_id = d.tenant_id), false) AS changed
        FROM appointment_reminders_sent d
        WHERE d.tenant_id = ${tenantId}::uuid AND d.state = 'claimed' AND d.updated_at < now() - interval '15 minutes'
        FOR UPDATE OF d SKIP LOCKED`.execute(trx)).rows;
      for (const r of rows) {
        const to = r.changed ? 'cancelled' : 'failed', why = r.changed ? 'appointment_changed' : 'interrupted_unknown';
        await sql`UPDATE appointment_reminders_sent SET state = ${to}, reason = ${why}, updated_at = now() WHERE id = ${r.id}::uuid AND ${canMoveToSql(REMINDER_DISPATCH, to)}`.execute(trx);
        await this.event(trx, { tenantId, appointmentId: r.appointment_id, dispatchId: r.id, channel: r.channel, status: to, error: why, occurrenceKey: r.occurrence_key, kind: 'system' });
      }
      return rows.length;
    });
  }

  async startRun(tenantId: string, trigger: 'scheduler' | 'jobs_route' | 'manual'): Promise<string | null> {
    // the run record is the durable heartbeat; a failure to write it is logged and never stops the reminders themselves
    try { return (await sql<{ id: string }>`INSERT INTO appointment_reminder_runs (tenant_id, trigger) VALUES (${tenantId}, ${trigger}) RETURNING id`.execute(this.db)).rows[0]?.id ?? null; }
    catch (e) { logException(e, { where: 'reminders.run_start' }); return null; }
  }
  async finishRun(runId: string | null, r: { outcome: 'ok' | 'partial' | 'failed'; candidates: number; submitted: number; skipped: number; deferred: number; failed: number; cancelled: number; error?: string | null }): Promise<void> {
    if (!runId) return;
    try {
      await sql`UPDATE appointment_reminder_runs SET finished_at = now(), outcome = ${r.outcome}, candidates = ${r.candidates}, submitted = ${r.submitted}, skipped = ${r.skipped},
        deferred = ${r.deferred}, failed = ${r.failed}, cancelled = ${r.cancelled}, error = ${r.error ?? null} WHERE id = ${runId}::uuid`.execute(this.db);
    } catch (e) { logException(e, { where: 'reminders.run_finish' }); }
  }

  private async tzOf(x: Kysely<any>, tenantId: string): Promise<string> {
    const r = await sql<{ tz: string | null }>`SELECT (settings_json ->> 'timezone') AS tz FROM tenant_settings WHERE tenant_id = ${tenantId}::uuid AND category = 'business-branch' LIMIT 1`.execute(x);
    return r.rows[0]?.tz || DEFAULT_TZ;
  }
}
