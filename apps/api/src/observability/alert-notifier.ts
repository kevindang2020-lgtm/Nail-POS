// alert-notifier.ts — Constitution 11 §262–266, §349–351: platform alerts reach a human.
//
// WHO. Email goes to every ACTIVE Super Admin account (their addresses are already in `users`), plus ONCALL_EMAIL if
// set — so email paging works with no configuration beyond SendGrid, which the platform already uses. SMS goes to
// ONCALL_PHONE (E.164) — user accounts store no phone, so that one number has to be given.
//
// WHAT (§103: avoid alert fatigue). P1 (critical) → email + SMS. P2 (high) → email. P3/P4 → the screen only. A page is
// sent when an episode is raised or ESCALATES into a paged severity — never twice for the same severity. §264: an
// unacknowledged P1 (still "unread" after 15 minutes) gets exactly one reminder. §265: when a paged alert resolves, a
// short "resolved" notice follows, so nobody gets out of bed for something already over.
//
// EXACTLY ONCE, across restarts and instances: each send is CLAIMED with a conditional UPDATE … RETURNING. Only the
// instance whose update matched sends. If the send FAILS the claim is released so the next tick retries — at most
// MAX_FAILURES times, then it stops and logs, so a SendGrid outage cannot become a retry storm (§349).
//
// PROVIDERS through the existing sender ports (§350: not hardwired): emailSenderFromEnv / smsSenderFromEnv return
// null when unconfigured, and a null sender is reported as "not configured" — never as sent.
//
// PRIVACY. A page carries the alert's title, SEV level, component, reason and runbook — platform facts, no customer
// data. Health alerts and security signals (§262: cross-tenant → Security + Operations) are both platform alerts
// (tenant_id IS NULL, enforced in every query here). Security alerts get no automatic "resolved" notice: a human
// resolves them, and knows.
import { type EmailSender, type SmsSender } from '@aipowersalon/notifications';
import { log as rootLog, registry } from '@aipowersalon/observability';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { emailSenderFromEnv, smsSenderFromEnv } from '@aipowersalon/super-admin';

const log = rootLog.withContext({ component: 'alert-notifier' });
export const REMINDER_AFTER_MS = 15 * 60_000;
export const MAX_FAILURES = 5;
export const PAGED: Readonly<Record<string, { email: boolean; sms: boolean; sev: string }>> = {
  critical: { email: true, sms: true, sev: 'SEV1' },
  high: { email: true, sms: false, sev: 'SEV2' },
};
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export const pagesSent = registry.counter('aipowersalon_alert_pages_total', 'Alert notifications sent', ['channel', 'kind', 'outcome']);

export function pageText(a: { title: string; severity: string; component: string; message: string }, kind: 'page' | 'reminder' | 'resolved'): { subject: string; body: string; sms: string } {
  const sev = PAGED[a.severity]?.sev ?? a.severity;
  const prefix = kind === 'resolved' ? '[RESOLVED]' : kind === 'reminder' ? `[${sev} — STILL UNACKNOWLEDGED]` : `[${sev}]`;
  const subject = `${prefix} AIPowerSalon: ${a.title}`;
  const body = `${a.message}\n\nComponent: ${a.component}\n` +
    (kind === 'resolved' ? 'This alert has cleared on its own. No action needed unless it returns.\n' : 'Acknowledge it in Super Admin → Alerts; details in Super Admin → System Operations.\n');
  // SMS is short on purpose: title + SEV. The runbook link is in the email.
  const sms = `${prefix} ${a.title}`.slice(0, 300);
  return { subject, body, sms };
}

@Injectable()
export class AlertNotifier {
  /** Seams for tests. Fields, not constructor parameters (Nest DI would try to resolve those). */
  email: EmailSender | null = emailSenderFromEnv();
  sms: SmsSender | null = smsSenderFromEnv();
  env: Record<string, string | undefined> = process.env;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async recipients(): Promise<{ emails: string[]; phone: string | null }> {
    const rows = this.db ? (await sql<{ email: string }>`select email from users where tenant_id is null and role = 'SUPER_ADMIN' and status = 'active' and email is not null`.execute(this.db)).rows : [];
    const extra = (this.env.ONCALL_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean);
    const emails = [...new Set([...rows.map((r) => r.email.trim().toLowerCase()), ...extra.map((e) => e.toLowerCase())])].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const phone = /^\+[1-9]\d{7,14}$/.test((this.env.ONCALL_PHONE || '').trim()) ? this.env.ONCALL_PHONE!.trim() : null;
    return { emails, phone };
  }

  private async deliver(a: any, kind: 'page' | 'reminder' | 'resolved', withSms: boolean): Promise<boolean> {
    const { emails, phone } = await this.recipients();
    const t = pageText({ title: a.title, severity: a.severity, component: a.related_record_id, message: a.message }, kind);
    let delivered = false; let failed = false;
    if (this.email && emails.length) {
      for (const to of emails) {
        try { await this.email.send(to, t.subject, t.body); delivered = true; pagesSent.inc({ channel: 'email', kind, outcome: 'sent' }); }
        catch (e) { failed = true; pagesSent.inc({ channel: 'email', kind, outcome: 'failed' }); log.warn('page.email_failed', { alertId: a.id, error: (e as Error).message }); }
      }
    } else pagesSent.inc({ channel: 'email', kind, outcome: 'not_configured' });
    if (withSms) {
      if (this.sms && phone) {
        try { await this.sms.send(phone, t.sms); delivered = true; pagesSent.inc({ channel: 'sms', kind, outcome: 'sent' }); }
        catch (e) { failed = true; pagesSent.inc({ channel: 'sms', kind, outcome: 'failed' }); log.warn('page.sms_failed', { alertId: a.id, error: (e as Error).message }); }
      } else pagesSent.inc({ channel: 'sms', kind, outcome: 'not_configured' });
    }
    // Never silent: a configured sender with nobody to send to is its own warning (a Super Admin with a tenant_id, or
    // none active, would otherwise make every page vanish).
    if (this.email && emails.length === 0) log.warn('page.no_recipients', { alertId: a.id, hint: 'no active tenant-less SUPER_ADMIN email and no ONCALL_EMAIL' });
    if (!delivered && !failed) log.warn('page.no_channel', { alertId: a.id, kind, hint: 'configure SENDGRID_* (and ONCALL_PHONE for SMS)' });
    return delivered;
  }

  /** One pass: new/escalated pages, P1 reminders, recovery notices. Called by the aggregator after reconcile. */
  async dispatch(now = new Date()): Promise<{ paged: number; reminded: number; recovered: number }> {
    const out = { paged: 0, reminded: 0, recovered: 0 };
    if (!this.db) return out;
    try {
      // 1. Pages: open platform health alerts at a paged severity not yet paged at that severity.
      const due = (await sql<any>`select id, title, message, severity, related_record_id, notified_severity from alerts
          where tenant_id is null and related_module in ('system_health', 'security_signal') and status in ('unread', 'read')
            and severity in ('critical', 'high') and notify_failures < ${MAX_FAILURES}
            and (notified_severity is null or (notified_severity = 'high' and severity = 'critical'))`.execute(this.db)).rows;
      for (const a of due) {
        const claimed = (await sql`update alerts set notified_severity = ${a.severity}, notified_at = ${now}
            where id = ${a.id} and tenant_id is null and notified_severity is not distinct from ${a.notified_severity} returning id`.execute(this.db)).rows.length;
        if (!claimed) continue;                              // another instance got it
        if (await this.deliver(a, 'page', PAGED[a.severity].sms)) out.paged++;
        else if (this.email || this.sms) {
          // Nothing got through although a channel exists: release the claim so the next tick retries, bounded.
          await sql`update alerts set notified_severity = ${a.notified_severity}, notify_failures = notify_failures + 1 where id = ${a.id} and tenant_id is null`.execute(this.db);
        }
      }
      // 2. §264 one reminder for a P1 nobody has acknowledged (still unread) after 15 minutes.
      const stale = (await sql<any>`select id, title, message, severity, related_record_id from alerts
          where tenant_id is null and related_module in ('system_health', 'security_signal') and status = 'unread' and severity = 'critical'
            and notified_at is not null and reminder_sent_at is null and notified_at <= ${new Date(now.getTime() - REMINDER_AFTER_MS)}`.execute(this.db)).rows;
      for (const a of stale) {
        const claimed = (await sql`update alerts set reminder_sent_at = ${now} where id = ${a.id} and tenant_id is null and reminder_sent_at is null returning id`.execute(this.db)).rows.length;
        if (claimed && await this.deliver(a, 'reminder', true)) out.reminded++;
      }
      // 3. §265 recovery: a PAGED alert that has resolved gets one "resolved" notice.
      const cleared = (await sql<any>`select id, title, message, severity, related_record_id from alerts
          where tenant_id is null and related_module = 'system_health' and status = 'resolved'
            and notified_severity is not null and recovery_notified_at is null`.execute(this.db)).rows;
      for (const a of cleared) {
        const claimed = (await sql`update alerts set recovery_notified_at = ${now} where id = ${a.id} and tenant_id is null and recovery_notified_at is null returning id`.execute(this.db)).rows.length;
        if (claimed && await this.deliver(a, 'resolved', PAGED[a.severity]?.sms ?? false)) out.recovered++;
      }
    } catch (e) {
      log.error('page.dispatch_failed', { error: (e as Error).message });    // never an alert about paging (§349)
    }
    return out;
  }
}
