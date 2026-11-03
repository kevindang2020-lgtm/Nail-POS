// team-performance-screen.repository.ts — the read model behind the rebuilt Team Performance page (/tenant/team/performance,
// Oct 30 2026). The photo's "Overall Score 5% · Avg Performance 5%" next to a 0–5 tier chart was a DISPLAY bug: the old
// /pos/team/state score is the average customer review rating on a 1–5 scale, and the screen put a "%" after it (5.0 of 5
// shown as "5%"). Nothing was converted here — the scores are the same ratings, shown as "x.x / 5" with their sample.
//
// Definitions (one period, the salon's days, end day included; reviews by the day they were left, services by the day
// the ticket was paid):
//   verified review   reviews with a rating 1–5, not hidden by a manager, not spam
//   Overall Score     the mean of EVERY verified review in the period (each review counts once) — the salon-wide rating
//   Avg Performance   the mean of the rated technicians' own averages (each technician counts once)
//   Total Services    unique paid service lines (not add-ons, retail or removed lines) with a technician; a line two
//                     technicians shared counts once here and once per technician in her own count
//   tier              a technician's average: Excellent ≥ 4.5 · Very Good ≥ 3.5 · Good ≥ 2.5 · Needs Improvement < 2.5;
//                     no reviews = Unrated (never "Needs Improvement")
//   ranking           technicians with at least MIN_SAMPLE reviews first, by average then review count then name; fewer
//                     reviews follow, marked low sample — never ranked above a well-sampled technician
// Tips, commission and pay are never part of a score.
import { createHash } from 'node:crypto';
import { auditedExport, teamPerformanceCsv, type ExportFilters } from './report-export';
import { computeComposite, COMPOSITE_MODEL_V1, type Evidence } from './performance-score';
import { sql, type Kysely } from 'kysely';
import { N, iso, like, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, dateInPeriod, UUID, err, type TeamCtx, type TPeriod, canAny } from './screen-kit';
import { addDays } from '@aipowersalon/date-time';

export const MIN_SAMPLE = 3;
export const PERF_SORTS = ['score', 'services', 'name', 'recent', 'newest'] as const;
export const PERF_TIERS = ['all', 'excellent', 'very_good', 'good', 'needs', 'unrated'] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;
const tierOf = (avg: number | null) => (avg == null ? 'unrated' : avg >= 4.5 ? 'excellent' : avg >= 3.5 ? 'very_good' : avg >= 2.5 ? 'good' : 'needs');
const can = canAny;
// F5 reliability vocabulary (pos_tech_queue_tickets.status, widened by migration 556): done · technician-attributable
// failure (declined / expired offer) · outside the technician (customer cancelled / no-show) — excluded
const REL_DONE = ['service_done'], REL_FAILED = ['declined', 'expired'], REL_CUSTOMER = ['cancelled', 'no_show'];

export class TeamPerformanceScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  period(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) { return teamPeriod(this.db, ctx, q, 'month'); }
  private br(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(te.branch_id = ${b} or te.branch_id is null)` : sql`true`; }
  private verified() { return sql`r.rating between 1 and 5 and not coalesce(r.is_hidden_by_manager, false) and not coalesce(r.is_spam, false)`; }
  private paidLine() { return sql`l.removed_at is null and lower(coalesce(l.line_kind, 'service')) = 'service' and not coalesce(l.is_add_on, false) and t.paid_at is not null and t.removed_at is null and coalesce(t.payment_status, '') <> 'voided'`; }

  /** per technician (every current, non-archived technician): her reviews and services in the period */
  private perTech(ctx: TeamCtx, per: TPeriod) {
    const T = ctx.tenantId; const b = branchOf(ctx);
    // with a branch selected, a technician's reviews and services are THIS branch's (they were her whole salon's)
    return sql`with rv as (select r.technician_id as tid, count(*)::int as n, avg(r.rating)::numeric(4,2) as avg, max(r.created_at) as last_review from reviews r
          where r.tenant_id = ${T} and r.technician_id is not null and ${this.verified()} and ${inPeriod(sql`coalesce(r.review_date, r.created_at)`, per)}
            and (${b}::uuid is null or r.branch_id = ${b}) group by r.technician_id),
        sv as (select l.technician_id as tid, count(distinct l.id)::int as n, max(t.paid_at) as last_service from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
          where l.tenant_id = ${T} and l.technician_id is not null and ${this.paidLine()} and ${inPeriod(sql`t.paid_at`, per)}
            and (${b}::uuid is null or t.branch_id = ${b} or t.branch_id is null) group by l.technician_id),
        x as (select te.id as tid, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as name, te.avatar_url, te.status, te.created_at, b.name as branch,
            coalesce(rv.n, 0) as reviews, rv.avg, rv.last_review, coalesce(sv.n, 0) as services, sv.last_service
          from technicians te left join branches b on b.id = te.branch_id and b.tenant_id = te.tenant_id left join rv on rv.tid = te.id left join sv on sv.tid = te.id
          where te.tenant_id = ${T} and te.archived_at is null and coalesce(te.status, '') <> 'archived' and ${this.br(ctx)})`;
  }
  private rankOrder() { return sql`(x.reviews >= ${MIN_SAMPLE}) desc, x.avg desc nulls last, x.reviews desc, lower(x.name), x.tid`; }

  async dashboard(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, q); const b = branchOf(ctx);
    const all = (await sql<any>`select count(*)::int as n, avg(r.rating)::numeric(4,2) as avg from reviews r join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${this.verified()} and ${inPeriod(sql`coalesce(r.review_date, r.created_at)`, per)} and ${this.br(ctx)}
        and te.archived_at is null and coalesce(te.status, '') <> 'archived' and (${b}::uuid is null or r.branch_id = ${b})`.execute(this.db)).rows[0];   // the same technicians and reviews as the rows below
    const svc = (await sql<any>`select count(distinct l.id)::int as lines, count(distinct (l.id, l.technician_id))::int as contributions, count(distinct t.id)::int as tickets
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.technician_id is not null and ${this.paidLine()} and ${inPeriod(sql`t.paid_at`, per)}
        and (${b}::uuid is null or t.branch_id = ${b} or t.branch_id is null)`.execute(this.db)).rows[0];
    const rows = (await sql<any>`${this.perTech(ctx, per)} select x.* from x order by ${this.rankOrder()}`.execute(this.db)).rows;
    const rated = rows.filter((r: any) => N(r.reviews) > 0);
    const avgPerf = rated.length ? round1(rated.reduce((a: number, r: any) => a + Number(r.avg), 0) / rated.length) : null;
    const dist = { excellent: 0, very_good: 0, good: 0, needs: 0, unrated: 0 } as Record<string, number>;
    for (const r of rows) dist[tierOf(N(r.reviews) ? round1(Number(r.avg)) : null)]++;   // the tier of the score shown (4.46 shows 4.5 = Excellent)
    const top = rows.filter((r: any) => N(r.reviews) > 0).slice(0, 5);
    return { period: per, minSample: MIN_SAMPLE,
      kpis: { overallScore: N(all?.n) ? round1(Number(all.avg)) : null, overallReviews: N(all?.n), avgPerformance: avgPerf, ratedTechnicians: rated.length, technicians: rows.length,
        totalServices: N(svc?.lines), serviceContributions: N(svc?.contributions), tickets: N(svc?.tickets) },
      distribution: dist,
      topPerformers: top.map((r: any, i: number) => ({ rank: i + 1, technicianId: String(r.tid), name: String(r.name || ''), avatarUrl: r.avatar_url ?? null, branch: r.branch ?? null, score: round1(Number(r.avg)),
        reviews: N(r.reviews), services: N(r.services), lowSample: N(r.reviews) < MIN_SAMPLE })) };
  }

  /** Technician Performance Directory: one row per technician; search reaches services / customers / tickets she served */
  async directory(ctx: TeamCtx, f: { q?: string; tier?: string; sort?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const tier = (PERF_TIERS as readonly string[]).includes(String(f.tier)) ? String(f.tier) : 'all';
    const sort = (PERF_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'score';
    const custOk = can(ctx, 'customers.view');
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw);
    const ra = sql`round(x.avg, 1)`;   // filter on the score the row shows, not the raw average (4.46 showed "4.5 Excellent" but fell in Very good)
    const tierW = tier === 'all' ? sql`true` : tier === 'unrated' ? sql`x.reviews = 0` : tier === 'excellent' ? sql`x.reviews > 0 and ${ra} >= 4.5`
      : tier === 'very_good' ? sql`x.reviews > 0 and ${ra} >= 3.5 and ${ra} < 4.5` : tier === 'good' ? sql`x.reviews > 0 and ${ra} >= 2.5 and ${ra} < 3.5` : sql`x.reviews > 0 and ${ra} < 2.5`;
    const techHit = sql`(x.name ilike ${l} or x.tid::text = ${raw} or exists (select 1 from technicians tp where tp.tenant_id = ${T} and tp.id = x.tid and ${phoneish} and right(regexp_replace(coalesce(tp.normalized_phone, tp.phone_display, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'}))`;
    const workHit = sql`exists (select 1 from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers c on c.id = t.customer_id and c.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.technician_id = x.tid and ${this.paidLine()} and ${inPeriod(sql`t.paid_at`, per)}
        and (coalesce(l.service_name_snapshot, '') ilike ${l} or coalesce(t.ticket_number, '') ilike ${l} or (${isId} and (t.id::text = ${raw} or l.id::text = ${raw}))
          -- customer name / phone only for a role that may see customers (searching them confirmed who she served)
          or (${custOk} and (coalesce(c.full_name, '') ilike ${l} or (${phoneish} and right(regexp_replace(coalesce(c.normalized_phone, c.phone_display, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'})))))`;
    const w = sql`${tierW} and (${raw} = '' or ${techHit} or ${workHit})`;
    const order = sort === 'services' ? sql`x.services desc, ${this.rankOrder()}` : sort === 'name' ? sql`lower(x.name), x.tid` : sort === 'recent' ? sql`x.last_service desc nulls last, x.tid`
      : sort === 'newest' ? sql`x.created_at desc, x.tid` : this.rankOrder();
    const total = N((await sql<any>`${this.perTech(ctx, per)} select count(*)::int as n from x where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`${this.perTech(ctx, per)} select x.*, ${raw === '' ? sql`null` : sql`case when ${techHit} then 'technician' else 'work' end`} as via from x where ${w} order by ${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, minSample: MIN_SAMPLE, items: rows.map((r: any) => { const n = N(r.reviews); const avg = n ? round1(Number(r.avg)) : null; return {
      technicianId: String(r.tid), name: String(r.name || ''), avatarUrl: r.avatar_url ?? null, branch: r.branch ?? null, active: r.status === 'active',
      services: N(r.services), rating: avg, reviews: n, tier: tierOf(avg), lowSample: n > 0 && n < MIN_SAMPLE, lastServiceAt: iso(r.last_service), lastReviewAt: iso(r.last_review), matchedVia: r.via ?? null }; }),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  private async mustTech(ctx: TeamCtx, id: string) {
    if (!UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const t = (await sql<any>`select te.id from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${id} and te.archived_at is null and ${this.br(ctx)}`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
  }

  /** Technician Performance Details: identity, score with provenance and sample, rank, services, and the same-length
   *  previous period beside this one (a comparison only when both sides have enough reviews) */
  async technician(ctx: TeamCtx, id: string, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    await this.mustTech(ctx, id); const T = ctx.tenantId; const per = await this.period(ctx, q);
    const rows = (await sql<any>`${this.perTech(ctx, per)} select x.*, row_number() over (order by ${this.rankOrder()}) as pos, count(*) filter (where x.reviews > 0) over () as rated from x order by ${this.rankOrder()}`.execute(this.db)).rows;
    const me = rows.find((r: any) => String(r.tid) === id);
    const allTime = (await sql<any>`select count(*)::int as n, avg(r.rating)::numeric(4,2) as avg from reviews r where r.tenant_id = ${T} and r.technician_id = ${id} and ${this.verified()}`.execute(this.db)).rows[0];
    const svcNames = (await sql<any>`select s.name from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id where ts.tenant_id = ${T} and ts.technician_id = ${id} and s.status = 'active' order by lower(s.name) limit 40`.execute(this.db)).rows;
    let prev: { from: string; to: string; services: number; reviews: number; rating: number | null } | null = null;
    if (per.from && per.to) {
      const days = Math.round((Date.parse(per.to) - Date.parse(per.from)) / 86_400_000) + 1;
      const pt = addDays(per.from, -1); const pf = addDays(per.from, -days);
      const pp = { ...per, preset: 'custom', from: pf, to: pt };
      const pr = (await sql<any>`${this.perTech(ctx, pp)} select x.* from x where x.tid = ${id}`.execute(this.db)).rows[0];
      prev = { from: pf, to: pt, services: N(pr?.services), reviews: N(pr?.reviews), rating: N(pr?.reviews) ? round1(Number(pr.avg)) : null };
    }
    const n = N(me?.reviews); const avg = n ? round1(Number(me.avg)) : null;
    const t = (await sql<any>`select te.id, te.full_name, te.avatar_url, te.status, te.role_label, b.name as branch from technicians te left join branches b on b.id = te.branch_id and b.tenant_id = te.tenant_id where te.tenant_id = ${T} and te.id = ${id}`.execute(this.db)).rows[0];
    return { period: per, minSample: MIN_SAMPLE, technicianId: id, name: t?.full_name ?? null, avatarUrl: t?.avatar_url ?? null, role: t?.role_label ?? null, branch: t?.branch ?? null, active: t?.status === 'active',
      qualifiedServices: svcNames.map((s: any) => String(s.name)),
      score: { rating: avg, reviews: n, tier: tierOf(avg), lowSample: n > 0 && n < MIN_SAMPLE, source: 'verified_reviews', scale: 5, allTimeRating: N(allTime?.n) ? round1(Number(allTime.avg)) : null, allTimeReviews: N(allTime?.n) },
      rank: n ? { position: N(me?.pos), of: N(me?.rated) } : null, services: N(me?.services), lastServiceAt: iso(me?.last_service), lastReviewAt: iso(me?.last_review),
      previous: prev, comparable: !!prev && n >= MIN_SAMPLE && prev.reviews >= MIN_SAMPLE };
  }

  /** her completed services in the period, newest first (ticket, service, length, who else worked the ticket) */
  async services(ctx: TeamCtx, id: string, f: { q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    await this.mustTech(ctx, id); const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const from = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers c on c.id = t.customer_id and c.tenant_id = l.tenant_id`;
    const w = sql`l.tenant_id = ${T} and l.technician_id = ${id} and ${this.paidLine()} and ${inPeriod(sql`t.paid_at`, per)} and (${raw} = '' or coalesce(l.service_name_snapshot, '') ilike ${l} or coalesce(t.ticket_number, '') ilike ${l} or coalesce(c.full_name, '') ilike ${l})`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select l.id, l.service_name_snapshot, l.duration_minutes_snapshot, l.completed_at, t.paid_at, t.id as ticket_id, t.ticket_number, c.full_name as customer,
        (select count(distinct l2.technician_id) from ticket_service_lines l2 where l2.tenant_id = ${T} and l2.ticket_id = t.id and l2.technician_id is not null and l2.removed_at is null)::int as techs,
        (select r.rating from reviews r where r.tenant_id = ${T} and r.technician_id = ${id} and (r.ticket_service_line_id = l.id or r.ticket_id = t.id) and ${this.verified()} order by r.created_at desc limit 1) as rating
      ${from} where ${w} order by t.paid_at desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const showCust = can(ctx, 'customers.view');
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), at: iso(r.completed_at ?? r.paid_at), service: r.service_name_snapshot ?? null, minutes: r.duration_minutes_snapshot == null ? null : N(r.duration_minutes_snapshot),
      ticketId: String(r.ticket_id), ticketNumber: r.ticket_number ?? null, customer: showCust ? r.customer ?? null : null, techsOnTicket: N(r.techs), rating: r.rating == null ? null : Number(r.rating) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** her verified reviews in the period, newest first (hidden and spam reviews never shown or counted) */
  async reviews(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    await this.mustTech(ctx, id); const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 6);
    const w = sql`r.tenant_id = ${T} and r.technician_id = ${id} and ${this.verified()} and ${inPeriod(sql`coalesce(r.review_date, r.created_at)`, per)}`;
    const total = N((await sql<any>`select count(*)::int as n from reviews r where r.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select r.id, r.rating, r.comment, r.source, coalesce(r.review_date, r.created_at) as at, r.ticket_id from reviews r where r.tenant_id = ${T} and ${w} order by coalesce(r.review_date, r.created_at) desc, r.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), rating: Number(r.rating), comment: r.comment ?? null, source: r.source ?? null, at: iso(r.at), ticketId: r.ticket_id ? String(r.ticket_id) : null })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** F3: the server-side, audited directory CSV (same columns and file name as before) */
  exportCsv(ctx: TeamCtx, f: ExportFilters, requestId: string) { return auditedExport(this.db, ctx, 'TEAM_PERFORMANCE', f, requestId, () => teamPerformanceCsv(this, ctx, f)); }

  // ── F5 (Finish the Five, 30 Oct 2026): the versioned 0–100 composite, SEPARATE from the 0–5 verified rating ──────────
  /** the evidence each component needs, per technician, from the canonical tables (never tips, pay or spending) */
  private async evidence(ctx: TeamCtx, ids: string[], per: TPeriod): Promise<Map<string, Evidence>> {
    const T = ctx.tenantId; const out = new Map<string, Evidence>(); if (!ids.length) return out;
    const grace = COMPOSITE_MODEL_V1.gracePeriodMinutes;
    const [rv, rel, ot] = await Promise.all([
      sql<any>`select r.technician_id as tid, count(*)::int as n, avg(r.rating)::numeric(4,2) as avg from reviews r
        where r.tenant_id = ${T} and r.technician_id = any(${ids}::uuid[]) and ${this.verified()} and ${inPeriod(sql`coalesce(r.review_date, r.created_at)`, per)} group by r.technician_id`.execute(this.db),
      sql<any>`select qt.assigned_technician_id as tid, count(*) filter (where qt.status = any(${REL_DONE}::text[]))::int as done, count(*) filter (where qt.status = any(${REL_FAILED}::text[]))::int as failed,
          count(*) filter (where qt.status = any(${REL_CUSTOMER}::text[]))::int as excluded
        from pos_tech_queue_tickets qt where qt.tenant_id = ${T} and qt.assigned_technician_id = any(${ids}::uuid[]) and ${inPeriod(sql`coalesce(qt.assigned_at, qt.created_at)`, per)} group by qt.assigned_technician_id`.execute(this.db),
      sql<any>`with s as (select qt.assigned_technician_id as tid, qt.started_at, a.arrived_at, ((a.appt_date + a.start_time::time) at time zone ${per.tz}) as planned
          from pos_tech_queue_tickets qt join pos_tech_appointments a on a.id = qt.appointment_id and a.tenant_id = qt.tenant_id
          where qt.tenant_id = ${T} and qt.assigned_technician_id = any(${ids}::uuid[]) and a.start_time ~ '^[0-9]{1,2}:[0-9]{2}' and ${dateInPeriod(sql`a.appt_date`, per)}
            and a.status not in ('cancelled', 'no_show'))
        select tid, count(*) filter (where started_at is not null and arrived_at is not null and arrived_at <= planned and started_at <= planned + make_interval(mins => ${grace}))::int as on_time,
          count(*) filter (where started_at is not null and arrived_at is not null and arrived_at <= planned and started_at > planned + make_interval(mins => ${grace}))::int as late,
          count(*) filter (where started_at is null or arrived_at is null or arrived_at > planned)::int as excluded
        from s group by tid`.execute(this.db),
    ]);
    for (const id of ids) {
      const r = rv.rows.find((x: any) => String(x.tid) === id); const l = rel.rows.find((x: any) => String(x.tid) === id); const o = ot.rows.find((x: any) => String(x.tid) === id);
      out.set(id, { reviews: { count: N(r?.n), average: r?.avg == null ? null : Number(r.avg) },
        reliability: { completed: N(l?.done), failed: N(l?.failed), excluded: N(l?.excluded) },
        onTime: { onTime: N(o?.on_time), late: N(o?.late), excluded: N(o?.excluded) },
        correction: null });   // no substantiated rework events are recorded anywhere yet → UNSUPPORTED (never a 100 or a 0)
    }
    return out;
  }
  private checksum(id: string, per: TPeriod, e: Evidence) { return createHash('sha256').update(JSON.stringify({ id, from: per.from, to: per.to, model: COMPOSITE_MODEL_V1.version, e })).digest('hex'); }

  /** one technician's composite with every component, sample, threshold and exclusion, the model, and her saved snapshots */
  async composite(ctx: TeamCtx, id: string, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    await this.mustTech(ctx, id); const per = await this.period(ctx, q);
    const e = (await this.evidence(ctx, [id], per)).get(id)!;
    const res = computeComposite(e);
    const snaps = (await sql<any>`select s.id, s.model_version, s.score, s.components_json, s.missing_json, to_char(s.period_start, 'YYYY-MM-DD') as f, to_char(s.period_end, 'YYYY-MM-DD') as t, s.computed_at, s.input_checksum
      from performance_score_snapshots s where s.tenant_id = ${ctx.tenantId} and s.technician_id = ${id} order by s.computed_at desc, s.id desc limit 5`.execute(this.db)).rows;
    return { technicianId: id, period: per, computedAt: new Date().toISOString(), model: COMPOSITE_MODEL_V1, rating: { scale: '0-5', average: e.reviews.average == null ? null : round1(e.reviews.average), reviews: e.reviews.count },
      ...res, inputChecksum: this.checksum(id, per, e), consequences: 'none — coaching and insight only; never pay, commission, scheduling or employment',
      snapshots: snaps.map((s: any) => ({ id: String(s.id), modelVersion: String(s.model_version), score: s.score == null ? null : Number(s.score), from: s.f, to: s.t, computedAt: iso(s.computed_at), missing: s.missing_json ?? [], inputChecksum: s.input_checksum })) };
  }

  /** comparison mode: the verified-rating ranking (what Top Performers uses) beside the composite — nothing re-ranked */
  async compositeComparison(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const per = await this.period(ctx, q); const { page, pageSize } = paging(q.page, q.pageSize, 8);
    const total = N((await sql<any>`${this.perTech(ctx, per)} select count(*)::int as n from x`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`${this.perTech(ctx, per)} select x.tid, x.name, x.reviews, x.avg, row_number() over (order by ${this.rankOrder()}) as pos from x order by ${this.rankOrder()} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const ev = await this.evidence(ctx, rows.map((r: any) => String(r.tid)), per);
    const items = rows.map((r: any) => { const c = computeComposite(ev.get(String(r.tid))!); return { technicianId: String(r.tid), name: r.name ?? null, ratingRank: N(r.pos), rating: r.avg == null ? null : round1(Number(r.avg)), reviews: N(r.reviews),
      composite: c.score, available: c.available, missing: c.missing, components: c.components.map((x) => ({ key: x.key, value: x.value, sample: x.sample, threshold: x.threshold, status: x.status })) }; });
    return { period: per, model: { version: COMPOSITE_MODEL_V1.version, mode: COMPOSITE_MODEL_V1.status }, rankedBy: 'verified_rating', available: items.filter((i: any) => i.available).length, items, page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** save the current composite as an append-only snapshot (its model version and inputs are kept with it) */
  async saveScoreSnapshot(ctx: TeamCtx, b: { technicianId?: unknown; preset?: unknown; from?: unknown; to?: unknown }) {
    if (!can(ctx, 'pos.technicians.edit', 'technicians.edit', 'payroll.manage', 'reports.export')) throw err(403, 'FORBIDDEN', 'You do not have permission to save performance snapshots.');
    const id = String(b.technicianId ?? ''); await this.mustTech(ctx, id); const per = await this.period(ctx, b);
    if (!per.from || !per.to) throw err(422, 'RANGE_REQUIRED', 'Choose a period for the snapshot.');
    const e = (await this.evidence(ctx, [id], per)).get(id)!; const c = computeComposite(e); const sum = this.checksum(id, per, e);
    const r = (await sql<any>`insert into performance_score_snapshots (tenant_id, branch_id, technician_id, period_start, period_end, model_version, components_json, missing_json, score, input_checksum, computed_by)
      values (${ctx.tenantId}, ${branchOf(ctx)}, ${id}, ${per.from}::date, ${per.to}::date, ${c.modelVersion}, ${JSON.stringify(c.components)}::jsonb, ${JSON.stringify(c.missing)}::jsonb, ${c.score}, ${sum}, ${ctx.userId ?? null})
      returning id, computed_at`.execute(this.db)).rows[0];
    return { id: String(r.id), technicianId: id, modelVersion: c.modelVersion, score: c.score, missing: c.missing, computedAt: iso(r.computed_at), inputChecksum: sum };
  }
}
