// reviews-center.ts — Reviews & Reputation Complete Build Guide (Oct 30 2026, migration 752): `/pos/reviews-center/*`.
// Extends the ONE review store (`reviews`) in place — no parallel review table, no second rating service:
//   VERIFIED_REVIEW_SQL       THE rating definition every internal consumer uses: a 1–5 rating, not hidden by a manager, not
//                             spam. Team Performance / Technicians / Team Members already apply exactly this predicate; the
//                             Reviews KPIs and the technician overlay now use it too (guide §10, REV-18).
//   recomputeTechRatingDenorm the PUBLIC technician profile figure = verified AND is_public AND attributed (spam now excluded —
//                             it was not: a spam review could lift a public technician average).
//   moderate()                Hide / Unhide: reason-coded, optimistic-concurrency (moderation_version), idempotent, appended to
//                             review_moderation_events (immutable) + an audit row in the SAME transaction (fail-closed). A low
//                             rating is never a reason to hide; nothing here hides anything automatically.
//   detail()                  the overlay: review, customer (only through a real tenant link; masked unless pos.customers.view;
//                             the open is audited), technician verified stats, linked visit, the existing reply workflow history
//                             (review_response_drafts / versions / approvals / publications — read-only here), moderation trail.
//   insights()                the assistant's facts: written comments only; "insufficient written feedback" below 3 comments.
//                             Nothing is invented and nothing is sent, hidden or published (reply drafts stay in the existing
//                             approval-gated AI Review Reputation workflow).
//   check()                   Check Review System — READ-ONLY, six sections, READY / WARNING / FAILED / UNKNOWN with evidence.
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { isUuid, RetentionRepository, type RetentionContext } from '../retention/retention.repository';
import { maskPhone, maskEmail } from '../pos-referrals/referral-program';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { recomputeTechRatingDenorm } from './reviews-public-denorm';

export class ReviewsCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}
export type RvCtx = RetentionContext;

/** THE verified-rating predicate (alias `r` = reviews). Same text as Team Performance / Technicians / Team Members. */
export const VERIFIED_REVIEW_SQL = sql`r.rating between 1 and 5 and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)`;
/** the publicly displayed subset (Customer App / public technician profile): verified AND the customer allowed it public */
export const PUBLIC_REVIEW_SQL = sql`${VERIFIED_REVIEW_SQL} and coalesce(r.is_public, false)`;
const RESPONDED_SQL = sql`(r.technician_response is not null or r.response_status in ('published', 'responded', 'no_response_required')
  or exists (select 1 from review_publications p where p.tenant_id = r.tenant_id and p.review_id = r.id and p.result = 'published'))`;
const ATTENTION_SQL = sql`(r.rating <= 2 and not coalesce(r.is_spam, false) and not ${RESPONDED_SQL} and coalesce(r.resolution_status, 'open') not in ('resolved', 'no_action'))`;
const VISIT_STATUSES = [...VISIT_TICKET_STATUSES] as string[];

export const RV_EXTERNAL_SOURCES = ['google', 'facebook', 'yelp'] as const;
export const RV_SOURCES = ['internal', 'app', 'survey', 'sms', 'email', 'support', 'manual', 'google', 'facebook', 'yelp'] as const;
export const RV_VISIBILITY = ['public', 'not_public', 'hidden', 'spam'] as const;
export const RV_COMMENT = ['written', 'star_only'] as const;
export const RV_FOLLOWUP = ['unanswered', 'responded', 'needs_attention', 'reviewed'] as const;
export const RV_BASES = ['submitted', 'service', 'moderated', 'response'] as const;
export const RV_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const;
export const RV_SORTS = ['newest', 'oldest', 'lowest', 'highest', 'moderated', 'attention'] as const;
export const RV_HIDE_REASONS = ['spam', 'abusive_language', 'personal_information', 'wrong_salon_or_customer', 'duplicate', 'test_review', 'other'] as const;
export const RV_ACTIONS = ['hide', 'unhide'] as const;

const N = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const pick = <T extends readonly string[]>(vals: T, v: unknown): T[number] | undefined => ((vals as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const pageOf = (p: unknown) => Math.max(1, Math.trunc(N(p)) || 1);
const sizeOf = (s: unknown) => ([10, 20, 50].includes(Math.trunc(N(s))) ? Math.trunc(N(s)) : 20);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const actorId = (ctx: { userId?: string }) => (isUuid(ctx.userId) ? ctx.userId : null);
const isExternal = (src: unknown) => (RV_EXTERNAL_SOURCES as readonly string[]).includes(String(src));

export interface RvListFilters {
  q?: unknown; rating?: unknown; comment?: unknown; visibility?: unknown; followup?: unknown; technician?: unknown; source?: unknown; service?: unknown;
  basis?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown;
  /** A17 Nov 6: a staff id, 'me' or 'none' */
  assignee?: unknown;
}
export interface ModerateBody { action?: unknown; reasonCode?: unknown; reasonText?: unknown; evidence?: unknown; expectedVersion?: unknown; idempotencyKey?: unknown }
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
/** Check Review System: each "next step" sentence has a code — the POS shows its own EN / VI text by code (Nov 6 2026). */
const RV_ACTION_CODES: Readonly<Record<string, string>> = {
  'Run the check again; if it keeps failing, ask support.': 'retry',
  'Open the listed reviews with support; the records are not changed by this check.': 'records_problems',
  'Review the possible duplicates; they are not merged or removed automatically.': 'records_duplicates',
  'The dashboard and the direct query disagree — report this to support; no number was changed.': 'aggregation_mismatch',
  'Check those reviews\' visits; links are never rewritten automatically.': 'relationships_check',
  'The stored public rating refreshes on the next hide / unhide or new rating for that technician; nothing was changed by this check.': 'cross_module_stale',
  'Hidden reviews without a trail predate the history; record a reason by unhiding and hiding them again if appropriate.': 'moderation_no_trail',
  'Confirm each hidden 1–2★ review was hidden for a policy reason (open it → Moderation history).': 'moderation_hidden_low',
  'Answer the low ratings (sort: Needs attention).': 'moderation_attention',
  'Turn on review requests in the AI Review Assistant settings if the salon wants them.': 'delivery_off',
  'Check that the review-request job is running.': 'delivery_stale',
  'Open Notifications to see why the requests failed.': 'delivery_failed',
};
export interface Check { key: string; state: 'READY' | 'WARNING' | 'FAILED' | 'UNKNOWN'; title: string; evidence: string; active: boolean; action: string | null; actionCode: string | null; checkedAt: string }

export class ReviewsCenter {
  readonly ret: RetentionRepository;
  constructor(readonly db: Kysely<any>) { this.ret = new RetentionRepository(db); }

  private branchW(ctx: RvCtx) { return isUuid(ctx.branchId) ? sql`r.branch_id = ${ctx.branchId}` : sql`true`; }
  private async tz(ctx: RvCtx): Promise<{ tz: string; today: string }> { const k = await this.ret.window(ctx); return { tz: k.tz, today: k.today }; }

  /** inclusive salon-local From → To; the query uses [From 00:00, To+1 00:00) in the salon's timezone (DST-correct) */
  range(today: string, f: { preset?: unknown; from?: unknown; to?: unknown }): { preset: string; from: string; to: string } | null {
    const preset = pick(RV_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : undefined);
    if (!preset) return null;
    const d = new Date(today + 'T00:00:00Z');
    const ymd = (x: Date) => utcDate(x);
    if (preset === 'today') return { preset, from: today, to: today };
    if (preset === 'week') { const dow = (d.getUTCDay() + 6) % 7; const s = new Date(d); s.setUTCDate(d.getUTCDate() - dow); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6); return { preset, from: ymd(s), to: ymd(e) }; }
    if (preset === 'month') return { preset, from: ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
    if (preset === 'year') return { preset, from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
    const from = typeof f.from === 'string' && DAY.test(f.from) ? f.from : null;
    const to = typeof f.to === 'string' && DAY.test(f.to) ? f.to : null;
    if (!from || !to) throw new ReviewsCenterError('Choose a From and a To date.', 'REVIEWS_RANGE_INVALID');
    if (from > to) throw new ReviewsCenterError('The From date must be on or before the To date.', 'REVIEWS_RANGE_INVALID');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 3660) throw new ReviewsCenterError('Choose a range of 10 years or less.', 'REVIEWS_RANGE_INVALID');
    return { preset: 'custom', from, to };
  }
  private basisCol(basis: string, tz: string) {
    return basis === 'moderated' ? sql`r.last_moderated_at`
      : basis === 'response' ? sql`(select max(p.created_at) from review_publications p where p.tenant_id = r.tenant_id and p.review_id = r.id and p.result = 'published')`
      : basis === 'service' ? sql`coalesce(tk.paid_at, (ap.appt_date::text || ' ' || coalesce(ap.start_time::text, '00:00'))::timestamp at time zone ${tz})`
      : sql`coalesce(r.review_date, r.created_at)`;
  }
  private from() {
    return sql`from reviews r left join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id
      left join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id
      left join pos_tech_appointments ap on ap.id = r.appointment_id and ap.tenant_id = r.tenant_id
      left join ticket_service_lines sl on sl.id = r.ticket_service_line_id and sl.tenant_id = r.tenant_id`;
  }

  // ── KPIs + distribution (guide §04 zone B/D, §10). One query; the scope is stated beside every number. ─────────────────
  async summary(ctx: RvCtx, f: { preset?: unknown; from?: unknown; to?: unknown; technician?: unknown; source?: unknown } = {}, db: Kysely<any> = this.db) {
    const { tz, today } = await this.tz(ctx);
    const rg = this.range(today, f);
    // the KPIs follow the technician / source filters of the feed (they used to show the whole salon beside a filtered list)
    const tech = f.technician === 'none' ? 'none' : isUuid(f.technician) ? String(f.technician) : null;
    const src = pick(RV_SOURCES, f.source);
    const fw = sql`${src ? sql`r.source = ${src}` : sql`true`} and ${tech === 'none' ? sql`r.technician_id is null` : tech ? sql`r.technician_id = ${tech}` : sql`true`}`;
    const rw = rg ? sql`coalesce(r.review_date, r.created_at) >= (${rg.from}::date)::timestamp at time zone ${tz} and coalesce(r.review_date, r.created_at) < ((${rg.to}::date + 1))::timestamp at time zone ${tz}` : sql`true`;
    const k = (await sql<any>`select count(*)::int as total,
        count(*) filter (where ${VERIFIED_REVIEW_SQL})::int as verified, avg(r.rating) filter (where ${VERIFIED_REVIEW_SQL}) as verified_avg,
        count(*) filter (where not coalesce(r.is_spam, false) and r.rating between 1 and 5)::int as received, avg(r.rating) filter (where not coalesce(r.is_spam, false) and r.rating between 1 and 5) as received_avg,
        count(*) filter (where ${PUBLIC_REVIEW_SQL})::int as public, count(*) filter (where coalesce(r.is_hidden_by_manager, false))::int as hidden,
        count(*) filter (where coalesce(r.is_spam, false))::int as spam, count(*) filter (where ${VERIFIED_REVIEW_SQL} and r.rating >= 4.5)::int as five,
        count(*) filter (where nullif(btrim(coalesce(r.comment, '')), '') is not null)::int as written,
        count(*) filter (where ${ATTENTION_SQL})::int as attention,
        count(*) filter (where coalesce(r.is_hidden_by_manager, false) and r.rating <= 2)::int as hidden_low,
        count(*) filter (where ${VERIFIED_REVIEW_SQL} and round(r.rating) = 5)::int as d5, count(*) filter (where ${VERIFIED_REVIEW_SQL} and round(r.rating) = 4)::int as d4,
        count(*) filter (where ${VERIFIED_REVIEW_SQL} and round(r.rating) = 3)::int as d3, count(*) filter (where ${VERIFIED_REVIEW_SQL} and round(r.rating) = 2)::int as d2,
        count(*) filter (where ${VERIFIED_REVIEW_SQL} and round(r.rating) = 1)::int as d1, max(r.created_at) as last_review
      from reviews r where r.tenant_id = ${ctx.tenantId} and ${this.branchW(ctx)} and ${rw} and ${fw}`.execute(db)).rows[0] ?? {};
    const dist = [{ star: 5, count: N(k.d5) }, { star: 4, count: N(k.d4) }, { star: 3, count: N(k.d3) }, { star: 2, count: N(k.d2) }, { star: 1, count: N(k.d1) }];
    const verified = N(k.verified);
    return {
      totalReviews: N(k.total), verifiedReviews: verified, averageRating: verified ? round1(k.verified_avg) : null,
      receivedReviews: N(k.received), averageAllReceived: N(k.received) ? round1(k.received_avg) : null,
      publicCount: N(k.public), hiddenCount: N(k.hidden), spamCount: N(k.spam), hiddenLowStarCount: N(k.hidden_low),
      withCommentCount: N(k.written), starOnlyCount: N(k.total) - N(k.written), needsAttention: N(k.attention),
      fiveStarPercent: verified ? Math.round((N(k.five) / verified) * 1000) / 10 : null,
      ratingDistribution: dist, lastReviewAt: iso(k.last_review),
      scope: { rating: 'verified: rated 1–5, not hidden by a manager, not spam — the same reviews Team Performance and Technicians count',
        allReceived: 'every non-spam rating, including hidden ones', public: 'verified and the customer allowed it to be public', date: rg ? `submitted ${rg.from} – ${rg.to}` : 'all time',
        technician: tech === 'none' ? 'no technician' : tech ? 'one technician' : 'all technicians', source: src ?? 'all sources' },
      range: rg, timezone: tz, today, evaluatedAt: new Date().toISOString(),
    };
  }

  // ── the feed (guide §05 – §07): server search + filters + date basis + sorts + pages 10/20/50 ────────────────────────
  async list(ctx: RvCtx, f: RvListFilters) {
    const T = ctx.tenantId;
    const { tz, today } = await this.tz(ctx);
    const q = str(f.q, 100);
    const rating = Math.trunc(N(f.rating));
    const comment = pick(RV_COMMENT, f.comment);
    const vis = pick(RV_VISIBILITY, f.visibility);
    const fu = pick(RV_FOLLOWUP, f.followup);
    const src = pick(RV_SOURCES, f.source);
    const tech = f.technician === 'none' ? 'none' : isUuid(f.technician) ? String(f.technician) : null;
    const service = isUuid(f.service) ? String(f.service) : null;
    const basis = pick(RV_BASES, f.basis) ?? 'submitted';
    const rg = this.range(today, f);
    const sort = pick(RV_SORTS, f.sort) ?? 'newest';
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if (f.rating != null && f.rating !== '' && !(rating >= 1 && rating <= 5)) throw new ReviewsCenterError('Choose a rating from 1 to 5 stars.', 'REVIEWS_FILTER_INVALID');
    const qd = q ? digits(q) : '';
    const w2 = q && /^\S+\s+\S+$/.test(q.trim()) ? q.trim().split(/\s+/).map((x) => x.replace(/[%_\\]/g, (m) => '\\' + m)) as [string, string] : null;
    // customer fields match ONLY through a real tenant link (c joined on tenant); anonymous reviews never match a name/phone
    const qw = q ? sql`(c.full_name ilike ${'%' + q + '%'} or c.email ilike ${'%' + q + '%'} or te.full_name ilike ${'%' + q + '%'} or r.comment ilike ${'%' + q + '%'}
        or r.hidden_reason ilike ${'%' + q + '%'} or r.source = ${q.toLowerCase()} or r.id::text = ${q} or c.id::text = ${q} or te.id::text = ${q}
        or coalesce(r.external_review_id, '') = ${q} or r.ticket_id::text = ${q} or r.appointment_id::text = ${q} or coalesce(tk.ticket_number::text, '') = ${q}
        or coalesce(sl.service_name_snapshot, '') ilike ${'%' + q + '%'}
        or (${/^[1-5]$/.test(q)} and round(r.rating)::text = ${q})
        or (${qd.length >= 4} and regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + qd + '%'})
        -- A17 Nov 6: "first last" (either order) matches the customer's first and last name separately
        or (${w2 != null} and ((c.first_name ilike ${(w2?.[0] ?? '') + '%'} and c.last_name ilike ${(w2?.[1] ?? '') + '%'}) or (c.first_name ilike ${(w2?.[1] ?? '') + '%'} and c.last_name ilike ${(w2?.[0] ?? '') + '%'}))))` : sql`true`;
    const asg = f.assignee === 'me' ? actorId(ctx) : f.assignee === 'none' ? 'none' : isUuid(f.assignee) ? String(f.assignee) : null;
    const aw = asg === 'none' ? sql`r.assigned_user_id is null` : asg ? sql`r.assigned_user_id = ${asg}` : sql`true`;
    const bc = this.basisCol(basis, tz);
    const where = sql`r.tenant_id = ${T} and ${this.branchW(ctx)} and ${qw} and ${aw}
      and ${rating ? sql`round(r.rating) = ${rating}` : sql`true`}
      and ${comment === 'written' ? sql`nullif(btrim(coalesce(r.comment, '')), '') is not null` : comment === 'star_only' ? sql`nullif(btrim(coalesce(r.comment, '')), '') is null` : sql`true`}
      and ${vis === 'public' ? PUBLIC_REVIEW_SQL : vis === 'not_public' ? sql`not (${PUBLIC_REVIEW_SQL})` : vis === 'hidden' ? sql`coalesce(r.is_hidden_by_manager, false)` : vis === 'spam' ? sql`coalesce(r.is_spam, false)` : sql`true`}
      and ${fu === 'responded' ? RESPONDED_SQL : fu === 'unanswered' ? sql`not ${RESPONDED_SQL}` : fu === 'needs_attention' ? ATTENTION_SQL : fu === 'reviewed' ? sql`coalesce(r.resolution_status, 'open') in ('resolved', 'no_action')` : sql`true`}
      and ${src ? sql`r.source = ${src}` : sql`true`}
      and ${tech === 'none' ? sql`r.technician_id is null` : tech ? sql`r.technician_id = ${tech}` : sql`true`}
      and ${service ? sql`sl.service_id = ${service}` : sql`true`}
      and ${rg ? sql`${bc} >= (${rg.from}::date)::timestamp at time zone ${tz} and ${bc} < ((${rg.to}::date + 1))::timestamp at time zone ${tz}` : sql`true`}`;
    const order = sort === 'oldest' ? sql`coalesce(r.review_date, r.created_at) asc, r.id asc`
      : sort === 'lowest' ? sql`r.rating asc, coalesce(r.review_date, r.created_at) desc, r.id desc`
      : sort === 'highest' ? sql`r.rating desc, coalesce(r.review_date, r.created_at) desc, r.id desc`
      : sort === 'moderated' ? sql`r.last_moderated_at desc nulls last, r.id desc`
      : sort === 'attention' ? sql`(${ATTENTION_SQL}) desc, r.rating asc, coalesce(r.review_date, r.created_at) asc, r.id asc`
      : sql`coalesce(r.review_date, r.created_at) desc, r.id desc`;
    const total = N((await sql<any>`select count(*)::int as n ${this.from()} where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select r.id, r.rating, r.comment, r.source, r.is_public, r.is_hidden_by_manager, r.is_spam, r.hidden_reason, r.moderation_version, r.last_moderated_at,
        coalesce(r.review_date, r.created_at) as submitted_at, r.technician_id, te.full_name as technician_name, r.customer_id, c.full_name as customer_name,
        sl.service_name_snapshot as service_name, r.ticket_id, ${RESPONDED_SQL} as responded, ${ATTENTION_SQL} as attention, r.resolution_status
      ${this.from()} where ${where} order by ${order} limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({
        id: String(r.id), rating: Number(r.rating), comment: str(r.comment, 4000) ?? null, starOnly: !str(r.comment, 4000), source: r.source, external: isExternal(r.source),
        isPublic: !!r.is_public, isHidden: !!r.is_hidden_by_manager, isSpam: !!r.is_spam, hiddenReason: r.hidden_reason ?? null,
        visibility: r.is_spam ? 'spam' : r.is_hidden_by_manager ? 'hidden' : r.is_public ? 'public' : 'not_public',
        moderationVersion: N(r.moderation_version), lastModeratedAt: iso(r.last_moderated_at), submittedAt: iso(r.submitted_at),
        technician: r.technician_id ? { id: String(r.technician_id), name: r.technician_name ?? null } : null,
        customer: r.customer_id && r.customer_name ? { id: String(r.customer_id), name: r.customer_name } : null,
        serviceName: r.service_name ?? null, ticketId: r.ticket_id ? String(r.ticket_id) : null,
        responded: !!r.responded, needsAttention: !!r.attention, resolution: r.resolution_status ?? 'open',
      })),
      totalItems: total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)),
      sort, basis, range: rg, timezone: tz, today,
    };
  }

  /** filter options from real rows only (technicians that have reviews, services on reviewed lines, sources present) */
  async options(ctx: RvCtx) {
    const T = ctx.tenantId;
    const tech = (await sql<any>`select distinct te.id, te.full_name from reviews r join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${this.branchW(ctx)} order by te.full_name limit 200`.execute(this.db)).rows;
    const svc = (await sql<any>`select distinct sl.service_id, sl.service_name_snapshot from reviews r join ticket_service_lines sl on sl.id = r.ticket_service_line_id and sl.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${this.branchW(ctx)} and sl.service_id is not null order by sl.service_name_snapshot limit 200`.execute(this.db)).rows;
    const src = (await sql<any>`select r.source, count(*)::int as n from reviews r where r.tenant_id = ${T} and ${this.branchW(ctx)} group by r.source order by r.source`.execute(this.db)).rows;
    return { technicians: tech.map((x: any) => ({ id: String(x.id), name: x.full_name })), services: svc.map((x: any) => ({ id: String(x.service_id), name: x.service_name_snapshot })),
      sources: src.map((x: any) => ({ source: x.source, count: N(x.n), external: isExternal(x.source) })), hideReasons: RV_HIDE_REASONS };
  }

  /** a technician's verified rating — the same predicate Team Performance ranks by */
  async technicianStats(ctx: RvCtx, technicianId: string, db: Kysely<any> = this.db) {
    const r = (await sql<any>`select count(*)::int as n, avg(r.rating) as avg, count(*) filter (where r.created_at >= now() - interval '90 days')::int as n90,
        avg(r.rating) filter (where r.created_at >= now() - interval '90 days') as avg90
      from reviews r where r.tenant_id = ${ctx.tenantId} and r.technician_id = ${technicianId} and ${VERIFIED_REVIEW_SQL}`.execute(db)).rows[0] ?? {};
    const p = (await sql<any>`select count(*)::int as n, avg(r.rating) as avg from reviews r where r.tenant_id = ${ctx.tenantId} and r.technician_id = ${technicianId} and ${PUBLIC_REVIEW_SQL}`.execute(db)).rows[0] ?? {};
    return { verifiedCount: N(r.n), verifiedAverage: N(r.n) ? round1(r.avg) : null, last90Count: N(r.n90), last90Average: N(r.n90) ? round1(r.avg90) : null,
      publicCount: N(p.n), publicAverage: N(p.n) ? round1(p.avg) : null, source: 'verified_reviews' };
  }

  // ── the overlay (guide §08) ────────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: RvCtx, id: string, opts: { fullContact: boolean; audit: AuditFn }) {
    if (!isUuid(id)) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`select r.*, coalesce(r.review_date, r.created_at) as submitted_at, te.full_name as technician_name, sl.service_name_snapshot as service_name,
          tk.ticket_number, tk.paid_at, tk.total_cents, tk.status as ticket_status, ap.appt_date, ap.start_time, ap.status as appt_status, b.name as branch_name,
          ${RESPONDED_SQL} as responded, ${ATTENTION_SQL} as attention
        ${this.from()} left join branches b on b.id = r.branch_id where r.id = ${id} and r.tenant_id = ${T} and ${this.branchW(ctx)}`.execute(trx)).rows[0];
      if (!r) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
      // the customer only through a real tenant link — never inferred from a name, phone or date
      const c = r.customer_id ? (await sql<any>`select c.id, c.full_name, c.normalized_phone, c.email, c.status,
            (select count(*)::int from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT_STATUSES}::text[])) as visits,
            (select max(coalesce(t.paid_at, t.created_at)) from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT_STATUSES}::text[])) as last_visit,
            (select count(*)::int from reviews x where x.tenant_id = c.tenant_id and x.customer_id = c.id) as reviews,
            (select count(*)::int from notifications n where n.tenant_id = c.tenant_id and n.customer_id = c.id) as messages
          from customers c where c.id = ${r.customer_id} and c.tenant_id = ${T}`.execute(trx)).rows[0] : null;
      const prior = c ? (await sql<any>`select x.id, x.rating, coalesce(x.review_date, x.created_at) as at from reviews x where x.tenant_id = ${T} and x.customer_id = ${c.id} and x.id <> ${id}
          order by coalesce(x.review_date, x.created_at) desc, x.id desc limit 5`.execute(trx)).rows : [];
      const tech = r.technician_id ? await this.technicianStats(ctx, String(r.technician_id), trx) : null;
      const draft = (await sql<any>`select id, status, current_text, current_version, is_auto, created_by_ai, updated_at from review_response_drafts where tenant_id = ${T} and review_id = ${id}`.execute(trx)).rows[0] ?? null;
      const versions = (await sql<any>`select version, edited_by_user_id, is_ai_generated, created_at from review_response_versions where tenant_id = ${T} and review_id = ${id} order by version desc limit 20`.execute(trx)).rows;
      const approvals = (await sql<any>`select action, actor_user_id, reason, version, created_at from review_approvals where tenant_id = ${T} and review_id = ${id} order by created_at desc limit 20`.execute(trx)).rows;
      const pubs = (await sql<any>`select result, external_response_id, error, is_auto, created_at from review_publications where tenant_id = ${T} and review_id = ${id} order by created_at desc limit 20`.execute(trx)).rows;
      const mod = (await sql<any>`select e.action, e.previous_hidden, e.new_hidden, e.reason_code, e.reason_text, e.evidence, e.source, e.created_at, e.actor_user_id, u.full_name as actor_name
          from review_moderation_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.review_id = ${id} order by e.created_at desc, e.id desc limit 50`.execute(trx)).rows;
      // A17 Nov 6: communication history — messages to this customer and review requests (newest first; bodies trimmed)
      const comms = c ? (await sql<any>`select n.id, n.channel, n.status, n.purpose, n.created_at, left(n.body, 160) body from notifications n
          where n.tenant_id = ${T} and n.customer_id = ${c.id} order by n.created_at desc, n.id desc limit 20`.execute(trx)).rows : [];
      const reqs = c ? (await sql<any>`select q.id, q.status, q.created_at from review_requests q where q.tenant_id = ${T} and q.customer_id = ${c.id} order by q.created_at desc limit 10`.execute(trx)).rows : [];
      const asg = r.assigned_user_id ? (await sql<any>`select full_name from users where id = ${r.assigned_user_id} and tenant_id = ${T}`.execute(trx)).rows[0] : null;
      if (c) await opts.audit(trx, { reviewId: id, customerId: String(c.id), fullContact: opts.fullContact });
      const external = isExternal(r.source);
      const verified = Number(r.rating) >= 1 && Number(r.rating) <= 5 && !r.is_hidden_by_manager && !r.is_spam;
      return {
        review: { id: String(r.id), rating: Number(r.rating), comment: str(r.comment, 4000) ?? null, starOnly: !str(r.comment, 4000), tags: Array.isArray(r.review_tags) ? r.review_tags.map(String) : [],
          source: r.source, external, externalReviewId: r.external_review_id ?? null, reviewerName: external ? (r.reviewer_name ?? null) : null,
          submittedAt: iso(r.submitted_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
          isPublic: !!r.is_public, isHidden: !!r.is_hidden_by_manager, isSpam: !!r.is_spam, hiddenReason: r.hidden_reason ?? null,
          moderationVersion: N(r.moderation_version), lastModeratedAt: iso(r.last_moderated_at),
          branch: r.branch_id ? { id: String(r.branch_id), name: r.branch_name ?? null } : null, responded: !!r.responded, needsAttention: !!r.attention,
          resolution: r.resolution_status ?? 'open', escalation: r.escalation_status ?? 'none', technicianResponse: r.technician_response ?? null, technicianResponseAt: iso(r.technician_response_at) },
        metric: { countsInVerifiedRating: verified, countsInPublicRating: verified && !!r.is_public && !!r.technician_id,
          why: r.is_spam ? 'Marked spam — excluded from every rating.' : r.is_hidden_by_manager ? 'Hidden by a manager — excluded from the verified rating and from public display, still counted in "all received".'
            : !r.is_public ? 'Counted in the verified rating; the customer did not make it public.' : 'Counted in the verified and the public rating.' },
        moderationScope: external
          ? `This review came from ${r.source}. Hiding it only hides it inside AI PowerSalon (POS, Customer App, technician profile). It stays on ${r.source}; AI PowerSalon cannot remove it there.`
          : 'Hiding removes it from the Customer App and the public technician profile and from the verified rating. The review text is kept and the change is recorded.',
        customer: c ? { id: String(c.id), name: c.full_name ?? null, phone: opts.fullContact ? (c.normalized_phone ?? null) : maskPhone(c.normalized_phone), email: opts.fullContact ? (c.email ?? null) : maskEmail(c.email),
          contactMasked: !opts.fullContact, status: c.status, visits: N(c.visits), lastVisitAt: iso(c.last_visit), reviews: N(c.reviews), messages: N(c.messages),
          priorReviews: prior.map((x: any) => ({ id: String(x.id), rating: Number(x.rating), at: iso(x.at) })), canBook: c.status !== 'archived' } : null,
        anonymous: !c,
        assignment: r.assigned_user_id ? { userId: String(r.assigned_user_id), name: asg?.full_name ?? null, at: iso(r.assigned_at) } : null,
        communications: { messages: comms.map((m: any) => ({ id: String(m.id), channel: m.channel, status: m.status, purpose: m.purpose ?? null, at: iso(m.created_at), preview: m.body ?? '' })),
          reviewRequests: reqs.map((x: any) => ({ id: String(x.id), status: x.status, at: iso(x.created_at) })) },
        technician: r.technician_id ? { id: String(r.technician_id), name: r.technician_name ?? null, ...tech } : null,
        visit: r.ticket_id || r.appointment_id ? { ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number ?? null, paidAt: iso(r.paid_at), totalCents: r.total_cents == null ? null : N(r.total_cents),
          ticketStatus: r.ticket_status ?? null, serviceName: r.service_name ?? null, appointmentId: r.appointment_id ? String(r.appointment_id) : null,
          appointmentDate: r.appt_date ? String(r.appt_date).slice(0, 10) : null, appointmentStart: r.start_time ? String(r.start_time).slice(0, 5) : null, appointmentStatus: r.appt_status ?? null } : null,
        response: { draft: draft ? { status: draft.status, text: draft.current_text ?? null, version: N(draft.current_version), isAuto: !!draft.is_auto, aiGenerated: !!draft.created_by_ai, updatedAt: iso(draft.updated_at) } : null,
          versions: versions.map((v: any) => ({ version: N(v.version), editedBy: v.edited_by_user_id ?? null, aiGenerated: !!v.is_ai_generated, at: iso(v.created_at) })),
          approvals: approvals.map((a: any) => ({ action: a.action, actor: a.actor_user_id ?? null, reason: a.reason ?? null, version: a.version == null ? null : N(a.version), at: iso(a.created_at) })),
          publications: pubs.map((p: any) => ({ result: p.result, externalResponseId: p.external_response_id ?? null, error: p.error ?? null, isAuto: !!p.is_auto, at: iso(p.created_at) })),
          publishable: external ? (r.source === 'google' ? 'needs_connection' : 'not_supported') : 'internal_only' },
        moderation: mod.map((e: any) => ({ action: e.action, previousHidden: !!e.previous_hidden, newHidden: !!e.new_hidden, reasonCode: e.reason_code ?? null, reasonText: e.reason_text ?? null,
          evidence: e.evidence ?? null, source: e.source, at: iso(e.created_at), actor: e.actor_user_id ? { id: String(e.actor_user_id), name: e.actor_name ?? null } : null })),
      };
    });
  }

  // ── Hide / Unhide (guide §09) ─────────────────────────────────────────────────────────────────────────────────────
  /** A17 Nov 6: give a review to a staff member to follow up (or take it back). Active staff of this salon only; audited. */
  async assign(ctx: RvCtx, id: string, b: { assignedUserId?: unknown }, audit: AuditFn) {
    if (!isUuid(id)) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
    const to = b.assignedUserId == null || b.assignedUserId === '' ? null : String(b.assignedUserId);
    if (to !== null && !isUuid(to)) throw new ReviewsCenterError('Choose a staff member.', 'REVIEWS_FILTER_INVALID');
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select r.id, r.assigned_user_id from reviews r where r.id = ${id} and r.tenant_id = ${T} and ${this.branchW(ctx)} for update`.execute(trx)).rows[0];
      if (!cur) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
      if (to) {
        const u = (await sql<any>`select id from users where id = ${to} and tenant_id = ${T} and status = 'active'`.execute(trx)).rows[0];
        if (!u) throw new ReviewsCenterError('That staff member is not active in this salon.', 'REVIEWS_FILTER_INVALID');
      }
      await sql`update reviews set assigned_user_id = ${to}, assigned_at = ${to ? sql`now()` : null}, assigned_by = ${to ? actorId(ctx) : null}, updated_at = now(), updated_by = ${actorId(ctx)}
        where id = ${id} and tenant_id = ${T}`.execute(trx);
      await audit(trx, { reviewId: id, from: cur.assigned_user_id ?? null, to });
      return { id, assignedUserId: to };
    });
  }
  async staff(ctx: RvCtx) {
    const rows = (await sql<any>`select id, full_name, role from users where tenant_id = ${ctx.tenantId} and status = 'active' and role = any(${['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION']}::text[])
      order by full_name, id limit 200`.execute(this.db)).rows;
    return { items: rows.map((u: any) => ({ id: String(u.id), name: u.full_name ?? '', role: u.role })) };
  }
  async lastCheck(ctx: RvCtx) {
    const r = (await sql<any>`select id, overall, checks, created_at from reviews_health_runs where tenant_id = ${ctx.tenantId} and branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null}
      order by created_at desc limit 1`.execute(this.db)).rows[0];
    return r ? { id: String(r.id), overall: String(r.overall), checks: r.checks ?? [], at: iso(r.created_at) } : null;
  }

  async moderate(ctx: RvCtx, id: string, b: ModerateBody, audit: AuditFn, opts: { legacy?: boolean } = {}) {
    if (!isUuid(id)) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
    const action = pick(RV_ACTIONS, b.action);
    if (!action) throw new ReviewsCenterError('Choose Hide or Unhide.', 'REVIEW_MODERATION_INVALID');
    const reasonCode = pick(RV_HIDE_REASONS, b.reasonCode);
    const reasonText = str(b.reasonText, 500) ?? null;
    const evidence = str(b.evidence, 500) ?? null;
    const idem = str(b.idempotencyKey, 120) ?? null;
    const expected = b.expectedVersion == null || b.expectedVersion === '' ? null : Math.trunc(N(b.expectedVersion));
    if (action === 'hide') {
      if (!reasonCode) throw new ReviewsCenterError('Choose why this review is being hidden.', 'HIDE_REVIEW_REASON_REQUIRED');
      if (reasonCode === 'other' && (!reasonText || reasonText.length < 5)) throw new ReviewsCenterError('Describe the reason (at least 5 characters).', 'HIDE_REVIEW_REASON_REQUIRED');
    }
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select r.id, r.rating, r.is_hidden_by_manager, r.moderation_version, r.branch_id, r.global_tech_profile_id, r.source from reviews r
          where r.id = ${id} and r.tenant_id = ${T} and ${this.branchW(ctx)} for update`.execute(trx)).rows[0];
      if (!cur) throw new ReviewsCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
      // the replay check runs AFTER the row lock: a retried request that waited behind its own first attempt sees that attempt's
      // event and answers "already done" instead of a version conflict
      if (idem) {
        const prior = (await sql<any>`select e.review_id, e.action from review_moderation_events e where e.tenant_id = ${T} and e.idempotency_key = ${idem}`.execute(trx)).rows[0];
        if (prior) {
          if (String(prior.review_id) !== id || prior.action !== action) throw new ReviewsCenterError('This request key was already used for a different change.', 'IDEMPOTENCY_KEY_REUSED', 409);
          return { replayed: true, ...(await this.current(trx, ctx, id)) };
        }
      }
      if (expected != null && N(cur.moderation_version) !== expected) throw new ReviewsCenterError('Someone else just changed this review. Reload and try again.', 'VERSION_CONFLICT', 409, { currentVersion: N(cur.moderation_version) });
      if (expected == null && !opts.legacy) throw new ReviewsCenterError('Reload the review and try again.', 'VERSION_CONFLICT', 409, { currentVersion: N(cur.moderation_version) });
      const hide = action === 'hide';
      if (!!cur.is_hidden_by_manager === hide) throw new ReviewsCenterError(hide ? 'This review is already hidden.' : 'This review is already visible.', 'REVIEW_MODERATION_NOOP', 409);
      // a low rating is never a reason on its own: a 1–2★ review may be hidden only for a stated policy reason
      if (hide && Number(cur.rating) <= 2 && reasonCode === 'other') throw new ReviewsCenterError('A low rating is not a reason to hide a review. Choose the policy reason (spam, abusive language, personal information, wrong salon / customer, duplicate or test).', 'HIDE_LOW_RATING_POLICY');
      const reasonStored = hide ? (reasonText ?? reasonCode ?? null) : null;
      await sql`update reviews set is_hidden_by_manager = ${hide}, hidden_reason = ${reasonStored}, moderation_version = moderation_version + 1, last_moderated_at = clock_timestamp(),
          updated_at = now(), updated_by = ${actorId(ctx)} where id = ${id} and tenant_id = ${T}`.execute(trx);
      await sql`insert into review_moderation_events (tenant_id, branch_id, review_id, actor_user_id, action, previous_hidden, new_hidden, reason_code, reason_text, evidence, source, idempotency_key)
        values (${T}, ${cur.branch_id}, ${id}, ${actorId(ctx)}, ${action}, ${!!cur.is_hidden_by_manager}, ${hide}, ${hide ? reasonCode ?? 'other' : null}, ${reasonText}, ${evidence}, ${opts.legacy ? 'legacy' : 'pos'}, ${idem})`.execute(trx);
      await audit(trx, { reviewId: id, action, reasonCode: hide ? reasonCode ?? 'other' : null, previousHidden: !!cur.is_hidden_by_manager, newHidden: hide, rating: Number(cur.rating), source: cur.source });
      if (cur.global_tech_profile_id) await recomputeTechRatingDenorm(trx, String(cur.global_tech_profile_id));
      return { replayed: false, ...(await this.current(trx, ctx, id)) };
    });
  }
  private async current(db: Kysely<any>, ctx: RvCtx, id: string) {
    const r = (await sql<any>`select id, is_hidden_by_manager, hidden_reason, moderation_version, last_moderated_at from reviews where id = ${id} and tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
    return { id, isHidden: !!r?.is_hidden_by_manager, hiddenReason: r?.hidden_reason ?? null, moderationVersion: N(r?.moderation_version), lastModeratedAt: iso(r?.last_moderated_at) };
  }

  // ── the assistant's facts (guide §11): written comments only — never invented, never sent ───────────────────────────
  async insights(ctx: RvCtx, f: { preset?: unknown; from?: unknown; to?: unknown } = {}) {
    const { tz, today } = await this.tz(ctx);
    const rg = this.range(today, f);
    const rw = rg ? sql`coalesce(r.review_date, r.created_at) >= (${rg.from}::date)::timestamp at time zone ${tz} and coalesce(r.review_date, r.created_at) < ((${rg.to}::date + 1))::timestamp at time zone ${tz}` : sql`true`;
    const T = ctx.tenantId;
    const base = sql`${this.branchW(ctx)} and ${rw} and not coalesce(r.is_spam, false)`;
    const c = (await sql<any>`select count(*) filter (where nullif(btrim(coalesce(r.comment, '')), '') is not null)::int as written, count(*)::int as total,
        count(*) filter (where nullif(btrim(coalesce(r.comment, '')), '') is not null and r.rating <= 2)::int as negative_written from reviews r where r.tenant_id = ${T} and ${base}`.execute(this.db)).rows[0] ?? {};
    const written = N(c.written);
    const MIN = 3;
    if (written < MIN) return { status: 'insufficient_written_feedback', minimum: MIN, writtenComments: written, starOnly: N(c.total) - written, themes: [], range: rg,
      message: written === 0 ? 'Insufficient written feedback: none of these reviews include a written comment, so there is nothing to analyze.' : `Insufficient written feedback: only ${written} written comment(s); at least ${MIN} are needed.` };
    // themes ONLY from what is stored: the customer's own tags and the existing review_analysis categories, each with its review ids
    const themes = (await sql<any>`select theme, count(distinct rid)::int as n, array_agg(distinct rid::text) as ids from (
        select jsonb_array_elements_text(case when jsonb_typeof(r.review_tags) = 'array' then r.review_tags else '[]'::jsonb end) as theme, r.id as rid from reviews r where r.tenant_id = ${T} and ${base} and nullif(btrim(coalesce(r.comment, '')), '') is not null
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(a.categories) = 'array' then a.categories else '[]'::jsonb end), r.id from reviews r join review_analysis a on a.review_id = r.id and a.tenant_id = r.tenant_id
          where r.tenant_id = ${T} and ${base} and nullif(btrim(coalesce(r.comment, '')), '') is not null) x group by theme order by n desc, theme limit 10`.execute(this.db)).rows;
    return { status: 'ok', minimum: MIN, writtenComments: written, starOnly: N(c.total) - written, negativeWritten: N(c.negative_written), range: rg,
      themes: themes.map((t: any) => ({ theme: t.theme, reviews: N(t.n), reviewIds: (t.ids ?? []).slice(0, 10) })),
      note: 'Themes come from the customers\' own tags and the stored review analysis. Reply drafts are written in the AI Review Assistant and need a manager\'s approval before anything is published.' };
  }

  // ── Check Review System (guide §13): READ-ONLY ─────────────────────────────────────────────────────────────────────
  async check(ctx: RvCtx, opts: { record?: boolean } = {}): Promise<{ overall: Check['state']; checks: Check[]; checkedAt: string }> {
    const T = ctx.tenantId; const at = new Date().toISOString();
    const B = this.branchW(ctx);
    const out: Check[] = [];
    const add = (key: string, state: Check['state'], title: string, evidence: string, action: string | null) => out.push({ key, state, title, evidence, active: state !== 'READY', action, actionCode: action ? RV_ACTION_CODES[action] ?? null : null, checkedAt: at });
    const safe = async (key: string, title: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { add(key, 'UNKNOWN', title, `The check could not run: ${String(e?.code ?? e?.message ?? e).slice(0, 120)}`, 'Run the check again; if it keeps failing, ask support.'); } };

    await safe('records', 'Record integrity', async () => {
      const r = (await sql<any>`select count(*)::int as n, count(*) filter (where r.rating is null or r.rating < 1 or r.rating > 5)::int as bad,
          count(*) filter (where r.technician_id is not null and not exists (select 1 from technicians te where te.id = r.technician_id and te.tenant_id = r.tenant_id))::int as orphan_tech,
          count(*) filter (where r.customer_id is not null and not exists (select 1 from customers c where c.id = r.customer_id and c.tenant_id = r.tenant_id))::int as orphan_cust
        from reviews r where r.tenant_id = ${T} and ${B}`.execute(this.db)).rows[0];
      const dup = N((await sql<any>`select count(*)::int as n from (select r.ticket_id, r.customer_id, coalesce(r.technician_id::text, '-') as tid from reviews r
          where r.tenant_id = ${T} and ${B} and r.ticket_id is not null and r.customer_id is not null group by 1, 2, 3 having count(*) > 1) x`.execute(this.db)).rows[0]?.n);
      const problems = N(r.bad) + N(r.orphan_tech) + N(r.orphan_cust);
      add('records', problems ? 'FAILED' : dup ? 'WARNING' : 'READY', 'Record integrity',
        `${N(r.n)} review record(s); ${N(r.bad)} with a rating outside 1–5; ${N(r.orphan_tech)} pointing at a technician not in this salon; ${N(r.orphan_cust)} pointing at a customer not in this salon; ${dup} possible duplicate(s) (same visit, customer and technician).`,
        problems ? 'Open the listed reviews with support; the records are not changed by this check.' : dup ? 'Review the possible duplicates; they are not merged or removed automatically.' : null);
    });
    await safe('aggregation', 'Rating calculation', async () => {
      const s = await this.summary(ctx);
      const ind = (await sql<any>`select count(*)::int as n, round(avg(rating)::numeric, 1) as avg from reviews where tenant_id = ${T} and ${isUuid(ctx.branchId) ? sql`branch_id = ${ctx.branchId}` : sql`true`}
          and rating between 1 and 5 and not coalesce(is_hidden_by_manager, false) and not coalesce(is_spam, false)`.execute(this.db)).rows[0];
      const same = N(ind.n) === s.verifiedReviews && (N(ind.n) === 0 ? s.averageRating == null : Number(ind.avg) === s.averageRating);
      const distSum = s.ratingDistribution.reduce((a, d) => a + d.count, 0);
      add('aggregation', same && distSum === s.verifiedReviews ? 'READY' : 'FAILED', 'Rating calculation',
        `Dashboard: ${s.verifiedReviews} verified review(s), average ${s.averageRating ?? 'N/A'}, distribution sums to ${distSum}. Direct query: ${N(ind.n)} review(s), average ${N(ind.n) ? Number(ind.avg) : 'N/A'}. 5-star share ${s.fiveStarPercent ?? 'N/A'}%; ${s.withCommentCount} of ${s.totalReviews} include a written comment.`,
        same && distSum === s.verifiedReviews ? null : 'The dashboard and the direct query disagree — report this to support; no number was changed.');
    });
    await safe('relationships', 'Customer, technician and visit links', async () => {
      const r = (await sql<any>`select count(*) filter (where r.customer_id is null)::int as anon, count(*) filter (where r.technician_id is null)::int as no_tech,
          count(*) filter (where r.ticket_id is not null and tk.id is null)::int as missing_ticket,
          count(*) filter (where r.ticket_id is not null and tk.id is not null and r.customer_id is not null and tk.customer_id is distinct from r.customer_id)::int as mismatch
        from reviews r left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id where r.tenant_id = ${T} and ${B}`.execute(this.db)).rows[0];
      const bad = N(r.missing_ticket) + N(r.mismatch);
      add('relationships', bad ? 'WARNING' : 'READY', 'Customer, technician and visit links',
        `${N(r.anon)} anonymous review(s) (kept anonymous); ${N(r.no_tech)} without a technician; ${N(r.missing_ticket)} linked to a visit that no longer exists; ${N(r.mismatch)} whose visit belongs to a different customer.`,
        bad ? 'Check those reviews\' visits; links are never rewritten automatically.' : null);
    });
    await safe('cross_module', 'Reviews, Technician Profiles and Team Performance agree', async () => {
      // public technician profile figure vs a fresh recompute from the same rows; internal modules share VERIFIED_REVIEW_SQL
      const r = (await sql<any>`select g.id, g.overall_rating, g.rating_count,
          (select count(*)::int from reviews r where r.global_tech_profile_id = g.id and r.technician_id is not null and ${PUBLIC_REVIEW_SQL}) as n,
          (select round(avg(r.rating)::numeric, 2) from reviews r where r.global_tech_profile_id = g.id and r.technician_id is not null and ${PUBLIC_REVIEW_SQL}) as avg
        from global_tech_profiles g where g.id in (select distinct r.global_tech_profile_id from reviews r where r.tenant_id = ${T} and ${B} and r.global_tech_profile_id is not null)`.execute(this.db)).rows;
      const stale = r.filter((x: any) => N(x.rating_count) !== N(x.n) || Math.abs(N(x.overall_rating) - (x.avg == null ? 0 : Number(x.avg))) > 0.01);
      add('cross_module', stale.length ? 'WARNING' : 'READY', 'Reviews, Technician Profiles and Team Performance agree',
        `Reviews, Team Performance, Technicians and Team Members count the same verified reviews (rated 1–5, not hidden, not spam). ${r.length} public technician profile(s) checked; ${stale.length} show a stored public rating that differs from its reviews.`,
        stale.length ? 'The stored public rating refreshes on the next hide / unhide or new rating for that technician; nothing was changed by this check.' : null);
    });
    await safe('moderation', 'Moderation and providers', async () => {
      const r = (await sql<any>`select count(*) filter (where coalesce(r.is_hidden_by_manager, false))::int as hidden,
          count(*) filter (where coalesce(r.is_hidden_by_manager, false) and not exists (select 1 from review_moderation_events e where e.review_id = r.id and e.tenant_id = r.tenant_id))::int as no_trail,
          count(*) filter (where coalesce(r.is_hidden_by_manager, false) and r.rating <= 2)::int as hidden_low,
          count(*) filter (where r.source = any(${[...RV_EXTERNAL_SOURCES]}::text[]))::int as external,
          max(r.last_synced_at) filter (where r.source = any(${[...RV_EXTERNAL_SOURCES]}::text[])) as last_sync,
          count(*) filter (where ${ATTENTION_SQL})::int as attention
        from reviews r where r.tenant_id = ${T} and ${B}`.execute(this.db)).rows[0];
      const syncAgeH = r.last_sync ? (Date.now() - new Date(r.last_sync).getTime()) / 3600000 : null;
      const state: Check['state'] = N(r.no_trail) ? 'FAILED' : N(r.hidden_low) || N(r.attention) || (N(r.external) && (syncAgeH == null || syncAgeH > 48)) ? 'WARNING' : 'READY';
      add('moderation', state, 'Moderation and providers',
        `${N(r.hidden)} hidden review(s), ${N(r.no_trail)} without a recorded moderation event; ${N(r.hidden_low)} hidden review(s) rated 1–2★; ${N(r.attention)} low rating(s) still need a response. ${N(r.external)} review(s) from Google / Facebook / Yelp${N(r.external) ? `, last synced ${r.last_sync ? new Date(r.last_sync).toISOString() : 'never'}` : ''}. Replies to Google need an active Google Business Profile connection; Facebook and Yelp replies are not supported here.`,
        N(r.no_trail) ? 'Hidden reviews without a trail predate the history; record a reason by unhiding and hiding them again if appropriate.' : N(r.hidden_low) ? 'Confirm each hidden 1–2★ review was hidden for a policy reason (open it → Moderation history).' : N(r.attention) ? 'Answer the low ratings (sort: Needs attention).' : null);
    });
    await safe('delivery', 'Review requests and jobs', async () => {
      const r = (await sql<any>`select count(*)::int as n, count(*) filter (where status = 'scheduled' and scheduled_for < now() - interval '24 hours')::int as stale,
          count(*) filter (where status = 'failed' and created_at >= now() - interval '7 days')::int as failed7, max(created_at) as last
        from review_requests where tenant_id = ${T}`.execute(this.db)).rows[0];
      const camp = N((await sql<any>`select count(*)::int as n from review_request_campaigns where tenant_id = ${T} and enabled`.execute(this.db)).rows[0]?.n);
      if (!N(r.n) && !camp) { add('delivery', 'UNKNOWN', 'Review requests and jobs', 'No review requests have been scheduled and no review request campaign is enabled, so delivery cannot be checked.', 'Turn on review requests in the AI Review Assistant settings if the salon wants them.'); return; }
      add('delivery', N(r.stale) || N(r.failed7) ? 'WARNING' : 'READY', 'Review requests and jobs',
        `${N(r.n)} review request(s) on record (${camp} enabled campaign(s)); ${N(r.stale)} scheduled more than 24 hours ago and still not sent; ${N(r.failed7)} failed in the last 7 days. Requests are sent the same way to every customer — never only to happy ones.`,
        N(r.stale) ? 'Check that the review-request job is running.' : N(r.failed7) ? 'Open Notifications to see why the requests failed.' : null);
    });
    const rank = { FAILED: 3, WARNING: 2, UNKNOWN: 1, READY: 0 } as const;
    const overall = out.reduce<Check['state']>((a, c) => (rank[c.state] > rank[a] ? c.state : a), 'READY');
    // A17 Nov 6: POST check/run records the run (its only write); GET check stays read-only
    if (opts.record) await sql`insert into reviews_health_runs (tenant_id, branch_id, overall, checks, run_by) values (${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${overall}, ${JSON.stringify(out)}::jsonb, ${actorId(ctx)})`.execute(this.db);
    return { overall, checks: out, checkedAt: at };
  }
}

export { recomputeTechRatingDenorm } from './reviews-public-denorm';
