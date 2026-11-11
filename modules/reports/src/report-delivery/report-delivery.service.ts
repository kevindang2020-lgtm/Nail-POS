// report-delivery.service.ts — Daily Summary "Email Report" (send to me now) and "Schedule Report" (my daily / weekly
// e-mail). Batch 9 decision 1 (Nov 10 2026). Consent: the recipient is ALWAYS the signed-in staff member's own account
// address and only they can put themselves on a schedule (see migration 845). The figures are ReportsService.getSales —
// the Sales Report's own numbers under the person's own permissions (financial view required, as on screen).
// Every attempt is logged with its honest outcome: sent / simulated (no provider in this environment) / not_configured /
// failed / skipped — never "sent" when nothing left.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { hasPermission } from '@aipowersalon/permissions';
import { isNotConfiguredSender, isSimulatedSender, type EmailSender } from '@aipowersalon/notifications';
import type { ReportEmailState, ReportEmailSendResult, ReportEmailDelivery, ReportEmailSubscription } from '@aipowersalon/api-contracts/tenant';
import type { ReportsService } from '../reports/reports.service';
import type { ReportsContext } from '../reports/reports.repository';
import { dueOccurrence, renderDailySummaryEmail, SEND_AT_RE, SEND_NOW_PER_HOUR, REPORT_FREQUENCIES, type ReportFrequency, type DeliveryStatus } from './report-delivery.dto';

export class ReportDeliveryError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 429, message: string) { super(message); }
}
type PermCtx = Parameters<typeof hasPermission>[0];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
/** "k***@gmail.com" — the address is the person's own, but a screen never needs it whole */
export const maskEmail = (e: string | null | undefined) => { const [u, d] = String(e ?? '').split('@'); return u && d ? `${u.slice(0, 1)}***@${d}` : null; };
export const senderMode = (s: EmailSender): 'delivers' | 'simulated' | 'not_configured' => (isNotConfiguredSender(s) ? 'not_configured' : isSimulatedSender(s) ? 'simulated' : 'delivers');


export class ReportDeliveryService {
  constructor(readonly db: Kysely<DB>, private readonly reports: ReportsService, private readonly email: EmailSender, private readonly now: () => Date = () => new Date(),
    private readonly scheduleRunning: () => boolean = () => false) {}

  /** full = sending figures (view + financial + export); otherwise just seeing / turning off one's own schedule (view) */
  private need(ctx: ReportsContext, full = true) {
    if (!ctx?.tenantId || !isUuid(ctx.userId)) throw withCode(new ReportDeliveryError(403, 'Sign in to use report e-mail.'), 'AUTH_REQUIRED');
    for (const p of full ? ['pos.reports.view', 'pos.reports.financial_view', 'pos.reports.export'] : ['pos.reports.view']) {
      if (!hasPermission(ctx as unknown as PermCtx, p)) throw withCode(new ReportDeliveryError(403, `You don't have permission for this action (${p}).`), 'PERMISSION_DENIED');
    }
  }
  private branch(ctx: ReportsContext) { return isUuid(ctx.branchId) ? ctx.branchId : null; }

  private async me(tenantId: string, userId: string): Promise<{ email: string | null; active: boolean; salonName: string }> {
    const u = (await sql<{ email: string | null; status: string | null }>`select email, status from users where id = ${userId} and tenant_id = ${tenantId}`.execute(this.db)).rows[0];
    const t = (await sql<{ name: string | null }>`select coalesce(display_name, legal_name) as name from tenants where id = ${tenantId}`.execute(this.db)).rows[0];
    return { email: u?.email ? String(u.email).trim() : null, active: !!u && (u.status == null || u.status === 'active'), salonName: t?.name ?? '' };
  }

  async state(ctx: ReportsContext): Promise<ReportEmailState> {
    this.need(ctx, false);
    const me = await this.me(ctx.tenantId, ctx.userId);
    const sub = (await sql<any>`select id, frequency, send_at, active, consented_at from report_email_subscriptions where tenant_id = ${ctx.tenantId} and owner_user_id = ${ctx.userId} and report_key = 'daily_summary'`.execute(this.db)).rows[0];
    const rows = (await sql<any>`select id, kind, period_from::text as period_from, period_to::text as period_to, status, detail, created_at from report_email_deliveries
      where tenant_id = ${ctx.tenantId} and owner_user_id = ${ctx.userId} order by created_at desc, id desc limit 10`.execute(this.db)).rows;
    return {
      canSend: ['pos.reports.financial_view', 'pos.reports.export'].every((p) => hasPermission(ctx as unknown as PermCtx, p)),
      email: maskEmail(me.email), hasEmail: !!me.email, sender: senderMode(this.email), scheduleRunning: this.scheduleRunning(),
      subscription: sub ? { id: sub.id, frequency: sub.frequency, sendAt: sub.send_at, active: !!sub.active, consentedAt: new Date(sub.consented_at).toISOString() } as ReportEmailSubscription : null,
      deliveries: rows.map((r: any) => ({ id: r.id, kind: r.kind, periodFrom: r.period_from, periodTo: r.period_to, status: r.status, detail: r.detail, createdAt: new Date(r.created_at).toISOString() })) as ReportEmailDelivery[],
    };
  }

  /** "Email Report": the period on screen, to my own address, now. Capped per hour. */
  async sendNow(ctx: ReportsContext, b: { from?: unknown; to?: unknown }): Promise<ReportEmailSendResult> {
    this.need(ctx);
    const from = String(b?.from ?? ''), to = String(b?.to ?? '');
    if (!YMD.test(from) || !YMD.test(to) || from > to) throw withCode(new ReportDeliveryError(400, 'The start date must be on or before the end date.'), 'DATE_RANGE_INVALID');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 92) throw withCode(new ReportDeliveryError(400, 'That date range is too long. Choose a shorter range or export it.'), 'DATE_RANGE_TOO_LARGE');
    const recent = Number((await sql<{ n: number }>`select count(*)::int as n from report_email_deliveries where tenant_id = ${ctx.tenantId} and owner_user_id = ${ctx.userId}
      and kind = 'now' and created_at > now() - interval '1 hour'`.execute(this.db)).rows[0]?.n ?? 0);
    if (recent >= SEND_NOW_PER_HOUR) throw withCode(new ReportDeliveryError(429, 'Too many requests. Please wait a moment and try again.'), 'RATE_LIMITED');
    const id = await this.record(ctx.tenantId, this.branch(ctx), null, ctx.userId, 'now', from, to, null);
    const out = await this.deliver(ctx, id!, from, to, false);
    return { id, ...out };
  }

  /** "Schedule Report": I put MYSELF on a daily / weekly e-mail (consent = this request, by me). */
  async subscribe(ctx: ReportsContext, b: { frequency?: unknown; sendAt?: unknown }): Promise<ReportEmailState> {
    this.need(ctx);
    const frequency = String(b?.frequency ?? '') as ReportFrequency;
    const sendAt = String(b?.sendAt ?? '07:00');
    if (!REPORT_FREQUENCIES.includes(frequency) || !SEND_AT_RE.test(sendAt)) throw withCode(new ReportDeliveryError(400, 'Choose daily or weekly and a whole hour.'), 'VALIDATION_FAILED');
    const me = await this.me(ctx.tenantId, ctx.userId);
    if (!me.email) throw withCode(new ReportDeliveryError(400, 'Your account has no e-mail address. Add one to your profile first.'), 'VALIDATION_FAILED');
    await sql`insert into report_email_subscriptions (tenant_id, branch_id, owner_user_id, report_key, frequency, send_at, active, consented_at, updated_by)
      values (${ctx.tenantId}, ${this.branch(ctx)}, ${ctx.userId}, 'daily_summary', ${frequency}, ${sendAt}, true, now(), ${ctx.userId})
      on conflict (tenant_id, owner_user_id, report_key) do update set frequency = excluded.frequency, send_at = excluded.send_at, branch_id = excluded.branch_id,
        active = true, consented_at = now(), updated_at = now(), updated_by = excluded.updated_by`.execute(this.db);
    return this.state(ctx);
  }

  /** turning it off keeps the row (and its history) — it just stops sending */
  async unsubscribe(ctx: ReportsContext): Promise<ReportEmailState> {
    this.need(ctx, false);
    await sql`update report_email_subscriptions set active = false, updated_at = now(), updated_by = ${ctx.userId}
      where tenant_id = ${ctx.tenantId} and owner_user_id = ${ctx.userId} and report_key = 'daily_summary'`.execute(this.db);
    return this.state(ctx);
  }

  /** the scheduler: every active schedule whose salon-local send hour has passed on a send day, once per occurrence */
  async tick(permissionsFor: (role: string) => string[], limit = 500): Promise<{ sent: number; skipped: number; failed: number }> {
    const subs = (await sql<any>`select s.id, s.tenant_id, s.branch_id, s.owner_user_id, s.frequency, s.send_at, u.role, u.status
      from report_email_subscriptions s left join users u on u.id = s.owner_user_id and u.tenant_id = s.tenant_id
      where s.active = true order by s.tenant_id, s.id limit ${limit}`.execute(this.db)).rows;
    let sent = 0, skipped = 0, failed = 0;
    const now = this.now();
    for (const s of subs) {
      const tz = await branchTimeZone(this.db, s.tenant_id, s.branch_id);
      const occ = dueOccurrence({ id: s.id, frequency: s.frequency, sendAt: s.send_at }, now, tz);
      if (!occ) continue;
      const id = await this.record(s.tenant_id, s.branch_id, s.id, s.owner_user_id, 'scheduled', occ.from, occ.to, occ.key);
      if (!id) continue;   // this occurrence was already recorded (restart / second replica)
      // the person must still be an active staff member who may see the figures — checked at send time, not at sign-up
      const ctx: ReportsContext = { tenantId: s.tenant_id, branchId: s.branch_id ?? '', userId: s.owner_user_id, role: s.role ?? '', permissions: s.role ? permissionsFor(String(s.role)) : [] };
      if (!s.role || (s.status != null && s.status !== 'active')) { await this.finish(id, { status: 'skipped', detail: 'The staff account is no longer active.' }); skipped++; continue; }
      try { this.need(ctx); } catch { await this.finish(id, { status: 'skipped', detail: 'The staff member no longer has permission to see these figures.' }); skipped++; continue; }
      const r = await this.deliver(ctx, id, occ.from, occ.to, true);
      if (r.status === 'failed') failed++; else if (r.status === 'skipped') skipped++; else sent++;
    }
    return { sent, skipped, failed };
  }

  private async record(tenantId: string, branchId: string | null, subId: string | null, userId: string, kind: 'now' | 'scheduled', from: string, to: string, key: string | null): Promise<string | null> {
    const r = await sql<{ id: string }>`insert into report_email_deliveries (tenant_id, branch_id, subscription_id, owner_user_id, kind, period_from, period_to, occurrence_key, updated_by)
      values (${tenantId}, ${branchId}, ${subId}, ${userId}, ${kind}, ${from}, ${to}, ${key}, ${kind === 'now' ? userId : null}) on conflict do nothing returning id`.execute(this.db);
    return r.rows[0]?.id ?? null;
  }
  private async finish(id: string, s: DeliveryStatus, providerId: string | null = null) {
    await sql`update report_email_deliveries set status = ${s.status}, detail = ${s.detail}, provider_id = ${providerId}, updated_at = now() where id = ${id}`.execute(this.db);
  }

  private async deliver(ctx: ReportsContext, id: string, from: string, to: string, scheduled: boolean): Promise<DeliveryStatus> {
    const me = await this.me(ctx.tenantId, ctx.userId);
    if (!me.email) { const s: DeliveryStatus = { status: 'skipped', detail: 'The account has no e-mail address.' }; await this.finish(id, s); return s; }
    const mode = senderMode(this.email);
    if (mode === 'not_configured') { const s: DeliveryStatus = { status: 'not_configured', detail: 'E-mail is not set up for this platform yet — nothing was sent.' }; await this.finish(id, s); return s; }
    try {
      const { kpis } = await this.reports.getSales(ctx, { from, to, preset: 'custom' });
      const mail = renderDailySummaryEmail({ salonName: me.salonName, from, to, kpis, scheduled });
      const r = await this.email.send(me.email, mail.subject, mail.html, { fromName: me.salonName || undefined });
      const s: DeliveryStatus = mode === 'simulated' ? { status: 'simulated', detail: 'Test environment: recorded, not sent (no e-mail provider).' } : { status: 'sent', detail: null };
      await this.finish(id, s, r?.id ?? null);
      return s;
    } catch (e) {
      const s: DeliveryStatus = { status: 'failed', detail: (e as Error)?.message?.startsWith('email_failed') ? 'The e-mail provider refused the message.' : 'The report could not be sent.' };
      await this.finish(id, s);
      return s;
    }
  }
}
