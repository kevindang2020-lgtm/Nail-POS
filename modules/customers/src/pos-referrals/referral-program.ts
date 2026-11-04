// referral-program.ts — Referral Program Complete Build Guide (Oct 30 2026, migration 751): `/pos/referral-program/*` and the
// Checkout-linked qualification. Reuses, never duplicates:
//   customer_referrals (046 + 751)     the ONE code per customer (the Customer App issues it; a manager may disable it)
//   referral_redemptions (349 + 751)   the ONE referral per referred customer (UNIQUE (tenant, referred)) with the canonical STATE
//   referral_rewards (751)             the reward obligation: ONE per referral; APPROVED ≠ ISSUED ≠ paid cash
//   applyLoyaltyEntry (tenant loyalty) loyalty-point rewards post through the salon's own loyalty ledger, source
//                                      ('referral_rewards', reward id) — at most once per entry type (earn / reverse)
//   SegmentsRepository.createDraft     the Referral Growth Assistant only ever saves an UNSENT audience for Campaign Center
// A referral is RECORDED without being QUALIFIED; QUALIFIED without being APPROVED; APPROVED without being ISSUED; and an issued
// point / credit reward is never "paid cash". A cash payout has no approved provider here, so it is BLOCKED_EXTERNAL — never paid.
// Fraud signals (a shared phone / email / card) put a referral UNDER_REVIEW for a person; they never merge customers or confiscate.
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { canMoveToSql } from '@aipowersalon/database';
import { REFERRAL, REFERRAL_REWARD, REFERRAL_CODE } from '../customer-lifecycles';
import { applyLoyaltyEntry } from '../loyalty/loyalty-ledger.service';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { isUuid, RetentionRepository, type RetentionContext } from '../retention/retention.repository';
import { SegmentsRepository, type SegmentFilters } from '../segments/segments.repository';

export class ReferralProgramError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}
export type RefCtx = RetentionContext;

export const RP_POLICY_VERSION_NONE = 0;
export const RP_STATES = ['RECORDED', 'PENDING_QUALIFICATION', 'QUALIFIED', 'REWARD_PENDING_APPROVAL', 'APPROVED', 'REWARD_ISSUED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'UNDER_REVIEW'] as const;
export const RP_TABS = ['all', 'pending', 'qualified', 'review', 'approved', 'issued', 'rejected', 'reversed', 'closed'] as const;
export const RP_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'] as const;
export const RP_BASES = ['recorded', 'qualified', 'decided', 'issued', 'transaction'] as const;
export const RP_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const;
export const RP_REWARD_TYPES = ['loyalty_points', 'cash_payout'] as const;
export const RP_GOALS = ['first_time_customers', 'existing_refer_friends', 'low_demand_weekdays', 'review_performance'] as const;
export const RP_REVIEW_ACTIONS = ['approve', 'reject', 'investigate', 'clear_review'] as const;
export const RP_ELIGIBILITY = ['ELIGIBLE_TO_RECORD', 'RECORDED_WAITING_FOR_QUALIFICATION', 'QUALIFIED_PENDING_APPROVAL', 'INELIGIBLE', 'REVIEW_REQUIRED', 'ERROR_UNKNOWN'] as const;
const TAB_STATES: Record<string, string[] | null> = {
  all: null, pending: ['RECORDED', 'PENDING_QUALIFICATION'], qualified: ['QUALIFIED'], review: ['UNDER_REVIEW', 'REWARD_PENDING_APPROVAL'],   // a reward waiting for approval is in Needs review only (it used to sit in two tabs)
  approved: ['APPROVED'], issued: ['REWARD_ISSUED'], rejected: ['REJECTED'], reversed: ['REVERSED'], closed: ['REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED'],
};
const OPEN_STATES = ['RECORDED', 'PENDING_QUALIFICATION'];
const PENDING_REWARD_STATES = ['PENDING_APPROVAL', 'APPROVED', 'FAILED'];
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
type Flag = { code: string; detail: string };
const QUALIFIER = 'first-paid-visit-v1';
const RETURNING: SegmentFilters = { segment: 'returning' };
/** explicit columns (never a whole-row read): what the workflow needs from a referral / a reward */
const REF_COLS = sql`id, tenant_id, referrer_customer_id, referred_customer_id, code, state, branch_id, code_id, policy_version, recorded_by, qualifying_ticket_id,
  qualified_at, decided_at, review_reason, fraud_flags, legacy_marked_reward_cents, row_version, redeemed_at`;
const RW_COLS = sql`rw.id, rw.referral_id, rw.recipient_customer_id, rw.reward_type, rw.points, rw.amount_cents, rw.policy_version, rw.state, rw.requested_at, rw.decided_at,
  rw.decision_reason, rw.issued_at, rw.issuance_key, rw.ledger_entry_id, rw.issue_error, rw.reversed_at, rw.reversal_reason, rw.reversal_ledger_id, rw.reversal_shortfall`;
type CodeInfo = { codeId: string; code: string; status: string; expiresAt: string | null; referrerCustomerId: string; referrerName: string | null };
export interface CheckResult {
  result: (typeof RP_ELIGIBILITY)[number]; reasons: { code: string; ok: boolean; text: string }[]; retrySafe: boolean;
  policy?: RpSettings; codeInfo?: CodeInfo; referred?: { customerId: string; name: string | null; phone: string | null }; existingReferralId?: string; flags?: Flag[];
}

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const pick = <T extends readonly string[]>(vals: T, v: unknown): T[number] | undefined => ((vals as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const actorId = (ctx: { userId?: string }) => (isUuid(ctx.userId) ? ctx.userId : null);
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
export const maskPhone = (p: unknown) => { const d = digits(p); return d.length >= 4 ? `•••• ${d.slice(-4)}` : null; };
export const maskEmail = (e: unknown) => { const s = String(e ?? ''); const at = s.indexOf('@'); return at > 0 ? `${s[0]}•••${s.slice(at)}` : null; };
const pageOf = (p: unknown) => Math.max(1, Math.trunc(N(p)) || 1);
const sizeOf = (s: unknown) => ([10, 20, 50].includes(Math.trunc(N(s))) ? Math.trunc(N(s)) : 20);

export interface RpSettings {
  enabled: boolean; rewardType: (typeof RP_REWARD_TYPES)[number] | null; rewardPoints: number | null; rewardCents: number | null;
  requiresApproval: boolean; separationOfDuties: boolean; minQualifyingSpendCents: number; qualificationWindowDays: number | null;
  recordGraceHours: number; version: number; isDefault: boolean; updatedAt: string | null; configured: boolean;
}
export interface RpListFilters { tab?: unknown; q?: unknown; rewardType?: unknown; basis?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown; branch?: unknown }

export class ReferralProgram {
  readonly ret: RetentionRepository;
  readonly seg: SegmentsRepository;
  constructor(readonly db: Kysely<any>) { this.ret = new RetentionRepository(db); this.seg = new SegmentsRepository(db, this.ret); }

  // ── policy (guide §19 decision register: nothing is invented — a missing reward means "waiting for the owner") ───────
  async settings(ctx: { tenantId: string }, db: Kysely<any> = this.db): Promise<RpSettings> {
    const r = (await sql<any>`select enabled, reward_type, reward_points, reward_cents, requires_approval, separation_of_duties, min_qualifying_spend_cents, qualification_window_days, record_grace_hours, version, updated_at from referral_program_settings where tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
    const rewardType = pick(RP_REWARD_TYPES, r?.reward_type) ?? null;
    return {
      enabled: r ? !!r.enabled : true, rewardType, rewardPoints: r?.reward_points == null ? null : N(r.reward_points), rewardCents: r?.reward_cents == null ? null : N(r.reward_cents),
      requiresApproval: r ? !!r.requires_approval : true, separationOfDuties: !!r?.separation_of_duties, minQualifyingSpendCents: N(r?.min_qualifying_spend_cents),
      qualificationWindowDays: r?.qualification_window_days == null ? null : N(r.qualification_window_days), recordGraceHours: r ? N(r.record_grace_hours) : 24,
      version: r ? N(r.version) : RP_POLICY_VERSION_NONE, isDefault: !r, updatedAt: iso(r?.updated_at), configured: !!rewardType,
    };
  }
  async saveSettings(ctx: RefCtx, b: Record<string, unknown>, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const rewardType = b.rewardType == null ? null : pick(RP_REWARD_TYPES, b.rewardType);
    if (b.rewardType != null && !rewardType) throw new ReferralProgramError('Choose loyalty points or a cash payout.', 'REFERRAL_POLICY_INVALID');
    const points = b.rewardPoints == null ? null : Math.trunc(N(b.rewardPoints));
    const cents = b.rewardCents == null ? null : Math.trunc(N(b.rewardCents));
    if (rewardType === 'loyalty_points' && !(points && points > 0 && points <= 100000)) throw new ReferralProgramError('Enter the points to award (1 – 100,000).', 'REFERRAL_POLICY_INVALID');
    if (rewardType === 'cash_payout' && !(cents && cents > 0 && cents <= 1000000)) throw new ReferralProgramError('Enter the payout amount.', 'REFERRAL_POLICY_INVALID');
    const minSpend = Math.trunc(N(b.minQualifyingSpendCents));
    const windowDays = b.qualificationWindowDays == null ? null : Math.trunc(N(b.qualificationWindowDays));
    const grace = b.recordGraceHours == null ? 24 : Math.trunc(N(b.recordGraceHours));
    if (minSpend < 0 || minSpend > 10000000) throw new ReferralProgramError('Enter a minimum spend of $0 or more.', 'REFERRAL_POLICY_INVALID');
    if (windowDays != null && (windowDays < 1 || windowDays > 730)) throw new ReferralProgramError('The qualification window is 1 – 730 days.', 'REFERRAL_POLICY_INVALID');
    if (grace < 0 || grace > 168) throw new ReferralProgramError('The recording grace period is 0 – 168 hours.', 'REFERRAL_POLICY_INVALID');
    const expected = Math.trunc(N(b.expectedVersion));
    const a = actorId(ctx);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'refpolicy:' + ctx.tenantId}))`.execute(trx);
      const cur = await this.settings(ctx, trx);
      if (cur.version !== expected) throw new ReferralProgramError('Someone else changed the referral policy. Reload and try again.', 'VERSION_CONFLICT', 409, { currentVersion: cur.version });
      const v = { enabled: b.enabled == null ? cur.enabled : !!b.enabled, requiresApproval: b.requiresApproval == null ? cur.requiresApproval : !!b.requiresApproval, sod: b.separationOfDuties == null ? cur.separationOfDuties : !!b.separationOfDuties };
      if (cur.isDefault) await sql`insert into referral_program_settings (tenant_id, enabled, reward_type, reward_points, reward_cents, requires_approval, separation_of_duties,
          min_qualifying_spend_cents, qualification_window_days, record_grace_hours, version, created_by, updated_by)
        values (${ctx.tenantId}, ${v.enabled}, ${rewardType}, ${rewardType === 'loyalty_points' ? points : null}, ${rewardType === 'cash_payout' ? cents : null}, ${v.requiresApproval}, ${v.sod},
          ${minSpend}, ${windowDays}, ${grace}, 1, ${a}, ${a})`.execute(trx);
      else await sql`update referral_program_settings set enabled = ${v.enabled}, reward_type = ${rewardType}, reward_points = ${rewardType === 'loyalty_points' ? points : null},
          reward_cents = ${rewardType === 'cash_payout' ? cents : null}, requires_approval = ${v.requiresApproval}, separation_of_duties = ${v.sod}, min_qualifying_spend_cents = ${minSpend},
          qualification_window_days = ${windowDays}, record_grace_hours = ${grace}, version = version + 1, updated_by = ${a}, updated_at = now()
        where tenant_id = ${ctx.tenantId} and version = ${expected}`.execute(trx);
      const after = await this.settings(ctx, trx);
      await audit(trx, { before: cur, after });
      return after;
    });
  }
  /** Settings → Loyalty & Memberships "Referral rewards" switch (the salon's existing toggle): explicitly OFF blocks issuance */
  async rewardsSwitchOff(tenantId: string, branchId: string | null, db: Kysely<any> = this.db): Promise<boolean> {
    const r = (await sql<any>`select settings_json->>'referralReward' as v from tenant_settings where tenant_id = ${tenantId} and category = 'loyalty-memberships'
      and (branch_id = ${isUuid(branchId) ? branchId : null} or branch_id is null) order by (branch_id is null) asc limit 1`.execute(db)).rows[0];
    return r?.v === 'false';
  }

  // ── salon time ────────────────────────────────────────────────────────────────────────────────────────────────────
  private async tz(ctx: RefCtx): Promise<{ tz: string; today: string }> { const k = await this.ret.window(ctx); return { tz: k.tz, today: k.today }; }
  /** inclusive salon-local From → To as [start, end) instants (DST-correct: Postgres converts each local midnight) */
  range(today: string, f: { preset?: unknown; from?: unknown; to?: unknown }): { preset: string; from: string; to: string } | null {
    const preset = pick(RP_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : undefined);
    if (!preset) return null;
    const d = new Date(today + 'T00:00:00Z');
    const ymd = (x: Date) => utcDate(x);
    if (preset === 'today') return { preset, from: today, to: today };
    if (preset === 'week') { const dow = (d.getUTCDay() + 6) % 7; const s = new Date(d); s.setUTCDate(d.getUTCDate() - dow); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6); return { preset, from: ymd(s), to: ymd(e) }; }
    if (preset === 'month') { const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return { preset, from: ymd(s), to: ymd(e) }; }
    if (preset === 'year') return { preset, from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
    const from = typeof f.from === 'string' && DAY.test(f.from) ? f.from : null;
    const to = typeof f.to === 'string' && DAY.test(f.to) ? f.to : null;
    if (!from || !to) throw new ReferralProgramError('Choose a From and a To date.', 'REFERRAL_RANGE_INVALID');
    if (from > to) throw new ReferralProgramError('The From date must be on or before the To date.', 'REFERRAL_RANGE_INVALID');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 3660) throw new ReferralProgramError('Choose a range of 10 years or less.', 'REFERRAL_RANGE_INVALID');
    return { preset: 'custom', from, to };
  }

  // ── eligibility checker (guide §08) — READ-ONLY: it never records, issues or sends ──────────────────────────────────
  async check(ctx: RefCtx, b: { code?: unknown; referredCustomerId?: unknown }, db: Kysely<any> = this.db): Promise<CheckResult> {
    const T = ctx.tenantId;
    const reasons: { code: string; ok: boolean; text: string }[] = [];
    const out = (result: CheckResult['result'], extra: Partial<CheckResult> = {}): CheckResult => ({ result, reasons, retrySafe: result !== 'ERROR_UNKNOWN', ...extra });
    const codeText = str(b.code, 40);
    if (!codeText) { reasons.push({ code: 'code_missing', ok: false, text: 'Enter a referral code.' }); return out('INELIGIBLE'); }
    const policy = await this.settings(ctx, db);
    if (!policy.enabled) { reasons.push({ code: 'program_disabled', ok: false, text: 'The referral program is turned off for this salon. Existing referrals are kept.' }); return out('INELIGIBLE', { policy }); }
    const code = (await sql<any>`select cr.id, cr.code, cr.status, cr.expires_at, cr.customer_id, c.full_name, c.normalized_phone, c.email, c.status as customer_status
      from customer_referrals cr left join customers c on c.id = cr.customer_id and c.tenant_id = cr.tenant_id
      where cr.tenant_id = ${T} and lower(cr.code) = lower(${codeText}) limit 1`.execute(db)).rows[0];
    if (!code) { reasons.push({ code: 'code_unknown', ok: false, text: 'No referral code in this salon matches that code.' }); return out('INELIGIBLE', { policy }); }
    if (code.status !== 'active') { reasons.push({ code: 'code_disabled', ok: false, text: 'This referral code has been disabled.' }); return out('INELIGIBLE', { policy, codeInfo: this.codeInfo(code) }); }
    if (code.expires_at && new Date(code.expires_at).getTime() <= Date.now()) { reasons.push({ code: 'code_expired', ok: false, text: 'This referral code has expired.' }); return out('INELIGIBLE', { policy, codeInfo: this.codeInfo(code) }); }
    // Nov 3 audit: customer status was read but never used — an archived customer could refer or be referred
    if (code.customer_status && code.customer_status !== 'active') { reasons.push({ code: 'referrer_inactive', ok: false, text: 'The customer who owns this code is no longer active in this salon.' }); return out('INELIGIBLE', { policy, codeInfo: this.codeInfo(code) }); }
    reasons.push({ code: 'code_valid', ok: true, text: `Code ${String(code.code).toUpperCase()} is active and belongs to ${code.full_name ?? 'a customer'} in this salon.` });
    const rid = isUuid(b.referredCustomerId) ? String(b.referredCustomerId) : null;
    if (!rid) { reasons.push({ code: 'customer_missing', ok: false, text: 'Choose the new customer.' }); return out('INELIGIBLE', { policy, codeInfo: this.codeInfo(code) }); }
    const cust = (await sql<any>`select c.id, c.full_name, c.normalized_phone, c.email, c.status, c.created_at from customers c where c.tenant_id = ${T} and c.id = ${rid}`.execute(db)).rows[0];
    if (!cust) { reasons.push({ code: 'customer_unknown', ok: false, text: 'That customer is not in this salon.' }); return out('INELIGIBLE', { policy, codeInfo: this.codeInfo(code) }); }
    const info = { codeInfo: this.codeInfo(code), referred: { customerId: rid, name: cust.full_name, phone: maskPhone(cust.normalized_phone) } };
    if (cust.status && cust.status !== 'active') { reasons.push({ code: 'referred_inactive', ok: false, text: 'That customer is not active in this salon.' }); return out('INELIGIBLE', { policy, ...info }); }
    if (String(code.customer_id) === rid) { reasons.push({ code: 'self_referral', ok: false, text: 'A customer cannot refer themselves.' }); return out('INELIGIBLE', { policy, ...info }); }
    // the same verified person behind two customer records in this salon is still a self-referral (never merged — refused)
    const sameIdentity = (await sql<any>`select 1 from customer_identity_links a join customer_identity_links b on b.identity_id = a.identity_id and b.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.customer_id = ${code.customer_id} and b.customer_id = ${rid} limit 1`.execute(db)).rows.length > 0;
    if (sameIdentity) { reasons.push({ code: 'self_referral_identity', ok: false, text: 'Both records belong to the same verified person, so this is a self-referral.' }); return out('INELIGIBLE', { policy, ...info }); }
    reasons.push({ code: 'distinct_customers', ok: true, text: 'The referrer and the new customer are different customers.' });
    const existing = (await sql<any>`select rr.id, rr.state, rr.code, rr.referrer_customer_id from referral_redemptions rr where rr.tenant_id = ${T} and rr.referred_customer_id = ${rid} limit 1`.execute(db)).rows[0];
    if (existing) {
      reasons.push({ code: 'already_referred', ok: false, text: `This customer already has a referral (${existing.state}). Only one referral claim per customer is allowed.` });
      const res: CheckResult['result'] = existing.state === 'REWARD_PENDING_APPROVAL' || existing.state === 'QUALIFIED' ? 'QUALIFIED_PENDING_APPROVAL' : OPEN_STATES.includes(existing.state) ? 'RECORDED_WAITING_FOR_QUALIFICATION' : 'INELIGIBLE';
      return out(res, { policy, ...info, existingReferralId: String(existing.id) });
    }
    // first-time status: settled visits before now; a first visit inside the grace period may still be recorded (then qualified at once)
    const v = (await sql<any>`select count(*)::int as n, min(coalesce(t.paid_at, t.created_at)) as first_at from tickets t
      where t.tenant_id = ${T} and t.customer_id = ${rid} and t.removed_at is null and t.status = any(${VISIT}::text[])`.execute(db)).rows[0];
    const visits = N(v?.n);
    if (visits > 1) { reasons.push({ code: 'not_first_time', ok: false, text: `This customer already has ${visits} completed visits, so they are not a new customer.` }); return out('INELIGIBLE', { policy, ...info }); }
    if (visits === 1) {
      const hours = (Date.now() - new Date(v.first_at).getTime()) / 3600000;
      if (hours > policy.recordGraceHours) { reasons.push({ code: 'not_first_time', ok: false, text: `This customer's first visit was more than ${policy.recordGraceHours} hours ago, so it can no longer be credited to a referral.` }); return out('INELIGIBLE', { policy, ...info }); }
      reasons.push({ code: 'first_visit_in_grace', ok: true, text: `The first visit was within the last ${policy.recordGraceHours} hours; it will be checked for qualification as soon as the referral is saved.` });
    } else reasons.push({ code: 'first_time', ok: true, text: 'No completed visit yet — the referral qualifies at the first completed, paid visit.' });
    const flags = await this.fraudSignals(T, String(code.customer_id), rid, null, db);
    for (const f of flags) reasons.push({ code: f.code, ok: false, text: f.detail });
    reasons.push(policy.configured
      ? { code: 'reward_policy', ok: true, text: policy.rewardType === 'loyalty_points' ? `Reward on qualification: ${policy.rewardPoints} loyalty points to the referrer${policy.requiresApproval ? ', after manager approval' : ''}.` : `Reward on qualification: a cash payout — no payout provider is approved, so it will show as Blocked (external).` }
      : { code: 'reward_policy_missing', ok: false, text: 'No reward is set yet. The referral can be recorded and qualified; the reward waits until the owner sets one.' });
    return out(flags.length ? 'REVIEW_REQUIRED' : 'ELIGIBLE_TO_RECORD', { policy, ...info, flags });
  }
  private codeInfo(c: any): CodeInfo { return { codeId: String(c.id), code: String(c.code).toUpperCase(), status: c.status, expiresAt: iso(c.expires_at), referrerCustomerId: String(c.customer_id), referrerName: c.full_name ?? null }; }

  /** risk signals only (guide §14): a shared phone / email between referrer and referred, or the same card on both — never a merge */
  async fraudSignals(T: string, referrerId: string, referredId: string, ticketId: string | null, db: Kysely<any> = this.db): Promise<Flag[]> {
    const r = (await sql<any>`select a.normalized_phone as ap, a.email as ae, b.normalized_phone as bp, b.email as be from customers a, customers b
      where a.tenant_id = ${T} and a.id = ${referrerId} and b.tenant_id = ${T} and b.id = ${referredId}`.execute(db)).rows[0];
    const flags: Flag[] = [];
    if (r && digits(r.ap).length >= 7 && digits(r.ap) === digits(r.bp)) flags.push({ code: 'shared_phone', detail: 'The referrer and the new customer share a phone number (could be family — a person should review).' });
    if (r && r.ae && r.be && String(r.ae).toLowerCase() === String(r.be).toLowerCase()) flags.push({ code: 'shared_email', detail: 'The referrer and the new customer share an email address.' });
    if (ticketId) {
      const card = (await sql<any>`select 1 from payments p join payments q on q.tenant_id = p.tenant_id and q.card_last4 = p.card_last4 and q.card_brand = p.card_brand
          join tickets qt on qt.id = q.ticket_id and qt.tenant_id = q.tenant_id
        where p.tenant_id = ${T} and p.ticket_id = ${ticketId} and p.card_last4 is not null and qt.customer_id = ${referrerId} limit 1`.execute(db)).rows.length > 0;
      if (card) flags.push({ code: 'shared_card', detail: 'The qualifying visit was paid with a card (same brand and last 4) the referrer has used.' });
    }
    return flags;
  }

  // ── record (guide §08 step 4) — one canonical referral; a duplicate returns the same referral ──────────────────────
  async record(ctx: RefCtx, b: { code?: unknown; referredCustomerId?: unknown; idempotencyKey?: unknown }) {
    const T = ctx.tenantId;
    const key = str(b.idempotencyKey, 120) ?? null;
    const res = await this.db.transaction().execute(async (trx): Promise<{ id: string; duplicate: boolean; qualifyTicket?: string | null }> => {
      if (isUuid(b.referredCustomerId)) await sql`select pg_advisory_xact_lock(hashtext(${'referral:' + T + ':' + b.referredCustomerId}))`.execute(trx);
      if (key) {
        const prior = (await sql<any>`select referral_id from referral_events where tenant_id = ${T} and idempotency_key = ${'record:' + key}`.execute(trx)).rows[0];
        if (prior) return { id: String(prior.referral_id), duplicate: true };
      }
      const c = await this.check(ctx, b, trx);
      if (c.result === 'RECORDED_WAITING_FOR_QUALIFICATION' || c.result === 'QUALIFIED_PENDING_APPROVAL') {
        const ex = (await sql<any>`select id, referrer_customer_id from referral_redemptions where tenant_id = ${T} and id = ${c.existingReferralId}`.execute(trx)).rows[0];
        if (ex && String(ex.referrer_customer_id) === c.codeInfo?.referrerCustomerId) return { id: String(ex.id), duplicate: true };
        throw new ReferralProgramError('This customer was already referred by someone else.', 'REFERRAL_EXISTS', 409, { referralId: c.existingReferralId });
      }
      if (c.result === 'INELIGIBLE') {
        const first = c.reasons.find((r) => !r.ok);
        const codeMap: Record<string, string> = { self_referral: 'SELF_REFERRAL', self_referral_identity: 'SELF_REFERRAL', code_unknown: 'REFERRAL_CODE_UNKNOWN', code_disabled: 'REFERRAL_CODE_DISABLED',
          code_expired: 'REFERRAL_CODE_DISABLED', already_referred: 'REFERRAL_EXISTS', not_first_time: 'REFERRAL_NOT_FIRST_TIME', program_disabled: 'REFERRAL_PROGRAM_DISABLED' };
        throw new ReferralProgramError(first?.text ?? 'This referral is not eligible.', codeMap[first?.code ?? ''] ?? 'REFERRAL_INELIGIBLE', first?.code === 'already_referred' ? 409 : 400, { reasons: c.reasons });
      }
      if (c.result === 'ERROR_UNKNOWN') throw new ReferralProgramError('The eligibility check could not finish. Nothing was saved; try again.', 'REFERRAL_CHECK_FAILED', 503);
      const info = c.codeInfo!; const flags: Flag[] = c.flags ?? [];
      const state = flags.length ? 'UNDER_REVIEW' : 'PENDING_QUALIFICATION';
      const ins = (await sql<any>`insert into referral_redemptions (tenant_id, referrer_customer_id, referred_customer_id, code, status, reward_cents, state, branch_id, code_id, policy_version,
          recorded_by, fraud_flags, review_reason, updated_by, updated_at)
        values (${T}, ${info.referrerCustomerId}, ${b.referredCustomerId}, ${info.code}, 'pending', 0, ${state}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${info.codeId},
          ${c.policy?.version ?? 0}, ${actorId(ctx)}, ${JSON.stringify(flags)}::jsonb, ${flags.length ? 'Risk signals at recording: ' + flags.map((f) => f.code).join(', ') : null}, ${actorId(ctx)}, now())
        on conflict (tenant_id, referred_customer_id) where referred_customer_id is not null do nothing returning id`.execute(trx)).rows[0];
      if (!ins) {
        const ex = (await sql<any>`select id, referrer_customer_id from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${b.referredCustomerId}`.execute(trx)).rows[0];
        if (ex && String(ex.referrer_customer_id) === info.referrerCustomerId) return { id: String(ex.id), duplicate: true };
        throw new ReferralProgramError('This customer was already referred by someone else.', 'REFERRAL_EXISTS', 409, { referralId: ex ? String(ex.id) : null });
      }
      const id = String(ins.id);
      await this.event(trx, T, id, null, 'recorded', null, state, ctx.userId, flags.length ? 'Risk signals — a person must review' : null, `code:${info.code}`, key ? 'record:' + key : null, { flags, policyVersion: c.policy?.version ?? 0 });
      // a first visit that already happened inside the grace period qualifies now (same rules as the Checkout event)
      const t = (await sql<any>`select t.id from tickets t where t.tenant_id = ${T} and t.customer_id = ${b.referredCustomerId} and t.removed_at is null and t.status = any(${VISIT}::text[])
        order by coalesce(t.paid_at, t.created_at) asc, t.id asc limit 1`.execute(trx)).rows[0];
      return { id, duplicate: false, qualifyTicket: t ? String(t.id) : null };
    });
    if (!res.duplicate && res.qualifyTicket) await this.qualifyForTicket(T, res.qualifyTicket, `record:${res.id}`);
    return { ...(await this.detail(ctx, res.id, { full: false })), duplicate: res.duplicate };
  }

  async event(trx: Kysely<any>, T: string, referralId: string, rewardId: string | null, type: string, from: string | null, to: string | null, actor: unknown, reason: string | null,
    source: string | null, idem: string | null, meta: Record<string, unknown> = {}) {
    // clock_timestamp(), not now(): several events in ONE transaction must keep their real order in the audit trail
    await sql`insert into referral_events (tenant_id, referral_id, reward_id, event_type, from_state, to_state, actor_user_id, reason, source_ref, idempotency_key, metadata, created_at)
      values (${T}, ${referralId}, ${rewardId}, ${type}, ${from}, ${to}, ${isUuid(actor) ? actor : null}, ${reason}, ${source}, ${idem}, ${JSON.stringify(meta)}::jsonb, clock_timestamp())
      on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`.execute(trx);
  }
  private async moveReferral(trx: Kysely<any>, T: string, id: string, to: string, set: ReturnType<typeof sql> | null = null) {
    const r = (await sql<any>`update referral_redemptions set state = ${to}, row_version = row_version + 1, updated_at = now() ${set ? sql`, ${set}` : sql``}
      where tenant_id = ${T} and id = ${id} and ${canMoveToSql(REFERRAL, to)} returning id`.execute(trx)).rows[0];
    if (!r) throw new ReferralProgramError(`This referral cannot move to ${to} from its current state.`, 'REFERRAL_STATE_CONFLICT', 409);
  }
  private async moveReward(trx: Kysely<any>, T: string, id: string, to: string, set: ReturnType<typeof sql> | null = null) {
    const r = (await sql<any>`update referral_rewards set state = ${to}, row_version = row_version + 1, updated_at = now() ${set ? sql`, ${set}` : sql``}
      where tenant_id = ${T} and id = ${id} and ${canMoveToSql(REFERRAL_REWARD, to)} returning id`.execute(trx)).rows[0];
    if (!r) throw new ReferralProgramError(`This reward cannot move to ${to} from its current state.`, 'REFERRAL_REWARD_STATE_CONFLICT', 409);
  }

  // ── qualification (guide §04 stage 03): a completed, PAID first visit — exactly once per ticket ───────────────────────
  /** Called by the Checkout consumer (checkout.completed) and after recording. Idempotent: a second delivery changes nothing. */
  async qualifyForTicket(T: string, ticketId: string, source: string, outer?: Kysely<any>): Promise<{ outcome: string; referralId?: string; rewardId?: string | null }> {
    const run = async (trx: Kysely<any>) => {
      const t = (await sql<any>`select t.id, t.tenant_id, t.customer_id, t.status, t.removed_at, t.total_cents, t.paid_at, t.created_at from tickets t where t.id = ${ticketId}`.execute(trx)).rows[0];
      if (!t || !t.customer_id) return { outcome: 'no_customer' };
      if (String(t.tenant_id) !== T) throw new ReferralProgramError('That ticket belongs to another salon.', 'TENANT_ACCESS_DENIED', 403);
      await sql`select pg_advisory_xact_lock(hashtext(${'referral:' + T + ':' + t.customer_id}))`.execute(trx);
      const r = (await sql<any>`select ${REF_COLS} from referral_redemptions where tenant_id = ${T} and referred_customer_id = ${t.customer_id} for update`.execute(trx)).rows[0];
      if (!r) return { outcome: 'no_referral' };
      if (r.qualifying_ticket_id) return { outcome: String(r.qualifying_ticket_id) === ticketId ? 'duplicate' : 'already_qualified', referralId: String(r.id) };
      if (!OPEN_STATES.includes(r.state) && r.state !== 'UNDER_REVIEW') return { outcome: 'not_open', referralId: String(r.id) };
      if (r.state === 'UNDER_REVIEW' && r.legacy_marked_reward_cents != null) return { outcome: 'legacy_review', referralId: String(r.id) };
      const policy = await this.settings({ tenantId: T }, trx);
      const fail = async (reason: string, text: string, to: string | null) => {
        await this.event(trx, T, String(r.id), null, 'qualification_failed', r.state, to ?? r.state, null, text, `ticket:${ticketId}`, `qualify-fail:${ticketId}`, { reason, evaluator: QUALIFIER });
        if (to) await this.moveReferral(trx, T, String(r.id), to, sql`decided_at = now(), review_reason = ${text}`);
        return { outcome: reason, referralId: String(r.id) };
      };
      if (t.removed_at || !VISIT.includes(String(t.status)) || !t.paid_at) return fail('not_paid', 'The visit is not a completed, paid Checkout.', null);
      // the FIRST settled visit is the only one that can qualify (first-paid-visit-v1)
      const earlier = (await sql<any>`select count(*)::int as n from tickets x where x.tenant_id = ${T} and x.customer_id = ${t.customer_id} and x.removed_at is null and x.status = any(${VISIT}::text[])
        and x.id <> ${ticketId} and (coalesce(x.paid_at, x.created_at), x.id) < (${t.paid_at}::timestamptz, ${ticketId}::uuid)`.execute(trx)).rows[0];
      if (N(earlier?.n) > 0) return fail('not_first_visit', 'This is not the customer\'s first completed visit.', 'REJECTED');
      if (new Date(t.paid_at).getTime() < new Date(r.redeemed_at).getTime() - policy.recordGraceHours * 3600000) return fail('before_referral', 'The visit happened before the referral was recorded (outside the grace period).', 'REJECTED');
      if (policy.qualificationWindowDays && new Date(t.paid_at).getTime() > new Date(r.redeemed_at).getTime() + policy.qualificationWindowDays * 86400000) return fail('window_passed', `The first visit came after the ${policy.qualificationWindowDays}-day qualification window.`, 'EXPIRED');
      const refunded = N((await sql<any>`select coalesce(sum(rf.amount_cents), 0)::bigint as v from payment_refunds rf join payments p on p.id = rf.payment_id and p.tenant_id = rf.tenant_id
        where rf.tenant_id = ${T} and p.ticket_id = ${ticketId} and rf.status = 'refunded'`.execute(trx)).rows[0]?.v);
      const net = N(t.total_cents) - refunded;
      if (net <= 0 || net < policy.minQualifyingSpendCents) return fail('below_minimum', policy.minQualifyingSpendCents > 0 ? `The paid amount is below the $${(policy.minQualifyingSpendCents / 100).toFixed(2)} minimum.` : 'The visit was fully refunded.', 'REJECTED');
      const flags = [...((typeof r.fraud_flags === 'string' ? JSON.parse(r.fraud_flags) : r.fraud_flags) ?? []), ...(await this.fraudSignals(T, String(r.referrer_customer_id), String(t.customer_id), ticketId, trx)).filter((f) => f.code === 'shared_card')];
      const from = r.state;
      if (from === 'UNDER_REVIEW') await sql`update referral_redemptions set qualifying_ticket_id = ${ticketId}, qualified_at = ${t.paid_at}, fraud_flags = ${JSON.stringify(flags)}::jsonb, row_version = row_version + 1, updated_at = now()
        where tenant_id = ${T} and id = ${r.id}`.execute(trx);
      else await this.moveReferral(trx, T, String(r.id), 'QUALIFIED', sql`qualifying_ticket_id = ${ticketId}, qualified_at = ${t.paid_at}, fraud_flags = ${JSON.stringify(flags)}::jsonb`);
      await this.event(trx, T, String(r.id), null, 'qualified', from, from === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'QUALIFIED', null, null, `ticket:${ticketId}`, `qualify:${ticketId}`,
        { source, evaluator: QUALIFIER, netPaidCents: net, policyVersion: policy.version, flags });
      if (!policy.configured || !policy.enabled) {
        await this.event(trx, T, String(r.id), null, 'awaiting_policy', null, null, null, policy.enabled ? 'No reward is set; the owner must choose one before anything is issued.' : 'The program is turned off; no reward is created.', null, `await-policy:${r.id}`);
        return { outcome: 'qualified_no_policy', referralId: String(r.id), rewardId: null };
      }
      const needsPerson = policy.requiresApproval || flags.length > 0 || from === 'UNDER_REVIEW';
      const rw = (await sql<any>`insert into referral_rewards (tenant_id, referral_id, recipient_customer_id, reward_type, points, amount_cents, policy_version, state, updated_by)
        values (${T}, ${r.id}, ${r.referrer_customer_id}, ${policy.rewardType}, ${policy.rewardType === 'loyalty_points' ? policy.rewardPoints : null}, ${policy.rewardType === 'cash_payout' ? policy.rewardCents : null},
          ${policy.version}, ${needsPerson ? 'PENDING_APPROVAL' : 'APPROVED'}, null)
        on conflict (tenant_id, referral_id) do nothing returning id`.execute(trx)).rows[0];
      if (!rw) return { outcome: 'duplicate', referralId: String(r.id) };
      const rewardId = String(rw.id);
      if (flags.length && from !== 'UNDER_REVIEW') await this.moveReferral(trx, T, String(r.id), 'UNDER_REVIEW', sql`review_reason = ${'Risk signals: ' + flags.map((f: Flag) => f.code).join(', ')}`);
      else if (from !== 'UNDER_REVIEW') await this.moveReferral(trx, T, String(r.id), needsPerson ? 'REWARD_PENDING_APPROVAL' : 'APPROVED', needsPerson ? null : sql`decided_at = now()`);
      await this.event(trx, T, String(r.id), rewardId, 'reward_requested', null, needsPerson ? 'PENDING_APPROVAL' : 'APPROVED', null, needsPerson ? 'Waiting for a manager' : 'Approval not required by the salon policy', null, `reward-req:${r.id}`,
        { rewardType: policy.rewardType, points: policy.rewardPoints, cents: policy.rewardCents });
      if (!needsPerson) { const iss = await this.issueTx(trx, T, null, rewardId, 'auto'); return { outcome: iss.state === 'ISSUED' ? 'auto_issued' : 'auto_approved', referralId: String(r.id), rewardId }; }
      return { outcome: 'pending_approval', referralId: String(r.id), rewardId };
    };
    return outer ? run(outer) : this.db.transaction().execute(run);
  }

  // ── issuance (guide §10): exactly one posting per reward; a cash payout is BLOCKED_EXTERNAL ─────────────────────────
  /** the issuance itself, inside the caller's transaction. A turned-off Settings switch leaves the reward APPROVED (not an error). */
  async issueTx(trx: Kysely<any>, T: string, actor: unknown, rewardId: string, source: string): Promise<{ rewardId: string; state: string; duplicate: boolean; ledgerEntryId?: string | null; held?: string }> {
    // lock order: the referral, THEN its reward — the same order review() takes. Locking the reward first deadlocked against a
    // concurrent approval holding the referral (real Postgres: "deadlock detected" instead of a clean conflict).
    await sql`select rr.id from referral_redemptions rr where rr.tenant_id = ${T} and rr.id = (select rw0.referral_id from referral_rewards rw0 where rw0.tenant_id = ${T} and rw0.id = ${rewardId}) for update of rr`.execute(trx);
    const w = (await sql<any>`select ${RW_COLS}, rr.branch_id as ref_branch, rr.state as ref_state from referral_rewards rw join referral_redemptions rr on rr.id = rw.referral_id and rr.tenant_id = rw.tenant_id
      where rw.tenant_id = ${T} and rw.id = ${rewardId} for update of rw`.execute(trx)).rows[0];
    if (!w) throw new ReferralProgramError('Reward not found.', 'REFERRAL_REWARD_NOT_FOUND', 404);
    if (w.state === 'ISSUED') return { rewardId, state: 'ISSUED', duplicate: true };
    if (!['APPROVED', 'FAILED'].includes(w.state)) throw new ReferralProgramError('Only an approved reward can be issued.', 'REFERRAL_REWARD_STATE_CONFLICT', 409, { state: w.state });
    const a = isUuid(actor) ? actor : null;
    const key = `issue:${rewardId}`;
    if (w.reward_type === 'cash_payout') {
      await this.moveReward(trx, T, rewardId, 'BLOCKED_EXTERNAL', sql`issue_error = ${'No payout provider is approved for referral cash payouts. Nothing was paid.'}, updated_by = ${a}`);
      await this.event(trx, T, String(w.referral_id), rewardId, 'payout_blocked', w.state, 'BLOCKED_EXTERNAL', a, 'No approved payout provider', null, `blocked:${rewardId}`);
      return { rewardId, state: 'BLOCKED_EXTERNAL', duplicate: false };
    }
    if (await this.rewardsSwitchOff(T, w.ref_branch, trx)) {
      await this.event(trx, T, String(w.referral_id), rewardId, 'issue_held', w.state, w.state, a, 'Referral rewards are turned off in Settings → Loyalty & Memberships.', null, null);
      return { rewardId, state: w.state, duplicate: false, held: 'rewards_off' };
    }
    const le = await applyLoyaltyEntry(trx, { tenantId: T, branchId: w.ref_branch, customerId: String(w.recipient_customer_id), entryType: 'earn', delta: N(w.points),
      sourceTable: 'referral_rewards', sourceId: rewardId, reason: 'Referral reward', actorUserId: a, legacyType: 'earn_referral', legacySource: 'referral' });
    await this.moveReward(trx, T, rewardId, 'ISSUED', sql`issued_at = now(), issued_by = ${a}, issuance_key = ${key}, ledger_entry_id = ${le.ledgerId}, issue_error = null, updated_by = ${a}`);
    if (w.ref_state === 'APPROVED') await this.moveReferral(trx, T, String(w.referral_id), 'REWARD_ISSUED');
    await this.event(trx, T, String(w.referral_id), rewardId, 'reward_issued', w.state, 'ISSUED', a, null, `loyalty_ledger:${le.ledgerId}`, key, { points: N(w.points), source, duplicateLedger: le.duplicate });
    return { rewardId, state: 'ISSUED', duplicate: false, ledgerEntryId: le.ledgerId };
  }
  async issue(ctx: RefCtx, rewardId: string, source: string) {
    const T = ctx.tenantId;
    try {
      const out = await this.db.transaction().execute((trx) => this.issueTx(trx, T, ctx.userId, rewardId, source));
      if (out.held === 'rewards_off' && source !== 'auto' && source !== 'approval') throw new ReferralProgramError('Referral rewards are turned off in Settings → Loyalty & Memberships. Turn them on, then retry.', 'REFERRAL_REWARDS_OFF', 409);
      return out;
    } catch (e) {
      if (e instanceof ReferralProgramError) throw e;
      // a provider / ledger failure: keep the reward Failed with the reason; a retry reuses the same issuance key
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      await this.db.transaction().execute(async (trx) => {
        await sql`select rr.id from referral_redemptions rr where rr.tenant_id = ${T} and rr.id = (select rw0.referral_id from referral_rewards rw0 where rw0.tenant_id = ${T} and rw0.id = ${rewardId}) for update of rr`.execute(trx);   // same lock order
        const w = (await sql<any>`select referral_id, state from referral_rewards where tenant_id = ${T} and id = ${rewardId} for update`.execute(trx)).rows[0];
        if (w && w.state === 'APPROVED') {
          await this.moveReward(trx, T, rewardId, 'FAILED', sql`issue_error = ${msg}`);
          await this.event(trx, T, String(w.referral_id), rewardId, 'issue_failed', 'APPROVED', 'FAILED', ctx.userId, msg, null, null);
        }
      });
      throw new ReferralProgramError('The reward could not be issued. Nothing was posted; it is kept as Failed and can be retried safely.', 'REFERRAL_ISSUE_FAILED', 503, { error: msg });
    }
  }

  // ── manager review (guide §10): approve / reject / investigate — guarded, audited, self-approval refused when configured ─
  async review(ctx: RefCtx, id: string, b: { action?: unknown; reason?: unknown; expectedVersion?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const T = ctx.tenantId;
    const action = pick(RP_REVIEW_ACTIONS, b.action);
    if (!action) throw new ReferralProgramError('Choose Approve, Reject or Request investigation.', 'REFERRAL_REVIEW_INVALID');
    const reason = str(b.reason, 500) ?? null;
    if ((action === 'reject' || action === 'investigate') && (!reason || reason.length < 5)) throw new ReferralProgramError('Give a reason (at least 5 characters).', 'REFERRAL_REASON_REQUIRED');
    if (!isUuid(id)) throw new ReferralProgramError('Referral not found.', 'REFERRAL_NOT_FOUND', 404);
    const res = await this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`select ${REF_COLS} from referral_redemptions where tenant_id = ${T} and id = ${id} for update`.execute(trx)).rows[0];
      if (!r) throw new ReferralProgramError('Referral not found.', 'REFERRAL_NOT_FOUND', 404);
      if (b.expectedVersion != null && N(b.expectedVersion) !== N(r.row_version)) throw new ReferralProgramError('Someone else changed this referral. Reload and try again.', 'VERSION_CONFLICT', 409, { currentVersion: N(r.row_version) });
      const w = (await sql<any>`select ${RW_COLS} from referral_rewards rw where rw.tenant_id = ${T} and rw.referral_id = ${id} for update`.execute(trx)).rows[0];
      const policy = await this.settings(ctx, trx);
      if (action === 'approve') {
        if (!w) throw new ReferralProgramError(r.qualifying_ticket_id ? 'No reward is set for this salon yet — set a reward in Policy first.' : 'This referral has not qualified yet.', 'REFERRAL_NOT_READY', 409);
        if (w.state !== 'PENDING_APPROVAL') throw new ReferralProgramError('This reward is not waiting for approval.', 'REFERRAL_REWARD_STATE_CONFLICT', 409, { state: w.state });
        if (policy.separationOfDuties && actorId(ctx) && String(r.recorded_by ?? '') === actorId(ctx)) throw new ReferralProgramError('The person who recorded this referral cannot approve its reward (separation of duties).', 'REFERRAL_SELF_APPROVAL', 403);
        await this.moveReward(trx, T, String(w.id), 'APPROVED', sql`decided_at = now(), decided_by = ${actorId(ctx)}, decision_reason = ${reason}, updated_by = ${actorId(ctx)}`);
        await this.moveReferral(trx, T, id, 'APPROVED', sql`decided_at = now(), updated_by = ${actorId(ctx)}`);
        await this.event(trx, T, id, String(w.id), 'approved', r.state, 'APPROVED', ctx.userId, reason, null, null);
      } else if (action === 'reject') {
        if (w && ['PENDING_APPROVAL', 'APPROVED', 'FAILED', 'BLOCKED_EXTERNAL'].includes(w.state)) await this.moveReward(trx, T, String(w.id), 'REJECTED', sql`decided_at = now(), decided_by = ${actorId(ctx)}, decision_reason = ${reason}`);
        else if (w && w.state === 'ISSUED') throw new ReferralProgramError('This reward was already issued — reverse it instead.', 'REFERRAL_REWARD_STATE_CONFLICT', 409);
        await this.moveReferral(trx, T, id, 'REJECTED', sql`decided_at = now(), review_reason = ${reason}, updated_by = ${actorId(ctx)}`);
        await this.event(trx, T, id, w ? String(w.id) : null, 'rejected', r.state, 'REJECTED', ctx.userId, reason, null, null);
      } else if (action === 'investigate') {
        await this.moveReferral(trx, T, id, 'UNDER_REVIEW', sql`review_reason = ${reason}, updated_by = ${actorId(ctx)}`);
        await this.event(trx, T, id, w ? String(w.id) : null, 'investigation_requested', r.state, 'UNDER_REVIEW', ctx.userId, reason, null, null);
      } else {
        if (r.state !== 'UNDER_REVIEW') throw new ReferralProgramError('This referral is not under review.', 'REFERRAL_STATE_CONFLICT', 409);
        const to = !r.qualifying_ticket_id ? 'PENDING_QUALIFICATION' : w && w.state === 'PENDING_APPROVAL' ? 'REWARD_PENDING_APPROVAL' : w && w.state === 'APPROVED' ? 'APPROVED' : 'QUALIFIED';
        await this.moveReferral(trx, T, id, to, sql`review_reason = ${reason ?? 'Review cleared'}, updated_by = ${actorId(ctx)}`);
        await this.event(trx, T, id, w ? String(w.id) : null, 'review_cleared', 'UNDER_REVIEW', to, ctx.userId, reason, null, null);
        // a qualified referral whose reward was never created (no policy at the time, or a risk hold) gets one now
        if (to === 'QUALIFIED' && !w && policy.configured && policy.enabled) {
          const rw = (await sql<any>`insert into referral_rewards (tenant_id, referral_id, recipient_customer_id, reward_type, points, amount_cents, policy_version, state)
            values (${T}, ${id}, ${r.referrer_customer_id}, ${policy.rewardType}, ${policy.rewardType === 'loyalty_points' ? policy.rewardPoints : null}, ${policy.rewardType === 'cash_payout' ? policy.rewardCents : null}, ${policy.version}, 'PENDING_APPROVAL')
            on conflict (tenant_id, referral_id) do nothing returning id`.execute(trx)).rows[0];
          if (rw) { await this.moveReferral(trx, T, id, 'REWARD_PENDING_APPROVAL'); await this.event(trx, T, id, String(rw.id), 'reward_requested', null, 'PENDING_APPROVAL', ctx.userId, 'Created when the review was cleared', null, `reward-req:${id}`); }
        }
      }
      await audit(trx, { referralId: id, action, reason, from: r.state, rewardId: w ? String(w.id) : null });
      return { rewardId: w ? String(w.id) : null };
    });
    if (action === 'approve' && res.rewardId) { try { await this.issue(ctx, res.rewardId, 'approval'); } catch (e) { if (!(e instanceof ReferralProgramError) || e.code !== 'REFERRAL_ISSUE_FAILED') throw e; } }
    return this.detail(ctx, id, { full: false });
  }
  /** a reward still waiting after a provider / ledger failure (or a turned-off switch) — retried with the SAME issuance key */
  async retryIssue(ctx: RefCtx, rewardId: string) {
    if (!isUuid(rewardId)) throw new ReferralProgramError('Reward not found.', 'REFERRAL_REWARD_NOT_FOUND', 404);
    return this.issue(ctx, rewardId, 'manual_retry');
  }

  // ── reversal (guide §10, §16): audited, never deleting a posting ───────────────────────────────────────────────────
  async reverseReward(trx: Kysely<any>, T: string, rewardId: string, reason: string, actor: unknown, idem: string) {
    const w = (await sql<any>`select ${RW_COLS}, rr.state as ref_state from referral_rewards rw join referral_redemptions rr on rr.id = rw.referral_id and rr.tenant_id = rw.tenant_id
      where rw.tenant_id = ${T} and rw.id = ${rewardId} for update of rw`.execute(trx)).rows[0];
    if (!w || w.state !== 'ISSUED') return { reversed: false, state: w?.state ?? null };
    let shortfall = 0; let ledgerId: string | null = null;
    if (w.reward_type === 'loyalty_points') {
      const le = await applyLoyaltyEntry(trx, { tenantId: T, customerId: String(w.recipient_customer_id), entryType: 'reverse', delta: -N(w.points), clampToBalance: true,
        sourceTable: 'referral_rewards', sourceId: rewardId, reason, actorUserId: isUuid(actor) ? actor : null, legacyType: 'reverse_referral', legacySource: 'referral' });
      ledgerId = le.ledgerId; shortfall = N(w.points) + le.delta;   // points already spent stay spent; the rest is shown for review
    }
    await this.moveReward(trx, T, rewardId, 'REVERSED', sql`reversed_at = now(), reversed_by = ${isUuid(actor) ? actor : null}, reversal_reason = ${reason}, reversal_ledger_id = ${ledgerId}, reversal_shortfall = ${shortfall}`);
    if (w.ref_state === 'REWARD_ISSUED') await this.moveReferral(trx, T, String(w.referral_id), 'REVERSED', sql`review_reason = ${reason}`);
    await this.event(trx, T, String(w.referral_id), rewardId, 'reward_reversed', 'ISSUED', 'REVERSED', actor, reason, ledgerId ? `loyalty_ledger:${ledgerId}` : null, idem, { shortfallPoints: shortfall });
    return { reversed: true, shortfall };
  }
  async reverse(ctx: RefCtx, rewardId: string, b: { reason?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const reason = str(b.reason, 500);
    if (!reason || reason.length < 5) throw new ReferralProgramError('Give a reason (at least 5 characters).', 'REFERRAL_REASON_REQUIRED');
    if (!isUuid(rewardId)) throw new ReferralProgramError('Reward not found.', 'REFERRAL_REWARD_NOT_FOUND', 404);
    return this.db.transaction().execute(async (trx) => {
      const out = await this.reverseReward(trx, ctx.tenantId, rewardId, reason, ctx.userId, `reverse:${rewardId}`);
      if (!out.reversed) throw new ReferralProgramError('Only an issued reward can be reversed.', 'REFERRAL_REWARD_STATE_CONFLICT', 409, { state: out.state });
      await audit(trx, { rewardId, reason, shortfall: out.shortfall });
      return out;
    });
  }
  /** Checkout refund (payment.refunded): the qualifying ticket's net paid falls below the rule → reverse or send to review, once per refund */
  async handleRefund(T: string, ticketId: string, refundId: string, outer: Kysely<any>) {
    const r = (await sql<any>`select ${REF_COLS} from referral_redemptions where tenant_id = ${T} and qualifying_ticket_id = ${ticketId} for update`.execute(outer)).rows[0];
    if (!r) return { outcome: 'no_referral' };
    const seen = (await sql<any>`select 1 from referral_events where tenant_id = ${T} and idempotency_key = ${'refund:' + refundId}`.execute(outer)).rows.length > 0;
    if (seen) return { outcome: 'duplicate' };
    const policy = await this.settings({ tenantId: T }, outer);
    const t = (await sql<any>`select total_cents from tickets where tenant_id = ${T} and id = ${ticketId}`.execute(outer)).rows[0];
    const refunded = N((await sql<any>`select coalesce(sum(rf.amount_cents), 0)::bigint as v from payment_refunds rf join payments p on p.id = rf.payment_id and p.tenant_id = rf.tenant_id
      where rf.tenant_id = ${T} and p.ticket_id = ${ticketId} and rf.status = 'refunded'`.execute(outer)).rows[0]?.v);
    const net = N(t?.total_cents) - refunded;
    const stillQualifies = net > 0 && net >= policy.minQualifyingSpendCents;
    if (stillQualifies) { await this.event(outer, T, String(r.id), null, 'refund_noted', r.state, r.state, null, `Partial refund; $${(net / 100).toFixed(2)} still paid — still qualifies.`, `refund:${refundId}`, `refund:${refundId}`); return { outcome: 'still_qualifies' }; }
    const w = (await sql<any>`select id, state from referral_rewards where tenant_id = ${T} and referral_id = ${r.id} for update`.execute(outer)).rows[0];
    const why = 'The qualifying visit was refunded.';
    if (w && w.state === 'ISSUED') { await this.reverseReward(outer, T, String(w.id), why, null, `refund:${refundId}`); return { outcome: 'reversed' }; }
    if (w && ['PENDING_APPROVAL', 'APPROVED', 'FAILED', 'BLOCKED_EXTERNAL'].includes(w.state)) await this.moveReward(outer, T, String(w.id), 'REJECTED', sql`decided_at = now(), decision_reason = ${why}`);
    if (r.state !== 'UNDER_REVIEW' && ['QUALIFIED', 'REWARD_PENDING_APPROVAL', 'APPROVED'].includes(r.state)) await this.moveReferral(outer, T, String(r.id), 'UNDER_REVIEW', sql`review_reason = ${why}`);
    await this.event(outer, T, String(r.id), w ? String(w.id) : null, 'refund_review', r.state, 'UNDER_REVIEW', null, why, `refund:${refundId}`, `refund:${refundId}`, { netPaidCents: net });
    return { outcome: 'under_review' };
  }

  // ── lists (guide §06, §07) ─────────────────────────────────────────────────────────────────────────────────────────
  private branchW(ctx: RefCtx) { return isUuid(ctx.branchId) ? sql`(rr.branch_id = ${ctx.branchId} or rr.branch_id is null)` : sql`true`; }
  async list(ctx: RefCtx, f: RpListFilters, opts: { approvals?: boolean } = {}) {
    const T = ctx.tenantId;
    const { tz, today } = await this.tz(ctx);
    const tab = pick(RP_TABS, f.tab) ?? 'all';
    const states = opts.approvals ? ['REWARD_PENDING_APPROVAL', 'UNDER_REVIEW'] : TAB_STATES[tab];
    const q = str(f.q, 100);
    const basis = pick(RP_BASES, f.basis) ?? 'recorded';
    const rg = this.range(today, f);
    const sort = opts.approvals ? 'oldest' : pick(RP_SORTS, f.sort) ?? 'newest';
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    const rewardType = pick(RP_REWARD_TYPES, f.rewardType);
    const basisCol = basis === 'qualified' ? sql`rr.qualified_at` : basis === 'decided' ? sql`rr.decided_at` : basis === 'issued' ? sql`rw.issued_at` : basis === 'transaction' ? sql`qt.paid_at` : sql`rr.redeemed_at`;
    const qd = q ? digits(q) : '';
    const qw = q ? sql`(rr.code ilike ${'%' + q + '%'} or rc.full_name ilike ${'%' + q + '%'} or dc.full_name ilike ${'%' + q + '%'} or rc.email ilike ${'%' + q + '%'} or dc.email ilike ${'%' + q + '%'}
        or rr.id::text = ${q} or rc.id::text = ${q} or dc.id::text = ${q} or rw.id::text = ${q} or qt.id::text = ${q} or coalesce(qt.ticket_number::text, '') = ${q}
        or (${qd.length >= 4} and (regexp_replace(coalesce(rc.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + qd + '%'} or regexp_replace(coalesce(dc.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + qd + '%'}))
        or exists (select 1 from pos_tech_appointments ap where ap.tenant_id = rr.tenant_id and ap.customer_id = rr.referred_customer_id and ap.id::text = ${q}))` : sql`true`;
    const where = sql`rr.tenant_id = ${T} and ${this.branchW(ctx)} and ${states ? sql`rr.state = any(${states}::text[])` : sql`true`} and ${qw}
      and ${rewardType ? sql`rw.reward_type = ${rewardType}` : sql`true`}
      and ${rg ? sql`${basisCol} >= (${rg.from}::date)::timestamp at time zone ${tz} and ${basisCol} < ((${rg.to}::date + 1))::timestamp at time zone ${tz}` : sql`true`}`;
    const order = sort === 'oldest' ? sql`coalesce(rw.requested_at, rr.redeemed_at) asc, rr.id asc` : sort === 'name_asc' ? sql`lower(coalesce(dc.full_name, '')) asc, rr.id asc` : sort === 'name_desc' ? sql`lower(coalesce(dc.full_name, '')) desc, rr.id desc` : sql`rr.redeemed_at desc, rr.id desc`;
    const from = sql`from referral_redemptions rr left join customers rc on rc.id = rr.referrer_customer_id and rc.tenant_id = rr.tenant_id
      left join customers dc on dc.id = rr.referred_customer_id and dc.tenant_id = rr.tenant_id
      left join referral_rewards rw on rw.referral_id = rr.id and rw.tenant_id = rr.tenant_id
      left join tickets qt on qt.id = rr.qualifying_ticket_id and qt.tenant_id = rr.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select rr.id, rr.code, rr.state, rr.redeemed_at, rr.qualified_at, rr.decided_at, rr.row_version, rr.review_reason, rr.fraud_flags, rr.legacy_marked_reward_cents,
        rr.referrer_customer_id, rc.full_name as referrer_name, rc.normalized_phone as rp, rr.referred_customer_id, dc.full_name as referred_name, dc.normalized_phone as dp,
        rw.id as reward_id, rw.state as reward_state, rw.reward_type, rw.points, rw.amount_cents, rw.requested_at, rw.issued_at, qt.ticket_number, qt.paid_at, qt.total_cents,
        ${q ? sql`(rc.full_name ilike ${'%' + q + '%'} or rc.id::text = ${q} or (${qd.length >= 4} and regexp_replace(coalesce(rc.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + qd + '%'}))` : sql`false`} as match_referrer,
        ${q ? sql`(dc.full_name ilike ${'%' + q + '%'} or dc.id::text = ${q} or (${qd.length >= 4} and regexp_replace(coalesce(dc.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + qd + '%'}))` : sql`false`} as match_referred
      ${from} where ${where} order by ${order} limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => this.row(r)), totalItems: total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)),
      tab: opts.approvals ? 'approvals' : tab, sort, basis, range: rg, timezone: tz, today,
    };
  }
  private row(r: any) {
    const flags = (typeof r.fraud_flags === 'string' ? JSON.parse(r.fraud_flags) : r.fraud_flags) ?? [];
    return {
      id: String(r.id), code: String(r.code).toUpperCase(), state: r.state, recordedAt: iso(r.redeemed_at), qualifiedAt: iso(r.qualified_at), decidedAt: iso(r.decided_at), version: N(r.row_version),
      reviewReason: r.review_reason ?? null, flags, legacyMarkedRewardCents: r.legacy_marked_reward_cents == null ? null : N(r.legacy_marked_reward_cents),
      referrer: { customerId: String(r.referrer_customer_id), name: r.referrer_name ?? null, phone: maskPhone(r.rp) },
      referred: r.referred_customer_id ? { customerId: String(r.referred_customer_id), name: r.referred_name ?? null, phone: maskPhone(r.dp) } : null,
      reward: r.reward_id ? { id: String(r.reward_id), state: r.reward_state, type: r.reward_type, points: r.points == null ? null : N(r.points), amountCents: r.amount_cents == null ? null : N(r.amount_cents), requestedAt: iso(r.requested_at), issuedAt: iso(r.issued_at) } : null,
      ticket: r.ticket_number != null || r.paid_at ? { number: r.ticket_number == null ? null : String(r.ticket_number), paidAt: iso(r.paid_at), totalCents: N(r.total_cents) } : null,
      matchedAs: r.match_referrer && r.match_referred ? 'both' : r.match_referrer ? 'referrer' : r.match_referred ? 'referred' : null,
    };
  }

  // ── KPIs (guide §15): every number reconciles to source rows; cash paid only with settlement evidence ─────────────
  async summary(ctx: RefCtx) {
    const T = ctx.tenantId;
    const s = (await sql<any>`select
        (select count(*)::int from customer_referrals where tenant_id = ${T}) as codes,
        (select count(*)::int from customer_referrals where tenant_id = ${T} and status = 'active' and (expires_at is null or expires_at > now())) as codes_active,
        count(*)::int as total,
        count(*) filter (where rr.state = any(${OPEN_STATES}::text[]))::int as waiting,
        count(*) filter (where rr.qualifying_ticket_id is not null and rr.state not in ('REVERSED', 'REJECTED'))::int as qualified,
        count(*) filter (where rr.state = 'UNDER_REVIEW')::int as under_review,
        count(*) filter (where rr.state = 'REWARD_PENDING_APPROVAL')::int as pending_approval,
        count(*) filter (where rr.legacy_marked_reward_cents is not null)::int as legacy_marked,
        coalesce(sum(rr.legacy_marked_reward_cents), 0)::bigint as legacy_marked_cents
      from referral_redemptions rr where rr.tenant_id = ${T} and ${this.branchW(ctx)}`.execute(this.db)).rows[0];
    const w = (await sql<any>`select count(*) filter (where rw.state = any(${PENDING_REWARD_STATES}::text[]))::int as pending_rewards,
        count(*) filter (where rw.state = 'ISSUED')::int as issued, coalesce(sum(rw.points) filter (where rw.state = 'ISSUED' and rw.reward_type = 'loyalty_points'), 0)::bigint as issued_points,
        count(*) filter (where rw.state = 'BLOCKED_EXTERNAL')::int as blocked, count(*) filter (where rw.state = 'FAILED')::int as failed, count(*) filter (where rw.state = 'REVERSED')::int as reversed
      from referral_rewards rw join referral_redemptions rr on rr.id = rw.referral_id and rr.tenant_id = rw.tenant_id where rw.tenant_id = ${T} and ${this.branchW(ctx)}`.execute(this.db)).rows[0];
    const rev = (await sql<any>`select coalesce(sum(t.total_cents - coalesce((select sum(rf.amount_cents) from payment_refunds rf join payments p on p.id = rf.payment_id and p.tenant_id = rf.tenant_id
        where rf.tenant_id = t.tenant_id and p.ticket_id = t.id and rf.status = 'refunded'), 0)), 0)::bigint as v
      from referral_redemptions rr join tickets t on t.id = rr.qualifying_ticket_id and t.tenant_id = rr.tenant_id where rr.tenant_id = ${T} and ${this.branchW(ctx)} and rr.state not in ('REVERSED', 'REJECTED')`.execute(this.db)).rows[0];
    const policy = await this.settings(ctx);
    return {
      codes: N(s.codes), codesActive: N(s.codes_active), totalReferrals: N(s.total), waitingForVisit: N(s.waiting), qualified: N(s.qualified), underReview: N(s.under_review),
      pendingApproval: N(s.pending_approval),
      /** "Pending Reward" (guide §15): rewards requested / approved but NOT issued (Pending Approval + Approved + Failed) */
      pendingReward: N(w.pending_rewards), issuedRewards: N(w.issued), issuedPoints: N(w.issued_points), blockedPayouts: N(w.blocked), failedIssuance: N(w.failed), reversedRewards: N(w.reversed),
      /** "Rewards Paid" is CASH with settlement evidence only — there is no approved payout provider, so nothing is paid */
      cashPaidCents: 0, cashPaidEvidence: 'none' as const,
      associatedRevenueCents: N(rev.v), associatedRevenueNote: 'Collected on the qualifying visits (refunds subtracted). Associated, not proven to be caused by the referral.',
      legacyMarked: { count: N(s.legacy_marked), cents: N(s.legacy_marked_cents), note: 'Typed by hand before Oct 31 2026 with no issuance record; not counted as issued or paid.' },
      policy, lastUpdated: new Date().toISOString(),
    };
  }

  // ── detail overlay (guide §09) ──────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: RefCtx, id: string, opts: { full: boolean; showContact?: boolean } = { full: true }) {
    const T = ctx.tenantId;
    if (!isUuid(id)) throw new ReferralProgramError('Referral not found.', 'REFERRAL_NOT_FOUND', 404);
    const r = (await sql<any>`select rr.id, rr.code, rr.code_id, rr.state, rr.branch_id, rr.policy_version, rr.referrer_customer_id, rr.referred_customer_id, rr.qualifying_ticket_id, rr.qualified_at, rr.decided_at,
        rr.review_reason, rr.fraud_flags, rr.legacy_marked_reward_cents, rr.row_version, rr.redeemed_at, rc.full_name as referrer_name, rc.normalized_phone as rp, rc.email as re, rc.created_at as rcreated,
        dc.full_name as referred_name, dc.normalized_phone as dp, dc.email as de, dc.created_at as dcreated, dc.marketing_sms_opt_in as d_sms, dc.marketing_email_opt_in as d_email, b.name as branch_name
      from referral_redemptions rr left join customers rc on rc.id = rr.referrer_customer_id and rc.tenant_id = rr.tenant_id
      left join customers dc on dc.id = rr.referred_customer_id and dc.tenant_id = rr.tenant_id left join branches b on b.id = rr.branch_id and b.tenant_id = rr.tenant_id
      where rr.tenant_id = ${T} and rr.id = ${id} and ${this.branchW(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw new ReferralProgramError('Referral not found.', 'REFERRAL_NOT_FOUND', 404);
    const show = !!opts.showContact;
    const base = this.row({ ...r, reward_id: null, match_referrer: false, match_referred: false });
    if (!opts.full) {
      const w = (await sql<any>`select id, state, reward_type, points, amount_cents, requested_at, issued_at from referral_rewards where tenant_id = ${T} and referral_id = ${id}`.execute(this.db)).rows[0];
      return { ...base, reward: w ? { id: String(w.id), state: w.state, type: w.reward_type, points: w.points == null ? null : N(w.points), amountCents: w.amount_cents == null ? null : N(w.amount_cents), requestedAt: iso(w.requested_at), issuedAt: iso(w.issued_at) } : null };
    }
    const reward = (await sql<any>`select ${RW_COLS}, le.delta as le_delta, le.balance_after as le_balance, le.created_at as le_at, rv.delta as rv_delta from referral_rewards rw
      left join loyalty_ledger le on le.id = rw.ledger_entry_id and le.tenant_id = rw.tenant_id left join loyalty_ledger rv on rv.id = rw.reversal_ledger_id and rv.tenant_id = rw.tenant_id
      where rw.tenant_id = ${T} and rw.referral_id = ${id}`.execute(this.db)).rows[0];
    const ticket = r.qualifying_ticket_id ? (await sql<any>`select t.id, t.ticket_number, t.status, t.total_cents, t.paid_at, t.removed_at,
        (select coalesce(json_agg(json_build_object('method', p.method, 'amountCents', p.amount_cents, 'status', p.status, 'cardLast4', p.card_last4) order by p.created_at), '[]'::json) from payments p where p.tenant_id = t.tenant_id and p.ticket_id = t.id) as payments,
        (select coalesce(json_agg(json_build_object('amountCents', rf.amount_cents, 'status', rf.status, 'at', rf.created_at) order by rf.created_at), '[]'::json) from payment_refunds rf join payments p on p.id = rf.payment_id and p.tenant_id = rf.tenant_id where rf.tenant_id = t.tenant_id and p.ticket_id = t.id) as refunds
      from tickets t where t.tenant_id = ${T} and t.id = ${r.qualifying_ticket_id}`.execute(this.db)).rows[0] : null;
    const visits = r.referred_customer_id ? (await sql<any>`select count(*)::int as n, min(coalesce(paid_at, created_at)) as first_at from tickets where tenant_id = ${T} and customer_id = ${r.referred_customer_id}
      and removed_at is null and status = any(${VISIT}::text[])`.execute(this.db)).rows[0] : null;
    const appt = r.referred_customer_id ? (await sql<any>`select id, status, to_char(appt_date, 'YYYY-MM-DD') as appt_date, left(start_time::text, 5) as start_time from pos_tech_appointments where tenant_id = ${T} and customer_id = ${r.referred_customer_id} order by appt_date desc, start_time desc limit 3`.execute(this.db)).rows : [];
    const prior = (await sql<any>`select count(*)::int as referrals, count(*) filter (where state = 'REWARD_ISSUED')::int as rewarded from referral_redemptions where tenant_id = ${T} and referrer_customer_id = ${r.referrer_customer_id}`.execute(this.db)).rows[0];
    const events = (await sql<any>`select e.event_type, e.from_state, e.to_state, e.reason, e.source_ref, e.idempotency_key, e.metadata, e.created_at, u.full_name as actor_name from referral_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.referral_id = ${id} order by e.created_at asc, e.id asc`.execute(this.db)).rows;
    const contact = (p: unknown, e: unknown) => (show ? { phone: p ?? null, email: e ?? null } : { phone: maskPhone(p), email: maskEmail(e) });
    return {
      ...base,
      overview: { id, code: String(r.code).toUpperCase(), codeId: r.code_id ?? null, branch: r.branch_name ?? null, state: r.state, recordedAt: iso(r.redeemed_at), policyVersion: r.policy_version == null ? null : N(r.policy_version) },
      referrerProfile: { customerId: String(r.referrer_customer_id), name: r.referrer_name ?? null, ...contact(r.rp, r.re), since: iso(r.rcreated), priorReferrals: N(prior?.referrals), priorRewarded: N(prior?.rewarded) },
      referredProfile: r.referred_customer_id ? { customerId: String(r.referred_customer_id), name: r.referred_name ?? null, ...contact(r.dp, r.de), since: iso(r.dcreated), completedVisits: N(visits?.n),
        firstVisitAt: iso(visits?.first_at), consent: { sms: !!r.d_sms, email: !!r.d_email }, appointments: appt.map((a: any) => ({ id: String(a.id), status: a.status, date: a.appt_date, startTime: a.start_time })) } : null,
      visit: ticket ? { ticketId: String(ticket.id), number: ticket.ticket_number == null ? null : String(ticket.ticket_number), status: ticket.status, totalCents: N(ticket.total_cents), paidAt: iso(ticket.paid_at),
        removed: !!ticket.removed_at, payments: ticket.payments ?? [], refunds: ticket.refunds ?? [] } : null,
      rewardDetail: reward ? { id: String(reward.id), state: reward.state, type: reward.reward_type, points: reward.points == null ? null : N(reward.points), amountCents: reward.amount_cents == null ? null : N(reward.amount_cents),
        policyVersion: N(reward.policy_version), requestedAt: iso(reward.requested_at), decidedAt: iso(reward.decided_at), decisionReason: reward.decision_reason ?? null, issuedAt: iso(reward.issued_at),
        issuanceKey: reward.issuance_key ?? null, ledger: reward.ledger_entry_id ? { entryId: String(reward.ledger_entry_id), delta: N(reward.le_delta), balanceAfter: N(reward.le_balance), at: iso(reward.le_at) } : null,
        issueError: reward.issue_error ?? null, reversedAt: iso(reward.reversed_at), reversalReason: reward.reversal_reason ?? null, reversalDelta: reward.rv_delta == null ? null : N(reward.rv_delta),
        reversalShortfall: reward.reversal_shortfall == null ? null : N(reward.reversal_shortfall),
        disposition: reward.state === 'ISSUED' ? (reward.reward_type === 'loyalty_points' ? 'points_issued' : 'credit_issued') : reward.state === 'BLOCKED_EXTERNAL' ? 'payout_blocked_external' : reward.state.toLowerCase() } : null,
      communication: { items: [], note: 'No referral invitation or confirmation messages are sent by this program; nothing to show.' },
      audit: events.map((e: any) => ({ type: e.event_type, from: e.from_state, to: e.to_state, reason: e.reason, source: e.source_ref, idempotencyKey: e.idempotency_key, at: iso(e.created_at), actor: e.actor_name ?? (e.event_type === 'qualified' || e.event_type.startsWith('refund') ? 'Checkout event' : null),
        meta: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata })),
    };
  }

  // ── codes (guide §06 "Referral codes") ─────────────────────────────────────────────────────────────────────────────
  async codes(ctx: RefCtx, f: { q?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const q = str(f.q, 60); const page = pageOf(f.page), size = sizeOf(f.pageSize);
    const where = sql`cr.tenant_id = ${T} and ${q ? sql`(cr.code ilike ${'%' + q + '%'} or c.full_name ilike ${'%' + q + '%'} or cr.id::text = ${q})` : sql`true`}`;
    const total = N((await sql<any>`select count(*)::int as n from customer_referrals cr left join customers c on c.id = cr.customer_id and c.tenant_id = cr.tenant_id where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select cr.id, cr.code, cr.status, cr.created_at, cr.expires_at, cr.disabled_at, cr.disabled_reason, cr.row_version, cr.customer_id, c.full_name,
        (select count(*)::int from referral_redemptions rr where rr.tenant_id = cr.tenant_id and rr.code_id = cr.id) as uses
      from customer_referrals cr left join customers c on c.id = cr.customer_id and c.tenant_id = cr.tenant_id where ${where} order by cr.created_at desc, cr.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ id: String(r.id), code: String(r.code).toUpperCase(), status: r.status, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), disabledAt: iso(r.disabled_at),
      disabledReason: r.disabled_reason ?? null, version: N(r.row_version), owner: { customerId: String(r.customer_id), name: r.full_name ?? null }, referrals: N(r.uses) })), totalItems: total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
  }
  async setCodeStatus(ctx: RefCtx, id: string, b: { status?: unknown; reason?: unknown; expectedVersion?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const to = b.status === 'disabled' ? 'disabled' : b.status === 'active' ? 'active' : null;
    if (!to) throw new ReferralProgramError('Choose Enable or Disable.', 'REFERRAL_CODE_INVALID');
    const reason = str(b.reason, 300) ?? null;
    if (to === 'disabled' && (!reason || reason.length < 5)) throw new ReferralProgramError('Give a reason (at least 5 characters).', 'REFERRAL_REASON_REQUIRED');
    if (!isUuid(id)) throw new ReferralProgramError('Referral code not found.', 'REFERRAL_CODE_UNKNOWN', 404);
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`update customer_referrals set status = ${to}, disabled_at = ${to === 'disabled' ? sql`now()` : null}, disabled_reason = ${to === 'disabled' ? reason : null},
          row_version = row_version + 1, updated_at = now(), updated_by = ${actorId(ctx)}
        where tenant_id = ${ctx.tenantId} and id = ${id} and row_version = ${Math.trunc(N(b.expectedVersion))} and ${canMoveToSql(REFERRAL_CODE, to)} returning id, code`.execute(trx)).rows[0];
      if (!r) throw new ReferralProgramError('This code changed or is already in that state. Reload and try again.', 'VERSION_CONFLICT', 409);
      await audit(trx, { codeId: id, status: to, reason });
      return { id, status: to };
    });
  }

  // ── Check Referral System (guide §16) — NON-MUTATING ───────────────────────────────────────────────────────────────
  async health(ctx: RefCtx) {
    const T = ctx.tenantId;
    const items: { key: string; status: 'ready' | 'attention_required' | 'failed' | 'pending' | 'unknown'; summary: string; evidence: string; fix: string | null }[] = [];
    const add = (key: string, status: (typeof items)[number]['status'], summary: string, evidence: string, fix: string | null = null) => items.push({ key, status, summary, evidence, fix });
    const errors: Record<string, string> = {};
    const safe = async <X>(fn: () => Promise<X>, key = 'check'): Promise<X | null> => { try { return await fn(); } catch (e) { errors[key] = String((e as Error)?.message ?? e).slice(0, 200); return null; } };
    const codes = await safe(async () => (await sql<any>`select count(*)::int as n, count(*) filter (where status = 'active')::int as active,
      (select count(*)::int from (select lower(code) from customer_referrals where tenant_id = ${T} group by 1 having count(*) > 1) d) as dups,
      (select count(*)::int from customer_referrals cr where cr.tenant_id = ${T} and not exists (select 1 from customers c where c.id = cr.customer_id and c.tenant_id = cr.tenant_id)) as orphans
      from customer_referrals where tenant_id = ${T}`.execute(this.db)).rows[0]);
    if (!codes) add('code_lookup', 'unknown', 'Referral codes could not be read.', 'customer_referrals: query failed', 'Retry; if it persists, check the database.');
    else if (N(codes.dups) || N(codes.orphans)) add('code_lookup', 'failed', `${N(codes.dups)} duplicate code(s), ${N(codes.orphans)} code(s) without a customer.`, 'customer_referrals', 'Disable the bad codes; investigate how they were created.');
    else add('code_lookup', N(codes.n) ? 'ready' : 'pending', N(codes.n) ? `${N(codes.n)} code(s), ${N(codes.active)} active, each with one owner.` : 'No codes yet. Customers get a code in the Customer App (Home → Refer a Friend).', 'customer_referrals: owners and uniqueness checked');
    add('customer_app_sync', codes ? 'ready' : 'unknown', 'The Customer App and the POS read the same code table (customer_referrals).', 'one table, one code per customer (UNIQUE tenant + customer; code UNIQUE)');
    const custOk = await safe(async () => (await sql<any>`select count(*)::int as n from customers where tenant_id = ${T}`.execute(this.db)).rows[0]);
    add('customer_search', custOk ? 'ready' : 'unknown', custOk ? 'Customer search reads this salon\'s customers only.' : 'Customers could not be read.', 'customers: tenant-scoped');
    const dead = await safe(async () => (await sql<any>`select count(*)::int as n, max(last_failed_at) as last from event_dead_letters where tenant_id = ${T} and consumer_name = 'customers.referral_qualification' and status <> 'resolved'`.execute(this.db)).rows[0]);
    if (!dead) add('qualification_jobs', 'unknown', 'The Checkout event queue could not be read.', 'event_dead_letters: query failed', 'Check Events in Super Admin.');
    else add('qualification_jobs', N(dead.n) ? 'failed' : 'ready', N(dead.n) ? `${N(dead.n)} Checkout event(s) failed to qualify a referral.` : 'No failed qualification events.', `event_dead_letters (consumer customers.referral_qualification): ${N(dead.n)} open${dead.last ? `, last ${iso(dead.last)}` : ''}`, N(dead.n) ? 'Retry the failed events from the event operations page.' : null);
    const link = await safe(async () => (await sql<any>`select count(*)::int as n,
        count(*) filter (where t.id is null or t.removed_at is not null or not (t.status = any(${VISIT}::text[])))::int as broken
      from referral_redemptions rr left join tickets t on t.id = rr.qualifying_ticket_id and t.tenant_id = rr.tenant_id where rr.tenant_id = ${T} and rr.qualifying_ticket_id is not null and rr.state not in ('REVERSED', 'REJECTED', 'UNDER_REVIEW')`.execute(this.db)).rows[0]);
    if (!link) add('checkout_linkage', 'unknown', 'Qualifying tickets could not be checked.', 'tickets: query failed');
    else add('checkout_linkage', N(link.broken) ? 'attention_required' : 'ready', N(link.broken) ? `${N(link.broken)} qualified referral(s) point at a ticket that is no longer a paid visit.` : `${N(link.n)} qualified referral(s), each linked to a completed, paid ticket.`, 'referral_redemptions.qualifying_ticket_id → tickets', N(link.broken) ? 'Open each and request an investigation.' : null);
    const pol = await this.settings(ctx);
    const off = await this.rewardsSwitchOff(T, ctx.branchId ?? null);
    if (!pol.enabled) add('reward_policy', 'attention_required', 'The referral program is turned off: no new referrals can be recorded.', `referral_program_settings v${pol.version}`, 'Turn it on in Policy when ready.');
    else if (!pol.configured) add('reward_policy', 'attention_required', 'No reward is set. Referrals can qualify, but no reward is created until the owner chooses one.', 'referral_program_settings: reward_type empty', 'Set the reward type and value in Policy (owner decision).');
    else if (off) add('reward_policy', 'attention_required', 'Settings → Loyalty & Memberships has Referral rewards turned off, so rewards stay approved but are not issued.', 'tenant_settings loyalty-memberships.referralReward = false', 'Turn Referral rewards on, then retry the approved rewards.');
    else add('reward_policy', 'ready', pol.rewardType === 'loyalty_points' ? `${pol.rewardPoints} loyalty points per qualified referral${pol.requiresApproval ? ', manager approval required' : ''}.` : 'Cash payout configured (blocked — no payout provider).', `referral_program_settings v${pol.version}`);
    const led = await safe(async () => (await sql<any>`select count(*)::int as issued,
        count(*) filter (where le.id is null or le.delta <> rw.points or le.source_id <> rw.id)::int as mismatched
      from referral_rewards rw left join loyalty_ledger le on le.id = rw.ledger_entry_id and le.tenant_id = rw.tenant_id where rw.tenant_id = ${T} and rw.state in ('ISSUED', 'REVERSED') and rw.reward_type = 'loyalty_points'`.execute(this.db)).rows[0]);
    if (!led) add('ledger_issuance', 'unknown', 'Issued rewards could not be checked against the loyalty ledger.', 'loyalty_ledger: query failed');
    else add('ledger_issuance', N(led.mismatched) ? 'failed' : 'ready', N(led.mismatched) ? `${N(led.mismatched)} issued reward(s) do not match a loyalty ledger entry.` : `${N(led.issued)} issued reward(s), each matched to exactly one loyalty ledger entry.`, 'referral_rewards.ledger_entry_id → loyalty_ledger (source referral_rewards)', N(led.mismatched) ? 'Investigate before issuing more rewards.' : null);
    const blocked = await safe(async () => (await sql<any>`select count(*)::int as n from referral_rewards where tenant_id = ${T} and state = 'BLOCKED_EXTERNAL'`.execute(this.db)).rows[0]);
    add('payout_provider', pol.rewardType === 'cash_payout' || N(blocked?.n) ? 'attention_required' : 'ready', pol.rewardType === 'cash_payout' || N(blocked?.n) ? `No payout provider is approved; ${N(blocked?.n)} cash reward(s) are blocked and nothing was paid.` : 'Not used — rewards are loyalty points, not cash.', 'no payout adapter in this system', pol.rewardType === 'cash_payout' ? 'BLOCKED_EXTERNAL: an approved payout provider and finance approval are needed.' : null);
    const dup = await safe(async () => (await sql<any>`select (select count(*)::int from (select referred_customer_id from referral_redemptions where tenant_id = ${T} and referred_customer_id is not null group by 1 having count(*) > 1) a) as dup_ref,
      (select count(*)::int from (select referral_id from referral_rewards where tenant_id = ${T} group by 1 having count(*) > 1) b) as dup_rw,
      (select count(*)::int from referral_redemptions where tenant_id = ${T} and referrer_customer_id = referred_customer_id) as self_ref`.execute(this.db)).rows[0]);
    if (!dup) add('idempotency', 'unknown', 'Duplicate checks could not run.', 'query failed');
    else add('idempotency', N(dup.dup_ref) + N(dup.dup_rw) + N(dup.self_ref) ? 'failed' : 'ready', N(dup.dup_ref) + N(dup.dup_rw) + N(dup.self_ref) ? `${N(dup.dup_ref)} customer(s) referred twice, ${N(dup.dup_rw)} referral(s) with two rewards, ${N(dup.self_ref)} self-referral(s).` : 'One referral per customer, one reward per referral, no self-referrals.', 'UNIQUE (tenant, referred) + UNIQUE (tenant, referral_id) + issuance key');
    const failed = await safe(async () => (await sql<any>`select count(*)::int as n, max(updated_at) as last from referral_rewards where tenant_id = ${T} and state = 'FAILED'`.execute(this.db)).rows[0]);
    add('recent_failures', N(failed?.n) ? 'attention_required' : failed ? 'ready' : 'unknown', N(failed?.n) ? `${N(failed.n)} reward(s) failed to issue and can be retried.` : 'No failed issuance.', `referral_rewards state FAILED${failed?.last ? `, last ${iso(failed.last)}` : ''}`, N(failed?.n) ? 'Open each reward and Retry (same issuance key — never a double reward).' : null);
    const aud = await safe(async () => (await sql<any>`select count(*)::int as n from referral_redemptions rr where rr.tenant_id = ${T} and rr.legacy_marked_reward_cents is null
      and not exists (select 1 from referral_events e where e.tenant_id = rr.tenant_id and e.referral_id = rr.id)`.execute(this.db)).rows[0]);
    add('audit_logging', !aud ? 'unknown' : N(aud.n) ? 'attention_required' : 'ready', !aud ? 'Audit trail could not be checked.' : N(aud.n) ? `${N(aud.n)} referral(s) recorded before Oct 31 2026 have no event history.` : 'Every referral has an append-only event history.', 'referral_events (append-only trigger)', N(aud.n) ? 'Older referrals predate the event history; their state is still shown.' : null);
    const worst = items.some((i) => i.status === 'failed') ? 'failed' : items.some((i) => i.status === 'attention_required') ? 'attention_required' : items.some((i) => i.status === 'unknown') ? 'unknown' : items.some((i) => i.status === 'pending') ? 'pending' : 'ready';
    return { overall: worst, items, errors, checkedAt: new Date().toISOString(), mutating: false };
  }

  // ── AI Referral Growth Assistant (guide §11): advice + an UNSENT audience; Campaign Center sends after approval ────────
  async assistantPlan(ctx: RefCtx, b: { goal?: unknown; channel?: unknown; budgetCents?: unknown }) {
    const goal = pick(RP_GOALS, b.goal);
    if (!goal) throw new ReferralProgramError('Choose a goal.', 'REFERRAL_ASSISTANT_INVALID');
    const channel = b.channel === 'email' ? 'email' : 'sms';
    const s = await this.summary(ctx);
    const policy = s.policy;
    const metrics = { referralsRecorded: s.totalReferrals, qualifiedVisits: s.qualified, rewardsIssued: s.issuedRewards, pointsIssued: s.issuedPoints, associatedRevenueCents: s.associatedRevenueCents,
      invitationsSent: null as number | null, invitationsNote: 'Not measured: the program does not send invitations.' };
    if (goal === 'review_performance') return { goal, channel, proposal: null, metrics, audience: null, liability: null, guard: 'Read-only review. Nothing is sent or issued.',
      notes: ['Associated revenue is what qualifying visits paid; it is not proof the referral caused the visit.'] };
    // audience: customers who have visited (Returning) and may receive marketing on the channel — the referrers to invite
    const ids = await this.seg.matchingIds(ctx, RETURNING);
    const v = await this.seg.verdicts(ctx, ids, channel, 'general');
    const counts: Record<string, number> = {}; let eligible = 0;
    for (const x of v.values()) { if (x.status === 'eligible') eligible++; else counts[x.status] = (counts[x.status] || 0) + 1; }
    const budget = b.budgetCents == null ? null : Math.max(0, Math.trunc(N(b.budgetCents)));
    const message = goal === 'low_demand_weekdays'
      ? '{salon_name}: bring a friend on a weekday! When they finish their first visit, you earn a thank-you reward. {offer} Reply STOP to opt out.'
      : '{salon_name}: love your nails? Share your referral code from the app with a friend. When they complete their first visit, you earn a thank-you reward. Reply STOP to opt out.';
    const liability = policy.configured ? (policy.rewardType === 'loyalty_points' ? { unit: 'points', perReferral: policy.rewardPoints, note: 'Points are issued only after a qualified, paid first visit (and approval when required).' }
      : { unit: 'cents', perReferral: policy.rewardCents, note: 'Cash payouts are blocked: no payout provider is approved.' }) : { unit: null, perReferral: null, note: 'No reward is set — the owner must choose one first.' };
    return {
      goal, channel, metrics, budgetCents: budget,
      proposal: { reward: policy.configured ? policy : null, message, schedule: goal === 'low_demand_weekdays' ? 'Send Monday morning for Tuesday–Thursday visits' : 'Send once; no follow-up without approval' },
      audience: { segment: 'returning', selected: ids.length, eligible, excluded: ids.length - eligible, excludedReasons: counts },
      liability, estimate: { kind: 'estimate', note: 'Any lift is an estimate, not an audited result.' },
      guard: 'Preview only — nothing is sent. Save an unsent audience, then create and approve the campaign in Campaign Center.',
    };
  }
  async assistantSave(ctx: RefCtx, b: { goal?: unknown; channel?: unknown; message?: unknown; idempotencyKey?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const plan = await this.assistantPlan(ctx, b);
    if (!plan.audience) throw new ReferralProgramError('This goal has no audience to save.', 'REFERRAL_ASSISTANT_INVALID');
    const key = str(b.idempotencyKey, 120);
    if (!key) throw new ReferralProgramError('Missing idempotency key.', 'IDEMPOTENCY_KEY_REQUIRED');
    const ids = await this.seg.matchingIds(ctx, RETURNING);
    return this.seg.createDraft(ctx, { channel: plan.channel as 'sms' | 'email', purpose: 'general', selectionMode: 'selected', customerIds: ids, filters: RETURNING,
      message: str(b.message, 1000) ?? (plan.proposal?.message ?? null), idempotencyKey: `referral-assistant:${key}` }, (trx, meta) => audit(trx, { ...meta, assistant: 'referral', goal: plan.goal }));
  }
}
