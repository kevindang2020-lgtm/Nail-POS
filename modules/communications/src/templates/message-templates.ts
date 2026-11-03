// message-templates.ts — Communications → Message Templates (/tenant/communications/templates), "Message Templates &
// Automation Center Complete Build Guide" (30 Oct 2026). It extends the salon's EXISTING template store in place — no second
// template system, no second sender:
//   pos_message_templates (017a, +740)       the salon's templates (the old screen + the SMS Inbox composer read the same rows)
//   pos_message_template_versions (740)      append-only snapshots: every saved content change is a new version
//   pos_message_template_bindings (740)      which automation uses which template (only workflows that READ a binding are bindable)
//   pos_message_template_usage (740)         one row per message a template produced, pointing at the notifications row
//   pos_message_template_tests (740)         confirmed Test Sends (idempotent per key)
//   notifications                            the one message ledger: provider id + delivery status (read-only here)
//   NotificationsService (sendSms / send)    the one sending path (salon's own Twilio for SMS tests; the email provider)
//
// Rules kept here (guide §04 "P0 - Protection", §09, §14, §18):
//   * Create / Save / Preview NEVER send. Test Send is a separate, confirmed, permission-checked, idempotent action that
//     renders with SAMPLE data only (never a real customer's details) and goes through the existing sender.
//   * Activation requires a valid template (registered variables only, category-appropriate, subject for email, STOP line for
//     a marketing text). Archived templates are never offered for new sending; their versions and usage stay readable.
//   * Deactivating / archiving a template an ACTIVE automation uses is refused unless a valid replacement is chosen and
//     confirmed — the bindings move in the same transaction.
//   * Edits are optimistic (record_version): a stale edit is a 409 with the current row, never a silent overwrite.
//   * Delivery status comes ONLY from the notifications row (provider events): submitted ≠ delivered; nothing → Unknown.
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { HttpException, HttpStatus } from '@nestjs/common';
import { withCode, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { logException } from '@aipowersalon/observability';
import { tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { recordAuditStrict } from '@aipowersalon/audit';
type AuditActor = Parameters<typeof recordAuditStrict>[1];
import { SALON_MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_TEST } from '../communications-lifecycles';
import {
  TEMPLATE_CATEGORIES, TEMPLATE_VARIABLES, CATEGORY_CLASS, validateTemplate, renderTemplate, fixtureValues, variablesFor,
  type Values, type TemplateCategory,
} from './template-variables';

export interface TemplatesContext { tenantId: string; branchId?: string | null; userId?: string; role?: string; permissions?: string[] }
type PermCtx = Parameters<typeof hasPermission>[0];
const can = (ctx: TemplatesContext, perm: string) => hasPermission(ctx as unknown as PermCtx, perm);

export const MT_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export const MT_STATUS_FILTERS = ['current', 'all', ...MT_STATUSES] as const;
export const MT_CHANNELS = ['sms', 'email'] as const;
export const MT_DATE_BASES = ['created', 'updated', 'last_used'] as const;
export const MT_SORTS = ['newest', 'oldest', 'name', 'updated', 'most_used'] as const;
export const MT_USAGE_BASES = ['created', 'sent', 'provider_event'] as const;
export const MT_USAGE_STATUSES = ['all', 'submitted', 'delivered', 'failed', 'blocked', 'unknown', 'simulated'] as const;
export const MT_WORKFLOWS = ['sms_inbox', 'appointment_reminder', 'reschedule_cancellation', 'booking_confirmation', 'end_of_day_follow_up', 'missed_call_follow_up', 'marketing_campaigns', 'membership', 'receipt', 'test_send'] as const;

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TPL_ID = /^tpl_[0-9a-f-]{36}$|^[A-Za-z0-9_-]{1,80}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
export const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
export const maskEmail = (e: string | null | undefined) => { if (!e) return null; const [u, d] = String(e).split('@'); return d ? `${(u || '').slice(0, 1)}•••@${d}` : '•••'; };
function paging(page: unknown, pageSize: unknown, def = 10) { const ps = Math.trunc(Number(pageSize)) || def; return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: [10, 20, 50].includes(ps) ? ps : Math.max(1, Math.min(50, ps)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }
const E164 = (raw: string) => { const d = String(raw ?? '').replace(/[^\d+]/g, ''); const digits = d.replace(/\D/g, ''); if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits; if (digits.length === 10) return '+1' + digits; if (digits.length === 11 && digits.startsWith('1')) return '+' + digits; return null; };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export class TemplatesError extends Error {
  code: string; status: number; extra: Record<string, unknown>;
  constructor(msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) { super(msg); this.name = 'TemplatesError'; this.code = code; this.status = status; this.extra = extra; }
}
const err = (msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) => withCode(new TemplatesError(msg, code, status, extra), code as ApiErrorCode);
export function asHttp(e: unknown): never {
  if (e instanceof TemplatesError) throw withCode(new HttpException({ code: e.code, message: e.message, ...e.extra }, e.status as HttpStatus), e.code as ApiErrorCode);
  throw e;
}

/** the sending path (NotificationsService satisfies it) — sendSms for the salon's OWN Twilio, send for email */
export interface TemplateSender {
  sendSms(req: { tenantId: string; branchId?: string | null; to: string; body: string; purpose: 'notification'; customerId?: string | null; meter?: boolean; requireOwnAccount?: boolean }): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string; simulated?: boolean; notificationId?: string }>;
  send(ctx: { tenantId: string; userId: string; role: string; salonName?: string }, req: { channel: 'sms' | 'email'; to: string; subject?: string; body: string; customerId?: string }): Promise<{ sent: boolean; status: string; reason?: string; id?: string; providerId?: string; simulated?: boolean }>;
}

// ── the automation catalog (guide §14): every workflow that sends customer messages, as found in the code ─────────────
// bindable = the workflow READS a binding at send time (only those may be bound — a binding nothing reads would be a lie).
export interface WorkflowInfo { key: (typeof MT_WORKFLOWS)[number]; label: string; channels: ('sms' | 'email')[]; bindable: boolean; categories: TemplateCategory[]; source: string; route: string | null; handoff: string | null }
export const WORKFLOW_CATALOG: WorkflowInfo[] = [
  { key: 'sms_inbox', label: 'SMS Inbox replies', channels: ['sms'], bindable: false, categories: [], route: '/tenant/communications/inbox', handoff: null,
    source: 'Staff pick any ACTIVE salon template (or a published platform template) per message. Variables are filled from the conversation\'s customer when the template is inserted; the message records the template version.' },
  { key: 'appointment_reminder', label: 'Appointment reminders', channels: ['sms', 'email'], bindable: true, categories: ['appointment_reminder'], route: '/tenant/communications/reminders', handoff: 'Appointment Reminders guide (lead times, ladder, quiet hours stay there).',
    source: 'Built-in reminder text (customer messages are English only). With an active binding the bound template is sent instead; if a value is missing the built-in text is used for that message.' },
  { key: 'reschedule_cancellation', label: 'Reschedule / cancellation texts', channels: ['sms'], bindable: false, categories: ['reschedule_cancellation'], route: '/tenant/booking', handoff: 'Booking (does not read bindings yet).',
    source: 'Built-in text in Booking ("Your appointment has been moved…" / "…has been cancelled").' },
  { key: 'booking_confirmation', label: 'Booking confirmations', channels: ['sms', 'email'], bindable: false, categories: ['booking_confirmation'], route: null, handoff: 'Booking / Booking Phone Verification guides.',
    source: 'No booking-confirmation message is sent by the code today (nothing to bind).' },
  { key: 'end_of_day_follow_up', label: 'End-of-Day Follow-Ups', channels: ['sms'], bindable: false, categories: ['customer_follow_up'], route: '/tenant/communications/follow-ups', handoff: 'End-of-Day Follow-Ups guide (technician drafts + manager approval).',
    source: 'Technicians write each follow-up; a manager approves it. Templates are not read yet.' },
  { key: 'missed_call_follow_up', label: 'Missed-call follow-up', channels: ['sms'], bindable: false, categories: ['missed_call_follow_up'], route: '/tenant/communications/inbox', handoff: 'Follow-Up Queue / Text Messaging Setup guides.',
    source: 'Missed calls appear in the SMS Inbox; staff text back by hand (library templates can be inserted there). No automatic missed-call text exists.' },
  { key: 'marketing_campaigns', label: 'Marketing campaigns', channels: ['sms', 'email'], bindable: false, categories: ['promotions'], route: '/tenant/marketing/campaigns', handoff: 'Campaign Center (each campaign keeps its own approved message).',
    source: 'Each campaign has its own message ({salon_name}, {offer}) approved in Campaign Center; consent and suppression are re-checked at send time there.' },
  { key: 'membership', label: 'Membership texts', channels: ['sms'], bindable: false, categories: ['membership'], route: null, handoff: 'Memberships.', source: 'Built-in membership texts (renewal, failed payment).' },
  { key: 'receipt', label: 'Receipts', channels: ['sms', 'email'], bindable: false, categories: ['receipt'], route: null, handoff: 'Checkout.', source: 'Receipts are built by Checkout from the finalized ticket.' },
];
const WF = new Map<string, WorkflowInfo>(WORKFLOW_CATALOG.map((w) => [w.key, w]));

/** the template a workflow should use right now, or null (keep the built-in text). Used by the reminder sender. */
export async function resolveBoundTemplate(db: Kysely<any>, tenantId: string, branchId: string | null, workflow: string, channel: 'sms' | 'email'):
  Promise<{ templateId: string; version: number; channel: 'sms' | 'email'; category: string | null; subject: string | null; body: string; branchId: string | null } | null> {
  const b = (await sql<any>`select b.template_id, b.version_strategy, b.pinned_version, b.branch_id from pos_message_template_bindings b
      where b.tenant_id = ${tenantId} and b.workflow = ${workflow} and b.channel = ${channel} and b.active
        and (b.branch_id is null or b.branch_id = ${branchId && UUID.test(branchId) ? branchId : null}::uuid)
      order by (b.branch_id is null) asc limit 1`.execute(db)).rows[0];
  if (!b) return null;
  const v = (await sql<any>`select t.status, t.current_version, v.version, v.channel, v.category, v.subject, v.body
      from pos_message_templates t join pos_message_template_versions v on v.tenant_id = t.tenant_id and v.template_id = t.id
        and v.version = case when ${b.version_strategy} = 'pinned' then ${N(b.pinned_version)} else t.current_version end
      where t.tenant_id = ${tenantId} and t.id = ${b.template_id}`.execute(db)).rows[0];
  if (!v || v.status !== 'active' || v.channel !== channel) return null;   // a broken binding never sends a broken message
  return { templateId: String(b.template_id), version: N(v.version), channel, category: v.category ?? null, subject: v.subject ?? null, body: String(v.body), branchId: b.branch_id ?? null };
}

/** one usage row per message a template produced — written by every sender that used a template (Inbox, reminders, tests) */
export async function recordTemplateUsage(db: Kysely<any>, u: {
  tenantId: string; branchId?: string | null; templateId: string; version: number; workflow: string; channel: string; customerId?: string | null;
  appointmentId?: string | null; threadId?: string | null; messageId?: string | null; notificationId?: string | null; testId?: string | null;
  recipientMasked?: string | null; subject?: string | null; body: string; outcome: 'submitted' | 'blocked' | 'failed' | 'simulated'; reason?: string | null; actorId?: string | null;
}): Promise<void> {
  const uu = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
  await sql`insert into pos_message_template_usage (tenant_id, branch_id, template_id, template_version, workflow, channel, customer_id, appointment_id, thread_id, message_id, notification_id, test_id, recipient_masked, rendered_subject, rendered_body, send_outcome, outcome_reason, created_by)
    values (${u.tenantId}, ${uu(u.branchId)}::uuid, ${u.templateId}, ${u.version}, ${u.workflow}, ${u.channel}, ${uu(u.customerId)}::uuid, ${uu(u.appointmentId)}::uuid, ${uu(u.threadId)}::uuid, ${uu(u.messageId)}::uuid, ${uu(u.notificationId)}::uuid, ${uu(u.testId)}::uuid,
      ${u.recipientMasked ?? null}, ${u.subject ?? null}, ${u.body}, ${u.outcome}, ${u.reason ? String(u.reason).slice(0, 120) : null}, ${uu(u.actorId)}::uuid)`.execute(db);
  if (u.outcome === 'submitted' || u.outcome === 'simulated') await sql`update pos_message_templates set last_used_at = now() where tenant_id = ${u.tenantId} and id = ${u.templateId}`.execute(db);
}

export class MessageTemplatesCenter {
  constructor(private readonly db: Kysely<any>, private readonly sender: TemplateSender | null = null) {}

  private need(ctx: TemplatesContext, perm: 'pos.communications.view' | 'pos.communications.manage' | 'pos.communications.send') {
    if (!ctx?.tenantId || !ctx?.userId) throw err('Not signed in.', 'PERMISSION_DENIED', 403);
    if (!can(ctx, perm)) throw err('You do not have permission to do this.', 'PERMISSION_DENIED', 403);
  }
  private actorId(ctx: TemplatesContext) { return ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null; }
  /** salon-wide templates + the signed-in branch's own (alias t) */
  private branchW(ctx: TemplatesContext, col: any = sql`t.branch_id`) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(${col} = ${ctx.branchId} or ${col} is null)` : sql`true`; }
  private audit(ctx: TemplatesContext, action: string, id: string | null, summary: string, metadata: Record<string, unknown> = {}, db: Kysely<any> = this.db, status: 'success' | 'failure' = 'success') {
    const actor: AuditActor = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null };
    return recordAuditStrict(db, actor,
      { module: 'communications', action, resourceType: 'message_template', resourceId: id, summary, status, severity: status === 'success' ? 'info' : 'warning', metadata });
  }

  // ── period (salon-local inclusive days) ────────────────────────────────────────────────────────────────────────────
  async period(ctx: TemplatesContext, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'all') {
    const tz = await tenantTimeZone(this.db, ctx.tenantId);
    const r = (await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, tz, today: String(r.today) };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw err('The start date must be on or before the end date.', 'DATE_RANGE_INVALID');
      return { preset, from, to, tz, today: String(r.today) };
    }
    return { preset, from: String(preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr), to: String(r.today), tz, today: String(r.today) };
  }
  private inP(col: any, p: { from: string | null; to: string | null; tz: string }) {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }

  // ── library ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private rowView(r: any) {
    const v = validateTemplate({ channel: r.channel, category: r.category, subject: r.subject, body: r.body ?? '', name: r.name });
    return {
      id: String(r.id), name: String(r.name), channel: r.channel === 'email' ? 'email' : 'sms', category: r.category ?? null, messageClass: r.category ? CATEGORY_CLASS[r.category as TemplateCategory] ?? null : null,
      subject: r.subject ?? null, description: r.description ?? null, branchId: r.branch_id ?? null, branchName: r.branch_name ?? null, status: String(r.status),
      version: N(r.current_version) || 1, recordVersion: N(r.record_version) || 1, bodyPreview: String(r.body ?? '').slice(0, 160),
      createdAt: iso(r.created_at), createdAtKnown: r.created_at != null, updatedAt: iso(r.updated_at), lastUsedAt: iso(r.last_used_at), archivedAt: iso(r.archived_at),
      createdByName: r.created_by_name ?? null, updatedByName: r.updated_by_name ?? null, usageCount: N(r.usage_count), activeBindings: N(r.active_bindings),
      problems: v.errors.length, legacyPlaceholders: v.warnings.some((w) => w.code === 'TEMPLATE_LEGACY_PLACEHOLDER'),
    };
  }
  private selectRows(T: string, where: any, order: any, limit: number, offset: number) {
    return sql<any>`select t.id, t.name, t.channel, t.category, t.subject, t.description, t.branch_id, t.status, t.current_version, t.record_version, t.body,
        t.created_at, t.updated_at, t.last_used_at, t.archived_at, cu.full_name as created_by_name, uu.full_name as updated_by_name, br.name as branch_name,
        coalesce(us.n, 0) as usage_count, coalesce(bd.n, 0) as active_bindings
      from pos_message_templates t
      left join users cu on cu.id = t.created_by left join users uu on uu.id = t.updated_by
      left join branches br on br.id = t.branch_id and br.tenant_id = t.tenant_id
      left join lateral (select count(*)::int as n from pos_message_template_usage pu where pu.tenant_id = t.tenant_id and pu.template_id = t.id) us on true
      left join lateral (select count(*)::int as n from pos_message_template_bindings pb where pb.tenant_id = t.tenant_id and pb.template_id = t.id and pb.active) bd on true
      where t.tenant_id = ${T} and ${where} order by ${order} limit ${limit} offset ${offset}`;
  }

  async summary(ctx: TemplatesContext) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, { preset: 'month' });
    const k = (await sql<any>`select count(*) filter (where t.status <> 'archived')::int as total, count(*) filter (where t.status = 'active')::int as active,
        count(*) filter (where t.status <> 'archived' and t.channel = 'sms')::int as sms, count(*) filter (where t.status <> 'archived' and t.channel = 'email')::int as email,
        count(*) filter (where t.status = 'archived')::int as archived, count(*) filter (where t.status = 'draft')::int as drafts, count(*) filter (where t.status = 'inactive')::int as inactive
      from pos_message_templates t where t.tenant_id = ${T} and ${this.branchW(ctx)}`.execute(this.db)).rows[0];
    const u = (await sql<any>`select count(*)::int as messages, count(distinct pu.template_id)::int as templates from pos_message_template_usage pu
      where pu.tenant_id = ${T} and pu.workflow <> 'test_send' and ${this.branchW(ctx, sql`pu.branch_id`)} and ${this.inP(sql`pu.created_at`, p)}`.execute(this.db)).rows[0];
    return {
      kpis: { total: N(k?.total), active: N(k?.active), sms: N(k?.sms), email: N(k?.email), archived: N(k?.archived), drafts: N(k?.drafts), inactive: N(k?.inactive),
        usedThisMonthMessages: N(u?.messages), usedThisMonthTemplates: N(u?.templates) },
      month: { from: p.from, to: p.to, tz: p.tz }, checkedAt: new Date().toISOString(),
      categories: TEMPLATE_CATEGORIES.map((c) => ({ key: c, messageClass: CATEGORY_CLASS[c] })),
      variables: TEMPLATE_VARIABLES.map((v) => ({ token: v.token, group: v.group, label: v.label, source: v.source, sample: v.sample, categories: v.categories, fallback: v.fallback ?? null })),
      canManage: can(ctx, 'pos.communications.manage'), canTest: can(ctx, 'pos.communications.manage'), canPreviewCustomer: can(ctx, 'pos.customers.view'),
    };
  }

  async list(ctx: TemplatesContext, q: { q?: string; channel?: string; status?: string; category?: string; basis?: string; sort?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, q, 'all');
    const conds = [sql`t.tenant_id = ${T}`, this.branchW(ctx)];
    const st = String(q.status ?? 'current');
    if (st === 'current') conds.push(sql`t.status <> 'archived'`); else if ((MT_STATUSES as readonly string[]).includes(st)) conds.push(sql`t.status = ${st}`);
    if (q.channel && (MT_CHANNELS as readonly string[]).includes(q.channel)) conds.push(sql`t.channel = ${q.channel}`);
    if (q.category && (TEMPLATE_CATEGORIES as readonly string[]).includes(q.category)) conds.push(sql`t.category = ${q.category}`);
    const basis = (MT_DATE_BASES as readonly string[]).includes(String(q.basis)) ? String(q.basis) : 'created';
    conds.push(this.inP(basis === 'updated' ? sql`t.updated_at` : basis === 'last_used' ? sql`t.last_used_at` : sql`t.created_at`, p));
    const term = String(q.q ?? '').trim().slice(0, 100);
    if (term) {
      // tenant first (the index), then the salon's own few hundred rows: name / id / subject / category / body keyword / creator
      conds.push(sql`(t.name ilike ${like(term)} or t.id = ${term} or coalesce(t.subject, '') ilike ${like(term)} or coalesce(t.category, '') ilike ${like(term.replace(/\s+/g, '_'))}
        or t.body ilike ${like(term)} or t.channel = ${term.toLowerCase()} or exists (select 1 from users xu where xu.tenant_id = t.tenant_id and xu.id in (t.created_by, t.updated_by) and xu.full_name ilike ${like(term)}))`);
    }
    const where = sql.join(conds, sql` and `);
    const sort = (MT_SORTS as readonly string[]).includes(String(q.sort)) ? String(q.sort) : 'newest';
    const order = sort === 'oldest' ? sql`t.created_at asc nulls first, t.id asc` : sort === 'name' ? sql`lower(t.name) asc, t.id asc`
      : sort === 'updated' ? sql`t.updated_at desc nulls last, t.id desc` : sort === 'most_used' ? sql`coalesce(us.n, 0) desc, t.created_at desc nulls last, t.id desc`
      : sql`t.created_at desc nulls last, t.id desc`;
    const total = N((await sql<any>`select count(*)::int as n from pos_message_templates t where t.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const pg = paging(q.page, q.pageSize); const sv = served(pg.page, pg.pageSize, total);
    const rows = (await this.selectRows(T, where, order, pg.pageSize, sv.offset).execute(this.db)).rows;
    return { items: rows.map((r: any) => this.rowView(r)), page: sv.page, pageSize: pg.pageSize, totalItems: total, totalPages: sv.totalPages, sort, basis, period: p, status: st };
  }

  private async mustRow(ctx: TemplatesContext, id: string, db: Kysely<any> = this.db, lock = false) {
    if (!id || !TPL_ID.test(id)) throw err('Template not found.', 'TEMPLATE_NOT_FOUND', 404);
    const r = (await sql<any>`select t.id, t.tenant_id, t.name, t.channel, t.category, t.subject, t.description, t.body, t.branch_id, t.status, t.current_version, t.record_version,
        t.created_by, t.updated_by, t.created_at, t.updated_at, t.archived_at, t.last_used_at from pos_message_templates t where t.tenant_id = ${ctx.tenantId} and t.id = ${id} and ${this.branchW(ctx)} ${lock ? sql`for update` : sql``}`.execute(db)).rows[0];
    if (!r) throw err('Template not found.', 'TEMPLATE_NOT_FOUND', 404);
    return r;
  }

  async detail(ctx: TemplatesContext, id: string) {
    this.need(ctx, 'pos.communications.view');
    await this.mustRow(ctx, id);
    const row = (await this.selectRows(ctx.tenantId, sql`t.id = ${id}`, sql`t.id`, 1, 0).execute(this.db)).rows[0];
    const versions = (await sql<any>`select v.version, v.name, v.channel, v.category, v.subject, v.body, v.variables, v.backfilled, v.created_at, u.full_name as by_name
        from pos_message_template_versions v left join users u on u.id = v.created_by where v.tenant_id = ${ctx.tenantId} and v.template_id = ${id} order by v.version desc limit 50`.execute(this.db)).rows;
    const bindings = await this.bindingRows(ctx, id);
    const tests = (await sql<any>`select x.id, x.template_version, x.channel, x.target_masked, x.status, x.provider_ref, x.error_code, x.created_at, u.full_name as by_name, n.status as delivery
        from pos_message_template_tests x left join users u on u.id = x.created_by left join notifications n on n.id = x.notification_id and n.tenant_id = x.tenant_id
        where x.tenant_id = ${ctx.tenantId} and x.template_id = ${id} order by x.created_at desc limit 10`.execute(this.db)).rows;
    const validation = validateTemplate({ channel: row.channel, category: row.category, subject: row.subject, body: row.body, name: row.name });
    return {
      template: { ...this.rowView(row), body: String(row.body) }, validation,
      versions: versions.map((v: any) => ({ version: N(v.version), name: v.name, channel: v.channel, category: v.category ?? null, subject: v.subject ?? null, body: v.body, variables: v.variables ?? [], backfilled: !!v.backfilled, createdAt: iso(v.created_at), byName: v.by_name ?? null })),
      bindings, tests: tests.map((x: any) => ({ id: String(x.id), version: N(x.template_version), channel: x.channel, target: x.target_masked, status: x.status, providerRef: x.provider_ref ?? null, errorCode: x.error_code ?? null, createdAt: iso(x.created_at), byName: x.by_name ?? null, delivery: deliveryOf(x.status === 'submitted' ? 'submitted' : x.status, x.delivery) })),
      variables: variablesFor(row.category).map((v) => ({ token: v.token, label: v.label, group: v.group })),
    };
  }

  private fields(b: any) {
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
    return { name: s(b.name, 200), channel: s(b.channel, 10), category: s(b.category, 40) || null, subject: s(b.subject, 400), description: s(b.description, 1000), body: s(b.body, 25_000), branchId: b.branchId };
  }
  private async branchOk(ctx: TemplatesContext, branchId: unknown, db: Kysely<any>) {
    if (branchId == null || branchId === '') return null;
    if (typeof branchId !== 'string' || !UUID.test(branchId)) throw err('Choose a branch from the list.', 'BRANCH_INVALID');
    if (ctx.branchId && UUID.test(ctx.branchId) && ctx.branchId !== branchId) throw err('You can only scope templates to your own branch.', 'PERMISSION_DENIED', 403);
    const b = (await sql<any>`select id from branches where tenant_id = ${ctx.tenantId} and id = ${branchId}`.execute(db)).rows[0];
    if (!b) throw err('Choose a branch from the list.', 'BRANCH_INVALID');
    return branchId;
  }

  async create(ctx: TemplatesContext, b: any) {
    this.need(ctx, 'pos.communications.manage');
    const f = this.fields(b ?? {});
    const activate = b?.activate !== false;   // the original form's Create makes a usable template; "Save draft" passes activate: false
    if (!f.name || !String(f.name).trim()) throw err('Give the template a name.', 'TEMPLATE_NAME_REQUIRED');
    if (f.channel !== 'sms' && f.channel !== 'email') throw err('Choose SMS or Email.', 'TEMPLATE_CHANNEL_INVALID');
    if (!f.body || !String(f.body).trim()) throw err('Write the message.', 'TEMPLATE_BODY_REQUIRED');
    const v = validateTemplate({ channel: f.channel, category: f.category, subject: f.subject, body: f.body!, name: f.name });
    // structural problems block even a draft (length, bad category); content problems block only activation
    const hard = v.errors.filter((e) => ['TEMPLATE_NAME_TOO_LONG', 'TEMPLATE_BODY_TOO_LONG', 'TEMPLATE_SUBJECT_TOO_LONG', 'TEMPLATE_CATEGORY_INVALID', 'TEMPLATE_VARIABLE_FORBIDDEN'].includes(e.code));
    if (hard.length) throw err(hard[0].message, hard[0].code, 422, { validation: v });
    if (activate && v.errors.length) throw err(v.errors[0].message, 'TEMPLATE_INVALID', 422, { validation: v });
    const id = `tpl_${randomUUID()}`; const actor = this.actorId(ctx);
    await this.db.transaction().execute(async (trx: any) => {
      const branchId = await this.branchOk(ctx, f.branchId, trx);
      await sql`insert into pos_message_templates (id, tenant_id, channel, name, body, category, subject, description, branch_id, status, current_version, record_version, created_by, updated_by, created_at, updated_at)
        values (${id}, ${ctx.tenantId}, ${f.channel}, ${String(f.name).trim()}, ${f.body}, ${f.category}, ${f.channel === 'email' ? (f.subject?.trim() || null) : null}, ${f.description?.trim() || null}, ${branchId}::uuid,
          ${activate ? 'active' : 'draft'}, 1, 1, ${actor}::uuid, ${actor}::uuid, now(), now())`.execute(trx);
      await sql`insert into pos_message_template_versions (tenant_id, template_id, version, name, channel, category, subject, body, variables, created_by)
        values (${ctx.tenantId}, ${id}, 1, ${String(f.name).trim()}, ${f.channel}, ${f.category}, ${f.channel === 'email' ? (f.subject?.trim() || null) : null}, ${f.body}, ${v.tokens}::text[], ${actor}::uuid)`.execute(trx);
      await this.audit(ctx, activate ? 'message_template.create_active' : 'message_template.create_draft', id, `Template "${String(f.name).trim()}" created (${activate ? 'active' : 'draft'})`, { channel: f.channel, category: f.category, chars: f.body!.length }, trx);
    });
    return this.detail(ctx, id);
  }

  async update(ctx: TemplatesContext, id: string, b: any) {
    this.need(ctx, 'pos.communications.manage');
    const expected = Math.trunc(Number(b?.recordVersion));
    if (!expected) throw err('This edit needs the version you started from. Reload and try again.', 'TEMPLATE_VERSION_REQUIRED');
    const f = this.fields(b ?? {});
    await this.db.transaction().execute(async (trx: any) => {
      const cur = await this.mustRow(ctx, id, trx, true);
      if (N(cur.record_version) !== expected) throw err('Someone else changed this template after you opened it. Reload to see their version before saving yours.', 'TEMPLATE_VERSION_CONFLICT', 409, { current: this.rowView(cur), currentBody: cur.body });
      if (cur.status === 'archived') throw err('Archived templates cannot be edited. Restore it first, or duplicate it.', 'TEMPLATE_ARCHIVED', 409);
      const next = {
        name: f.name != null ? String(f.name).trim() : cur.name, channel: f.channel ?? cur.channel, category: b?.category !== undefined ? f.category : cur.category,
        subject: b?.subject !== undefined ? (f.subject?.trim() || null) : cur.subject, description: b?.description !== undefined ? (f.description?.trim() || null) : cur.description,
        body: f.body != null ? f.body : cur.body,
      };
      if (next.channel !== 'sms' && next.channel !== 'email') throw err('Choose SMS or Email.', 'TEMPLATE_CHANNEL_INVALID');
      if (next.channel === 'sms') next.subject = null;
      const v = validateTemplate({ ...next, name: next.name });
      const hard = v.errors.filter((e) => ['TEMPLATE_NAME_REQUIRED', 'TEMPLATE_BODY_REQUIRED', 'TEMPLATE_NAME_TOO_LONG', 'TEMPLATE_BODY_TOO_LONG', 'TEMPLATE_SUBJECT_TOO_LONG', 'TEMPLATE_CATEGORY_INVALID', 'TEMPLATE_VARIABLE_FORBIDDEN'].includes(e.code));
      if (hard.length) throw err(hard[0].message, hard[0].code, 422, { validation: v });
      if (cur.status === 'active' && v.errors.length) throw err(`This template is active, so it must stay valid: ${v.errors[0].message} (Or deactivate it first.)`, 'TEMPLATE_INVALID', 422, { validation: v });
      const binds = await this.bindingRows(ctx, id, trx);
      if (next.channel !== cur.channel && binds.some((x) => x.active)) throw err('An automation uses this template on its current channel. Change the automation first.', 'TEMPLATE_IN_USE', 409, { bindings: binds.filter((x) => x.active) });
      if (next.category !== cur.category && binds.some((x) => x.active && !(WF.get(x.workflow)?.categories ?? []).includes(next.category as TemplateCategory))) {
        throw err('An automation uses this template, and that automation needs its current category.', 'TEMPLATE_IN_USE', 409, { bindings: binds.filter((x) => x.active) });
      }
      const branchId = b?.branchId !== undefined ? await this.branchOk(ctx, b.branchId, trx) : cur.branch_id;
      const contentChanged = next.name !== cur.name || next.channel !== cur.channel || (next.category ?? null) !== (cur.category ?? null) || (next.subject ?? null) !== (cur.subject ?? null) || next.body !== cur.body;
      const newVersion = contentChanged ? N(cur.current_version) + 1 : N(cur.current_version);
      const u = (await sql<any>`update pos_message_templates set name = ${next.name}, channel = ${next.channel}, category = ${next.category}, subject = ${next.subject}, description = ${next.description}, body = ${next.body},
          branch_id = ${branchId}::uuid, current_version = ${newVersion}, record_version = record_version + 1, updated_by = ${this.actorId(ctx)}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${id} and record_version = ${expected} returning id`.execute(trx)).rows[0];
      if (!u) throw err('Someone else changed this template after you opened it. Reload to see their version before saving yours.', 'TEMPLATE_VERSION_CONFLICT', 409);
      if (contentChanged) {
        await sql`insert into pos_message_template_versions (tenant_id, template_id, version, name, channel, category, subject, body, variables, created_by)
          values (${ctx.tenantId}, ${id}, ${newVersion}, ${next.name}, ${next.channel}, ${next.category}, ${next.subject}, ${next.body}, ${v.tokens}::text[], ${this.actorId(ctx)}::uuid)`.execute(trx);
      }
      await this.audit(ctx, 'message_template.edit', id, `Template "${next.name}" saved${contentChanged ? ` as version ${newVersion}` : ''}`, { version: newVersion, contentChanged, status: cur.status }, trx);
    });
    return this.detail(ctx, id);
  }

  async duplicate(ctx: TemplatesContext, id: string) {
    this.need(ctx, 'pos.communications.manage');
    const src = await this.mustRow(ctx, id);
    const nid = `tpl_${randomUUID()}`; const name = `${String(src.name).slice(0, 113)} (copy)`; const actor = this.actorId(ctx);
    const v = validateTemplate({ channel: src.channel, category: src.category, subject: src.subject, body: src.body });
    await this.db.transaction().execute(async (trx: any) => {
      await sql`insert into pos_message_templates (id, tenant_id, channel, name, body, category, subject, description, branch_id, status, current_version, record_version, created_by, updated_by, created_at, updated_at)
        values (${nid}, ${ctx.tenantId}, ${src.channel}, ${name}, ${src.body}, ${src.category}, ${src.subject}, ${src.description}, ${src.branch_id}, 'draft', 1, 1, ${actor}::uuid, ${actor}::uuid, now(), now())`.execute(trx);
      await sql`insert into pos_message_template_versions (tenant_id, template_id, version, name, channel, category, subject, body, variables, created_by)
        values (${ctx.tenantId}, ${nid}, 1, ${name}, ${src.channel}, ${src.category}, ${src.subject}, ${src.body}, ${v.tokens}::text[], ${actor}::uuid)`.execute(trx);
      await this.audit(ctx, 'message_template.duplicate', nid, `Template "${name}" duplicated from "${src.name}" (draft)`, { sourceId: id, sourceVersion: N(src.current_version) }, trx);
    });
    return this.detail(ctx, nid);
  }

  /** activate / deactivate / archive / restore (guide §06, §14) — through the SALON_MESSAGE_TEMPLATE machine */
  async setStatus(ctx: TemplatesContext, id: string, b: { to?: unknown; recordVersion?: unknown; replacementTemplateId?: unknown; confirm?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    const to = String(b?.to ?? '');
    if (!['active', 'inactive', 'archived'].includes(to)) throw err('Choose Activate, Deactivate or Archive.', 'TEMPLATE_STATUS_INVALID');
    const expected = Math.trunc(Number(b?.recordVersion));
    if (!expected) throw err('This change needs the version you started from. Reload and try again.', 'TEMPLATE_VERSION_REQUIRED');
    let moved = 0;
    await this.db.transaction().execute(async (trx: any) => {
      const cur = await this.mustRow(ctx, id, trx, true);
      if (N(cur.record_version) !== expected) throw err('Someone else changed this template after you opened it. Reload first.', 'TEMPLATE_VERSION_CONFLICT', 409, { current: this.rowView(cur) });
      const target = cur.status === 'archived' && to === 'active' ? null : to;   // archived → restore lands on inactive (re-activate on purpose)
      if (!target || !SALON_MESSAGE_TEMPLATE.sourcesOf(target).includes(cur.status)) throw err(cur.status === 'archived' ? 'Restore the template first (it comes back inactive), then activate it.' : `A ${cur.status} template cannot become ${to}.`, 'TEMPLATE_STATUS_INVALID', 409);
      if (target === 'active') {
        const v = validateTemplate({ channel: cur.channel, category: cur.category, subject: cur.subject, body: cur.body, name: cur.name });
        if (v.errors.length) throw err(v.errors[0].message, 'TEMPLATE_INVALID', 422, { validation: v });
      }
      const binds = (await this.bindingRows(ctx, id, trx)).filter((x) => x.active);
      if (target !== 'active' && binds.length) {
        const rep = typeof b?.replacementTemplateId === 'string' ? b.replacementTemplateId : '';
        if (!rep) throw err(`${binds.length} active automation(s) use this template. Choose a replacement template, or change the automation first.`, 'TEMPLATE_IN_USE', 409, { bindings: binds });
        if (b?.confirm !== true) throw err('Confirm moving the automations to the replacement template.', 'CONFIRMATION_REQUIRED', 409, { bindings: binds });
        if (rep === id) throw err('Pick a different template as the replacement.', 'TEMPLATE_REPLACEMENT_INVALID');
        const r = (await sql<any>`select id, status, channel, category, subject, body from pos_message_templates where tenant_id = ${ctx.tenantId} and id = ${rep} for update`.execute(trx)).rows[0];
        if (!r || r.status !== 'active') throw err('The replacement must be an active template.', 'TEMPLATE_REPLACEMENT_INVALID');
        for (const bd of binds) {
          if (r.channel !== bd.channel) throw err(`The replacement must be a ${bd.channel.toUpperCase()} template.`, 'TEMPLATE_REPLACEMENT_INVALID');
          if (!(WF.get(bd.workflow)?.categories ?? []).includes(r.category)) throw err(`The replacement must be a ${String(WF.get(bd.workflow)?.categories[0] ?? '').replace(/_/g, ' ')} template.`, 'TEMPLATE_REPLACEMENT_INVALID');
        }
        const mv = await sql`update pos_message_template_bindings set template_id = ${rep}, version_strategy = 'latest', pinned_version = null, record_version = record_version + 1, updated_by = ${this.actorId(ctx)}::uuid, updated_at = now()
          where tenant_id = ${ctx.tenantId} and template_id = ${id} and active`.execute(trx);
        moved = Number(mv.numAffectedRows ?? binds.length);
      }
      const u = (await sql<any>`update pos_message_templates set status = ${target}, archived_at = case when ${target} = 'archived' then now() else null end,
          record_version = record_version + 1, updated_by = ${this.actorId(ctx)}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${id} and record_version = ${expected} and ${canMoveToSql(SALON_MESSAGE_TEMPLATE, target)} returning id`.execute(trx)).rows[0];
      if (!u) throw err('Someone else changed this template after you opened it. Reload first.', 'TEMPLATE_VERSION_CONFLICT', 409);
      await this.audit(ctx, `message_template.${cur.status === 'archived' ? 'restore' : target === 'active' ? 'activate' : target === 'inactive' ? 'deactivate' : 'archive'}`, id,
        `Template "${cur.name}" ${cur.status} → ${target}${moved ? ` (${moved} automation(s) moved to the replacement)` : ''}`, { from: cur.status, to: target, movedBindings: moved, replacement: moved ? b?.replacementTemplateId : null }, trx);
    });
    return { ...(await this.detail(ctx, id)), movedBindings: moved };
  }

  // ── preview (never sends) ─────────────────────────────────────────────────────────────────────────────────────────
  private async salonValues(ctx: TemplatesContext, branchId: string | null, db: Kysely<any> = this.db): Promise<Values> {
    const t = (await sql<any>`select display_name, business_phone from tenants where id = ${ctx.tenantId}`.execute(db)).rows[0];
    const b = branchId && UUID.test(branchId) ? (await sql<any>`select name, phone from branches where tenant_id = ${ctx.tenantId} and id = ${branchId}`.execute(db)).rows[0] : null;
    return { salon_name: t?.display_name ?? null, branch_name: b?.name ?? null, salon_phone: b?.phone || t?.business_phone || null };
  }
  /** a real customer's values — only this salon's customer (and this branch's, for a branch user), only with customer access */
  private async customerValues(ctx: TemplatesContext, customerId: string, appointmentId: string | null, db: Kysely<any> = this.db): Promise<{ values: Values; branchId: string | null }> {
    if (!UUID.test(customerId)) throw err('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const c = (await sql<any>`select c.id, c.first_name, c.full_name, c.branch_id from customers c where c.tenant_id = ${ctx.tenantId} and c.id = ${customerId}
        and ${ctx.branchId && UUID.test(ctx.branchId) ? sql`(c.branch_id = ${ctx.branchId} or c.branch_id is null)` : sql`true`}`.execute(db)).rows[0];
    if (!c) throw err('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const tz = await tenantTimeZone(db, ctx.tenantId);
    const values: Values = { customer_first_name: c.first_name || String(c.full_name ?? '').split(' ')[0] || null, customer_full_name: c.full_name ?? null };
    let branchId: string | null = c.branch_id ?? null;
    if (appointmentId) {
      if (!UUID.test(appointmentId)) throw err('Appointment not found.', 'APPOINTMENT_NOT_FOUND', 404);
      const a = (await sql<any>`select a.id, a.branch_id, to_char(a.appt_date, 'YYYY-MM-DD') as d, a.start_time, a.services, tc.full_name as tech
          from pos_tech_appointments a left join technicians tc on tc.id = a.technician_id and tc.tenant_id = a.tenant_id
          where a.tenant_id = ${ctx.tenantId} and a.id = ${appointmentId} and a.customer_id = ${customerId}`.execute(db)).rows[0];
      if (!a) throw err('That appointment is not this customer\'s.', 'APPOINTMENT_NOT_FOUND', 404);
      Object.assign(values, appointmentValues(a.d, a.start_time, tz, a.services, a.tech, a.id));
      branchId = a.branch_id ?? branchId;
    }
    const last = (await sql<any>`select to_char(coalesce(tk.paid_at, tk.created_at) at time zone ${tz}, 'Mon FMDD') as d,
        (select tl.service_name_snapshot from ticket_service_lines tl where tl.ticket_id = tk.id and tl.tenant_id = tk.tenant_id order by tl.service_name_snapshot limit 1) as svc
        from tickets tk where tk.tenant_id = ${ctx.tenantId} and tk.customer_id = ${customerId} and tk.status in ('paid', 'closed')
        order by coalesce(tk.paid_at, tk.created_at) desc limit 1`.execute(db).catch((e: unknown) => { logException(e, { where: 'message_templates.last_visit' }); return { rows: [] as { d: string | null; svc: string | null }[] }; })).rows[0];
    if (last) { values.last_visit_date = last.d ?? null; values.last_service = last.svc ?? null; }
    return { values, branchId };
  }

  async preview(ctx: TemplatesContext, b: any) {
    this.need(ctx, 'pos.communications.view');
    let content: { channel: string; category: string | null; subject: string | null; body: string }; let version: number | null = null; let templateId: string | null = null; let name: string | null = null;
    if (b?.templateId) {
      const row = await this.mustRow(ctx, String(b.templateId));
      templateId = String(row.id); name = row.name;
      version = b?.version ? Math.trunc(Number(b.version)) : N(row.current_version);
      const v = (await sql<any>`select channel, category, subject, body from pos_message_template_versions where tenant_id = ${ctx.tenantId} and template_id = ${templateId} and version = ${version}`.execute(this.db)).rows[0];
      if (!v) throw err('That version does not exist.', 'TEMPLATE_VERSION_NOT_FOUND', 404);
      content = { channel: v.channel, category: v.category ?? null, subject: v.subject ?? null, body: String(v.body) };
    } else {
      const d = b?.draft ?? {};
      content = { channel: d.channel === 'email' ? 'email' : 'sms', category: typeof d.category === 'string' && d.category ? d.category : null, subject: typeof d.subject === 'string' ? d.subject : null, body: String(d.body ?? '').slice(0, 25_000) };
    }
    let values: Values = fixtureValues(); let source: 'sample' | 'customer' = 'sample';
    if (b?.customerId) {
      if (!can(ctx, 'pos.customers.view')) throw err('You do not have permission to preview with a real customer. Sample data is used instead.', 'PERMISSION_DENIED', 403);
      const cv = await this.customerValues(ctx, String(b.customerId), typeof b?.appointmentId === 'string' && b.appointmentId ? b.appointmentId : null);
      values = { ...(await this.salonValues(ctx, cv.branchId)), ...cv.values }; source = 'customer';
      await this.audit(ctx, 'message_template.preview_customer', templateId, 'Template previewed with a real customer\'s details (nothing sent)', { customerId: b.customerId, appointmentId: b?.appointmentId ?? null, version });
    }
    const r = renderTemplate(content, values);
    const validation = validateTemplate({ ...content });
    return { templateId, name, version, channel: content.channel, category: content.category, source, sent: false, rendered: r, validation,
      unresolved: r.missing, note: source === 'sample' ? 'Sample data — not a real customer. Nothing is sent.' : 'Real customer details (read-only). Nothing is sent.' };
  }

  // ── Test Send: separate, confirmed, idempotent (guide §09) ─────────────────────────────────────────────────────────
  async testSend(ctx: TemplatesContext, id: string, b: { to?: unknown; version?: unknown; confirm?: unknown }, key: string | null) {
    this.need(ctx, 'pos.communications.manage');
    if (!key || key.length < 8 || key.length > 200) throw err('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (b?.confirm !== true) throw err('Confirm the test send: one real message will be sent to the number or address you entered.', 'CONFIRMATION_REQUIRED', 409);
    const row = await this.mustRow(ctx, id);
    if (row.status === 'archived') throw err('Archived templates cannot be tested. Restore it first.', 'TEMPLATE_ARCHIVED', 409);
    const version = b?.version ? Math.trunc(Number(b.version)) : N(row.current_version);
    const v = (await sql<any>`select channel, category, subject, body from pos_message_template_versions where tenant_id = ${ctx.tenantId} and template_id = ${id} and version = ${version}`.execute(this.db)).rows[0];
    if (!v) throw err('That version does not exist.', 'TEMPLATE_VERSION_NOT_FOUND', 404);
    const channel: 'sms' | 'email' = v.channel === 'email' ? 'email' : 'sms';
    const to = channel === 'sms' ? E164(String(b?.to ?? '')) : (EMAIL.test(String(b?.to ?? '').trim()) ? String(b?.to).trim().toLowerCase() : null);
    if (!to) throw err(channel === 'sms' ? 'Enter a valid mobile number for the test.' : 'Enter a valid email address for the test.', 'TEST_RECIPIENT_INVALID');
    const masked = channel === 'sms' ? maskPhone(to)! : maskEmail(to)!;
    const hash = createHash('sha256').update(`${ctx.tenantId}:${to}`).digest('hex');
    // reserve first: the key makes a retried click the same test, never a second message
    const ins = (await sql<any>`insert into pos_message_template_tests (tenant_id, branch_id, template_id, template_version, channel, target_masked, target_hash, idempotency_key, status, created_by, updated_by)
        values (${ctx.tenantId}, ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}::uuid, ${id}, ${version}, ${channel}, ${masked}, ${hash}, ${key}, 'submitting', ${this.actorId(ctx)}::uuid, ${this.actorId(ctx)}::uuid)
        on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(this.db)).rows[0];
    if (!ins) {
      const ex = (await sql<any>`select x.id, x.template_id, x.status, x.target_masked, x.provider_ref, x.error_code, n.status as delivery from pos_message_template_tests x left join notifications n on n.id = x.notification_id and n.tenant_id = x.tenant_id
          where x.tenant_id = ${ctx.tenantId} and x.idempotency_key = ${key}`.execute(this.db)).rows[0];
      if (!ex || ex.template_id !== id) throw err('This request id was already used for something else.', 'IDEMPOTENCY_KEY_REUSED', 409);
      return { duplicate: true, testId: String(ex.id), status: ex.status, target: ex.target_masked, providerRef: ex.provider_ref ?? null, errorCode: ex.error_code ?? null, delivery: deliveryOf(ex.status, ex.delivery) };
    }
    const testId = String(ins.id);
    const rendered = renderTemplate({ channel, subject: v.subject, body: v.body }, { ...fixtureValues(), ...(await this.salonValues(ctx, ctx.branchId ?? null)) });
    let outcome: { status: 'submitted' | 'simulated' | 'blocked' | 'failed'; providerRef: string | null; notificationId: string | null; error: string | null };
    if (!this.sender) outcome = { status: 'blocked', providerRef: null, notificationId: null, error: 'MESSENGER_UNAVAILABLE' };
    else {
      try {
        if (channel === 'sms') {
          // the salon's OWN Twilio only (owner rule: never the platform's shared sender as a workaround); opt-outs still apply
          const r = await this.sender.sendSms({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, to, body: rendered.text, purpose: 'notification', meter: true, requireOwnAccount: true });
          outcome = r.sent ? { status: r.simulated ? 'simulated' : 'submitted', providerRef: r.providerId ?? null, notificationId: r.notificationId ?? null, error: null }
            : { status: r.status === 'blocked' ? 'blocked' : 'failed', providerRef: null, notificationId: r.notificationId ?? null, error: String(r.reason ?? r.status).slice(0, 80) };
        } else {
          const r = await this.sender.send({ tenantId: ctx.tenantId, userId: ctx.userId ?? '', role: ctx.role ?? 'OWNER' }, { channel: 'email', to, subject: rendered.subject || String(row.name), body: rendered.text });
          outcome = r.sent ? { status: r.simulated || r.status === 'simulated' ? 'simulated' : 'submitted', providerRef: r.providerId ?? null, notificationId: r.id ?? null, error: null }
            : { status: r.status === 'blocked' ? 'blocked' : 'failed', providerRef: null, notificationId: null, error: String(r.reason ?? r.status).slice(0, 80) };
        }
      } catch {
        outcome = { status: 'failed', providerRef: null, notificationId: null, error: 'send_failed' };
      }
    }
    await sql`update pos_message_template_tests set status = ${outcome.status}, provider_ref = ${outcome.providerRef}, notification_id = ${outcome.notificationId && UUID.test(outcome.notificationId) ? outcome.notificationId : null}::uuid,
        error_code = ${outcome.error}, updated_at = now(), updated_by = ${this.actorId(ctx)}::uuid
      where tenant_id = ${ctx.tenantId} and id = ${testId} and ${canMoveToSql(MESSAGE_TEMPLATE_TEST, outcome.status)}`.execute(this.db);
    await recordTemplateUsage(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, templateId: id, version, workflow: 'test_send', channel, notificationId: outcome.notificationId, testId,
      recipientMasked: masked, subject: rendered.subject, body: rendered.text, outcome: outcome.status, reason: outcome.error, actorId: this.actorId(ctx) });
    await this.audit(ctx, 'message_template.test_send', id, `Test ${channel.toUpperCase()} of "${row.name}" v${version} to ${masked}: ${outcome.status}`, { testId, version, channel, target: masked, status: outcome.status, reason: outcome.error },
      this.db, outcome.status === 'submitted' || outcome.status === 'simulated' ? 'success' : 'failure');
    return { duplicate: false, testId, status: outcome.status, target: masked, providerRef: outcome.providerRef, errorCode: outcome.error, delivery: deliveryOf(outcome.status, null), rendered: { text: rendered.text, subject: rendered.subject, sms: rendered.sms } };
  }

  // ── Automation Connection Center (guide §14) ────────────────────────────────────────────────────────────────────────
  private async bindingRows(ctx: TemplatesContext, templateId: string | null, db: Kysely<any> = this.db) {
    const rows = (await sql<any>`select b.id, b.workflow, b.channel, b.template_id, b.version_strategy, b.pinned_version, b.branch_id, b.active, b.record_version, b.updated_at,
        t.name as template_name, t.status as template_status, t.current_version, br.name as branch_name
      from pos_message_template_bindings b join pos_message_templates t on t.tenant_id = b.tenant_id and t.id = b.template_id
      left join branches br on br.id = b.branch_id and br.tenant_id = b.tenant_id
      where b.tenant_id = ${ctx.tenantId} and ${templateId ? sql`b.template_id = ${templateId}` : sql`true`} and ${this.branchW(ctx, sql`b.branch_id`)}
      order by b.active desc, b.updated_at desc limit 100`.execute(db)).rows;
    return rows.map((r: any) => ({ id: String(r.id), workflow: String(r.workflow), channel: String(r.channel), templateId: String(r.template_id), templateName: r.template_name, templateStatus: r.template_status,
      strategy: r.version_strategy, version: r.version_strategy === 'pinned' ? N(r.pinned_version) : N(r.current_version), branchId: r.branch_id ?? null, branchName: r.branch_name ?? null,
      active: !!r.active, recordVersion: N(r.record_version), updatedAt: iso(r.updated_at), healthy: r.template_status === 'active' }));
  }

  async connections(ctx: TemplatesContext, templateId: string | null) {
    this.need(ctx, 'pos.communications.view');
    if (templateId) await this.mustRow(ctx, templateId);
    const binds = await this.bindingRows(ctx, null);
    const lastUse = (await sql<any>`select pu.workflow, max(pu.created_at) as last, count(*)::int as n from pos_message_template_usage pu where pu.tenant_id = ${ctx.tenantId} group by pu.workflow`.execute(this.db)).rows;
    const lu = new Map(lastUse.map((r: any) => [String(r.workflow), r]));
    const rem = (await sql<{ enabled: boolean; channel: string }>`select enabled, channel from reminder_settings where tenant_id = ${ctx.tenantId} limit 1`.execute(this.db)).rows[0];
    const workflows = WORKFLOW_CATALOG.map((w) => {
      const active = binds.filter((x) => x.workflow === w.key && x.active);
      return {
        ...w, workflowActive: w.key === 'appointment_reminder' ? (rem ? !!rem.enabled : false) : null, workflowChannel: w.key === 'appointment_reminder' ? rem?.channel ?? null : null,
        bindings: active, usesThisTemplate: templateId ? active.some((x) => x.templateId === templateId) || (w.key === 'sms_inbox') : null,
        lastUsedAt: iso(lu.get(w.key)?.last ?? null), messagesFromTemplates: N(lu.get(w.key)?.n),
      };
    });
    return { workflows, templateId, checkedAt: new Date().toISOString() };
  }

  async bind(ctx: TemplatesContext, b: { workflow?: unknown; channel?: unknown; templateId?: unknown; branchId?: unknown; strategy?: unknown; pinnedVersion?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    const wf = WF.get(String(b?.workflow ?? ''));
    if (!wf) throw err('Choose an automation from the list.', 'WORKFLOW_INVALID');
    if (!wf.bindable) throw err(`${wf.label} does not read templates yet, so it cannot be connected. ${wf.handoff ?? ''}`.trim(), 'WORKFLOW_NOT_BINDABLE', 409);
    const channel = b?.channel === 'email' ? 'email' : 'sms';
    if (!wf.channels.includes(channel)) throw err(`${wf.label} does not send ${channel.toUpperCase()}.`, 'WORKFLOW_CHANNEL_INVALID');
    const strategy = b?.strategy === 'pinned' ? 'pinned' : 'latest';
    let bindingId = '';
    await this.db.transaction().execute(async (trx: any) => {
      // the same (salon / branch, workflow, channel) is serialized: one active binding at a time (uq_pmtb_active backs it)
      await sql`select pg_advisory_xact_lock(hashtextextended(${`mt-bind:${ctx.tenantId}:${wf.key}:${channel}`}, 0))`.execute(trx);
      const tpl = await this.mustRow(ctx, String(b?.templateId ?? ''), trx, true);
      if (tpl.status !== 'active') throw err('Only an active template can be connected to an automation.', 'TEMPLATE_NOT_ACTIVE', 409);
      if (tpl.channel !== channel) throw err(`Choose a ${channel.toUpperCase()} template.`, 'TEMPLATE_CHANNEL_MISMATCH');
      if (!wf.categories.includes(tpl.category)) throw err(`${wf.label} needs a ${wf.categories[0].replace(/_/g, ' ')} template (its category decides which variables it can fill).`, 'TEMPLATE_CATEGORY_MISMATCH');
      const v = validateTemplate({ channel: tpl.channel, category: tpl.category, subject: tpl.subject, body: tpl.body });
      if (v.errors.length) throw err(v.errors[0].message, 'TEMPLATE_INVALID', 422, { validation: v });
      const pinned = strategy === 'pinned' ? Math.trunc(Number(b?.pinnedVersion)) || N(tpl.current_version) : null;
      if (pinned != null && !(await sql<any>`select 1 from pos_message_template_versions where tenant_id = ${ctx.tenantId} and template_id = ${tpl.id} and version = ${pinned}`.execute(trx)).rows[0]) throw err('That version does not exist.', 'TEMPLATE_VERSION_NOT_FOUND', 404);
      const branchId = await this.branchOk(ctx, b?.branchId ?? null, trx);
      // one active binding per (salon / branch, workflow, channel): the previous one is switched off in the same transaction
      await sql`update pos_message_template_bindings set active = false, record_version = record_version + 1, updated_by = ${this.actorId(ctx)}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and workflow = ${wf.key} and channel = ${channel} and active and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${branchId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`.execute(trx);
      bindingId = String((await sql<any>`insert into pos_message_template_bindings (tenant_id, branch_id, workflow, channel, template_id, version_strategy, pinned_version, active, created_by, updated_by)
        values (${ctx.tenantId}, ${branchId}::uuid, ${wf.key}, ${channel}, ${tpl.id}, ${strategy}, ${pinned}, true, ${this.actorId(ctx)}::uuid, ${this.actorId(ctx)}::uuid) returning id`.execute(trx)).rows[0].id);
      await this.audit(ctx, 'message_template.bind', tpl.id, `"${tpl.name}" connected to ${wf.label} (${channel.toUpperCase()}${strategy === 'pinned' ? `, pinned to v${pinned}` : ', latest version'})`, { bindingId, workflow: wf.key, channel, strategy, pinned, branchId }, trx);
    });
    return { bindingId, sent: false, ...(await this.connections(ctx, null)) };
  }

  async unbind(ctx: TemplatesContext, bindingId: string, b: { recordVersion?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    if (!UUID.test(bindingId)) throw err('Connection not found.', 'BINDING_NOT_FOUND', 404);
    const expected = Math.trunc(Number(b?.recordVersion));
    await this.db.transaction().execute(async (trx: any) => {
      const r = (await sql<any>`select b.id, b.workflow, b.template_id, b.record_version, b.active from pos_message_template_bindings b where b.tenant_id = ${ctx.tenantId} and b.id = ${bindingId} and ${this.branchW(ctx, sql`b.branch_id`)} for update`.execute(trx)).rows[0];
      if (!r || !r.active) throw err('Connection not found.', 'BINDING_NOT_FOUND', 404);
      if (expected && N(r.record_version) !== expected) throw err('Someone else changed this connection. Reload first.', 'BINDING_VERSION_CONFLICT', 409);
      await sql`update pos_message_template_bindings set active = false, record_version = record_version + 1, updated_by = ${this.actorId(ctx)}::uuid, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${bindingId}`.execute(trx);
      await this.audit(ctx, 'message_template.unbind', String(r.template_id), `Template disconnected from ${WF.get(r.workflow)?.label ?? r.workflow}; it uses its built-in text again`, { bindingId, workflow: r.workflow }, trx);
    });
    return this.connections(ctx, null);
  }

  // ── Template Usage / Message History (guide §11) ────────────────────────────────────────────────────────────────────
  async usage(ctx: TemplatesContext, q: { q?: string; templateId?: string; channel?: string; status?: string; workflow?: string; basis?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.period(ctx, q, 'all');
    const conds = [sql`pu.tenant_id = ${T}`, this.branchW(ctx, sql`pu.branch_id`)];
    if (q.templateId) { await this.mustRow(ctx, q.templateId); conds.push(sql`pu.template_id = ${q.templateId}`); }
    if (q.channel && (MT_CHANNELS as readonly string[]).includes(q.channel)) conds.push(sql`pu.channel = ${q.channel}`);
    if (q.workflow && (MT_WORKFLOWS as readonly string[]).includes(q.workflow)) conds.push(sql`pu.workflow = ${q.workflow}`);
    const st = String(q.status ?? 'all');
    if (st === 'blocked' || st === 'failed') conds.push(sql`(pu.send_outcome = ${st} or (pu.send_outcome = 'submitted' and n.status in ('failed', 'undelivered') and ${st} = 'failed'))`);
    else if (st === 'simulated') conds.push(sql`pu.send_outcome = 'simulated'`);
    else if (st === 'delivered') conds.push(sql`pu.send_outcome = 'submitted' and n.status = 'delivered'`);
    else if (st === 'submitted') conds.push(sql`pu.send_outcome = 'submitted' and coalesce(n.status, '') not in ('delivered', 'failed', 'undelivered')`);
    else if (st === 'unknown') conds.push(sql`pu.send_outcome = 'submitted' and n.id is null`);
    const basis = (MT_USAGE_BASES as readonly string[]).includes(String(q.basis)) ? String(q.basis) : 'created';
    conds.push(this.inP(basis === 'sent' ? sql`n.created_at` : basis === 'provider_event' ? sql`n.delivered_at` : sql`pu.created_at`, p));
    const term = String(q.q ?? '').trim().slice(0, 100);
    if (term) {
      const digits = term.replace(/\D/g, '');
      const phoneLike = /^[\d\s()+.\-]+$/.test(term) && digits.length >= 4;
      conds.push(sql`(${phoneLike ? sql`right(regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g'), ${Math.min(10, digits.length)}) = right(${digits}, ${Math.min(10, digits.length)})` : sql`false`}
        or c.full_name ilike ${like(term)} or lower(coalesce(c.email, '')) = ${term.toLowerCase()} or t.name ilike ${like(term)} or pu.template_id = ${term}
        or n.provider_id = ${term} ${UUID.test(term) ? sql`or pu.id = ${term}::uuid or pu.customer_id = ${term}::uuid or pu.appointment_id = ${term}::uuid or pu.message_id = ${term}::uuid or pu.notification_id = ${term}::uuid or pu.thread_id = ${term}::uuid` : sql``})`);
      // a customer phone / name / email lookup over message history is sensitive: who searched, when, never the raw term
      await this.audit(ctx, 'message_template.usage_search', q.templateId ?? null, 'Template message history searched', { kind: phoneLike ? 'phone' : UUID.test(term) ? 'id' : term.includes('@') ? 'email' : 'text', chars: term.length });
    }
    const from = sql`pos_message_template_usage pu join pos_message_templates t on t.tenant_id = pu.tenant_id and t.id = pu.template_id
      left join customers c on c.id = pu.customer_id and c.tenant_id = pu.tenant_id left join notifications n on n.id = pu.notification_id and n.tenant_id = pu.tenant_id`;
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from ${from} where pu.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const pg = paging(q.page, q.pageSize); const sv = served(pg.page, pg.pageSize, total);
    const rows = (await sql<any>`select pu.id, pu.template_id, pu.template_version, pu.workflow, pu.channel, pu.customer_id, pu.appointment_id, pu.thread_id, pu.message_id, pu.notification_id, pu.recipient_masked,
        pu.rendered_subject, pu.rendered_body, pu.send_outcome, pu.outcome_reason, pu.created_at, t.name as template_name, c.full_name as customer_name, c.normalized_phone,
        n.status as delivery_status, n.provider_id, n.created_at as sent_at, n.delivered_at as provider_event_at
      from ${from} where pu.tenant_id = ${T} and ${where} order by pu.created_at desc, pu.id desc limit ${pg.pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({
        id: String(r.id), templateId: String(r.template_id), templateName: r.template_name, version: N(r.template_version), workflow: r.workflow, channel: r.channel,
        customerId: r.customer_id ?? null, customerName: r.customer_name ?? null, recipient: r.recipient_masked ?? (r.channel === 'sms' ? maskPhone(r.normalized_phone) : null),
        appointmentId: r.appointment_id ?? null, threadId: r.thread_id ?? null, messageId: r.message_id ?? null, notificationId: r.notification_id ?? null, providerRef: r.provider_id ?? null,
        renderedSubject: r.rendered_subject ?? null, renderedBody: r.rendered_body, sendOutcome: r.send_outcome, reason: r.outcome_reason ?? null,
        delivery: deliveryOf(r.send_outcome, r.notification_id ? (r.delivery_status ?? 'missing') : null), createdAt: iso(r.created_at), sentAt: iso(r.sent_at), providerEventAt: iso(r.provider_event_at),
      })),
      page: sv.page, pageSize: pg.pageSize, totalItems: total, totalPages: sv.totalPages, basis, period: p,
      unlinkedNote: 'Messages sent before templates were tracked (or typed by hand) are not linked to a template and are not listed here.',
    };
  }

  // ── health check (guide §17 "Health check") — read-only, never sends ───────────────────────────────────────────────────
  async healthCheck(ctx: TemplatesContext, env: Record<string, string | undefined> = process.env) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const findings: { key: string; status: 'ready' | 'attention' | 'failed' | 'info'; message: string; evidence: string; fix: string | null; templateId?: string }[] = [];
    const f = (key: string, status: 'ready' | 'attention' | 'failed' | 'info', message: string, evidence: string, fix: string | null, templateId?: string) => findings.push({ key, status, message, evidence, fix, ...(templateId ? { templateId } : {}) });
    const rows = (await sql<any>`select t.id, t.name, t.channel, t.category, t.subject, t.body, t.status, t.created_at from pos_message_templates t where t.tenant_id = ${T} and ${this.branchW(ctx)} and t.status <> 'archived' order by t.name limit 500`.execute(this.db)).rows;
    let bad = 0, legacy = 0, noCategory = 0;
    for (const r of rows) {
      const v = validateTemplate({ channel: r.channel, category: r.category, subject: r.subject, body: r.body, name: r.name });
      if (v.warnings.some((w) => w.code === 'TEMPLATE_LEGACY_PLACEHOLDER')) legacy++;
      if (!r.category) noCategory++;
      if (v.errors.length && r.status === 'active') { bad++; f('template_invalid', 'failed', `"${r.name}" is active but has a problem: ${v.errors[0].message}`, v.errors.map((e) => e.code).join(', '), 'Open the template, fix it, then save.', String(r.id)); }
      else if (v.errors.length) f('template_draft_invalid', 'attention', `"${r.name}" (${r.status}) cannot be activated yet: ${v.errors[0].message}`, v.errors.map((e) => e.code).join(', '), 'Fix it before activating.', String(r.id));
      const rr = renderTemplate({ channel: r.channel, subject: r.subject, body: r.body }, fixtureValues());
      if (rr.unknown.length && r.status === 'active') f('template_render_unknown', 'failed', `"${r.name}" would send ${rr.unknown.join(', ')} literally.`, 'rendered with sample data', 'Replace the placeholder with one from the variable list.', String(r.id));
    }
    if (!rows.length) f('templates_none', 'info', 'This salon has no templates yet (verified: the query returned zero rows for this salon).', 'pos_message_templates: 0 rows for this salon', 'Create one with New Template.');
    else if (!bad) f('templates_valid', 'ready', `All ${rows.filter((r: any) => r.status === 'active').length} active template(s) pass validation.`, `${rows.length} non-archived template(s) checked`, null);
    if (legacy) f('templates_legacy', 'info', `${legacy} template(s) use the old [name] / {name} placeholder. It keeps working (it means {customer_first_name}).`, 'legacy alias resolver', null);
    if (noCategory) f('templates_no_category', 'info', `${noCategory} template(s) have no category; they can be used in the SMS Inbox but cannot be connected to an automation.`, 'category is empty', 'Pick a category to connect one to an automation.');
    const binds = await this.bindingRows(ctx, null);
    for (const b of binds.filter((x) => x.active)) {
      if (!b.healthy) f('binding_template_inactive', 'failed', `${WF.get(b.workflow)?.label ?? b.workflow} is connected to "${b.templateName}", which is ${b.templateStatus}. The automation uses its built-in text until this is fixed.`, `binding ${b.id}`, 'Connect an active template, or disconnect it.');
      else if (b.strategy === 'pinned' && !(await sql<any>`select 1 from pos_message_template_versions where tenant_id = ${T} and template_id = ${b.templateId} and version = ${b.version}`.execute(this.db)).rows[0]) f('binding_version_missing', 'failed', `A pinned version of "${b.templateName}" is missing.`, `binding ${b.id}`, 'Re-connect it to the latest version.');
      else f('binding_ok', 'ready', `${WF.get(b.workflow)?.label ?? b.workflow} uses "${b.templateName}" v${b.version} (${b.strategy === 'pinned' ? 'pinned' : 'latest'}).`, `binding ${b.id}`, null);
    }
    const cred = (await sql<any>`select (from_number is not null and from_number <> '') as has_from, (messaging_service_sid is not null and messaging_service_sid <> '') as has_svc, last_validated_at, last_validation_error
        from tenant_messaging_credentials where tenant_id = ${T} and provider = 'twilio' order by branch_id nulls first limit 1`.execute(this.db)).rows[0];
    if (!cred) f('sms_sender', 'attention', 'No Twilio account is connected for this salon, so SMS templates cannot be tested or sent.', 'tenant_messaging_credentials: none', 'Open Communications → Phone & Messaging to connect the salon\'s own Twilio account.');
    else if (cred.last_validation_error) f('sms_sender', 'failed', 'The salon\'s Twilio account failed its last check.', 'a validation error is recorded', 'Run the Phone & Messaging health check.');
    else if (!cred.has_from && !cred.has_svc) f('sms_sender', 'attention', 'Twilio is connected but has no sending number.', 'no from number / messaging service', 'Assign a sending number in Phone & Messaging.');
    else f('sms_sender', cred.last_validated_at ? 'ready' : 'attention', cred.last_validated_at ? 'The salon\'s Twilio account and sender are set.' : 'Twilio is set but has never been checked.', 'tenant credentials (no secret shown)', cred.last_validated_at ? null : 'Run the Phone & Messaging health check.');
    f('email_sender', String(env.SENDGRID_API_KEY ?? '').trim() ? 'ready' : 'attention', String(env.SENDGRID_API_KEY ?? '').trim() ? 'The email provider is configured.' : 'No email provider is configured here: email templates can be previewed but not sent.', 'SENDGRID_API_KEY present / absent (value never shown)', null);
    await this.audit(ctx, 'message_template.health_check', null, `Template health check: ${findings.filter((x) => x.status === 'failed').length} failed, ${findings.filter((x) => x.status === 'attention').length} attention`, { failed: findings.filter((x) => x.status === 'failed').length });
    return { checkedAt: new Date().toISOString(), findings, sent: false };
  }

  // ── the SMS Inbox composer: a template inserted into a conversation, rendered for ITS customer (guide P0) ─────────────
  async renderForConversation(ctx: TemplatesContext, threadId: string, templateId: string) {
    this.need(ctx, 'pos.communications.send');
    if (!UUID.test(threadId)) throw err('Conversation not found.', 'THREAD_NOT_FOUND', 404);
    const th = (await sql<any>`select id, branch_id, customer_id, customer_name from communication_threads where tenant_id = ${ctx.tenantId} and id = ${threadId}
        and ${ctx.branchId && UUID.test(ctx.branchId) ? sql`(branch_id = ${ctx.branchId} or branch_id is null)` : sql`true`}`.execute(this.db)).rows[0];
    if (!th) throw err('Conversation not found.', 'THREAD_NOT_FOUND', 404);
    let content: { channel: string; subject: string | null; body: string }; let version: number | null = null; let scope: 'salon' | 'platform' = 'salon';
    const own = TPL_ID.test(templateId) ? (await sql<any>`select id, status, channel, subject, body, current_version from pos_message_templates where tenant_id = ${ctx.tenantId} and id = ${templateId}`.execute(this.db)).rows[0] : null;
    if (own) {
      if (own.status !== 'active') throw err('This template is not active, so it cannot be used for new messages.', 'TEMPLATE_NOT_ACTIVE', 409);
      content = { channel: own.channel, subject: own.subject, body: own.body }; version = N(own.current_version);
    } else if (UUID.test(templateId)) {
      const pt = (await sql<any>`select mt.id, mt.channel, v.body, v.version from message_templates mt join message_template_versions v on v.template_id = mt.id and v.version = mt.current_version and v.status = 'published'
          where mt.id = ${templateId} and (mt.tenant_id = ${ctx.tenantId} or mt.tenant_id is null) and mt.status = 'published'`.execute(this.db)).rows[0];
      if (!pt) throw err('Template not found.', 'TEMPLATE_NOT_FOUND', 404);
      content = { channel: pt.channel, subject: null, body: pt.body }; version = N(pt.version); scope = 'platform';
    } else throw err('Template not found.', 'TEMPLATE_NOT_FOUND', 404);
    if (content.channel !== 'sms') throw err('Only SMS templates can be used in a text conversation.', 'TEMPLATE_CHANNEL_MISMATCH');
    let values: Values = await this.salonValues(ctx, th.branch_id ?? null);
    if (th.customer_id) values = { ...values, ...(await this.customerValues({ ...ctx, branchId: null }, String(th.customer_id), null)).values };
    else if (th.customer_name) values = { ...values, customer_first_name: String(th.customer_name).trim().split(/\s+/)[0] || null, customer_full_name: String(th.customer_name).trim() || null };
    const r = renderTemplate(content, values);
    return { templateId, version, scope, text: r.text, missing: r.missing, unknown: r.unknown, sms: r.sms, customerLinked: !!th.customer_id };
  }
}

/** delivery state from the provider's own events only (guide §18): submitted ≠ delivered; no ledger row → Unknown */
export function deliveryOf(outcome: string, notificationStatus: string | null): 'delivered' | 'sent' | 'failed' | 'blocked' | 'simulated' | 'unknown' | 'pending' {
  if (outcome === 'blocked') return 'blocked';
  if (outcome === 'failed') return 'failed';
  if (outcome === 'simulated') return 'simulated';
  if (outcome === 'submitting') return 'pending';
  if (notificationStatus == null || notificationStatus === 'missing') return 'unknown';
  if (notificationStatus === 'delivered') return 'delivered';
  if (notificationStatus === 'failed' || notificationStatus === 'undelivered') return 'failed';
  if (notificationStatus === 'simulated') return 'simulated';
  return 'sent';
}

/** appointment variables in the salon's zone (shared by preview and the reminder sender) */
export function appointmentValues(apptDate: string | null, startTime: string | null, tz: string, services: unknown, techName: string | null, appointmentId: string | null): Values {
  const out: Values = {};
  if (apptDate && /^\d{4}-\d{2}-\d{2}$/.test(apptDate)) {
    const [y, m, d] = apptDate.split('-').map(Number);
    out.appointment_date = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(startTime ?? ''));
  if (tm) { const h = Number(tm[1]), mi = tm[2]; out.appointment_time = `${((h + 11) % 12) + 1}:${mi} ${h < 12 ? 'AM' : 'PM'}`; }
  const first = Array.isArray(services) && services[0] && typeof services[0] === 'object' ? (services[0] as { serviceName?: unknown; name?: unknown }) : null;
  const svc = first ? first.serviceName || first.name : null;
  if (svc) out.service_name = String(svc);
  if (techName) out.technician_name = String(techName).split(/\s+/)[0];
  if (appointmentId && UUID.test(appointmentId)) out.booking_reference = `BK-${appointmentId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  void tz;   // date + start_time are already the salon's local wall clock (pos_tech_appointments stores local date/time)
  return out;
}
