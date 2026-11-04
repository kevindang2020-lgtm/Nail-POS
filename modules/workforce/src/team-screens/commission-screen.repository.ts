// commission-screen.repository.ts — the read model behind the rebuilt Commission Report (/tenant/reports/commission, Oct 30
// 2026). Read only, over the SAME immutable records payroll and the Technician App use — never a parallel ledger:
//   ticket_compensation_snapshots  one row per paid service / retail line and technician, written at checkout: the gross
//                                  price, discount, commissionable base, the CAPTURED commission type + value, the engine's
//                                  technician earnings, and that technician's allocated card + cash tips
//   compensation_adjustments       posted / approved / applied corrections (tip_correction → tips, the rest → commission)
//   ticket_tip_allocations         how each ticket's tip was split between technicians (for the tip check)
//   payroll_payouts                payments actually recorded (paid / pending / processing) — the only source of "Paid"
// The five KPIs and the grouped table use the existing Commission Report formula exactly (computeCommission): per technician
// services = snapshot lines · revenue = Σ gross · commission = Σ (earnings + retail commission) + commission adjustments ·
// tips = Σ allocated tips + tip adjustments · payout = commission + tips (an OBLIGATION for the period, not a payment) ·
// rate = commission ÷ revenue (effective, 1 dp). The period is the salon's days, end day included; basis = when the ticket
// was paid (the snapshot). Nothing here moves money, edits an earning or changes who owns a tip.
import { sql, type Kysely } from 'kysely';
import { auditedExport, commissionCsv, exportHistory, type ExportFilters } from './report-export';
import { N, iso, like, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, UUID, err, type TeamCtx, type TPeriod, canAny } from './screen-kit';
import { dateColumnYmd } from '@aipowersalon/date-time';

const ADJ_OK = ['posted', 'approved', 'applied'];
export const COMM_SORTS = ['payout', 'commission', 'services', 'name', 'recent'] as const;
export const DISCREPANCY_KINDS = ['all', 'duplicate_line', 'missing_technician', 'tip_mismatch', 'earnings_over_base', 'payout_mismatch'] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;
const can = canAny;

export class CommissionScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  private brS(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(s.branch_id = ${b} or s.branch_id is null)` : sql`true`; }
  private brA(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; }
  private brP(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(p.branch_id = ${b} or p.branch_id is null)` : sql`true`; }
  period(ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) { return teamPeriod(this.db, ctx, q, 'month'); }
  private mustPay(ctx: TeamCtx) { if (!can(ctx, 'payroll.view', 'technicians.view_pay', 'reports.view', 'pos.reports.view')) throw err(403, 'FORBIDDEN', 'You do not have permission to view technician pay.'); }

  /** per technician: the existing report's figures, plus discount / base / adjustments split out, last activity and paid */
  private grouped(ctx: TeamCtx, per: TPeriod) {
    const T = ctx.tenantId;
    return sql`with l as (select s.technician_id as tid, count(*)::int as n, coalesce(sum(s.gross_price_cents), 0)::bigint as rev, coalesce(sum(s.discount_cents), 0)::bigint as disc,
          coalesce(sum(s.commissionable_cents), 0)::bigint as base, coalesce(sum(coalesce(s.tech_service_earnings_cents, 0) + coalesce(s.retail_commission_cents, 0)), 0)::bigint as comm,
          coalesce(sum(coalesce(s.card_tip_cents, 0) + coalesce(s.cash_tip_cents, 0)), 0)::bigint as tips, max(s.snapshot_at) as last_at
        from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${this.brS(ctx)} and s.technician_id is not null and ${inPeriod(sql`s.snapshot_at`, per)} group by s.technician_id),
      a as (select a.technician_id as tid, coalesce(sum(a.amount_cents) filter (where a.category <> 'tip_correction'), 0)::bigint as ca, coalesce(sum(a.amount_cents) filter (where a.category = 'tip_correction'), 0)::bigint as ta
        from compensation_adjustments a where a.tenant_id = ${T} and ${this.brA(ctx)} and a.technician_id is not null and a.status = any(${ADJ_OK}) and ${inPeriod(sql`a.created_at`, per)} group by a.technician_id),
      p as (select p.technician_id as tid, coalesce(sum(p.amount_cents) filter (where p.status = 'paid'), 0)::bigint as paid, coalesce(sum(p.amount_cents) filter (where p.status in ('pending', 'processing')), 0)::bigint as pending
        from payroll_payouts p where p.tenant_id = ${T} and ${this.brP(ctx)} and ${inPeriod(sql`coalesce(p.paid_at, p.created_at)`, per)} group by p.technician_id),
      ids as (select tid from l union select tid from a),
      g as (select ids.tid, coalesce(l.n, 0) as n, coalesce(l.rev, 0) as rev, coalesce(l.disc, 0) as disc, coalesce(l.base, 0) as base, coalesce(l.comm, 0) + coalesce(a.ca, 0) as comm,
          coalesce(a.ca, 0) as ca, greatest(coalesce(l.tips, 0), 0) + coalesce(a.ta, 0) as tips, coalesce(a.ta, 0) as ta, l.last_at, coalesce(p.paid, 0) as paid, coalesce(p.pending, 0) as pending
        from ids left join l on l.tid = ids.tid left join a on a.tid = ids.tid left join p on p.tid = ids.tid)`;
  }

  /** the five KPIs (+ the split-out parts and recorded payments) for the period */
  async summary(ctx: TeamCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    this.mustPay(ctx); const per = await this.period(ctx, f);
    const r = (await sql<any>`${this.grouped(ctx, per)} select count(*)::int as techs, coalesce(sum(n), 0)::int as n, coalesce(sum(rev), 0)::bigint as rev, coalesce(sum(disc), 0)::bigint as disc, coalesce(sum(base), 0)::bigint as base,
        coalesce(sum(comm), 0)::bigint as comm, coalesce(sum(ca), 0)::bigint as ca, coalesce(sum(tips), 0)::bigint as tips, coalesce(sum(ta), 0)::bigint as ta, coalesce(sum(paid), 0)::bigint as paid, coalesce(sum(pending), 0)::bigint as pending from g`.execute(this.db)).rows[0];
    const rev = N(r?.rev), comm = N(r?.comm), tips = N(r?.tips);
    return { period: per, basis: 'paid_checkout', kpis: { technicianCount: N(r?.techs), lineCount: N(r?.n), serviceRevenueCents: rev, discountCents: N(r?.disc), commissionableCents: N(r?.base),
      commissionCents: comm, commissionAdjustmentCents: N(r?.ca), tipsCents: tips, tipAdjustmentCents: N(r?.ta), payoutCents: comm + tips, averageRatePercent: rev > 0 ? round1((comm / rev) * 100) : 0,
      paidCents: N(r?.paid), pendingCents: N(r?.pending) } };
  }

  /** Payout by Technician: one row per technician (never duplicated), searchable beyond the page, sortable, paged */
  async technicians(ctx: TeamCtx, f: { q?: string; sort?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const sort = (COMM_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'commission';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw);
    const order = sort === 'payout' ? sql`(g.comm + g.tips) desc, g.comm desc, g.tid` : sort === 'services' ? sql`g.n desc, g.comm desc, g.tid` : sort === 'name' ? sql`lower(coalesce(te.full_name, '')) asc, g.tid`
      : sort === 'recent' ? sql`g.last_at desc nulls last, g.tid` : sql`g.comm desc, (g.comm + g.tips) desc, g.tid`;
    // a line of this technician in the period that matches the words (ticket number / id, service, customer name or phone)
    const lineHit = sql`exists (select 1 from ticket_compensation_snapshots s2 left join tickets tk on tk.id = s2.ticket_id and tk.tenant_id = s2.tenant_id
        left join customers c on c.id = tk.customer_id and c.tenant_id = s2.tenant_id left join services sv on sv.id = s2.service_id and sv.tenant_id = s2.tenant_id
      where s2.tenant_id = ${T} and s2.technician_id = g.tid and ${inPeriod(sql`s2.snapshot_at`, per)}
        and (${isId} and (s2.ticket_id::text = ${raw} or s2.service_line_id::text = ${raw}) or coalesce(tk.ticket_number, '') ilike ${l} or coalesce(sv.name, '') ilike ${l} or coalesce(c.full_name, '') ilike ${l}
          or (${phoneish} and right(regexp_replace(coalesce(c.normalized_phone, c.phone_display, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'})))`;
    const techHit = sql`(coalesce(te.full_name, '') ilike ${l} or g.tid::text = ${raw} or (${phoneish} and right(regexp_replace(coalesce(te.normalized_phone, te.phone_display, ''), '\\D', '', 'g'), 10) like ${'%' + d + '%'}))`;
    const w = raw === '' ? sql`true` : sql`(${techHit} or ${lineHit})`;
    const from = sql`from g left join technicians te on te.id = g.tid and te.tenant_id = ${T}`;
    const total = N((await sql<any>`${this.grouped(ctx, per)} select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`${this.grouped(ctx, per)} select g.*, te.full_name, te.avatar_url, te.status as account, ${raw === '' ? sql`false` : techHit} as by_tech ${from} where ${w} order by ${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, sort, items: rows.map((r: any) => { const rev = N(r.rev), comm = N(r.comm), tips = N(r.tips); return {
      technicianId: String(r.tid), technicianName: r.full_name ?? null, avatarUrl: r.avatar_url ?? null, inactive: r.account != null && r.account !== 'active',
      serviceCount: N(r.n), serviceRevenueCents: rev, discountCents: N(r.disc), commissionableCents: N(r.base), commissionCents: comm, commissionAdjustmentCents: N(r.ca), tipsCents: tips, tipAdjustmentCents: N(r.ta),
      payoutCents: comm + tips, effectiveRatePercent: rev > 0 ? round1((comm / rev) * 100) : 0, lastActivityAt: iso(r.last_at), paidCents: N(r.paid), pendingCents: N(r.pending),
      matchedVia: raw === '' ? null : r.by_tech ? 'technician' : 'line' }; }),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  private async mustTech(ctx: TeamCtx, id: string) {
    if (!UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const t = (await sql<any>`select te.id, te.full_name, te.avatar_url, te.status, b.name as branch from technicians te left join branches b on b.id = te.branch_id and b.tenant_id = te.tenant_id where te.tenant_id = ${ctx.tenantId} and te.id = ${id}`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    return t;
  }

  /** one technician's service lines: completed (paid) at, ticket, service, revenue, discount, base, CAPTURED rate, share, earned */
  async lines(ctx: TeamCtx, id: string, f: { q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; const t = await this.mustTech(ctx, id); const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const from = sql`from ticket_compensation_snapshots s left join tickets tk on tk.id = s.ticket_id and tk.tenant_id = s.tenant_id left join customers c on c.id = tk.customer_id and c.tenant_id = s.tenant_id
      left join services sv on sv.id = s.service_id and sv.tenant_id = s.tenant_id left join ticket_service_lines tl on tl.id = s.service_line_id and tl.tenant_id = s.tenant_id`;
    const w = sql`s.tenant_id = ${T} and ${this.brS(ctx)} and s.technician_id = ${id} and ${inPeriod(sql`s.snapshot_at`, per)}
      and (${raw} = '' or coalesce(tk.ticket_number, '') ilike ${l} or coalesce(sv.name, tl.service_name_snapshot, '') ilike ${l} or coalesce(c.full_name, '') ilike ${l} or s.ticket_id::text = ${raw})`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select s.id, s.ticket_id, s.service_line_id, s.snapshot_at, s.gross_price_cents, s.discount_cents, s.commissionable_cents, s.commission_type, s.commission_value, s.commission_source,
        s.tech_service_earnings_cents, s.retail_commission_cents, s.card_tip_cents, s.cash_tip_cents, tk.ticket_number, c.full_name as customer, coalesce(sv.name, tl.service_name_snapshot) as service, coalesce(tl.line_kind, 'service') as kind,
        (select count(distinct s3.technician_id) from ticket_compensation_snapshots s3 where s3.tenant_id = ${T} and s3.ticket_id = s.ticket_id and s3.technician_id is not null)::int as techs_on_ticket
      ${from} where ${w} order by s.snapshot_at desc, s.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const showCust = can(ctx, 'customers.view');
    return { period: per, technician: { technicianId: String(t.id), name: t.full_name ?? null, avatarUrl: t.avatar_url ?? null, branch: t.branch ?? null, inactive: t.status !== 'active' },
      items: rows.map((r: any) => { const base = N(r.commissionable_cents), earned = N(r.tech_service_earnings_cents) + N(r.retail_commission_cents); return {
        id: String(r.id), ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number ?? null, serviceLineId: r.service_line_id ? String(r.service_line_id) : null, at: iso(r.snapshot_at),
        service: r.service ?? null, kind: String(r.kind), customer: showCust ? r.customer ?? null : null, grossCents: N(r.gross_price_cents), discountCents: N(r.discount_cents), commissionableCents: base,
        rateType: String(r.commission_type ?? 'percent'), rateValue: r.commission_value == null ? null : Number(r.commission_value), rateSource: r.commission_source ?? null,
        earnedCents: earned, effectivePercent: base > 0 ? round1((earned / base) * 100) : null, tipsCents: N(r.card_tip_cents) + N(r.cash_tip_cents), techsOnTicket: N(r.techs_on_ticket) }; }),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** one technician's tips per ticket: her allocated amount, the ticket's tip, how many technicians shared it, and a flag
   *  when the ticket's allocations do not add up to the ticket's tip (shown, never "fixed") */
  async tips(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; await this.mustTech(ctx, id); const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const from = sql`from ticket_tip_allocations ta join tickets tk on tk.id = ta.ticket_id and tk.tenant_id = ta.tenant_id`;
    const w = sql`ta.tenant_id = ${T} and ta.technician_id = ${id} and ${inPeriod(sql`coalesce(tk.paid_at, ta.created_at)`, per)} and (${branchOf(ctx)}::uuid is null or ta.branch_id = ${branchOf(ctx)} or ta.branch_id is null)`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select ta.id, ta.ticket_id, ta.tip_cents, tk.ticket_number, tk.tip_cents as ticket_tip, coalesce(tk.paid_at, ta.created_at) as at,
        (select count(*) from ticket_tip_allocations x where x.tenant_id = ${T} and x.ticket_id = ta.ticket_id)::int as shares, (select coalesce(sum(x.tip_cents), 0) from ticket_tip_allocations x where x.tenant_id = ${T} and x.ticket_id = ta.ticket_id)::bigint as allocated
      ${from} where ${w} order by coalesce(tk.paid_at, ta.created_at) desc, ta.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), ticketId: String(r.ticket_id), ticketNumber: r.ticket_number ?? null, at: iso(r.at), tipCents: N(r.tip_cents), ticketTipCents: N(r.ticket_tip),
      shares: N(r.shares), allocatedCents: N(r.allocated), mismatch: N(r.allocated) !== N(r.ticket_tip) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** one technician's adjustments, newest first, with who asked and who decided */
  async adjustments(ctx: TeamCtx, id: string, f: { preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; await this.mustTech(ctx, id); const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const w = sql`a.tenant_id = ${T} and ${this.brA(ctx)} and a.technician_id = ${id} and ${inPeriod(sql`a.created_at`, per)}`;
    const total = N((await sql<any>`select count(*)::int as n from compensation_adjustments a where a.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, a.category, a.amount_cents, a.reason, a.reason_code, a.status, a.source, a.ticket_id, a.created_at, a.decided_at, coalesce(nullif(rq.full_name, ''), rq.email) as requested_by, coalesce(nullif(ap.full_name, ''), ap.email) as approved_by
      from compensation_adjustments a left join users rq on rq.id = a.requested_by and rq.tenant_id = a.tenant_id left join users ap on ap.id = coalesce(a.approved_by, a.decided_by) where a.tenant_id = ${T} and ${w} order by a.created_at desc, a.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), category: String(r.category ?? ''), amountCents: N(r.amount_cents), reason: r.reason ?? r.reason_code ?? null, status: String(r.status ?? ''), source: r.source ?? null,
      counted: ADJ_OK.includes(String(r.status)), ticketId: r.ticket_id ? String(r.ticket_id) : null, at: iso(r.created_at), decidedAt: iso(r.decided_at), requestedBy: r.requested_by ?? null, approvedBy: r.approved_by ?? null })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** payouts actually recorded (payroll), newest first — the only place "Paid" comes from */
  async payouts(ctx: TeamCtx, f: { technicianId?: string; q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const tid = f.technicianId && UUID.test(f.technicianId) ? f.technicianId : null; const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const w = sql`p.tenant_id = ${T} and ${this.brP(ctx)} and (${tid}::uuid is null or p.technician_id = ${tid}) and ${inPeriod(sql`coalesce(p.paid_at, p.created_at)`, per)}
      and (${raw} = '' or coalesce(p.reference, '') ilike ${l} or coalesce(p.check_number, '') ilike ${l} or coalesce(te.full_name, '') ilike ${l} or p.id::text = ${raw})`;
    const from = sql`from payroll_payouts p left join technicians te on te.id = p.technician_id and te.tenant_id = p.tenant_id left join payroll_periods pp on pp.id = p.period_id and pp.tenant_id = p.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select p.id, p.technician_id, te.full_name, p.amount_cents, p.method, p.status, p.reference, p.check_number, p.paid_at, p.created_at, pp.label, pp.period_start, pp.period_end
      ${from} where ${w} order by coalesce(p.paid_at, p.created_at) desc, p.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const ymd = (v: unknown) => dateColumnYmd(v);   // a Postgres DATE column (the driver's local-midnight Date) → its calendar day
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), technicianId: r.technician_id ? String(r.technician_id) : null, technician: r.full_name ?? null, amountCents: N(r.amount_cents), method: String(r.method ?? ''), status: String(r.status ?? ''),
      reference: r.reference ?? r.check_number ?? null, paidAt: iso(r.paid_at), createdAt: iso(r.created_at), payrollPeriod: r.label ?? (r.period_start ? `${ymd(r.period_start)} – ${ymd(r.period_end)}` : null) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Commission Discrepancy Review — read-only checks over the period; each finding names the records and the amounts */
  async discrepancies(ctx: TeamCtx, f: { kind?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    this.mustPay(ctx); const T = ctx.tenantId; const per = await this.period(ctx, f); const { page, pageSize } = paging(f.page, f.pageSize, 8);
    const kind = (DISCREPANCY_KINDS as readonly string[]).includes(String(f.kind)) ? String(f.kind) : 'all';
    const checks = sql`
      select 'duplicate_line' as kind, 'high' as severity, max(s.snapshot_at) as at, s.technician_id, min(s.ticket_id::text) as ticket_id, s.service_line_id::text as ref, count(*)::bigint as expected, sum(coalesce(s.tech_service_earnings_cents, 0))::bigint as recorded
        from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${this.brS(ctx)} and s.service_line_id is not null and ${inPeriod(sql`s.snapshot_at`, per)} group by s.service_line_id, s.technician_id having count(*) > 1
      union all select 'missing_technician', 'medium', s.snapshot_at, null, s.ticket_id::text, s.service_line_id::text, s.gross_price_cents, 0
        from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${this.brS(ctx)} and s.technician_id is null and coalesce(s.gross_price_cents, 0) > 0 and ${inPeriod(sql`s.snapshot_at`, per)}
      union all select 'earnings_over_base', 'medium', s.snapshot_at, s.technician_id, s.ticket_id::text, s.service_line_id::text, s.commissionable_cents, s.tech_service_earnings_cents
        from ticket_compensation_snapshots s where s.tenant_id = ${T} and ${this.brS(ctx)} and coalesce(s.tech_service_earnings_cents, 0) > coalesce(s.commissionable_cents, 0) and coalesce(s.commissionable_cents, 0) > 0 and ${inPeriod(sql`s.snapshot_at`, per)}
      union all select 'tip_mismatch', 'medium', tk.paid_at, null, tk.id::text, tk.ticket_number, coalesce(tk.tip_cents, 0), coalesce((select sum(x.tip_cents) from ticket_tip_allocations x where x.tenant_id = ${T} and x.ticket_id = tk.id), 0)
        from tickets tk where tk.tenant_id = ${T} and (${branchOf(ctx)}::uuid is null or tk.branch_id = ${branchOf(ctx)}) and tk.paid_at is not null and ${inPeriod(sql`tk.paid_at`, per)} and tk.removed_at is null
          and coalesce(tk.tip_cents, 0) <> coalesce((select sum(x.tip_cents) from ticket_tip_allocations x where x.tenant_id = ${T} and x.ticket_id = tk.id), 0)
      union all select 'payout_mismatch', 'high', coalesce(pp.paid_at, pp.finalized_at, pp.updated_at), pl.technician_id, null, pp.id::text, pl.payable_cents,
          coalesce((select sum(po.amount_cents) from payroll_payouts po where po.tenant_id = ${T} and po.period_id = pp.id and po.technician_id = pl.technician_id and po.status = 'paid'), 0)
        from payroll_lines pl join payroll_periods pp on pp.id = pl.period_id and pp.tenant_id = pl.tenant_id where pl.tenant_id = ${T} and pp.status = 'paid' and ${inPeriod(sql`coalesce(pp.paid_at, pp.updated_at)`, per)}
          and coalesce(pl.payable_cents, 0) <> coalesce((select sum(po.amount_cents) from payroll_payouts po where po.tenant_id = ${T} and po.period_id = pp.id and po.technician_id = pl.technician_id and po.status = 'paid'), 0)`;
    const from = sql`from (${checks}) x left join technicians te on te.id = x.technician_id and te.tenant_id = ${T} left join tickets tk2 on tk2.id::text = x.ticket_id and tk2.tenant_id = ${T}`;
    const w = sql`(${kind} = 'all' or x.kind = ${kind})`;
    const counts = (await sql<any>`select x.kind, count(*)::int as n ${from} group by x.kind`.execute(this.db)).rows;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.*, te.full_name, tk2.ticket_number ${from} where ${w} order by x.at desc nulls last, x.kind, x.ref limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, counts: Object.fromEntries(counts.map((c: any) => [String(c.kind), N(c.n)])), checked: DISCREPANCY_KINDS.filter((k) => k !== 'all'), notChecked: ['rate_mismatch', 'refund_exception'],
      items: rows.map((r: any) => ({ kind: String(r.kind), severity: String(r.severity), at: iso(r.at), technicianId: r.technician_id ? String(r.technician_id) : null, technician: r.full_name ?? null,
        ticketId: r.ticket_id ?? null, ticketNumber: r.ticket_number ?? null, ref: r.ref ?? null, expected: N(r.expected), recorded: N(r.recorded) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** F3: the server-side, audited Payout by Technician CSV (same columns and file name as before) */
  exportCsv(ctx: TeamCtx, f: ExportFilters, requestId: string) { return auditedExport(this.db, ctx, 'COMMISSION', f, requestId, () => commissionCsv(this, ctx, f)); }
  exportHistory(ctx: TeamCtx, f: { type?: string; page?: unknown; pageSize?: unknown }) { return exportHistory(this.db, ctx, f); }
}
