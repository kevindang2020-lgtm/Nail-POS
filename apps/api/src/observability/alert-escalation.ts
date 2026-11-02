// alert-escalation.ts — BUILD_PLAN Phase 14 C (Constitution 11 §262–265): the on-call chain.
//
// WHAT WAS THERE. AlertNotifier (Phase 11) emails every active Super Admin when a platform alert is raised at P1/P2, SMSes
// ONCALL_PHONE for P1, and sends exactly one reminder for an unacknowledged P1. Nobody else is ever told, however long the
// alert sits. §264 asks for primary → secondary → incident commander.
//
// THE CHAIN (§262 routing by component / severity / owner). `oncall_contacts`, ordered by `position`, each covering a set of
// owners (empty = every owner). An alert's owner comes from its component (health-core COMPONENTS), its SLO's component, or
// 'security' for security signals. A paged alert (critical / high, already claimed by AlertNotifier) walks the contacts
// covering its owner:
//   step 1   the first contact, at once (the broadcast page went to every Super Admin at the same time);
//   step n+1 when step n was SENT and nobody acknowledged within ESCALATE_AFTER_MS[severity] (P1 10 min, P2 30 min);
//            at once when step n could not be delivered (failed / channel not configured / quiet hours) — a message
//            nobody received is not a reason to wait;
//   end      one `chain_exhausted` row, logged; the alert stays open on the screen.
// Quiet hours (the contact's own time zone) hold back P2 only. A P1 must reach a human (§263), so it ignores them.
//
// ACKNOWLEDGEMENT (§265: created → acknowledged → resolved). An alert is acknowledged when a human acknowledges it here
// (Super Admin screen, or the link in the email / SMS), or when its status is no longer `unread` (the existing "mark read"
// is how the alerts screen has always acknowledged; the reminder in AlertNotifier uses the same rule). Either stops the chain.
//
// THE LINK. Signed, single-use, expiring: token = base64url({e: escalation id, x: expiry ms, n: 32-byte nonce}) + "." +
// HMAC-SHA256 under ALERT_ACK_SECRET (or a key derived from AUTH_SESSION_SECRET with HKDF — never the session key itself).
// Only SHA-256(nonce) is stored. Redeeming it is one conditional UPDATE (nonce hash matches, not used, not expired), so two
// clicks or two instances redeem it once. GET only shows a confirmation page — mail scanners prefetch links, and a GET
// that acknowledged would let a scanner silence a P1. With no secret or no PUBLIC_API_BASE_URL, no link is sent (the
// message says to acknowledge on the screen) — never an unsigned link.
//
// EXACTLY ONCE across instances: a step is CLAIMED by inserting (alert_id, step) — unique — before anything is sent.
import { emailSenderFromEnv, smsSenderFromEnv, ALERT } from '@aipowersalon/super-admin';
import type { EmailSender, SmsSender } from '@aipowersalon/notifications';
import { log as rootLog, registry, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, canMoveToSql } from '@aipowersalon/database';
import { minutesSinceMidnight, zonedParts } from '@aipowersalon/date-time';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PushService } from '@aipowersalon/communications';
import { sql } from 'kysely';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { COMPONENTS } from './health-core';
import { SLO_COMPONENT } from './slo-core';
import { pageText } from './alert-notifier';

const log = rootLog.withContext({ component: 'alert-escalation' });
export const ESCALATE_EVERY_MS = 60_000;
export const ESCALATE_AFTER_MS: Readonly<Record<string, number>> = { critical: 10 * 60_000, high: 30 * 60_000 };
export const ACK_LINK_TTL_MS = 2 * 3_600_000;
export const CHANNELS = ['email', 'sms', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
export const OWNERS = ['platform', 'payments', 'communications', 'booking', 'realtime', 'ai', 'security'] as const;
export type Outcome = 'sent' | 'failed' | 'not_configured' | 'skipped_quiet_hours' | 'chain_exhausted';

export const escalationSteps = registry.counter('aipowersalon_alert_escalation_steps_total', 'On-call escalation steps', ['channel', 'outcome']);
export const alertAcks = registry.counter('aipowersalon_alert_acknowledgements_total', 'Platform alerts acknowledged', ['via']);

export interface Contact { id: string; position: number; role: string; name: string; channel: Channel; destination: string; owners: string[]; quietStart: string | null; quietEnd: string | null; timezone: string; active: boolean }
export interface StepRow { step: number; outcome: Outcome; notifiedAt: Date; acknowledgedAt: Date | null }

// ── Pure rules (exported for tests) ──────────────────────────────────────────────────────────────────────────────

/** §262: the team an alert routes to. */
export function alertOwner(relatedModule: string | null, relatedRecordId: string | null): string {
  if (relatedModule === 'security_signal') return 'security';
  const key = String(relatedRecordId ?? '');
  const comp = key.startsWith('slo:') ? SLO_COMPONENT[key.slice(4)] : key.startsWith('backup:') ? 'backups' : key;
  return COMPONENTS.find((c) => c.key === comp)?.owner ?? 'platform';
}

/** The contacts an alert's chain walks, in order. */
export function chainFor(contacts: Contact[], owner: string): Contact[] {
  return contacts.filter((c) => c.active && (c.owners.length === 0 || c.owners.includes(owner))).sort((a, b) => a.position - b.position);
}

/** True when `now` is inside the contact's quiet hours (its own time zone; a window may cross midnight). */
export function inQuietHours(c: Pick<Contact, 'quietStart' | 'quietEnd' | 'timezone'>, now: Date): boolean {
  const s = minutesSinceMidnight(c.quietStart), e = minutesSinceMidnight(c.quietEnd);
  if (s === null || e === null || s === e) return false;
  let p; try { p = zonedParts(now, c.timezone || 'UTC'); } catch { p = zonedParts(now, 'UTC'); }
  const m = p.hour * 60 + p.minute;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/**
 * The next step to take for one open, paged, unacknowledged alert — or null to wait. Pure.
 *   no steps yet                         → step 1 now
 *   last step chain_exhausted            → nothing more
 *   last step not delivered              → next step now
 *   last step sent, window not elapsed   → wait
 *   last step sent, window elapsed       → next step (and mark the last one escalated)
 */
export function nextStep(steps: StepRow[], severity: string, now: Date): number | null {
  if (steps.some((s) => s.acknowledgedAt)) return null;
  if (!steps.length) return 1;
  const last = steps.reduce((a, b) => (b.step > a.step ? b : a));
  if (last.outcome === 'chain_exhausted') return null;
  if (last.outcome !== 'sent') return last.step + 1;
  const after = ESCALATE_AFTER_MS[severity];
  if (!after) return null;
  return now.getTime() - last.notifiedAt.getTime() >= after ? last.step + 1 : null;
}

export function maskDestination(channel: string, d: string): string {
  if (channel === 'email') { const [u, h] = d.split('@'); return `${(u ?? '').slice(0, 1)}***@${h ?? ''}`; }
  if (channel === 'sms') return d.length > 4 ? `${d.slice(0, 2)}******${d.slice(-4)}` : '****';
  return `user ${d.slice(0, 8)}…`;
}

export function validDestination(channel: string, d: string): boolean {
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d) && d.length <= 254;
  if (channel === 'sms') return /^\+[1-9]\d{7,14}$/.test(d);
  if (channel === 'push') return /^[0-9a-f-]{36}$/i.test(d);
  return false;
}

// ── The signed, single-use link ──────────────────────────────────────────────────────────────────────────────

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The HMAC key, or null when nothing to sign with is configured (then no link is ever sent). */
export function ackKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const own = (env.ALERT_ACK_SECRET || '').trim();
  if (own.length >= 32) return Buffer.from(own);
  const session = (env.AUTH_SESSION_SECRET || '').trim();
  if (session.length >= 32) return Buffer.from(hkdfSync('sha256', session, 'aipowersalon', 'alert-ack-link/v1', 32));
  return null;
}

export function signAckToken(key: Buffer, escalationId: string, expiresAtMs: number, nonce: string): string {
  const body = b64u(JSON.stringify({ e: escalationId, x: expiresAtMs, n: nonce }));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

/** Verifies the signature and expiry only (single use is the database's job). Constant-time. */
export function verifyAckToken(key: Buffer | null, token: string, now: number): { ok: true; escalationId: string; nonce: string } | { ok: false; reason: 'not_configured' | 'malformed' | 'bad_signature' | 'expired' } {
  if (!key) return { ok: false, reason: 'not_configured' };
  const [body, sig, extra] = String(token ?? '').split('.');
  if (!body || !sig || extra !== undefined || body.length > 400) return { ok: false, reason: 'malformed' };
  const want = createHmac('sha256', key).update(body).digest();
  let got: Buffer; try { got = Buffer.from(sig, 'base64url'); } catch { return { ok: false, reason: 'malformed' }; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad_signature' };
  let p: any; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (typeof p?.e !== 'string' || typeof p?.n !== 'string' || typeof p?.x !== 'number') return { ok: false, reason: 'malformed' };
  if (p.x <= now) return { ok: false, reason: 'expired' };
  return { ok: true, escalationId: p.e, nonce: p.n };
}

export type AckResult = { ok: true; alertTitle: string } | { ok: false; reason: 'not_configured' | 'malformed' | 'bad_signature' | 'expired' | 'used_or_unknown' };

// ── The service ──────────────────────────────────────────────────────────────────────────────────────────────

const toContact = (r: any): Contact => ({ id: r.id, position: Number(r.position), role: r.role, name: r.name, channel: r.channel, destination: r.destination,
  owners: Array.isArray(r.owners) ? r.owners : [], quietStart: r.quiet_start ?? null, quietEnd: r.quiet_end ?? null, timezone: r.timezone, active: !!r.active });

@Injectable()
export class AlertEscalation implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** Seams for tests. Fields, not constructor parameters (Nest DI would try to resolve those). */
  email: EmailSender | null = emailSenderFromEnv();
  sms: SmsSender | null = smsSenderFromEnv();
  push: { dispatchToUser(t: string | null, u: string, m: { title: string; body: string; reference?: string; category?: 'BUSINESS_ALERT' }): Promise<{ sent: number; tokens: number }> } | null = null;
  env: Record<string, string | undefined> = process.env;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly moduleRef?: ModuleRef) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // paging is the critical class, like the aggregator that raises the alerts
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void runTick({ jobType: 'alerts.escalate', jobClass: 'critical', everyMs: ESCALATE_EVERY_MS }, () => this.tick()).catch(() => undefined); }, ESCALATE_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private pushPort() {
    if (this.push) return this.push;
    // Resolved lazily from the application's container: PushModule is not imported here; without it the push channel is
    // "not configured" — never a pretend send.
    try { return (this.moduleRef?.get(PushService, { strict: false }) as any) ?? null; } catch { return null; }
  }

  async contacts(): Promise<Contact[]> {
    if (!this.db) return [];
    return (await sql<any>`select id, position, role, name, channel, destination, owners, quiet_start, quiet_end, timezone, active, updated_at from oncall_contacts order by position, created_at`.execute(this.db)).rows.map(toContact);
  }

  private ackUrl(token: string): string | null {
    const base = (this.env.PUBLIC_API_BASE_URL || this.env.APS_API_BASE || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//.test(base) ? `${base}/api/v1/public/alert-ack?t=${encodeURIComponent(token)}` : null;
  }

  /** One pass over every open, paged, unacknowledged platform alert. Never throws (§349: no alert about alerting). */
  async tick(now = new Date()): Promise<{ steps: number }> {
    let steps = 0;
    if (!this.db) return { steps };
    try {
      const open = (await sql<any>`select id, title, message, severity, related_module, related_record_id from alerts
          where tenant_id is null and related_module in ('system_health', 'security_signal') and status = 'unread'
            and severity in ('critical', 'high') and notified_at is not null
          order by created_at limit 200`.execute(this.db)).rows;
      if (!open.length) return { steps };
      const contacts = await this.contacts();
      for (const a of open) steps += await this.advance(a, contacts, now);
    } catch (e) { log.error('escalation.tick_failed', { error: (e as Error).message }); }
    return { steps };
  }

  private async advance(a: any, contacts: Contact[], now: Date): Promise<number> {
    let taken = 0;
    const chain = chainFor(contacts, alertOwner(a.related_module, a.related_record_id));
    for (let guard = 0; guard <= chain.length + 1; guard++) {
      const rows = (await sql<any>`select step, outcome, notified_at, acknowledged_at from alert_escalations where alert_id = ${a.id} order by step`.execute(this.db)).rows
        .map((r: any): StepRow => ({ step: Number(r.step), outcome: r.outcome, notifiedAt: new Date(r.notified_at), acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at) : null }));
      const step = nextStep(rows, a.severity, now);
      if (step === null) return taken;
      const contact = chain[step - 1] ?? null;
      const id = (await sql<{ id: string }>`insert into alert_escalations (alert_id, step, contact_id, contact_name, channel, outcome, notified_at)
          values (${a.id}, ${step}, ${contact?.id ?? null}, ${contact?.name ?? null}, ${contact?.channel ?? null}, ${contact ? 'failed' : 'chain_exhausted'}, ${now})
          on conflict (alert_id, step) do nothing returning id`.execute(this.db)).rows[0]?.id;
      if (!id) return taken;                                           // another instance claimed this step
      if (step > 1) await sql`update alert_escalations set escalated_at = ${now} where alert_id = ${a.id} and step = ${step - 1} and escalated_at is null`.execute(this.db);
      taken++;
      if (!contact) { escalationSteps.inc({ channel: 'none', outcome: 'chain_exhausted' }); log.warn('escalation.chain_exhausted', { alertId: a.id, steps: step - 1 }); return taken; }
      const outcome = await this.deliver(a, contact, id, step, now);
      await sql`update alert_escalations set outcome = ${outcome} where id = ${id}`.execute(this.db);
      escalationSteps.inc({ channel: contact.channel, outcome });
      if (outcome === 'sent') { log.warn('escalation.step_sent', { alertId: a.id, step, role: contact.role, channel: contact.channel }); return taken; }
      // Not delivered: move straight on to the next contact in this same pass.
    }
    return taken;
  }

  private async deliver(a: any, c: Contact, escalationId: string, step: number, now: Date): Promise<Outcome> {
    if (a.severity !== 'critical' && inQuietHours(c, now)) return 'skipped_quiet_hours';
    let link: string | null = null;
    if (c.channel !== 'push') {
      const key = ackKey(this.env);
      if (key) {
        const nonce = b64u(randomBytes(32)); const exp = now.getTime() + ACK_LINK_TTL_MS;
        const url = this.ackUrl(signAckToken(key, escalationId, exp, nonce));
        if (url) {
          await sql`update alert_escalations set ack_nonce_hash = ${sha256(nonce)}, ack_expires_at = ${new Date(exp)} where id = ${escalationId}`.execute(this.db);
          link = url;
        }
      }
    }
    const t = pageText({ title: a.title, severity: a.severity, component: a.related_record_id, message: a.message }, step === 1 ? 'page' : 'reminder');
    const who = `You are step ${step} of the on-call chain (${c.role.replace('_', ' ')}).`;
    const ack = link ? `Acknowledge (one use, expires in ${ACK_LINK_TTL_MS / 3_600_000} h): ${link}` : 'Acknowledge it in Super Admin → On-call.';
    try {
      if (c.channel === 'email') {
        if (!this.email) return 'not_configured';
        await this.email.send(c.destination, t.subject, `${who}\n\n${t.body}\n${ack}\n`);
      } else if (c.channel === 'sms') {
        if (!this.sms) return 'not_configured';
        await this.sms.send(c.destination, `${t.sms}${link ? ` Ack: ${link}` : ''}`.slice(0, 600));
      } else {
        const p = this.pushPort();
        if (!p) return 'not_configured';
        const r = await p.dispatchToUser(null, c.destination, { title: t.subject.slice(0, 120), body: who, reference: 'oncall_alert', category: 'BUSINESS_ALERT' });
        if (!r.tokens) return 'not_configured';
        if (!r.sent) return 'failed';
      }
      return 'sent';
    } catch (e) {
      log.warn('escalation.send_failed', { alertId: a.id, step, channel: c.channel, error: (e as Error).message });
      return 'failed';
    }
  }

  /** Super Admin screen acknowledgement. Idempotent; consumes every outstanding link of the alert. */
  async acknowledge(alertId: string, userId: string | null, now = new Date()): Promise<{ acknowledged: boolean }> {
    if (!this.db) return { acknowledged: false };
    const a = (await sql<any>`select id, status from alerts where id = ${alertId} and tenant_id is null`.execute(this.db)).rows[0];
    if (!a) return { acknowledged: false };
    await this.markAcknowledged(alertId, now);
    await sql`update alert_escalations set acknowledged_at = ${now}, acknowledged_by = ${userId}, acknowledged_via = 'screen'
              where alert_id = ${alertId} and acknowledged_at is null
                and step = (select max(step) from alert_escalations where alert_id = ${alertId})`.execute(this.db);
    alertAcks.inc({ via: 'screen' });
    return { acknowledged: true };
  }

  /** The emailed link. One conditional UPDATE: the nonce matches, the link is unused and unexpired. */
  async acknowledgeByToken(token: string, now = new Date()): Promise<AckResult> {
    const v = verifyAckToken(ackKey(this.env), token, now.getTime());
    if (!v.ok) return v;
    if (!this.db) return { ok: false, reason: 'used_or_unknown' };
    const row = (await sql<{ alert_id: string }>`update alert_escalations set ack_used_at = ${now},
          acknowledged_at = coalesce(acknowledged_at, ${now}), acknowledged_via = coalesce(acknowledged_via, 'email_link')
        where id = ${v.escalationId} and ack_nonce_hash = ${sha256(v.nonce)} and ack_used_at is null and ack_expires_at > ${now}
        returning alert_id`.execute(this.db)).rows[0];
    if (!row) return { ok: false, reason: 'used_or_unknown' };
    await this.markAcknowledged(row.alert_id, now);
    alertAcks.inc({ via: 'email_link' });
    const title = (await sql<{ title: string }>`select title from alerts where id = ${row.alert_id} and tenant_id is null`.execute(this.db)).rows[0]?.title ?? 'Alert';
    log.warn('escalation.acknowledged_by_link', { alertId: row.alert_id, escalationId: v.escalationId });
    return { ok: true, alertTitle: title };
  }

  /** Is this token one a human could still redeem? (the GET confirmation page; changes nothing) */
  async peekToken(token: string, now = new Date()): Promise<AckResult> {
    const v = verifyAckToken(ackKey(this.env), token, now.getTime());
    if (!v.ok) return v;
    if (!this.db) return { ok: false, reason: 'used_or_unknown' };
    const r = (await sql<{ title: string }>`select a.title from alert_escalations e join alerts a on a.id = e.alert_id
        where a.tenant_id is null and e.id = ${v.escalationId} and e.ack_nonce_hash = ${sha256(v.nonce)} and e.ack_used_at is null and e.ack_expires_at > ${now}`.execute(this.db)).rows[0];
    return r ? { ok: true, alertTitle: r.title } : { ok: false, reason: 'used_or_unknown' };
  }

  private async markAcknowledged(alertId: string, now: Date): Promise<void> {
    await sql`update alerts set status = 'read', read_at = ${now}, updated_at = ${now}
              where id = ${alertId} and tenant_id is null and status = 'unread' and ${canMoveToSql(ALERT, 'read')}`.execute(this.db);
    await sql`update alert_escalations set ack_used_at = ${now} where alert_id = ${alertId} and ack_used_at is null`.execute(this.db);
  }

  /** The screen: open paged alerts with their chain (§265 created → acknowledged → resolved). */
  async board(now = new Date()) {
    if (!this.db) return { alerts: [] };
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const alerts = (await sql<any>`select id, title, severity, status, related_module, related_record_id, created_at, notified_at, read_at, resolved_at from alerts
        where tenant_id is null and related_module in ('system_health', 'security_signal') and severity in ('critical', 'high')
          and (status in ('unread', 'read') or created_at >= ${since})
        order by (status in ('unread', 'read')) desc, created_at desc limit 50`.execute(this.db)).rows;
    const ids = alerts.map((a: any) => a.id);
    const steps = ids.length ? (await sql<any>`select e.alert_id, e.step, e.contact_name, e.channel, e.outcome, e.notified_at, e.escalated_at, e.acknowledged_at, e.acknowledged_via
        from alert_escalations e where e.alert_id in (${sql.join(ids.map((i: string) => sql`${i}`))}) order by e.step`.execute(this.db)).rows : [];
    const iso = (d: any) => (d ? new Date(d).toISOString() : null);
    return {
      alerts: alerts.map((a: any) => {
        const chain = steps.filter((s: any) => s.alert_id === a.id);
        const ackRow = chain.find((s: any) => s.acknowledged_at);
        return {
          id: a.id, title: a.title, severity: a.severity, status: a.status, owner: alertOwner(a.related_module, a.related_record_id),
          createdAt: iso(a.created_at), notifiedAt: iso(a.notified_at), resolvedAt: iso(a.resolved_at),
          acknowledgedAt: iso(ackRow?.acknowledged_at) ?? (a.status !== 'unread' ? iso(a.read_at) : null), acknowledgedVia: ackRow?.acknowledged_via ?? (a.status !== 'unread' ? 'alerts_screen' : null),
          steps: chain.map((s: any) => ({ step: Number(s.step), contact: s.contact_name, channel: s.channel, outcome: s.outcome, notifiedAt: iso(s.notified_at), escalatedAt: iso(s.escalated_at) })),
        };
      }),
    };
  }
}
