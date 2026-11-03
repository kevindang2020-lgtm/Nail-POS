// reception-copilot-center.ts — Reception Copilot Complete Build Guide (Oct 2026). The Copilot's operating layer on top of
// the EXISTING action spine (reception-copilot-action.service.ts), queue / context services and canonical tables. It adds:
//
//   prepare → confirm   §06 "common transaction pattern". PREPARE has no side effect: it re-reads the canonical record,
//                       shows current vs proposed, warnings and notices, and returns a sealed confirmation token (5 min,
//                       bound to this salon, this staff member and the exact payload) plus a fresh request key. CONFIRM
//                       opens the token, runs the action through the spine (claim-before-run ledger, permissions, salon
//                       switches, domain service, audit) and then VERIFIES by re-reading the persisted record — the screen
//                       shows the real reference and state, never "done" from an AI reply.
//   overview            live status strip (queue, upcoming, missed calls, failed actions, last health) with a timestamp.
//   activity            the action ledger as history: search, filters, salon-local From/To, pages 10/20/50, newest first.
//   search              scoped search (customers, appointments, technicians, calls, activity) — tenant-scoped, masked.
//   health              Check Copilot System: 8 read-only areas, recorded, 30-second rate limit (repeat shows last run).
//   priorities          Smart Front Desk Priority Assistant: verified sources only, reason + evidence + proposal; every
//                       proposal opens PREPARE, so staff approve each step — nothing books, moves, cancels or texts by itself.
//   overlay             Full Customer & Reception Activity Overlay (view is audited; contact details masked).
//
// Queue ordering is never touched: history is newest-first, live queue / priorities keep fair (oldest-first) order.
import { sql, type Kysely } from 'kysely';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { recordAuditStrict } from '@aipowersalon/audit';
import { hasPermission } from '@aipowersalon/permissions';
import { evaluateAiAccess, type AiAccessSnapshot } from '../ai/ai-access-gate';
import { copilotPayloadHash, type CopilotAction, type ReceptionCopilotActionService } from './reception-copilot-action.service';
import type { CopilotSettings } from './copilot-settings.service';

export const COPILOT_CENTER = Symbol('COPILOT_CENTER');
export const CC_PACKAGE = 'ai_reception_copilot';
export const CC_SCOPES = ['customers', 'appointments', 'technicians', 'calls', 'activity'] as const;
export const CC_ACTION_TYPES = ['create_appointment', 'reschedule_appointment', 'cancel_appointment', 'send_message'] as const;
export const CC_STATES = ['pending', 'succeeded', 'failed', 'unknown'] as const;
export const CC_PERIODS = ['today', 'yesterday', 'week', 'month', 'year', 'custom'] as const;
export const CC_PAGE_SIZES = [10, 20, 50] as const;
const PREPARE_TTL_MS = 5 * 60 * 1000;
const HEALTH_GAP_SECONDS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;
const ACTIVE_APPT = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const CLOSED_APPT = ['completed', 'cancelled', 'no_show'];
const COPILOT_PERM: Record<string, string> = {
  create_appointment: 'reception_copilot.create_appointment', reschedule_appointment: 'reception_copilot.reschedule_appointment',
  cancel_appointment: 'reception_copilot.cancel_appointment', send_message: 'reception_copilot.send_message',
};
/** the domain permission each action needs in the POS itself. Texting has none of its own: the messaging service only
 *  requires a staff member, so the Copilot's reception_copilot.send_message is the gate (plus consent / opt-out). */
const DOMAIN_PERM: Record<string, string | null> = {
  create_appointment: 'pos.booking.create', reschedule_appointment: 'pos.booking.reschedule', cancel_appointment: 'pos.booking.cancel', send_message: null,
};

type Row = Record<string, any>;
export interface CcCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export type CcState = 'READY' | 'WARNING' | 'FAILED' | 'NOT_CONFIGURED' | 'DISABLED' | 'UNKNOWN';
export interface CcCheck { id: string; area: string; label: string; state: CcState; detail: string; evidence: string; remedy: string | null; checkedAt: string }
export interface CcAccessRepo { loadSnapshot(tenantId: string, packageCode: string, userId: string | null, opts?: { branchId?: string | null }): Promise<AiAccessSnapshot> }
export interface CcQueuePort { queueSummary(ctx: CcCtx): Promise<{ available: boolean; waiting: number; inService: number; unassigned: number; vipWaiting: number; longestWaitMinutes: number | null; denied?: boolean }> }
export interface CcSettingsPort { get(ctx: CcCtx): Promise<CopilotSettings> }
/** an unreadable settings store is a DECISION (fail closed), not an error to hide */
const SETTINGS_UNREADABLE = Symbol('settings-unreadable');

export class CopilotCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}

const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const digits = (q: string) => q.replace(/\D/g, '');
const maskPhone = (p?: string | null) => (p ? '•••' + String(p).replace(/\D/g, '').slice(-4) : null);
const maskEmail = (e?: string | null) => { if (!e) return null; const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 1)}•••@${d}` : '•••'; };
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const n = (v: unknown) => Number(v ?? 0);
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rank: Record<CcState, number> = { FAILED: 5, NOT_CONFIGURED: 4, DISABLED: 3, WARNING: 2, UNKNOWN: 1, READY: 0 };

/** SMS segment estimate (GSM-7 160/153, otherwise UCS-2 70/67) — shown in the preview, never billed from here. */
export function smsSegments(body: string): { encoding: 'GSM-7' | 'UCS-2'; segments: number } {
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà^{}\\[\]~|€]*$/.test(body);
  const len = [...body].length;
  if (gsm) return { encoding: 'GSM-7', segments: len <= 160 ? 1 : Math.ceil(len / 153) };
  return { encoding: 'UCS-2', segments: len <= 70 ? 1 : Math.ceil(len / 67) };
}

export class ReceptionCopilotCenter {
  private ephemeral: string | null = null;
  constructor(
    private readonly db: Kysely<any>,
    private readonly actions: Pick<ReceptionCopilotActionService, 'execute'>,
    private readonly queue: CcQueuePort | null,
    private readonly settings: CcSettingsPort | null,
    private readonly access: CcAccessRepo | null = null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private branch(ctx: CcCtx) { return ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null; }
  private async zone(ctx: CcCtx) { return branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)).catch(() => 'America/New_York'); }
  private can(ctx: CcCtx, perm: string) { return hasPermission(ctx as Parameters<typeof hasPermission>[0], perm); }

  // ── sealed confirmation token (HMAC, purpose-labelled; AUTH_SESSION_SECRET or a per-process key in dev/tests) ──────
  private key() { const s = String(this.env.AUTH_SESSION_SECRET ?? ''); return s || (this.ephemeral ??= randomBytes(32).toString('hex')); }
  private sign(body: string) { return b64(createHmac('sha256', this.key()).update('copilot-prepare:' + body).digest()); }
  sealPrepare(ctx: CcCtx, hash: string, idempotencyKey: string, now = Date.now()): { token: string; expiresAt: string } {
    const exp = now + PREPARE_TTL_MS;
    const body = b64(JSON.stringify({ t: ctx.tenantId, u: ctx.userId, h: hash, k: idempotencyKey, exp }));
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(exp).toISOString() };
  }
  openPrepare(ctx: CcCtx, token: unknown, hash: string, now = Date.now()): { k: string } {
    const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token ?? ''));
    if (!m) throw new CopilotCenterError('This action was not prepared. Review it again before confirming.', 'COPILOT_PREPARE_REQUIRED', 409);
    const want = Buffer.from(this.sign(m[1])), got = Buffer.from(m[2]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new CopilotCenterError('This review is not valid. Review the action again.', 'COPILOT_PREPARE_INVALID', 409);
    let p: Row;
    try { p = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
    catch { throw new CopilotCenterError('This review is not valid. Review the action again.', 'COPILOT_PREPARE_INVALID', 409); }
    if (p.t !== ctx.tenantId || p.u !== ctx.userId) throw new CopilotCenterError('This review belongs to another staff member. Review the action again.', 'COPILOT_PREPARE_INVALID', 409);
    if (p.h !== hash) throw new CopilotCenterError('The action changed after it was reviewed. Review it again.', 'COPILOT_PREPARE_MISMATCH', 409);
    if (!(n(p.exp) > now)) throw new CopilotCenterError('This review expired. Review the action again — the record may have changed.', 'COPILOT_PREPARE_EXPIRED', 409);
    return { k: String(p.k) };
  }

  // ── PREPARE (no side effect) ─────────────────────────────────────────────────────────────────────────────────────
  async prepare(ctx: CcCtx, action: CopilotAction) {
    if (!(CC_ACTION_TYPES as readonly string[]).includes(String(action?.type))) throw new CopilotCenterError('Unknown action.', 'COPILOT_INVALID_ACTION');
    const T = ctx.tenantId, b = this.branch(ctx);
    const blocked: string[] = [], warnings: string[] = [], notices: string[] = [];
    const cp = COPILOT_PERM[action.type], dp = DOMAIN_PERM[action.type];
    if (!this.can(ctx, cp)) blocked.push('Your role does not have the Copilot permission for this action.');
    if (dp && !this.can(ctx, dp)) blocked.push('Your role cannot do this in the POS.');
    const read = this.settings ? await this.settings.get(ctx).catch(() => SETTINGS_UNREADABLE) : null;
    if (read === SETTINGS_UNREADABLE) blocked.push('The Copilot settings could not be read, so actions are paused.');
    const gate = read && read !== SETTINGS_UNREADABLE ? (read as unknown as Record<string, boolean>) : null;
    if (gate) {
      const per: Record<string, string> = { create_appointment: 'allowCreate', reschedule_appointment: 'allowReschedule', cancel_appointment: 'allowCancel', send_message: 'allowSendMessage' };
      if (!gate.enabled) blocked.push('The Reception Copilot is turned off for this salon.');
      else if (!gate.actionsEnabled) blocked.push('Copilot actions are turned off for this salon.');
      else if (gate[per[action.type]] === false) blocked.push('This action is turned off in Copilot settings.');
    }
    let title = '', current: Row | null = null, proposed: Row = {};
    if (action.type === 'cancel_appointment' || action.type === 'reschedule_appointment') {
      if (!UUID.test(String(action.appointmentId ?? ''))) throw new CopilotCenterError('Enter a valid appointment ID.', 'COPILOT_INVALID_ACTION');
      const a = (await sql<Row>`select a.id, a.status, a.appt_date::text appt_date, a.start_time, a.end_time,
          a.duration_minutes, a.technician_id, a.customer_id, a.customer_name, a.customer_phone, a.deposit_status, a.branch_id, coalesce(t.full_name, '') tech_name,
          (select string_agg(coalesce(x->>'name', x->>'serviceName', ''), ', ') from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) x) service_names
        from pos_tech_appointments a left join technicians t on t.id = a.technician_id and t.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.id = ${action.appointmentId} and (${b}::uuid is null or a.branch_id = ${b})`.execute(this.db)).rows[0];
      if (!a) throw new CopilotCenterError('That appointment was not found for this salon.', 'COPILOT_NOT_FOUND', 404);
      current = { appointmentId: a.id, status: a.status, date: a.appt_date, startTime: a.start_time, endTime: a.end_time, technician: a.tech_name || null,
        customer: a.customer_name || null, phone: maskPhone(a.customer_phone), services: a.service_names || null, deposit: a.deposit_status };
      if (CLOSED_APPT.includes(a.status)) blocked.push(`This appointment is already ${String(a.status).replace(/_/g, ' ')}.`);
      if (a.deposit_status === 'paid') warnings.push('A deposit was paid. Nothing is refunded automatically — handle the deposit under your cancellation policy.');
      if (action.type === 'cancel_appointment') {
        title = 'Cancel appointment';
        if (String(action.reason ?? '').trim().length < 3) blocked.push('Give a cancellation reason.');
        proposed = { status: 'cancelled', reason: String(action.reason ?? '').trim() };
        notices.push('Pending reminders for this time stop. The cancellation is kept in the appointment history.');
      } else {
        title = 'Reschedule appointment';
        const date = action.date || a.appt_date; const tech = action.technicianId || a.technician_id;
        if (!DATE.test(String(date)) || !TIME.test(String(action.startTime ?? ''))) blocked.push('Choose a valid new date and time.');
        else {
          const dur = Math.max(5, n(a.duration_minutes) || 30);
          const clash = (await sql<Row>`select id, start_time s from pos_tech_appointments
            where tenant_id = ${T} and technician_id = ${tech} and appt_date = ${date}::date and id <> ${a.id} and status = any(${ACTIVE_APPT}::text[])
              and start_time::time < (${action.startTime}::time + make_interval(mins => ${dur})) and end_time::time > ${action.startTime}::time
            limit 3`.execute(this.db)).rows;
          if (clash.length) warnings.push(`The technician has ${clash.length} overlapping appointment(s) then (e.g. ${clash[0].s}). The booking system re-checks at confirm and will refuse a real conflict.`);
        }
        proposed = { date, startTime: action.startTime, technicianId: tech, technicianChanged: tech !== a.technician_id };
        notices.push('If the move fails, the original appointment is kept unchanged. Reminders follow the new time.');
      }
    } else if (action.type === 'create_appointment') {
      title = 'Book appointment';
      const ids = (action.serviceIds || []).map(String).filter((x) => UUID.test(x));
      if (!String(action.customerName ?? '').trim()) blocked.push('Enter the customer name.');
      if (!ids.length) blocked.push('Choose at least one service.');
      if (!DATE.test(String(action.date ?? '')) || !TIME.test(String(action.startTime ?? ''))) blocked.push('Choose a valid date and time.');
      const svcs = ids.length ? (await sql<Row>`select id, name, duration_minutes, price_cents, status from services where tenant_id = ${T} and id = any(${ids}::uuid[])`.execute(this.db)).rows : [];
      if (ids.length && svcs.length !== ids.length) blocked.push('One or more services were not found for this salon.');
      for (const s of svcs) if (s.status && s.status !== 'active') warnings.push(`${s.name} is not active.`);
      let techName: string | null = null;
      if (action.technicianId) {
        const t = (await sql<Row>`select full_name, status from technicians where tenant_id = ${T} and id = ${action.technicianId}`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0];
        if (!t) blocked.push('That technician was not found for this salon.'); else techName = t.full_name;
      }
      proposed = { customer: String(action.customerName ?? '').trim(), date: action.date, startTime: action.startTime, technician: techName ?? 'Any available',
        services: svcs.map((s) => ({ name: s.name, minutes: n(s.duration_minutes), priceCents: n(s.price_cents) })),
        totalMinutes: svcs.reduce((x, s) => x + n(s.duration_minutes), 0), totalPriceCents: svcs.reduce((x, s) => x + n(s.price_cents), 0) };
      notices.push('Availability shown before is advisory — the booking system re-checks conflicts and holds when you confirm.');
    } else {
      title = 'Send text message';
      const to = String(action.to ?? '').trim(), body = String(action.body ?? '');
      if (!E164.test(to)) blocked.push('Enter the number with its country code, e.g. +1 for the US.');
      if (!body.trim()) blocked.push('Write the message.');
      if (body.length > 640) blocked.push('The message is too long (640 characters at most).');
      if (E164.test(to)) {
        const opt = (await sql<Row>`select reason, scope from notification_opt_outs where tenant_id = ${T} and channel = 'sms' and address = ${to} limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0];
        if (opt) blocked.push('This number has opted out of texts from this salon.');
        const matches = n((await sql<Row>`select count(*)::int c from customers where tenant_id = ${T} and normalized_phone = ${to} and archived_at is null`.execute(this.db)).rows[0]?.c);
        if (matches > 1) warnings.push(`${matches} customer profiles share this number. They are not merged — make sure the message suits everyone on it.`);
        if (!matches) warnings.push('No customer profile has this number.');
      }
      const sender = (await sql<Row>`select status, from_number is not null or messaging_service_sid is not null has_sender, last_validated_at, last_validation_error
          from tenant_messaging_credentials where tenant_id = ${T} and offboarded_at is null and (branch_id = ${b} or branch_id is null) order by branch_id nulls last limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0];
      if (!sender) warnings.push('No salon Twilio account is connected — the platform test sender is used and nothing reaches the customer.');
      else if (sender.last_validation_error) warnings.push('The salon Twilio account failed its last check.');
      const seg = smsSegments(body);
      proposed = { to: maskPhone(to), characters: body.length, ...seg, sender: sender ? (sender.has_sender ? 'Salon Twilio sender' : 'Salon Twilio (no sending number)') : 'Test sender' };
      notices.push('Confirming submits the text. "Delivered" is shown only after the provider reports delivery.');
    }
    const hash = copilotPayloadHash(action);
    const state = blocked.length ? 'blocked' : 'awaiting_confirmation';
    const idempotencyKey = `cc:${randomUUID()}`;
    const sealed = blocked.length ? null : this.sealPrepare(ctx, hash, idempotencyKey);
    return { state, title, type: action.type, current, proposed, warnings, notices, blocked, token: sealed?.token ?? null, expiresAt: sealed?.expiresAt ?? null };
  }

  // ── CONFIRM → execute through the spine → VERIFY from the persisted record ──────────────────────────────────────
  async confirm(ctx: CcCtx, action: CopilotAction, token: string) {
    if (!(CC_ACTION_TYPES as readonly string[]).includes(String(action?.type))) throw new CopilotCenterError('Unknown action.', 'COPILOT_INVALID_ACTION');
    const { k } = this.openPrepare(ctx, token, copilotPayloadHash(action));
    const res = await this.actions.execute(ctx, { ...action, confirm: true, idempotencyKey: k } as CopilotAction);
    const r: Row = (res.result as Row) ?? {};
    const verified = await this.verify(ctx, action, res.ok, r).catch(() => ({ state: 'unknown', record: null }));
    return { ok: res.ok, requestKey: k, errorCode: res.errorCode ?? null, message: res.message ?? null, duplicate: !!r.duplicate, ...verified };
  }

  private async verify(ctx: CcCtx, action: CopilotAction, ok: boolean, r: Row): Promise<{ state: string; record: Row | null }> {
    const T = ctx.tenantId;
    if (!ok) return { state: r.state === 'pending' ? 'submitted' : r.state === 'unknown' ? 'unknown' : 'failed', record: null };
    if (action.type === 'send_message') {
      const nid = r.notificationId ?? null;
      const row = nid ? (await sql<Row>`select id, status, provider_status, provider_id, delivered_at, failure_reason from notifications where tenant_id = ${T} and id = ${nid}`.execute(this.db)).rows[0] : null;
      if (!row) return { state: r.degraded ? 'submitted' : 'unknown', record: { providerRef: r.providerId ?? null, testSender: !!r.degraded } };
      const ps = String(row.provider_status ?? '').toLowerCase();
      const state = row.status === 'failed' || ['failed', 'undelivered'].includes(ps) ? 'failed'
        : row.delivered_at || ps === 'delivered' ? 'delivered'
        : String(row.provider_id ?? '').startsWith('SM-MOCK-') ? 'submitted'
        : ['queued', 'accepted', 'sending', 'sent'].includes(ps) || row.provider_id ? 'provider_accepted' : 'unknown';
      return { state, record: { notificationId: row.id, providerRef: row.provider_id, providerStatus: row.provider_status ?? null, testSender: String(row.provider_id ?? '').startsWith('SM-MOCK-'), failure: row.failure_reason ?? null } };
    }
    const apptId = r.appointmentId ?? (action as Row).appointmentId ?? r.resourceId;
    if (!apptId || !UUID.test(String(apptId))) return { state: 'unknown', record: null };
    const a = (await sql<Row>`select id, status, appt_date::text appt_date, start_time, technician_id, phone_verification
      from pos_tech_appointments where tenant_id = ${T} and id = ${apptId}`.execute(this.db)).rows[0];
    if (!a) return { state: 'unknown', record: null };
    const record = { appointmentId: a.id, status: a.status, date: a.appt_date, startTime: a.start_time, technicianId: a.technician_id, phoneVerification: a.phone_verification ?? null };
    if (action.type === 'cancel_appointment') return { state: a.status === 'cancelled' ? 'completed' : 'unknown', record };
    if (action.type === 'reschedule_appointment') {
      const moved = a.start_time === action.startTime && (!action.date || a.appt_date === action.date);
      return { state: moved ? 'completed' : 'unknown', record };
    }
    return { state: a.phone_verification === 'pending' ? 'pending_verification' : 'completed', record };
  }

  // ── salon-local window (whole days; inclusive To; DST-safe) ───────────────────────────────────────────────────────
  async window(ctx: CcCtx, f: { period?: string; from?: string; to?: string }) {
    const tz = await this.zone(ctx);
    const today = String((await sql<Row>`select (now() at time zone ${tz})::date::text d`.execute(this.db)).rows[0].d);
    let from = today, to = today;
    const p = (CC_PERIODS as readonly string[]).includes(String(f.period)) ? String(f.period) : (f.from || f.to ? 'custom' : 'month');
    if (p === 'yesterday') { from = String((await sql<Row>`select (${today}::date - 1)::text d`.execute(this.db)).rows[0].d); to = from; }
    else if (p === 'week') from = String((await sql<Row>`select (date_trunc('week', ${today}::date))::date::text d`.execute(this.db)).rows[0].d);
    else if (p === 'month') from = today.slice(0, 8) + '01';
    else if (p === 'year') from = today.slice(0, 5) + '01-01';
    else if (p === 'custom') {
      if ((f.from && !DATE.test(f.from)) || (f.to && !DATE.test(f.to))) throw new CopilotCenterError('Choose valid dates.', 'COPILOT_INVALID_FILTER');
      from = f.from || today; to = f.to || today;
      if (to < from) throw new CopilotCenterError('The To date is before the From date.', 'COPILOT_INVALID_FILTER');
    }
    return { tz, period: p, from, to };
  }
  private page(f: { page?: unknown; pageSize?: unknown }) {
    const size = (CC_PAGE_SIZES as readonly number[]).includes(n(f.pageSize)) ? n(f.pageSize) : 20;
    const page = Math.max(1, Math.floor(n(f.page) || 1));
    return { size, page, offset: (page - 1) * size };
  }

  // ── activity history (the claim-before-run ledger) ────────────────────────────────────────────────────────────────
  async activity(ctx: CcCtx, f: { q?: string; state?: string; type?: string; period?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId, b = this.branch(ctx); const w = await this.window(ctx, f); const pg = this.page(f);
    const state = (CC_STATES as readonly string[]).includes(String(f.state)) ? String(f.state) : null;
    const type = (CC_ACTION_TYPES as readonly string[]).includes(String(f.type)) ? String(f.type) : null;
    const q = String(f.q ?? '').trim().slice(0, 100);
    const where = sql`(${b}::uuid is null or l.branch_id = ${b} or l.branch_id is null)
      and l.created_at >= (${w.from}::date)::timestamp at time zone ${w.tz} and l.created_at < ((${w.to}::date + 1))::timestamp at time zone ${w.tz}
      and (${state}::text is null or coalesce(l.state, case when l.ok then 'succeeded' else 'failed' end) = ${state})
      and (${type}::text is null or l.action_type = ${type})
      and (${q} = '' or l.summary ilike ${like(q)} or l.action_type ilike ${like(q)} or l.idempotency_key ilike ${like(q)} or l.resource_id ilike ${like(q)} or l.error_code ilike ${like(q)})`;
    const total = n((await sql<Row>`select count(*)::int c from reception_copilot_action_ledger l where l.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.c);
    const rows = (await sql<Row>`select l.id, l.created_at, l.finished_at, l.action_type, l.summary, coalesce(l.state, case when l.ok then 'succeeded' else 'failed' end) state,
        l.error_code, l.resource_id, l.idempotency_key, coalesce(u.full_name, '') actor
      from reception_copilot_action_ledger l left join users u on u.id = l.actor_user_id and u.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and ${where} order by l.created_at desc, l.id desc limit ${pg.size} offset ${pg.offset}`.execute(this.db)).rows;
    return {
      items: rows.map((x) => ({ id: x.id, at: iso(x.created_at), finishedAt: iso(x.finished_at), type: x.action_type, summary: x.summary ?? x.action_type, state: x.state,
        errorCode: x.error_code ?? null, reference: x.resource_id ?? null, requestKey: x.idempotency_key, actor: x.actor || null })),
      total, page: pg.page, pageSize: pg.size, pages: Math.max(1, Math.ceil(total / pg.size)), window: w, sort: 'newest',
    };
  }

  // ── scoped search ─────────────────────────────────────────────────────────────────────────────────────────────────
  async search(ctx: CcCtx, f: { scope?: string; q?: string; page?: unknown; pageSize?: unknown }) {
    const scope = (CC_SCOPES as readonly string[]).includes(String(f.scope)) ? String(f.scope) : 'customers';
    if (scope === 'activity') return { scope, ...(await this.activity(ctx, { q: f.q, period: 'year', page: f.page, pageSize: f.pageSize })) };
    const T = ctx.tenantId, b = this.branch(ctx); const pg = this.page(f);
    const q = String(f.q ?? '').trim().slice(0, 100); const d = digits(q);
    if (q.length < 2) return { scope, items: [], total: 0, page: 1, pageSize: pg.size, pages: 1, hint: 'Type at least 2 characters.' };
    const idq = UUID.test(q) ? q : null;
    if (scope === 'customers') {
      const where = sql`c.archived_at is null and (c.full_name ilike ${like(q)} or c.email ilike ${like(q)} or (${d.length >= 4} and c.normalized_phone like ${'%' + d + '%'}) or c.id = ${idq}::uuid)`;
      const total = n((await sql<Row>`select count(*)::int c from customers c where c.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.c);
      const rows = (await sql<Row>`select c.id, c.full_name, c.normalized_phone, c.email, c.created_at,
          (select count(*)::int from customers o where o.tenant_id = c.tenant_id and o.normalized_phone = c.normalized_phone and o.id <> c.id and o.archived_at is null) shared
        from customers c where c.tenant_id = ${T} and ${where} order by c.created_at desc, c.id desc limit ${pg.size} offset ${pg.offset}`.execute(this.db)).rows;
      return { scope, total, page: pg.page, pageSize: pg.size, pages: Math.max(1, Math.ceil(total / pg.size)),
        items: rows.map((x) => ({ id: x.id, name: x.full_name, phone: maskPhone(x.normalized_phone), email: maskEmail(x.email), sharedPhoneProfiles: n(x.shared) })) };
    }
    if (scope === 'appointments') {
      const dateq = DATE.test(q) ? q : null;
      const where = sql`(${b}::uuid is null or a.branch_id = ${b}) and (a.customer_name ilike ${like(q)} or a.id = ${idq}::uuid or a.appt_date = ${dateq}::date
        or (${d.length >= 4} and regexp_replace(coalesce(a.customer_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'}))`;
      const total = n((await sql<Row>`select count(*)::int c from pos_tech_appointments a where a.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.c);
      const rows = (await sql<Row>`select a.id, a.customer_name, a.customer_phone, a.status, a.appt_date::text appt_date, a.start_time, coalesce(t.full_name, '') tech
        from pos_tech_appointments a left join technicians t on t.id = a.technician_id and t.tenant_id = a.tenant_id where a.tenant_id = ${T} and ${where}
        order by a.appt_date desc, a.start_time desc, a.id desc limit ${pg.size} offset ${pg.offset}`.execute(this.db)).rows;
      return { scope, total, page: pg.page, pageSize: pg.size, pages: Math.max(1, Math.ceil(total / pg.size)),
        items: rows.map((x) => ({ id: x.id, customer: x.customer_name, phone: maskPhone(x.customer_phone), status: x.status, date: x.appt_date, startTime: x.start_time, technician: x.tech || null })) };
    }
    if (scope === 'technicians') {
      const where = sql`(${b}::uuid is null or t.branch_id = ${b}) and t.archived_at is null and (t.full_name ilike ${like(q)} or t.id = ${idq}::uuid)`;
      const total = n((await sql<Row>`select count(*)::int c from technicians t where t.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.c);
      const rows = (await sql<Row>`select t.id, t.full_name, t.status, t.is_active from technicians t where t.tenant_id = ${T} and ${where} order by t.full_name, t.id limit ${pg.size} offset ${pg.offset}`.execute(this.db)).rows;
      return { scope, total, page: pg.page, pageSize: pg.size, pages: Math.max(1, Math.ceil(total / pg.size)),
        items: rows.map((x) => ({ id: x.id, name: x.full_name, status: x.status, active: !!x.is_active })) };
    }
    const where = sql`(${b}::uuid is null or o.branch_id = ${b}) and (o.provider_call_id ilike ${like(q)} or o.summary ilike ${like(q)})`;
    const total = n((await sql<Row>`select count(*)::int c from voice_call_outcomes o where o.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.c);
    const rows = (await sql<Row>`select o.id, o.provider_call_id, o.started_at, o.duration_seconds, o.booking_outcome, o.handoff_outcome, o.follow_up_required
      from voice_call_outcomes o where o.tenant_id = ${T} and ${where} order by o.started_at desc nulls last, o.id desc limit ${pg.size} offset ${pg.offset}`.execute(this.db)).rows;
    return { scope: 'calls', total, page: pg.page, pageSize: pg.size, pages: Math.max(1, Math.ceil(total / pg.size)),
      items: rows.map((x) => ({ id: x.id, providerRef: x.provider_call_id, at: iso(x.started_at), seconds: x.duration_seconds ?? null, booking: x.booking_outcome ?? null, handoff: x.handoff_outcome ?? null, followUp: !!x.follow_up_required })) };
  }

  // ── live status strip ─────────────────────────────────────────────────────────────────────────────────────────────
  async overview(ctx: CcCtx) {
    const T = ctx.tenantId, b = this.branch(ctx); const tz = await this.zone(ctx);
    let queue: Row | null = null;
    try { queue = this.queue ? await this.queue.queueSummary(ctx) : null; } catch { queue = null; }
    const up = (await sql<Row>`select count(*)::int c from pos_tech_appointments where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
        and status = any(${['booked', 'confirmed']}::text[])
        and (appt_date + start_time::time) between (now() at time zone ${tz}) and (now() at time zone ${tz}) + interval '2 hours'`.execute(this.db)).rows[0];
    const calls = (await sql<Row>`select count(*)::int c from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
        and coalesce(started_at, created_at) > now() - interval '24 hours' and (abandoned or follow_up_required)`.execute(this.db)).rows[0];
    const failed = (await sql<Row>`select count(*) filter (where state = 'failed')::int f, count(*) filter (where state in ('pending', 'unknown'))::int open
        from reception_copilot_action_ledger where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0];
    const techs = (await sql<Row>`select count(*)::int c from technicians where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and is_active and archived_at is null`.execute(this.db)).rows[0];
    const last = (await sql<Row>`select overall, created_at from reception_copilot_health_runs where tenant_id = ${T} and branch_id is not distinct from ${b} order by created_at desc limit 1`.execute(this.db)).rows[0];
    return {
      asOf: new Date().toISOString(), timezone: tz, branchScoped: !!b,
      queue: queue && queue.available ? { waiting: n(queue.waiting), inService: n(queue.inService), unassigned: n(queue.unassigned), longestWaitMinutes: queue.longestWaitMinutes ?? null } : null,
      queueState: queue ? (queue.denied ? 'denied' : queue.available ? 'live' : 'no_branch') : 'unavailable',
      activeTechnicians: n(techs?.c), upcomingNext2h: n(up?.c), missedCalls24h: n(calls?.c), failedActions24h: n(failed?.f), openActions24h: n(failed?.open),
      lastHealth: last ? { overall: last.overall, at: iso(last.created_at) } : null,
    };
  }

  // ── Check Copilot System (read-only; recorded) ────────────────────────────────────────────────────────────────────
  async health(ctx: CcCtx) {
    const T = ctx.tenantId, b = this.branch(ctx);
    const recent = (await sql<Row>`select id, overall, checks, created_at from reception_copilot_health_runs where tenant_id = ${T} and branch_id is not distinct from ${b} and created_at > now() - make_interval(secs => ${HEALTH_GAP_SECONDS})
      order by created_at desc limit 1`.execute(this.db)).rows[0];
    if (recent) return { runId: recent.id, overall: recent.overall, checks: recent.checks, checkedAt: iso(recent.created_at), rateLimited: true };
    const at = new Date().toISOString(); const out: CcCheck[] = [];
    const add = (id: string, area: string, label: string, state: CcState, detail: string, evidence: string, remedy: string | null = null) => out.push({ id, area, label, state, detail, evidence, remedy, checkedAt: at });
    const guard = async (id: string, area: string, label: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e) { add(id, area, label, 'UNKNOWN', 'This could not be checked right now.', `read failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, 'Run the check again; if it repeats, contact support with the run time.'); }
    };
    await guard('entitlement', 'AI entitlement', 'Reception Copilot package', async () => {
      if (!this.access) { add('entitlement', 'AI entitlement', 'Reception Copilot package', 'UNKNOWN', 'The subscription could not be read here.', 'no entitlement repository', 'Open Plans & Usage to confirm the Reception Copilot package.'); return; }
      const d = evaluateAiAccess(await this.access.loadSnapshot(T, CC_PACKAGE, ctx.userId, { branchId: b }));
      const mode = String(this.env.AI_ENTITLEMENT_ENFORCEMENT ?? 'observe').toLowerCase();
      if (d.allowed) add('entitlement', 'AI entitlement', 'Reception Copilot package', 'READY', `Subscription ${d.subscriptionStatus}; the package is allowed.`, `decision ${d.reason}; enforcement ${mode}`);
      else add('entitlement', 'AI entitlement', 'Reception Copilot package', mode === 'enforce' ? 'FAILED' : 'WARNING', `Not allowed: ${String(d.reason).replace(/_/g, ' ')}.${mode === 'enforce' ? '' : ' Enforcement is in observe mode, so actions are not blocked yet.'}`, `decision ${d.reason}; enforcement ${mode}`, 'Open Plans & Usage — a valid Reception Copilot subscription is required.');
    });
    await guard('settings', 'Action permissions', 'Copilot switches', async () => {
      if (!this.settings) { add('settings', 'Action permissions', 'Copilot switches', 'UNKNOWN', 'Settings are not available here.', 'no settings service'); return; }
      const g = await this.settings.get(ctx);
      if (!g.enabled) add('settings', 'Action permissions', 'Copilot switches', 'DISABLED', 'The Reception Copilot is turned off.', 'enabled=false', 'Turn the Copilot on in Copilot settings.');
      else if (!g.actionsEnabled) add('settings', 'Action permissions', 'Copilot switches', 'DISABLED', 'Copilot actions are turned off.', 'actionsEnabled=false', 'Turn Actions on in Copilot settings.');
      else add('settings', 'Action permissions', 'Copilot switches', 'READY', 'The Copilot and its actions are on.', `booking=${g.allowCreate} reschedule=${g.allowReschedule} cancel=${g.allowCancel} texts=${g.allowSendMessage}`);
    });
    await guard('roles', 'Action permissions', 'Your action permissions', async () => {
      const missing = Object.entries(COPILOT_PERM).filter(([, p]) => !this.can(ctx, p)).map(([k]) => k.replace(/_/g, ' '));
      const stuck = n((await sql<Row>`select count(*)::int c from reception_copilot_action_ledger where tenant_id = ${T} and state = 'pending' and created_at < now() - interval '10 minutes'`.execute(this.db)).rows[0]?.c);
      const unknown = n((await sql<Row>`select count(*)::int c from reception_copilot_action_ledger where tenant_id = ${T} and state = 'unknown' and created_at > now() - interval '7 days'`.execute(this.db)).rows[0]?.c);
      const st: CcState = stuck || unknown ? 'WARNING' : missing.length === 4 ? 'DISABLED' : 'READY';
      add('roles', 'Action permissions', 'Your action permissions', st, `${4 - missing.length} of 4 actions allowed for your role.${stuck ? ` ${stuck} action(s) stuck in progress.` : ''}${unknown ? ` ${unknown} action(s) with an unknown outcome this week.` : ''}`,
        `missing: ${missing.join(', ') || 'none'}; pending>10m ${stuck}; unknown 7d ${unknown}`, stuck || unknown ? 'Open Copilot activity, check those records in Booking / Messages, and resolve them by hand.' : null);
    });
    await guard('customers', 'Customer search', 'Customer lookup', async () => {
      const c = n((await sql<Row>`select count(*)::int c from customers where tenant_id = ${T} and archived_at is null`.execute(this.db)).rows[0]?.c);
      add('customers', 'Customer search', 'Customer lookup', 'READY', `Customer search reads this salon's ${c} profile(s).`, 'tenant-scoped read ok');
    });
    await guard('booking', 'Booking', 'Booking data', async () => {
      const s = n((await sql<Row>`select count(*)::int c from services where tenant_id = ${T} and status = 'active' and archived_at is null`.execute(this.db)).rows[0]?.c);
      const t = n((await sql<Row>`select count(*)::int c from technicians where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and is_active and archived_at is null`.execute(this.db)).rows[0]?.c);
      const f = n((await sql<Row>`select count(*)::int c from reception_copilot_action_ledger where tenant_id = ${T} and state = 'failed' and action_type in ('create_appointment', 'reschedule_appointment') and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0]?.c);
      const st: CcState = !s || !t ? 'NOT_CONFIGURED' : f ? 'WARNING' : 'READY';
      add('booking', 'Booking', 'Booking data', st, !s ? 'No active services.' : !t ? 'No active technicians.' : f ? `${f} booking change(s) failed in the last 24 hours.` : `${s} active service(s), ${t} active technician(s).`,
        `services ${s}; technicians ${t}; failed 24h ${f}`, !s || !t ? 'Finish Business Setup (services and team).' : f ? 'Open Copilot activity to see why.' : null);
    });
    await guard('queue', 'Live queue & staff', 'Queue', async () => {
      if (!b) { add('queue', 'Live queue & staff', 'Queue', 'WARNING', 'All-branches view: the queue is per branch.', 'no branch in session', 'Pick a branch to see its queue.'); return; }
      const q = this.queue ? await this.queue.queueSummary(ctx) : null;
      if (!q) add('queue', 'Live queue & staff', 'Queue', 'UNKNOWN', 'The queue service is not available here.', 'no queue port');
      else if (q.denied) add('queue', 'Live queue & staff', 'Queue', 'DISABLED', 'Your role cannot read the queue.', 'permission denied');
      else add('queue', 'Live queue & staff', 'Queue', 'READY', `${q.waiting} waiting, ${q.inService} in service.`, 'Tech Queue read ok; screens refresh every 30 seconds');
    });
    await guard('twilio', 'Twilio messaging', 'Salon text sender', async () => {
      const c = (await sql<Row>`select status, from_number is not null or messaging_service_sid is not null has_sender, last_validated_at, last_validation_error
          from tenant_messaging_credentials where tenant_id = ${T} and offboarded_at is null and (branch_id = ${b} or branch_id is null) order by branch_id nulls last limit 1`.execute(this.db)).rows[0];
      const f = n((await sql<Row>`select count(*)::int c from notifications where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and channel = 'sms' and status = 'failed' and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0]?.c);
      if (!c) add('twilio', 'Twilio messaging', 'Salon text sender', 'NOT_CONFIGURED', 'No salon Twilio account is connected; texts go to the test sender only.', 'tenant_messaging_credentials: none', 'Open Text Messaging Setup to connect the salon’s Twilio account.');
      else if (c.last_validation_error) add('twilio', 'Twilio messaging', 'Salon text sender', 'FAILED', 'The last Twilio check failed.', 'validation error recorded', 'Run Check SMS System in Text Messaging Setup.');
      else if (!c.has_sender) add('twilio', 'Twilio messaging', 'Salon text sender', 'NOT_CONFIGURED', 'Twilio is connected but has no sending number.', 'no from number / messaging service', 'Assign a number in Text Messaging Setup.');
      else add('twilio', 'Twilio messaging', 'Salon text sender', f ? 'WARNING' : c.last_validated_at ? 'READY' : 'WARNING', f ? `${f} text(s) failed in the last 24 hours.` : c.last_validated_at ? 'Account and sender are set.' : 'Set, but never checked.',
        `status ${c.status}; failed 24h ${f}`, f ? 'Open Notifications for the provider error codes.' : c.last_validated_at ? null : 'Run Check SMS System in Text Messaging Setup.');
    });
    await guard('background', 'Background tasks', 'Callbacks and delivery', async () => {
      const cb = n((await sql<Row>`select count(*)::int c from voice_call_outcomes where tenant_id = ${T} and follow_up_required and coalesce(started_at, created_at) > now() - interval '24 hours'`.execute(this.db)).rows[0]?.c);
      const slow = n((await sql<Row>`select count(*)::int c from notifications where tenant_id = ${T} and channel = 'sms' and status not in ('failed') and delivered_at is null
          and provider_status is distinct from 'delivered' and created_at between now() - interval '24 hours' and now() - interval '2 hours'`.execute(this.db)).rows[0]?.c);
      add('background', 'Background tasks', 'Callbacks and delivery', cb || slow ? 'WARNING' : 'READY', `${cb} call(s) need a callback; ${slow} text(s) have no delivery report after 2 hours.`, `follow-ups 24h ${cb}; undelivered>2h ${slow}`,
        cb ? 'Open the Priority Assistant to work the callbacks.' : slow ? 'Check that delivery callbacks are registered in Text Messaging Setup.' : null);
    });
    const overall = out.reduce<CcState>((w, c) => (rank[c.state] > rank[w] ? c.state : w), 'READY');
    const runId = randomUUID();
    await sql`insert into reception_copilot_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks) values (${runId}, ${T}, ${b}, ${UUID.test(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(out)}::jsonb)`.execute(this.db);
    return { runId, overall, checks: out, checkedAt: at, rateLimited: false };
  }

  // ── Smart Front Desk Priority Assistant (proposals only; every one opens PREPARE) ────────────────────────────────
  async priorities(ctx: CcCtx) {
    const T = ctx.tenantId, b = this.branch(ctx); const tz = await this.zone(ctx);
    const items: Row[] = []; const unreadable: string[] = [];
    try {
      const q = this.queue && b ? await this.queue.queueSummary(ctx) : null;
      if (q?.available && q.unassigned > 0) items.push({ id: 'queue:unassigned', kind: 'queue', priority: 1, at: null, reason: `${q.unassigned} waiting customer(s) have no technician.`,
        evidence: `Tech Queue: ${q.waiting} waiting, longest wait ${q.longestWaitMinutes ?? '—'} min`, proposal: { label: 'Open Tech Queue', link: '/queue', actionType: null, prefill: null } });
    } catch (e) { unreadable.push(`Tech Queue (${String((e as Error)?.message ?? e).slice(0, 80)})`); }   // reported, never an invented item
    const soon = (await sql<Row>`select id, customer_name, customer_phone, start_time s, created_at from pos_tech_appointments
        where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and status = any(${['booked', 'confirmed']}::text[])
          and (appt_date + start_time::time) between (now() at time zone ${tz}) and (now() at time zone ${tz}) + interval '30 minutes'
        order by start_time, id limit 10`.execute(this.db)).rows;
    for (const a of soon) items.push({ id: `appt:${a.id}`, kind: 'appointment_soon', priority: 2, at: null, reason: `${a.customer_name || 'A customer'} is due at ${a.s} and has not arrived.`,
      evidence: `appointment ${String(a.id).slice(0, 8)} · booked`, proposal: a.customer_phone && E164.test(String(a.customer_phone))
        ? { label: 'Prepare a reminder text', link: null, actionType: 'send_message', prefill: { to: a.customer_phone, body: `Hi ${String(a.customer_name || '').split(' ')[0] || 'there'}, a reminder of your appointment today at ${a.s}. See you soon!` } }
        : { label: 'Open the appointment', link: `/booking`, actionType: null, prefill: null } });
    const calls = (await sql<Row>`select id, provider_call_id, coalesce(started_at, created_at) at from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
        and follow_up_required and coalesce(started_at, created_at) > now() - interval '24 hours' order by coalesce(started_at, created_at), id limit 10`.execute(this.db)).rows;
    for (const c of calls) items.push({ id: `call:${c.id}`, kind: 'unanswered_call', priority: 1, at: iso(c.at), reason: 'An AI phone call needs a person to call back.',
      evidence: `call ${c.provider_call_id ?? String(c.id).slice(0, 8)} · follow-up required`, proposal: { label: 'Open the call', link: `/tenant/ai/receptionist/calls?call=${c.id}`, actionType: null, prefill: null } });
    const clashes = (await sql<Row>`select a.id, b2.id other, coalesce(t.full_name, '') tech, a.start_time s, to_char(a.appt_date, 'YYYY-MM-DD') d from pos_tech_appointments a
        join pos_tech_appointments b2 on b2.tenant_id = a.tenant_id and b2.technician_id = a.technician_id and b2.appt_date = a.appt_date and b2.id > a.id
          and b2.status = any(${ACTIVE_APPT}::text[]) and b2.start_time::time < a.end_time::time and b2.end_time::time > a.start_time::time
        left join technicians t on t.id = a.technician_id and t.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and (${b}::uuid is null or a.branch_id = ${b}) and a.status = any(${ACTIVE_APPT}::text[]) and a.appt_date = (now() at time zone ${tz})::date
          order by a.start_time, a.id limit 10`.execute(this.db)).rows;
    // the database refuses an overlap unless a person marked one appointment "overbook" — so every overlap shown here was
    // allowed on purpose and still needs someone to check both guests can really be served
    for (const c of clashes) items.push({ id: `conflict:${c.id}:${c.other}`, kind: 'conflict', priority: 1, at: null, reason: `${c.tech || 'A technician'} has two overlapping appointments at ${c.s} (overbooked).`,
      evidence: `appointments ${String(c.id).slice(0, 8)} and ${String(c.other).slice(0, 8)}`, proposal: { label: 'Open the day in Booking', link: `/booking?date=${c.d}`, actionType: null, prefill: null } });   // a reschedule needs a new time a person picks (it was prefilled with the id only and always refused)
    const fails = (await sql<Row>`select id, action_type, summary, error_code, created_at from reception_copilot_action_ledger where tenant_id = ${T} and state in ('failed', 'unknown')
        and created_at > now() - interval '24 hours' order by created_at, id limit 10`.execute(this.db)).rows;
    for (const f of fails) items.push({ id: `action:${f.id}`, kind: 'failed_action', priority: 2, at: iso(f.created_at), reason: `A Copilot action did not complete: ${f.summary ?? f.action_type}.`,
      evidence: `error ${f.error_code ?? 'unknown outcome'}`, proposal: { label: 'Review in activity', link: null, actionType: null, prefill: null } });
    const sms = (await sql<Row>`select id, customer_id, created_at, failure_reason from notifications where tenant_id = ${T} and channel = 'sms' and status = 'failed' and created_at > now() - interval '24 hours'
        order by created_at, id limit 10`.execute(this.db)).rows;
    for (const s of sms) items.push({ id: `sms:${s.id}`, kind: 'failed_text', priority: 3, at: iso(s.created_at), reason: 'A text message failed.',
      evidence: `notification ${String(s.id).slice(0, 8)} · ${s.failure_reason ?? 'no reason recorded'}`, proposal: { label: 'Open Notifications', link: s.customer_id ? `/tenant/communications/notifications?timeline=${s.customer_id}` : '/tenant/communications/notifications', actionType: null, prefill: null } });
    items.sort((x, y) => x.priority - y.priority || String(x.at ?? '').localeCompare(String(y.at ?? '')));
    return { asOf: new Date().toISOString(), items: items.map((i) => ({ ...i, approvalRequired: true })), sources: ['Tech Queue', 'appointments', 'AI phone calls', 'Copilot actions', 'text messages'], unreadable };
  }

  // ── Full Customer & Reception Activity Overlay (audited view) ─────────────────────────────────────────────────────
  async overlay(ctx: CcCtx, customerId: string) {
    if (!UUID.test(String(customerId))) throw new CopilotCenterError('That customer was not found.', 'COPILOT_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const c = (await sql<Row>`select id, full_name, normalized_phone, email, phone_verified_at, marketing_sms_opt_in, marketing_email_opt_in, preferred_technician_id, created_at
      from customers where tenant_id = ${T} and id = ${customerId} and archived_at is null`.execute(this.db)).rows[0];
    if (!c) throw new CopilotCenterError('That customer was not found for this salon.', 'COPILOT_NOT_FOUND', 404);
    const shared = n((await sql<Row>`select count(*)::int c from customers where tenant_id = ${T} and normalized_phone = ${c.normalized_phone} and id <> ${c.id} and archived_at is null`.execute(this.db)).rows[0]?.c);
    const appts = (await sql<Row>`select id, status, appt_date::text appt_date, start_time, technician_id from pos_tech_appointments
      where tenant_id = ${T} and customer_id = ${c.id} order by appt_date desc, start_time desc, id desc limit 30`.execute(this.db)).rows;
    const msgs = (await sql<Row>`select id, channel, status, provider_status, purpose, created_at, delivered_at from notifications where tenant_id = ${T} and customer_id = ${c.id}
      order by created_at desc, id desc limit 20`.execute(this.db)).rows;
    const ids = appts.map((a) => String(a.id));
    const acts = ids.length ? (await sql<Row>`select id, action_type, summary, state, error_code, created_at from reception_copilot_action_ledger where tenant_id = ${T} and resource_id = any(${ids}::text[])
      order by created_at desc, id desc limit 20`.execute(this.db)).rows : [];
    const opt = c.normalized_phone ? (await sql<Row>`select scope, opted_out_at from notification_opt_outs where tenant_id = ${T} and channel = 'sms' and address = ${c.normalized_phone} limit 1`.execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows[0] : null;
    const audit = (await sql<Row>`select action, summary, occurred_at from audit_events where tenant_id = ${T} and module = 'reception_copilot' and (resource_id = ${c.id} or resource_id = any(${ids}::text[]))
      order by occurred_at desc limit 20`.execute(this.db)).rows;
    await recordAuditStrict(this.db, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role }, {
      module: 'reception_copilot', action: 'customer_overlay.viewed', resourceType: 'customer', resourceId: c.id, summary: 'Customer reception activity viewed in Reception Copilot',
    });
    const today = businessDate(await this.zone(ctx));   // the branch's day (UTC is already tomorrow every evening)
    return {
      overview: { id: c.id, name: c.full_name, phone: maskPhone(c.normalized_phone), phoneVerified: !!c.phone_verified_at, email: maskEmail(c.email), customerSince: iso(c.created_at), sharedPhoneProfiles: shared },
      appointments: {
        upcoming: appts.filter((a) => a.appt_date >= today && ACTIVE_APPT.includes(a.status)).reverse().map((a) => ({ id: a.id, status: a.status, date: a.appt_date, startTime: a.start_time })),
        past: appts.filter((a) => !(a.appt_date >= today && ACTIVE_APPT.includes(a.status))).map((a) => ({ id: a.id, status: a.status, date: a.appt_date, startTime: a.start_time })),
      },
      messages: msgs.map((m) => ({ id: m.id, channel: m.channel, state: m.status === 'failed' ? 'failed' : m.delivered_at ? 'delivered' : m.provider_status ? 'provider_accepted' : 'unknown', purpose: m.purpose ?? null, at: iso(m.created_at) })),
      calls: { linked: null, note: 'AI phone calls are not linked to customer profiles yet; open AI Calls to search by caller.' },
      copilotActions: acts.map((a) => ({ id: a.id, type: a.action_type, summary: a.summary, state: a.state, errorCode: a.error_code ?? null, at: iso(a.created_at) })),
      consent: { marketingSms: !!c.marketing_sms_opt_in, marketingEmail: !!c.marketing_email_opt_in, smsOptOut: opt ? { scope: opt.scope ?? null, at: iso(opt.opted_out_at) } : null },
      audit: audit.map((a) => ({ action: a.action, summary: a.summary, at: iso(a.occurred_at) })),
      links: { openBooking: `/booking/new?customerId=${c.id}&from=copilot`, profile: `/tenant/customers/profiles?customerId=${c.id}`, communications: `/tenant/communications/notifications?timeline=${c.id}` },
    };
  }
}
