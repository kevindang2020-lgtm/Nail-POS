// retention.repository.ts — Customer Retention mandate (Oct 29 2026): the server side of POS Customers → Customer
// Retention (/tenant/customers/retention). Raw, parameterised SQL; the tenant is the session's, written in every
// statement. Nothing here sends a text — the job handler (retention-sms.worker.ts) does, one recipient at a time.
//
// DEFINITIONS (spec §05; CUSTOMER_RETENTION_DEFINITIONS in the handoff):
//   completed visit   a ticket with status 'closed' or 'paid' (VISIT_TICKET_STATUSES — the Customer Directory's rule);
//                     voids, open tickets and appointments that never became a settled ticket are not visits
//   days away         salon-local calendar days since the last completed visit
//   At Risk 60+       ≥ 1 completed visit AND days away ≥ 60 (INACTIVE_DAYS). Never Visited is NEVER At Risk.
//   Never Visited     no completed visit at all — its own segment (the defect in the Oct 28 photo: 13 "Never" rows were
//                     listed as the 60-day win-back list)
//   Recently Returned a completed visit this month whose previous completed visit was ≥ 60 days before it
//   Contactable       E.164 phone + recorded marketing SMS consent + not opted out (notification_opt_outs) + not texted
//                     by a retention campaign in the last 7 days — evaluated again at confirm and again at send time
//   Lapsed Value      historical settled spend of At Risk customers, net of refunded payments — "historical spend at
//                     risk", never presented as recoverable revenue
//
// Complete Build Guide (Oct 30 2026) additions — every threshold below is the salon's (tenant_retention_settings, defaults
// 60 / 45 / 30) and every read reports the settings version + SEGMENTATION_VERSION + PRIORITY_FORMULA.version:
//   visit time        coalesce(paid_at, created_at) of a settled, not-removed ticket (one ticket = one visit)
//   Approaching Risk  ≥ 1 visit, days away in [approaching, risk)
//   Active            ≥ 1 visit, days away < risk (Approaching is the late part of Active)
//   Returning         a visit in the period that had an earlier visit
//   Recovered         a visit in the period whose previous visit was ≥ risk salon days earlier (spec §13)
//   Smart Priority    only At Risk customers; 0.45·inactivity + 0.30·frequency + 0.25·spend → 0–100 (priorityOf)
//   suppression       upcoming booking (booked … waiting, from today) → sms 'upcoming_booking'; never visited → 'never_visited'
// Order (spec §10): All / Never Visited → profile created DESC, id DESC; At Risk → Priority DESC, longest absence, id;
// Approaching → longest absence; Returning / Recovered → newest visit. Every list states its sort.
import { dateColumnYmd } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { tenantTimeZone } from '@aipowersalon/database';
import { VISIT_TICKET_STATUSES, INACTIVE_DAYS } from '../customers/customer-segments';
import { createHash } from 'node:crypto';

/** `authz` = the request's authorization state (req.ctx.authz): a role template's access scope and the branches it may enter */
export interface RetentionContext { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[]; salonName?: string; authz?: { scope?: string | null; branchIds?: readonly string[] | null } | null }
/** Four-Module Completion Guide CR-02: customers stay tenant-wide; the BRANCH dimension filters visit activity only.
 *  mode 'tenant' = every settled ticket of the salon (tickets of no known branch included and counted separately);
 *  mode 'branches' = tickets of the listed branches only (a branch-confined user's "All authorized branches" is their
 *  union — never the other branches' activity). Unknown-branch tickets are never allocated to a branch. */
export interface BranchScope { mode: 'tenant' | 'branches'; branchIds: string[] | null; selected: string | null; label: 'tenant_wide' | 'branch_activity'; confined: boolean; authorized: { branchId: string; name: string }[] }
export const RETENTION_SEGMENTS = ['all', 'returning', 'approaching', 'at_risk', 'never', 'recovered', 'active', 'at_risk_90', 'at_risk_180', 'returned', 'contactable', 'new_visitors', 'rebooked', 'contacted'] as const;
export type RetentionSegment = (typeof RETENTION_SEGMENTS)[number];
export const RETENTION_SORTS = ['priority', 'created_desc', 'oldest_visit', 'newest_visit', 'name', 'spend', 'visits'] as const;
export type RetentionSort = (typeof RETENTION_SORTS)[number];
export const PERIOD_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
/** what the From / To dates filter the LIST by (spec §09). `none` = the list is not date-filtered (the KPI period still is). */
export const DATE_BASES = ['none', 'last_visit', 'first_visit', 'created', 'campaign', 'recovery'] as const;
export type DateBasis = (typeof DATE_BASES)[number];
export const PRIORITY_BANDS = ['high', 'medium', 'low'] as const;
export const RECENT_CONTACT_DAYS = 7;
export const MAX_SELECTION = 5000;
export const PREVIEW_TTL_MINUTES = 20;
export const SENDS_PER_MINUTE = 60;
export const DEFAULT_RISK_DAYS = INACTIVE_DAYS;        // 60 full salon-local days (spec §05)
export const DEFAULT_APPROACHING_DAYS = 45;
export const DEFAULT_OBSERVATION_DAYS = 30;            // "returned after campaign" window (spec §13)
export const SEGMENTATION_VERSION = 'retention-v2';
/** Smart Win-Back Priority (spec §11) — the recorded formula. 0–100 = 45 inactivity + 30 frequency + 25 spend, each normalised
 *  0–1 with a documented cap. An operational ordering, not a prediction of who will respond. */
export const PRIORITY_FORMULA = { version: 'winback-v1', weights: { inactivity: 0.45, frequency: 0.3, spend: 0.25 }, caps: { days: 365, visits: 12, spendCents: 50000 }, bands: { high: 60, medium: 35 } } as const;
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const UPCOMING = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting'];
const E164 = '^\\+[1-9][0-9]{7,14}$';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const day = (v: unknown) => dateColumnYmd(v);   // DATE columns are selected as text (to_char) — right for node-postgres and PGlite alike
export const maskPhone = (p: string | null | undefined) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
/** j•••@example.com — the local part's first letter only; the domain stays so staff can tell two addresses apart */
/** the ONE marketing-email shape rule (Retention and Customer Segments share it through base()) */
export const EMAIL_RE = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
export const maskEmail = (e: string | null | undefined) => { const m = /^([^@\s]+)@([^@\s]+)$/.exec(String(e ?? '').trim()); return m ? `${m[1].slice(0, 1)}•••@${m[2]}` : null; };
/** Win-Back guide §06 inactivity threshold: 30 / 60 / 90 / 120 or a custom whole number of salon days (1–3650); null = not filtered */
export function inactivityDays(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 3650) throw new RetentionError('Inactivity must be a whole number of days between 1 and 3650.', 'RETENTION_INVALID_FILTER');
  return n;
}
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => ((list as readonly string[]).includes(String(v)) ? (v as T) : undefined);

export class RetentionError extends Error {
  constructor(message: string, readonly code: 'RETENTION_INVALID_SEGMENT' | 'RETENTION_INVALID_PERIOD' | 'RETENTION_INVALID_SETTINGS' | 'SETTINGS_VERSION_CONFLICT' | 'SMS_BODY_INVALID' | 'SMS_NO_RECIPIENTS' | 'SMS_SELECTION_TOO_LARGE' | 'SMS_PREVIEW_NOT_FOUND'
    | 'SMS_PREVIEW_EXPIRED' | 'SMS_AUDIENCE_CHANGED' | 'SMS_NOT_CONFIGURED' | 'SMS_NO_ELIGIBLE' | 'IDEMPOTENCY_KEY_REQUIRED' | 'CAMPAIGN_NOT_FOUND' | 'CUSTOMER_NOT_FOUND'
    | 'RETENTION_INVALID_BRANCH' | 'BRANCH_NOT_AUTHORIZED' | 'SNAPSHOT_INVALID_DATE' | 'SNAPSHOT_INVALID_RANGE' | 'SMS_PRICING_INVALID'
    | 'RETENTION_INVALID_FILTER' | 'WINBACK_GOAL_INVALID' | 'WINBACK_AUDIENCE_EMPTY' | 'WINBACK_HEALTH_RATE_LIMITED' | 'REASON_REQUIRED' | 'CAMPAIGN_NOT_CANCELABLE',
    readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 400, readonly details?: Record<string, unknown>) { super(message); this.name = 'RetentionError'; }
}

/** GSM-7 vs UCS-2 segment estimate (the same rule carriers use; the provider's count is recorded after send). */
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€'.split(''));
export function smsSegments(text: string): { segments: number; encoding: 'GSM-7' | 'UCS-2'; characters: number } {
  const chars = [...text]; const gsm = chars.every((ch) => GSM.has(ch));
  const len = gsm ? chars.reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0) : chars.length;
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return { segments: len <= single ? 1 : Math.ceil(len / multi), encoding: gsm ? 'GSM-7' : 'UCS-2', characters: len };
}
/** The text exactly as it goes out: the salon's name first (sender identification) and STOP language last, each added
 *  only if the staff's text does not already carry it. */
export function composeRetentionSms(body: string, salonName?: string | null): string {
  let t = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (salonName && !t.toLowerCase().includes(salonName.toLowerCase())) t = `${salonName}: ${t}`;
  if (!/\bstop\b/i.test(t)) t = `${t} Reply STOP to opt out.`;
  return t;
}

export interface RetentionSettings { riskDays: number; approachingDays: number; observationWindowDays: number; version: number; isDefault: boolean; updatedAt: string | null; updatedByUserId: string | null }
export interface PeriodInput { preset?: unknown; from?: unknown; to?: unknown; branch?: unknown }
export interface ListFilters extends PeriodInput { segment?: string; q?: string; sort?: string; basis?: string; band?: string; sms?: string; email?: string; future?: string; minDays?: unknown; minVisits?: unknown; page?: unknown; pageSize?: unknown }
/** Win-Back guide §06: the inactivity presets (salon days since the last completed visit); custom = any whole number 1–3650 */
export const INACTIVITY_PRESETS = [30, 60, 90, 120] as const;
/** the resolved window every read uses: salon time zone, the period [start, end) and the effective thresholds */
export interface Win { tz: string; preset: PeriodPreset; from: string; to: string; start: Date; end: Date; today: string; risk: number; approaching: number; observation: number; settingsVersion: number; scope: BranchScope }

export type PriorityBand = (typeof PRIORITY_BANDS)[number];
export interface PriorityInfo { score: number; band: PriorityBand; formulaVersion: string; components: { inactivity: number; frequency: number; spend: number }; topDriver: 'inactivity' | 'frequency' | 'spend'; explanation: string }
export interface RetentionRow {
  customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null;
  phoneStatus: 'ok' | 'missing' | 'invalid'; smsStatus: 'eligible' | 'no_phone' | 'invalid_phone' | 'no_consent' | 'opted_out' | 'recently_contacted' | 'upcoming_booking';
  /** Win-Back guide §06 / §11: marketing email eligibility (consent + not unsubscribed / bounced; the email ledger's suppression list) */
  emailStatus: 'eligible' | 'no_email' | 'invalid_email' | 'no_consent' | 'opted_out'; maskedEmail: string | null;
  /** a marketing message (Retention SMS or Campaign Center, any channel) was submitted in the selected period */ contactedInPeriod: boolean;
  segment: 'never_visited' | 'active' | 'approaching' | 'at_risk'; returningInPeriod: boolean; recoveredInPeriod: boolean;
  lastVisitAt: string | null; firstVisitAt: string | null; daysAway: number | null; visits: number; lifetimeSpendCents: number; createdAt: string | null;
  lastOutreachAt: string | null; lastOutreachStatus: string | null; nextAppointmentDate: string | null; priority: PriorityInfo | null;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** the per-customer score, recomputed from the same inputs the SQL ranks by (reproducible; spec §20) */
export function priorityOf(daysAway: number, visits: number, spendCents: number): PriorityInfo {
  const F = PRIORITY_FORMULA;
  const i = Math.min(daysAway, F.caps.days) / F.caps.days, f = Math.min(visits, F.caps.visits) / F.caps.visits, s = Math.min(Math.max(spendCents, 0), F.caps.spendCents) / F.caps.spendCents;
  const comp = { inactivity: Math.round(100 * F.weights.inactivity * i * 10) / 10, frequency: Math.round(100 * F.weights.frequency * f * 10) / 10, spend: Math.round(100 * F.weights.spend * s * 10) / 10 };
  const score = Math.round(100 * (F.weights.inactivity * i + F.weights.frequency * f + F.weights.spend * s));
  const band: PriorityBand = score >= F.bands.high ? 'high' : score >= F.bands.medium ? 'medium' : 'low';
  const topDriver = (Object.entries(comp).sort((a, b) => b[1] - a[1])[0]![0]) as PriorityInfo['topDriver'];
  const lead = topDriver === 'inactivity' ? 'long absence' : topDriver === 'frequency' ? 'many past visits' : 'high historical spend';
  return { score, band, formulaVersion: F.version, components: comp, topDriver,
    explanation: `Mostly ${lead}: ${daysAway} days since the last completed visit, ${visits} completed visit${visits === 1 ? '' : 's'}, ${money(spendCents)} net historical spend.` };
}

export class RetentionRepository {
  constructor(readonly db: Kysely<any>) {}

  // ── settings (spec §05: tenant-configurable threshold, versioned, audited) ────────────────────────────────────────────
  async settings(ctx: RetentionContext, db: Kysely<any> = this.db): Promise<RetentionSettings> {
    const r = (await sql<any>`select risk_days, approaching_days, observation_window_days, version, updated_at, updated_by_user_id from tenant_retention_settings where tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
    if (!r) return { riskDays: DEFAULT_RISK_DAYS, approachingDays: DEFAULT_APPROACHING_DAYS, observationWindowDays: DEFAULT_OBSERVATION_DAYS, version: 0, isDefault: true, updatedAt: null, updatedByUserId: null };
    return { riskDays: N(r.risk_days), approachingDays: N(r.approaching_days), observationWindowDays: N(r.observation_window_days), version: N(r.version), isDefault: false, updatedAt: iso(r.updated_at), updatedByUserId: r.updated_by_user_id ? String(r.updated_by_user_id) : null };
  }
  /** Validate + write the thresholds under optimistic concurrency; `audit` runs in the SAME transaction (fail-closed). */
  async updateSettings(ctx: RetentionContext, b: { riskDays: unknown; approachingDays: unknown; observationWindowDays?: unknown; expectedVersion: unknown },
    audit: (trx: Kysely<any>, before: RetentionSettings, after: RetentionSettings) => Promise<void>): Promise<RetentionSettings> {
    const risk = Math.trunc(Number(b.riskDays)), appr = Math.trunc(Number(b.approachingDays));
    const obs = b.observationWindowDays == null ? DEFAULT_OBSERVATION_DAYS : Math.trunc(Number(b.observationWindowDays));
    if (!Number.isFinite(risk) || risk < 14 || risk > 730) throw new RetentionError('At Risk must be between 14 and 730 days.', 'RETENTION_INVALID_SETTINGS', 400, { field: 'riskDays' });
    if (!Number.isFinite(appr) || appr < 7 || appr >= risk) throw new RetentionError('Approaching Risk must start at least 7 days and before the At Risk threshold.', 'RETENTION_INVALID_SETTINGS', 400, { field: 'approachingDays' });
    if (!Number.isFinite(obs) || obs < 1 || obs > 180) throw new RetentionError('The campaign observation window must be 1–180 days.', 'RETENTION_INVALID_SETTINGS', 400, { field: 'observationWindowDays' });
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'retention-settings:' + ctx.tenantId}))`.execute(trx);
      const before = await this.settings(ctx, trx);
      if (Math.trunc(Number(b.expectedVersion)) !== before.version) throw new RetentionError('Someone else changed these settings. Reload and try again.', 'SETTINGS_VERSION_CONFLICT', 409, { currentVersion: before.version });
      const user = isUuid(ctx.userId) ? ctx.userId : null;
      await sql`insert into tenant_retention_settings (tenant_id, risk_days, approaching_days, observation_window_days, version, updated_by_user_id, updated_by)
        values (${ctx.tenantId}, ${risk}, ${appr}, ${obs}, 1, ${user}, ${user}::uuid)
        on conflict (tenant_id) do update set risk_days = excluded.risk_days, approaching_days = excluded.approaching_days, observation_window_days = excluded.observation_window_days,
          version = tenant_retention_settings.version + 1, updated_by_user_id = excluded.updated_by_user_id, updated_by = excluded.updated_by, updated_at = now()`.execute(trx);
      const after = await this.settings(ctx, trx);
      // CR-01: every version is kept with the instant it took effect — a past date is read with the definition IN FORCE then
      await sql`insert into tenant_retention_settings_history (tenant_id, version, risk_days, approaching_days, observation_window_days, effective_from, source, changed_by_user_id)
        values (${ctx.tenantId}, ${after.version}, ${after.riskDays}, ${after.approachingDays}, ${after.observationWindowDays}, now(), 'settings_update', ${user})
        on conflict (tenant_id, version) do nothing`.execute(trx);
      await audit(trx, before, after);
      return after;
    });
  }

  /** The salon clock + the reporting window (spec §09: salon-local dates, the whole end date included, From ≤ To). */
  async window(ctx: RetentionContext, p: PeriodInput = {}): Promise<Win> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const st = await this.settings(ctx);
    const scope = await this.branchScope(ctx, p.branch);
    const preset = pick(PERIOD_PRESETS, p.preset) ?? (p.from || p.to ? 'custom' : 'month');
    let from: string | null = null, to: string | null = null;
    if (preset === 'custom') {
      from = typeof p.from === 'string' && DAY.test(p.from) ? p.from : null; to = typeof p.to === 'string' && DAY.test(p.to) ? p.to : null;
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new RetentionError('Choose a From and a To date.', 'RETENTION_INVALID_PERIOD');
      if (from > to) throw new RetentionError('The From date must be on or before the To date.', 'RETENTION_INVALID_PERIOD');
      if (Date.parse(to) - Date.parse(from) > 1000 * 86400 * 366 * 5) throw new RetentionError('Choose a range of five years or less.', 'RETENTION_INVALID_PERIOD');
    }
    const unit = preset === 'today' ? 'day' : preset === 'week' ? 'week' : preset === 'year' ? 'year' : 'month';
    const r = (await sql<any>`with d as (select (now() at time zone ${tz})::date as today)
      select d.today::text as today,
             coalesce(${from}::date, date_trunc(${unit}, d.today::timestamp)::date)::text as f,
             coalesce(${to}::date, (date_trunc(${unit}, d.today::timestamp) + ${'1 ' + unit}::interval - interval '1 day')::date)::text as t
      from d`.execute(this.db)).rows[0];
    const b = (await sql<any>`select (${r.f}::date::timestamp at time zone ${tz}) as s, ((${r.t}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { tz, preset, from: String(r.f), to: String(r.t), start: new Date(b.s), end: new Date(b.e), today: String(r.today), risk: st.riskDays, approaching: st.approachingDays, observation: st.observationWindowDays, settingsVersion: st.version, scope };
  }
  /** CR-02: the branches this session may see (server-side; never the client's word). Confined = the role template's
   *  scope is BRANCH / SELECTED_BRANCHES → its branchIds (else the session branch); everyone else → every active branch.
   *  `requested`: '' / 'all' = all authorized; a branch id outside them → 403 BRANCH_NOT_AUTHORIZED. */
  async branchScope(ctx: RetentionContext, requested?: unknown): Promise<BranchScope> {
    const rows = (await sql<any>`select b.id, b.name from branches b where b.tenant_id = ${ctx.tenantId} and b.deleted_at is null and coalesce(b.status, 'active') <> 'archived'
      order by lower(b.name), b.id`.execute(this.db)).rows;
    const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
    const own = (ctx.authz?.branchIds ?? []).filter((b): b is string => isUuid(b));
    const allowed = confined ? new Set(own.length ? own : isUuid(ctx.branchId) ? [ctx.branchId] : []) : null;
    const authorized = rows.filter((r: any) => !allowed || allowed.has(String(r.id))).map((r: any) => ({ branchId: String(r.id), name: String(r.name ?? '') }));
    const req = typeof requested === 'string' ? requested.trim() : '';
    if (!req || req === 'all') {
      return confined ? { mode: 'branches', branchIds: authorized.map((b) => b.branchId), selected: null, label: 'branch_activity', confined, authorized }
        : { mode: 'tenant', branchIds: null, selected: null, label: 'tenant_wide', confined, authorized };
    }
    if (!isUuid(req)) throw new RetentionError('Unknown branch.', 'RETENTION_INVALID_BRANCH');
    if (!authorized.some((b) => b.branchId === req)) throw new RetentionError('You do not have access to that branch.', 'BRANCH_NOT_AUTHORIZED', 403);
    return { mode: 'branches', branchIds: [req], selected: req, label: 'branch_activity', confined, authorized };
  }
  /** the ticket predicate of a scope: tenant = every ticket; branches = tickets of those branches only (unknown never allocated) */
  branchPred(k: Win) { return k.scope.branchIds ? sql`t.branch_id = any(${k.scope.branchIds}::uuid[])` : sql`true`; }
  scopeOut(k: Win, unknownBranchVisits?: number) {
    const s = k.scope;
    return { mode: s.mode, label: s.label, selectedBranchId: s.selected, branchIds: s.branchIds, confined: s.confined, branches: s.authorized,
      ...(unknownBranchVisits == null ? {} : { unknownBranchVisits }) };
  }
  periodOut(k: Win) {
    return { preset: k.preset, from: k.from, to: k.to, today: k.today, timeZone: k.tz, riskDays: k.risk, approachingDays: k.approaching, observationWindowDays: k.observation,
      settingsVersion: k.settingsVersion, segmentationVersion: SEGMENTATION_VERSION, priorityFormulaVersion: PRIORITY_FORMULA.version,
      // kept for the existing client: the threshold it shows on the At Risk card
      inactiveDays: k.risk, label: k.preset === 'month' ? 'this_month' : k.preset, start: k.start.toISOString() };
  }

  /** settled-ticket visits (one ticket = one visit however many services; removed / void / open tickets are not visits),
   *  each with the previous visit of the same customer — the shared source of cohorts, recoveries and the trend */
  private visits(ctx: RetentionContext, k: Win) {
    return sql`select t.id, t.customer_id, t.ticket_number, coalesce(t.paid_at, t.created_at) as vt, coalesce(t.total_cents, 0)::bigint as total_cents,
        lag(coalesce(t.paid_at, t.created_at)) over (partition by t.customer_id order by coalesce(t.paid_at, t.created_at), t.id) as prev_vt
      from tickets t where t.tenant_id = ${ctx.tenantId} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.branchPred(k)}`;
  }
  /** One row per live customer with visit statistics (the shared CTE every read uses). */
  /** shared with Customer Segments (segments.repository.ts) — one source of the visit facts */ base(ctx: RetentionContext, k: Win) {
    const T = ctx.tenantId;
    const gap = sql`((tv.vt at time zone ${k.tz})::date - (tv.prev_vt at time zone ${k.tz})::date)`;
    const inP = sql`(tv.vt >= ${k.start} and tv.vt < ${k.end})`;
    return sql`with tv as (${this.visits(ctx, k)}),
      v as (
        select tv.customer_id, count(*)::int as visits, max(tv.vt) as last_visit, min(tv.vt) as first_visit, sum(tv.total_cents)::bigint as spend,
               bool_or(${inP}) as visited_in, bool_or(${inP} and tv.prev_vt is not null) as returned_in,
               bool_or(${inP} and tv.prev_vt is not null and ${gap} >= ${k.risk}) as recovered_in,
               max(tv.vt) filter (where tv.prev_vt is not null and ${gap} >= ${k.risk}) as last_recovery_at
        from tv group by tv.customer_id),
      rf as (
        select t.customer_id, coalesce(sum(pr.amount_cents), 0)::bigint as refunded
        from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
        join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        where pr.tenant_id = ${T} and pr.status = 'refunded' and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.branchPred(k)} group by t.customer_id),
      oc as (
        select r.customer_id, max(r.created_at) as last_at,
               (array_agg(r.status order by r.created_at desc))[1] as last_status,
               bool_or(r.status in ('queued', 'submitting', 'sent', 'unknown') and r.created_at >= now() - make_interval(days => ${RECENT_CONTACT_DAYS})) as recent
        from retention_sms_recipients r where r.tenant_id = ${T} and r.status <> 'excluded' group by r.customer_id),
      ua as (
        select a.customer_id, to_char(min(a.appt_date), 'YYYY-MM-DD') as next_date from pos_tech_appointments a
        where a.tenant_id = ${T} and a.customer_id is not null and a.appt_date >= ${k.today}::date and a.status = any(${UPCOMING}::text[]) group by a.customer_id),
      b0 as (
        select c.id, c.full_name, c.avatar_url, c.normalized_phone, c.created_at, c.marketing_sms_opt_in, c.email,
               case when coalesce(c.email, '') = '' then 'no_email'
                    when c.email !~* ${EMAIL_RE} then 'invalid_email'
                    when not coalesce(c.marketing_email_opt_in, false) then 'no_consent'
                    when exists (select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'email' and lower(o.address) = lower(c.email)) then 'opted_out'
                    else 'eligible' end as email_status,
               exists (select 1 from notifications n where n.tenant_id = ${T} and n.customer_id = c.id and n.purpose = 'marketing'
                       and n.status not in ('failed', 'blocked', 'skipped', 'cancelled') and n.created_at >= ${k.start} and n.created_at < ${k.end}) as contacted_in,
               coalesce(v.visits, 0) as visits, v.last_visit, v.first_visit, coalesce(v.visited_in, false) as visited_in, coalesce(v.returned_in, false) as returned_in,
               coalesce(v.recovered_in, false) as recovered_in, v.last_recovery_at, ua.next_date,
               greatest(0, coalesce(v.spend, 0) - coalesce(rf.refunded, 0))::bigint as spend,
               case when v.last_visit is null then null else (${k.today}::date - (v.last_visit at time zone ${k.tz})::date) end as days_away,
               case when coalesce(c.normalized_phone, '') = '' then 'no_phone'
                    when c.normalized_phone !~ ${E164} then 'invalid_phone'
                    when not coalesce(c.marketing_sms_opt_in, false) then 'no_consent'
                    when exists (select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'sms'
                                  and regexp_replace(o.address, '[^0-9]', '', 'g') = regexp_replace(c.normalized_phone, '[^0-9]', '', 'g')) then 'opted_out'
                    when coalesce(oc.recent, false) then 'recently_contacted'
                    when ua.customer_id is not null then 'upcoming_booking'
                    else 'eligible' end as sms_status,
               oc.last_at as last_outreach_at, oc.last_status as last_outreach_status
        from customers c left join v on v.customer_id = c.id left join rf on rf.customer_id = c.id left join oc on oc.customer_id = c.id left join ua on ua.customer_id = c.id
        where c.tenant_id = ${T} and c.status <> 'archived'),
      b as (
        select b0.*,
               case when b0.visits = 0 then 'never_visited' when b0.days_away >= ${k.risk} then 'at_risk' when b0.days_away >= ${k.approaching} then 'approaching' else 'active' end as segment,
               case when b0.visits > 0 and b0.days_away >= ${k.risk} then round(100 * (
                   ${PRIORITY_FORMULA.weights.inactivity} * least(b0.days_away, ${PRIORITY_FORMULA.caps.days})::numeric / ${PRIORITY_FORMULA.caps.days}
                 + ${PRIORITY_FORMULA.weights.frequency} * least(b0.visits, ${PRIORITY_FORMULA.caps.visits})::numeric / ${PRIORITY_FORMULA.caps.visits}
                 + ${PRIORITY_FORMULA.weights.spend} * least(b0.spend, ${PRIORITY_FORMULA.caps.spendCents})::numeric / ${PRIORITY_FORMULA.caps.spendCents}))::int end as priority
        from b0)`;
  }
  private segmentWhere(seg: RetentionSegment, k: Win) {
    switch (seg) {
      case 'at_risk': return sql`b.visits > 0 and b.days_away >= ${k.risk}`;
      case 'at_risk_90': return sql`b.visits > 0 and b.days_away >= ${Math.max(90, k.risk)}`;
      case 'at_risk_180': return sql`b.visits > 0 and b.days_away >= ${Math.max(180, k.risk)}`;
      case 'approaching': return sql`b.visits > 0 and b.days_away >= ${k.approaching} and b.days_away < ${k.risk}`;
      case 'active': return sql`b.visits > 0 and b.days_away < ${k.risk}`;
      case 'never': return sql`b.visits = 0`;
      case 'recovered': case 'returned': return sql`b.recovered_in`;
      case 'contactable': return sql`b.visits > 0 and b.days_away >= ${k.risk} and b.sms_status = 'eligible'`;
      case 'returning': return sql`b.returned_in`;
      case 'new_visitors': return sql`b.first_visit >= ${k.start} and b.first_visit < ${k.end}`;
      // Win-Back guide §05: Already Rebooked = has visited before AND holds an upcoming booking (suppressed from win-back);
      // Contacted = a marketing message was submitted to them in the period (Retention SMS or Campaign Center, any channel)
      case 'rebooked': return sql`b.visits > 0 and b.next_date is not null`;
      case 'contacted': return sql`b.contacted_in`;
      default: return sql`true`;
    }
  }
  private basisWhere(basis: Exclude<DateBasis, 'campaign'>, k: Win) {   // `campaign` needs the tenant: filters() builds it
    const inP = (col: ReturnType<typeof sql>) => sql`(${col} >= ${k.start} and ${col} < ${k.end})`;
    switch (basis) {
      case 'last_visit': return inP(sql`b.last_visit`);
      case 'first_visit': return inP(sql`b.first_visit`);
      case 'created': return inP(sql`b.created_at`);
      case 'recovery': return sql`b.recovered_in`;
      default: return sql`true`;
    }
  }
  private filters(ctx: RetentionContext, f: ListFilters, seg: RetentionSegment, k: Win) {
    const basis = pick(DATE_BASES, f.basis) ?? 'none';
    const band = pick(PRIORITY_BANDS, f.band);
    const minVisits = Math.max(0, Math.trunc(Number(f.minVisits)) || 0);
    const parts = [this.segmentWhere(seg, k), this.search(ctx, f.q)];
    if (basis === 'campaign') parts.push(sql`exists (select 1 from retention_sms_recipients r where r.tenant_id = ${ctx.tenantId} and r.customer_id = b.id and r.status <> 'excluded'
      and coalesce(r.sent_at, r.created_at) >= ${k.start} and coalesce(r.sent_at, r.created_at) < ${k.end})`);
    else if (basis !== 'none') parts.push(this.basisWhere(basis, k));
    if (band === 'high') parts.push(sql`b.priority >= ${PRIORITY_FORMULA.bands.high}`);
    else if (band === 'medium') parts.push(sql`b.priority >= ${PRIORITY_FORMULA.bands.medium} and b.priority < ${PRIORITY_FORMULA.bands.high}`);
    else if (band === 'low') parts.push(sql`b.priority < ${PRIORITY_FORMULA.bands.medium}`);
    if (f.sms === 'eligible') parts.push(sql`b.sms_status = 'eligible'`); else if (f.sms === 'not_eligible') parts.push(sql`b.sms_status <> 'eligible'`);
    if (minVisits > 0) parts.push(sql`b.visits >= ${minVisits}`);
    const minDays = inactivityDays(f.minDays);
    if (minDays != null) parts.push(sql`b.visits > 0 and b.days_away >= ${minDays}`);   // never visited is never "inactive"
    if (f.email === 'eligible') parts.push(sql`b.email_status = 'eligible'`); else if (f.email === 'not_eligible') parts.push(sql`b.email_status <> 'eligible'`);
    else if (f.email === 'opted_out') parts.push(sql`(b.email_status = 'opted_out' or b.sms_status = 'opted_out')`);
    if (f.future === 'yes') parts.push(sql`b.next_date is not null`); else if (f.future === 'no') parts.push(sql`b.next_date is null`);
    return { where: sql.join(parts, sql` and `), applied: { basis, band: band ?? null, sms: f.sms === 'eligible' || f.sms === 'not_eligible' ? f.sms : null, minVisits: minVisits || null,
      minDays, email: ['eligible', 'not_eligible', 'opted_out'].includes(String(f.email)) ? String(f.email) : null, future: f.future === 'yes' || f.future === 'no' ? f.future : null } };
  }
  /** spec §10: All Customers = newest profile first; Win-Back (At Risk) = Smart Priority; the others their natural order */
  private defaultSort(seg: RetentionSegment): RetentionSort {
    if (seg === 'at_risk' || seg === 'at_risk_90' || seg === 'at_risk_180' || seg === 'contactable') return 'priority';
    if (seg === 'all' || seg === 'never') return 'created_desc';
    if (seg === 'approaching') return 'oldest_visit';
    return 'newest_visit';
  }
  private order(seg: RetentionSegment, sort?: RetentionSort) {
    const s = sort ?? this.defaultSort(seg);
    switch (s) {
      case 'priority': return { sql: sql`b.priority desc nulls last, b.last_visit asc nulls last, b.id asc`, label: 'priority' };
      case 'created_desc': return { sql: sql`b.created_at desc nulls last, b.id desc`, label: 'created_desc' };
      case 'newest_visit': return { sql: sql`b.last_visit desc nulls last, b.id asc`, label: 'newest_visit' };
      case 'name': return { sql: sql`lower(b.full_name) asc, b.id asc`, label: 'name' };
      case 'spend': return { sql: sql`b.spend desc, b.id asc`, label: 'spend' };
      case 'visits': return { sql: sql`b.visits desc, b.id asc`, label: 'visits' };
      default: return { sql: sql`b.last_visit asc nulls last, b.id asc`, label: 'oldest_visit' };   // longest absence first
    }
  }
  /** spec §08 universal search over the whole salon: name · phone digits · exact customer id · appointment / ticket id or
   *  ticket number · a service the customer had on a settled ticket */
  search(ctx: RetentionContext, q?: string) {
    const raw = String(q ?? '').trim().slice(0, 100); if (!raw) return sql`true`;
    const T = ctx.tenantId;
    if (isUuid(String(raw))) return sql`(b.id = ${raw}::uuid or exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.id = ${raw}::uuid and a.customer_id = b.id)
      or exists (select 1 from tickets t where t.tenant_id = ${T} and t.id = ${raw}::uuid and t.customer_id = b.id))`;
    const digits = raw.replace(/\D/g, '');
    // name: accent-insensitive (vi_fold — "nguyen" finds "Nguyễn"), and every word must appear, so "Ava Kim" finds "Ava M. Kim" and
    // first-name + last-name searches work; email: partial, case-insensitive (the guide's email search)
    const esc = (x: string) => x.replace(/[\\%_]/g, (m) => '\\' + m);
    const words = raw.split(/\s+/).filter(Boolean).slice(0, 5);
    const name = sql`(${sql.join(words.map((w) => sql`vi_fold(coalesce(b.full_name, '')) like '%' || vi_fold(${esc(w)}) || '%'`), sql` and `)})`;
    const email = raw.includes('@') || raw.length >= 3 ? sql`coalesce(b.email, '') ilike ${'%' + esc(raw) + '%'}` : sql`false`;
    const service = raw.length >= 3 ? sql`exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
        where l.tenant_id = ${T} and t.customer_id = b.id and l.removed_at is null and t.removed_at is null and t.status = any(${VISIT}::text[]) and l.service_name_snapshot ilike ${'%' + raw + '%'})` : sql`false`;
    if (digits.length >= 3 && digits.length === raw.replace(/[\s()+.-]/g, '').length) {
      return sql`(coalesce(b.normalized_phone, '') like ${'%' + digits + '%'} or exists (select 1 from tickets t where t.tenant_id = ${T} and t.customer_id = b.id and t.ticket_number::text = ${raw}))`;
    }
    return sql`(${name} or ${email} or ${service})`;
  }
  private row(r: any): RetentionRow {
    const st = String(r.sms_status) as RetentionRow['smsStatus'];
    const days = r.days_away == null ? null : N(r.days_away);
    return { customerId: String(r.id), customerName: String(r.full_name || ''), avatarUrl: r.avatar_url ?? null, maskedPhone: maskPhone(r.normalized_phone),
      phoneStatus: st === 'no_phone' ? 'missing' : st === 'invalid_phone' ? 'invalid' : 'ok', smsStatus: st, segment: String(r.segment) as RetentionRow['segment'],
      emailStatus: (String(r.email_status ?? 'no_email')) as RetentionRow['emailStatus'], maskedEmail: maskEmail(r.email), contactedInPeriod: !!r.contacted_in,
      returningInPeriod: !!r.returned_in, recoveredInPeriod: !!r.recovered_in,
      lastVisitAt: iso(r.last_visit), firstVisitAt: iso(r.first_visit), daysAway: days, visits: N(r.visits), lifetimeSpendCents: N(r.spend), createdAt: iso(r.created_at),
      lastOutreachAt: iso(r.last_outreach_at), lastOutreachStatus: r.last_outreach_status ?? null, nextAppointmentDate: day(r.next_date),
      priority: r.priority == null || days == null ? null : priorityOf(days, N(r.visits), N(r.spend)) };
  }
  private seg(v: unknown): RetentionSegment {
    const s = pick(RETENTION_SEGMENTS, v ?? 'at_risk');
    if (!s) throw new RetentionError('Unknown segment.', 'RETENTION_INVALID_SEGMENT');
    return s;
  }

  /** KPI cards (spec §06) + every segment's count (the tabs), one pass over the selected period, salon time. */
  async summary(ctx: RetentionContext, p: PeriodInput = {}) {
    const k = await this.window(ctx, p);
    const r = (await sql<any>`${this.base(ctx, k)}
      select count(*) filter (where b.visited_in)::int as visited_in,
             count(*) filter (where b.returned_in)::int as returning,
             count(*) filter (where b.first_visit >= ${k.start} and b.first_visit < ${k.end})::int as new_first_visit,
             count(*) filter (where b.created_at >= ${k.start} and b.created_at < ${k.end})::int as new_registered,
             count(*) filter (where b.segment = 'at_risk')::int as at_risk,
             count(*) filter (where b.visits > 0 and b.days_away >= ${Math.max(90, k.risk)})::int as at_risk_90,
             count(*) filter (where b.visits > 0 and b.days_away >= ${Math.max(180, k.risk)})::int as at_risk_180,
             count(*) filter (where b.segment = 'approaching')::int as approaching,
             count(*) filter (where b.visits > 0 and b.days_away < ${k.risk})::int as active,
             count(*) filter (where b.visits = 0)::int as never,
             count(*) filter (where b.recovered_in)::int as recovered,
             count(*) filter (where b.segment = 'at_risk' and b.sms_status = 'eligible')::int as contactable,
             count(*) filter (where b.priority >= ${PRIORITY_FORMULA.bands.high})::int as band_high,
             count(*) filter (where b.priority >= ${PRIORITY_FORMULA.bands.medium} and b.priority < ${PRIORITY_FORMULA.bands.high})::int as band_medium,
             count(*) filter (where b.priority < ${PRIORITY_FORMULA.bands.medium})::int as band_low,
             count(*) filter (where b.visits > 0 and b.next_date is not null)::int as rebooked,
             count(*) filter (where b.contacted_in)::int as contacted,
             count(*)::int as all_customers,
             coalesce(sum(b.spend) filter (where b.segment = 'at_risk'), 0)::bigint as lapsed_value
      from b`.execute(this.db)).rows[0] || {};
    const visited = N(r.visited_in), returning = N(r.returning);
    const rec = await this.recoveryTotals(ctx, k);
    // CR-02: settled visits whose ticket names no branch of this salon — counted, shown, never allocated to a branch
    const unk = (await sql<any>`select count(*)::int as n from tickets t where t.tenant_id = ${ctx.tenantId} and t.customer_id is not null and t.removed_at is null
      and t.status = any(${VISIT}::text[]) and (t.branch_id is null or not exists (select 1 from branches b where b.tenant_id = ${ctx.tenantId} and b.id = t.branch_id))`.execute(this.db)).rows[0];
    return {
      period: this.periodOut(k), scope: this.scopeOut(k, N(unk?.n)),
      kpis: {
        returningRatePercent: visited > 0 ? Math.round((returning / visited) * 1000) / 10 : null,   // null = nobody visited in the period (N/A, not 0 %)
        returningCustomers: returning, visitedThisMonth: visited, visitedInPeriod: visited,
        newThisMonth: N(r.new_first_visit), newRegisteredThisMonth: N(r.new_registered),
        atRisk: N(r.at_risk), lapsedValueCents: N(r.lapsed_value),
        neverVisited: N(r.never), recovered: N(r.recovered), campaignRecoveries: rec.campaignCustomers,
        contacted: N(r.contacted), rebooked: N(r.rebooked), ...(await this.deliveredInPeriod(ctx, k)),
      },
      segments: { all: N(r.all_customers), returning, approaching: N(r.approaching), at_risk: N(r.at_risk), never: N(r.never), recovered: N(r.recovered), active: N(r.active),
        at_risk_90: N(r.at_risk_90), at_risk_180: N(r.at_risk_180), returned: N(r.recovered), contactable: N(r.contactable), new_visitors: N(r.new_first_visit),
        rebooked: N(r.rebooked), contacted: N(r.contacted) },
      priorityBands: { high: N(r.band_high), medium: N(r.band_medium), low: N(r.band_low) },
    };
  }

  async customers(ctx: RetentionContext, f: ListFilters) {
    const seg = this.seg(f.segment);
    const sort = pick(RETENTION_SORTS, f.sort);
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const k = await this.window(ctx, f);
    const { where, applied } = this.filters(ctx, f, seg, k);
    const ord = this.order(seg, sort);
    // one pass: the page AND the total (count(*) over ()); only a page past the end needs the count on its own
    const pageOf = async (pg: number) => (await sql<any>`${this.base(ctx, k)} select b.*, count(*) over ()::int as total_n,
        count(*) filter (where b.sms_status = 'eligible' and b.segment = 'at_risk') over ()::int as eligible_n from b where ${where} order by ${ord.sql} limit ${pageSize} offset ${(pg - 1) * pageSize}`.execute(this.db)).rows;
    let p = page; let rows = await pageOf(p); let total = N(rows[0]?.total_n);
    if (!rows.length) {
      total = N((await sql<any>`${this.base(ctx, k)} select count(*)::int as n from b where ${where}`.execute(this.db)).rows[0]?.n);
      const last = Math.max(1, Math.ceil(total / pageSize));
      if (p > last && total > 0) { p = last; rows = await pageOf(p); } else p = Math.min(p, last);
    }
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const eligibleOnPage = rows.filter((x: any) => x.sms_status === 'eligible' && x.segment === 'at_risk').length;
    return { segment: seg, sort: ord.label, period: this.periodOut(k), scope: this.scopeOut(k), filters: applied, items: rows.map((x: any) => this.row(x)), page: p, pageSize, totalItems: total, totalPages,
      eligibleOnPage, eligibleMatching: N(rows[0]?.eligible_n) };
  }

  /** Resolve "Select all matching" on the server, against the filters as they are now (capped, never silent). */
  async matchingIds(ctx: RetentionContext, f: ListFilters): Promise<string[]> {
    const seg = this.seg(f.segment);
    const k = await this.window(ctx, f);
    const { where } = this.filters(ctx, f, seg, k);
    const rows = (await sql<any>`${this.base(ctx, k)} select b.id from b where ${where} order by ${this.order(seg).sql} limit ${MAX_SELECTION + 1}`.execute(this.db)).rows;
    if (rows.length > MAX_SELECTION) throw new RetentionError(`Select at most ${MAX_SELECTION} customers per campaign.`, 'SMS_SELECTION_TOO_LARGE');
    return rows.map((x: any) => String(x.id));
  }

  /** Win-back eligibility verdicts for exact customer ids (this tenant only; unknown / other-salon ids → not_found). The hard
   *  gate first (spec §11): a customer with no completed visit is `never_visited` — never part of a "we miss you" text. */
  async verdicts(db: Kysely<any>, ctx: RetentionContext, ids: string[]): Promise<Map<string, { status: string; phone: string | null; name: string }>> {
    const out = new Map<string, { status: string; phone: string | null; name: string }>();
    const valid = [...new Set(ids.filter(isUuid))];
    for (const id of ids) out.set(id, { status: 'not_found', phone: null, name: '' });
    if (!valid.length) return out;
    const k = await this.window(ctx);
    const rows = (await sql<any>`${this.base(ctx, k)} select b.id, b.full_name, b.normalized_phone, b.sms_status, b.visits from b where b.id = any(${valid}::uuid[])`.execute(db)).rows;
    for (const r of rows) out.set(String(r.id), { status: N(r.visits) === 0 ? 'never_visited' : String(r.sms_status), phone: r.normalized_phone ?? null, name: String(r.full_name || '') });
    return out;
  }

  // ── Retention Recovery Tracking (spec §13) ─────────────────────────────────────────────────────────────────────────────
  /** return visits in the window: a settled visit whose previous settled visit was ≥ risk days earlier (salon dates), with
   *  its net revenue (ticket total − refunds of that ticket) and the LAST sent campaign message in the observation window
   *  before it (last-touch; one return visit is credited to at most one campaign, so revenue is never counted twice) */
  private returns(ctx: RetentionContext, k: Win) {
    const T = ctx.tenantId;
    return sql`with tv as (${this.visits(ctx, k)}),
      rv as (
        select tv.id as ticket_id, tv.customer_id, tv.vt, tv.prev_vt, tv.ticket_number,
               ((tv.vt at time zone ${k.tz})::date - (tv.prev_vt at time zone ${k.tz})::date) as gap_days,
               greatest(0, tv.total_cents - coalesce((select sum(pr.amount_cents) from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
                  where pr.tenant_id = ${T} and p.ticket_id = tv.id and pr.status = 'refunded'), 0))::bigint as net_cents
        from tv where tv.prev_vt is not null and tv.vt >= ${k.start} and tv.vt < ${k.end}
          and ((tv.vt at time zone ${k.tz})::date - (tv.prev_vt at time zone ${k.tz})::date) >= ${k.risk}),
      rva as (
        select rv.*, lt.campaign_id, lt.sent_at from rv left join lateral (
          select r.campaign_id, r.sent_at from retention_sms_recipients r
          where r.tenant_id = ${T} and r.customer_id = rv.customer_id and r.status = 'sent' and r.sent_at is not null
            and r.sent_at < rv.vt and r.sent_at >= rv.vt - make_interval(days => ${k.observation}) and r.sent_at > rv.prev_vt
          order by r.sent_at desc, r.id desc limit 1) lt on true)`;
  }
  private async recoveryTotals(ctx: RetentionContext, k: Win) {
    const r = (await sql<any>`${this.returns(ctx, k)} select count(distinct customer_id) filter (where campaign_id is not null)::int as cc from rva`.execute(this.db)).rows[0];
    return { campaignCustomers: N(r?.cc) };
  }
  async recovery(ctx: RetentionContext, p: PeriodInput & { page?: unknown; pageSize?: unknown } = {}) {
    const k = await this.window(ctx, p);
    const T = ctx.tenantId;
    const tot = (await sql<any>`${this.returns(ctx, k)}
      select count(distinct customer_id)::int as customers, count(*)::int as visits, coalesce(sum(net_cents), 0)::bigint as revenue,
             count(distinct customer_id) filter (where campaign_id is not null)::int as c_customers, count(*) filter (where campaign_id is not null)::int as c_visits,
             coalesce(sum(net_cents) filter (where campaign_id is not null), 0)::bigint as c_revenue,
             count(distinct customer_id) filter (where campaign_id is null)::int as unmessaged,
             round(avg(extract(epoch from (vt - sent_at)) / 86400.0) filter (where campaign_id is not null), 1) as avg_days_to_return
      from rva`.execute(this.db)).rows[0] || {};
    // per campaign (sent in the window or crediting a return in it): delivery from our rows + the notifications ledger,
    // bookings made after contact within the observation window (booking ≠ visit), credited returns
    const camps = (await sql<any>`${this.returns(ctx, k)},
      cs as (select c.id from retention_sms_campaigns c where c.tenant_id = ${T} and c.status not in ('draft', 'expired')
             and ((c.confirmed_at >= ${k.start} and c.confirmed_at < ${k.end}) or c.id in (select campaign_id from rva where campaign_id is not null)))
      select c.id, c.label, c.confirmed_at, c.eligible_count,
        (select count(*) from retention_sms_recipients r where r.tenant_id = ${T} and r.campaign_id = c.id and r.status = 'sent')::int as sent,
        (select count(*) from retention_sms_recipients r join notifications n on n.tenant_id = r.tenant_id and n.provider_id = r.provider_id
           where r.tenant_id = ${T} and r.campaign_id = c.id and r.status = 'sent' and n.status = 'delivered')::int as delivered,
        (select count(*) from retention_sms_recipients r where r.tenant_id = ${T} and r.campaign_id = c.id and r.status in ('failed', 'blocked'))::int as failed,
        -- C5 audit (Nov 4 2026): a hand-off whose outcome is unknown may have been delivered — never counted as failed
        (select count(*) from retention_sms_recipients r where r.tenant_id = ${T} and r.campaign_id = c.id and r.status = 'unknown')::int as unknown,
        (select count(distinct r.customer_id) from retention_sms_recipients r where r.tenant_id = ${T} and r.campaign_id = c.id and r.status = 'sent'
           and exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = r.customer_id and a.created_at > r.sent_at
             and a.created_at < r.sent_at + make_interval(days => ${k.observation})))::int as booked_after,
        (select count(distinct x.customer_id) from rva x where x.campaign_id = c.id)::int as returned,
        (select coalesce(sum(x.net_cents), 0) from rva x where x.campaign_id = c.id)::bigint as return_revenue
      from retention_sms_campaigns c join cs on cs.id = c.id
      order by c.confirmed_at desc nulls last, c.id desc limit 20`.execute(this.db)).rows;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(p.pageSize)) || 10)); const page = Math.max(1, Math.trunc(Number(p.page)) || 1);
    const totalItems = N(tot.visits); const totalPages = Math.max(1, Math.ceil(totalItems / pageSize)); const pg = Math.min(page, totalPages);
    const items = (await sql<any>`${this.returns(ctx, k)}
      select rva.*, c.full_name from rva join customers c on c.id = rva.customer_id and c.tenant_id = ${T}
      order by rva.vt desc, rva.ticket_id desc limit ${pageSize} offset ${(pg - 1) * pageSize}`.execute(this.db)).rows;
    // trend: the last six salon months ending with the period's month (visited / returning / new / recovered, unique customers)
    const trend = (await sql<any>`with tv as (${this.visits(ctx, k)}),
      m as (select generate_series(date_trunc('month', ${k.to}::date::timestamp) - interval '5 months', date_trunc('month', ${k.to}::date::timestamp), interval '1 month') as ms),
      f as (select customer_id, min(vt) as first_vt from tv group by customer_id)
      select to_char(m.ms, 'YYYY-MM') as month,
        count(distinct tv.customer_id)::int as visited,
        count(distinct tv.customer_id) filter (where tv.prev_vt is not null)::int as returning,
        count(distinct tv.customer_id) filter (where tv.vt = f.first_vt)::int as new_visitors,
        count(distinct tv.customer_id) filter (where tv.prev_vt is not null and ((tv.vt at time zone ${k.tz})::date - (tv.prev_vt at time zone ${k.tz})::date) >= ${k.risk})::int as recovered
      from m left join tv on (tv.vt at time zone ${k.tz}) >= m.ms and (tv.vt at time zone ${k.tz}) < m.ms + interval '1 month'
      left join f on f.customer_id = tv.customer_id
      group by m.ms order by m.ms`.execute(this.db)).rows;
    return {
      period: this.periodOut(k),
      definitions: { recovered: `A completed visit in the period whose previous completed visit was ${k.risk}+ salon days earlier.`,
        campaignObserved: `A recovery within ${k.observation} days after a sent retention text (last text before the visit). Observed, not proven cause.`,
        revenue: 'Net: ticket total minus refunds of that ticket. One ticket counts once, however many services.' },
      totals: { recoveredCustomers: N(tot.customers), returnVisits: N(tot.visits), observedReturnRevenueCents: N(tot.revenue),
        campaignObserved: { customers: N(tot.c_customers), visits: N(tot.c_visits), revenueCents: N(tot.c_revenue), avgDaysToReturn: tot.avg_days_to_return == null ? null : Number(tot.avg_days_to_return) },
        unmessagedRecovered: N(tot.unmessaged) },
      campaigns: camps.map((c: any) => ({ campaignId: String(c.id), label: c.label ?? null, confirmedAt: iso(c.confirmed_at), eligible: N(c.eligible_count), sent: N(c.sent), delivered: N(c.delivered),
        failed: N(c.failed), unknown: N(c.unknown), bookedAfterContact: N(c.booked_after), returnedCustomers: N(c.returned), returnRevenueCents: N(c.return_revenue) })),
      returns: { items: items.map((x: any) => ({ ticketId: String(x.ticket_id), ticketNumber: x.ticket_number == null ? null : String(x.ticket_number), customerId: String(x.customer_id), customerName: String(x.full_name || ''),
        returnedAt: iso(x.vt), previousVisitAt: iso(x.prev_vt), daysAwayBefore: N(x.gap_days), netCents: N(x.net_cents), campaignId: x.campaign_id ? String(x.campaign_id) : null, messageSentAt: iso(x.sent_at) })),
        page: pg, pageSize, totalItems, totalPages },
      trend: trend.map((t: any) => ({ month: String(t.month), visited: N(t.visited), returning: N(t.returning), newVisitors: N(t.new_visitors), recovered: N(t.recovered),
        returningRatePercent: N(t.visited) > 0 ? Math.round((N(t.returning) / N(t.visited)) * 1000) / 10 : null })),
    };
  }

  /** CSV of the list as filtered (masked phones; ≤ 5000 rows). The controller audits it fail-closed. */
  async exportCsv(ctx: RetentionContext, f: ListFilters): Promise<{ csv: string; rows: number; filename: string }> {
    const seg = this.seg(f.segment ?? 'all');
    const k = await this.window(ctx, f);
    const { where } = this.filters(ctx, f, seg, k);
    const rows = (await sql<any>`${this.base(ctx, k)} select b.* from b where ${where} order by ${this.order(seg, pick(RETENTION_SORTS, f.sort)).sql} limit ${MAX_SELECTION}`.execute(this.db)).rows.map((x: any) => this.row(x));
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    const head = ['Customer ID', 'Customer', 'Phone (masked)', 'Segment', 'Last completed visit', 'Days away', 'Completed visits', 'Net lifetime spend', 'SMS eligibility', 'Last contact', 'Priority', 'Priority band', 'Why'];
    const lines = rows.map((r) => [r.customerId, r.customerName, r.maskedPhone, r.segment, r.lastVisitAt?.slice(0, 10), r.daysAway, r.visits, (r.lifetimeSpendCents / 100).toFixed(2), r.smsStatus,
      r.lastOutreachAt?.slice(0, 10), r.priority?.score, r.priority?.band, r.priority?.explanation].map(esc).join(','));
    return { csv: [head.join(','), ...lines].join('\n') + '\n', rows: rows.length, filename: `customer-retention-${seg}-${k.from}-to-${k.to}.csv` };
  }

  /** Which way a text from this salon would go (spec §12: the salon's own sender, never another salon's). */
  async sender(ctx: RetentionContext): Promise<{ route: 'tenant_account' | 'shared' | 'simulated' | 'not_configured'; from: string | null; a2pStatus: string | null }> {
    // C3 audit: the session branch's own Twilio account wins (the send uses it), else the salon default
    const br = isUuid(ctx.branchId) ? ctx.branchId : null;
    const cred = (await sql<any>`select from_number, messaging_service_sid from tenant_messaging_credentials
      where tenant_id = ${ctx.tenantId} and provider = 'twilio' and status = 'configured' and (branch_id is null or branch_id = ${br}::uuid) and offboarded_at is null
      order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
    const a2p = (await sql<any>`select campaign_status from tenant_a2p_registrations where tenant_id = ${ctx.tenantId} order by updated_at desc nulls last limit 1`.execute(this.db)).rows[0];
    const last4 = (v: string | null) => (v ? `•••${String(v).slice(-4)}` : null);
    if (cred && (cred.messaging_service_sid || cred.from_number)) return { route: 'tenant_account', from: last4(cred.from_number || cred.messaging_service_sid), a2pStatus: a2p?.campaign_status ?? null };
    const env = process.env;
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) return { route: 'shared', from: last4(env.TWILIO_FROM), a2pStatus: a2p?.campaign_status ?? null };
    const prod = env.NODE_ENV === 'production' || env.APP_ENV === 'production';
    return { route: prod ? 'not_configured' : 'simulated', from: null, a2pStatus: a2p?.campaign_status ?? null };
  }

  /** Platform quiet hours (campaign_limits, salon-local hours) → when the first text may go out. null = now. */
  async quietUntil(ctx: RetentionContext): Promise<{ start: number | null; end: number | null; until: Date | null }> { return quietWindowUntil(this.db, ctx.tenantId); }

  // ── campaigns ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async createDraft(ctx: RetentionContext, d: { body: string; segments: number; audience: Record<string, unknown>; verdicts: { customerId: string; status: string; destination: string | null }[] }): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const counts: Record<string, number> = {}; let eligible = 0;
      for (const v of d.verdicts) { if (v.status === 'eligible') eligible++; else counts[v.status] = (counts[v.status] || 0) + 1; }
      const sha = createHash('sha256').update(d.body).digest('hex');
      const c = (await sql<any>`insert into retention_sms_campaigns (tenant_id, branch_id, status, body, body_sha256, segments_per_message, audience_json, selected_count, eligible_count, excluded_count,
          excluded_reasons_json, created_by_user_id, expires_at)
        values (${ctx.tenantId}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, 'draft', ${d.body}, ${sha}, ${d.segments}, ${JSON.stringify(d.audience)}::jsonb, ${d.verdicts.length}, ${eligible},
          ${d.verdicts.length - eligible}, ${JSON.stringify(counts)}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null}, now() + make_interval(mins => ${PREVIEW_TTL_MINUTES})) returning id`.execute(trx)).rows[0];
      const id = String(c.id);
      for (let i = 0; i < d.verdicts.length; i += 500) {
        const slice = d.verdicts.slice(i, i + 500);
        await sql`insert into retention_sms_recipients (campaign_id, tenant_id, customer_id, destination, eligibility, status)
          select ${id}::uuid, ${ctx.tenantId}::uuid, x.cid::uuid, x.dest, x.elig, 'excluded'
          from unnest(${slice.map((v) => v.customerId)}::text[], ${slice.map((v) => v.destination ?? '')}::text[], ${slice.map((v) => v.status)}::text[]) as x(cid, dest, elig)
          on conflict do nothing`.execute(trx);
      }
      await sql`update retention_sms_recipients set destination = null where tenant_id = ${ctx.tenantId} and campaign_id = ${id} and destination = ''`.execute(trx);
      return id;
    });
  }
  async draftRoster(ctx: RetentionContext, campaignId: string, limit = 100) {
    return (await sql<any>`select r.customer_id, r.eligibility, r.destination, c.full_name from retention_sms_recipients r left join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      where r.tenant_id = ${ctx.tenantId} and r.campaign_id = ${campaignId} order by (r.eligibility = 'eligible') desc, lower(c.full_name), r.customer_id limit ${limit}`.execute(this.db)).rows
      .map((r: any) => ({ customerId: String(r.customer_id), customerName: String(r.full_name || ''), maskedPhone: maskPhone(r.destination), eligibility: String(r.eligibility) }));
  }

  async listCampaigns(ctx: RetentionContext, f: { page?: unknown; pageSize?: unknown }) {
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10)); const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const total = N((await sql<any>`select count(*)::int as n from retention_sms_campaigns where tenant_id = ${ctx.tenantId} and status <> 'draft' and status <> 'expired'`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<any>`select c.id, c.status, c.label, c.body, c.selected_count, c.eligible_count, c.excluded_count, c.queued_count, c.created_at, c.confirmed_at, c.completed_at,
        c.created_by_user_id, c.confirmed_by_user_id, ${this.statusCounts()}
      from retention_sms_campaigns c
      where c.tenant_id = ${ctx.tenantId} and c.status not in ('draft', 'expired') order by c.created_at desc, c.id desc limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.campaignRow(r)), page: p, pageSize, totalItems: total, totalPages };
  }
  /** Per-recipient outcome, derived once: our row's status, then the notifications ledger row the Twilio callback updates. */
  private statusCounts() {
    return sql`(select json_build_object(
        'excluded', count(*) filter (where r.status = 'excluded'),
        'queued', count(*) filter (where r.status in ('queued', 'submitting')),
        'sent', count(*) filter (where r.status = 'sent' and coalesce(n.status, 'sent') in ('sent', 'simulated')),
        'delivered', count(*) filter (where r.status = 'sent' and n.status = 'delivered'),
        'undelivered', count(*) filter (where r.status = 'sent' and n.status = 'failed'),
        'blocked', count(*) filter (where r.status = 'blocked'),
        'failed', count(*) filter (where r.status = 'failed'),
        'unknown', count(*) filter (where r.status = 'unknown'),
        'simulated', count(*) filter (where r.status = 'sent' and n.status = 'simulated'))
      from retention_sms_recipients r left join notifications n on n.tenant_id = r.tenant_id and n.provider_id = r.provider_id
      where r.campaign_id = c.id) as counts`;
  }
  private campaignRow(r: any) {
    const counts = typeof r.counts === 'string' ? JSON.parse(r.counts) : r.counts || {};
    return { id: String(r.id), status: String(r.status), label: r.label ?? null, body: String(r.body), selected: N(r.selected_count), eligible: N(r.eligible_count), excluded: N(r.excluded_count),
      queued: N(r.queued_count), createdAt: iso(r.created_at), confirmedAt: iso(r.confirmed_at), completedAt: iso(r.completed_at), confirmedByUserId: r.confirmed_by_user_id ? String(r.confirmed_by_user_id) : null, createdByUserId: r.created_by_user_id ? String(r.created_by_user_id) : null,
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, N(v)])) as Record<string, number> };
  }
  async campaignDetail(ctx: RetentionContext, id: string, f: { page?: unknown; pageSize?: unknown; status?: string }) {
    if (!isUuid(id)) return null;
    const c = (await sql<any>`select c.id, c.status, c.label, c.body, c.selected_count, c.eligible_count, c.excluded_count, c.queued_count, c.created_at, c.confirmed_at, c.completed_at,
        c.created_by_user_id, c.confirmed_by_user_id, c.audience_json, c.excluded_reasons_json, c.segments_per_message, c.sender_from, ${this.statusCounts()}
      from retention_sms_campaigns c where c.tenant_id = ${ctx.tenantId} and c.id = ${id}`.execute(this.db)).rows[0];
    if (!c) return null;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10)); const page = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const st = f.status && ['excluded', 'queued', 'sent', 'blocked', 'failed', 'unknown', 'delivered', 'undelivered'].includes(f.status) ? f.status : null;
    const stW = !st ? sql`true` : st === 'delivered' ? sql`r.status = 'sent' and n.status = 'delivered'` : st === 'undelivered' ? sql`r.status = 'sent' and n.status = 'failed'` : st === 'queued' ? sql`r.status in ('queued', 'submitting')` : sql`r.status = ${st}`;
    const from = sql`from retention_sms_recipients r left join customers cu on cu.id = r.customer_id and cu.tenant_id = r.tenant_id left join notifications n on n.tenant_id = r.tenant_id and n.provider_id = r.provider_id
      where r.tenant_id = ${ctx.tenantId} and r.campaign_id = ${id} and ${stW}`;
    const total = N((await sql<any>`select count(*)::int as n ${from}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages);
    const rows = (await sql<any>`select r.id, r.customer_id, cu.full_name, r.destination, r.eligibility, r.status, r.provider_id, r.error, r.queued_at, r.submitted_at, r.sent_at, n.status as delivery, n.provider_error_code, n.delivered_at
      ${from} order by r.created_at asc, r.id asc limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return { campaign: { ...this.campaignRow(c), audience: typeof c.audience_json === 'string' ? JSON.parse(c.audience_json) : c.audience_json, excludedReasons: typeof c.excluded_reasons_json === 'string' ? JSON.parse(c.excluded_reasons_json) : c.excluded_reasons_json, segmentsPerMessage: N(c.segments_per_message), senderFrom: c.sender_from ?? null },
      recipients: { items: rows.map((r: any) => ({ id: String(r.id), customerId: String(r.customer_id), customerName: String(r.full_name || ''), maskedPhone: maskPhone(r.destination), eligibility: String(r.eligibility),
        status: r.status === 'sent' && r.delivery === 'delivered' ? 'delivered' : r.status === 'sent' && r.delivery === 'failed' ? 'undelivered' : r.status === 'sent' && r.delivery === 'simulated' ? 'simulated' : String(r.status),
        providerId: r.provider_id ? `…${String(r.provider_id).slice(-6)}` : null, error: r.error ?? r.provider_error_code ?? null, queuedAt: iso(r.queued_at), sentAt: iso(r.sent_at), deliveredAt: iso(r.delivered_at) })), page: p, pageSize, totalItems: total, totalPages } };
  }

  /** The retention snapshot of one customer (spec §14): why the segment, visit evidence (settled tickets only), upcoming
   *  bookings, consent / opt-out and this salon's outreach history. */
  /** Win-Back guide §12: Delivered comes ONLY from provider evidence (a delivered status / a recorded delivery event). With no
   *  delivery evidence on record for this salon at all the count is unknown (null) — never a synthetic 0 or "all sent = delivered". */
  async deliveredInPeriod(ctx: RetentionContext, k: Win): Promise<{ delivered: number | null; deliveryEvidence: boolean }> {
    const T = ctx.tenantId;
    const ev = (await sql<any>`select exists (select 1 from notification_delivery_events e where e.tenant_id = ${T}) or exists (select 1 from notifications n where n.tenant_id = ${T} and n.delivered_at is not null) as has_evidence`.execute(this.db)).rows[0];
    if (!ev?.has_evidence) return { delivered: null, deliveryEvidence: false };
    const r = (await sql<any>`select count(distinct n.customer_id)::int as n from notifications n where n.tenant_id = ${T} and n.purpose = 'marketing' and n.customer_id is not null
      and n.status = 'delivered' and n.created_at >= ${k.start} and n.created_at < ${k.end}`.execute(this.db)).rows[0];
    return { delivered: N(r?.n), deliveryEvidence: true };
  }

  async customerSnapshot(ctx: RetentionContext, customerId: string) {
    if (!isUuid(customerId)) return null;
    const k = await this.window(ctx);
    const r = (await sql<any>`${this.base(ctx, k)} select b.* from b where b.id = ${customerId}`.execute(this.db)).rows[0];
    if (!r) return null;
    const T = ctx.tenantId;
    const consent = (await sql<any>`select marketing_sms_opt_in, updated_at from customers where tenant_id = ${T} and id = ${customerId}`.execute(this.db)).rows[0];
    const outreach = (await sql<any>`select r.campaign_id, c.label, r.status, r.eligibility, r.created_at, r.sent_at, n.status as delivery from retention_sms_recipients r
      join retention_sms_campaigns c on c.id = r.campaign_id and c.tenant_id = r.tenant_id
      left join notifications n on n.tenant_id = r.tenant_id and n.provider_id = r.provider_id
      where r.tenant_id = ${T} and r.customer_id = ${customerId} and r.status <> 'excluded' order by r.created_at desc limit 20`.execute(this.db)).rows;
    const visits = (await sql<any>`select t.id, t.ticket_number, coalesce(t.paid_at, t.created_at) as vt, coalesce(t.total_cents, 0)::bigint as total_cents,
        (select string_agg(l.service_name_snapshot, ', ' order by l.created_at) from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null) as services
      from tickets t where t.tenant_id = ${T} and t.customer_id = ${customerId} and t.removed_at is null and t.status = any(${VISIT}::text[])
        and ${this.branchPred(k)}   -- C3 audit: the same branches the segment above was computed from (another branch's tickets leaked)
      order by coalesce(t.paid_at, t.created_at) desc, t.id desc limit 12`.execute(this.db)).rows;
    const upcoming = (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as appt_date, a.start_time, a.status, a.services from pos_tech_appointments a
      where a.tenant_id = ${T} and a.customer_id = ${customerId} and a.appt_date >= ${k.today}::date and a.status = any(${UPCOMING}::text[])
      order by a.appt_date, a.start_time limit 5`.execute(this.db)).rows;
    const lastBooking = (await sql<any>`select to_char(a.appt_date, 'YYYY-MM-DD') as appt_date, a.status from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = ${customerId}
      order by a.appt_date desc, a.start_time desc limit 1`.execute(this.db)).rows[0];
    // Win-Back guide §08 Communications: every message on record for this customer (any channel / purpose), its honest state —
    // "delivered" only with provider evidence; bodies are not returned (the overlay shows kind, channel, state and time)
    const comms = (await sql<any>`select n.id, n.channel, n.purpose, n.source_type, n.status, n.created_at, n.delivered_at, n.failure_reason from notifications n
      where n.tenant_id = ${T} and n.customer_id = ${customerId} order by n.created_at desc, n.id desc limit 25`.execute(this.db)).rows;
    const refunds = (await sql<any>`select coalesce(sum(pr.amount_cents), 0)::bigint as cents, count(*)::int as n from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
      join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id where pr.tenant_id = ${T} and pr.status = 'refunded' and t.customer_id = ${customerId}`.execute(this.db)).rows[0];
    const emailConsent = (await sql<any>`select marketing_email_opt_in from customers where tenant_id = ${T} and id = ${customerId}`.execute(this.db)).rows[0];
    const row = this.row(r);
    const days = row.daysAway ?? 0;
    const cohort = row.visits === 0 ? 'never' : days >= Math.max(180, k.risk) ? 'at_risk_180' : days >= Math.max(90, k.risk) ? 'at_risk_90' : days >= k.risk ? 'at_risk' : days >= k.approaching ? 'approaching' : 'active';
    const reason = row.visits === 0 ? { code: 'no_completed_visit', text: 'No completed (settled) visit on record — Never Visited, not part of win-back.' }
      : row.segment === 'at_risk' ? { code: 'away_past_threshold', text: `${days} salon days since the last completed visit (At Risk from ${k.risk}).` }
      : row.segment === 'approaching' ? { code: 'away_near_threshold', text: `${days} salon days since the last completed visit (Approaching from ${k.approaching}, At Risk from ${k.risk}).` }
      : { code: 'recent_visit', text: `${days} salon days since the last completed visit (under ${k.approaching}).` };
    const svcNames = (j: unknown) => { const a = typeof j === 'string' ? JSON.parse(j) : j; return Array.isArray(a) ? a.map((x: any) => String(x?.name ?? x?.serviceName ?? '')).filter(Boolean).join(', ') : ''; };
    return { ...row, cohort, segmentReason: reason, asOf: k.today, settingsVersion: k.settingsVersion, segmentationVersion: SEGMENTATION_VERSION,
      thresholds: { riskDays: k.risk, approachingDays: k.approaching },
      marketingSmsConsent: !!consent?.marketing_sms_opt_in, consentUpdatedAt: iso(consent?.updated_at),
      visitEvidence: visits.map((v: any) => ({ ticketId: String(v.id), ticketNumber: v.ticket_number == null ? null : String(v.ticket_number), at: iso(v.vt), totalCents: N(v.total_cents), services: v.services ?? '' })),
      upcomingBookings: upcoming.map((a: any) => ({ appointmentId: String(a.id), date: day(a.appt_date), startTime: String(a.start_time), status: String(a.status), services: svcNames(a.services) })),
      lastBooking: lastBooking ? { date: day(lastBooking.appt_date), status: String(lastBooking.status) } : null,
      marketingEmailConsent: !!emailConsent?.marketing_email_opt_in,
      refunds: { count: N(refunds?.n), cents: N(refunds?.cents) },
      communications: comms.map((c: any) => ({ id: String(c.id), channel: String(c.channel), purpose: c.purpose ?? null, source: c.source_type ?? null,
        state: c.status === 'delivered' || c.delivered_at ? 'delivered' : ['failed', 'blocked', 'undelivered'].includes(String(c.status)) ? 'failed' : c.status === 'skipped' || c.status === 'cancelled' ? 'skipped' : c.status === 'queued' || c.status === 'pending' ? 'queued' : 'submitted',
        at: iso(c.created_at), deliveredAt: iso(c.delivered_at), failure: c.failure_reason ? String(c.failure_reason).slice(0, 160) : null })),
      outreach: outreach.map((o: any) => ({ campaignId: String(o.campaign_id), label: o.label ?? null, status: o.status === 'sent' && o.delivery === 'delivered' ? 'delivered' : o.status === 'sent' && o.delivery === 'failed' ? 'undelivered' : String(o.status), at: iso(o.sent_at ?? o.created_at) })) };
  }
}

/** Platform quiet hours (campaign_limits, salon-local hours) for one salon → until when nothing may be sent (null = now is fine).
 *  Shared by the confirm step and — C5 audit (Nov 4 2026) — the send worker itself: a campaign confirmed at 20:58 is spread at
 *  60 texts a minute, so later texts would otherwise go out inside quiet hours. */
export async function quietWindowUntil(db: Kysely<any>, tenantId: string): Promise<{ start: number | null; end: number | null; until: Date | null }> {
  const lim = (await sql<any>`select quiet_hours_start, quiet_hours_end from campaign_limits where active order by created_at desc limit 1`.execute(db)).rows[0];
  const s = lim?.quiet_hours_start, e = lim?.quiet_hours_end;
  if (s == null || e == null || s === e) return { start: s ?? null, end: e ?? null, until: null };
  const tz = await tenantTimeZone(db, tenantId).catch(() => 'America/New_York');
  const r = (await sql<any>`select extract(hour from now() at time zone ${tz})::int as h,
    (date_trunc('day', now() at time zone ${tz}) + make_interval(hours => ${N(e)})) at time zone ${tz} as end_today,
    (date_trunc('day', now() at time zone ${tz}) + interval '1 day' + make_interval(hours => ${N(e)})) at time zone ${tz} as end_tomorrow`.execute(db)).rows[0];
  const h = N(r.h); const inQuiet = N(s) > N(e) ? (h >= N(s) || h < N(e)) : (h >= N(s) && h < N(e));
  if (!inQuiet) return { start: N(s), end: N(e), until: null };
  const until = N(s) > N(e) && h >= N(s) ? new Date(r.end_tomorrow) : new Date(r.end_today);
  return { start: N(s), end: N(e), until };
}
