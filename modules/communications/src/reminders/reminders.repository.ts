// reminders.repository.ts — consolidated data port for the reminder job + in-memory adapter (dev/tests).
import type { ReminderChannel } from './reminder-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ReminderConfig } from '@aipowersalon/api-contracts/tenant';
import type { ReminderConfig } from '@aipowersalon/api-contracts/tenant';

export interface ApptCandidateRow { appointmentId: string; apptDate: string; startTime: string; status: string; customerName: string; customerPhone: string | null; customerEmail?: string | null; serviceName?: string; customerUserId?: string | null }
export interface TenantMeta { salonName: string; timezone: string }

export const DEFAULT_CONFIG = { enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' as ReminderChannel };

export interface RemindersDataPort {
  listEnabledTenants(): Promise<ReminderConfig[]>;
  getConfig(tenantId: string): Promise<ReminderConfig>;
  upsertConfig(tenantId: string, patch: Partial<Omit<ReminderConfig, 'tenantId'>>): Promise<ReminderConfig>;
  tenantMeta(tenantId: string): Promise<TenantMeta>;
  dueCandidates(tenantId: string, fromDate: string, toDate: string): Promise<ApptCandidateRow[]>;
  listSent(tenantId: string, appointmentIds: string[]): Promise<string[]>;
  markSent(tenantId: string, appointmentId: string): Promise<void>;
  recordAttempt(tenantId: string, appointmentId: string, channel: ReminderChannel, status: 'sent' | 'failed' | 'blocked', error?: string): Promise<void>;
}

export class InMemoryRemindersRepository implements RemindersDataPort {
  configs = new Map<string, ReminderConfig>();
  meta = new Map<string, TenantMeta>();
  appts: ApptCandidateRow[] = [];
  apptTenant = new Map<string, string>(); // appointmentId -> tenantId (for the in-memory due query)
  sent = new Set<string>();               // `${tenantId}|${appointmentId}`
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
  async listSent(tenantId: string, appointmentIds: string[]): Promise<string[]> {
    return appointmentIds.filter((id) => this.sent.has(`${tenantId}|${id}`));
  }
  async markSent(tenantId: string, appointmentId: string): Promise<void> {
    this.sent.add(`${tenantId}|${appointmentId}`);
  }
  async recordAttempt(tenantId: string, appointmentId: string, channel: ReminderChannel, status: 'sent' | 'failed' | 'blocked', error?: string): Promise<void> {
    this.attempts.push({ tenantId, appointmentId, channel, status, error });
  }
}
