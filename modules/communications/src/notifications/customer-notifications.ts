// customer-notifications.ts — Communications → Customer Notifications (/tenant/communications/notifications), "Customer
// Notifications Complete Build Guide" (30 Oct 2026). It READS the one message ledger (`notifications`) and the existing
// readiness / opt-out / inbox / appointment / follow-up / receipt records — no second send path, no copied tables:
//   notifications                     one row per send attempt (status, provider id + error code, delivered_at, branch, source)
//   notification_delivery_events      verified provider callbacks, append-only (741)
//   notification_consent_events       opt-out / opt-in history, append-only (741); notification_opt_outs = current state
//   notification_retry_requests       authorized, idempotent resends (741) — a resend is a NEW ledger row (retry_of_notification_id)
//   owner_alerts (messaging_failure)  incidents: one open per (rule, channel[, family]); acknowledged / resolved through the
//                                     existing /owner/alerts/:id/acknowledge|resolve lifecycle (OWNER_ALERT machine, analytics)
//   TenantMessagingReadinessService   Twilio account / sender / registration / webhook state (read; "Check health" = its check)
//   TENANT_MESSENGER (NotificationsService.sendSms / send)  the ONLY way a retry reaches a customer
//
// Rules (guide §05–§12, §14): Sent = the provider accepted it (never "delivered"); Delivered only on a provider callback; no
// callback for 24 h = Unknown, never green. Counts are distinct ledger rows, scoped to the salon (and branch when chosen) and the
// labelled window + date basis. Recipients and bodies are masked unless the viewer may manage communications. A retry is one
// confirmed, idempotent, re-checked attempt per failed row (purpose, consent, current contact, setup) — never a bulk resend,
// never for marketing or one-time codes, and the original failure stays visible.
import { sql, type Kysely } from 'kysely';
import { HttpException, HttpStatus } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { logException } from '@aipowersalon/observability';
import { tenantTimeZone } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { recordAuditStrict } from '@aipowersalon/audit';
import type { TenantSmsRequest, TenantSendResult } from '@aipowersalon/notifications';
import {
  classifyFailure, sanitizeProviderText, displayState, maskRecipient, isE164, detectFromStats, normalizeAlertSettings,
  DEFAULT_ALERT_SETTINGS, FAILURE_CATEGORIES, UNKNOWN_AFTER_MS, type AlertSettings, type FailureCategory, type Detection, type WindowStats,
} from './notification-failures';

type AuditActor = Parameters<typeof recordAuditStrict>[1];
export interface CnContext { tenantId: string; branchId?: string | null; userId?: string; role?: string; permissions?: string[]; salonName?: string }
type PermCtx = Parameters<typeof hasPermission>[0];
const can = (ctx: CnContext, perm: string) => hasPermission(ctx as unknown as PermCtx, perm);

export const CN_TABS = ['all', 'sms', 'email', 'failed', 'blocked', 'pending', 'unknown', 'delivered'] as const;
export const CN_BASES = ['created', 'delivered', 'callback'] as const;
export const CN_SORTS = ['newest', 'oldest'] as const;
export const CN_TYPES = ['receipt', 'reminder', 'followup', 'marketing', 'account', 'notification', 'conversation', 'unknown'] as const;
export const CN_STATUSES = ['sent', 'delivered', 'failed', 'blocked', 'simulated'] as const;
export const CN_TIMELINE_CHANNELS = ['all', 'sms', 'email', 'booking', 'follow_up', 'receipt'] as const;

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const oneOf = <T extends readonly string[]>(v: unknown, list: T, d: T[number]): T[number] => ((list as readonly string[]).includes(String(v ?? '')) ? String(v) as T[number] : d);
function paging(page: unknown, pageSize: unknown, def = 20) { const ps = Math.trunc(Number(pageSize)) || def; return { page: Math.max(1, Math.min(100_000, Math.trunc(Number(page)) || 1)), pageSize: [10, 20, 50].includes(ps) ? ps : def }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }

export class CnError extends Error {
  code: string; status: number; extra: Record<string, unknown>;
  constructor(msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) { super(msg); this.name = 'CnError'; this.code = code; this.status = status; this.extra = extra; }
}
const err = (msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) => withCode(new CnError(msg, code, status, extra), code as Parameters<typeof withCode>[1]);
export function asHttp(e: unknown): never {
  if (e instanceof CnError) throw withCode(new HttpException({ code: e.code, message: e.message, ...e.extra }, e.status as HttpStatus), e.code as Parameters<typeof withCode>[1]);
  const coded = e as { apiCode?: string; name?: string; message?: string };
  if (coded?.name === 'ForbiddenError') throw new HttpException({ code: coded.apiCode ?? 'PERMISSION_DENIED', message: coded.message }, HttpStatus.FORBIDDEN);
  if (coded?.name === 'ValidationError') throw new HttpException({ code: coded.apiCode ?? 'VALIDATION_FAILED', message: coded.message }, HttpStatus.BAD_REQUEST);
  throw e;
}

/** the one send path (NotificationsService) and the existing readiness service, both optional (tests pass fakes) */
export interface CnSender {
  sendSms(req: TenantSmsRequest): Promise<TenantSendResult>;
  send(ctx: { tenantId: string; userId: string; role: string; branchId?: string | null; salonName?: string }, req: { channel: 'sms' | 'email'; to: string; subject?: string; body: string; customerId?: string; purpose?: 'notification'; source?: TenantSmsRequest['source'] }): Promise<{ sent: boolean; status: string; reason?: string; id?: string; providerId?: string; simulated?: boolean }>;
}
export interface CnReadinessView {
  generatedAt?: string;
  account?: { state?: string; lastCheckedAt?: string | null; reasonCode?: string | null; fixLink?: string };
  sender?: { state?: string; reasonCode?: string | null; number?: string | null; fixLink?: string };
  a2p?: { state?: string; applicable?: boolean; reasonCode?: string | null; fixLink?: string };
  outbound?: { state?: string; blockers?: string[]; warnings?: string[]; deliveryTracking?: boolean; fixLink?: string };
  inbound?: { state?: string; lastVerifiedEventAt?: string | null; statusCallback?: { state?: string; lastVerifiedEventAt?: string | null; url?: string | null } };
}
export interface CnReadiness {
  readiness(tenantId: string, branchId: string | null, allowedBranches?: string[] | null): Promise<CnReadinessView>;
  healthCheck(actor: { userId: string; tenantId: string }, branchId: string | null, allowedBranches?: string[] | null): Promise<CnReadinessView>;
}

const FIX_ROUTES = {
  messaging_setup: '/tenant/communications/messaging-setup', customer_phone: '/tenant/customers/phone-management', email_setup: '/tenant/communications/email',
  sms_plan: '/tenant/communications/messaging-setup', reminders: '/tenant/communications/reminders', follow_ups: '/follow-ups', inbox: '/tenant/communications/sms',
} as const;

export class CustomerNotificationsCenter {
  private lastEval = new Map<string, number>();
  constructor(private readonly db: Kysely<any>, private readonly sender: CnSender | null = null, private readonly readinessSvc: CnReadiness | null = null,
    private readonly env: Record<string, string | undefined> = process.env, private readonly now: () => number = () => Date.now()) {}

  // ── guards / helpers ────────────────────────────────────────────────────────────────────────────────────────────────
  private need(ctx: CnContext, perm: 'pos.communications.view' | 'pos.communications.manage') {
    if (!ctx?.tenantId || !ctx?.userId) throw err('Not signed in.', 'PERMISSION_DENIED', 403);
    if (!can(ctx, perm)) throw err('You do not have permission to do this.', 'PERMISSION_DENIED', 403);
  }
  private full(ctx: CnContext) { return can(ctx, 'pos.communications.manage'); }
  private actorId(ctx: CnContext) { return ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null; }
  private audit(ctx: CnContext, action: string, id: string | null, summary: string, metadata: Record<string, unknown> = {}, db: Kysely<any> = this.db, status: 'success' | 'failure' = 'success') {
    const actor: AuditActor = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null };
    return recordAuditStrict(db, actor, { module: 'communications', action, resourceType: 'notification', resourceId: id, summary, status, severity: status === 'success' ? 'info' : 'warning', metadata });
  }
  /** a branch filter the viewer may use: their own session branch, or (salon-wide) any branch of this salon */
  private async branchFilter(ctx: CnContext, raw: unknown): Promise<string | null> {
    const b = String(raw ?? '').trim();
    if (!b) return null;
    if (!UUID.test(b)) throw err('Choose a branch from the list.', 'NOTIFICATION_FILTER_INVALID');
    const ok = (await sql<any>`select 1 from branches where tenant_id = ${ctx.tenantId} and id = ${b}`.execute(this.db)).rows.length > 0;
    if (!ok) throw err('Choose a branch from the list.', 'NOTIFICATION_FILTER_INVALID');
    return b;
  }

  async period(ctx: CnContext, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'month') {
    const tz = await tenantTimeZone(this.db, ctx.tenantId);
    // the same clock as every other cut here (pending / unknown / incidents) — one "now" per request
    const nowIso = new Date(this.now()).toISOString();
    const r = (await sql<any>`select to_char((${nowIso}::timestamptz at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', ${nowIso}::timestamptz at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', ${nowIso}::timestamptz at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', ${nowIso}::timestamptz at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, tz, today: String(r.today) };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw err('The start date must be on or before the end date.', 'DATE_RANGE_INVALID');
      return { preset, from, to, tz, today: String(r.today) };
    }
    return { preset, from: String(preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr), to: String(r.today), tz, today: String(r.today) };
  }
  /** salon-local inclusive days: [from 00:00, to + 1 day 00:00) in the salon's zone (DST-safe: the zone does the conversion) */
  private inP(col: any, p: { from: string | null; to: string | null; tz: string }) {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  private basisCol(basis: string) {
    if (basis === 'delivered') return sql`n.delivered_at`;
    if (basis === 'callback') return sql`(select max(e.received_at) from notification_delivery_events e where e.tenant_id = n.tenant_id and e.notification_id = n.id)`;
    return sql`n.created_at`;
  }

  // ── KPIs (§05) ────────────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: CnContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, q, 'month'); const basis = oneOf(q.basis, CN_BASES, 'created');
    const branch = await this.branchFilter(ctx, q.branchId);
    const bw = branch ? sql`n.branch_id = ${branch}` : sql`true`;
    const unknownCut = new Date(this.now() - UNKNOWN_AFTER_MS).toISOString();
    const k = (await sql<any>`select
        count(*) filter (where n.status in ('sent', 'delivered') or (n.status = 'failed' and n.provider_id is not null))::int as accepted,
        count(*) filter (where n.status = 'delivered')::int as delivered,
        count(*) filter (where n.status = 'failed')::int as failed,
        count(*) filter (where n.status = 'blocked')::int as blocked,
        count(*) filter (where n.status = 'sent' and n.created_at >= ${unknownCut}::timestamptz)::int as pending,
        count(*) filter (where n.status = 'sent' and n.created_at < ${unknownCut}::timestamptz)::int as unknown,
        count(*) filter (where n.status = 'simulated')::int as simulated,
        count(*)::int as total
      from notifications n where n.tenant_id = ${T} and ${bw} and ${this.inP(this.basisCol(basis), p)}`.execute(this.db)).rows[0];
    const o = (await sql<any>`select (select count(*)::int from notification_opt_outs where tenant_id = ${T}) as current,
        (select count(*)::int from notification_consent_events e where e.tenant_id = ${T} and e.action = 'opt_out' and e.source <> 'legacy_backfill' and ${this.inP(sql`e.created_at`, p)}) as new_in_window`.execute(this.db)).rows[0];
    // the two original cards, with their original meaning (the last 50 rows), kept so nothing on the old screen silently changes
    const legacy = (await sql<any>`select count(*) filter (where x.status in ('sent', 'delivered'))::int as sent_recent, count(*) filter (where x.status in ('blocked', 'failed'))::int as blocked_failed_recent
      from (select n.status from notifications n where n.tenant_id = ${T} order by n.created_at desc limit 50) x`.execute(this.db)).rows[0];
    const lastCb = (await sql<any>`select max(received_at) as at from notification_delivery_events where tenant_id = ${T}`.execute(this.db)).rows[0];
    const accepted = N(k?.accepted); const delivered = N(k?.delivered);
    const evidenced = delivered + N(k?.failed);
    return {
      kpis: { sent: accepted, delivered, failed: N(k?.failed), blocked: N(k?.blocked), pending: N(k?.pending), unknown: N(k?.unknown), simulated: N(k?.simulated), total: N(k?.total),
        optOutsCurrent: N(o?.current), optOutsNew: N(o?.new_in_window),
        // success rate only when every accepted message has a provider outcome — otherwise "unavailable", never a guess
        deliveryRate: accepted > 0 && N(k?.pending) + N(k?.unknown) === 0 ? Math.round((delivered * 1000) / Math.max(1, evidenced)) / 10 : null },
      legacy: { sentRecent: N(legacy?.sent_recent), blockedFailedRecent: N(legacy?.blocked_failed_recent) },
      window: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today, basis, branchId: branch },
      canManage: this.full(ctx),
      provenance: { computedAt: new Date(this.now()).toISOString(), lastCallbackAt: iso(lastCb?.at), unknownAfterHours: UNKNOWN_AFTER_MS / 3_600_000,
        definitions: {
          sent: 'Accepted by the provider (Twilio / the email provider). Not proof the customer received it.',
          delivered: 'The provider reported delivery to the phone / mailbox.',
          failed: 'The provider or the send pipeline reported a failure.',
          blocked: 'AI PowerSalon did not send it on purpose (opted out, invalid number, not set up, over the SMS limit).',
          pending: 'Accepted, waiting for the provider\'s delivery report (less than 24 hours).',
          unknown: 'Accepted, but no delivery report arrived within 24 hours.',
          optOuts: 'Recipients who are opted out now (current state, all time).',
        } },
    };
  }

  // ── activity list (§06, §07) ─────────────────────────────────────────────────────────────────────────────────────
  // not async: a function resolving to a Kysely RawBuilder is treated as a thenable and throws "don't await RawBuilder"
  private searchWhere(T: string, qRaw: unknown) {
    const q = String(qRaw ?? '').trim().slice(0, 100);
    if (!q) return sql`true`;
    const digits = q.replace(/\D/g, '');
    const parts: any[] = [];
    parts.push(sql`exists (select 1 from customers c where c.tenant_id = n.tenant_id and c.id = n.customer_id
      and (c.full_name ilike ${like(q)} or c.first_name ilike ${like(q)} or c.last_name ilike ${like(q)} or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${like(q)}))`);
    if (q.includes('@')) parts.push(sql`n.to_address ilike ${like(q.toLowerCase())}`);
    if (digits.length >= 4) parts.push(sql`regexp_replace(n.to_address, '[^0-9]', '', 'g') like ${like(digits)}`);
    if (UUID.test(q)) parts.push(sql`(n.id = ${q}::uuid or n.customer_id = ${q}::uuid or n.source_id = ${q} or n.retry_of_notification_id = ${q}::uuid)`);
    if (/^(SM|MM)[0-9a-f]{6,32}$/i.test(q)) parts.push(sql`n.provider_id ilike ${q + '%'}`);
    if (q.length >= 3 && !UUID.test(q)) {
      // a receipt number → its ticket (only receipts of THIS salon); an id fragment of a notification
      parts.push(sql`(n.source_type = 'ticket' and n.source_id in (select r.ticket_id::text from receipts r where r.tenant_id = ${T} and r.receipt_number ilike ${like(q)}))`);
      if (/^[0-9a-f-]{6,36}$/i.test(q)) parts.push(sql`n.id::text like ${q.toLowerCase() + '%'}`);
    }
    return sql`(${sql.join(parts, sql` or `)})`;
  }
  private listWhere(T: string, tab: string, status: string | null, type: string | null, channel: string | null, branch: string | null) {
    const unknownCut = new Date(this.now() - UNKNOWN_AFTER_MS).toISOString();
    const w: any[] = [sql`n.tenant_id = ${T}`];
    if (tab === 'sms' || tab === 'email') w.push(sql`n.channel = ${tab}`);
    if (tab === 'failed') w.push(sql`n.status = 'failed'`);
    if (tab === 'blocked') w.push(sql`n.status = 'blocked'`);
    if (tab === 'delivered') w.push(sql`n.status = 'delivered'`);
    if (tab === 'pending') w.push(sql`(n.status = 'sent' and n.created_at >= ${unknownCut}::timestamptz)`);
    if (tab === 'unknown') w.push(sql`(n.status = 'sent' and n.created_at < ${unknownCut}::timestamptz)`);
    if (status) w.push(sql`n.status = ${status}`);
    if (channel) w.push(sql`n.channel = ${channel}`);
    if (type === 'unknown') w.push(sql`n.purpose is null`); else if (type) w.push(sql`n.purpose = ${type}`);
    if (branch) w.push(sql`n.branch_id = ${branch}`);
    return sql.join(w, sql` and `);
  }
  private rowView(ctx: CnContext, r: any) {
    const full = this.full(ctx);
    const fail = classifyFailure({ status: r.status, channel: r.channel, toAddress: r.to_address, failureReason: r.failure_reason, providerErrorCode: r.provider_error_code, providerStatus: r.provider_status });
    const detail = r.status === 'failed' || r.status === 'blocked' ? sanitizeProviderText(r.failure_reason) : (r.subject ?? null);
    return {
      id: String(r.id), createdAt: iso(r.created_at), channel: r.channel === 'email' ? 'email' : 'sms', type: r.purpose ?? null, status: String(r.status),
      state: displayState({ status: r.status, createdAt: r.created_at, deliveredAt: r.delivered_at }, this.now()),
      customer: r.customer_id ? { id: String(r.customer_id), name: r.customer_name ?? null } : null,
      recipient: full ? String(r.to_address) : maskRecipient(r.channel, r.to_address), recipientMasked: maskRecipient(r.channel, r.to_address),
      recipientValid: r.channel === 'email' ? /@/.test(String(r.to_address)) : isE164(r.to_address),
      detail, providerErrorCode: r.provider_error_code ?? null, deliveredAt: iso(r.delivered_at), branchId: r.branch_id ?? null,
      failure: fail, retryOf: r.retry_of_notification_id ?? null, resent: !!r.resent, source: r.source_type ? { type: r.source_type, id: r.source_id } : null,
    };
  }

  async list(ctx: CnContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, q, 'month');
    const basis = oneOf(q.basis, CN_BASES, 'created'); const tab = oneOf(q.tab, CN_TABS, 'all'); const sort = oneOf(q.sort, CN_SORTS, 'newest');
    const status = q.status ? oneOf(q.status, CN_STATUSES, 'sent') : null; const type = q.type ? oneOf(q.type, CN_TYPES, 'unknown') : null;
    const channel = q.channel === 'sms' || q.channel === 'email' ? String(q.channel) : null;
    const branch = await this.branchFilter(ctx, q.branchId);
    const where = sql`${this.listWhere(T, tab, status, type, channel, branch)} and ${this.inP(this.basisCol(basis), p)} and ${this.searchWhere(T, q.q)}`;
    const { page, pageSize } = paging(q.page, q.pageSize, 20);
    const total = N((await sql<any>`select count(*)::int as n from notifications n where n.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const order = sort === 'oldest' ? sql`n.created_at asc, n.id asc` : sql`n.created_at desc, n.id desc`;
    const rows = (await sql<any>`select n.id, n.created_at, n.channel, n.purpose, n.status, n.customer_id, n.to_address, n.subject, n.failure_reason, n.provider_error_code,
        n.provider_status, n.delivered_at, n.branch_id, n.retry_of_notification_id, n.source_type, n.source_id, c.full_name as customer_name,
        exists (select 1 from notification_retry_requests rr where rr.tenant_id = n.tenant_id and rr.original_notification_id = n.id and rr.outcome in ('sent', 'simulated')) as resent
      from notifications n left join customers c on c.tenant_id = n.tenant_id and c.id = n.customer_id
      where n.tenant_id = ${T} and ${where} order by ${order} limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.rowView(ctx, r)), page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages,
      window: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, basis, tab, sort }, recipientsMasked: !this.full(ctx) };
  }

  // ── one record: details overlay (§07) ─────────────────────────────────────────────────────────────────────────────
  private async mustRow(T: string, id: string) {
    if (!UUID.test(String(id))) throw err('That notification was not found.', 'NOTIFICATION_NOT_FOUND', 404);
    const r = (await sql<any>`select n.id, n.tenant_id, n.channel, n.to_address, n.subject, n.body, n.customer_id, n.status, n.provider_id, n.failure_reason, n.provider_error_code, n.provider_status, n.created_at, n.delivered_at, n.purpose, n.branch_id, n.retry_of_notification_id, n.source_type, n.source_id, n.segment_count, n.sender_route, n.sender_from, c.full_name as customer_name, b.name as branch_name from notifications n
        left join customers c on c.tenant_id = n.tenant_id and c.id = n.customer_id left join branches b on b.tenant_id = n.tenant_id and b.id = n.branch_id
      where n.tenant_id = ${T} and n.id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw err('That notification was not found.', 'NOTIFICATION_NOT_FOUND', 404);
    return r;
  }
  async detail(ctx: CnContext, id: string) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const r = await this.mustRow(T, id); const full = this.full(ctx);
    const events = (await sql<any>`select provider_status, error_code, applied, signature_verified, received_at from notification_delivery_events
      where tenant_id = ${T} and notification_id = ${r.id} order by received_at asc, provider_status asc limit 50`.execute(this.db)).rows;
    // the whole attempt chain: walk up to the first attempt, then every resend below it (bounded)
    let rootId = String(r.id);
    for (let i = 0, cur: any = r; i < 10 && cur?.retry_of_notification_id; i++) {
      rootId = String(cur.retry_of_notification_id);
      cur = (await sql<any>`select id, retry_of_notification_id from notifications where tenant_id = ${T} and id = ${rootId}`.execute(this.db)).rows[0];
    }
    const chain = (await sql<any>`with recursive ch as (
        select n.id, n.retry_of_notification_id, n.status, n.created_at, n.failure_reason, n.provider_error_code, n.channel, n.to_address, 0 as depth from notifications n where n.tenant_id = ${T} and n.id = ${rootId}
        union all select n.id, n.retry_of_notification_id, n.status, n.created_at, n.failure_reason, n.provider_error_code, n.channel, n.to_address, ch.depth + 1 from notifications n join ch on n.retry_of_notification_id = ch.id
          where n.tenant_id = ${T} and ch.depth < 10)
      select id, retry_of_notification_id, status, created_at, failure_reason, provider_error_code, channel, to_address from ch order by created_at asc limit 20`.execute(this.db)).rows;
    const retries = (await sql<any>`select rr.id, rr.outcome, rr.refusal_code, rr.failure_category, rr.created_at, rr.new_notification_id, u.full_name as by_name
      from notification_retry_requests rr left join users u on u.id = rr.requested_by where rr.tenant_id = ${T} and rr.original_notification_id = ${r.id} order by rr.created_at desc limit 20`.execute(this.db)).rows;
    const optedOut = (await sql<any>`select 1 from notification_opt_outs where tenant_id = ${T} and channel = ${r.channel} and address = ${r.to_address} and (scope = 'all' or ${r.purpose === 'marketing'})`.execute(this.db)).rows.length > 0;
    const view = this.rowView(ctx, { ...r, resent: retries.some((x: any) => x.outcome === 'sent' || x.outcome === 'simulated') });
    const failedEv = events.find((e: any) => /fail|undeliver/i.test(String(e.provider_status)));
    const links = this.linksFor(r, view.failure?.action ?? null);
    if (full) await this.audit(ctx, 'notification.viewed', String(r.id), 'Viewed a notification with its full recipient and message', { channel: r.channel }).catch((e) => logException(e, { where: 'customer-notifications.detail.audit' }));
    return {
      ...view,
      header: { category: r.purpose ?? null, state: view.state },
      identity: { customer: view.customer, recipient: view.recipient, branch: r.branch_id ? { id: String(r.branch_id), name: r.branch_name ?? null } : null,
        sender: { route: r.sender_route ?? null, from: r.sender_from ? (full ? String(r.sender_from) : maskRecipient('sms', r.sender_from)) : null } },
      message: { subject: r.subject ?? null, body: full ? String(r.body ?? '') : null, bodyHidden: !full, segments: r.segment_count == null ? null : N(r.segment_count) },
      timing: { createdAt: iso(r.created_at), providerAcceptedAt: r.provider_id ? iso(r.created_at) : null, deliveredAt: iso(r.delivered_at),
        failedAt: r.status === 'failed' ? iso(failedEv?.received_at ?? r.created_at) : null, lastCallbackAt: iso(events.length ? events[events.length - 1].received_at : null),
        unknownSince: view.state === 'unknown' ? new Date(new Date(r.created_at).getTime() + UNKNOWN_AFTER_MS).toISOString() : null },
      diagnostics: { category: view.failure?.category ?? null, rootCause: view.failure?.rootCause ?? null, providerErrorCode: r.provider_error_code ?? null,
        providerStatus: r.provider_status ?? null, message: sanitizeProviderText(r.failure_reason), providerReference: r.provider_id ? `${String(r.provider_id).slice(0, 2)}…${String(r.provider_id).slice(-6)}` : null,
        events: events.map((e: any) => ({ providerStatus: e.provider_status, errorCode: e.error_code ?? null, applied: !!e.applied, signatureVerified: !!e.signature_verified, receivedAt: iso(e.received_at) })) },
      attempts: chain.map((a: any) => ({ id: String(a.id), retryOf: a.retry_of_notification_id ?? null, status: String(a.status), createdAt: iso(a.created_at), current: String(a.id) === String(r.id),
        failure: classifyFailure({ status: a.status, channel: a.channel, toAddress: a.to_address, failureReason: a.failure_reason, providerErrorCode: a.provider_error_code })?.category ?? null })),
      retryRequests: retries.map((x: any) => ({ id: String(x.id), outcome: String(x.outcome), refusalCode: x.refusal_code ?? null, category: x.failure_category, at: iso(x.created_at), newNotificationId: x.new_notification_id ?? null, byName: x.by_name ?? null })),
      consent: { optedOut },
      retry: view.failure ? await this.retryEligibility(ctx, r, retries) : { eligible: false, code: 'NOTIFICATION_RETRY_NOT_FAILED' },
      links,
    };
  }
  private linksFor(r: any, action: string | null) {
    const L: Record<string, string | null> = { customer: null, booking: null, conversation: null, appointmentReminders: null, followUps: null, fix: null };
    if (r.customer_id) { L.customer = `/customers?customerId=${encodeURIComponent(String(r.customer_id))}`; L.booking = `/booking/new?customerId=${encodeURIComponent(String(r.customer_id))}&from=notifications`; }
    if (r.source_type === 'thread' && r.source_id) L.conversation = `${FIX_ROUTES.inbox}?thread=${encodeURIComponent(String(r.source_id))}`;
    else if (r.channel === 'sms' && r.purpose === 'conversation') L.conversation = FIX_ROUTES.inbox;
    if (r.purpose === 'reminder' || r.source_type === 'appointment') L.appointmentReminders = FIX_ROUTES.reminders;
    if (r.purpose === 'followup' || r.source_type === 'follow_up') L.followUps = FIX_ROUTES.follow_ups;
    if (action === 'messaging_setup' || action === 'sms_plan') L.fix = FIX_ROUTES.messaging_setup;
    else if (action === 'customer_phone') L.fix = r.channel === 'email' ? null : FIX_ROUTES.customer_phone;
    else if (action === 'email_setup') L.fix = FIX_ROUTES.email_setup;
    return L;
  }

  // ── smart failed-notification recovery (§10) ─────────────────────────────────────────────────────────────────────
  private async setupFixedSince(ctx: CnContext, since: Date): Promise<{ fixed: boolean; reason: string }> {
    if (!this.readinessSvc) return { fixed: false, reason: 'readiness_unavailable' };
    const v = await this.readinessSvc.readiness(ctx.tenantId, ctx.branchId ?? null).catch((e) => { logException(e, { where: 'customer-notifications.readiness' }); return null; });
    if (!v) return { fixed: false, reason: 'readiness_unavailable' };
    const at = v.account?.lastCheckedAt ? new Date(v.account.lastCheckedAt) : null;
    if (v.account?.state !== 'connected') return { fixed: false, reason: `account_${v.account?.state ?? 'unknown'}` };
    if (!at || at.getTime() <= since.getTime()) return { fixed: false, reason: 'not_rechecked_since_failure' };
    if (v.sender?.state && v.sender.state !== 'assigned') return { fixed: false, reason: `sender_${v.sender.state}` };
    if (v.outbound?.state === 'blocked') return { fixed: false, reason: 'outbound_blocked' };
    return { fixed: true, reason: 'rechecked' };
  }
  private async retryEligibility(ctx: CnContext, r: any, retries: any[] = []): Promise<{ eligible: boolean; code: string | null; category?: FailureCategory }> {
    const f = classifyFailure({ status: r.status, channel: r.channel, toAddress: r.to_address, failureReason: r.failure_reason, providerErrorCode: r.provider_error_code });
    if (!f) return { eligible: false, code: 'NOTIFICATION_RETRY_NOT_FAILED' };
    if (retries.some((x: any) => x.outcome === 'sent' || x.outcome === 'simulated')) return { eligible: false, code: 'NOTIFICATION_RETRY_ALREADY_RESENT', category: f.category };
    if (r.purpose === 'marketing') return { eligible: false, code: 'NOTIFICATION_RETRY_MARKETING', category: f.category };
    if (r.purpose === 'account') return { eligible: false, code: 'NOTIFICATION_RETRY_ACCOUNT_CODE', category: f.category };
    if (this.now() - new Date(r.created_at).getTime() > 72 * 3600_000) return { eligible: false, code: 'NOTIFICATION_RETRY_TOO_OLD', category: f.category };
    // whatever the failure family, a recipient that is not a valid address is never resent to (fix the customer first)
    if (r.channel === 'sms' ? !isE164(r.to_address) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.to_address ?? ''))) return { eligible: false, code: 'NOTIFICATION_RETRY_INVALID_RECIPIENT', category: f.category };
    if (f.retry === 'never') return { eligible: false, code: f.category === 'opted_out' ? 'NOTIFICATION_RETRY_OPTED_OUT' : f.category === 'invalid_destination' ? 'NOTIFICATION_RETRY_INVALID_RECIPIENT' : 'NOTIFICATION_RETRY_NOT_ALLOWED', category: f.category };
    if (f.retry === 'after_fix' && ['auth', 'not_configured', 'sender', 'registration'].includes(f.category) && r.channel === 'sms') {
      const s = await this.setupFixedSince(ctx, new Date(r.created_at));
      if (!s.fixed) return { eligible: false, code: 'NOTIFICATION_RETRY_SETUP_NOT_FIXED', category: f.category };
    }
    return { eligible: true, code: null, category: f.category };
  }

  async failures(ctx: CnContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, q, 'month'); const branch = await this.branchFilter(ctx, q.branchId);
    const rows = (await sql<any>`select n.id, n.status, n.channel, n.to_address, n.failure_reason, n.provider_error_code, n.provider_status, n.created_at, n.purpose
      from notifications n where n.tenant_id = ${T} and n.status in ('failed', 'blocked') and ${branch ? sql`n.branch_id = ${branch}` : sql`true`} and ${this.inP(sql`n.created_at`, p)}
      order by n.created_at desc limit 5000`.execute(this.db)).rows;
    const groups = new Map<string, { category: FailureCategory; channel: string; count: number; latestAt: string | null; firstAt: string | null; sampleIds: string[]; retry: string; action: string; rootCauses: Record<string, number>; example: string | null }>();
    for (const r of rows) {
      const f = classifyFailure({ status: r.status, channel: r.channel, toAddress: r.to_address, failureReason: r.failure_reason, providerErrorCode: r.provider_error_code, providerStatus: r.provider_status })!;
      const key = `${f.category}|${r.channel}`;
      const g: NonNullable<ReturnType<typeof groups.get>> = groups.get(key) ?? { category: f.category, channel: r.channel, count: 0, latestAt: null, firstAt: null, sampleIds: [], retry: f.retry, action: f.action, rootCauses: {}, example: sanitizeProviderText(r.failure_reason, 140) };
      g.count++; if (!g.latestAt) g.latestAt = iso(r.created_at); g.firstAt = iso(r.created_at);
      if (g.sampleIds.length < 6) g.sampleIds.push(String(r.id));
      if (f.rootCause) g.rootCauses[f.rootCause] = (g.rootCauses[f.rootCause] ?? 0) + 1;
      groups.set(key, g);
    }
    const fix = rows.length ? await this.setupFixedSince(ctx, new Date(0)) : null;
    const out = [...groups.values()].sort((a, b) => b.count - a.count).map((g) => ({ ...g,
      fixLink: g.action === 'messaging_setup' || g.action === 'sms_plan' ? FIX_ROUTES.messaging_setup : g.action === 'customer_phone' ? (g.channel === 'email' ? null : FIX_ROUTES.customer_phone) : g.action === 'email_setup' ? FIX_ROUTES.email_setup : null,
      setupNow: ['auth', 'not_configured', 'sender', 'registration', 'geo_permission'].includes(g.category) && fix ? fix.reason : null }));
    return { groups: out, scanned: rows.length, truncated: rows.length >= 5000, window: { preset: p.preset, from: p.from, to: p.to, tz: p.tz }, categories: FAILURE_CATEGORIES };
  }

  async retry(ctx: CnContext, id: string, body: { idempotencyKey?: unknown; confirm?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    const key = String(body?.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 200) throw err('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (body?.confirm !== true) throw err('Confirm the resend first.', 'NOTIFICATION_RETRY_CONFIRM_REQUIRED');
    if (!this.sender) throw err('Sending is not available here.', 'NOTIFICATION_RETRY_UNAVAILABLE', 503);
    const T = ctx.tenantId;
    if (!UUID.test(String(id))) throw err('That notification was not found.', 'NOTIFICATION_NOT_FOUND', 404);
    const replay = (await sql<any>`select id, original_notification_id, new_notification_id, outcome, refusal_code, failure_category from notification_retry_requests where tenant_id = ${T} and idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (replay) {
      if (String(replay.original_notification_id) !== String(id)) throw err('This request id was already used for another notification.', 'IDEMPOTENCY_KEY_REUSED', 409);
      return this.retryResult(replay, true);
    }
    return this.db.transaction().execute(async (trx) => {
      // FOR NO KEY UPDATE: two staff retrying the same row take turns, while the new ledger row (which references this one) can
      // still be written by the sender's own connection — FOR UPDATE would block that foreign-key check and hang the request
      const r = (await sql<any>`select id, tenant_id, channel, to_address, subject, body, customer_id, status, provider_id, failure_reason, provider_error_code, provider_status, created_at, delivered_at, purpose, branch_id, retry_of_notification_id, source_type, source_id, segment_count, sender_route, sender_from from notifications where tenant_id = ${T} and id = ${id} for no key update`.execute(trx)).rows[0];
      if (!r) throw err('That notification was not found.', 'NOTIFICATION_NOT_FOUND', 404);
      const again = (await sql<any>`select id, original_notification_id, new_notification_id, outcome, refusal_code, failure_category from notification_retry_requests where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (again) return this.retryResult(again, true);
      const prior = (await sql<any>`select outcome from notification_retry_requests where tenant_id = ${T} and original_notification_id = ${id}`.execute(trx)).rows;
      const elig = await this.retryEligibility(ctx, r, prior);
      const refuse = async (code: string, category: string) => {
        const row = (await sql<any>`insert into notification_retry_requests (tenant_id, original_notification_id, idempotency_key, failure_category, outcome, refusal_code, requested_by)
          values (${T}, ${id}, ${key}, ${category}, 'refused', ${code}, ${this.actorId(ctx)}::uuid) returning id, original_notification_id, new_notification_id, outcome, refusal_code, failure_category`.execute(trx)).rows[0];
        await this.audit(ctx, 'notification.retry_refused', String(id), `Resend refused: ${code}`, { code, category }, trx, 'failure');
        return this.retryResult(row, false);
      };
      if (!elig.eligible) return refuse(String(elig.code), String(elig.category ?? 'unknown'));
      // the latest effective contact: a customer whose phone / email changed since is not texted at the old address
      if (r.customer_id) {
        const c = (await sql<any>`select normalized_phone, email from customers where tenant_id = ${T} and id = ${r.customer_id}`.execute(trx)).rows[0];
        const current = r.channel === 'email' ? String(c?.email ?? '').trim().toLowerCase() : String(c?.normalized_phone ?? '').trim();
        if (!c || !current || current !== String(r.to_address).trim().toLowerCase()) return refuse('NOTIFICATION_RETRY_CONTACT_CHANGED', String(elig.category));
      }
      // 748: a marketing-only email unsubscribe never blocks resending a receipt / confirmation (scope 'all' always does)
      const opted = (await sql<any>`select 1 from notification_opt_outs where tenant_id = ${T} and channel = ${r.channel} and address = ${r.to_address} and (scope = 'all' or ${r.purpose === 'marketing'})`.execute(trx)).rows.length > 0;
      if (opted) return refuse('NOTIFICATION_RETRY_OPTED_OUT', String(elig.category));
      // the ONE send path; it re-checks opt-out, the SMS allowance and the salon's sender, and writes a new ledger row
      let outcome: 'sent' | 'simulated' | 'blocked' | 'failed'; let newId: string | null = null; let reason: string | null = null;
      if (r.channel === 'sms') {
        const res = await this.sender!.sendSms({ tenantId: T, branchId: r.branch_id ?? ctx.branchId ?? null, to: String(r.to_address), body: String(r.body), purpose: (r.purpose ?? 'notification') as TenantSmsRequest['purpose'],
          customerId: r.customer_id ?? null, meter: r.purpose === 'conversation', requireOwnAccount: r.purpose === 'conversation', source: { type: 'retry', id: String(id) }, retryOf: String(id) });
        outcome = res.sent ? (res.simulated ? 'simulated' : 'sent') : res.status === 'blocked' ? 'blocked' : 'failed'; newId = res.notificationId ?? null; reason = res.reason ?? null;
      } else {
        const res = await this.sender!.send({ tenantId: T, userId: String(ctx.userId), role: String(ctx.role ?? ''), branchId: r.branch_id ?? ctx.branchId ?? null, salonName: ctx.salonName },
          { channel: 'email', to: String(r.to_address), subject: r.subject ?? undefined, body: String(r.body), customerId: r.customer_id ?? undefined, source: { type: 'retry', id: String(id) } });
        outcome = res.sent ? (res.simulated ? 'simulated' : 'sent') : res.status === 'blocked' ? 'blocked' : 'failed'; newId = res.id ?? null; reason = res.reason ?? null;
        if (newId) await sql`update notifications set retry_of_notification_id = ${id} where tenant_id = ${T} and id = ${newId} and retry_of_notification_id is null`.execute(trx);
      }
      const row = (await sql<any>`insert into notification_retry_requests (tenant_id, original_notification_id, new_notification_id, idempotency_key, failure_category, outcome, refusal_code, requested_by)
        values (${T}, ${id}, ${newId}::uuid, ${key}, ${String(elig.category)}, ${outcome}, ${reason ? String(reason).slice(0, 60) : null}, ${this.actorId(ctx)}::uuid) returning id, original_notification_id, new_notification_id, outcome, refusal_code, failure_category`.execute(trx)).rows[0];
      await this.audit(ctx, 'notification.retried', String(id), `Resent a failed ${r.channel === 'email' ? 'email' : 'text'} (${outcome})`, { outcome, category: elig.category, newNotificationId: newId }, trx);
      return this.retryResult(row, false);
    });
  }
  private retryResult(row: any, replayed: boolean) {
    return { requestId: String(row.id), outcome: String(row.outcome), refusalCode: row.refusal_code ?? null, newNotificationId: row.new_notification_id ?? null, category: row.failure_category, replayed };
  }

  // ── opt-outs (§07) ───────────────────────────────────────────────────────────────────────────────────────────────
  async optOuts(ctx: CnContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const full = this.full(ctx); const view = q.view === 'history' ? 'history' : 'current';
    const { page, pageSize } = paging(q.page, q.pageSize, 20);
    const s = String(q.q ?? '').trim().slice(0, 100); const digits = s.replace(/\D/g, '');
    const ch = q.channel === 'sms' || q.channel === 'email' ? String(q.channel) : null;
    const match = (col: any) => (!s ? sql`true` : digits.length >= 4 ? sql`regexp_replace(${col}, '[^0-9]', '', 'g') like ${like(digits)}` : sql`${col} ilike ${like(s.toLowerCase())}`);
    if (view === 'history') {
      const w = sql`e.tenant_id = ${T} and ${ch ? sql`e.channel = ${ch}` : sql`true`} and ${match(sql`e.address`)}`;
      const total = N((await sql<any>`select count(*)::int as n from notification_consent_events e where e.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n);
      const sv = served(page, pageSize, total);
      const rows = (await sql<any>`select e.id, e.channel, e.address, e.action, e.source, e.purpose, e.reason, e.consent_note, e.created_at, u.full_name as by_name
        from notification_consent_events e left join users u on u.id = e.actor_user_id where e.tenant_id = ${T} and ${w} order by e.created_at desc, e.id desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
      return { view, items: rows.map((r: any) => ({ id: String(r.id), channel: r.channel, recipient: full ? r.address : maskRecipient(r.channel, r.address), action: r.action, source: r.source, purpose: r.purpose,
        reason: r.reason ?? null, consentNote: full ? r.consent_note ?? null : (r.consent_note ? '•••' : null), at: iso(r.created_at), byName: r.by_name ?? null })), page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages };
    }
    const w = sql`o.tenant_id = ${T} and ${ch ? sql`o.channel = ${ch}` : sql`true`} and ${match(sql`o.address`)}`;
    const total = N((await sql<any>`select count(*)::int as n from notification_opt_outs o where o.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select o.channel, o.address, o.reason, o.opted_out_at,
        (select e.source from notification_consent_events e where e.tenant_id = o.tenant_id and e.channel = o.channel and e.address = o.address and e.action = 'opt_out' order by e.created_at desc limit 1) as source,
        (select count(*)::int from customers c where c.tenant_id = o.tenant_id and ((o.channel = 'sms' and c.normalized_phone = o.address) or (o.channel = 'email' and lower(c.email) = o.address))) as customers
      from notification_opt_outs o where o.tenant_id = ${T} and ${w} order by o.opted_out_at desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    return { view, items: rows.map((r: any) => {
      const source = r.source === 'legacy_backfill' && r.reason === 'inbound_stop' ? 'inbound_stop' : (r.source ?? (r.reason === 'inbound_stop' ? 'inbound_stop' : 'staff'));
      const customerStop = r.channel === 'sms' && (source === 'inbound_stop' || source === 'phone_change');
      return { channel: r.channel, recipient: full ? r.address : maskRecipient(r.channel, r.address), recipientKey: full ? r.address : null, reason: r.reason ?? null, source, since: iso(r.opted_out_at),
        matchingCustomers: N(r.customers), reOptIn: customerStop ? 'customer_only' : (full ? 'staff_with_note' : 'not_permitted') };
    }), page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages };
  }
  // ── unified customer notification timeline (§11) ─────────────────────────────────────────────────────────────────
  async timeline(ctx: CnContext, customerId: string, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const full = this.full(ctx);
    if (!UUID.test(String(customerId))) throw err('That customer was not found.', 'CUSTOMER_NOT_FOUND', 404);
    const c = (await sql<any>`select id, full_name, first_name, last_name from customers where tenant_id = ${T} and id = ${customerId}`.execute(this.db)).rows[0];
    if (!c) throw err('That customer was not found.', 'CUSTOMER_NOT_FOUND', 404);
    const ch = oneOf(q.channel, CN_TIMELINE_CHANNELS, 'all');
    const limit = 200;
    const items: any[] = [];
    if (ch === 'all' || ch === 'sms' || ch === 'email') {
      const rows = (await sql<any>`select n.id, n.channel, n.purpose, n.status, n.created_at, n.delivered_at, n.to_address, n.subject, n.failure_reason, n.provider_error_code, n.source_type, n.source_id
        from notifications n where n.tenant_id = ${T} and n.customer_id = ${customerId} and ${ch === 'all' ? sql`true` : sql`n.channel = ${ch}`} order by n.created_at desc limit ${limit}`.execute(this.db)).rows;
      for (const r of rows) {
        const state = displayState({ status: r.status, createdAt: r.created_at, deliveredAt: r.delivered_at }, this.now());
        items.push({ kind: 'notification', id: String(r.id), channel: r.channel, direction: 'outbound', at: iso(r.created_at), type: r.purpose ?? null, status: state,
          counterpart: full ? r.to_address : maskRecipient(r.channel, r.to_address), summary: r.status === 'failed' || r.status === 'blocked' ? sanitizeProviderText(r.failure_reason, 120) : (r.subject ?? null),
          failed: r.status === 'failed' || r.status === 'blocked', link: r.source_type === 'thread' && r.source_id ? `${FIX_ROUTES.inbox}?thread=${encodeURIComponent(r.source_id)}` : null });
      }
    }
    if (ch === 'all' || ch === 'sms') {
      const rows = (await sql<any>`select m.id, m.channel, m.created_at, m.status, m.body, t.id as thread_id, t.customer_contact, t.awaiting_reply_since
        from communication_messages m join communication_threads t on t.id = m.thread_id and t.tenant_id = m.tenant_id
        where m.tenant_id = ${T} and t.customer_id = ${customerId} and m.direction = 'inbound' order by m.created_at desc limit ${limit}`.execute(this.db)).rows;
      for (const r of rows) items.push({ kind: 'inbound_message', id: String(r.id), channel: r.channel ?? 'sms', direction: 'inbound', at: iso(r.created_at), type: 'conversation', status: 'received',
        counterpart: full ? r.customer_contact : maskRecipient('sms', r.customer_contact), summary: full ? String(r.body ?? '').slice(0, 160) : null,
        unresolved: !!r.awaiting_reply_since, link: `${FIX_ROUTES.inbox}?thread=${encodeURIComponent(String(r.thread_id))}` });
    }
    if (ch === 'all' || ch === 'booking') {
      const rows = (await sql<any>`select a.id, a.appt_date, a.start_time, a.status, a.created_at, a.updated_at from pos_tech_appointments a
        where a.tenant_id = ${T} and a.customer_id = ${customerId} order by a.created_at desc limit ${limit}`.execute(this.db)).rows;
      const ids = rows.map((r: any) => String(r.id));
      for (const r of rows) items.push({ kind: 'appointment', id: String(r.id), channel: 'booking', direction: 'internal', at: iso(r.created_at), type: 'appointment', status: String(r.status),
        summary: `${String(r.appt_date).slice(0, 10)}${r.start_time ? ' ' + String(r.start_time).slice(0, 5) : ''}`, link: `/booking/new?customerId=${encodeURIComponent(customerId)}&from=notifications` });
      if (ids.length) {
        const rem = (await sql<any>`select r.id, r.appointment_id, r.channel, r.status, r.error, r.created_at from appointment_reminder_attempts r
          where r.tenant_id = ${T} and r.appointment_id = any(${ids}::uuid[]) order by r.created_at desc limit ${limit}`.execute(this.db)).rows;
        for (const r of rem) items.push({ kind: 'reminder_attempt', id: String(r.id), channel: r.channel ?? 'sms', direction: 'outbound', at: iso(r.created_at), type: 'reminder', status: String(r.status),
          summary: r.error ? sanitizeProviderText(r.error, 120) : null, failed: /fail|block/i.test(String(r.status)), link: FIX_ROUTES.reminders });
      }
    }
    if (ch === 'all' || ch === 'follow_up') {
      const rows = (await sql<any>`select f.id, f.status, f.sent_at, f.created_at, f.service_name_snapshot, f.skip_reason from service_follow_up_tasks f
        where f.tenant_id = ${T} and f.customer_id = ${customerId} and f.deleted_at is null order by f.created_at desc limit ${limit}`.execute(this.db)).rows;
      for (const r of rows) items.push({ kind: 'follow_up', id: String(r.id), channel: 'follow_up', direction: 'outbound', at: iso(r.sent_at ?? r.created_at), type: 'followup', status: String(r.status),
        summary: r.service_name_snapshot ?? null, link: FIX_ROUTES.follow_ups });
    }
    if (ch === 'all' || ch === 'receipt') {
      const rows = (await sql<any>`select l.id, l.channel, l.status, l.created_at, l.destination, rc.receipt_number from receipt_delivery_logs l
        join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
        left join lateral (select receipt_number from receipts r where r.tenant_id = l.tenant_id and r.ticket_id = l.ticket_id order by r.created_at desc limit 1) rc on true
        where l.tenant_id = ${T} and t.customer_id = ${customerId} order by l.created_at desc limit ${limit}`.execute(this.db)).rows;
      for (const r of rows) items.push({ kind: 'receipt', id: String(r.id), channel: r.channel ?? 'receipt', direction: 'outbound', at: iso(r.created_at), type: 'receipt', status: String(r.status),
        counterpart: r.destination ? (full ? r.destination : maskRecipient(r.channel === 'email' ? 'email' : 'sms', r.destination)) : null, summary: r.receipt_number ? `Receipt ${r.receipt_number}` : null, failed: /fail|block/i.test(String(r.status)) });
    }
    items.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    const { page, pageSize } = paging(q.page, q.pageSize, 20);
    const sv = served(page, pageSize, items.length);
    if (full) await this.audit(ctx, 'notification.timeline_viewed', String(customerId), 'Viewed a customer\'s notification timeline', { channel: ch }).catch((e) => logException(e, { where: 'customer-notifications.timeline.audit' }));
    return { customer: { id: String(c.id), name: c.full_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') }, channel: ch, items: items.slice(sv.offset, sv.offset + pageSize),
      page: sv.page, pageSize, totalItems: items.length, totalPages: sv.totalPages, capped: items.length >= limit, links: { profile: `/customers?customerId=${encodeURIComponent(customerId)}`, booking: `/booking/new?customerId=${encodeURIComponent(customerId)}&from=notifications` } };
  }

  // ── messaging health (§04, §12) ──────────────────────────────────────────────────────────────────────────────────
  private healthOf(v: CnReadinessView | null) {
    const st = (s: string | undefined, ok: string[], pend: string[]) => (!s ? 'unknown' : ok.includes(s) ? 'ready' : pend.includes(s) ? 'pending' : 'attention');
    return {
      twilio: { state: st(v?.account?.state, ['connected'], ['stale', 'unknown']), detail: v?.account?.state ?? null, reasonCode: v?.account?.reasonCode ?? null, lastCheckedAt: v?.account?.lastCheckedAt ?? null, fixLink: FIX_ROUTES.messaging_setup },
      sender: { state: st(v?.sender?.state, ['assigned'], ['unknown']), detail: v?.sender?.state ?? null, reasonCode: v?.sender?.reasonCode ?? null, fixLink: FIX_ROUTES.messaging_setup },
      registration: { state: v?.a2p?.applicable === false ? 'ready' : st(v?.a2p?.state, ['approved', 'not_applicable'], ['pending', 'unable_to_verify']), detail: v?.a2p?.state ?? null, reasonCode: v?.a2p?.reasonCode ?? null, fixLink: FIX_ROUTES.messaging_setup },
      webhooks: { state: st(v?.inbound?.statusCallback?.state, ['verified'], ['configured', 'untested']), detail: v?.inbound?.statusCallback?.state ?? null, lastVerifiedEventAt: v?.inbound?.statusCallback?.lastVerifiedEventAt ?? null, fixLink: FIX_ROUTES.messaging_setup },
      outbound: { state: st(v?.outbound?.state, ['ready_to_attempt'], ['degraded']), detail: v?.outbound?.state ?? null, blockers: v?.outbound?.blockers ?? [], warnings: v?.outbound?.warnings ?? [] },
    };
  }
  async health(ctx: CnContext) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId;
    const v = this.readinessSvc ? await this.readinessSvc.readiness(T, ctx.branchId ?? null).catch((e) => { logException(e, { where: 'customer-notifications.health' }); return null; }) : null;
    return this.healthBody(T, v, null);
  }
  async checkHealth(ctx: CnContext) {
    this.need(ctx, 'pos.communications.manage');
    if (!this.readinessSvc) throw err('The messaging health check is not available here.', 'NOTIFICATION_HEALTH_UNAVAILABLE', 503);
    const v = await this.readinessSvc.healthCheck({ userId: String(ctx.userId), tenantId: ctx.tenantId }, ctx.branchId ?? null);
    return this.healthBody(ctx.tenantId, v, new Date(this.now()).toISOString());
  }
  private async healthBody(T: string, v: CnReadinessView | null, checkedNowAt: string | null) {
    const unknownCut = new Date(this.now() - UNKNOWN_AFTER_MS).toISOString();
    const own = (await sql<any>`select (select max(received_at) from notification_delivery_events where tenant_id = ${T}) as last_callback,
        (select count(*)::int from notifications where tenant_id = ${T} and status = 'sent' and created_at >= ${unknownCut}::timestamptz) as awaiting,
        (select count(*)::int from notifications where tenant_id = ${T} and status = 'sent' and created_at < ${unknownCut}::timestamptz) as unknown,
        (select min(created_at) from notifications where tenant_id = ${T} and status = 'sent') as oldest_awaiting,
        (select max(created_at) from notifications where tenant_id = ${T} and channel = 'email' and status in ('sent', 'delivered')) as last_email_ok,
        (select count(*)::int from notifications where tenant_id = ${T} and status = 'failed' and created_at >= now() - interval '24 hours') as failed24`.execute(this.db)).rows[0];
    const emailKey = !!String(this.env.SENDGRID_API_KEY ?? '').trim();
    const h = this.healthOf(v);
    return {
      ...h,
      email: { state: emailKey ? 'ready' : 'attention', detail: emailKey ? 'provider_configured' : 'provider_not_configured', lastAcceptedAt: iso(own?.last_email_ok),
        deliveryEvents: 'not_connected', fixLink: FIX_ROUTES.email_setup },
      callbacks: { lastReceivedAt: iso(own?.last_callback), awaiting: N(own?.awaiting), unknown: N(own?.unknown), oldestAwaitingAt: iso(own?.oldest_awaiting),
        state: own?.last_callback ? (N(own?.unknown) > 0 ? 'attention' : 'ready') : 'unknown' },
      worker: { state: 'not_applicable', detail: 'Sends go to the provider when they are made; there is no separate send queue to back up. Unconfirmed deliveries are counted under callbacks.' },
      failedLast24h: N(own?.failed24), readinessAvailable: !!v, generatedAt: v?.generatedAt ?? null, checkedNowAt,
      overall: !v ? 'unknown' : Object.values(h).some((x: any) => x.state === 'attention') ? 'attention' : Object.values(h).some((x: any) => x.state === 'pending' || x.state === 'unknown') ? 'pending' : 'ready',
    };
  }

  // ── automatic messaging failure alerts (§12) ─────────────────────────────────────────────────────────────────────
  async alertSettings(ctx: CnContext) {
    this.need(ctx, 'pos.communications.view');
    const r = (await sql<any>`select settings_json, updated_at from tenant_settings where tenant_id = ${ctx.tenantId} and branch_id is null and category = 'notification_alerts'`.execute(this.db)).rows[0];
    return { settings: normalizeAlertSettings(r?.settings_json), defaults: DEFAULT_ALERT_SETTINGS, updatedAt: iso(r?.updated_at), isDefault: !r };
  }
  async saveAlertSettings(ctx: CnContext, body: Record<string, unknown>) {
    this.need(ctx, 'pos.communications.manage');
    const s = normalizeAlertSettings(body?.settings ?? body);
    await this.db.transaction().execute(async (trx) => {
      await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id, updated_by) values (${ctx.tenantId}, null, 'notification_alerts', ${JSON.stringify(s)}::jsonb, ${this.actorId(ctx)}::uuid, ${this.actorId(ctx)}::uuid)
        on conflict (tenant_id, category) where branch_id is null do update set settings_json = excluded.settings_json, updated_by_user_id = excluded.updated_by_user_id, updated_by = excluded.updated_by, updated_at = now()`.execute(trx);
      await this.audit(ctx, 'notification.alert_settings_saved', null, 'Changed the messaging failure alert thresholds', { settings: s }, trx);
    });
    return this.alertSettings(ctx);
  }
  async incidents(ctx: CnContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId;
    // lazy evaluation on read (at most once a minute per salon) — the background job does the same every 5 minutes
    const last = this.lastEval.get(T) ?? 0;
    if (this.now() - last > 60_000) { this.lastEval.set(T, this.now()); await evaluateMessagingIncidents(this.db, T, { now: this.now(), readiness: this.readinessSvc }).catch((e) => logException(e, { where: 'customer-notifications.incidents.evaluate' })); }
    const status = q.status === 'closed' ? sql`a.status in ('resolved', 'dismissed')` : q.status === 'all' ? sql`true` : sql`a.status in ('new', 'acknowledged', 'in_progress')`;
    const { page, pageSize } = paging(q.page, q.pageSize, 10);
    const total = N((await sql<any>`select count(*)::int as n from owner_alerts a where a.tenant_id = ${T} and a.category = 'messaging_failure' and ${status}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, a.severity, a.status, a.title, a.body, a.metadata, a.created_at, a.updated_at, a.resolved_at, u.full_name as resolved_by
      from owner_alerts a left join users u on u.id = a.resolved_by_user_id where a.tenant_id = ${T} and a.category = 'messaging_failure' and ${status}
      order by (a.status in ('new', 'acknowledged', 'in_progress')) desc, a.updated_at desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => { const m = r.metadata ?? {}; return { id: String(r.id), severity: r.severity, status: r.status, title: r.title, body: r.body, rule: m.rule ?? null, channel: m.channel ?? null,
      category: m.category ?? null, count: N(m.count), firstEventAt: m.firstEventAt ?? null, lastEventAt: m.lastEventAt ?? null, detections: N(m.detections) || 1, openedAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      resolvedAt: iso(r.resolved_at), resolvedBy: r.resolved_by ?? null }; }),
      page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages, canResolve: can(ctx, 'owner.alerts.resolve'), evaluatedAt: iso(this.lastEval.get(T) ?? null) };
  }
}

// ── the evaluator (job + lazy read) ─────────────────────────────────────────────────────────────────────────────────────
const COOLDOWN_MS = 30 * 60_000;
export async function evaluateMessagingIncidents(db: Kysely<any>, tenantId: string, o: { now?: number; readiness?: CnReadiness | null } = {}): Promise<{ opened: number; updated: number; detections: Detection[] }> {
  const now = o.now ?? Date.now();
  const cfgRow = (await sql<any>`select settings_json from tenant_settings where tenant_id = ${tenantId} and branch_id is null and category = 'notification_alerts'`.execute(db)).rows[0];
  const cfg: AlertSettings = normalizeAlertSettings(cfgRow?.settings_json);
  if (!cfg.enabled) return { opened: 0, updated: 0, detections: [] };
  const since = new Date(now - Math.max(cfg.repeatedFailures.windowMinutes, cfg.failureRatio.windowMinutes) * 60_000).toISOString();
  const rows = (await sql<any>`select id, channel, status, to_address, failure_reason, provider_error_code, created_at from notifications
    where tenant_id = ${tenantId} and created_at >= ${since}::timestamptz and created_at <= ${new Date(now).toISOString()}::timestamptz and status <> 'simulated' order by created_at asc limit 5000`.execute(db)).rows;
  const detections: Detection[] = [];
  for (const channel of ['sms', 'email'] as const) {
    const rCut = now - cfg.repeatedFailures.windowMinutes * 60_000; const qCut = now - cfg.failureRatio.windowMinutes * 60_000;
    const byCat = new Map<FailureCategory, { count: number; first: string; last: string }>();
    let attempts = 0, terminal = 0; let rf: string | null = null, rl: string | null = null;
    for (const r of rows) {
      if (r.channel !== channel) continue;
      const t = new Date(r.created_at).getTime(); const at = new Date(r.created_at).toISOString();
      const f = classifyFailure({ status: r.status, channel: r.channel, toAddress: r.to_address, failureReason: r.failure_reason, providerErrorCode: r.provider_error_code });
      if (t >= qCut) {
        if (!(f?.category === 'opted_out')) { attempts++; if (f) { terminal++; rf = rf ?? at; rl = at; } }
      }
      if (f && t >= rCut) { const g = byCat.get(f.category) ?? { count: 0, first: at, last: at }; g.count++; g.last = at; byCat.set(f.category, g); }
    }
    const stats: WindowStats = { channel, failuresInRepeatWindow: [...byCat.entries()].map(([category, g]) => ({ category, ...g })), ratioAttempts: attempts, ratioTerminalFailures: terminal, ratioFirst: rf, ratioLast: rl };
    detections.push(...detectFromStats(stats, cfg));
  }
  // credential check became invalid (from the existing readiness record — no provider call here)
  if (o.readiness) {
    const v = await o.readiness.readiness(tenantId, null).catch((e) => { logException(e, { where: 'customer-notifications.incidents.readiness' }); return null; });
    if (v?.account?.state === 'invalid') detections.push({ rule: 'credential_invalid', channel: 'sms', severity: 'critical', count: 1, first: v.account.lastCheckedAt ?? null, last: v.account.lastCheckedAt ?? null,
      title: 'Texting account credentials were refused', body: 'The last Phone & Messaging check found the salon\'s Twilio credentials invalid. Texts will fail until they are fixed in Messaging Setup.' });
  }
  // provider callbacks stopped (they used to arrive, the window has relevant sends, nothing arrived since)
  const cb = (await sql<any>`select max(received_at) as last from notification_delivery_events where tenant_id = ${tenantId}`.execute(db)).rows[0];
  if (cb?.last) {
    const staleCut = now - cfg.callbackStaleHours * 3_600_000;
    if (new Date(cb.last).getTime() < staleCut) {
      const vol = N((await sql<any>`select count(*)::int as n from notifications where tenant_id = ${tenantId} and channel = 'sms' and provider_id is not null and created_at >= ${new Date(staleCut).toISOString()}::timestamptz and created_at < ${new Date(now - 3_600_000).toISOString()}::timestamptz`.execute(db)).rows[0]?.n);
      if (vol >= 3) detections.push({ rule: 'callbacks_stale', channel: 'sms', severity: 'warning', count: vol, first: iso(cb.last), last: new Date(now).toISOString(),
        title: 'Delivery reports stopped arriving', body: `No delivery report from the texting provider for ${cfg.callbackStaleHours} hours although ${vol} texts were accepted. Delivered counts are on hold (shown as Unknown).` });
    }
    const pend = (await sql<any>`select count(*)::int as n, min(created_at) as oldest from notifications where tenant_id = ${tenantId} and status = 'sent' and created_at < ${new Date(now - cfg.pendingBacklog.oldestMinutes * 60_000).toISOString()}::timestamptz and created_at >= ${new Date(now - 7 * 86_400_000).toISOString()}::timestamptz`.execute(db)).rows[0];
    if (N(pend?.n) >= cfg.pendingBacklog.count) detections.push({ rule: 'pending_backlog', channel: 'sms', severity: 'warning', count: N(pend?.n), first: iso(pend?.oldest), last: new Date(now).toISOString(),
      title: 'Many texts are waiting for a delivery report', body: `${N(pend?.n)} accepted texts older than ${cfg.pendingBacklog.oldestMinutes} minutes have no delivery report yet (oldest ${iso(pend?.oldest)}).` });
  }
  let opened = 0, updated = 0;
  for (const d of detections) {
    const dedupeKey = `${d.rule}:${d.channel}${d.category ? ':' + d.category : ''}`;
    const open = (await sql<any>`select id, metadata from owner_alerts where tenant_id = ${tenantId} and category = 'messaging_failure' and metadata->>'dedupeKey' = ${dedupeKey}
      and status in ('new', 'acknowledged', 'in_progress') limit 1`.execute(db)).rows[0];
    if (open) {
      const m = open.metadata ?? {};
      const meta = { ...m, count: Math.max(N(m.count), d.count), lastEventAt: d.last ?? m.lastEventAt ?? null, detections: N(m.detections) + 1, lastDetectedAt: new Date(now).toISOString() };
      await sql`update owner_alerts set metadata = ${JSON.stringify(meta)}::jsonb, body = ${d.body}, updated_at = now() where id = ${open.id} and tenant_id = ${tenantId}`.execute(db);
      updated++; continue;
    }
    const recent = (await sql<any>`select id, resolved_at from owner_alerts where tenant_id = ${tenantId} and category = 'messaging_failure' and metadata->>'dedupeKey' = ${dedupeKey}
      and status in ('resolved', 'dismissed') order by coalesce(resolved_at, updated_at) desc limit 1`.execute(db)).rows[0];
    if (recent?.resolved_at && now - new Date(recent.resolved_at).getTime() < COOLDOWN_MS && d.severity !== 'critical') continue;   // cooldown after a resolve
    const meta = { dedupeKey, rule: d.rule, channel: d.channel, category: d.category ?? null, count: d.count, firstEventAt: d.first, lastEventAt: d.last, detections: 1, previousAlertId: recent?.id ?? null, source: 'customer_notifications' };
    const ins = await sql<any>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      values (${tenantId}, null, 'messaging_failure', ${d.severity}, 'new', ${d.title}, ${d.body}, ${JSON.stringify(meta)}::jsonb, 'all')
      on conflict (tenant_id, (metadata->>'dedupeKey')) where category = 'messaging_failure' and status in ('new', 'acknowledged', 'in_progress') do nothing returning id`.execute(db);
    if (ins.rows.length) opened++; else updated++;
  }
  return { opened, updated, detections };
}
