// reminders.kysely.repository.ts — Postgres adapter. Raw SQL to avoid editing generated kysely.types.
// Config lives in reminder_settings; idempotency in appointment_reminders_sent; appointments read from
// pos_tech_appointments; timezone from tenant_settings (business-branch JSON), salon name from tenants.display_name.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { RemindersDataPort, ReminderConfig, ApptCandidateRow, TenantMeta } from './reminders.repository';
import { DEFAULT_CONFIG } from './reminders.repository';
import type { ReminderChannel } from './reminder-core';

const DEFAULT_TZ = process.env.REMINDERS_DEFAULT_TZ || 'America/New_York';

export class KyselyRemindersRepository implements RemindersDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  async listEnabledTenants(): Promise<ReminderConfig[]> {
    const res = await sql<ReminderConfig>`
      SELECT rs.tenant_id AS "tenantId", rs.enabled, rs.lead_minutes AS "leadMinutes", rs.window_minutes AS "windowMinutes", rs.channel
      FROM reminder_settings rs JOIN tenants t ON t.id = rs.tenant_id
      WHERE rs.enabled = true AND t.status = 'active'   -- Constitution 7 §19: no scheduled messages from a suspended / closed salon
    `.execute(this.db);
    return res.rows as unknown as ReminderConfig[];
  }
  async getConfig(tenantId: string): Promise<ReminderConfig> {
    const res = await sql<ReminderConfig>`
      SELECT tenant_id AS "tenantId", enabled, lead_minutes AS "leadMinutes", window_minutes AS "windowMinutes", channel
      FROM reminder_settings WHERE tenant_id = ${tenantId} LIMIT 1
    `.execute(this.db);
    return (res.rows[0] as unknown as ReminderConfig) ?? { tenantId, ...DEFAULT_CONFIG };
  }
  async upsertConfig(tenantId: string, patch: Partial<Omit<ReminderConfig, 'tenantId'>>): Promise<ReminderConfig> {
    const cur = await this.getConfig(tenantId);
    const n = { ...cur, ...patch };
    await sql`
      INSERT INTO reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel)
      VALUES (${tenantId}, ${n.enabled}, ${n.leadMinutes}, ${n.windowMinutes}, ${n.channel})
      ON CONFLICT (tenant_id) DO UPDATE SET enabled = ${n.enabled}, lead_minutes = ${n.leadMinutes}, window_minutes = ${n.windowMinutes}, channel = ${n.channel}, updated_at = now()
    `.execute(this.db);
    return { tenantId, enabled: n.enabled, leadMinutes: n.leadMinutes, windowMinutes: n.windowMinutes, channel: n.channel as ReminderChannel };
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
             coalesce(c.normalized_phone, a.customer_phone) AS "customerPhone", c.email AS "customerEmail", c.user_id AS "customerUserId", a.services
      FROM pos_tech_appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE a.tenant_id = ${tenantId} AND a.status = 'booked' AND a.appt_date BETWEEN ${fromDate}::date AND ${toDate}::date
    `.execute(this.db);
    return res.rows.map((r) => ({
      appointmentId: r.appointmentId, apptDate: r.apptDate, startTime: r.startTime, status: r.status,
      customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: r.customerEmail ?? null, customerUserId: (r as any).customerUserId ?? null,
      serviceName: Array.isArray(r.services) && r.services[0] ? (r.services[0].serviceName || r.services[0].name) : undefined,
    }));
  }
  async listSent(tenantId: string, appointmentIds: string[]): Promise<string[]> {
    if (appointmentIds.length === 0) return [];
    const res = await sql<{ appointment_id: string }>`
      SELECT appointment_id FROM appointment_reminders_sent
      WHERE tenant_id = ${tenantId} AND appointment_id = ANY(${appointmentIds}::uuid[])
    `.execute(this.db);
    return res.rows.map((r) => r.appointment_id);
  }
  async markSent(tenantId: string, appointmentId: string): Promise<void> {
    await sql`
      INSERT INTO appointment_reminders_sent (tenant_id, appointment_id) VALUES (${tenantId}, ${appointmentId})
      ON CONFLICT (tenant_id, appointment_id) DO NOTHING
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
