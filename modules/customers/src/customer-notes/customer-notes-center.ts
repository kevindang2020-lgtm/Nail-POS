// customer-notes-center.ts — Customer Notes SUNMI guide (Nov 9 2026): `/pos/customer-notes/*`, the salon-wide notes workspace.
//
// It OWNS NO NOTE TEXT. The notes are the ones staff already keep:
//   • customers.notes_json (+ legacy mirrors customers.notes / customers.safety_notes for rows written before migration 347)
//   • tickets.service_done_notes — the technician's visit note written at Service Done
// and they map onto the guide's six categories (§10):
//   general (salonNotes) · service_preference (preferredStyle + servicePreferences) · technician_preference (preferredTechnician) ·
//   allergy (allergyNotes) · warning (warnings) · visit (Service Done note of one ticket).
// The only thing this module writes is the Review & Accuracy step (customer_note_reviews, migration 843): a person confirms a
// safety note (allergy / warning) or marks it for correction. A review is tied to the exact text it read (sha256), so an edit
// puts the note back into "needs review" by itself — nothing is ever auto-confirmed.
//
// Scope: customers are tenant-wide (Retention CR-02); a branch-confined role sees customers whose home branch or activity is in
// its branches, and only visit notes of tickets in those branches. Every read needs pos.customers.notes.view; a review needs
// pos.customers.notes.edit. Counts never include rows the session cannot see.
import { sql, type Kysely } from 'kysely';
import type { CnSummaryResponse, CnListResponse, CnDetailResponse, CnCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { RetentionRepository, isUuid, maskPhone, type RetentionContext, type BranchScope } from '../retention/retention.repository';

type Row = Record<string, any>;
export type CnCtx = RetentionContext;

export class CustomerNotesError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const CN_CATEGORIES = ['general', 'service_preference', 'technician_preference', 'allergy', 'warning', 'visit'] as const;
export type CnCategory = typeof CN_CATEGORIES[number];
/** safety notes are the ones that need a person's review (guide §10, §11) */
export const CN_SAFETY: readonly CnCategory[] = ['allergy', 'warning'];
export const CN_REVIEW = ['needs_review', 'reviewed', 'needs_correction', 'not_required'] as const;
export const CN_DATE_FIELDS = ['updated', 'reviewed'] as const;
export const CN_PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
export const CN_SORTS = ['newest', 'oldest', 'name'] as const;
export const CN_PAGE_SIZES = [10, 25, 50, 100] as const;
export const CN_DECISIONS = ['confirmed', 'needs_correction'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PREVIEW = 120;

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const preview = (s: unknown) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > PREVIEW ? { text: t.slice(0, PREVIEW), truncated: true } : { text: t, truncated: false }; };

export interface CnQuery { q?: unknown; category?: unknown; review?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }

export class CustomerNotesCenter {
  private readonly ret: RetentionRepository;
  constructor(readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async scope(ctx: CnCtx): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, undefined); }
    catch (e: any) { throw new CustomerNotesError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'CUSTOMER_NOTES_INVALID_BRANCH', e?.status ?? 400); }
  }
  /** which customers the session may see (CR-02: home branch OR activity in an authorized branch) */
  private customerScope(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  private ticketScope(s: BranchScope) { return s.branchIds ? sql`t.branch_id = any(${s.branchIds}::uuid[])` : sql`true`; }

  /** every note entry the session may see — one row per (customer, category) for profile notes, one per ticket for visit notes.
   *  Review state: safety notes only — the LATEST review of the CURRENT text (sha256) decides; otherwise needs_review. */
  private entries(T: string, s: BranchScope) {
    const j = (k: string) => sql`nullif(btrim(coalesce(c.notes_json->>${k}, '')), '')`;
    const general = sql`coalesce(${j('salonNotes')}, case when c.notes_json is null then nullif(btrim(coalesce(c.notes, '')), '') end)`;
    const warning = sql`coalesce(${j('warnings')}, case when c.notes_json is null then nullif(btrim(coalesce(c.safety_notes, '')), '') end)`;
    const pref = sql`nullif(concat_ws(' · ', ${j('preferredStyle')}, ${j('servicePreferences')}), '')`;
    return sql`(
      with cust as (
        select c.id, c.full_name, c.normalized_phone, c.phone_display, coalesce(c.notes_updated_at, c.updated_at) as at,
          ${general} as general, ${pref} as service_preference, ${j('preferredTechnician')} as technician_preference, ${j('allergyNotes')} as allergy, ${warning} as warning
        from customers c where c.tenant_id = ${T} and c.archived_at is null and ${this.customerScope(s)}
      ), prof as (
        select id as customer_id, full_name, normalized_phone, phone_display, 'general'::text as category, general as body, at, null::uuid as ticket_id from cust where general is not null
        union all select id, full_name, normalized_phone, phone_display, 'service_preference', service_preference, at, null from cust where service_preference is not null
        union all select id, full_name, normalized_phone, phone_display, 'technician_preference', technician_preference, at, null from cust where technician_preference is not null
        union all select id, full_name, normalized_phone, phone_display, 'allergy', allergy, at, null from cust where allergy is not null
        union all select id, full_name, normalized_phone, phone_display, 'warning', warning, at, null from cust where warning is not null
      ), visit as (
        select t.customer_id, c.full_name, c.normalized_phone, c.phone_display, 'visit'::text as category, btrim(t.service_done_notes) as body,
          coalesce(t.service_done_at, t.paid_at, t.created_at) as at, t.id as ticket_id
        from tickets t join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
        where t.tenant_id = ${T} and t.removed_at is null and c.archived_at is null and nullif(btrim(coalesce(t.service_done_notes, '')), '') is not null and ${this.ticketScope(s)}
      ), allrows as (select * from prof union all select * from visit)
      select a.*, encode(sha256(convert_to(a.body, 'UTF8')), 'hex') as hash, rv.decision, rv.created_at as reviewed_at, rv.reviewer_user_id,
        case when a.category not in ('allergy', 'warning') then 'not_required'
             when rv.decision is null then 'needs_review'
             when rv.decision = 'confirmed' then 'reviewed' else 'needs_correction' end as review
      from allrows a
      left join lateral (select r.decision, r.created_at, r.reviewer_user_id from customer_note_reviews r
          where r.tenant_id = ${T} and r.customer_id = a.customer_id and r.category = a.category and a.category in ('allergy', 'warning')
            and r.content_hash = encode(sha256(convert_to(a.body, 'UTF8')), 'hex')
          order by r.created_at desc, r.id desc limit 1) rv on true
    )`;
  }

  private async period(ctx: CnCtx, f: CnQuery) {
    const preset = pick(CN_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'custom') {
      const from = typeof f.from === 'string' && DAY.test(f.from) ? f.from : null, to = typeof f.to === 'string' && DAY.test(f.to) ? f.to : null;
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new CustomerNotesError('Choose a From and a To date.', 'CUSTOMER_NOTES_INVALID_PERIOD');
      if (from > to) throw new CustomerNotesError('The From date must be on or before the To date.', 'CUSTOMER_NOTES_INVALID_PERIOD');
    }
    if (preset === 'all') { const w = await this.ret.window(ctx, { preset: 'today' }); return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz }; }
    try { const w = await this.ret.window(ctx, { preset, from: f.from, to: f.to }); return { preset, from: w.from, to: w.to, start: w.start, end: w.end, today: w.today, tz: w.tz }; }
    catch (e: any) { throw new CustomerNotesError(e?.message ?? 'Choose a valid period.', 'CUSTOMER_NOTES_INVALID_PERIOD'); }
  }

  /** the four cards (guide §05) — every number is from rows this session may see */
  async summary(ctx: CnCtx): Promise<CnSummaryResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const r = (await sql<Row>`select count(distinct customer_id)::int as customers,
        count(*) filter (where category = 'warning')::int as warnings,
        count(*) filter (where category in ('service_preference', 'technician_preference'))::int as preferences,
        count(*) filter (where review = 'needs_review')::int as needs_review,
        count(*) filter (where review = 'needs_correction')::int as needs_correction,
        count(*)::int as entries, max(at) as last_at
      from ${this.entries(T, s)} e`.execute(this.db)).rows[0] ?? {};
    return {
      asOf: new Date(this.now()).toISOString(),
      cards: { customersWithNotes: N(r.customers), safetyWarnings: N(r.warnings), preferencesRecorded: N(r.preferences), needsReview: N(r.needs_review) },
      needsCorrection: N(r.needs_correction), entries: N(r.entries), lastUpdatedAt: iso(r.last_at),
      definitions: { customersWithNotes: 'distinct_customers_with_a_note', safetyWarnings: 'customers_with_a_critical_service_warning', preferencesRecorded: 'service_and_technician_preference_entries', needsReview: 'safety_notes_whose_current_text_has_no_review' },
      scope: { label: s.label, confined: s.confined },
    };
  }

  /** the notes table: q (customer name · phone · note words) · category · review · which date + range · sort · pages */
  async list(ctx: CnCtx, f: CnQuery): Promise<CnListResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const pageSize = (CN_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const category = pick(CN_CATEGORIES, f.category) ?? null;
    const review = pick(CN_REVIEW, f.review) ?? null;
    const dateField = pick(CN_DATE_FIELDS, f.dateField) ?? 'updated';
    const sort = pick(CN_SORTS, f.sort) ?? 'newest';
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new CustomerNotesError('Type at least 2 characters to search.', 'CUSTOMER_NOTES_SEARCH_TOO_SHORT');
    const per = await this.period(ctx, f);
    const where: any[] = [sql`true`];
    if (category) where.push(sql`e.category = ${category}`);
    if (review) where.push(sql`e.review = ${review}`);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const like = '%' + likeEsc(q) + '%';
      where.push(sql`(vi_fold(coalesce(e.full_name, '')) like '%' || vi_fold(${likeEsc(q)}) || '%' or e.body ilike ${like}
        ${digits.length >= 4 ? sql`or regexp_replace(coalesce(e.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}` : sql``})`);
    }
    if (per.start && per.end) {
      const col = dateField === 'reviewed' ? sql`e.reviewed_at` : sql`e.at`;
      where.push(sql`${col} >= ${per.start.toISOString()}::timestamptz and ${col} < ${per.end.toISOString()}::timestamptz`);
    }
    const w = sql.join(where, sql` and `);
    const order = sort === 'oldest' ? sql`e.at asc nulls last, e.customer_id asc, e.category asc` : sort === 'name' ? sql`lower(e.full_name) asc, e.customer_id asc, e.category asc` : sql`e.at desc nulls last, e.customer_id desc, e.category asc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${this.entries(T, s)} e where ${w}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(page, totalPages);
    const rows = (await sql<Row>`select e.* from ${this.entries(T, s)} e where ${w} order by ${order} limit ${pageSize} offset ${(p - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({
        customerId: String(r.customer_id), customer: r.full_name ?? null, phone: maskPhone(r.normalized_phone ?? r.phone_display),
        category: r.category as CnCategory, preview: preview(r.body), at: iso(r.at), ticketId: r.ticket_id ? String(r.ticket_id) : null,
        review: r.review as typeof CN_REVIEW[number], reviewedAt: iso(r.reviewed_at), safety: CN_SAFETY.includes(r.category),
      })),
      total, page: p, pageSize, totalPages,
      applied: { q: q || null, category, review, dateField, sort, preset: per.preset, from: per.from, to: per.to },
      period: { today: per.today, timeZone: per.tz },
    };
  }

  /** one customer's notes: every category with its text, review state and review history (and the latest visit notes) */
  async detail(ctx: CnCtx, customerId: string): Promise<CnDetailResponse> {
    if (!isUuid(customerId)) throw new CustomerNotesError('That customer was not found.', 'CUSTOMER_NOTES_NOT_FOUND', 404);
    const T = ctx.tenantId; const s = await this.scope(ctx);
    const c = (await sql<Row>`select c.id, c.full_name, c.normalized_phone, c.phone_display, c.notes_json, coalesce(c.notes_updated_at, c.updated_at) as at from customers c
      where c.tenant_id = ${T} and c.id = ${customerId} and c.archived_at is null and ${this.customerScope(s)}`.execute(this.db)).rows[0];
    if (!c) throw new CustomerNotesError('That customer was not found.', 'CUSTOMER_NOTES_NOT_FOUND', 404);
    const entries = (await sql<Row>`select e.* from ${this.entries(T, s)} e where e.customer_id = ${customerId} order by (e.category = 'visit'), e.at desc nulls last limit 40`.execute(this.db)).rows;
    const history = (await sql<Row>`select r.category, r.decision, r.reason, r.created_at, r.content_hash, u.full_name as reviewer from customer_note_reviews r
      left join users u on u.id = r.reviewer_user_id and u.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and r.customer_id = ${customerId} order by r.created_at desc, r.id desc limit 20`.execute(this.db)).rows;
    const json = (c.notes_json && typeof c.notes_json === 'object') ? c.notes_json : {};
    return {
      customer: { id: String(c.id), name: c.full_name ?? null, phone: maskPhone(c.normalized_phone ?? c.phone_display), customerVisible: !!json.customerVisible, updatedAt: iso(c.at) },
      entries: entries.map((r) => ({ category: r.category as CnCategory, text: String(r.body), hash: String(r.hash), at: iso(r.at), ticketId: r.ticket_id ? String(r.ticket_id) : null,
        review: r.review, reviewedAt: iso(r.reviewed_at), safety: CN_SAFETY.includes(r.category) })),
      history: history.map((h) => ({ category: h.category, decision: h.decision, reason: h.reason ?? null, at: iso(h.created_at), reviewer: h.reviewer ?? null, current: entries.some((e) => e.category === h.category && e.hash === h.content_hash) })),
    };
  }

  /** Review & Accuracy (guide §11): a person confirms the CURRENT text of a safety note, or marks it for correction.
   *  The hash the reviewer read must still be the note's text — an edit in between answers 409 and nothing is written. */
  async review(ctx: CnCtx, b: { customerId?: unknown; category?: unknown; contentHash?: unknown; decision?: unknown; reason?: unknown }): Promise<CnDetailResponse> {
    const customerId = typeof b.customerId === 'string' && isUuid(b.customerId) ? b.customerId : null;
    const category = pick(CN_SAFETY as unknown as readonly string[], b.category) as CnCategory | undefined;
    const decision = pick(CN_DECISIONS, b.decision);
    const hash = typeof b.contentHash === 'string' && /^[0-9a-f]{64}$/.test(b.contentHash) ? b.contentHash : null;
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) || null : null;
    if (!customerId || !category || !decision || !hash) throw new CustomerNotesError('Choose a safety note and a decision.', 'CUSTOMER_NOTES_INVALID_REVIEW');
    if (decision === 'needs_correction' && !reason) throw new CustomerNotesError('Say what needs correcting.', 'CUSTOMER_NOTES_REASON_REQUIRED');
    const d = await this.detail(ctx, customerId);
    const cur = d.entries.find((e) => e.category === category);
    if (!cur) throw new CustomerNotesError('That note is empty now.', 'CUSTOMER_NOTES_NOT_FOUND', 404);
    if (cur.hash !== hash) throw new CustomerNotesError('This note was changed after you opened it. Read it again before reviewing.', 'CUSTOMER_NOTES_CHANGED', 409);
    await sql`insert into customer_note_reviews (tenant_id, customer_id, category, content_hash, decision, reason, reviewer_user_id)
      values (${ctx.tenantId}, ${customerId}, ${category}, ${hash}, ${decision}, ${reason}, ${isUuid(ctx.userId) ? ctx.userId : null})`.execute(this.db);
    return this.detail(ctx, customerId);
  }

  /** Check Customer Notes System — read-only (guide §15): nothing here edits a note or a review */
  async check(ctx: CnCtx): Promise<CnCheckResponse> {
    const T = ctx.tenantId; const s = await this.scope(ctx);
    type C = { key: string; state: 'READY' | 'WARNING' | 'FAILED'; count?: number };
    const checks: C[] = [];
    const bad = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.notes_json is not null and jsonb_typeof(c.notes_json) <> 'object'`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'notes_readable', state: bad ? 'FAILED' : 'READY', count: bad });
    const drift = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and jsonb_typeof(c.notes_json) = 'object'
        and (coalesce(c.notes, '') <> coalesce(c.notes_json->>'salonNotes', '') or coalesce(c.safety_notes, '') <> coalesce(c.notes_json->>'warnings', ''))`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'legacy_mirror', state: drift ? 'WARNING' : 'READY', count: drift });
    const stale = N((await sql<Row>`select count(*)::int as n from ${this.entries(T, s)} e where e.review = 'needs_review' and e.at < now() - interval '7 days'`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'safety_review_backlog', state: stale ? 'WARNING' : 'READY', count: stale });
    const corr = N((await sql<Row>`select count(*)::int as n from ${this.entries(T, s)} e where e.review = 'needs_correction'`.execute(this.db)).rows[0]?.n);
    checks.push({ key: 'corrections_open', state: corr ? 'WARNING' : 'READY', count: corr });
    checks.push({ key: 'no_side_effects', state: 'READY' });
    const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : 'READY';
    return { overall, checkedAt: new Date(this.now()).toISOString(), checks };
  }
}
