// phone-center.ts — Phone Number Management & Verification Center (Phone Number Management Complete Build Guide, Oct 30 2026).
//
// READ MODEL ONLY. Every write (start / send code / verify / approve / resolve / manual exception / retry sync / cancel) stays on the
// existing CustomerPhoneUpdateService routes (pos/customers/:customerId/phone/*), which own the state machine, the atomic
// activation and the audit. This file answers the screen's questions from the real records:
//
//   customer_phone_update_sessions   one row per change request (state machine in customer-phone-core.ts)
//   customer_phones                  every number a customer has had: status, proof (verification_provider), effective_from
//   booking_verification_sessions    the six-digit challenge for that request (booking_session_id = the request id):
//                                    attempts, resends, last send, expiry. The code itself is only ever stored hashed.
//   jobs ('customer.phone.sync')     the durable synchronisation retry (idempotency key 'sync:<request id>')
//   notifications (source 'phone_change')  the security notice to the OLD number — submitted vs delivered, never assumed
//   tenant_messaging_credentials     sender readiness (Verify service / own sending number) — status only, never a secret
//
// Guide invariants this read model is honest about:
//   • the trusted number stays effective until a request is PROVEN: `current` always comes from customer_phones' active row
//   • "Connected" is never "Verified": readiness says what is configured and when it was last checked, nothing more
//   • a manual exception (verification_provider 'staff_override') is never shown as SMS verified
//   • history is newest first (created_at DESC, id DESC); Pending & Recovery is soonest-expiry / oldest-unresolved first
//   • tenant comes from the session only; branch filters only narrow; no cross-tenant join anywhere
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { HttpException, HttpStatus } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { hasPermission, type Ctx } from '@aipowersalon/permissions';
import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS } from '@aipowersalon/customers';
import { KyselyPhoneSettingsStore } from './customer-phone-settings.kysely';
import { PHONE_SETTINGS_DEFAULTS } from './customer-phone-settings.service';
import { PHONE_JOB, SYNC_MAX_ATTEMPTS } from './customer-phone.kysely';

export interface PcContext { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }

// ── state groups (guide §07 queue statuses) ─────────────────────────────────────────────────────────────
export const PC_GROUPS = {
  pending: ['phone_update_started', 'phone_validated', 'duplicate_check_completed', 'pending_phone_saved'],
  code_sent: ['verification_sent', 'verification_pending'],
  retry_allowed: ['verification_failed', 'verification_send_failed', 'twilio_not_configured'],
  expired: ['verification_expired'],
  failed: ['invalid_phone', 'rolled_back'],
  manager_review: ['manager_review_required', 'duplicate_conflict'],
  cancelled: ['update_canceled'],
  completed: ['phone_verified', 'phone_activated', 'customer_records_synchronized'],
  sync_attention: ['synchronization_failed'],
} as const;
export type PcGroup = keyof typeof PC_GROUPS;
/** PHONE NUMBER MANAGEMENT 4 · 06 — when a customer's last 30 days of number changes go to review (any one is enough) */
export const PC_RISK = { changes: 3, failedRequests: 2, codeAttempts: 6, channels: 2, addresses: 2 } as const;
const OPEN_STATES: string[] = [...PC_GROUPS.pending, ...PC_GROUPS.code_sent, ...PC_GROUPS.retry_allowed, ...PC_GROUPS.expired, ...PC_GROUPS.manager_review];
const FAILURE_STATES: string[] = [...PC_GROUPS.retry_allowed, ...PC_GROUPS.expired, ...PC_GROUPS.failed];
const PROVEN_STATES: string[] = ['phone_verified', 'phone_activated', 'synchronization_failed', 'customer_records_synchronized'];

/** The queue status of one request. An open request past its deadline reads Expired before the expiry job closes it. */
export function groupOf(state: string, expiresAt: Date | string | null, completedAt: Date | string | null, now = Date.now()): PcGroup {
  for (const [g, list] of Object.entries(PC_GROUPS)) if ((list as readonly string[]).includes(state)) {
    if (OPEN_STATES.includes(state) && !completedAt && expiresAt && new Date(expiresAt).getTime() <= now) return 'expired';
    return g as PcGroup;
  }
  return 'failed';
}

export type SyncState = 'not_needed' | 'pending' | 'in_progress' | 'synced' | 'retry_scheduled' | 'failed' | 'unknown';
/** Guide §08: Not Needed, Pending, In Progress, Synced, Retry Scheduled, Failed, Unknown — from the request state + its durable job. */
export function syncStateOf(state: string, job: { status?: string | null } | null): SyncState {
  if (state === 'customer_records_synchronized') return 'synced';
  if (!PROVEN_STATES.includes(state)) return 'not_needed';
  const st = job?.status ?? null;
  if (st === 'running') return 'in_progress';
  if (st === 'dead' || st === 'canceled') return 'failed';
  if (st === 'queued') return state === 'synchronization_failed' ? 'retry_scheduled' : 'pending';
  if (st === 'succeeded') return state === 'synchronization_failed' ? 'unknown' : 'synced';
  return state === 'synchronization_failed' ? 'unknown' : 'pending';
}

export type DateBasis = 'requested' | 'verified' | 'applied' | 'failed' | 'audit';
const BASES: DateBasis[] = ['requested', 'verified', 'applied', 'failed', 'audit'];
const PRESETS = ['today', 'week', 'month', 'year', 'custom', 'all'] as const;
const SOURCES = ['staff_pos', 'customer_app', 'kiosk', 'ai_receptionist', 'import'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function bad(message: string): never {
  throw withCode(new HttpException({ code: 'INVALID_FILTER', message }, HttpStatus.BAD_REQUEST), 'INVALID_FILTER');
}
function notFound(): never {
  throw withCode(new HttpException({ code: 'PHONE_UPDATE_NOT_FOUND', message: 'That phone update could not be found.' }, HttpStatus.NOT_FOUND), 'PHONE_UPDATE_NOT_FOUND');
}
const iso = (v: unknown) => (v instanceof Date || typeof v === 'string' || typeof v === 'number' ? new Date(v).toISOString() : null);
const n = (v: unknown) => Number(v ?? 0) || 0;
// the guard's own rule (granular pos.* key OR the coarse capability it maps to) — a literal match hid owner actions (Deals guide finding)
const has = (ctx: PcContext, p: string) => {
  const c: Ctx = { userId: ctx.userId, tenantId: ctx.tenantId, branchId: ctx.branchId ?? '', role: ctx.role as Ctx['role'], permissions: ctx.permissions || [] };
  return hasPermission(c, p);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const like = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';

export interface PcListFilters {
  q?: string; group?: string; source?: string; branchId?: string; shared?: string; method?: string; sync?: string;
  basis?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown;
}

export class PhoneCenter {
  constructor(private readonly db: NonNullable<AppDatabase>) {}

  /** the salon's own clock: the session branch's timezone, else the salon's first branch, else New York */
  private async tz(ctx: PcContext): Promise<string> {
    const r: any = (await sql`select coalesce(
        (select timezone from branches where tenant_id = ${ctx.tenantId} and id = ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}::uuid),
        (select timezone from branches where tenant_id = ${ctx.tenantId} order by created_at, id limit 1),
        'America/New_York') as tz`.execute(this.db)).rows[0];
    return String(r?.tz || 'America/New_York');
  }

  /** [start, end) as UTC instants for a tenant-local day range — inclusive end day, DST-safe (computed by Postgres in the zone). */
  private window(tz: string, f: { preset?: string; from?: string; to?: string }) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    if (!PRESETS.includes(preset)) bad('Unknown date preset.');
    const today = sql`(now() at time zone ${tz})::date`;
    if (preset === 'all') return null;
    if (preset === 'custom') {
      if (!f.from || !f.to || !DAY.test(f.from) || !DAY.test(f.to)) bad('Choose both a From and a To date.');
      if (f.from! > f.to!) bad('The From date must be on or before the To date.');
      return { start: sql`(${f.from}::date)::timestamp at time zone ${tz}`, end: sql`((${f.to}::date) + 1)::timestamp at time zone ${tz}`, label: `${f.from} – ${f.to}` };
    }
    const startDay = preset === 'today' ? today : preset === 'week' ? sql`date_trunc('week', ${today})::date` : preset === 'month' ? sql`date_trunc('month', ${today})::date` : sql`date_trunc('year', ${today})::date`;
    return { start: sql`(${startDay})::timestamp at time zone ${tz}`, end: sql`((${today}) + 1)::timestamp at time zone ${tz}`, label: preset };
  }

  private basisCol(basis: DateBasis) {
    switch (basis) {
      case 'verified': return sql`np.verified_at`;
      case 'applied': return sql`case when s.state in (${sql.join(PROVEN_STATES)}) then np.effective_from end`;
      case 'failed': return sql`case when s.state in (${sql.join(FAILURE_STATES)}) then s.updated_at end`;
      case 'audit': return sql`s.updated_at`;
      default: return sql`s.created_at`;
    }
  }

  // ── KPIs (guide §02: six cards, each with its source) ─────────────────────────────────────────────────
  async summary(ctx: PcContext) {
    const T = ctx.tenantId; const tz = await this.tz(ctx);
    const r: any = (await sql`select
        (select count(distinct customer_id)::int from customer_phones where tenant_id = ${T} and status = 'active_verified') as verified,
        (select count(*)::int from customer_phone_update_sessions where tenant_id = ${T} and completed_at is null and state in (${sql.join(OPEN_STATES)})
           and (expires_at is null or expires_at > now())) as pending,
        (select count(*)::int from customer_phone_update_sessions where tenant_id = ${T} and state in (${sql.join(FAILURE_STATES)})
           and updated_at >= now() - interval '30 days') as failed,
        (select count(*)::int from customer_phone_update_sessions where tenant_id = ${T} and state in (${sql.join(PROVEN_STATES)})
           and updated_at >= ((now() at time zone ${tz})::date)::timestamp at time zone ${tz}) as today,
        (select count(*)::int from (select normalized_phone from customers where tenant_id = ${T} and normalized_phone is not null and coalesce(status, 'active') <> 'archived'
           group by normalized_phone having count(*) > 1) x) as shared,
        (select count(*)::int from customer_phone_update_sessions where tenant_id = ${T} and state = 'synchronization_failed') as sync_attention`.execute(this.db)).rows[0];
    const health = await this.readiness(ctx);
    const risk = await this.riskReview(ctx);
    return {
      timezone: tz, generatedAt: new Date().toISOString(), risk,
      kpis: {
        verified: { value: n(r.verified), source: 'customer_phones: customers with an SMS-verified active number' },
        pending: { value: n(r.pending), source: 'customer_phone_update_sessions: open, not yet proven, not past their deadline' },
        failed: { value: n(r.failed), source: 'customer_phone_update_sessions: failed / expired / send-failed in the last 30 days' },
        today: { value: n(r.today), source: `customer_phone_update_sessions: proven changes since midnight (${tz})` },
        shared: { value: n(r.shared), source: 'customers: phone numbers on more than one customer (never merged)' },
        smsHealth: { value: health.sender.state, source: 'tenant_messaging_credentials: configuration status only — not proof of delivery' },
      },
      syncAttention: n(r.sync_attention),
      // what THIS user may do (the routes re-check every one; the screen only hides what would be refused)
      can: { startChange: has(ctx, 'pos.customers.edit'), editSettings: has(ctx, 'pos.customers.phone.settings'), retrySync: has(ctx, 'pos.customers.phone.retry_sync') },
    };
  }

  /** PHONE NUMBER MANAGEMENT 4 · 06 — Suspicious Number Change Review. Customers whose number changes in the last 30 days look
   *  unusual: frequent change requests, several failed / expired requests or many code attempts, or requests from several
   *  channels or network addresses (cross-device). A list for an authorized person to review — it never locks anyone out,
   *  cancels a request or changes a number; addresses are only counted, never returned. */
  private async riskReview(ctx: PcContext) {
    const T = ctx.tenantId;
    const rows: any[] = (await sql`select s.customer_id, max(c.full_name) as name, count(*)::int as changes,
        count(*) filter (where s.state in (${sql.join(FAILURE_STATES)}))::int as failed_requests,
        coalesce(sum(bv.attempts), 0)::int as code_attempts, count(distinct s.update_source)::int as channels, count(distinct bv.ip)::int as addresses,
        (array_agg(s.id order by s.created_at desc))[1] as latest_id, max(s.created_at) as latest_at
      from customer_phone_update_sessions s join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      left join lateral (select v.attempt_count as attempts, v.request_ip as ip from booking_verification_sessions v
        where v.tenant_id = s.tenant_id and v.booking_session_id = s.id order by v.created_at desc limit 1) bv on true
      where s.tenant_id = ${T} and s.created_at >= now() - interval '30 days'
      group by s.customer_id
      having count(*) >= ${PC_RISK.changes} or count(*) filter (where s.state in (${sql.join(FAILURE_STATES)})) >= ${PC_RISK.failedRequests}
        or coalesce(sum(bv.attempts), 0) >= ${PC_RISK.codeAttempts} or count(distinct s.update_source) >= ${PC_RISK.channels} or count(distinct bv.ip) >= ${PC_RISK.addresses}
      order by max(s.created_at) desc limit 50`.execute(this.db)).rows;
    const items = rows.map((r) => {
      const reasons: string[] = [];
      if (n(r.changes) >= PC_RISK.changes) reasons.push('frequent_changes');
      if (n(r.failed_requests) >= PC_RISK.failedRequests || n(r.code_attempts) >= PC_RISK.codeAttempts) reasons.push('failed_codes');
      if (n(r.channels) >= PC_RISK.channels || n(r.addresses) >= PC_RISK.addresses) reasons.push('cross_device');
      return { customerId: String(r.customer_id), customerName: r.name ?? null, changes: n(r.changes), failedRequests: n(r.failed_requests), codeAttempts: n(r.code_attempts),
        channels: n(r.channels), addresses: n(r.addresses), reasons, latestRequestId: String(r.latest_id), latestAt: iso(r.latest_at) };
    });
    return { windowDays: 30, thresholds: { ...PC_RISK }, items, action: 'review_only' as const };
  }

  /** sender readiness — what is configured and when it was last checked. Never a secret, never "verified" because "connected". */
  private async readiness(ctx: PcContext) {
    const c: any = (await sql`select status, (verify_service_sid is not null) as has_verify, (from_number is not null) as has_from, last_validated_at, (last_validation_error is not null) as has_error,
        branch_id is null as salon_default
      from tenant_messaging_credentials where tenant_id = ${ctx.tenantId} and provider = 'twilio'
        and (branch_id = ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}::uuid or branch_id is null)
      order by branch_id nulls last limit 1`.execute(this.db)).rows[0];
    let state: 'ready' | 'unchecked' | 'attention_required' | 'not_configured' = 'not_configured';
    let kind: 'twilio_verify' | 'internal_otp' | null = null;
    let message = 'No text-message account is connected for this salon, so a code cannot be sent. The current number stays in use.';
    if (c && c.status === 'configured' && (c.has_verify || c.has_from)) {
      kind = c.has_verify ? 'twilio_verify' : 'internal_otp';
      if (c.has_error) { state = 'attention_required'; message = 'The last check of the text-message account failed. Codes may not be delivered.'; }
      else if (!c.last_validated_at) { state = 'unchecked'; message = 'A sender is set up but has never been checked. Codes are not proven to deliver.'; }
      else { state = 'ready'; message = kind === 'twilio_verify' ? 'Codes go through the salon\'s own verification service.' : 'Codes go from the salon\'s own sending number.'; }
    } else if (c) { state = 'attention_required'; message = 'A text-message account exists but has no verification service or sending number.'; }
    return { sender: { state, kind, lastCheckedAt: iso(c?.last_validated_at), scope: c ? (c.salon_default ? 'salon' : 'branch') : null, message } };
  }

  async health(ctx: PcContext) {
    const T = ctx.tenantId;
    const r: any = (await sql`select
        count(*) filter (where state in (${sql.join([...PC_GROUPS.retry_allowed, ...PC_GROUPS.failed])}) and updated_at >= now() - interval '24 hours')::int as failed24,
        count(*) filter (where (state in (${sql.join(PC_GROUPS.expired)}) or (completed_at is null and state in (${sql.join(OPEN_STATES)}) and expires_at <= now())) and updated_at >= now() - interval '24 hours')::int as expired24,
        count(*) filter (where completed_at is null and state in (${sql.join(OPEN_STATES)}) and expires_at <= now())::int as overdue_open,
        count(*) filter (where state = 'synchronization_failed')::int as sync_failed,
        count(*) filter (where state = 'phone_activated')::int as sync_waiting
      from customer_phone_update_sessions where tenant_id = ${T}`.execute(this.db)).rows[0];
    const j: any = (await sql`select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'dead')::int as dead, max(finished_at) filter (where status = 'succeeded') as last_ok
      from jobs where tenant_id = ${T} and job_type = ${PHONE_JOB.sync}`.execute(this.db)).rows[0] ?? {};
    const settings = await this.settings(ctx);
    const ready = await this.readiness(ctx);
    const items = [
      { key: 'sender', ...ready.sender, detail: ready.sender.kind ? `Method: ${ready.sender.kind === 'twilio_verify' ? 'verification service' : 'own sending number'}` : null },
      { key: 'failures', state: n(r.failed24) > 0 ? 'attention_required' : 'ready', message: n(r.failed24) > 0 ? `${n(r.failed24)} code request(s) failed in the last 24 hours.` : 'No failed code requests in the last 24 hours.', count: n(r.failed24) },
      { key: 'expired', state: n(r.overdue_open) > 0 ? 'attention_required' : 'ready', message: n(r.overdue_open) > 0 ? `${n(r.overdue_open)} request(s) are past their deadline and waiting to be closed by the expiry job.` : `${n(r.expired24)} request(s) expired in the last 24 hours.`, count: n(r.expired24) },
      { key: 'sync', state: n(j.dead) > 0 || n(r.sync_failed) > 0 ? 'attention_required' : n(r.sync_waiting) > 0 ? 'pending' : 'ready',
        message: n(j.dead) > 0 ? `${n(j.dead)} synchronisation job(s) gave up after ${SYNC_MAX_ATTEMPTS} tries — retry from the Sync Monitor.`
          : n(r.sync_failed) > 0 ? `${n(r.sync_failed)} verified change(s) are still being synchronised (automatic retries).`
          : 'Every verified change is synchronised.', queued: n(j.queued), running: n(j.running), dead: n(j.dead), lastSucceededAt: iso(j.last_ok) },
      { key: 'policy', state: 'ready', message: settings.allowManualConfirmation ? 'Managers MAY confirm a number without SMS (manual exception — audited, never shown as SMS verified).' : 'Manager confirmation without SMS is OFF.', manualExceptionsAllowed: !!settings.allowManualConfirmation },
    ];
    return { checkedAt: new Date().toISOString(), items, limits: { codeDigits: 6, codeTtlSeconds: OTP_TTL_SECONDS, maxAttempts: OTP_MAX_ATTEMPTS, resendCooldownSeconds: RESEND_COOLDOWN_SECONDS, syncMaxAttempts: SYNC_MAX_ATTEMPTS } };
  }

  private async settings(ctx: PcContext) {
    return (await new KyselyPhoneSettingsStore(this.db).get(ctx.tenantId, ctx.branchId || null)) ?? PHONE_SETTINGS_DEFAULTS;
  }

  // ── the shared request query ──────────────────────────────────────────────────────────────────────────
  private base(ctx: PcContext) {
    return sql`from customer_phone_update_sessions s
      join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      left join customer_phones np on np.id = s.new_phone_id and np.tenant_id = s.tenant_id
      left join customer_phones op on op.id = s.previous_phone_id and op.tenant_id = s.tenant_id
      left join users u on u.id = s.requested_by_user_id and u.tenant_id = s.tenant_id
      left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id
      left join lateral (select j.status, j.attempts, j.last_error, j.run_after, j.updated_at from jobs j
         where j.tenant_id = s.tenant_id and j.job_type = ${PHONE_JOB.sync} and j.idempotency_key = 'sync:' || s.id::text order by j.created_at desc limit 1) jb on true
      where s.tenant_id = ${ctx.tenantId}`;
  }

  private where(f: PcListFilters, tzWin: ReturnType<PhoneCenter['window']>, basis: DateBasis) {
    const parts: any[] = [];
    const q = (f.q ?? '').trim().slice(0, 100);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const ors: any[] = [sql`c.full_name ilike ${like(q)}`, sql`c.first_name ilike ${like(q)}`, sql`c.last_name ilike ${like(q)}`, sql`c.email ilike ${like(q)}`, sql`u.full_name ilike ${like(q)}`];
      if (UUID.test(q)) ors.push(sql`s.id = ${q}::uuid`, sql`s.customer_id = ${q}::uuid`);
      if (digits.length >= 4) {
        ors.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${like(digits)}`);
        ors.push(sql`regexp_replace(coalesce(op.normalized_phone, ''), '[^0-9]', '', 'g') like ${like(digits)}`);
        ors.push(sql`regexp_replace(coalesce(s.proposed_phone, ''), '[^0-9]', '', 'g') like ${like(digits)}`);
      }
      parts.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    if (f.group) {
      const g = f.group as PcGroup;
      if (!(g in PC_GROUPS)) bad('Unknown status.');
      if (g === 'expired') parts.push(sql`(s.state in (${sql.join(PC_GROUPS.expired)}) or (s.completed_at is null and s.state in (${sql.join(OPEN_STATES)}) and s.expires_at <= now()))`);
      else if (OPEN_STATES.includes(PC_GROUPS[g][0])) parts.push(sql`s.state in (${sql.join(PC_GROUPS[g] as readonly string[])}) and (s.expires_at is null or s.expires_at > now() or s.completed_at is not null)`);
      else parts.push(sql`s.state in (${sql.join(PC_GROUPS[g] as readonly string[])})`);
    }
    if (f.source) { if (!(SOURCES as readonly string[]).includes(f.source)) bad('Unknown source.'); parts.push(sql`s.update_source = ${f.source}`); }
    if (f.branchId) { if (!UUID.test(f.branchId)) bad('Unknown branch.'); parts.push(sql`s.branch_id = ${f.branchId}::uuid`); }
    if (f.method) {
      if (f.method === 'sms') parts.push(sql`np.verification_provider in ('twilio_verify', 'internal_otp')`);
      else if (f.method === 'manual') parts.push(sql`np.verification_provider = 'staff_override'`);
      else bad('Unknown verification method.');
    }
    if (f.shared === 'yes' || f.shared === 'true') parts.push(sql`exists (select 1 from customers c2 where c2.tenant_id = s.tenant_id and c2.id <> s.customer_id and c2.normalized_phone = s.proposed_phone)`);
    if (f.sync) {
      const m: Record<string, any> = {
        synced: sql`s.state = 'customer_records_synchronized'`,
        retry_scheduled: sql`s.state = 'synchronization_failed' and jb.status = 'queued'`,
        failed: sql`s.state in (${sql.join(PROVEN_STATES)}) and s.state <> 'customer_records_synchronized' and jb.status in ('dead', 'canceled')`,
        in_progress: sql`jb.status = 'running'`,
        pending: sql`s.state = 'phone_activated' and coalesce(jb.status, 'queued') = 'queued'`,
        attention: sql`s.state = 'synchronization_failed'`,
      };
      if (!m[f.sync]) bad('Unknown synchronisation state.');
      parts.push(m[f.sync]);
    }
    if (tzWin) { const col = this.basisCol(basis); parts.push(sql`${col} >= ${tzWin.start} and ${col} < ${tzWin.end}`); }
    return parts.length ? sql` and ${sql.join(parts, sql` and `)}` : sql``;
  }

  private cols() {
    return sql`select s.id, s.customer_id, s.state, s.update_source, s.requested_by_role, s.created_at, s.updated_at, s.expires_at, s.completed_at, s.approved_at,
      s.proposed_phone_mask, s.duplicate_outcome, s.branch_id, b.name as branch_name, c.full_name as customer_name, c.avatar_url,
      coalesce(op.phone_mask, c.phone_display) as old_mask, np.verification_provider, np.verified_at, np.effective_from,
      u.full_name as requested_by_name, jb.status as job_status, jb.attempts as job_attempts, jb.last_error as job_error, jb.run_after as job_next,
      (select count(*)::int from customers c2 where c2.tenant_id = s.tenant_id and c2.id <> s.customer_id and c2.normalized_phone = s.proposed_phone) as shared_with,
      (select bv.attempt_count from booking_verification_sessions bv where bv.tenant_id = s.tenant_id and bv.booking_session_id = s.id order by bv.created_at desc limit 1) as attempts,
      (select bv.last_sent_at from booking_verification_sessions bv where bv.tenant_id = s.tenant_id and bv.booking_session_id = s.id order by bv.created_at desc limit 1) as last_sent_at`;
  }

  private row(r: any, now = Date.now()) {
    const group = groupOf(String(r.state), r.expires_at, r.completed_at, now);
    const method = r.verification_provider === 'staff_override' ? 'manual_exception' : (r.verification_provider === 'twilio_verify' || r.verification_provider === 'internal_otp') && PROVEN_STATES.includes(String(r.state)) ? 'sms_verified' : null;
    return {
      id: String(r.id), customerId: String(r.customer_id), customerName: r.customer_name ?? '', avatarUrl: r.avatar_url ?? null,
      oldPhoneMasked: r.old_mask ?? null, newPhoneMasked: r.proposed_phone_mask ?? null, state: String(r.state), status: group,
      source: r.update_source, requestedBy: r.requested_by_name ?? null, requestedByRole: r.requested_by_role ?? null,
      branchId: r.branch_id ?? null, branchName: r.branch_name ?? null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), expiresAt: iso(r.expires_at), completedAt: iso(r.completed_at),
      verifiedAt: iso(r.verified_at), appliedAt: PROVEN_STATES.includes(String(r.state)) ? iso(r.effective_from) : null,
      verificationMethod: method, sharedWith: n(r.shared_with), attempts: n(r.attempts), lastAttemptAt: iso(r.last_sent_at),
      ageMinutes: r.created_at ? Math.max(0, Math.round((now - new Date(r.created_at).getTime()) / 60000)) : null,
      sync: { state: syncStateOf(String(r.state), r.job_status ? { status: r.job_status } : null), attempts: n(r.job_attempts), nextAttemptAt: r.job_status === 'queued' ? iso(r.job_next) : null, lastError: r.job_error ? String(r.job_error).slice(0, 200) : null },
    };
  }

  private paging(f: PcListFilters) {
    const page = Math.max(1, Math.floor(Number(f.page ?? 1)) || 1);
    const ps = Number(f.pageSize ?? 10);
    const pageSize = [10, 20, 50].includes(ps) ? ps : 10;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  /** Phone Change History — newest first (created_at DESC, id DESC), every authorized record, server-side search and paging. */
  async history(ctx: PcContext, f: PcListFilters) {
    const tz = await this.tz(ctx);
    const basis = (f.basis || 'requested') as DateBasis; if (!BASES.includes(basis)) bad('Unknown date basis.');
    const win = this.window(tz, f);
    const { page, pageSize, offset } = this.paging(f);
    const where = this.where(f, win, basis);
    const total = n((await sql<any>`select count(*)::int as n ${this.base(ctx)} ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`${this.cols()} ${this.base(ctx)} ${where} order by s.created_at desc, s.id desc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.row(r)), page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), basis, timezone: tz,
      period: await this.period(tz, f), order: 'newest_first' };
  }

  /** the active period as salon-local days (for the screen's PeriodBar): preset, inclusive from / to, zone, today */
  private async period(tz: string, f: { preset?: string; from?: string; to?: string }) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    const r: any = (await sql`select to_char(d, 'YYYY-MM-DD') as today, to_char(date_trunc('week', d), 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', d), 'YYYY-MM-DD') as mo, to_char(date_trunc('year', d), 'YYYY-MM-DD') as yr
      from (select (now() at time zone ${tz})::date as d) x`.execute(this.db)).rows[0];
    const from = preset === 'custom' ? f.from! : preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : preset === 'year' ? r.yr : null;
    const to = preset === 'custom' ? f.to! : preset === 'all' ? null : r.today;
    return { preset, from, to, tz, today: String(r.today) };
  }

  /** Pending & Recovery — unresolved work, soonest deadline first, then the oldest unresolved (guide §07: task urgency, not newest-first). */
  async pending(ctx: PcContext, f: PcListFilters) {
    const tz = await this.tz(ctx);
    const { page, pageSize, offset } = this.paging(f);
    const scope = sql` and (s.completed_at is null and s.state in (${sql.join(OPEN_STATES)}) or s.state = 'synchronization_failed')`;
    const where = this.where({ ...f, preset: 'all' }, null, 'requested');
    const total = n((await sql<any>`select count(*)::int as n ${this.base(ctx)} ${scope} ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`${this.cols()} ${this.base(ctx)} ${scope} ${where}
      order by case when s.state = 'synchronization_failed' then 2
                    when s.state in (${sql.join(PC_GROUPS.expired)}) or s.expires_at <= now() then 1 else 0 end,
               s.expires_at asc nulls last, s.created_at asc, s.id asc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.row(r)), page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), timezone: tz, order: 'soonest_expiry_then_oldest' };
  }

  /** Sync Monitor — every proven change and its synchronisation (guide §08 columns). Newest first. */
  async syncIssues(ctx: PcContext, f: PcListFilters) {
    const { page, pageSize, offset } = this.paging(f);
    const onlyIssues = f.sync === 'all' ? sql`` : sql` and s.state <> 'customer_records_synchronized'`;
    const scope = sql` and s.state in (${sql.join(PROVEN_STATES)}) ${onlyIssues}`;
    const where = this.where({ ...f, sync: f.sync === 'all' ? undefined : f.sync, preset: 'all' }, null, 'requested');
    const total = n((await sql<any>`select count(*)::int as n ${this.base(ctx)} ${scope} ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`${this.cols()} ${this.base(ctx)} ${scope} ${where} order by s.updated_at desc, s.id desc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => { const x = this.row(r); return { ...x, tenantUpdate: 'applied', canRetry: x.sync.state !== 'synced' && x.sync.state !== 'in_progress' && x.state === 'synchronization_failed' && has(ctx, 'pos.customers.phone.retry_sync') }; }),
      page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), maxAttempts: SYNC_MAX_ATTEMPTS,
    };
  }

  /** The overlay: trusted vs proposed number, the challenge's progress (never the code), notices, history and the allowed actions. */
  async detail(ctx: PcContext, id: string) {
    if (!UUID.test(id)) notFound();
    const r: any = (await sql<any>`${this.cols()}, s.change_reason, s.duplicate_resolved_by, c.email, c.normalized_phone as current_e164 ${this.base(ctx)} and s.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) notFound();
    const x = this.row(r);
    const bv: any = (await sql`select status, attempt_count, resend_count, last_sent_at, expires_at, verified_at, failure_reason, delivered_at
      from booking_verification_sessions where tenant_id = ${ctx.tenantId} and booking_session_id = ${id}::uuid order by created_at desc limit 1`.execute(this.db)).rows[0];
    const current: any = (await sql`select phone_mask, status, verification_provider, verified_at, effective_from from customer_phones
      where tenant_id = ${ctx.tenantId} and customer_id = ${x.customerId} and status in ('active_verified', 'active_unverified') order by effective_from desc limit 1`.execute(this.db)).rows[0];
    const notice: any = (await sql`select status, delivered_at, created_at, failure_reason from notifications
      where tenant_id = ${ctx.tenantId} and source_type = 'phone_change' and source_id = ${id} order by created_at desc limit 1`.execute(this.db)).rows[0];
    const recent = (await sql<any>`select s.id, s.state, s.update_source, s.created_at, s.proposed_phone_mask, s.expires_at, s.completed_at from customer_phone_update_sessions s
      where s.tenant_id = ${ctx.tenantId} and s.customer_id = ${x.customerId} and s.id <> ${id}::uuid order by s.created_at desc, s.id desc limit 5`.execute(this.db)).rows;
    const settings = await this.settings(ctx);
    const ready = await this.readiness(ctx);
    const lastSent = bv?.last_sent_at ? new Date(bv.last_sent_at).getTime() : null;
    const cooldown = lastSent ? Math.max(0, Math.ceil((lastSent + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000)) : 0;
    const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - n(bv?.attempt_count));
    const open = x.status !== 'expired' && OPEN_STATES.includes(x.state);
    const edit = has(ctx, 'pos.customers.edit');
    const actions = {
      sendCode: edit && open && ['pending_phone_saved', 'verification_send_failed', 'twilio_not_configured', 'verification_failed', 'verification_expired', 'verification_sent', 'verification_pending'].includes(x.state) && ready.sender.state !== 'not_configured',
      verifyCode: edit && open && ['verification_sent', 'verification_pending', 'verification_failed'].includes(x.state) && attemptsLeft > 0,
      cancel: edit && open,
      approve: has(ctx, 'pos.customers.phone.approve') && open && x.state === 'manager_review_required',
      resolveDuplicate: has(ctx, 'pos.customers.phone.resolve') && open && x.state === 'duplicate_conflict',
      manualException: !!settings.allowManualConfirmation && has(ctx, 'pos.customers.phone.manual_confirm') && open && !['manager_review_required', 'duplicate_conflict'].includes(x.state),
      retrySync: has(ctx, 'pos.customers.phone.retry_sync') && x.state === 'synchronization_failed' && x.sync.state !== 'in_progress',
      startNew: edit && !open,
    };
    return {
      ...x, reason: r.change_reason ?? null, email: r.email ?? null,
      current: current ? { phoneMasked: current.phone_mask, proof: current.verification_provider === 'staff_override' ? 'manual_exception' : current.status === 'active_verified' ? 'sms_verified' : 'unverified', since: iso(current.effective_from), verifiedAt: iso(current.verified_at) }
        : { phoneMasked: x.oldPhoneMasked, proof: 'unknown', since: null, verifiedAt: null },
      trustedStillActive: !PROVEN_STATES.includes(x.state),
      verification: {
        status: bv?.status ?? (x.state === 'twilio_not_configured' ? 'not_sent_no_sender' : 'not_started'), digits: 6, attemptsUsed: n(bv?.attempt_count), attemptsLeft, resends: n(bv?.resend_count),
        lastSentAt: iso(bv?.last_sent_at), deliveredAt: iso(bv?.delivered_at), codeExpiresAt: iso(bv?.expires_at), resendAvailableInSeconds: cooldown,
        failure: bv?.failure_reason ? String(bv.failure_reason).slice(0, 120) : null, sender: ready.sender,
      },
      oldNumberNotice: !settings.notifyOldNumber ? { state: 'off_by_policy' } : notice ? { state: notice.status === 'delivered' ? 'delivered' : notice.status === 'failed' ? 'failed' : 'submitted', at: iso(notice.delivered_at ?? notice.created_at), failure: notice.failure_reason ? String(notice.failure_reason).slice(0, 120) : null }
        : { state: PROVEN_STATES.includes(x.state) ? 'not_recorded' : 'not_due' },
      recent: recent.map((h: any) => ({ id: String(h.id), state: String(h.state), status: groupOf(String(h.state), h.expires_at, h.completed_at), source: h.update_source, newPhoneMasked: h.proposed_phone_mask, createdAt: iso(h.created_at) })),
      actions,
      message: !PROVEN_STATES.includes(x.state) ? 'The current verified phone remains active until the new phone is verified.' : x.verificationMethod === 'manual_exception' ? 'Active by a manager\'s manual exception — not SMS verified.' : 'The new phone was verified and is active.',
    };
  }

  /** "Update Phone": find the customer first (tenant only, masked numbers). */
  async customers(ctx: PcContext, f: { q?: string; page?: unknown; pageSize?: unknown }) {
    const q = (f.q ?? '').trim().slice(0, 100);
    const { page, pageSize, offset } = this.paging(f);
    const ors: any[] = [];
    if (q) {
      const digits = q.replace(/\D/g, '');
      ors.push(sql`c.full_name ilike ${like(q)}`, sql`c.email ilike ${like(q)}`);
      if (UUID.test(q)) ors.push(sql`c.id = ${q}::uuid`);
      if (digits.length >= 4) ors.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${like(digits)}`);
    }
    const extra = sql`and coalesce(c.status, 'active') <> 'archived' ${ors.length ? sql` and (${sql.join(ors, sql` or `)})` : sql``}`;
    const total = n((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${ctx.tenantId} ${extra}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select c.id, c.full_name, c.avatar_url, c.normalized_phone, c.created_at,
        (select p.status from customer_phones p where p.tenant_id = c.tenant_id and p.customer_id = c.id and p.status in ('active_verified', 'active_unverified') order by p.effective_from desc limit 1) as phone_status,
        (select p.verification_provider from customer_phones p where p.tenant_id = c.tenant_id and p.customer_id = c.id and p.status in ('active_verified', 'active_unverified') order by p.effective_from desc limit 1) as provider,
        (select count(*)::int from customers c2 where c2.tenant_id = c.tenant_id and c2.id <> c.id and c2.normalized_phone = c.normalized_phone) as shared_with,
        (select s.id from customer_phone_update_sessions s where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.completed_at is null and s.state in (${sql.join(OPEN_STATES)}) order by s.created_at desc limit 1) as open_request
      from customers c where c.tenant_id = ${ctx.tenantId} ${extra} order by c.created_at desc, c.id desc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    const mask = (e: string | null) => (e ? `•••• ${String(e).slice(-4)}` : null);
    return {
      items: rows.map((r: any) => ({ customerId: String(r.id), name: r.full_name ?? '', avatarUrl: r.avatar_url ?? null, phoneMasked: mask(r.normalized_phone),
        proof: r.provider === 'staff_override' ? 'manual_exception' : r.phone_status === 'active_verified' ? 'sms_verified' : r.phone_status === 'active_unverified' ? 'unverified' : r.normalized_phone ? 'unknown' : 'none',
        sharedWith: n(r.shared_with), openRequestId: r.open_request ? String(r.open_request) : null })),
      page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
