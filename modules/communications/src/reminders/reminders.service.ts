// reminders.service.ts — orchestrates the reminder job. For each enabled tenant: resolve config + tz, query due
// appointments, select those inside the firing window (engine core), and send via the notifications path (which
// meters credits + enforces opt-outs). Idempotent via appointment_reminders_sent.
import type { RemindersDataPort, ReminderConfig } from './reminders.repository';
import { systemContext } from '@aipowersalon/tenant-context';
import { selectDueReminders, buildReminderMessage, type ReminderCandidate } from './reminder-core';
import { localDateTimeToEpochMs, epochToLocalDate } from './reminder-tz';

export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }

// Subset of NotificationsService used here (keeps modules decoupled; NotificationsService satisfies it).
export interface NotificationSender {
  send(ctx: { tenantId: string; userId: string; role: string; salonName?: string }, req: { channel: 'sms' | 'email'; to: string; body: string; customerId?: string }): Promise<{ sent: boolean; status: string; reason?: string }>;
}

export interface RunSummary { tenantsProcessed: number; candidates: number; sent: number; blocked: number; failed: number }

// Optional push channel (mirrors PayrollPushLike): a customer with the app also gets a lock-screen reminder.
// Best-effort — PushService.dispatchToUser never throws; a push problem must never affect the SMS/email sweep.
export type ReminderPushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };

const SYSTEM_CTX = (() => { const c = systemContext({ tenantId: '', actor: 'reminders' }); return { userId: c.userId, role: c.role }; })();

function startLabel(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch { return ''; }
}

export class RemindersService {
  constructor(private readonly data: RemindersDataPort, private readonly notifications: NotificationSender, private readonly push?: ReminderPushLike) {}

  async runDueReminders(nowMs: number = Date.now()): Promise<RunSummary> {
    const tenants = await this.data.listEnabledTenants();
    const summary: RunSummary = { tenantsProcessed: tenants.length, candidates: 0, sent: 0, blocked: 0, failed: 0 };

    for (const cfg of tenants) {
      const meta = await this.data.tenantMeta(cfg.tenantId);
      const tz = meta.timezone || 'America/New_York';
      const leadMs = Math.max(0, cfg.leadMinutes) * 60_000;
      const windowMs = Math.max(1, cfg.windowMinutes) * 60_000;

      // Bound the date query to the local dates the firing window can touch.
      const fromDate = epochToLocalDate(nowMs + leadMs, tz);
      const toDate = epochToLocalDate(nowMs + leadMs + windowMs, tz);
      const rows = await this.data.dueCandidates(cfg.tenantId, fromDate, toDate);

      const userByAppt = new Map<string, string>();
      for (const r of rows) if (r.customerUserId) userByAppt.set(r.appointmentId, r.customerUserId);
      const cands: ReminderCandidate[] = rows.map((r) => {
        const startsAtMs = localDateTimeToEpochMs(r.apptDate, r.startTime, tz);
        const address = cfg.channel === 'email' ? (r.customerEmail || undefined) : (r.customerPhone || undefined);
        return { appointmentId: r.appointmentId, startsAtMs, status: r.status, channel: cfg.channel, address, customerName: r.customerName, serviceName: r.serviceName, startLabel: startLabel(startsAtMs, tz) };
      });

      const sent = new Set(await this.data.listSent(cfg.tenantId, cands.map((c) => c.appointmentId)));
      const due = selectDueReminders(cands, nowMs, { leadMs, windowMs, alreadySent: sent });
      summary.candidates += due.length;

      for (const d of due) {
        const body = buildReminderMessage(d, meta.salonName, cfg.channel);
        let res: { sent: boolean; status: string; reason?: string };
        try {
          res = await this.notifications.send({ tenantId: cfg.tenantId, ...SYSTEM_CTX, salonName: meta.salonName }, { channel: cfg.channel, to: d.address!, body });
        } catch {
          summary.failed++;
          await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'failed', 'provider_error');
          continue; // provider/system error — retry next run, don't mark sent
        }
        if (res.sent) { summary.sent++; await this.data.markSent(cfg.tenantId, d.appointmentId); await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'sent'); await this.pushReminder(cfg.tenantId, userByAppt.get(d.appointmentId), d, meta.salonName); }
        else if (res.status === 'blocked' && res.reason === 'opted_out') { summary.blocked++; await this.data.markSent(cfg.tenantId, d.appointmentId); await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'blocked', 'opted_out'); await this.pushReminder(cfg.tenantId, userByAppt.get(d.appointmentId), d, meta.salonName); } // terminal: never retry an opted-out recipient; the app push (separate, OS-level consent) still reaches them once
        else if (res.status === 'blocked') { summary.blocked++; await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'blocked', res.reason ?? res.status); } // e.g. over_limit — retry next run (don't mark)
        else { summary.failed++; await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'failed', res.reason ?? res.status); }
      }
    }
    return summary;
  }

  /** Fires ONLY on the terminal outcomes (sent / opted_out) — those are the passes that markSent, so the sent-set
   *  guarantees at most one push per appointment; provider-error retries never reach here. Walk-ins without a linked
   *  account (no user_id) are skipped silently. Never throws. */
  private async pushReminder(tenantId: string, userId: string | undefined, d: ReminderCandidate, salonName?: string): Promise<void> {
    if (!this.push || !userId) return;
    try {
      await this.push.dispatchToUser(tenantId, userId, {
        title: 'Appointment reminder',
        body: `Your${salonName ? ' ' + salonName : ''} appointment is coming up${d.startLabel ? ' — ' + d.startLabel : ''}.`,
        data: { kind: 'appointment_reminder', appointmentId: d.appointmentId },
        category: 'APPOINTMENT_REMINDER',
        reference: 'appointment_reminder',
      });
    } catch { /* best-effort */ }
  }

  // ---- owner config ----
  async getConfig(tenantId: string): Promise<ReminderConfig> {
    if (!tenantId) throw new ValidationError('No tenant');
    return this.data.getConfig(tenantId);
  }
  async updateConfig(tenantId: string, patch: { enabled?: boolean; leadMinutes?: number; windowMinutes?: number; channel?: 'sms' | 'email' }): Promise<ReminderConfig> {
    if (!tenantId) throw new ValidationError('No tenant');
    const clean: Partial<ReminderConfig> = {};
    if (patch.enabled !== undefined) clean.enabled = !!patch.enabled;
    if (patch.channel !== undefined) {
      if (patch.channel !== 'sms' && patch.channel !== 'email') throw new ValidationError("channel must be 'sms' or 'email'");
      clean.channel = patch.channel;
    }
    if (patch.leadMinutes !== undefined) {
      const v = Math.floor(Number(patch.leadMinutes));
      if (!Number.isFinite(v) || v < 0 || v > 20160) throw new ValidationError('leadMinutes must be 0–20160 (≤14 days)');
      clean.leadMinutes = v;
    }
    if (patch.windowMinutes !== undefined) {
      const v = Math.floor(Number(patch.windowMinutes));
      if (!Number.isFinite(v) || v < 5 || v > 1440) throw new ValidationError('windowMinutes must be 5–1440');
      clean.windowMinutes = v;
    }
    return this.data.upsertConfig(tenantId, clean);
  }
}
