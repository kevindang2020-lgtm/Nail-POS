// reputation-center.ts — AI Review & Reputation guide (Nov 1 2026): `/pos/reputation/*` — the read side of the eight-tab
// workspace and its read-only health check.
//
// No second ledger: everything is read from the module's own tables (reviews, review_response_drafts / _versions,
// review_approvals, review_escalations, review_internal_notes, review_recovery_actions, review_requests,
// integration_connections). The writes stay on the existing routes (`/pos/ai-review-reputation/:id/draft|approve|…`),
// which run the drafting service's state machine and safety checks.
//
// ONE metric definition, used by the Overview cards, Feedback Trends and Branch Comparison (the established ones, now
// computed from the authoritative rows instead of a 20 000-row in-memory read that swallowed errors as zeros):
//   reviews          = reviews in scope, excluding spam
//   average rating   = mean of ratings 1–5 (no rated review → "—", never 0)
//   negative share   = sentiment 'negative' ÷ reviews   (+ how many are classified at all)
//   awaiting         = drafts in 'awaiting_approval'
//   serious          = escalations not resolved
//   response rate    = reviews whose draft is 'published' (provider-confirmed) ÷ reviews — a draft or approval never counts
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { RetentionRepository, isUuid, salonPresetRange, maskStoredPhone, type RetentionContext, type BranchScope } from '@aipowersalon/customers';

type Row = Record<string, any>;
export type RepCenterCtx = RetentionContext;
export class ReputationCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}
export const RC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const RC_SOURCES = ['google', 'facebook', 'yelp', 'internal', 'survey', 'sms', 'email', 'app', 'support', 'manual'] as const;
export const RC_RESPONSE = ['unanswered', 'draft', 'awaiting_approval', 'approved', 'published', 'publish_failed', 'rejected'] as const;
export const RC_COMPLAINT = ['none', 'open', 'acknowledged', 'resolved'] as const;
export const RC_REVIEW_DATES = ['review', 'imported'] as const;
export const RC_REVIEW_SORTS = ['newest', 'oldest', 'rating_low', 'rating_high'] as const;
export const RC_APPROVAL_STATES = ['awaiting_approval', 'approved', 'publish_failed', 'draft_generated', 'rejected', 'published', 'all'] as const;
export const RC_COMPLAINT_STATES = ['open', 'acknowledged', 'resolved', 'active', 'all'] as const;
export const RC_REQUEST_STATES = ['scheduled', 'sent', 'delivered', 'failed', 'skipped', 'opted_out', 'converted', 'all'] as const;
export const RC_PAGE_SIZES = [10, 25, 50, 100] as const;
const PUBLISHABLE = new Set(['google_business_profile']);
const REVIEW_PROVIDERS = ['google_business_profile', 'facebook_pages', 'yelp'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
const likeOf = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
/** the response state of a review, from its draft (the authoritative row) */
const RESP = sql`(case when d.status is null then 'unanswered' when d.status in ('draft_generated', 'needs_revision') then 'draft' when d.status = 'publishing' then 'approved' else d.status end)`;
const COMPLAINT = sql`(case when e.id is null then 'none' when e.status = 'resolved' then 'resolved' when e.status = 'acknowledged' then 'acknowledged' else 'open' end)`;

export interface RcFilters { branch?: unknown; source?: unknown; preset?: unknown; from?: unknown; to?: unknown }

export class ReputationCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async scope(ctx: RepCenterCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new ReputationCenterError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'REPUTATION_INVALID_BRANCH', e?.status ?? 400); }
  }
  private inBranches(s: BranchScope, col = sql`r.branch_id`) { return s.branchIds ? sql`${col} = any(${s.branchIds}::uuid[])` : sql`true`; }
  private async period(ctx: RepCenterCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(RC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !z) throw new ReputationCenterError('Choose a From and a To date.', 'REPUTATION_INVALID_PERIOD');
      if (a > z) throw new ReputationCenterError('The From date must be on or before the To date.', 'REPUTATION_INVALID_PERIOD');
      from = a; to = z;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today: w.today, tz: w.tz };
  }
  private paging(f: { page?: unknown; pageSize?: unknown }) {
    const pageSize = (RC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    return { pageSize, page: Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1))) };
  }
  /** the shared review scope: tenant · authorized branches · not spam · source · review date in the period */
  private reviewWhere(T: string, s: BranchScope, f: RcFilters, per: { start: Date | null; end: Date | null }) {
    const w = [sql`r.tenant_id = ${T}`, sql`coalesce(r.is_spam, false) = false`, this.inBranches(s)];
    const source = pick(RC_SOURCES, f.source);
    if (f.source != null && f.source !== '' && !source) throw new ReputationCenterError('Unknown source.', 'REPUTATION_INVALID_FILTER', 400, { field: 'source' });
    if (source) w.push(sql`r.source = ${source}`);
    if (per.start && per.end) w.push(sql`coalesce(r.review_date, r.created_at) >= ${per.start} and coalesce(r.review_date, r.created_at) < ${per.end}`);
    return w;
  }
  private metricsSelect(_T: string) {
    return sql`count(*)::int as reviews, count(r.rating) filter (where r.rating between 1 and 5)::int as rated,
      round(avg(r.rating) filter (where r.rating between 1 and 5), 1)::float as avg_rating,
      count(*) filter (where r.sentiment = 'negative')::int as negative, count(*) filter (where r.sentiment is not null)::int as classified,
      count(*) filter (where d.status = 'awaiting_approval')::int as awaiting,
      count(*) filter (where d.status = 'published')::int as published,
      count(*) filter (where e.id is not null and e.status <> 'resolved')::int as serious`;
  }
  private metricsOut(m: Row) {
    return { reviews: N(m.reviews), averageRating: m.avg_rating == null ? null : N(m.avg_rating), ratedReviews: N(m.rated),
      negativeShare: pct(N(m.negative), N(m.reviews)), negativeReviews: N(m.negative), classifiedReviews: N(m.classified),
      awaitingApproval: N(m.awaiting), seriousComplaints: N(m.serious), responseRate: pct(N(m.published), N(m.reviews)), publishedResponses: N(m.published) };
  }
  private FROM() {
    // one draft per review (unique index); the review's LATEST complaint case — so a review is never counted twice
    return sql`reviews r left join review_response_drafts d on d.tenant_id = r.tenant_id and d.review_id = r.id
      left join lateral (select x.id, x.status, x.severity, x.signals, x.created_at, x.acknowledged_at, x.resolved_at, x.assigned_user_id from review_escalations x
        where x.tenant_id = r.tenant_id and x.review_id = r.id order by x.created_at desc, x.id desc limit 1) e on true`;
  }

  // ── Overview ──────────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: RepCenterCtx, f: RcFilters) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const per = await this.period(ctx, f);
    const W = sql.join(this.reviewWhere(T, s, f, per), sql` and `);
    const m = (await sql<Row>`select ${this.metricsSelect(T)} from ${this.FROM()} where r.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0] ?? {};
    const fresh = (await sql<Row>`select max(r.last_synced_at) as synced, max(r.created_at) as newest from reviews r where r.tenant_id = ${T} and ${this.inBranches(s)}`.execute(this.db)).rows[0] ?? {};
    const bySource = (await sql<Row>`select r.source, count(*)::int as n from reviews r where r.tenant_id = ${T} and ${W} group by r.source order by n desc`.execute(this.db)).rows;
    const recent = (await sql<Row>`select r.id, r.rating, r.source, r.reviewer_name, left(r.comment, 160) as excerpt, coalesce(r.review_date, r.created_at) as at, ${RESP} as response
      from ${this.FROM()} where r.tenant_id = ${T} and ${W} order by coalesce(r.review_date, r.created_at) desc, r.id desc limit 5`.execute(this.db)).rows;
    return {
      metrics: this.metricsOut(m),
      definitions: { negative: "sentiment 'negative' ÷ reviews", response: "a provider-confirmed published reply ÷ reviews (drafts and approvals do not count)",
        serious: 'complaint cases not resolved', awaiting: "drafts in 'awaiting approval'", excludes: 'spam' },
      sampleNote: N(m.reviews) < 20 ? 'small_sample' : null,
      bySource: bySource.map((x) => ({ source: x.source ?? 'unknown', count: N(x.n) })),
      recent: recent.map((x) => ({ id: String(x.id), rating: x.rating == null ? null : N(x.rating), source: x.source, reviewer: x.reviewer_name ?? null, excerpt: x.excerpt ?? null, at: iso(x.at), response: x.response })),
      freshness: { lastSyncAt: iso(fresh.synced), newestReviewAt: iso(fresh.newest), computedAt: new Date(this.now()).toISOString() },
      period: { preset: per.preset, from: per.from, to: per.to, today: per.today, timeZone: per.tz }, scope: { label: s.label, confined: s.confined },
    };
  }

  // ── Review Inbox ──────────────────────────────────────────────────────────────────────────────────────────────
  async reviews(ctx: RepCenterCtx, f: RcFilters & { q?: unknown; rating?: unknown; response?: unknown; complaint?: unknown; dateField?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const per = await this.period(ctx, f);
    const { page, pageSize } = this.paging(f);
    const dateField = pick(RC_REVIEW_DATES, f.dateField) ?? 'review';
    const where = this.reviewWhere(T, s, { ...f, preset: 'all', from: undefined, to: undefined }, { start: null, end: null });
    if (per.start && per.end) where.push(dateField === 'imported' ? sql`r.last_synced_at >= ${per.start} and r.last_synced_at < ${per.end}` : sql`coalesce(r.review_date, r.created_at) >= ${per.start} and coalesce(r.review_date, r.created_at) < ${per.end}`);
    const rating = f.rating != null && f.rating !== '' ? Number(f.rating) : null;
    if (rating != null) { if (![1, 2, 3, 4, 5].includes(rating)) throw new ReputationCenterError('Rating is 1 to 5.', 'REPUTATION_INVALID_FILTER', 400, { field: 'rating' }); where.push(sql`round(r.rating) = ${rating}`); }
    const response = pick(RC_RESPONSE, f.response); if (response) where.push(sql`${RESP} = ${response}`);
    const complaint = pick(RC_COMPLAINT, f.complaint); if (complaint) where.push(sql`${COMPLAINT} = ${complaint}`);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) where.push(sql`(r.comment ilike ${likeOf(q)} or r.reviewer_name ilike ${likeOf(q)} or r.external_review_id = ${q} or r.id::text = ${q} or r.source ilike ${likeOf(q)})`);
    const W = sql.join(where, sql` and `);
    const sort = pick(RC_REVIEW_SORTS, f.sort) ?? 'newest';
    const order = sort === 'oldest' ? sql`coalesce(r.review_date, r.created_at) asc, r.id asc` : sort === 'rating_low' ? sql`r.rating asc nulls last, coalesce(r.review_date, r.created_at) desc, r.id desc`
      : sort === 'rating_high' ? sql`r.rating desc nulls last, coalesce(r.review_date, r.created_at) desc, r.id desc` : sql`coalesce(r.review_date, r.created_at) desc, r.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${this.FROM()} where r.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.id, r.rating, r.source, r.reviewer_name, left(r.comment, 200) as excerpt, length(r.comment) as length, coalesce(r.review_date, r.created_at) as at, r.last_synced_at,
        r.sentiment, b.name as branch, ${RESP} as response, ${COMPLAINT} as complaint, e.severity
      from ${this.FROM()} left join branches b on b.id = r.branch_id and b.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: String(r.id), rating: r.rating == null ? null : N(r.rating), source: r.source, reviewer: r.reviewer_name ?? null, excerpt: r.excerpt ?? null,
        truncated: N(r.length) > 200, at: iso(r.at), lastSyncAt: iso(r.last_synced_at), sentiment: r.sentiment ?? null, branch: r.branch ?? null, response: r.response, complaint: r.complaint, severity: r.severity ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, rating, response: response ?? null, complaint: complaint ?? null, dateField, sort, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz } };
  }

  /** one review with its response history, approvals, complaint case, notes and recovery records */
  async review(ctx: RepCenterCtx, id: string, opts: { customerAccess: boolean }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    if (!isUuid(`${id}`)) throw new ReputationCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
    const r = (await sql<Row>`select r.id, r.rating, r.comment, r.source, r.external_review_id, r.reviewer_name, r.reviewer_url, r.review_date, r.created_at, r.updated_at, r.last_synced_at,
        r.sentiment, r.severity, r.is_public, r.is_spam, r.customer_id, r.branch_id, b.name as branch, c.full_name as customer_name, c.normalized_phone as customer_phone,
        d.id as draft_id, d.status as draft_status, d.current_text, d.current_version, d.is_auto, d.updated_at as draft_updated_at, ${RESP} as response,
        e.id as esc_id, e.status as esc_status, e.severity as esc_severity, e.signals, e.created_at as esc_created_at, e.acknowledged_at, e.resolved_at, coalesce(au.full_name, au.email) as esc_assignee
      from ${this.FROM()} left join branches b on b.id = r.branch_id and b.tenant_id = r.tenant_id
      left join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      left join users au on au.id = e.assigned_user_id and au.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and r.id = ${id}::uuid and ${this.inBranches(s)}`.execute(this.db)).rows[0];
    if (!r) throw new ReputationCenterError('Review not found.', 'REVIEW_NOT_FOUND', 404);
    const versions = (await sql<Row>`select v.version, v.text, v.is_ai_generated, v.created_at, coalesce(u.full_name, u.email) as editor from review_response_versions v left join users u on u.id = v.edited_by_user_id and u.tenant_id = v.tenant_id
      where v.tenant_id = ${T} and v.review_id = ${id}::uuid order by v.version desc, v.created_at desc limit 20`.execute(this.db)).rows;
    const approvals = (await sql<Row>`select a.action, a.reason, a.version, a.created_at, coalesce(u.full_name, u.email) as actor from review_approvals a left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.review_id = ${id}::uuid order by a.created_at desc, a.id desc limit 30`.execute(this.db)).rows;
    const notes = (await sql<Row>`select n.id, n.note, n.created_at, coalesce(u.full_name, u.email) as author from review_internal_notes n left join users u on u.id = n.author_user_id and u.tenant_id = n.tenant_id
      where n.tenant_id = ${T} and n.review_id = ${id}::uuid order by n.created_at desc, n.id desc limit 50`.execute(this.db)).rows;
    const recovery = (await sql<Row>`select action_type, status, created_at from review_recovery_actions where tenant_id = ${T} and review_id = ${id}::uuid order by created_at desc limit 20`.execute(this.db)).rows;
    const analysis = (await sql<Row>`select sentiment, severity, categories, serious_signals, confidence, model_version, analysis_source, analyzed_at from review_analysis
      where tenant_id = ${T} and review_id = ${id}::uuid order by analyzed_at desc limit 1`.execute(this.db)).rows[0];
    return {
      id: String(r.id), rating: r.rating == null ? null : N(r.rating), text: r.comment ?? null, source: r.source, externalId: r.external_review_id ?? null, reviewer: r.reviewer_name ?? null,
      reviewerUrl: r.reviewer_url ?? null, at: iso(r.review_date ?? r.created_at), importedAt: iso(r.created_at), updatedAt: iso(r.updated_at), lastSyncAt: iso(r.last_synced_at),
      branch: r.branch ?? null, sentiment: r.sentiment ?? null, severity: r.severity ?? null, isPublic: r.is_public ?? null,
      // a public reviewer name is never matched to a private customer; a link is shown only when the review was stored WITH one
      customer: r.customer_id ? (opts.customerAccess ? { id: String(r.customer_id), name: r.customer_name ?? null, phone: r.customer_phone ? maskStoredPhone(r.customer_phone) : null } : { id: null, name: null, phone: null, restricted: true }) : null,
      response: { state: r.response, draftStatus: r.draft_status ?? null, text: r.current_text ?? null, version: r.current_version == null ? null : N(r.current_version), isAuto: !!r.is_auto, updatedAt: iso(r.draft_updated_at),
        canPublishToProvider: r.source === 'google' && !!r.external_review_id,
        versions: versions.map((v) => ({ version: N(v.version), text: v.text, ai: !!v.is_ai_generated, by: v.editor ?? null, at: iso(v.created_at) })),
        approvals: approvals.map((a) => ({ action: a.action, reason: a.reason ?? null, version: a.version == null ? null : N(a.version), by: a.actor ?? null, at: iso(a.created_at) })) },
      complaint: r.esc_id ? { id: String(r.esc_id), status: r.esc_status, severity: r.esc_severity, signals: (r.signals ?? []) as string[], openedAt: iso(r.esc_created_at), acknowledgedAt: iso(r.acknowledged_at),
        resolvedAt: iso(r.resolved_at), assignee: r.esc_assignee ?? null } : null,
      analysis: analysis ? { sentiment: analysis.sentiment, severity: analysis.severity, categories: (analysis.categories ?? []) as string[], signals: (analysis.serious_signals ?? []) as string[],
        confidence: analysis.confidence == null ? null : N(analysis.confidence), model: analysis.model_version ?? null, source: analysis.analysis_source ?? null, at: iso(analysis.analyzed_at) } : null,
      notes: notes.map((n) => ({ id: String(n.id), note: n.note, by: n.author ?? null, at: iso(n.created_at) })),
      recovery: recovery.map((x) => ({ type: x.action_type, status: x.status, at: iso(x.created_at) })),
    };
  }

  // ── Response Approvals ────────────────────────────────────────────────────────────────────────────────────────
  async approvals(ctx: RepCenterCtx, f: RcFilters & { state?: unknown; q?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const { page, pageSize } = this.paging(f);
    const state = pick(RC_APPROVAL_STATES, f.state) ?? 'awaiting_approval';
    const where = [sql`d.tenant_id = ${T}`, sql`coalesce(r.is_spam, false) = false`, this.inBranches(s)];
    if (state !== 'all') where.push(state === 'approved' ? sql`d.status in ('approved', 'publishing')` : state === 'draft_generated' ? sql`d.status in ('draft_generated', 'needs_revision')` : sql`d.status = ${state}`);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) where.push(sql`(r.comment ilike ${likeOf(q)} or d.current_text ilike ${likeOf(q)} or r.reviewer_name ilike ${likeOf(q)})`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`review_response_drafts d join reviews r on r.id = d.review_id and r.tenant_id = d.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where d.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select d.review_id, d.status, left(d.current_text, 240) as draft, d.current_version, d.is_auto, d.updated_at, r.rating, r.source, r.reviewer_name, left(r.comment, 160) as excerpt,
        (select coalesce(u.full_name, u.email) from review_approvals a left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id where a.tenant_id = d.tenant_id and a.review_id = d.review_id order by a.created_at desc limit 1) as last_actor
      from ${FROM} where d.tenant_id = ${T} and ${W} order by d.updated_at desc, d.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const counts = Object.fromEntries((await sql<Row>`select d.status, count(*)::int as n from ${FROM} where d.tenant_id = ${T} and coalesce(r.is_spam, false) = false and ${this.inBranches(s)} group by d.status`.execute(this.db)).rows.map((x) => [x.status, N(x.n)]));
    return { items: rows.map((x) => ({ reviewId: String(x.review_id), status: x.status, draft: x.draft ?? null, version: N(x.current_version), isAuto: !!x.is_auto, updatedAt: iso(x.updated_at),
        rating: x.rating == null ? null : N(x.rating), source: x.source, reviewer: x.reviewer_name ?? null, excerpt: x.excerpt ?? null, lastActor: x.last_actor ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), counts, applied: { state, q: q || null } };
  }

  // ── Serious Complaints ────────────────────────────────────────────────────────────────────────────────────────
  async complaints(ctx: RepCenterCtx, f: RcFilters & { state?: unknown; severity?: unknown; q?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const per = await this.period(ctx, f);
    const { page, pageSize } = this.paging(f);
    const state = pick(RC_COMPLAINT_STATES, f.state) ?? 'active';
    const where = [sql`e.tenant_id = ${T}`, this.inBranches(s)];
    if (state === 'active') where.push(sql`e.status <> 'resolved'`); else if (state === 'open') where.push(sql`e.status not in ('acknowledged', 'resolved')`); else if (state !== 'all') where.push(sql`e.status = ${state}`);
    const sev = typeof f.severity === 'string' && /^[a-z_]{1,20}$/.test(f.severity) ? f.severity : null;
    if (sev) where.push(sql`e.severity = ${sev}`);
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) where.push(sql`(r.comment ilike ${likeOf(q)} or r.reviewer_name ilike ${likeOf(q)} or e.id::text = ${q})`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`review_escalations e join reviews r on r.id = e.review_id and r.tenant_id = e.tenant_id left join users u on u.id = e.assigned_user_id and u.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.review_id, e.status, e.severity, e.signals, e.created_at, e.acknowledged_at, e.resolved_at, coalesce(u.full_name, u.email) as assignee,
        r.rating, r.source, left(r.comment, 200) as excerpt
      from ${FROM} where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((x) => ({ id: String(x.id), reviewId: String(x.review_id), status: x.status, severity: x.severity, signals: (x.signals ?? []) as string[], openedAt: iso(x.created_at),
        acknowledgedAt: iso(x.acknowledged_at), resolvedAt: iso(x.resolved_at), assignee: x.assignee ?? null, rating: x.rating == null ? null : N(x.rating), source: x.source, excerpt: x.excerpt ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), applied: { state, severity: sev, q: q || null, preset: per.preset, from: per.from, to: per.to } };
  }

  // ── Feedback Trends (monthly, same definitions) ───────────────────────────────────────────────────────────────
  async trends(ctx: RepCenterCtx, f: RcFilters & { months?: unknown }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const months = Math.max(3, Math.min(24, Math.floor(Number(f.months) || 12)));
    const { tz, today } = await this.ret.window(ctx, { preset: 'today' });
    const W = sql.join(this.reviewWhere(T, s, { source: f.source }, { start: null, end: null }), sql` and `);
    const rows = (await sql<Row>`with m as (select generate_series(date_trunc('month', ${today}::date) - make_interval(months => ${months - 1}), date_trunc('month', ${today}::date), interval '1 month')::date as month)
      select m.month::text as month, x.* from m left join lateral (select ${this.metricsSelect(T)} from ${this.FROM()} where r.tenant_id = ${T} and ${W}
        and (coalesce(r.review_date, r.created_at) at time zone ${tz})::date >= m.month and (coalesce(r.review_date, r.created_at) at time zone ${tz})::date < (m.month + interval '1 month')::date) x on true order by m.month`.execute(this.db)).rows;
    return { months: rows.map((x) => ({ month: String(x.month).slice(0, 7), ...this.metricsOut(x), sample: N(x.reviews) < 5 ? 'too_few' : N(x.reviews) < 20 ? 'small' : 'ok' })), timeZone: tz,
      note: 'Associations over time, not causes. Months with few reviews are marked.' };
  }

  // ── Branch Comparison (authorized branches only, same definitions) ────────────────────────────────────────────
  async branches(ctx: RepCenterCtx, f: RcFilters) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const per = await this.period(ctx, f);
    const list = (await sql<Row>`select b.id, b.name from branches b where b.tenant_id = ${T} and ${s.branchIds ? sql`b.id = any(${s.branchIds}::uuid[])` : sql`true`} order by b.name, b.id`.execute(this.db)).rows;
    const W = sql.join(this.reviewWhere(T, { ...s, branchIds: null } as BranchScope, { source: f.source }, per), sql` and `);
    const by = new Map((await sql<Row>`select r.branch_id, ${this.metricsSelect(T)} from ${this.FROM()} where r.tenant_id = ${T} and ${W} and ${this.inBranches(s)} group by r.branch_id`.execute(this.db)).rows.map((x) => [String(x.branch_id), x]));
    const req = new Map((await sql<Row>`select branch_id, count(*) filter (where status in ('sent', 'delivered', 'converted'))::int as sent from review_requests where tenant_id = ${T} group by branch_id`.execute(this.db)).rows.map((x) => [String(x.branch_id), N(x.sent)]));
    return { branches: list.map((b) => { const m = by.get(String(b.id)); return { branchId: String(b.id), name: b.name, metrics: m && N(m.reviews) ? this.metricsOut(m) : null, requestsSent: req.get(String(b.id)) ?? 0 }; }),
      period: { preset: per.preset, from: per.from, to: per.to }, note: 'A branch with no reviews shows N/A, not 0%. Compare counts before comparing averages.' };
  }

  // ── Review Requests ───────────────────────────────────────────────────────────────────────────────────────────
  async requests(ctx: RepCenterCtx, f: RcFilters & { state?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const per = await this.period(ctx, f);
    const { page, pageSize } = this.paging(f);
    const state = pick(RC_REQUEST_STATES, f.state) ?? 'all';
    const where = [sql`q.tenant_id = ${T}`, this.inBranches(s, sql`q.branch_id`)];
    if (state !== 'all') where.push(sql`q.status = ${state}`);
    if (per.start && per.end) where.push(sql`q.created_at >= ${per.start} and q.created_at < ${per.end}`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`review_requests q left join customers c on c.id = q.customer_id and c.tenant_id = q.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where q.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select q.id, q.channel, q.status, q.scheduled_for, q.sent_at, q.created_at, c.full_name, c.first_name
      from ${FROM} where q.tenant_id = ${T} and ${W} order by q.created_at desc, q.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const counts = Object.fromEntries((await sql<Row>`select q.status, count(*)::int as n from review_requests q where q.tenant_id = ${T} and ${this.inBranches(s, sql`q.branch_id`)} group by q.status`.execute(this.db)).rows.map((x) => [x.status, N(x.n)]));
    const overdue = N((await sql<Row>`select count(*)::int as n from review_requests q where q.tenant_id = ${T} and q.status = 'scheduled' and q.scheduled_for < now() and ${this.inBranches(s, sql`q.branch_id`)}`.execute(this.db)).rows[0]?.n);
    return { items: rows.map((x) => ({ id: String(x.id), customer: String(x.full_name || x.first_name || '').trim() || null, channel: x.channel, status: x.status, scheduledFor: iso(x.scheduled_for), sentAt: iso(x.sent_at), createdAt: iso(x.created_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), counts, overdueNotSent: overdue,
      // the checkout hook schedules requests (eligibility: completed visit, consent, contact, frequency cap — never the predicted
      // rating); no sender is wired to deliver them, so "scheduled" is never shown as "sent"
      sender: { running: false }, applied: { state, preset: per.preset, from: per.from, to: per.to } };
  }

  // ── Integrations ──────────────────────────────────────────────────────────────────────────────────────────────
  async integrations(ctx: RepCenterCtx) {
    const T = ctx.tenantId;
    const conns = (await sql<Row>`select provider_key, branch_id, connection_status, authentication_status, sync_status, provider_account, token_expires_at, last_successful_sync_at, last_failed_sync_at, disabled_reason
      from integration_connections where tenant_id = ${T} and provider_key = any(${REVIEW_PROVIDERS}::text[]) order by provider_key, branch_id nulls first`.execute(this.db)).rows;
    const imports = (await sql<Row>`select source, count(*)::int as n, max(last_synced_at) as last from reviews where tenant_id = ${T} group by source`.execute(this.db)).rows;
    const mask = (v: unknown) => { const t = String(v ?? ''); return t ? (t.length <= 6 ? '••••' : `••••${t.slice(-4)}`) : null; };
    return {
      providers: ['google_business_profile', 'facebook_pages', 'yelp'].map((p) => {
        const c = conns.find((x) => x.provider_key === p);
        return { provider: p, connected: !!c && c.connection_status === 'active', status: c ? c.connection_status : 'not_connected', authentication: c?.authentication_status ?? null, sync: c?.sync_status ?? null,
          account: mask(c?.provider_account), tokenExpiresAt: iso(c?.token_expires_at), lastSuccessAt: iso(c?.last_successful_sync_at), lastFailureAt: iso(c?.last_failed_sync_at), disabledReason: c?.disabled_reason ?? null,
          canPublishReplies: PUBLISHABLE.has(p) };
      }),
      imports: imports.map((x) => ({ source: x.source ?? 'unknown', reviews: N(x.n), lastSyncAt: iso(x.last) })),
    };
  }

  // ── Check Reputation System (read-only; records its own evidence; one run per salon per 30 s) ─────────────────
  async check(ctx: RepCenterCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from review_reputation_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const total = N((await one(sql<Row>`select count(*)::int as n from reviews where tenant_id = ${T}`)).n);
    checks.push({ key: 'reviews_present', state: total ? 'PASSED' : 'INSUFFICIENT_DATA', count: total });
    const ints = await this.integrations(ctx);
    const connected = ints.providers.filter((p) => p.connected).length;
    checks.push({ key: 'provider_connected', state: connected ? 'PASSED' : 'WARNING', count: connected });
    const failing = ints.providers.filter((p) => p.connected && p.lastFailureAt && (!p.lastSuccessAt || p.lastFailureAt > p.lastSuccessAt)).length;
    checks.push({ key: 'provider_sync', state: failing ? 'FAILED' : connected ? 'PASSED' : 'INSUFFICIENT_DATA', count: failing });
    const expired = ints.providers.filter((p) => p.connected && p.tokenExpiresAt && Date.parse(p.tokenExpiresAt) < this.now()).length;
    checks.push({ key: 'credentials_valid', state: expired ? 'FAILED' : 'PASSED', count: expired });
    // the review's own response_status must agree with its draft (it did not, so the KPIs read 0)
    const drift = N((await one(sql<Row>`select count(*)::int as n from review_response_drafts d join reviews r on r.id = d.review_id and r.tenant_id = d.tenant_id
      where d.tenant_id = ${T} and r.response_status is distinct from d.status`)).n);
    checks.push({ key: 'response_state_consistent', state: drift ? 'WARNING' : 'PASSED', count: drift });
    const unanalyzed = N((await one(sql<Row>`select count(*)::int as n from reviews r where r.tenant_id = ${T} and r.comment is not null and r.sentiment is null`)).n);
    checks.push({ key: 'analysis_coverage', state: !total ? 'INSUFFICIENT_DATA' : unanalyzed ? 'WARNING' : 'PASSED', count: unanalyzed });
    const failedPublish = N((await one(sql<Row>`select count(*)::int as n from review_response_drafts where tenant_id = ${T} and status = 'publish_failed'`)).n);
    checks.push({ key: 'publishing', state: failedPublish ? 'WARNING' : 'PASSED', count: failedPublish });
    const stuck = N((await one(sql<Row>`select count(*)::int as n from review_response_drafts where tenant_id = ${T} and status = 'publishing' and updated_at < now() - interval '15 minutes'`)).n);
    checks.push({ key: 'publish_stuck', state: stuck ? 'WARNING' : 'PASSED', count: stuck });
    const highNoCase = N((await one(sql<Row>`select count(*)::int as n from reviews r where r.tenant_id = ${T} and r.severity in ('high', 'critical')
      and not exists (select 1 from review_escalations e where e.tenant_id = r.tenant_id and e.review_id = r.id)`)).n);
    checks.push({ key: 'complaints_tracked', state: highNoCase ? 'WARNING' : 'PASSED', count: highNoCase });
    const overdueCases = N((await one(sql<Row>`select count(*)::int as n from review_escalations where tenant_id = ${T} and status = 'open' and created_at < now() - interval '2 days'`)).n);
    checks.push({ key: 'complaints_acknowledged', state: overdueCases ? 'WARNING' : 'PASSED', count: overdueCases });
    const overdueReq = N((await one(sql<Row>`select count(*)::int as n from review_requests where tenant_id = ${T} and status = 'scheduled' and scheduled_for < now()`)).n);
    checks.push({ key: 'requests_delivery', state: overdueReq ? 'WARNING' : 'PASSED', count: overdueReq });
    const cross = N((await one(sql<Row>`select
        (select count(*) from review_response_drafts d join reviews r on r.id = d.review_id where d.tenant_id = ${T} and r.tenant_id <> d.tenant_id)
      + (select count(*) from review_escalations e join reviews r on r.id = e.review_id where e.tenant_id = ${T} and r.tenant_id <> e.tenant_id)
      + (select count(*) from reviews r join customers c on c.id = r.customer_id where r.tenant_id = ${T} and c.tenant_id <> r.tenant_id) as n`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_automatic_actions', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('review-reputation-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into review_reputation_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
