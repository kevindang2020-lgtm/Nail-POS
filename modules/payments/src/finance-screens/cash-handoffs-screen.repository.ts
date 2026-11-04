// cash-handoffs-screen.repository.ts — End-of-Day Cash mandate (Oct 29 2026): the read model behind POS Payments & Money →
// Daily Closeout / End-of-Day Cash (/cash-handoffs). Raw SQL, tenant + location scoped, ONE ROW PER RECONCILIATION UNIT —
// a technician's business day:
//   • EXPECTED (the custody rule, documented): the cash a technician physically collected that salon-local business day —
//     Σ confirmed "cash to technician" confirmations (cash_payment_confirmations, status confirmed) — never total salon cash
//     sales, drawer cash, commission or tips. A split ticket contributes only its confirmed cash part; the register's own
//     cash (no technician confirmation) never appears here (the Cash Drawer counts it; it excludes these tickets);
//   • COUNTED is the accepted physical count on the unit (tech_cash_handoffs.counted_cents — the replace / add rule lives in
//     the writer; every count is an event in tech_cash_handoff_events); never the expected amount;
//   • DIFFERENCE = counted − expected (negative = shortage, positive = overage); a resolution keeps the figures;
//   • a technician with confirmed cash and no hand-off row is an AWAITING unit (status open); a unit never double-counts a
//     technician (one row per technician and day; the Technicians KPI counts distinct technicians).
// Writes (count, partial, resolve, drawer transfer) stay on the workforce routes (/pos/cash-handoffs/:technicianId/*).
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, dateInPeriod, clampPage, isUuid, N, iso, ymd, likeOf, digitsOf,
  csvDocument, usd, audit, type AuditRecorder, oneOf, moneyToCents, isValidYmd,
} from './finance-scope';

export const CH_BASES = ['business', 'counted', 'submitted', 'created'] as const;
export const CH_STATUSES = ['awaiting', 'open', 'submitted', 'reconciled', 'balanced', 'resolved', 'discrepancy', 'short', 'over', 'cancelled'] as const;
export const CH_SORTS = ['created_desc', 'created_asc', 'date_desc', 'expected_desc', 'variance_asc', 'variance_desc', 'technician_asc'] as const;
export interface ChFilters { period: Period; basis: (typeof CH_BASES)[number]; q: string; status?: (typeof CH_STATUSES)[number]; technicianId?: string; sort: (typeof CH_SORTS)[number] }

const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };

export class CashHandoffsScreenRepository {
  private readonly log = new Logger('CashHandoffsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  /** The salon-local period; the fast path stays the single business day (preset today). */
  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown; date?: unknown }): Promise<Period> {
    const tz = await salonTimeZone(this.db, ctx.tenantId);
    if (isValidYmd(q.date) && !q.preset && !q.from && !q.to) return resolvePeriod({ preset: 'custom', from: q.date, to: q.date }, tz);
    return resolvePeriod(q, tz, { defaultPreset: 'today', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): ChFilters {
    return {
      period, basis: oneOf(q.dateField, CH_BASES, 'dateField') ?? 'business', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      status: oneOf(q.status, CH_STATUSES, 'status'), technicianId: typeof q.technician === 'string' && isUuid(q.technician) ? q.technician : undefined, sort: oneOf(q.sort, CH_SORTS, 'sort') ?? 'created_desc',
    };
  }
  private scope(ctx: FinanceCtx): RawBuilder<boolean> { return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(a.branch_id = ${ctx.branchId}::uuid or a.branch_id is null)` : sql<boolean>`true`; }

  /** The units: confirmed technician cash per salon-local day, full-outer-joined with the hand-off rows. */
  private base(ctx: FinanceCtx, tz: string): RawBuilder<unknown> {
    const T = ctx.tenantId;
    return sql`select coalesce(h.technician_id, e.technician_id) as technician_id, coalesce(h.business_date, e.bd) as business_date, coalesce(h.branch_id, e.branch_id) as branch_id,
        h.id as handoff_id, coalesce(e.expected_cents, h.expected_cents, 0)::bigint as expected_cents, coalesce(e.payment_count, h.payment_count, 0)::int as payment_count,
        h.counted_cents, h.variance_cents, coalesce(h.status, 'open') as status, h.submitted_at, h.reconciled_at, h.resolved_at, h.resolution_reason, h.notes, coalesce(h.version, 0)::int as version,
        coalesce(h.drawer_transfer_cents, 0)::bigint as drawer_transfer_cents, h.denominations_json, h.reconciled_by_user_id, h.resolved_by_user_id, h.submitted_by_user_id,
        coalesce(h.created_at, e.last_at) as created_at, coalesce(h.updated_at, e.last_at) as updated_at, e.first_at, e.last_at,
        tc.full_name as technician_name, tc.is_active as technician_active, tc.normalized_phone as technician_phone, tc.status as technician_status, b.name as branch_name,
        cu.full_name as counted_by, ru.full_name as resolved_by, su.full_name as submitted_by
      from (select c.tenant_id, c.technician_id, c.bd, min(c.branch_id::text)::uuid as branch_id,
            sum(c.amount_cents)::bigint as expected_cents, count(*)::int as payment_count, min(c.confirmed_at) as first_at, max(c.confirmed_at) as last_at
          from (select c0.tenant_id, c0.technician_id, c0.branch_id, c0.amount_cents, c0.confirmed_at, (c0.confirmed_at at time zone ${tz})::date as bd from cash_payment_confirmations c0 where c0.tenant_id = ${T} and c0.status = 'confirmed' and c0.technician_id is not null) c
          group by c.tenant_id, c.technician_id, c.bd) e
      full outer join (select id, tenant_id, branch_id, technician_id, business_date, expected_cents, counted_cents, variance_cents, payment_count, status, submitted_by_user_id, submitted_at, reconciled_by_user_id, reconciled_at, notes,
          created_at, updated_at, version, denominations_json, resolution_reason, resolved_by_user_id, resolved_at, drawer_transfer_cents from tech_cash_handoffs where tenant_id = ${T}) h on h.technician_id = e.technician_id and h.business_date = e.bd
      left join technicians tc on tc.id = coalesce(h.technician_id, e.technician_id) and tc.tenant_id = ${T}
      left join branches b on b.id = coalesce(h.branch_id, e.branch_id) and b.tenant_id = ${T}
      left join users cu on cu.id = h.reconciled_by_user_id and cu.tenant_id = h.tenant_id left join users ru on ru.id = h.resolved_by_user_id and ru.tenant_id = h.tenant_id left join users su on su.id = h.submitted_by_user_id and su.tenant_id = h.tenant_id`;
  }
  private static readonly DIFF = sql`(case when a.counted_cents is null then null else a.counted_cents - a.expected_cents end)`;
  /** the screen's state: awaiting (open / submitted), balanced, resolved (reconciled after a review), under review (short / over), cancelled */
  private static readonly STATE = sql`(case when a.status = 'reconciled' and a.resolved_at is not null then 'resolved' when a.status = 'reconciled' then 'balanced'
      when a.status = 'discrepancy' and a.counted_cents < a.expected_cents then 'short' when a.status = 'discrepancy' then 'over' else a.status end)`;
  private basisCol(b: ChFilters['basis'], p: Period): RawBuilder<boolean> {
    return { business: dateInPeriod(sql`a.business_date`, p), counted: tsInPeriod(sql`a.reconciled_at`, p), submitted: tsInPeriod(sql`a.submitted_at`, p), created: tsInPeriod(sql`a.created_at`, p) }[b];
  }
  private status(s: ChFilters['status']): RawBuilder<boolean> {
    switch (s) {
      case 'awaiting': return sql<boolean>`a.status in ('open', 'submitted')`;
      case 'reconciled': return sql<boolean>`a.status = 'reconciled'`;
      case 'discrepancy': return sql<boolean>`a.status = 'discrepancy'`;
      case 'balanced': case 'resolved': case 'short': case 'over': return sql<boolean>`${CashHandoffsScreenRepository.STATE} = ${s}`;
      case 'open': case 'submitted': case 'cancelled': return sql<boolean>`a.status = ${s}`;
      default: return sql<boolean>`true`;
    }
  }
  private where(ctx: FinanceCtx, f: ChFilters, tz: string): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [this.scope(ctx), this.basisCol(f.basis, f.period)];
    if (f.status) parts.push(this.status(f.status));
    if (f.technicianId) parts.push(sql<boolean>`a.technician_id = ${f.technicianId}::uuid`);
    if (f.q) parts.push(this.search(ctx, f.q, tz).where);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }
  /** the confirmations behind a unit (its eligible cash tickets) — the path customer / ticket searches follow (real links only) */
  private linked(ctx: FinanceCtx, tz: string, cond: RawBuilder<boolean>): RawBuilder<boolean> {
    return sql<boolean>`exists (select 1 from cash_payment_confirmations c join tickets t on t.id = c.ticket_id and t.tenant_id = c.tenant_id left join customers cx on cx.id = coalesce(c.customer_id, t.customer_id) and cx.tenant_id = c.tenant_id
      where c.tenant_id = ${ctx.tenantId} and c.status = 'confirmed' and c.technician_id = a.technician_id and (c.confirmed_at at time zone ${tz})::date = a.business_date and ${cond})`;
  }
  /** technician name / phone / id · hand-off id · ticket # · linked customer name / phone · amount · business date — exact references first */
  private search(ctx: FinanceCtx, q: string, tz: string): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, ''); const tn = q.replace(/^#/, '').trim();
    const exact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) exact.push(sql<boolean>`(a.handoff_id = ${q}::uuid or a.technician_id = ${q}::uuid or ${this.linked(ctx, tz, sql<boolean>`(t.id = ${q}::uuid or c.id = ${q}::uuid)`)})`);
    if (/^\d{1,8}$/.test(tn)) exact.push(this.linked(ctx, tz, sql<boolean>`t.ticket_number = ${tn}`));
    if (isValidYmd(q)) exact.push(sql<boolean>`a.business_date = ${q}::date`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(q) ? moneyToCents(q) : null;
    if (amt != null && amt > 0) exact.push(sql<boolean>`(a.expected_cents = ${amt} or a.counted_cents = ${amt} or ${this.linked(ctx, tz, sql<boolean>`c.amount_cents = ${amt}`)})`);
    if (d.length >= 7) { const tail = d.slice(-10); exact.push(sql<boolean>`(right(regexp_replace(coalesce(a.technician_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail} or ${this.linked(ctx, tz, sql<boolean>`right(regexp_replace(coalesce(cx.normalized_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`)})`); }
    if (q.length >= 2 && !/^\d+$/.test(q)) { part.push(sql<boolean>`lower(coalesce(a.technician_name, '')) like ${likeOf(lower)}`); part.push(this.linked(ctx, tz, sql<boolean>`lower(coalesce(cx.full_name, '')) like ${likeOf(lower)}`)); }
    if (/^\d{2,8}$/.test(tn)) part.push(this.linked(ctx, tz, sql<boolean>`t.ticket_number like ${tn + '%'}`));
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    return { where: sql<boolean>`(${ex} or ${pa})`, rank: sql<number>`(case when ${ex} then 2 when ${pa} then 1 else 0 end)` };
  }
  private static readonly ROW_COLS = sql`a.*, to_char(a.business_date, 'YYYY-MM-DD') as business_ymd, ${CashHandoffsScreenRepository.DIFF} as diff_cents, ${CashHandoffsScreenRepository.STATE} as state`;
  private row(r: any) {
    return {
      id: r.handoff_id ? String(r.handoff_id) : null, technicianId: String(r.technician_id), technician: r.technician_name ?? null, technicianActive: r.technician_active !== false, businessDate: r.business_ymd ?? ymd(r.business_date), branch: r.branch_name ?? null,
      expectedCents: N(r.expected_cents), paymentCount: N(r.payment_count), countedCents: r.counted_cents == null ? null : N(r.counted_cents), differenceCents: r.diff_cents == null ? null : N(r.diff_cents),
      status: String(r.status), state: String(r.state), version: N(r.version), drawerTransferCents: N(r.drawer_transfer_cents),
      submittedAt: iso(r.submitted_at), countedAt: iso(r.reconciled_at), resolvedAt: iso(r.resolved_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), firstCashAt: iso(r.first_at), lastCashAt: iso(r.last_at),
      countedBy: r.counted_by ?? null, resolvedBy: r.resolved_by ?? null, submittedBy: r.submitted_by ?? null, notes: r.notes ?? null, resolutionReason: r.resolution_reason ?? null,
      ...(r.rank !== undefined && r.rank !== 0 ? { matchedBy: r.rank === 2 ? 'reference' : 'name' } : {}),
    };
  }
  private async tz(ctx: FinanceCtx, f: ChFilters): Promise<string> { return f.period.tz || await salonTimeZone(this.db, ctx.tenantId); }

  async list(ctx: FinanceCtx, f: ChFilters, pr: PageReq): Promise<Paged<ReturnType<CashHandoffsScreenRepository['row']>>> {
    const tz = await this.tz(ctx, f); const w = this.where(ctx, f, tz); const s = this.search(ctx, f.q, tz);
    const total = N((await sql<any>`select count(*)::int as n from (${this.base(ctx, tz)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const order = { created_desc: sql`a.created_at desc nulls last, a.technician_id desc`, created_asc: sql`a.created_at asc nulls last, a.technician_id asc`, date_desc: sql`a.business_date desc, a.technician_name asc, a.technician_id desc`,
      expected_desc: sql`a.expected_cents desc, a.created_at desc, a.technician_id desc`, variance_asc: sql`${CashHandoffsScreenRepository.DIFF} asc nulls last, a.created_at desc, a.technician_id desc`,
      variance_desc: sql`${CashHandoffsScreenRepository.DIFF} desc nulls last, a.created_at desc, a.technician_id desc`, technician_asc: sql`a.technician_name asc, a.business_date desc, a.technician_id desc` }[f.sort];
    const rows = (await sql<any>`select ${CashHandoffsScreenRepository.ROW_COLS}, ${f.q ? s.rank : sql`0`} as rank from (${this.base(ctx, tz)}) a where ${w}
      order by ${f.q ? sql`rank desc, ` : sql``}${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** The five KPIs and the difference strip over the whole scope (period + technician; never the page, never the search). */
  async summary(ctx: FinanceCtx, f: ChFilters) {
    const tz = await this.tz(ctx, f); const w = this.where(ctx, { ...f, q: '', status: undefined }, tz);
    const r = (await sql<any>`select coalesce(sum(a.expected_cents), 0)::bigint as expected, coalesce(sum(a.counted_cents), 0)::bigint as counted, count(distinct a.technician_id)::int as technicians,
        count(*)::int as units, count(*) filter (where a.status = 'reconciled')::int as reconciled, count(*) filter (where a.status = 'reconciled' and a.resolved_at is not null)::int as resolved,
        count(*) filter (where a.status in ('open', 'submitted'))::int as awaiting, count(*) filter (where a.status = 'submitted')::int as submitted, count(*) filter (where a.status = 'discrepancy')::int as under_review,
        count(*) filter (where a.counted_cents is not null and a.counted_cents < a.expected_cents)::int as short_units, count(*) filter (where a.counted_cents is not null and a.counted_cents > a.expected_cents)::int as over_units,
        count(*) filter (where a.counted_cents is not null and a.counted_cents = a.expected_cents)::int as balanced_units,
        coalesce(sum(a.counted_cents - a.expected_cents) filter (where a.counted_cents is not null), 0)::bigint as difference,
        coalesce(sum(a.counted_cents - a.expected_cents) filter (where a.counted_cents is not null and a.counted_cents < a.expected_cents), 0)::bigint as short_cents,
        coalesce(sum(a.counted_cents - a.expected_cents) filter (where a.counted_cents is not null and a.counted_cents > a.expected_cents), 0)::bigint as over_cents,
        coalesce(sum(a.expected_cents) filter (where a.counted_cents is null), 0)::bigint as uncounted_expected, coalesce(sum(a.drawer_transfer_cents), 0)::bigint as transferred, coalesce(sum(a.payment_count), 0)::int as payments
      from (${this.base(ctx, tz)}) a where ${w}`.execute(this.db)).rows[0] ?? {};
    return {
      kpis: { expectedCents: N(r.expected), countedCents: N(r.counted), technicians: N(r.technicians), reconciled: N(r.reconciled), awaiting: N(r.awaiting), units: N(r.units), submitted: N(r.submitted), underReview: N(r.under_review), resolved: N(r.resolved), payments: N(r.payments) },
      difference: { totalCents: N(r.difference), shortUnits: N(r.short_units), shortCents: N(r.short_cents), overUnits: N(r.over_units), overCents: N(r.over_cents), balancedUnits: N(r.balanced_units), uncountedExpectedCents: N(r.uncounted_expected), transferredCents: N(r.transferred) },
      definitions: {
        expected: 'cash each technician physically collected on the business day — Σ confirmed cash-to-technician payments (a split ticket contributes its confirmed cash part only); not salon cash sales, drawer cash, commission or tips',
        counted: 'Σ accepted physical counts (a recount replaces; a partial hand-off adds); never the expected amount', technicians: 'distinct technicians with expected cash or a hand-off in the period',
        reconciled: 'units approved as balanced, or resolved after review (shown apart)', awaiting: 'units with cash still to count (awaiting or submitted); a technician who never owed cash is not listed',
        difference: 'counted − expected per unit; negative = shortage, positive = overage; a resolution keeps the figures',
      },
      period: f.period, basis: f.basis, asOf: new Date().toISOString(),
      permissions: { count: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.take_payment'), resolve: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'checkout.manage_overrides'),
        export: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.reports.export'), customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') },
    };
  }

  /** One unit with its eligible cash tickets, every custody event, the drawer transfers and the audit trail. */
  async detail(ctx: FinanceCtx, technicianId: string, businessDate: string) {
    if (!isUuid(technicianId) || !isValidYmd(businessDate)) throw new FinanceError('That cash hand-off could not be found.', 'HANDOFF_NOT_FOUND', 404);
    const T = ctx.tenantId; const tz = await salonTimeZone(this.db, T);
    const r = (await sql<any>`select ${CashHandoffsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, tz)}) a where a.technician_id = ${technicianId}::uuid and a.business_date = ${businessDate}::date and ${this.scope(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That cash hand-off could not be found.', 'HANDOFF_NOT_FOUND', 404);
    const unit = this.row(r);
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    const lines = (await sql<any>`select c.id, c.ticket_id, c.amount_cents, c.confirmed_at, c.notes, t.ticket_number, t.status as ticket_status, t.total_cents as ticket_total_cents, cx.full_name as customer_name, cx.normalized_phone as customer_phone, cx.id as customer_id, u.full_name as confirmed_by,
        (select count(*)::int from payments p where p.tenant_id = c.tenant_id and p.ticket_id = c.ticket_id and p.status not in ('refunded', 'refund', 'voided', 'void', 'reversed', 'declined', 'failed')) as tenders
      from cash_payment_confirmations c join tickets t on t.id = c.ticket_id and t.tenant_id = c.tenant_id left join customers cx on cx.id = coalesce(c.customer_id, t.customer_id) and cx.tenant_id = c.tenant_id left join users u on u.id = c.confirmed_by_user_id and u.tenant_id = c.tenant_id
      where c.tenant_id = ${T} and c.status = 'confirmed' and c.technician_id = ${technicianId}::uuid and (c.confirmed_at at time zone ${tz})::date = ${businessDate}::date order by c.confirmed_at, c.id`.execute(this.db)).rows;
    const events = (await sql<any>`select e.id, e.event_type, e.amount_cents, e.expected_cents, e.counted_total_cents, e.variance_cents, e.denominations_json, e.reason, e.drawer_movement_id, e.idempotency_key, e.created_at, coalesce(u.full_name, u.email) as actor
      from tech_cash_handoff_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.technician_id = ${technicianId}::uuid and e.business_date = ${businessDate}::date order by e.created_at desc, e.id desc`.execute(this.db)).rows;
    const movements = r.handoff_id ? (await sql<any>`select m.id, m.direction, m.amount_cents, m.register_id, m.created_at, m.voided_at, to_char(m.business_date, 'YYYY-MM-DD') as business_date from cash_drawer_movements m where m.tenant_id = ${T} and m.source_type = 'tech_cash_handoff' and m.source_id = ${String(r.handoff_id)}::uuid order by m.created_at desc`.execute(this.db)).rows : [];
    const auditRows = (await sql<any>`select a.action, a.created_at, a.role, a.metadata, coalesce(u.full_name, u.email) as actor from owner_audit_log a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.entity_type = 'tech_cash_handoff' and a.entity_id = ${technicianId} and a.metadata->>'businessDate' = ${businessDate} order by a.created_at desc limit 50`.execute(this.db)).rows;
    return {
      unit, denominations: Array.isArray(r.denominations_json) ? r.denominations_json : (r.denominations_json ? JSON.parse(String(r.denominations_json)) : null),
      lines: lines.map((l: any) => ({ id: String(l.id), ticketId: String(l.ticket_id), ticketNumber: l.ticket_number ?? null, ticketStatus: l.ticket_status ?? null, ticketTotalCents: N(l.ticket_total_cents), tenders: N(l.tenders), amountCents: N(l.amount_cents), confirmedAt: iso(l.confirmed_at), confirmedBy: l.confirmed_by ?? null, note: l.notes ?? null,
        customer: l.customer_id ? { id: String(l.customer_id), name: l.customer_name ?? null, phone: canContact ? showPhone(l.customer_phone) : maskPhone(l.customer_phone) } : null })),
      events: events.map((e: any) => ({ id: String(e.id), type: String(e.event_type), amountCents: e.amount_cents == null ? null : N(e.amount_cents), expectedCents: e.expected_cents == null ? null : N(e.expected_cents), countedTotalCents: e.counted_total_cents == null ? null : N(e.counted_total_cents), varianceCents: e.variance_cents == null ? null : N(e.variance_cents),
        denominations: e.denominations_json ? (Array.isArray(e.denominations_json) ? e.denominations_json : JSON.parse(String(e.denominations_json))) : null, reason: e.reason ?? null, drawerMovementId: e.drawer_movement_id ? String(e.drawer_movement_id) : null, idempotent: !!e.idempotency_key, at: iso(e.created_at), actor: e.actor ?? null })),
      drawerMovements: movements.map((m: any) => ({ id: String(m.id), direction: String(m.direction), amountCents: N(m.amount_cents), register: String(m.register_id ?? 'main'), businessDate: String(m.business_date), at: iso(m.created_at), voided: !!m.voided_at })),
      audit: auditRows.map((a: any) => ({ action: String(a.action), at: iso(a.created_at), actor: a.actor ?? a.role ?? null, metadata: a.metadata ?? null })),
      permissions: { count: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.take_payment'), resolve: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'checkout.manage_overrides'), customer: canContact },
    };
  }

  /** Technicians with cash or hand-offs in the salon (the filter list) — active first. */
  async technicians(ctx: FinanceCtx): Promise<{ id: string; name: string; active: boolean }[]> {
    const rows = (await sql<any>`select tc.id, tc.full_name, tc.is_active from technicians tc where tc.tenant_id = ${ctx.tenantId} and tc.archived_at is null
      and (exists (select 1 from tech_cash_handoffs h where h.tenant_id = tc.tenant_id and h.technician_id = tc.id) or exists (select 1 from cash_payment_confirmations c where c.tenant_id = tc.tenant_id and c.technician_id = tc.id and c.status = 'confirmed') or tc.is_active)
      order by tc.is_active desc, tc.full_name limit 300`.execute(this.db)).rows;
    return rows.map((r: any) => ({ id: String(r.id), name: String(r.full_name ?? ''), active: r.is_active !== false }));
  }

  /** CSV of every matching unit (all pages) with the calculation basis stated; audited. */
  async exportCsv(ctx: FinanceCtx, f: ChFilters): Promise<string> {
    const tz = await this.tz(ctx, f); const w = this.where(ctx, f, tz);
    const rows = (await sql<any>`select ${CashHandoffsScreenRepository.ROW_COLS}, 0 as rank from (${this.base(ctx, tz)}) a where ${w} order by a.business_date desc, a.technician_name asc, a.technician_id limit 20000`.execute(this.db)).rows.map((r: any) => this.row(r));
    const sum = await this.summary(ctx, f);
    const doc = csvDocument('End-of-day cash hand-offs', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'], ['Search', f.q || '—'], ['Status', f.status ?? 'all'],
        ['Expected basis', 'confirmed cash-to-technician payments per salon-local business day'], ['Difference', 'counted minus expected (negative = short)'], ['Currency', 'USD']],
      ['Business date', 'Technician', 'Branch', 'Cash tickets', 'Expected', 'Counted', 'Difference', 'State', 'Counted by', 'Counted at', 'Resolved by', 'Resolution', 'Drawer transfer', 'Notes'],
      rows.map((x) => [x.businessDate ?? '', x.technician ?? '', x.branch ?? '', x.paymentCount, usd(x.expectedCents), x.countedCents == null ? '' : usd(x.countedCents), x.differenceCents == null ? '' : usd(x.differenceCents), x.state, x.countedBy ?? '', x.countedAt ?? '', x.resolvedBy ?? '', x.resolutionReason ?? '', usd(x.drawerTransferCents), x.notes ?? '']),
      [['Units', String(rows.length)], ['Expected (period)', usd(sum.kpis.expectedCents)], ['Counted (period)', usd(sum.kpis.countedCents)], ['Difference (period)', usd(sum.difference.totalCents)]]);
    await audit(this.auditor, ctx, 'cash_handoffs', 'cash_handoffs_exported', 'tech_cash_handoff', null, { rows: rows.length, status: f.status ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`cash hand-offs export audit failed: ${(e as Error).message}`));
    return doc;
  }
}
