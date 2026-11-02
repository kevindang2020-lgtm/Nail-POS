// customer-search-center.ts — Customer Search Complete Build Guide (Nov 1 2026): `/pos/customer-search/*`.
//
// A secure discovery layer over the salon's authorized customer directory. It OWNS NO DATA: identity is Customer
// Management (customers), appointments are Booking (pos_tech_appointments), completed work is Service Done / Checkout
// (settled tickets + their service lines), points are the Loyalty ledger, plans are Memberships, merges are Duplicate
// Review. Nothing here writes to any of them — the only write is the Check run's own evidence row.
//
// Search rules (guide §05–§08):
//   • relevance: exact customer id (0) · appointment / ticket id (1) · exact stored phone (1) · exact email (2) · exact
//     Vietnamese-folded full name (3) · name prefix (4) · partial name / phone digits / email (5); ties → newest first,
//     then id. No search term → the directory, newest created first.
//   • phone exact-match uses toStoredCustomerPhone — the SAME function that writes customers.normalized_phone, so search
//     and storage cannot disagree (the staff phone family is never used here: Kevin's rule).
//   • partial phone needs ≥ 4 digits; any search term needs ≥ 2 characters.
//   • customers are tenant-wide (Retention CR-02); a branch-confined role sees customers whose home branch or activity
//     (a settled visit / an appointment) is in its branches, and activity counts only come from those branches.
//   • a shared phone / email is a SIGNAL for Duplicate Review, never a merge and never treated as one person.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { toStoredCustomerPhone } from '../customer-activation-rules/customer-activation-core';
import { RetentionRepository, isUuid, maskPhone, maskEmail, type RetentionContext, type BranchScope } from '../retention/retention.repository';

type Row = Record<string, any>;
export type CsCtx = RetentionContext;

export class CustomerSearchError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const CS_STATUSES = ['all', 'active', 'inactive', 'new', 'returning', 'never', 'duplicate', 'archived'] as const;
export const CS_BOOKING = ['any', 'upcoming', 'completed', 'canceled', 'no_show'] as const;
export const CS_DATE_FIELDS = ['created', 'updated', 'last_visit', 'first_visit', 'appointment', 'booking_created', 'service_completed'] as const;
export const CS_PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
export const CS_SORTS = ['relevance', 'newest', 'oldest', 'name', 'last_visit', 'visits'] as const;
export const CS_PAGE_SIZES = [10, 25, 50, 100] as const;
const VISIT = [...VISIT_TICKET_STATUSES] as string[];
// APPOINTMENT_STATUSES (api-contracts): booked · confirmed · arrived · checked_in · waiting · in_service · completed · cancelled · no_show
const ACTIVE_APPT = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const CANCELED_APPT = ['canceled', 'cancelled'];
const NO_SHOW_APPT = ['no_show', 'no-show'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEALTH_GAP_SECONDS = 30;
export const CS_REQUIRED_INDEXES = ['ix_customers_tenant_created', 'ix_customers_tenant_email_lower', 'idx_customers_full_name_vi_fold_trgm'] as const;

export interface CsQuery {
  q?: unknown; status?: unknown; booking?: unknown; technician?: unknown; service?: unknown; branch?: unknown;
  dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown;
}
export type CheckState = 'READY' | 'WARNING' | 'FAILED' | 'UNKNOWN';
/** `evidence` / `action` are English for the API and the run log; the POS renders `csx.health.d.<key>.<state>` with `detail` */
export interface CsCheck { key: string; state: CheckState; evidence: string; action: string | null; count?: number | null; detail?: Record<string, string | number | undefined> }
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const digitsOf = (s: string) => s.replace(/\D/g, '');
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/** what the search term is, decided once on the server (the client never says "this is a phone") */
export function classifyTerm(raw: unknown): { q: string; kind: 'none' | 'uuid' | 'email' | 'phone' | 'text'; digits: string; stored: string | null } {
  const q = String(raw ?? '').trim().slice(0, 100);
  if (!q) return { q, kind: 'none', digits: '', stored: null };
  if (isUuid(`${q}`)) return { q, kind: 'uuid', digits: '', stored: null };   // a copy: the guard must not narrow `q` to never below
  if (q.includes('@')) return { q, kind: 'email', digits: '', stored: null };
  const d = digitsOf(q);
  // mostly digits (punctuation and spaces allowed: "(609) 555-0101", "+1 609 555 0101") → a phone search
  if (d.length >= 4 && d.length >= q.replace(/[\s()+.-]/g, '').length) return { q, kind: 'phone', digits: d, stored: toStoredCustomerPhone(q) ?? null };
  return { q, kind: 'text', digits: d, stored: null };
}

export class CustomerSearchCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  // ── shared pieces ─────────────────────────────────────────────────────────────────────────────────────────────
  private async scope(ctx: CsCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new CustomerSearchError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'CUSTOMER_SEARCH_INVALID_BRANCH', e?.status ?? 400); }
  }
  /** settled visits / appointments inside the scope (tenant-wide = every row of the salon) */
  private tPred(s: BranchScope, alias: 't' | 'a' = 't') {
    if (!s.branchIds) return sql`true`;
    return alias === 'a' ? sql`a.branch_id = any(${s.branchIds}::uuid[])` : sql`t.branch_id = any(${s.branchIds}::uuid[])`;
  }
  /** which customers the session may see at all (CR-02: home branch OR activity in an authorized branch) */
  private customerScope(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  /** the period of the date filter; 'all' (the default) = no date filter */
  private async period(ctx: CsCtx, f: CsQuery): Promise<{ preset: string; from: string | null; to: string | null; start: Date | null; end: Date | null; today: string; tz: string }> {
    const preset = pick(CS_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'custom') {
      const from = typeof f.from === 'string' && DAY.test(f.from) ? f.from : null, to = typeof f.to === 'string' && DAY.test(f.to) ? f.to : null;
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new CustomerSearchError('Choose a From and a To date.', 'CUSTOMER_SEARCH_INVALID_PERIOD');
      if (from > to) throw new CustomerSearchError('The From date must be on or before the To date.', 'CUSTOMER_SEARCH_INVALID_PERIOD');
    }
    if (preset === 'all') {
      const w = await this.ret.window(ctx, { preset: 'today' });   // the salon clock only
      return { preset, from: null, to: null, start: null, end: null, today: w.today, tz: w.tz };
    }
    try {
      const w = await this.ret.window(ctx, { preset, from: f.from, to: f.to });
      return { preset, from: w.from, to: w.to, start: w.start, end: w.end, today: w.today, tz: w.tz };
    } catch (e: any) { throw new CustomerSearchError(e?.message ?? 'Choose a valid period.', 'CUSTOMER_SEARCH_INVALID_PERIOD'); }
  }
  private async riskDays(ctx: CsCtx): Promise<number> { return (await this.ret.settings(ctx)).riskDays; }

  /** completed visits per customer (settled, not removed), restricted to the scope — the one visit definition */
  private visitsCte(T: string, s: BranchScope) {
    return sql`select t.customer_id, count(*)::int as visits, max(coalesce(t.paid_at, t.created_at)) as last_visit, min(coalesce(t.paid_at, t.created_at)) as first_visit
      from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.tPred(s)}
      group by t.customer_id`;
  }
  /** shared phone / email with another live profile of the salon — a Duplicate Review signal (a "keep separate" pair excluded) */
  private dupPred(T: string) {
    return sql`exists (select 1 from customers o where o.tenant_id = ${T} and o.id <> c.id and o.archived_at is null
      and ((c.normalized_phone is not null and o.normalized_phone = c.normalized_phone) or (c.email is not null and lower(o.email) = lower(c.email)))
      and not exists (select 1 from customer_duplicate_decisions d where d.tenant_id = ${T} and d.decision = 'keep_separate'
        and d.customer_a = least(c.id, o.id) and d.customer_b = greatest(c.id, o.id)))`;
  }

  // ── search ────────────────────────────────────────────────────────────────────────────────────────────────────
  async search(ctx: CsCtx, f: CsQuery, opts: { fullContact: boolean }) {
    const T = ctx.tenantId;
    const term = classifyTerm(f.q);
    if (term.kind === 'text' && term.q.length < 2) throw new CustomerSearchError('Type at least 2 characters.', 'CUSTOMER_SEARCH_TOO_SHORT');
    const status = pick(CS_STATUSES, f.status) ?? 'all';
    const booking = pick(CS_BOOKING, f.booking) ?? 'any';
    const dateField = pick(CS_DATE_FIELDS, f.dateField) ?? 'created';
    const tech = isUuid(f.technician) ? String(f.technician) : null;
    const service = isUuid(f.service) ? String(f.service) : null;
    const pageSize = (CS_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(f.page)) || 1));
    const sort = pick(CS_SORTS, f.sort) ?? (term.kind === 'none' ? 'newest' : 'relevance');
    const scope = await this.scope(ctx, f.branch);
    const p = await this.period(ctx, f);
    const risk = await this.riskDays(ctx);
    const nowIso = new Date(this.now()).toISOString();

    // ── the term: a rank expression + the match predicate ──
    let rank = sql<number>`9`; let match = sql`true`;
    if (term.kind === 'uuid') {
      const viaAppt = sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.id = ${term.q}::uuid and a.customer_id = c.id)`;
      const viaTicket = sql`exists (select 1 from tickets t where t.tenant_id = ${T} and t.id = ${term.q}::uuid and t.customer_id = c.id)`;
      rank = sql<number>`case when c.id = ${term.q}::uuid then 0 else 1 end`;
      match = sql`(c.id = ${term.q}::uuid or ${viaAppt} or ${viaTicket})`;
    } else if (term.kind === 'email') {
      rank = sql<number>`case when lower(c.email) = lower(${term.q}) then 2 else 5 end`;
      match = sql`c.email ilike ${'%' + likeEsc(term.q) + '%'}`;
    } else if (term.kind === 'phone') {
      const exact = term.stored ? sql`c.normalized_phone = ${term.stored}` : sql`false`;
      const viaTicketNo = /^\d{1,9}$/.test(term.q) ? sql`exists (select 1 from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.ticket_number::text = ${term.q})` : sql`false`;
      rank = sql<number>`case when ${exact} then 1 when ${viaTicketNo} then 1 else 5 end`;
      match = sql`(${exact} or regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + term.digits + '%'} or ${viaTicketNo})`;
    } else if (term.kind === 'text') {
      // the term is folded like the column; for LIKE its % _ \ are escaped first (vi_fold keeps them) so they never act as wildcards
      const exactFold = sql`vi_fold(${term.q}::text)`;
      const folded = sql`vi_fold(${likeEsc(term.q)}::text)`;
      const names = sql`(vi_fold(c.full_name) like '%' || ${folded} || '%' or vi_fold(coalesce(c.preferred_name, '')) like '%' || ${folded} || '%'
        or vi_fold(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) like '%' || ${folded} || '%')`;
      rank = sql<number>`case when vi_fold(c.full_name) = ${exactFold} then 3
        when vi_fold(c.full_name) like ${folded} || '%' or vi_fold(coalesce(c.first_name, '')) like ${folded} || '%' or vi_fold(coalesce(c.last_name, '')) like ${folded} || '%' or vi_fold(coalesce(c.preferred_name, '')) like ${folded} || '%' then 4
        else 5 end`;
      match = sql`(${names} or (c.email is not null and c.email ilike ${'%' + likeEsc(term.q) + '%'}))`;
    }

    // ── filters (every one server-side; unknown values were dropped by pick / isUuid) ──
    const where: any[] = [this.customerScope(scope), match];   // + the literal c.tenant_id = T in each query below
    where.push(status === 'archived' ? sql`c.archived_at is not null` : sql`c.archived_at is null`);
    if (status === 'active') where.push(sql`v.last_visit >= ${nowIso}::timestamptz - make_interval(days => ${risk})`);
    if (status === 'inactive') where.push(sql`v.last_visit < ${nowIso}::timestamptz - make_interval(days => ${risk})`);
    if (status === 'never') where.push(sql`coalesce(v.visits, 0) = 0`);
    if (status === 'new') where.push(sql`v.visits = 1`);
    if (status === 'returning') where.push(sql`v.visits >= 2`);
    if (status === 'duplicate') where.push(this.dupPred(T));
    const appt = (cond: any) => sql`exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and ${this.tPred(scope, 'a')} and ${cond})`;
    if (booking === 'upcoming') where.push(appt(sql`a.appt_date >= ${p.today}::date and a.status = any(${ACTIVE_APPT}::text[])`));
    if (booking === 'completed') where.push(appt(sql`a.status = 'completed'`));
    if (booking === 'canceled') where.push(appt(sql`a.status = any(${CANCELED_APPT}::text[])`));
    if (booking === 'no_show') where.push(appt(sql`a.status = any(${NO_SHOW_APPT}::text[])`));
    const visitLine = (cond: any) => sql`exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and t.customer_id = c.id and l.removed_at is null and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.tPred(scope)} and ${cond})`;
    // technician: served on a completed visit OR the customer's RECORDED preference (never an inferred one)
    if (tech) where.push(sql`(${visitLine(sql`l.technician_id = ${tech}::uuid`)} or c.preferred_technician_id = ${tech}::uuid)`);
    if (service) where.push(visitLine(sql`l.service_id = ${service}::uuid`));
    if (p.start && p.end) {
      const S = p.start.toISOString(), E = p.end.toISOString();
      const inP = (col: any) => sql`(${col} >= ${S}::timestamptz and ${col} < ${E}::timestamptz)`;
      if (dateField === 'created') where.push(inP(sql`c.created_at`));
      if (dateField === 'updated') where.push(inP(sql`c.updated_at`));
      if (dateField === 'last_visit') where.push(inP(sql`v.last_visit`));
      if (dateField === 'first_visit') where.push(inP(sql`v.first_visit`));
      if (dateField === 'appointment') where.push(appt(sql`a.appt_date between ${p.from}::date and ${p.to}::date`));
      if (dateField === 'booking_created') where.push(appt(inP(sql`a.created_at`)));
      if (dateField === 'service_completed') where.push(visitLine(inP(sql`coalesce(l.completed_at, t.paid_at, t.created_at)`)));
    }

    const order = sort === 'relevance' ? sql`rk asc, c.created_at desc, c.id desc`
      : sort === 'oldest' ? sql`c.created_at asc, c.id asc`
      : sort === 'name' ? sql`lower(coalesce(c.full_name, '')) asc, c.id asc`
      : sort === 'last_visit' ? sql`v.last_visit desc nulls last, c.id desc`
      : sort === 'visits' ? sql`coalesce(v.visits, 0) desc, c.id desc`
      : sql`c.created_at desc, c.id desc`;
    const rows = (await sql<Row>`with v as (${this.visitsCte(T, scope)})
      select c.id, c.full_name, c.preferred_name, c.normalized_phone, c.phone_display, c.email, c.phone_verified_at, c.archived_at, c.created_at, c.updated_at,
             c.branch_id, c.preferred_technician_id, coalesce(v.visits, 0)::int as visits, v.last_visit, ${rank} as rk, count(*) over ()::int as total
      from customers c left join v on v.customer_id = c.id
      where c.tenant_id = ${T} and ${sql.join(where, sql` and `)}
      order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const total = rows.length ? N(rows[0].total) : (page > 1 ? N((await sql<Row>`with v as (${this.visitsCte(T, scope)})
      select count(*)::int as n from customers c left join v on v.customer_id = c.id where c.tenant_id = ${T} and ${sql.join(where, sql` and `)}`.execute(this.db)).rows[0]?.n) : 0);
    const items = await this.enrich(ctx, scope, rows, p.today, risk, opts.fullContact, term);
    const freshness = (await sql<Row>`select max(updated_at) as u, max(created_at) as c from customers where tenant_id = ${T}`.execute(this.db)).rows[0];
    return {
      items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), sort, status, booking, dateField,
      term: { kind: term.kind, matched: term.kind !== 'none' }, today: p.today, timeZone: p.tz,
      period: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today },
      scope: { mode: scope.mode, selectedBranchId: scope.selected, confined: scope.confined, branches: scope.authorized },
      fullContact: opts.fullContact,
      freshness: { lastCustomerChangeAt: iso(freshness?.u), lastCustomerCreatedAt: iso(freshness?.c) },
    };
  }

  /** the page's rows: next appointment, last technician, home branch, shared-contact signal, membership — page ids only */
  private async enrich(ctx: CsCtx, scope: BranchScope, rows: Row[], today: string, risk: number, fullContact: boolean, term: ReturnType<typeof classifyTerm>) {
    if (!rows.length) return [];
    const T = ctx.tenantId; const ids = rows.map((r) => String(r.id));
    const next = new Map((await sql<Row>`select distinct on (a.customer_id) a.customer_id, a.id, a.appt_date::text as d, a.start_time::text as st, a.status
      from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = any(${ids}::uuid[]) and ${this.tPred(scope, 'a')}
        and a.appt_date >= ${today}::date and a.status = any(${ACTIVE_APPT}::text[])
      order by a.customer_id, a.appt_date, a.start_time, a.id`.execute(this.db)).rows.map((r) => [String(r.customer_id), r]));
    const lastTech = new Map((await sql<Row>`select distinct on (t.customer_id) t.customer_id, l.technician_id, coalesce(tc.full_name, trim(coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))) as name
      from tickets t join ticket_service_lines l on l.ticket_id = t.id and l.tenant_id = t.tenant_id and l.removed_at is null and l.technician_id is not null
      left join technicians tc on tc.id = l.technician_id and tc.tenant_id = t.tenant_id
      where t.tenant_id = ${T} and t.customer_id = any(${ids}::uuid[]) and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.tPred(scope)}
      order by t.customer_id, coalesce(t.paid_at, t.created_at) desc, l.created_at desc`.execute(this.db)).rows.map((r) => [String(r.customer_id), r]));
    const branches = new Map((await sql<Row>`select id, name from branches where tenant_id = ${T}`.execute(this.db)).rows.map((r) => [String(r.id), String(r.name ?? '')]));
    const dup = new Map((await sql<Row>`select c.id, count(o.id)::int as n from customers c join customers o on o.tenant_id = c.tenant_id and o.id <> c.id and o.archived_at is null
        and ((c.normalized_phone is not null and o.normalized_phone = c.normalized_phone) or (c.email is not null and lower(o.email) = lower(c.email)))
      where c.tenant_id = ${T} and c.id = any(${ids}::uuid[])
        and not exists (select 1 from customer_duplicate_decisions d where d.tenant_id = ${T} and d.decision = 'keep_separate' and d.customer_a = least(c.id, o.id) and d.customer_b = greatest(c.id, o.id))
      group by c.id`.execute(this.db)).rows.map((r) => [String(r.id), N(r.n)]));
    const members = new Set((await sql<Row>`select distinct customer_id from customer_memberships where tenant_id = ${T} and customer_id = any(${ids}::uuid[]) and status in ('active', 'trialing', 'past_due', 'paused')`
      .execute(this.db).catch(() => ({ rows: [] as Row[] }))).rows.map((r) => String(r.customer_id)));
    const cutoff = this.now() - risk * 86400000;
    return rows.map((r) => {
      const id = String(r.id); const n = next.get(id); const lt = lastTech.get(id);
      const lastVisit = iso(r.last_visit);
      const lifecycle = r.archived_at ? 'archived' : N(r.visits) === 0 ? 'never' : (lastVisit && Date.parse(lastVisit) >= cutoff ? 'active' : 'inactive');
      const matchedBy = term.kind === 'none' ? null : N(r.rk) === 0 ? 'customer_id' : N(r.rk) === 1 ? (term.kind === 'uuid' ? 'appointment_or_ticket' : 'phone') : N(r.rk) === 2 ? 'email' : N(r.rk) <= 4 ? 'name' : 'partial';
      return {
        id, name: String(r.full_name ?? ''), preferredName: r.preferred_name ?? null,
        phone: fullContact ? (r.phone_display ?? r.normalized_phone ?? null) : maskPhone(r.normalized_phone ?? r.phone_display), phoneVerified: !!r.phone_verified_at,
        email: r.email ? (fullContact ? String(r.email) : maskEmail(r.email)) : null,
        lifecycle, visits: N(r.visits), lastVisitAt: lastVisit, createdAt: iso(r.created_at),
        nextAppointment: n ? { id: String(n.id), date: String(n.d), time: n.st ? String(n.st).slice(0, 5) : null, status: String(n.status) } : null,
        lastTechnician: lt ? { id: String(lt.technician_id), name: String(lt.name ?? '').trim() || null } : null,
        homeBranch: r.branch_id ? { id: String(r.branch_id), name: branches.get(String(r.branch_id)) ?? null } : null,
        sharedContactProfiles: dup.get(id) ?? 0, member: members.has(id), matchedBy,
      };
    });
  }

  // ── summary + options ─────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: CsCtx, f: { branch?: unknown; preset?: unknown; from?: unknown; to?: unknown } = {}) {
    const T = ctx.tenantId; const scope = await this.scope(ctx, f.branch);
    const p = await this.period(ctx, { preset: f.preset ?? 'month', from: f.from, to: f.to });
    const risk = await this.riskDays(ctx);
    const nowIso = new Date(this.now()).toISOString();
    const S = p.start?.toISOString() ?? null, E = p.end?.toISOString() ?? null;
    const r = (await sql<Row>`with v as (${this.visitsCte(T, scope)})
      select count(*) filter (where c.archived_at is null)::int as customers,
             count(*) filter (where c.archived_at is null and ${S}::timestamptz is not null and c.created_at >= ${S}::timestamptz and c.created_at < ${E}::timestamptz)::int as created_in_period,
             count(*) filter (where c.archived_at is null and v.last_visit >= ${nowIso}::timestamptz - make_interval(days => ${risk}))::int as active,
             count(*) filter (where c.archived_at is null and coalesce(v.visits, 0) = 0)::int as never,
             count(*) filter (where c.archived_at is not null)::int as archived
      from customers c left join v on v.customer_id = c.id where c.tenant_id = ${T} and ${this.customerScope(scope)}`.execute(this.db)).rows[0];
    const upcoming = N((await sql<Row>`select count(distinct a.customer_id)::int as n from pos_tech_appointments a join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and c.archived_at is null and a.appt_date >= ${p.today}::date and a.status = any(${ACTIVE_APPT}::text[]) and ${this.tPred(scope, 'a')}`.execute(this.db)).rows[0]?.n);
    const shared = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.archived_at is null and ${this.customerScope(scope)} and ${this.dupPred(T)}`.execute(this.db)).rows[0]?.n);
    const fresh = (await sql<Row>`select max(updated_at) as u from customers where tenant_id = ${T}`.execute(this.db)).rows[0];
    return {
      kpis: { customers: N(r?.customers), createdInPeriod: S ? N(r?.created_in_period) : null, active: N(r?.active), neverVisited: N(r?.never), withUpcomingAppointment: upcoming, sharedContactProfiles: shared, archived: N(r?.archived) },
      definitions: { activeDays: risk, visit: 'a settled ticket (closed / paid), not removed', sharedContact: 'shares a phone or email with another live profile — a Duplicate Review signal, not proof of one person' },
      period: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today },
      scope: { mode: scope.mode, selectedBranchId: scope.selected, confined: scope.confined, branches: scope.authorized },
      freshness: { lastCustomerChangeAt: iso(fresh?.u) },
    };
  }

  async options(ctx: CsCtx) {
    const T = ctx.tenantId; const scope = await this.scope(ctx);
    const techs = (await sql<Row>`select id, coalesce(nullif(full_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as name from technicians
      where tenant_id = ${T} and archived_at is null and coalesce(is_active, true) and ${scope.branchIds ? sql`(branch_id is null or branch_id = any(${scope.branchIds}::uuid[]))` : sql`true`}
      order by lower(coalesce(full_name, first_name, '')), id limit 500`.execute(this.db)).rows;
    const services = (await sql<Row>`select id, name from services where tenant_id = ${T} and archived_at is null and coalesce(status, 'active') <> 'archived'
      order by lower(name), id limit 1000`.execute(this.db)).rows;
    return {
      technicians: techs.map((x) => ({ id: String(x.id), name: String(x.name ?? '') })),
      services: services.map((x) => ({ id: String(x.id), name: String(x.name ?? '') })),
      branches: scope.authorized, statuses: CS_STATUSES, booking: CS_BOOKING, dateFields: CS_DATE_FIELDS, sorts: CS_SORTS, pageSizes: CS_PAGE_SIZES,
    };
  }

  // ── Customer 360° (read-only, audited) ────────────────────────────────────────────────────────────────────────
  async profile(ctx: CsCtx, id: string, opts: { fullContact: boolean; audit: AuditFn }) {
    if (!isUuid(id)) throw new CustomerSearchError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const T = ctx.tenantId; const scope = await this.scope(ctx);
    const today = (await this.period(ctx, {})).today;
    const c = (await sql<Row>`select c.id, c.full_name, c.preferred_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email, c.phone_verified_at,
        c.created_at, c.updated_at, c.archived_at, c.branch_id, c.preferred_branch_id, c.preferred_language, c.preferred_technician_id
      from customers c where c.tenant_id = ${T} and c.id = ${id}::uuid and ${this.customerScope(scope)}`.execute(this.db)).rows[0];
    // same answer for "not in this salon", "not in your branches" and "does not exist" — knowing an id is not permission
    if (!c) throw new CustomerSearchError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const sources: Record<string, 'ok' | 'unavailable'> = {};
    const load = async <X>(key: string, fn: () => Promise<X>, empty: X): Promise<X> => { try { const v = await fn(); sources[key] = 'ok'; return v; } catch { sources[key] = 'unavailable'; return empty; } };
    const branches = new Map((await sql<Row>`select id, name from branches where tenant_id = ${T}`.execute(this.db)).rows.map((r) => [String(r.id), String(r.name ?? '')]));
    const bname = (b: unknown) => (b ? { id: String(b), name: branches.get(String(b)) ?? null } : null);
    const visits = await load('visits', async () => (await sql<Row>`select count(*)::int as n, min(coalesce(t.paid_at, t.created_at)) as f, max(coalesce(t.paid_at, t.created_at)) as l from tickets t
      where t.tenant_id = ${T} and t.customer_id = ${id}::uuid and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.tPred(scope)}`.execute(this.db)).rows[0], null as Row | null);
    const appts = await load('booking', async () => (await sql<Row>`select a.id, a.appt_date::text as d, a.start_time::text as st, a.status, a.branch_id, a.technician_id, a.any_technician, a.source, a.created_at,
        coalesce(nullif(tc.full_name, ''), trim(coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))) as tech
      from pos_tech_appointments a left join technicians tc on tc.id = a.technician_id and tc.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.customer_id = ${id}::uuid and ${this.tPred(scope, 'a')}
      order by a.appt_date desc, a.start_time desc, a.id desc limit 200`.execute(this.db)).rows, [] as Row[]);
    const lines = await load('services', async () => (await sql<Row>`select l.id, l.service_id, l.service_name_snapshot as service, l.category_snapshot as category, l.duration_minutes_snapshot as minutes,
        l.technician_id, coalesce(nullif(tc.full_name, ''), trim(coalesce(tc.first_name, '') || ' ' || coalesce(tc.last_name, ''))) as tech, t.id as ticket_id, t.ticket_number, t.branch_id,
        coalesce(l.completed_at, t.paid_at, t.created_at) as at
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      left join technicians tc on tc.id = l.technician_id and tc.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and t.customer_id = ${id}::uuid and l.removed_at is null and t.removed_at is null and t.status = any(${VISIT}::text[]) and ${this.tPred(scope)}
      order by coalesce(l.completed_at, t.paid_at, t.created_at) desc, l.id desc limit 20`.execute(this.db)).rows, [] as Row[]);
    const loyalty = await load('loyalty', async () => {
      const led = (await sql<Row>`select coalesce(sum(delta), 0)::bigint as pts, count(*)::int as n, max(created_at) as at from loyalty_ledger where tenant_id = ${T} and customer_id = ${id}::uuid`.execute(this.db)).rows[0];
      const prof = (await sql<Row>`select loyalty_tier, points_balance from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${id}::uuid order by updated_at desc nulls last limit 1`.execute(this.db)).rows[0];
      const ledgerPoints = N(led?.pts);
      return { enrolled: !!prof || N(led?.n) > 0, points: ledgerPoints, tier: prof?.loyalty_tier ?? null, lastActivityAt: iso(led?.at),
        // the ledger is the truth (migration 540); a different profile balance is SHOWN as a conflict, never repaired here
        conflict: prof && prof.points_balance != null && N(prof.points_balance) !== ledgerPoints ? { profileBalance: N(prof.points_balance), ledgerBalance: ledgerPoints } : null };
    }, null as { enrolled: boolean; points: number; tier: string | null; lastActivityAt: string | null; conflict: { profileBalance: number; ledgerBalance: number } | null } | null);
    const memberships = await load('memberships', async () => (await sql<Row>`select m.id, m.status, m.started_at, m.current_period_end, p.name as plan
      from customer_memberships m left join membership_plans p on p.id = m.plan_id and p.tenant_id = m.tenant_id
      where m.tenant_id = ${T} and m.customer_id = ${id}::uuid order by m.created_at desc limit 10`.execute(this.db)).rows, [] as Row[]);
    const duplicates = await load('duplicates', async () => (await sql<Row>`select o.id, o.full_name, o.created_at,
        (o.normalized_phone is not null and o.normalized_phone = ${c.normalized_phone ?? null}) as same_phone, (o.email is not null and lower(o.email) = lower(${c.email ?? null})) as same_email,
        (select d.decision from customer_duplicate_decisions d where d.tenant_id = ${T} and d.customer_a = least(${id}::uuid, o.id) and d.customer_b = greatest(${id}::uuid, o.id)) as decision
      from customers o where o.tenant_id = ${T} and o.id <> ${id}::uuid and o.archived_at is null
        and ((${c.normalized_phone ?? null}::text is not null and o.normalized_phone = ${c.normalized_phone ?? null}) or (${c.email ?? null}::text is not null and lower(o.email) = lower(${c.email ?? null})))
      order by o.created_at desc limit 10`.execute(this.db)).rows, [] as Row[]);
    const prefTech = c.preferred_technician_id ? await load('preferences', async () => (await sql<Row>`select id, coalesce(nullif(full_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as name
      from technicians where tenant_id = ${T} and id = ${c.preferred_technician_id}`.execute(this.db)).rows[0] ?? null, null as Row | null) : null;
    const risk = await this.riskDays(ctx);
    const last = visits?.l ? iso(visits.l) : null;
    const lifecycle = c.archived_at ? 'archived' : !visits ? 'unknown' : N(visits.n) === 0 ? 'never' : last && Date.parse(last) >= this.now() - risk * 86400000 ? 'active' : 'inactive';
    const ap = (a: Row) => ({ id: String(a.id), date: String(a.d), time: a.st ? String(a.st).slice(0, 5) : null, status: String(a.status), source: a.source ?? null,
      technician: a.technician_id ? { id: String(a.technician_id), name: String(a.tech ?? '').trim() || null } : a.any_technician ? { id: null, name: null, any: true } : null, branch: bname(a.branch_id) });
    const out = {
      identity: {
        id, name: String(c.full_name ?? ''), preferredName: c.preferred_name ?? null, firstName: c.first_name ?? null, lastName: c.last_name ?? null,
        phone: opts.fullContact ? (c.phone_display ?? c.normalized_phone ?? null) : maskPhone(c.normalized_phone ?? c.phone_display), phoneVerified: !!c.phone_verified_at,
        email: c.email ? (opts.fullContact ? String(c.email) : maskEmail(c.email)) : null,
        createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), archivedAt: iso(c.archived_at), homeBranch: bname(c.branch_id), preferredBranch: bname(c.preferred_branch_id),
        language: c.preferred_language ?? null, lifecycle, fullContact: opts.fullContact,
      },
      visits: visits ? { completed: N(visits.n), firstAt: iso(visits.f), lastAt: last } : null,
      appointments: {
        upcoming: appts.filter((a) => String(a.d) >= today && ACTIVE_APPT.includes(String(a.status))).reverse().slice(0, 10).map(ap),
        history: appts.filter((a) => !(String(a.d) >= today && ACTIVE_APPT.includes(String(a.status)))).slice(0, 20).map(ap),
        canceled: appts.filter((a) => CANCELED_APPT.includes(String(a.status))).length, noShows: appts.filter((a) => NO_SHOW_APPT.includes(String(a.status))).length,
      },
      services: lines.map((l) => ({ id: String(l.id), serviceId: l.service_id ? String(l.service_id) : null, service: l.service ?? null, category: l.category ?? null, minutes: l.minutes == null ? null : N(l.minutes),
        technician: l.technician_id ? { id: String(l.technician_id), name: String(l.tech ?? '').trim() || null } : null, ticketId: String(l.ticket_id), ticketNumber: l.ticket_number ?? null, branch: bname(l.branch_id), at: iso(l.at) })),
      preferences: { technician: prefTech ? { id: String(prefTech.id), name: String(prefTech.name ?? '').trim() || null, recorded: true } : null },
      loyalty, memberships: memberships.map((m) => ({ id: String(m.id), plan: m.plan ?? null, status: String(m.status), startedAt: iso(m.started_at), periodEnd: iso(m.current_period_end) })),
      duplicates: duplicates.map((o) => ({ id: String(o.id), name: String(o.full_name ?? ''), createdAt: iso(o.created_at), samePhone: !!o.same_phone, sameEmail: !!o.same_email, decision: o.decision ?? null })),
      sources, today,
    };
    // opening a customer's 360° view is audited, fail-closed: no audit row → no data leaves
    await this.db.transaction().execute(async (trx) => {
      await opts.audit(trx as unknown as Kysely<any>, { customerId: id, fullContact: opts.fullContact, sections: Object.keys(sources).filter((k) => sources[k] === 'ok') });
    });
    return out;
  }

  // ── Check Customer Search System (read-only; the run is recorded; one run per salon per 30 s) ─────────────────
  async check(ctx: CsCtx) {
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('customer-search-health:' || ${T}))`.execute(trx);
      const recent = (await sql<Row>`select id, overall, checks, created_at from customer_search_health_runs where tenant_id = ${T}
        and created_at > now() - make_interval(secs => ${HEALTH_GAP_SECONDS}) order by created_at desc limit 1`.execute(trx)).rows[0];
      if (recent) return { runId: String(recent.id), overall: recent.overall as CheckState, checks: recent.checks as CsCheck[], checkedAt: iso(recent.created_at), rateLimited: true };
      const checks: CsCheck[] = [];
      const run = async (key: string, fn: () => Promise<Omit<CsCheck, 'key'>>) => {
        try { checks.push({ key, ...(await fn()) }); }
        catch (e: any) { checks.push({ key, state: 'FAILED', evidence: `The check could not run: ${String(e?.message ?? e).slice(0, 160)}`, action: 'Retry; if it persists, check the database connection.', detail: { failedToRun: 1 } }); }
      };
      await run('directory', async () => {
        const r = (await sql<Row>`select count(*) filter (where archived_at is null)::int as live, count(*) filter (where archived_at is not null)::int as archived from customers where tenant_id = ${T}`.execute(trx)).rows[0];
        return { state: 'READY', evidence: `${N(r.live)} live and ${N(r.archived)} archived customer records in this salon.`, action: null, count: N(r.live), detail: { live: N(r.live), archived: N(r.archived) } };
      });
      await run('exact_lookup', async () => {
        // a real record must be findable by its own id and stored phone through the SAME predicates the search uses
        const s = (await sql<Row>`select id, normalized_phone from customers where tenant_id = ${T} and archived_at is null and normalized_phone is not null order by created_at desc limit 1`.execute(trx)).rows[0];
        if (!s) return { state: 'UNKNOWN', evidence: 'No customer with a phone number to test with.', action: null };
        const viaId = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.id = ${s.id}`.execute(trx)).rows[0]?.n);
        const stored = toStoredCustomerPhone(String(s.normalized_phone));
        const viaPhone = stored ? N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.normalized_phone = ${stored}`.execute(trx)).rows[0]?.n) : 0;
        if (viaId === 1 && viaPhone >= 1) return { state: 'READY', evidence: 'The newest customer was found by id and by phone.', action: null };
        return { state: 'FAILED', evidence: `Lookup of a known customer failed (by id: ${viaId}, by phone: ${viaPhone}).`, action: 'Check phone normalization — the stored phone does not round-trip through the search normalizer.', detail: { byId: viaId, byPhone: viaPhone } };
      });
      await run('phone_normalization', async () => {
        const missing = N((await sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null and normalized_phone is null and coalesce(phone_display, '') <> ''`.execute(trx)).rows[0]?.n);
        const sample = (await sql<Row>`select normalized_phone from customers where tenant_id = ${T} and normalized_phone is not null order by updated_at desc limit 500`.execute(trx)).rows;
        const off = sample.filter((r) => toStoredCustomerPhone(String(r.normalized_phone)) !== String(r.normalized_phone)).length;
        if (!missing && !off) return { state: 'READY', evidence: `Stored phones round-trip through the customer normalizer (${sample.length} checked).`, action: null, detail: { n: sample.length } };
        return { state: 'WARNING', evidence: `${missing} customer(s) have a phone shown but none stored for search; ${off} of the last ${sample.length} stored phones are not in the stored format.`,
          action: 'Open these customers in Customer Management and save the phone again — exact phone search cannot find them until then.', count: missing + off, detail: { missing, off, n: sample.length } };
      });
      await run('indexes', async () => {
        const have = new Set((await sql<Row>`select indexname from pg_indexes where tablename = 'customers'`.execute(trx)).rows.map((r) => String(r.indexname)));
        const miss = CS_REQUIRED_INDEXES.filter((i) => !have.has(i));
        return miss.length ? { state: 'WARNING', evidence: `Missing search index(es): ${miss.join(', ')}.`, action: 'Apply migrations 694 and 760; large directories search slowly without them.', detail: { list: miss.join(', ') } }
          : { state: 'READY', evidence: 'Directory, email and Vietnamese-name search indexes are present.', action: null };
      });
      await run('tenant_isolation', async () => {
        const a = N((await sql<Row>`select count(*)::int as n from pos_tech_appointments a join customers c on c.id = a.customer_id where a.tenant_id = ${T} and c.tenant_id <> a.tenant_id`.execute(trx)).rows[0]?.n);
        const t = N((await sql<Row>`select count(*)::int as n from tickets t join customers c on c.id = t.customer_id where t.tenant_id = ${T} and c.tenant_id <> t.tenant_id`.execute(trx)).rows[0]?.n);
        return a || t ? { state: 'FAILED', evidence: `${a} appointment(s) and ${t} ticket(s) of this salon point at another salon's customer.`, action: 'Critical: report to support. Search never shows these links; the records need a data repair.', count: a + t, detail: { a, t } }
          : { state: 'READY', evidence: 'No appointment or ticket of this salon points at another salon\'s customer.', action: null };
      });
      await run('booking_links', async () => {
        const r = (await sql<Row>`select count(*) filter (where a.customer_id is not null and c.id is null)::int as dangling, count(*) filter (where a.customer_id is null)::int as unlinked, count(*)::int as total
          from pos_tech_appointments a left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
          where a.tenant_id = ${T} and a.appt_date >= current_date - 90`.execute(trx)).rows[0];
        if (N(r.dangling)) return { state: 'FAILED', evidence: `${N(r.dangling)} recent appointment(s) point at a customer record that no longer exists.`, action: 'Those bookings cannot show in a customer\'s history; report to support.', count: N(r.dangling), detail: { n: N(r.dangling) } };
        return { state: N(r.unlinked) ? 'WARNING' : 'READY', evidence: `${N(r.total)} appointments in the last 90 days; ${N(r.unlinked)} have no customer record (walk-ins or guest bookings).`,
          action: N(r.unlinked) ? 'Unlinked bookings never appear in Customer Search; link the guest in Booking when you know who it is.' : null, count: N(r.unlinked), detail: { total: N(r.total), unlinked: N(r.unlinked) } };
      });
      await run('service_history', async () => {
        const r = (await sql<Row>`select count(*) filter (where t.customer_id is null)::int as anon, count(*)::int as total from tickets t
          where t.tenant_id = ${T} and t.removed_at is null and t.status = any(${VISIT}::text[]) and coalesce(t.paid_at, t.created_at) > now() - interval '90 days'`.execute(trx)).rows[0];
        return { state: 'READY', evidence: `${N(r.total)} completed visits in the last 90 days; ${N(r.anon)} without a customer (they never count toward anyone's history).`, action: null, count: N(r.anon), detail: { total: N(r.total), anon: N(r.anon) } };
      });
      await run('duplicate_signals', async () => {
        const n = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.archived_at is null and ${this.dupPred(T)}`.execute(trx)).rows[0]?.n);
        return n ? { state: 'WARNING', evidence: `${n} profile(s) share a phone or email with another profile and have not been reviewed as separate people.`, action: 'Review them in Duplicate Review — search never merges anyone.', count: n, detail: { n } }
          : { state: 'READY', evidence: 'No unreviewed shared phone or email.', action: null };
      });
      await run('ai_profile', async () => {
        const s = (await sql<Row>`select status, current_period_ends_at, trial_ends_at from tenant_ai_subscriptions where tenant_id = ${T} and package_code = 'ai_customer_profile_assistant'
          order by updated_at desc nulls last limit 1`.execute(trx)).rows[0];
        if (!s) return { state: 'UNKNOWN', evidence: 'No AI Customer Profile package on file. Search works without it; only the AI profile panel needs it.', action: null };
        const ok = ['active', 'trialing'].includes(String(s.status));
        return { state: ok ? 'READY' : 'WARNING', evidence: `AI Customer Profile package: ${String(s.status)}. Search does not depend on it.`, action: ok ? null : 'Renew the package to use the AI profile panel; Customer Search keeps working.', detail: { status: String(s.status) } };
      });
      await run('freshness', async () => {
        const r = (await sql<Row>`select max(updated_at) as u, max(created_at) as c from customers where tenant_id = ${T}`.execute(trx)).rows[0];
        return { state: r?.u ? 'READY' : 'UNKNOWN', evidence: r?.u ? `Search reads the live table: newest change ${iso(r.u)}, newest record ${iso(r.c)}. There is no separate index to go stale.` : 'No customer records yet.', action: null, detail: r?.u ? { at: String(iso(r.u)) } : {} };
      });
      const rank: Record<CheckState, number> = { READY: 0, UNKNOWN: 1, WARNING: 2, FAILED: 3 };
      const overall = checks.reduce<CheckState>((w, c) => (rank[c.state] > rank[w] ? c.state : w), 'READY');
      const runId = randomUUID();
      await sql`insert into customer_search_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), rateLimited: false };
    });
  }
}
