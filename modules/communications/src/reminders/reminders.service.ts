// reminders.service.ts — orchestrates the reminder job. For each enabled tenant: resolve config + tz, query due
// appointments, select those inside the firing window (engine core), and send via the notifications path (which
// meters credits + enforces opt-outs). Idempotent via appointment_reminders_sent.
import type { RemindersDataPort, ReminderConfig } from './reminders.repository';
import { systemContext } from '@aipowersalon/tenant-context';
import { selectDueReminders, selectDueWindow, buildReminderMessage, reminderPush, reminderSubject, occurrenceKey, inQuietHours, classifyOutcome, type ReminderCandidate } from './reminder-core';
import type { ReminderDispatchPort } from './reminders.repository';
import { customerMessageLanguage, type AppLanguage, withCode } from '@aipowersalon/api-contracts';
import { localDateTimeToEpochMs, epochToLocalDate } from './reminder-tz';
import { logException } from '@aipowersalon/observability';

export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }

// Subset of NotificationsService used here (keeps modules decoupled; NotificationsService satisfies it).
export interface NotificationSender {
  send(ctx: { tenantId: string; userId: string; role: string; salonName?: string }, req: { channel: 'sms' | 'email'; to: string; subject?: string; body: string; customerId?: string; purpose?: 'reminder'; source?: { type: 'appointment'; id: string } }): Promise<{ sent: boolean; status: string; reason?: string; id?: string }>;
}

export interface RunSummary { tenantsProcessed: number; candidates: number; sent: number; blocked: number; failed: number; fromTemplate?: number; skipped?: number; deferred?: number; cancelled?: number; recovered?: number }
export type RunTrigger = 'scheduler' | 'jobs_route' | 'manual';

/** Message Templates (740): the template an owner connected to Appointment Reminders, if any, and the usage recorder. Optional —
 *  without it (or with no active binding) the built-in text is used exactly as before. */
export interface ReminderTemplatePort {
  resolve(tenantId: string, branchId: string | null, channel: 'sms' | 'email'): Promise<{ templateId: string; version: number; subject: string | null; body: string } | null>;
  record(u: { tenantId: string; branchId: string | null; templateId: string; version: number; channel: 'sms' | 'email'; customerId: string | null; appointmentId: string; notificationId: string | null; recipientMasked: string | null; subject: string | null; body: string; outcome: 'submitted' | 'blocked' | 'failed' | 'simulated'; reason: string | null }): Promise<void>;
  render(t: { channel: 'sms' | 'email'; subject: string | null; body: string }, values: Record<string, string | null | undefined>): { text: string; subject: string | null; missing: string[]; unknown: string[] };
  values(d: { apptDate?: string; startTime?: string; services?: unknown; technicianName?: string | null; appointmentId: string; tz: string }): Record<string, string | null | undefined>;
}

// Optional push channel (mirrors PayrollPushLike): a customer with the app also gets a lock-screen reminder.
// Best-effort — PushService.dispatchToUser never throws; a push problem must never affect the SMS/email sweep.
export type ReminderPushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };

const SYSTEM_CTX = (() => { const c = systemContext({ tenantId: '', actor: 'reminders' }); return { userId: c.userId, role: c.role }; })();

/** The appointment time in the salon's zone, written for the customer's language ("Tue, Jun 23, 2:30 PM" / "14:30 Thứ Ba, 23/6"). */
export function startLabel(ms: number, tz: string, language: AppLanguage = 'en'): string {
  try {
    if (language === 'vi') {
      const d = new Date(ms);
      const time = new Intl.DateTimeFormat('vi-VN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
      const day = new Intl.DateTimeFormat('vi-VN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'numeric' }).format(d);
      return `${time} ${day}`;
    }
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch { return ''; }
}

/** the salon's rungs, longest first: its ladder, else its single lead_minutes (unchanged behaviour for salons that never set one) */
export function ladderOf(cfg: Pick<ReminderConfig, 'leadMinutes' | 'ladderMinutes'>): number[] {
  const l = Array.isArray(cfg.ladderMinutes) ? cfg.ladderMinutes.filter((v) => Number.isFinite(v) && v >= 0) : [];
  return l.length ? [...new Set(l)].sort((a, b) => b - a) : [Math.max(0, cfg.leadMinutes)];
}

export class RemindersService {
  constructor(private readonly data: RemindersDataPort, private readonly notifications: NotificationSender, private readonly push?: ReminderPushLike, private readonly templates?: ReminderTemplatePort) {}

  async runDueReminders(nowMs: number = Date.now(), trigger: RunTrigger = 'scheduler'): Promise<RunSummary> {
    const tenants = await this.data.listEnabledTenants();
    const summary: RunSummary = { tenantsProcessed: tenants.length, candidates: 0, sent: 0, blocked: 0, failed: 0 };

    for (const cfg of tenants) {
      const meta = await this.data.tenantMeta(cfg.tenantId);
      const tz = meta.timezone || 'America/New_York';
      // 747: the Postgres path claims every occurrence BEFORE the provider call (see runTenantDispatch)
      if (this.data.dispatch) { await this.runTenantDispatch(this.data.dispatch, cfg, meta, tz, nowMs, trigger, summary); continue; }
      // Oct 21 2026: the LADDER — every rung is its own pass with its own sent-set; a salon without a ladder keeps its
      // single lead_minutes. A rung's firing window is capped at the rung itself, so a 30-minute reminder with the
      // salon's 60-minute window looks 30–60 minutes ahead at most — never 90 minutes early.
      for (const leadMinutes of ladderOf(cfg)) {
        const leadMs = Math.max(0, leadMinutes) * 60_000;
        const windowMs = Math.min(Math.max(1, cfg.windowMinutes), Math.max(5, leadMinutes)) * 60_000;

        // Bound the date query to the local dates the firing window can touch.
        const fromDate = epochToLocalDate(nowMs + leadMs, tz);
        const toDate = epochToLocalDate(nowMs + leadMs + windowMs, tz);
        const rows = await this.data.dueCandidates(cfg.tenantId, fromDate, toDate);

        const userByAppt = new Map<string, string>();
        for (const r of rows) if (r.customerUserId) userByAppt.set(r.appointmentId, r.customerUserId);
        const cands: ReminderCandidate[] = rows.map((r) => {
          const startsAtMs = localDateTimeToEpochMs(r.apptDate, r.startTime, tz);
          const address = cfg.channel === 'email' ? (r.customerEmail || undefined) : (r.customerPhone || undefined);
          // WP-I (§54, §119): the CUSTOMER's language decides the wording — never the staff's, never the salon's POS default
          const language = customerMessageLanguage(r.customerLanguage);
          return { appointmentId: r.appointmentId, startsAtMs, status: r.status, channel: cfg.channel, address, customerName: r.customerName, serviceName: r.serviceName, startLabel: startLabel(startsAtMs, tz, language), language,
            branchId: r.branchId ?? null, customerId: r.customerId ?? null, customerFirstName: r.customerFirstName ?? null, technicianName: r.technicianName ?? null, apptDate: r.apptDate, startTime: r.startTime, services: r.services };
        });

        const sent = new Set(await this.data.listSent(cfg.tenantId, cands.map((c) => c.appointmentId), leadMinutes));
        const due = selectDueReminders(cands, nowMs, { leadMs, windowMs, alreadySent: sent });
        summary.candidates += due.length;

        for (const d of due) {
          let body = buildReminderMessage(d, meta.salonName, cfg.channel, leadMinutes);
          let subject: string | undefined = cfg.channel === 'email' ? reminderSubject(meta.salonName, d.language) : undefined;
          // Message Templates (740): an owner-connected template replaces the built-in text (customer messages are English
          // only — POSLanguage mandate; the language check only matters if that mandate ever changes). A missing value or an
          // unknown token keeps the built-in text — a broken template never reaches a customer. The SMS keeps the STOP line.
          let used: { templateId: string; version: number; subject: string | null; body: string } | null = null;
          if (this.templates && d.language !== 'vi') {
            try {
              const bound = await this.templates.resolve(cfg.tenantId, d.branchId ?? null, cfg.channel);
              if (bound) {
                const values = { customer_first_name: d.customerFirstName || (d.customerName ?? '').trim().split(/\s+/)[0] || null, customer_full_name: d.customerName ?? null, salon_name: meta.salonName,
                  ...this.templates.values({ apptDate: d.apptDate, startTime: d.startTime, services: d.services, technicianName: d.technicianName, appointmentId: d.appointmentId, tz }) };
                const r = this.templates.render({ channel: cfg.channel, subject: bound.subject, body: bound.body }, values);
                if (!r.missing.length && !r.unknown.length && r.text.trim()) { body = r.text; if (cfg.channel === 'email' && r.subject) subject = r.subject; used = bound; }
              }
            } catch (e) { logException(e, { where: 'reminders.template_resolve' }); used = null; }   // template lookup trouble → the built-in text, as before
          }
          let res: { sent: boolean; status: string; reason?: string; id?: string };
          try {
            res = await this.notifications.send({ tenantId: cfg.tenantId, ...SYSTEM_CTX, salonName: meta.salonName }, { channel: cfg.channel, to: d.address!, body, ...(subject ? { subject } : {}), purpose: 'reminder', source: { type: 'appointment', id: d.appointmentId } });   // 741: Notifications links the appointment
          } catch {
            summary.failed++;
            await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'failed', 'provider_error');
            continue; // provider/system error — retry next run, don't mark sent
          }
          if (used && this.templates) {
            summary.fromTemplate = (summary.fromTemplate ?? 0) + 1;
            const masked = cfg.channel === 'sms' ? `••• ${String(d.address ?? '').replace(/\D/g, '').slice(-4)}` : null;
            await this.templates.record({ tenantId: cfg.tenantId, branchId: d.branchId ?? null, templateId: used.templateId, version: used.version, channel: cfg.channel, customerId: d.customerId ?? null, appointmentId: d.appointmentId,
              notificationId: res.id ?? null, recipientMasked: masked, subject: subject ?? null, body, outcome: res.sent ? (res.status === 'simulated' ? 'simulated' : 'submitted') : res.status === 'blocked' ? 'blocked' : 'failed', reason: res.sent ? null : res.reason ?? res.status })
              .catch((e: unknown) => logException(e, { where: 'reminders.template_usage' }));   // the reminder is sent; a usage-row problem is logged, never a resend
          }
          if (res.sent) { summary.sent++; await this.data.markSent(cfg.tenantId, d.appointmentId, leadMinutes); await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'sent'); await this.pushReminder(cfg.tenantId, userByAppt.get(d.appointmentId), d, meta.salonName); }
          else if (res.status === 'blocked' && res.reason === 'opted_out') { summary.blocked++; await this.data.markSent(cfg.tenantId, d.appointmentId, leadMinutes); await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'blocked', 'opted_out'); await this.pushReminder(cfg.tenantId, userByAppt.get(d.appointmentId), d, meta.salonName); }   // SMS opt-out is terminal; the app push (its own OS-level consent) still goes
          else if (res.status === 'blocked') { summary.blocked++; await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'blocked', res.reason ?? res.status); } // e.g. over_limit — retry next run (don't mark sent)
          else { summary.failed++; await this.data.recordAttempt(cfg.tenantId, d.appointmentId, cfg.channel, 'failed', res.reason ?? res.status); }
        }
      }
    }
    return summary;
  }

  /** 747 — one salon, every rung: recover interrupted claims, then for each due occurrence decide (no destination →
   *  skipped; quiet hours → deferred / skipped per policy) or CLAIM it under the appointment's row lock, re-check it right
   *  before the provider call, send, and record the outcome. A claim is unique per (appointment, rung, occurrence), so
   *  overlapping runs / instances / the /jobs route can never send the same reminder twice, and a rescheduled appointment
   *  is a new occurrence with its own reminder. A run record (appointment_reminder_runs) is the durable heartbeat. */
  private async runTenantDispatch(dp: ReminderDispatchPort, cfg: ReminderConfig, meta: { salonName: string }, tz: string, nowMs: number, trigger: RunTrigger, summary: RunSummary): Promise<void> {
    const runId = await dp.startRun(cfg.tenantId, trigger);
    const r = { candidates: 0, submitted: 0, skipped: 0, deferred: 0, failed: 0, cancelled: 0 };
    let error: string | null = null;
    try {
      summary.recovered = (summary.recovered ?? 0) + await dp.recoverStale(cfg.tenantId);
      const qh = await dp.quietHours(cfg.tenantId);
      const quiet = inQuietHours(nowMs, tz, qh);
      for (const leadMinutes of ladderOf(cfg)) {
        const leadMs = Math.max(0, leadMinutes) * 60_000;
        const windowMs = Math.min(Math.max(1, cfg.windowMinutes), Math.max(5, leadMinutes)) * 60_000;
        const fromDate = epochToLocalDate(nowMs + leadMs, tz);
        const toDate = epochToLocalDate(nowMs + leadMs + windowMs, tz);
        const rows = await this.data.dueCandidates(cfg.tenantId, fromDate, toDate);
        const cands = rows.map((x) => this.toCandidate(x, cfg.channel, tz));
        const due = selectDueWindow(cands, nowMs, { leadMs, windowMs });
        // deferred by quiet hours earlier and now possibly past their window: they go when quiet hours end
        if (!quiet) {
          const def = await dp.deferred(cfg.tenantId, leadMinutes);
          if (def.length) {
            const byId = new Map(due.map((d) => [d.appointmentId, d]));
            const missing = def.filter((d) => !byId.has(d.appointmentId));
            if (missing.length) {
              const dates = [...new Set(missing.map((m) => m.occurrenceKey.slice(0, 10)))].sort();
              const more = (await this.data.dueCandidates(cfg.tenantId, dates[0], dates[dates.length - 1])).map((x) => this.toCandidate(x, cfg.channel, tz));
              for (const m of missing) { const c = more.find((x) => x.appointmentId === m.appointmentId && occurrenceKey(x.apptDate, x.startTime) === m.occurrenceKey); if (c) due.push(c); }
            }
          }
        }
        for (const d of due) {
          const occ = occurrenceKey(d.apptDate, d.startTime);
          const base = { tenantId: cfg.tenantId, appointmentId: d.appointmentId, leadMinutes, occurrenceKey: occ, channel: cfg.channel, branchId: d.branchId ?? null, customerId: d.customerId ?? null, intendedSendAtMs: d.startsAtMs - leadMs, apptStartMs: d.startsAtMs, tz };
          if (!d.address) { if (await dp.claim({ ...base, state: 'skipped', reason: 'no_destination' })) r.skipped++; continue; }
          if (quiet && qh && qh.policy !== 'send') {
            if (await dp.claim({ ...base, state: qh.policy === 'skip' ? 'skipped' : 'deferred', reason: 'quiet_hours' })) { if (qh.policy === 'skip') r.skipped++; else r.deferred++; }
            continue;
          }
          const c = await dp.claim({ ...base, state: 'claimed', reason: null });
          if (!c || 'stale' in c || c.state !== 'claimed') continue;   // someone else has it / already decided / the appointment changed
          r.candidates++; summary.candidates++;
          const out = await this.sendClaimed(dp, cfg.tenantId, c.id, d, cfg.channel, meta.salonName, leadMinutes, tz, nowMs, { kind: 'automatic', onTemplate: () => { summary.fromTemplate = (summary.fromTemplate ?? 0) + 1; } });
          if (out === 'submitted') { r.submitted++; summary.sent++; }
          else if (out === 'skipped') { r.skipped++; summary.blocked++; }
          else if (out === 'cancelled') { r.cancelled++; }
          else { r.failed++; summary.failed++; }
          if (out === 'submitted' || out === 'skipped') await this.pushReminder(cfg.tenantId, rows.find((x) => x.appointmentId === d.appointmentId)?.customerUserId ?? undefined, d, meta.salonName);
        }
      }
    } catch (e) { error = (e as Error)?.message?.slice(0, 300) ?? 'run_failed'; logException(e, { where: 'reminders.dispatch_run' }); }
    summary.skipped = (summary.skipped ?? 0) + r.skipped; summary.deferred = (summary.deferred ?? 0) + r.deferred; summary.cancelled = (summary.cancelled ?? 0) + r.cancelled;
    await dp.finishRun(runId, { outcome: error ? (r.submitted ? 'partial' : 'failed') : 'ok', ...r, error }, cfg.tenantId);
  }

  private toCandidate(r: import('./reminders.repository').ApptCandidateRow, channel: 'sms' | 'email', tz: string): ReminderCandidate {
    const startsAtMs = localDateTimeToEpochMs(r.apptDate, r.startTime, tz);
    const address = channel === 'email' ? (r.customerEmail || undefined) : (r.customerPhone || undefined);
    const language = customerMessageLanguage(r.customerLanguage);
    return { appointmentId: r.appointmentId, startsAtMs, status: r.status, channel, address, customerName: r.customerName, serviceName: r.serviceName, startLabel: startLabel(startsAtMs, tz, language), language,
      branchId: r.branchId ?? null, customerId: r.customerId ?? null, customerFirstName: r.customerFirstName ?? null, technicianName: r.technicianName ?? null, apptDate: r.apptDate, startTime: r.startTime, services: r.services };
  }

  /** a claimed occurrence → re-check → provider → outcome. Shared by the sweep and the staff Safe Retry. */
  async sendClaimed(dp: ReminderDispatchPort, tenantId: string, dispatchId: string, d: ReminderCandidate, channel: 'sms' | 'email', salonName: string, leadMinutes: number, tz: string, nowMs: number,
    opts: { kind: 'automatic' | 'manual_retry'; actorUserId?: string | null; idempotencyKey?: string | null; note?: string | null; onTemplate?: () => void }): Promise<'submitted' | 'failed' | 'skipped' | 'cancelled'> {
    if (!(await dp.revalidate(tenantId, dispatchId, nowMs))) return 'cancelled';   // rescheduled / cancelled / staff-cancelled since the claim
    const { body, subject, used } = await this.compose(tenantId, d, channel, salonName, leadMinutes, tz);
    let res: { sent: boolean; status: string; reason?: string; id?: string } | 'threw';
    try {
      res = await this.notifications.send({ tenantId, ...SYSTEM_CTX, salonName }, { channel, to: d.address!, body, ...(subject ? { subject } : {}), customerId: d.customerId ?? undefined, purpose: 'reminder', source: { type: 'appointment', id: d.appointmentId } });
    } catch (e) { logException(e, { where: 'reminders.send' }); res = 'threw'; }
    const o = classifyOutcome(res);
    const notificationId = res !== 'threw' ? res.id ?? null : null;
    await dp.finish(tenantId, dispatchId, { state: o.state, reason: o.reason, notificationId, kind: opts.kind, actorUserId: opts.actorUserId ?? null, idempotencyKey: opts.idempotencyKey ?? null, note: opts.note ?? null });
    if (used && this.templates && res !== 'threw') {
      opts.onTemplate?.();
      const masked = channel === 'sms' ? `••• ${String(d.address ?? '').replace(/\D/g, '').slice(-4)}` : null;
      await this.templates.record({ tenantId, branchId: d.branchId ?? null, templateId: used.templateId, version: used.version, channel, customerId: d.customerId ?? null, appointmentId: d.appointmentId,
        notificationId, recipientMasked: masked, subject: subject ?? null, body, outcome: res.sent ? (res.status === 'simulated' ? 'simulated' : 'submitted') : res.status === 'blocked' ? 'blocked' : 'failed', reason: res.sent ? null : res.reason ?? res.status })
        .catch((e: unknown) => logException(e, { where: 'reminders.template_usage' }));
    }
    return o.state;
  }

  /** the reminder text: the salon's connected template when every value is present, else the built-in text */
  async compose(tenantId: string, d: ReminderCandidate, channel: 'sms' | 'email', salonName: string, leadMinutes: number, tz: string): Promise<{ body: string; subject: string | undefined; used: { templateId: string; version: number; subject: string | null; body: string } | null }> {
    let body = buildReminderMessage(d, salonName, channel, leadMinutes);
    let subject: string | undefined = channel === 'email' ? reminderSubject(salonName, d.language) : undefined;
    let used: { templateId: string; version: number; subject: string | null; body: string } | null = null;
    if (this.templates && d.language !== 'vi') {
      try {
        const bound = await this.templates.resolve(tenantId, d.branchId ?? null, channel);
        if (bound) {
          const values = { customer_first_name: d.customerFirstName || (d.customerName ?? '').trim().split(/\s+/)[0] || null, customer_full_name: d.customerName ?? null, salon_name: salonName,
            ...this.templates.values({ apptDate: d.apptDate, startTime: d.startTime, services: d.services, technicianName: d.technicianName, appointmentId: d.appointmentId, tz }) };
          const rr = this.templates.render({ channel, subject: bound.subject, body: bound.body }, values);
          if (!rr.missing.length && !rr.unknown.length && rr.text.trim()) { body = rr.text; if (channel === 'email' && rr.subject) subject = rr.subject; used = bound; }
        }
      } catch (e) { logException(e, { where: 'reminders.template_resolve' }); used = null; }
    }
    return { body, subject, used };
  }

  /** the candidate for one appointment (the staff retry / preview): null when it is no longer a booked appointment */
  async candidateFor(tenantId: string, appointmentId: string, channel: 'sms' | 'email', tz: string, apptDate: string): Promise<ReminderCandidate | null> {
    const rows = await this.data.dueCandidates(tenantId, apptDate, apptDate);
    const r = rows.find((x) => x.appointmentId === appointmentId);
    return r ? this.toCandidate(r, channel, tz) : null;
  }
  get dispatchPort(): ReminderDispatchPort | undefined { return this.data.dispatch; }
  async meta(tenantId: string) { return this.data.tenantMeta(tenantId); }

  /** Fires ONLY on the terminal outcomes (sent / opted_out) — those are the passes that markSent, so the sent-set
   *  guarantees at most one push per appointment; provider-error retries never reach here. Walk-ins without a linked
   *  account (no user_id) are skipped silently. Never throws. */
  private async pushReminder(tenantId: string, userId: string | undefined, d: ReminderCandidate, salonName?: string): Promise<void> {
    if (!this.push || !userId) return;
    try {
      const msg = reminderPush(salonName, d.startLabel, d.language);
      await this.push.dispatchToUser(tenantId, userId, {
        title: msg.title,
        body: msg.body,
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
  async updateConfig(tenantId: string, patch: { enabled?: boolean; leadMinutes?: number; windowMinutes?: number; channel?: 'sms' | 'email'; ladderMinutes?: number[] | null }): Promise<ReminderConfig> {
    if (!tenantId) throw new ValidationError('No tenant');
    const clean: Partial<ReminderConfig> = {};
    if (patch.ladderMinutes !== undefined) {
      if (patch.ladderMinutes === null) clean.ladderMinutes = null;
      else {
        if (!Array.isArray(patch.ladderMinutes)) throw withCode(new ValidationError('ladder must be a list of minutes before the appointment'), 'REMINDER_LADDER_INVALID');
        const rungs = Array.from(new Set(patch.ladderMinutes.map((x) => Math.floor(Number(x))))).filter((v) => Number.isFinite(v)).sort((a, b) => b - a);
        if (rungs.length < 1 || rungs.length > 5) throw withCode(new ValidationError('ladder must have 1–5 rungs'), 'REMINDER_LADDER_INVALID');
        if (rungs.some((v) => v < 5 || v > 20160)) throw withCode(new ValidationError('each ladder rung must be 5 minutes – 14 days before the appointment'), 'REMINDER_LADDER_INVALID');
        clean.ladderMinutes = rungs;
      }
    }
    if (patch.enabled !== undefined) clean.enabled = !!patch.enabled;
    if (patch.channel !== undefined) {
      if (patch.channel !== 'sms' && patch.channel !== 'email') throw withCode(new ValidationError("channel must be 'sms' or 'email'"), 'CHANNEL_SMS_OR_EMAIL');
      clean.channel = patch.channel;
    }
    if (patch.leadMinutes !== undefined) {
      const v = Math.floor(Number(patch.leadMinutes));
      if (!Number.isFinite(v) || v < 0 || v > 20160) throw withCode(new ValidationError('leadMinutes must be 0–20160 (≤14 days)'), 'REMINDER_TIMING_INVALID');
      clean.leadMinutes = v;
    }
    if (patch.windowMinutes !== undefined) {
      const v = Math.floor(Number(patch.windowMinutes));
      if (!Number.isFinite(v) || v < 5 || v > 1440) throw withCode(new ValidationError('windowMinutes must be 5–1440'), 'REMINDER_TIMING_INVALID');
      clean.windowMinutes = v;
    }
    return this.data.upsertConfig(tenantId, clean);
  }
}
