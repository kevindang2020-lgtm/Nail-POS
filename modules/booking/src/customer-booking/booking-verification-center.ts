// booking-verification-center.ts — the Booking Phone Verification page's operations surface (Booking Phone Verification
// Complete Build Guide, Oct 30 2026, §4 / §10–§14). READ-MOSTLY, tenant-scoped, built on the EXISTING model:
//   booking_verification_sessions (one row per booking attempt's challenge — hashed phone + mask, never a code),
//   booking_holds (the 10-minute slot hold, no-overlap constraint, expiry sweep),
//   booking_verification_settings / platform policy / tenant_messaging_credentials (resolved by the settings service).
// Nothing here verifies, books, sends or charges — except `resend`, which re-uses BookingVerificationService.send (the
// tenant's OWN Twilio, its cooldown and rate limits, fail-closed; never the platform's account) after proving the
// number on the customer's record IS the number the session was opened for.
//
//   summary   six KPI cards (pending / verified today / failed+expired today / active holds / SMS health / success %),
//             every card with its definition and denominator; Unknown is never shown as 0.
//   health    "Check Verification System": itemized, non-destructive checks with evidence, time and next action.
//             Status vocabulary: ready | needs_setup | pending_provider_action | degraded | failed | unknown.
//   live      open verifications and live slot holds, NEAREST EXPIRY FIRST (operational urgency, not newest-first);
//             code status and hold status kept separate; server timestamps + server now for the countdown.
//   history   every authorized record, newest first (created_at DESC, id DESC), server search / filters / date basis
//             (salon-local inclusive days, DST-safe) / pages of 10-20-50 with an exact total.
//   detail    one record + its timeline, the rule that forced verification (policy_reason) and the policy versions; audited.
import { sql } from 'kysely';
import { HttpException, HttpStatus } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import type { AppDatabase } from '@aipowersalon/database';
import type { AuditSink } from '@aipowersalon/audit';
import { normalizePhone, phoneKey } from '@aipowersalon/customers';
import type { BookingChannel } from './booking-verification-policy';

export interface BvcContext { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export type HealthState = 'ready' | 'needs_setup' | 'pending_provider_action' | 'degraded' | 'failed' | 'unknown';

/** display status of a verification row (guide §12 filter vocabulary), from the stored status + the clock */
export const BVC_STATUSES = ['pending', 'verified', 'failed', 'expired', 'cancelled', 'provider_error'] as const;
export type BvcStatus = (typeof BVC_STATUSES)[number];
// a provider error: the webhook's delivery failure (status failed + the provider's code) OR a send the salon's own provider
// refused (markSendFailed keeps the session open with failure_reason) — never a customer's wrong guess or the lockout
const PROVIDER_ERR = sql`(s.status in ('failed','pending','sent') and s.failure_reason is not null and s.failure_reason !~* '^(wrong|incorrect|invalid_code|too_many)')`;
const statusCase = sql`case
  when s.status = 'verified' then 'verified'
  when s.status = 'canceled' then 'cancelled'
  when ${PROVIDER_ERR} then 'provider_error'
  when s.status = 'expired' or (s.status in ('pending','sent') and s.expires_at <= now()) then 'expired'
  when s.status in ('failed','locked') then 'failed'
  else 'pending' end`;
const holdCase = sql`case
  when h.id is null then 'none'
  when h.converted_appointment_id is not null then 'converted'
  when h.released_at is not null then case when h.release_reason = 'hold_expired' then 'expired' else 'released' end
  when h.expires_at <= now() then 'expired'
  when h.expires_at <= now() + interval '2 minutes' then 'expiring_soon'
  else 'active' end`;

export const BVC_CHANNELS = ['online', 'customer_app', 'ai_receptionist', 'kiosk', 'front_desk', 'walk_in'] as const;
export type DateBasis = 'requested' | 'completed' | 'hold_created' | 'hold_expired' | 'appointment';
const BASES: DateBasis[] = ['requested', 'completed', 'hold_created', 'hold_expired', 'appointment'];
const PRESETS = ['today', 'week', 'month', 'year', 'custom', 'all'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v instanceof Date || typeof v === 'string' || typeof v === 'number' ? new Date(v as string | number | Date).toISOString() : null);
const n = (v: unknown) => Number(v ?? 0) || 0;
const like = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
function bad(message: string): never { throw withCode(new HttpException({ code: 'INVALID_FILTER', message }, HttpStatus.BAD_REQUEST), 'INVALID_FILTER'); }
function notFound(): never { throw withCode(new HttpException({ code: 'BOOKING_VERIFICATION_NOT_FOUND', message: 'That verification record could not be found.' }, HttpStatus.NOT_FOUND), 'BOOKING_VERIFICATION_NOT_FOUND'); }

/** Why a booking had to verify — the resolver's machine reason, in words (guide §17.3 "explain the exact rule"). */
export function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = String(reason);
  if (r === 'risk_group_booking') return 'Group booking — the salon always re-verifies group bookings.';
  if (r === 'risk_deposit') return 'This booking needs a deposit — the salon always re-verifies deposit bookings.';
  if (r === 'risk_high_value') return 'High-value booking — at or above the salon\'s high-value amount, which always re-verifies.';
  if (r.startsWith('phone_changed') || r === 'phone_revoked') return 'The phone number is new or changed — earlier trust does not carry over.';
  if (r.includes('every_booking')) return 'The salon verifies every booking.';
  if (r.includes('window') || r.includes('reverify')) return 'The last verification of this number is older than the salon\'s trust window.';
  if (r.includes('no_prior') || r.includes('never_verified') || r === 'required') return 'This number has not been verified at this salon before.';
  if (r.startsWith('platform')) return 'Required by AI PowerSalon platform policy.';
  return `Policy rule: ${r}`;
}

export interface BvcListFilters { q?: string; status?: string; channel?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }

export class BookingVerificationCenter {
  constructor(
    private readonly db: NonNullable<AppDatabase>,
    private readonly audit?: AuditSink | null,
    /** BookingVerificationService.send, bound — the ONE send path (tenant's own provider, cooldown, rate limits). */
    private readonly send?: ((ctx: { tenantId: string; branchId: string; channel: BookingChannel; bookingSessionId: string; customerId?: string | null }, rawPhone: string) => Promise<{ status: string; message?: string }>) | null,
  ) {}

  private async tz(ctx: BvcContext): Promise<string> {
    const r: any = (await sql`select coalesce(
        (select timezone from branches where tenant_id = ${ctx.tenantId} and id = ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}::uuid),
        (select timezone from branches where tenant_id = ${ctx.tenantId} order by created_at, id limit 1), 'America/New_York') as tz`.execute(this.db)).rows[0];
    return String(r?.tz || 'America/New_York');
  }

  /** [start, end) for salon-local inclusive days, computed by Postgres in the zone (DST-safe). null = all time. */
  private window(tz: string, f: { preset?: string; from?: string; to?: string }) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    if (!PRESETS.includes(preset)) bad('Unknown date preset.');
    if (preset === 'all') return null;
    const today = sql`(now() at time zone ${tz})::date`;
    if (preset === 'custom') {
      if (!f.from || !f.to || !DAY.test(f.from) || !DAY.test(f.to)) bad('Choose both a From and a To date.');
      if (f.from! > f.to!) bad('The From date must be on or before the To date.');
      return { start: sql`(${f.from}::date)::timestamp at time zone ${tz}`, end: sql`((${f.to}::date) + 1)::timestamp at time zone ${tz}` };
    }
    const startDay = preset === 'today' ? today : preset === 'week' ? sql`date_trunc('week', ${today})::date` : preset === 'month' ? sql`date_trunc('month', ${today})::date` : sql`date_trunc('year', ${today})::date`;
    return { start: sql`(${startDay})::timestamp at time zone ${tz}`, end: sql`((${today}) + 1)::timestamp at time zone ${tz}` };
  }
  private async period(tz: string, f: { preset?: string; from?: string; to?: string }) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    const r: any = (await sql`select to_char(d, 'YYYY-MM-DD') as today, to_char(date_trunc('week', d), 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', d), 'YYYY-MM-DD') as mo, to_char(date_trunc('year', d), 'YYYY-MM-DD') as yr
      from (select (now() at time zone ${tz})::date as d) x`.execute(this.db)).rows[0];
    const from = preset === 'custom' ? f.from! : preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : preset === 'year' ? r.yr : null;
    return { preset, from, to: preset === 'custom' ? f.to! : preset === 'all' ? null : r.today, tz, today: String(r.today) };
  }
  private basisCol(b: DateBasis) {
    switch (b) {
      case 'completed': return sql`case when s.status in ('verified','failed','locked','expired','canceled') then coalesce(s.verified_at, s.updated_at) end`;
      case 'hold_created': return sql`h.created_at`;
      case 'hold_expired': return sql`case when h.release_reason = 'hold_expired' then h.released_at end`;
      case 'appointment': return sql`h.start_time`;
      default: return sql`s.created_at`;
    }
  }

  // ── KPIs (guide §4, §13 metrics: definition + denominator, Unknown ≠ 0) ─────────────────────────────────
  async summary(ctx: BvcContext) {
    const T = ctx.tenantId; const tz = await this.tz(ctx);
    const today = sql`((now() at time zone ${tz})::date)::timestamp at time zone ${tz}`;
    const r: any = (await sql`select
        count(*) filter (where s.status in ('pending','sent') and s.expires_at > now())::int as pending,
        count(*) filter (where s.status = 'verified' and s.verified_at >= ${today})::int as verified_today,
        count(*) filter (where (s.status in ('failed','locked','expired') or (s.status in ('pending','sent') and s.expires_at <= now())) and s.updated_at >= ${today})::int as failed_today,
        count(*) filter (where s.created_at >= now() - interval '30 days')::int as req30,
        count(*) filter (where s.created_at >= now() - interval '30 days' and s.status = 'verified')::int as ver30,
        count(*) filter (where s.created_at >= now() - interval '24 hours' and ${PROVIDER_ERR})::int as provider_err24,
        count(*) filter (where s.created_at >= now() - interval '24 hours' and s.last_sent_at is not null)::int as sent24,
        max(s.updated_at) as last_activity
      from booking_verification_sessions s where s.tenant_id = ${T}`.execute(this.db)).rows[0] ?? {};
    const holds: any = (await sql`select count(*)::int as live, count(*) filter (where expires_at <= now() + interval '2 minutes')::int as expiring
      from booking_holds where tenant_id = ${T} and kind = 'slot' and booking_session_id is not null
        and released_at is null and converted_appointment_id is null and expires_at > now()`.execute(this.db)).rows[0] ?? {};
    const cred = await this.credential(ctx);
    const smsState: HealthState = !cred ? 'needs_setup' : cred.last_validation_error ? 'failed' : n(r.provider_err24) > 0 ? 'degraded' : cred.last_validated_at ? 'ready' : 'pending_provider_action';
    return {
      generatedAt: new Date().toISOString(), timezone: tz,
      cards: {
        pending: { value: n(r.pending), definition: 'Codes sent and still inside their time limit, waiting for the customer.' },
        verifiedToday: { value: n(r.verified_today), definition: 'Correct six-digit codes accepted since midnight (salon time).' },
        failedToday: { value: n(r.failed_today), definition: 'Wrong-code lockouts, provider failures and expired codes since midnight (salon time).' },
        activeHolds: { value: n(holds.live), expiringSoon: n(holds.expiring), definition: 'Time slots held for a booking that is waiting on a code (not yet booked, not expired).' },
        smsHealth: { state: smsState, providerErrors24h: n(r.provider_err24), codesSent24h: n(r.sent24), definition: 'The salon\'s own Twilio account: last check result plus provider errors in the last 24 hours.' },
        successRate: r.req30 > 0
          ? { value: Math.round((n(r.ver30) / n(r.req30)) * 1000) / 10, numerator: n(r.ver30), denominator: n(r.req30), definition: 'Verified ÷ verifications requested, last 30 days.' }
          : { value: null, numerator: 0, denominator: 0, definition: 'Verified ÷ verifications requested, last 30 days. Unknown until a code is requested.' },
      },
      lastActivityAt: iso(r.last_activity),
    };
  }

  private async credential(ctx: BvcContext): Promise<any | null> {
    return (await sql`select status, last_validated_at, last_validation_error, (verify_service_sid is not null and verify_service_sid <> '') as has_verify,
        right(coalesce(verify_service_sid, ''), 4) as verify_last4, (from_number is not null and from_number <> '') as has_from,
        (messaging_service_sid is not null and messaging_service_sid <> '') as has_svc, branch_id, updated_at
      from tenant_messaging_credentials where tenant_id = ${ctx.tenantId} and provider = 'twilio' and offboarded_at is null
        and (branch_id is null or branch_id = ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}::uuid)
      order by branch_id nulls last limit 1`.execute(this.db)).rows[0] ?? null;
  }

  // ── "Check Verification System" (guide §10) — non-destructive; never buys, registers, sends or calls out ─────
  async health(ctx: BvcContext, settings?: { enabled: boolean; provider: { connected: boolean; validated: boolean; blockedReason: string | null }; platform: { requiredByPlatform: boolean; blockedByPlatform: boolean; emergencyDisabled: boolean; moduleDisabled: boolean } } | null) {
    const checkedAt = new Date().toISOString();
    const cred = await this.credential(ctx);
    const items: { key: string; state: HealthState; message: string; evidence: string; nextAction: string | null; checkedAt: string }[] = [];
    const add = (key: string, state: HealthState, message: string, evidence: string, nextAction: string | null) => items.push({ key, state, message, evidence, nextAction, checkedAt });

    if (!cred) add('twilio_identity', 'needs_setup', 'No Twilio account is connected for this salon.', 'tenant_messaging_credentials: no active row', 'Open Phone & Messaging and connect the salon\'s own Twilio account.');
    else if (cred.last_validation_error) add('twilio_identity', 'failed', 'The last Twilio sign-in check failed.', 'a validation error is recorded on the account (text not shown — it may echo a credential)', 'Run the Twilio test in Phone & Messaging and correct the account.');
    else if (cred.last_validated_at) add('twilio_identity', 'ready', 'The salon\'s Twilio account signed in at its last check.', `last validated ${iso(cred.last_validated_at)}${cred.branch_id ? ' (location account)' : ' (salon account)'}`, null);
    else add('twilio_identity', 'pending_provider_action', 'Twilio details are saved but have never been tested.', 'no validation recorded', 'Run the Twilio test in Phone & Messaging.');

    if (!cred) add('verify_service', 'needs_setup', 'No verification service — nothing to check yet.', 'no account', 'Connect Twilio first.');
    else if (cred.has_verify) add('verify_service', cred.last_validated_at && !cred.last_validation_error ? 'ready' : 'unknown', 'A Twilio Verify Service is set for this salon.', `service ending …${cred.verify_last4}`, cred.last_validated_at ? null : 'Run the Twilio test to confirm the service answers.');
    else if (cred.has_from || cred.has_svc) add('verify_service', 'ready', 'No Verify Service — codes are sent as text messages from the salon\'s own number (built-in code check).', cred.has_svc ? 'messaging service set' : 'sending number set', null);
    else add('verify_service', 'needs_setup', 'Neither a Verify Service nor a sending number is set.', 'no verify_service_sid, no from_number, no messaging_service_sid', 'Assign a sending number or a Verify Service in Phone & Messaging.');

    if (!cred) add('sender', 'needs_setup', 'No sender.', 'no account', 'Connect Twilio first.');
    else if (!cred.has_from && !cred.has_svc && !cred.has_verify) add('sender', 'needs_setup', 'No sending number or messaging service.', 'nothing assigned', 'Assign a sending number in Phone & Messaging.');
    else add('sender', cred.status === 'configured' ? 'ready' : 'unknown', cred.status === 'configured' ? 'A sender is assigned. "Connected" is not proof of delivery — see Recent errors.' : 'A sender is assigned but the account status is not active.', `account status: ${String(cred.status ?? 'unknown')}`, null);

    if (!settings) add('policy', 'unknown', 'The effective policy could not be read.', 'settings unavailable', 'Reload the page.');
    else {
      const p = settings.platform;
      if (p.blockedByPlatform) add('policy', 'failed', 'AI PowerSalon has blocked phone verification for this salon.', 'platform policy: blocked', 'Contact AI PowerSalon support.');
      else if (p.emergencyDisabled || p.moduleDisabled) add('policy', 'degraded', 'Phone verification is paused platform-wide — remote bookings are NOT being asked for a code.', p.emergencyDisabled ? 'platform emergency disable' : 'module off', 'Nothing to do at the salon; it resumes when AI PowerSalon turns it back on.');
      else if (p.requiredByPlatform) add('policy', 'ready', 'Required by AI PowerSalon platform policy — the salon cannot turn it off.', 'platform policy: required', null);
      else if (settings.enabled) add('policy', 'ready', 'On — set by the salon.', 'salon setting: enabled', null);
      else add('policy', 'needs_setup', 'Off — remote bookings are confirmed without a code.', 'salon setting: disabled', settings.provider.connected && settings.provider.validated ? 'Turn on "Require phone verification for remote bookings".' : 'Connect and test Twilio, then turn it on.');
    }

    const e: any = (await sql`select count(*) filter (where ${PROVIDER_ERR})::int as provider, count(*) filter (where s.status = 'locked')::int as locked,
        count(*) filter (where s.status = 'expired')::int as expired, count(*)::int as total,
        (select failure_reason from booking_verification_sessions x where x.tenant_id = ${ctx.tenantId} and x.status = 'failed' and x.updated_at >= now() - interval '24 hours'
           and x.failure_reason is not null order by x.updated_at desc limit 1) as last_reason
      from booking_verification_sessions s where s.tenant_id = ${ctx.tenantId} and s.updated_at >= now() - interval '24 hours'`.execute(this.db)).rows[0] ?? {};
    const lastReason = e.last_reason ? String(e.last_reason).replace(/[A-Z]{2}[0-9a-f]{32}/gi, '[id]').replace(/\+?\d{7,}/g, '[number]').slice(0, 120) : null;
    if (n(e.provider) > 0) add('recent_errors', 'degraded', `${n(e.provider)} code(s) could not be delivered in the last 24 hours.`, `latest provider outcome: ${lastReason ?? 'not recorded'}`, 'Open History, filter "Provider error", and check the Twilio account.');
    else add('recent_errors', 'ready', n(e.total) ? `No provider errors in the last 24 hours (${n(e.locked)} lockout(s), ${n(e.expired)} expired).` : 'No verification activity in the last 24 hours.', `${n(e.total)} verification record(s) in 24 h`, null);

    const sweep: any = (await sql`select count(*)::int as overdue from booking_holds where tenant_id = ${ctx.tenantId}
        and released_at is null and converted_appointment_id is null and expires_at < now() - interval '5 minutes'`.execute(this.db)).rows[0] ?? {};
    const openOld: any = (await sql`select count(*)::int as n from booking_verification_sessions where tenant_id = ${ctx.tenantId}
        and status in ('pending','sent') and expires_at < now() - interval '15 minutes'`.execute(this.db)).rows[0] ?? {};
    if (n(sweep.overdue) > 0) add('integration', 'degraded', `${n(sweep.overdue)} expired slot hold(s) have not been handed back to the calendar — the hold clean-up job may be stalled.`, 'holds past expiry by more than 5 minutes (the job runs every minute)', 'Check the API worker; new holds still expire lapsed holds on the same time automatically.');
    else add('integration', 'ready', 'Slot holds are being released on time; booking confirmation is guarded on the server.', `${n(openOld.n)} stale open code(s) older than 15 minutes`, null);
    const worst: HealthState = (['failed', 'needs_setup', 'degraded', 'pending_provider_action', 'unknown'] as HealthState[]).find((s) => items.some((i) => i.state === s)) ?? 'ready';
    return { checkedAt, overall: worst, items };
  }

  private paging(f: BvcListFilters) {
    const page = Math.max(1, Math.floor(Number(f.page ?? 1)) || 1);
    const ps = Number(f.pageSize ?? 10);
    const pageSize = [10, 20, 50].includes(ps) ? ps : 10;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }
  private base(ctx: BvcContext) {
    return sql`from booking_verification_sessions s
      left join booking_holds h on h.id = s.booking_hold_id and h.tenant_id = s.tenant_id
      left join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      left join technicians te on te.id = h.technician_id and te.tenant_id = s.tenant_id
      left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id
      where s.tenant_id = ${ctx.tenantId}`;
  }
  private cols() {
    return sql`select s.id, s.branch_id, b.name as branch_name, s.booking_session_id, s.customer_id, coalesce(c.full_name, trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))) as customer_name,
      s.phone_mask, s.channel, s.status as raw_status, ${statusCase} as status, s.failure_reason, s.policy_reason, s.attempt_count, s.resend_count,
      s.expires_at, s.created_at, s.verified_at, s.last_sent_at, s.updated_at, s.consumed_appointment_id, s.override_at,
      h.id as hold_id, ${holdCase} as hold_status, h.expires_at as hold_expires_at, h.start_time, h.end_time, h.service_ids_json,
      coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as technician_name`;
  }
  private row(r: any) {
    return {
      id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null, bookingSessionId: String(r.booking_session_id),
      customerId: r.customer_id ? String(r.customer_id) : null, customerName: (r.customer_name || '').trim() || null, maskedPhone: String(r.phone_mask ?? ''),
      channel: String(r.channel), status: String(r.status) as BvcStatus, codeState: String(r.raw_status), attempts: n(r.attempt_count), resends: n(r.resend_count),
      expiresAt: iso(r.expires_at), requestedAt: iso(r.created_at), verifiedAt: iso(r.verified_at), lastSentAt: iso(r.last_sent_at), updatedAt: iso(r.updated_at),
      appointmentId: r.consumed_appointment_id ? String(r.consumed_appointment_id) : null, staffOverride: !!r.override_at,
      hold: r.hold_id ? { holdId: String(r.hold_id), status: String(r.hold_status), expiresAt: iso(r.hold_expires_at), startsAt: iso(r.start_time), endsAt: iso(r.end_time), technicianName: (r.technician_name || '').trim() || null } : null,
      whyRequired: reasonText(r.policy_reason), failure: r.failure_reason ? String(r.failure_reason).slice(0, 80) : null,
    };
  }
  /** WHERE for history: search + filters + date basis. Every value is a bound parameter. */
  private where(f: BvcListFilters, win: ReturnType<BookingVerificationCenter['window']>, basis: DateBasis) {
    const parts = [sql`true`];
    const q = (f.q ?? '').trim().slice(0, 100);
    if (q) {
      const e164 = normalizePhone(q);
      const digits = q.replace(/\D/g, '');
      const ors = [sql`coalesce(c.full_name, '') ilike ${like(q)}`, sql`(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ilike ${like(q)}`,
        sql`coalesce(te.full_name, '') ilike ${like(q)}`, sql`(coalesce(te.first_name,'') || ' ' || coalesce(te.last_name,'')) ilike ${like(q)}`];
      if (e164) ors.push(sql`s.phone_hash = ${phoneKey(e164)}`);
      if (digits.length >= 4 && digits.length <= 6) ors.push(sql`s.phone_mask like ${'%' + digits.slice(-4)}`);
      if (UUID.test(q)) { const id = q.toLowerCase(); ors.push(sql`s.id = ${id}::uuid`, sql`s.booking_session_id = ${id}::uuid`, sql`s.consumed_appointment_id = ${id}::uuid`, sql`s.customer_id = ${id}::uuid`, sql`s.booking_hold_id = ${id}::uuid`); }
      else if (/^[0-9a-f]{6,}$/i.test(q)) ors.push(sql`s.id::text like ${q.toLowerCase() + '%'}`, sql`coalesce(s.consumed_appointment_id::text, '') like ${q.toLowerCase() + '%'}`);
      parts.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    if (f.status) { if (!(BVC_STATUSES as readonly string[]).includes(f.status)) bad('Unknown status filter.'); parts.push(sql`${statusCase} = ${f.status}`); }
    if (f.channel) { if (!(BVC_CHANNELS as readonly string[]).includes(f.channel)) bad('Unknown channel filter.'); parts.push(sql`s.channel = ${f.channel}`); }
    if (f.branchId) { if (!UUID.test(f.branchId)) bad('Unknown location.'); parts.push(sql`s.branch_id = ${f.branchId}::uuid`); }
    if (win) { const col = this.basisCol(basis); parts.push(sql`${col} >= ${win.start} and ${col} < ${win.end}`); }
    return sql`and ${sql.join(parts, sql` and `)}`;
  }

  /** History — every authorized record, newest first (created_at DESC, id DESC); exact total; pages of 10/20/50. */
  async history(ctx: BvcContext, f: BvcListFilters) {
    const tz = await this.tz(ctx);
    const basis = (f.basis || 'requested') as DateBasis; if (!BASES.includes(basis)) bad('Unknown date basis.');
    const win = this.window(tz, f);
    const { page, pageSize, offset } = this.paging(f);
    const where = this.where(f, win, basis);
    const total = n((await sql<any>`select count(*)::int as n ${this.base(ctx)} ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`${this.cols()} ${this.base(ctx)} ${where} order by s.created_at desc, s.id desc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.row(r)), page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), basis, period: await this.period(tz, f), order: 'newest_first' };
  }

  /** Live — open codes and live holds, NEAREST EXPIRY FIRST (guide §11); recently lapsed ones last. Never a code. */
  async live(ctx: BvcContext, f: BvcListFilters) {
    const { page, pageSize, offset } = this.paging(f);
    const liveWhere = sql`and ((s.status in ('pending','sent','locked') and s.consumed_appointment_id is null and s.expires_at > now() - interval '10 minutes')
        or (h.id is not null and h.released_at is null and h.converted_appointment_id is null))`;
    const total = n((await sql<any>`select count(*)::int as n ${this.base(ctx)} ${liveWhere}`.execute(this.db)).rows[0]?.n);
    const due = sql`least(coalesce(h.expires_at, s.expires_at), s.expires_at)`;
    const rows = (await sql<any>`${this.cols()} ${this.base(ctx)} ${liveWhere}
      order by (${due} <= now()) asc, ${due} asc, s.id asc limit ${pageSize} offset ${offset}`.execute(this.db)).rows;
    return { serverNow: new Date().toISOString(), items: rows.map((r) => this.row(r)), page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), order: 'nearest_expiry_first' };
  }

  /** One record + timeline (guide §13). Opening it is audited (sensitive access). */
  async detail(ctx: BvcContext, id: string) {
    if (!UUID.test(id)) notFound();
    const r = (await sql<any>`${this.cols()}, s.policy_version, s.tenant_config_version, s.branch_config_version, s.provider_config_version, s.provider,
        (s.provider_verification_sid is not null) as has_provider_ref, right(coalesce(s.provider_verification_sid, ''), 4) as provider_ref_last4,
        s.delivered_at, s.consumed_at, s.override_reason, s.override_contact_method, h.created_at as hold_created_at, h.released_at as hold_released_at, h.release_reason
      ${this.base(ctx)} and s.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) notFound();
    const svcIds: string[] = Array.isArray(r.service_ids_json) ? r.service_ids_json.map(String).filter((x: string) => UUID.test(x)) : [];
    const services = svcIds.length ? (await sql<any>`select name from services where tenant_id = ${ctx.tenantId} and id = any(${svcIds}::uuid[]) order by name`.execute(this.db)).rows.map((x) => String(x.name)) : [];
    const t: { at: string; event: string }[] = [];
    const push = (at: unknown, event: string) => { const a = iso(at); if (a) t.push({ at: a, event }); };
    push(r.created_at, 'Verification requested'); push(r.hold_created_at, 'Time slot held'); push(r.last_sent_at, 'Code sent (latest)'); push(r.delivered_at, 'Provider reported the text delivered');
    push(r.verified_at, r.override_at ? 'Approved by staff without a code' : 'Correct code accepted (checked on the server)'); push(r.consumed_at, 'Used to confirm the booking');
    if (['failed', 'locked', 'expired', 'canceled'].includes(String(r.raw_status))) push(r.updated_at, r.raw_status === 'locked' ? 'Locked — too many wrong codes' : r.raw_status === 'expired' ? 'Code expired' : r.raw_status === 'canceled' ? 'Cancelled' : 'Failed');
    push(r.hold_released_at, r.release_reason === 'hold_expired' ? 'Hold expired — the time went back to the calendar' : r.release_reason === 'converted' ? 'Hold turned into the appointment' : `Hold released (${String(r.release_reason ?? 'released')})`);
    t.sort((a, b) => a.at.localeCompare(b.at));
    await this.audit?.record({ tenantId: ctx.tenantId, branchId: r.branch_id ?? null, userId: ctx.userId, module: 'booking_verification', action: 'verification_record_viewed',
      summary: 'Viewed a booking verification record', metadata: { verificationId: id } });   // audited access — a failed write fails the read
    return {
      ...this.row(r), services,
      policy: { version: r.policy_version ?? null, tenantVersion: r.tenant_config_version ?? null, branchVersion: r.branch_config_version ?? null, providerVersion: r.provider_config_version ?? null, reason: r.policy_reason ?? null, why: reasonText(r.policy_reason) },
      provider: { kind: String(r.provider), reference: r.has_provider_ref ? `…${r.provider_ref_last4}` : null },
      override: r.override_at ? { at: iso(r.override_at), reason: r.override_reason ?? null, contactMethod: r.override_contact_method ?? null } : null,
      canResend: ['pending', 'sent'].includes(String(r.raw_status)) && !!r.customer_id && new Date(r.expires_at).getTime() > Date.now() && !!this.send,
      timeline: t,
    };
  }

  /**
   * Authorized resend (guide §11 / §14). Only for an open, unexpired code whose session belongs to a customer whose phone ON
   * RECORD hashes to the session's number — staff can never redirect a code to another number. The send itself is
   * BookingVerificationService.send: the salon's own provider, the resend cooldown and the rate limits; fail closed.
   */
  async resend(ctx: BvcContext, id: string) {
    if (!UUID.test(id)) notFound();
    if (!this.send) throw withCode(new HttpException({ code: 'BOOKING_VERIFICATION_RESEND_UNAVAILABLE', message: 'Sending codes is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'BOOKING_VERIFICATION_RESEND_UNAVAILABLE');
    const r: any = (await sql`select s.id, s.branch_id, s.channel, s.booking_session_id, s.customer_id, s.status, s.expires_at, s.phone_hash, c.normalized_phone
      from booking_verification_sessions s left join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      where s.tenant_id = ${ctx.tenantId} and s.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) notFound();
    const refuse = (message: string): never => { throw withCode(new HttpException({ code: 'BOOKING_VERIFICATION_RESEND_REFUSED', message }, HttpStatus.CONFLICT), 'BOOKING_VERIFICATION_RESEND_REFUSED'); };
    if (!['pending', 'sent'].includes(String(r.status)) || new Date(r.expires_at).getTime() <= Date.now()) refuse('This code is no longer open — the customer must start the booking again.');
    const e164 = r.normalized_phone ? normalizePhone(String(r.normalized_phone)) : null;
    if (!r.customer_id || !e164 || phoneKey(e164) !== String(r.phone_hash)) refuse('The number on the customer\'s record is not the number this code was requested for, so staff cannot resend it.');
    const out = await this.send({ tenantId: ctx.tenantId, branchId: String(r.branch_id), channel: String(r.channel) as BookingChannel, bookingSessionId: String(r.booking_session_id), customerId: String(r.customer_id) }, e164!);
    await this.audit?.record({ tenantId: ctx.tenantId, branchId: String(r.branch_id), userId: ctx.userId, module: 'booking_verification', action: 'verification_code_resent_by_staff',
      summary: 'Staff resent a booking verification code', metadata: { verificationId: id, outcome: out.status } });
    return { status: out.status, message: out.message ?? null };
  }
}
