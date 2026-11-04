// reminders.repository.ts — consolidated data port for the reminder job + in-memory adapter (dev/tests).
import type { ReminderChannel } from './reminder-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ReminderConfig } from '@aipowersalon/api-contracts/tenant';
import type { ReminderConfig } from '@aipowersalon/api-contracts/tenant';

export interface ApptCandidateRow { appointmentId: string; apptDate: string; startTime: string; status: string; customerName: string; customerPhone: string | null; customerEmail?: string | null; serviceName?: string; customerUserId?: string | null; customerLanguage?: string | null; branchId?: string | null; customerId?: string | null; customerFirstName?: string | null; technicianName?: string | null; services?: unknown }   // customerLanguage: WP-I (customers.preferred_language); branch / customer / first name / technician / services (740): the values a bound template can use
export interface TenantMeta { salonName: string; timezone: string }

export const DEFAULT_CONFIG = { enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' as ReminderChannel };

export interface RemindersDataPort {
  listEnabledTenants(): Promise<ReminderConfig[]>;
  getConfig(tenantId: string): Promise<ReminderConfig>;
  upsertConfig(tenantId: string, patch: Partial<Omit<ReminderConfig, 'tenantId'>>): Promise<ReminderConfig>;
  tenantMeta(tenantId: string): Promise<TenantMeta>;
  dueCandidates(tenantId: string, fromDate: string, toDate: string): Promise<ApptCandidateRow[]>;
  /** the appointments among these already reminded at THIS rung (minutes before the start) */
  listSent(tenantId: string, appointmentIds: string[], leadMinutes: number): Promise<string[]>;
  markSent(tenantId: string, appointmentId: string, leadMinutes: number): Promise<void>;
  recordAttempt(tenantId: string, appointmentId: string, channel: ReminderChannel, status: 'sent' | 'failed' | 'blocked', error?: string): Promise<void>;
  /** 747 dispatch protocol (Postgres). When present the service claims each occurrence BEFORE sending; the in-memory
   *  adapter (dev / unit tests) keeps the legacy read-sent → send → mark path. */
  dispatch?: ReminderDispatchPort;
}

export interface ClaimInput {
  tenantId: string; appointmentId: string; leadMinutes: number; occurrenceKey: string; channel: ReminderChannel;
  branchId: string | null; customerId: string | null; intendedSendAtMs: number; apptStartMs: number; tz: string;
  /** claimed = about to send; the others record a decision without sending */
  state: 'claimed' | 'skipped' | 'deferred'; reason: string | null;
}
export type ClaimResult = { id: string; state: string } | { stale: true } | null;
export interface DispatchFinish { state: 'submitted' | 'failed' | 'skipped' | 'cancelled'; reason: string | null; notificationId?: string | null; kind?: 'automatic' | 'manual_retry' | 'staff_cancel' | 'system'; actorUserId?: string | null; idempotencyKey?: string | null; note?: string | null }
export interface ReminderDispatchPort {
  /** lock the appointment, re-check it is still booked at this occurrence and in the future, then insert the occurrence
   *  (or re-claim a retryable failure / a deferral). null = someone else holds it or it is already decided; stale = the
   *  appointment changed (rescheduled / cancelled / started) — nothing is recorded, the new occurrence gets its own. */
  claim(c: ClaimInput): Promise<ClaimResult>;
  /** right before the provider call: still claimed and the appointment still at this occurrence? If not → cancelled. */
  revalidate(tenantId: string, dispatchId: string, nowMs: number): Promise<boolean>;
  finish(tenantId: string, dispatchId: string, f: DispatchFinish): Promise<void>;
  /** deferred (quiet hours) occurrences of this rung whose appointment is still booked at that occurrence and ahead */
  deferred(tenantId: string, leadMinutes: number): Promise<{ appointmentId: string; occurrenceKey: string }[]>;
  /** the salon's quiet hours for appointment reminders (Super Admin Smart Reminders: tenant row, else platform default) */
  quietHours(tenantId: string): Promise<import('./reminder-core').QuietHours | null>;
  /** claims older than 15 minutes (a worker died mid-send): appointment changed → cancelled; else failed
   *  'interrupted_unknown' (never retried automatically — the provider may have it). Returns how many. */
  recoverStale(tenantId: string): Promise<number>;
  startRun(tenantId: string, trigger: 'scheduler' | 'jobs_route' | 'manual'): Promise<string | null>;
  finishRun(runId: string | null, r: { outcome: 'ok' | 'partial' | 'failed'; candidates: number; submitted: number; skipped: number; deferred: number; failed: number; cancelled: number; error?: string | null }, tenantId?: string): Promise<void>;
}

export class InMemoryRemindersRepository implements RemindersDataPort {
  configs = new Map<string, ReminderConfig>();
  meta = new Map<string, TenantMeta>();
  appts: ApptCandidateRow[] = [];
  apptTenant = new Map<string, string>(); // appointmentId -> tenantId (for the in-memory due query)
  sent = new Set<string>();               // `${tenantId}|${appointmentId}|${leadMinutes}` — one per rung
  attempts: { tenantId: string; appointmentId: string; channel: string; status: string; error?: string }[] = [];

  async listEnabledTenants(): Promise<ReminderConfig[]> {
    return [...this.configs.values()].filter((c) => c.enabled);
  }
  async getConfig(tenantId: string): Promise<ReminderConfig> {
    return this.configs.get(tenantId) ?? { tenantId, ...DEFAULT_CONFIG };
  }
  async upsertConfig(tenantId: string, patch: Partial<Omit<ReminderConfig, 'tenantId'>>): Promise<ReminderConfig> {
    const cur = await this.getConfig(tenantId);
    const next = { ...cur, ...patch, tenantId };
    this.configs.set(tenantId, next);
    return next;
  }
  async tenantMeta(tenantId: string): Promise<TenantMeta> {
    return this.meta.get(tenantId) ?? { salonName: 'Your Salon', timezone: 'America/New_York' };
  }
  async dueCandidates(tenantId: string, fromDate: string, toDate: string): Promise<ApptCandidateRow[]> {
    return this.appts.filter((a) => this.apptTenant.get(a.appointmentId) === tenantId && a.apptDate >= fromDate && a.apptDate <= toDate);
  }
  async listSent(tenantId: string, appointmentIds: string[], leadMinutes: number): Promise<string[]> {
    return appointmentIds.filter((id) => this.sent.has(`${tenantId}|${id}|${leadMinutes}`));
  }
  async markSent(tenantId: string, appointmentId: string, leadMinutes: number): Promise<void> {
    this.sent.add(`${tenantId}|${appointmentId}|${leadMinutes}`);
  }
  async recordAttempt(tenantId: string, appointmentId: string, channel: ReminderChannel, status: 'sent' | 'failed' | 'blocked', error?: string): Promise<void> {
    this.attempts.push({ tenantId, appointmentId, channel, status, error });
  }
}
