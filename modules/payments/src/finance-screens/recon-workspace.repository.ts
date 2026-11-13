// recon-workspace.repository.ts — AI Deposit Reconciliation mandate (Oct 29 2026): the server side of POS Payments & Money →
// AI Deposit Reconciliation (/tenant/payments/deposit-reconciliation): Overview (five KPIs, Settlements → Deposits, Bank
// Accounts, Record a Deposit, Unmatched Deposits), Fees, Exceptions and Reports. Raw, parameterised SQL; the tenant is the
// session's and is written in every statement.
//
// WHAT THIS MODULE NEVER DOES (spec §11 / §13 / §18): it moves no money, initiates no transfer, edits no processor settlement,
// changes no payout destination and rewrites no posted bank entry. Recording a deposit creates a RECORD; matching creates an
// ALLOCATION; a suggestion is advice and is never applied without a person.
//
// MATCHING = ALLOCATIONS (migration 711). A settlement's expected payout is coalesce(expected_net_cents, net_cents). Its
// matched amount is the sum of its ACTIVE allocations; a deposit's allocated amount likewise. Under row locks (SELECT … FOR
// UPDATE on both rows, in one transaction) an allocation may never exceed what is still unallocated on EITHER side, so a
// split payout (1 settlement → n deposits), a combined payout (n settlements → 1 deposit) and a partial match are all
// expressible and a double match is impossible. Unmatching stamps the allocation (audited) — it is never deleted.
//
// STATUS of a settlement (spec §09), derived — nothing is stored over the processor's own status column:
//   under_review       an unresolved exception on it is in review
//   exception          an unresolved exception is open / escalated / reopened, or the processor reported failed / returned
//   matched            active allocations = expected payout (> 0)
//   no_payout          expected payout ≤ 0 (a refund-heavy batch) — nothing to match
//   partially_matched  0 < allocated < expected
//   pending            the processor batch itself is pending
//   overdue            nothing allocated and today (salon time) is past the expected arrival + GRACE_DAYS
//   expected           nothing allocated, still inside the arrival window
// Expected arrival = the processor's expected_deposit_date when it sends one, else settlement date + FUNDING_DAYS (labelled
// "estimated"). KPIs (spec §08): Expected Deposits Σ expected (> 0); Matched Σ min(allocated, expected); Settlements =
// count; Missing Deposits = overdue count; Net Difference = matched − expected over the settlements that are DUE (arrival
// passed) — not-yet-due payouts are listed as an exclusion, never counted as missing money.
import { caseDue, EXCEPTION_REVIEW_DAYS, type ExceptionSeverity, type ExceptionStatus } from '../deposit-reconciliation/deposit-reconciliation.exceptions';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { logException } from '@aipowersalon/observability';
import { assertTransition } from '@aipowersalon/database';
import {
  FinanceError, isUuid, N, iso, ymd, clampPage, resolvePeriod, salonTimeZone, tsInPeriod, dateInPeriod, searchText, digitsOf, likeOf, prefixOf,
  moneyToCents, positiveCents, oneOf, isValidYmd, csvDocument, usd, audit, daysBetween, type AuditRecorder, type FinanceCtx, type Period, type PageReq,
} from './finance-scope';
import { BANK_ACCOUNT } from '../payments-lifecycles';

export const FUNDING_DAYS = 3;
export const GRACE_DAYS = 2;
export const RECON_DATE_BASES = ['settlement', 'expected_deposit', 'bank_posted', 'payment', 'created'] as const;
export type ReconDateBasis = (typeof RECON_DATE_BASES)[number];
export const RECON_STATUSES = ['pending', 'expected', 'matched', 'partially_matched', 'overdue', 'exception', 'under_review', 'no_payout'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];
export const RECON_SORTS = ['created_desc', 'created_asc', 'settled_desc', 'arrival_asc', 'difference_desc', 'expected_desc'] as const;
export const EXCEPTION_CLASSES = ['missing', 'amount_mismatch', 'duplicate', 'unmatched_credit', 'fee_reversal', 'integration'] as const;
export type ExceptionClass = (typeof EXCEPTION_CLASSES)[number];
const CLASS_KINDS: Record<ExceptionClass, string[]> = {
  missing: ['missing_deposit', 'unmatched_settlement'], amount_mismatch: ['amount_mismatch'], duplicate: ['duplicate'],
  unmatched_credit: ['unmatched_deposit'], fee_reversal: ['fee_difference', 'adjustment_unresolved'], integration: ['integration_error', 'other'],
};
export const classOfKind = (k: string): ExceptionClass => (Object.entries(CLASS_KINDS).find(([, v]) => v.includes(k))?.[0] as ExceptionClass) ?? 'integration';
export const REPORT_TYPES = ['settlement_summary', 'matched_deposits', 'unmatched_deposits', 'missing_overdue', 'processing_fees', 'exceptions_aging', 'net_difference_trend', 'bank_accounts', 'processor_comparison'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const DEPOSIT_MAX_CENTS = 100_000_000;   // $1,000,000 — a larger manual entry is a typo or an import

export interface ReportColumn { key: string; label: string; money?: boolean; align?: 'right' }
export interface ReconFilters { period: Period; basis: ReconDateBasis; q: string; status?: ReconStatus; processor?: string; bankAccountId?: string; sort: (typeof RECON_SORTS)[number]; open?: boolean }

const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const masked = (nickname: unknown, last4: unknown) => `${String(nickname ?? '')}${last4 ? ` ••••${String(last4).slice(-4)}` : ''}`.trim() || null;
const phoneLast4 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 4 ? `•••-${d.slice(-4)}` : null; };

/** extras PAYMENTS 09 — card attempt states that are unresolved: waiting on a person, or still in flight. */
export const CARD_ATTEMPT_REVIEW = ['needs_review', 'unknown', 'reconciliation_required'];
export const CARD_ATTEMPT_IN_FLIGHT = ['created', 'processing', 'pending', 'readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending', 'authorized', 'confirmation_pending'];
export const CARD_ATTEMPT_STALE_MIN = 30;
const CARD_ATTEMPT_LIST = 10;

export class ReconWorkspaceRepository {
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}
  private log = (where: string, ctx: FinanceCtx) => (e: unknown) => logException(e, { where: `recon-workspace.${where}`, tenantId: ctx.tenantId });

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    // allowAll: the Match dialog's pickers search every open record (they used a hard-coded 2021–2030 range)
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): ReconFilters {
    const bank = typeof q.bankAccountId === 'string' && q.bankAccountId && q.bankAccountId !== 'all' ? q.bankAccountId : undefined;
    if (bank && !isUuid(bank)) throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400, { field: 'bankAccountId' });
    return {
      period, basis: oneOf(q.dateField, RECON_DATE_BASES, 'dateField') ?? 'settlement', q: searchText(q.search), status: oneOf(q.status, RECON_STATUSES, 'status'),
      processor: typeof q.processor === 'string' && q.processor && q.processor !== 'all' ? q.processor.slice(0, 40) : undefined, bankAccountId: bank,
      sort: oneOf(q.sort, RECON_SORTS, 'sort') ?? 'created_desc', open: q.open === '1' || q.open === 'true' || q.open === true,
    };
  }

  // ── settlements → deposits ─────────────────────────────────────────────────────────────────────────────────────
  private base(ctx: FinanceCtx, tz: string) {
    const T = ctx.tenantId;
    return sql`with al as (
        select a.settlement_id, coalesce(sum(a.amount_cents), 0)::bigint as allocated, count(distinct a.deposit_id)::int as deposits,
               array_agg(distinct d.reference) filter (where d.reference is not null) as refs, array_agg(distinct a.deposit_id) as deposit_ids
        from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.unmatched_at is null group by a.settlement_id),
      ex as (
        select coalesce(nullif(split_part(e.source_ref, ':', 2), ''), e.source_ref) as ref,
               bool_or(e.status in ('open', 'escalated', 'reopened')) as open_x, bool_or(e.status = 'in_review') as review_x, count(*)::int as n
        from reconciliation_exceptions e where e.tenant_id = ${T} and e.status <> 'resolved' and e.source_ref is not null group by 1),
      s0 as (
        select s.id, s.processor_type, s.settlement_id as ref, s.gross_cents, s.fee_cents, s.net_cents, coalesce(s.expected_net_cents, s.net_cents)::bigint as expected_cents,
               s.refunds_cents, s.chargebacks_cents, s.adjustments_cents, s.transaction_count, s.currency, s.status, s.settled_at, s.created_at, s.merchant_account_id,
               s.expected_deposit_date is not null as arrival_sourced,
               coalesce(s.expected_deposit_date, ((coalesce(s.settled_at, s.created_at) at time zone ${tz})::date + ${FUNDING_DAYS}::int)) as arrival,
               coalesce(al.allocated, 0)::bigint as allocated_cents, coalesce(al.deposits, 0)::int as deposit_count, al.refs as deposit_refs, al.deposit_ids,
               coalesce(ex.open_x, false) as open_x, coalesce(ex.review_x, false) as review_x, coalesce(ex.n, 0)::int as exceptions_n,
               (now() at time zone ${tz})::date as today
        from payment_settlements s left join al on al.settlement_id = s.id left join ex on ex.ref = s.id::text
        where s.tenant_id = ${T}),
      sb as (
        select s0.*, to_char(s0.arrival, 'YYYY-MM-DD') as arrival_ymd, least(s0.allocated_cents, greatest(s0.expected_cents, 0))::bigint as matched_cents,
               -- Deposit Recon guide audit (Nov 4 2026): a payout past its grace days with nothing matched is MISSING even when a case is
               -- open on it (the case used to outrank it and hide it from the Missing KPI and report)
               (s0.expected_cents > 0 and s0.allocated_cents = 0 and s0.status not in ('failed', 'returned', 'pending') and s0.today > s0.arrival + ${GRACE_DAYS}::int) as is_missing,
               case when s0.review_x then 'under_review'
                    when s0.open_x or s0.status in ('failed', 'returned') then 'exception'
                    when s0.expected_cents > 0 and s0.allocated_cents >= s0.expected_cents then 'matched'
                    when s0.expected_cents <= 0 then 'no_payout'
                    when s0.allocated_cents > 0 then 'partially_matched'
                    when s0.status = 'pending' then 'pending'
                    when s0.today > s0.arrival + ${GRACE_DAYS}::int then 'overdue'
                    else 'expected' end as recon_status
        from s0)`;
  }
  private search(ctx: FinanceCtx, raw: string): { where: RawBuilder<boolean>; rank: RawBuilder<number>; by: RawBuilder<string> } {
    if (!raw) return { where: sql<boolean>`true`, rank: sql<number>`0`, by: sql<string>`null` };
    const T = ctx.tenantId, lower = raw.toLowerCase(), digits = digitsOf(raw), cents = moneyToCents(raw), ref = normRef(raw), hasLetters = /[a-z]/i.test(raw);
    const idExact = isUuid(raw) ? sql<boolean>`sb.id = ${raw}::uuid` : sql<boolean>`false`;
    const refExact = sql<boolean>`lower(coalesce(sb.ref, '')) = ${lower}`;
    const refPrefix = sql<boolean>`lower(coalesce(sb.ref, '')) like ${prefixOf(lower)}`;
    const refLike = raw.length >= 3 ? sql<boolean>`lower(coalesce(sb.ref, '')) like ${likeOf(lower)}` : sql<boolean>`false`;
    const amount = cents != null ? sql<boolean>`(sb.gross_cents = ${cents} or sb.expected_cents = ${cents} or sb.fee_cents = ${cents})` : sql<boolean>`false`;
    const proc = hasLetters && raw.length >= 3 ? sql<boolean>`lower(coalesce(sb.processor_type, '')) like ${likeOf(lower)}` : sql<boolean>`false`;
    const deposit = ref.length >= 3 || isUuid(raw) ? sql<boolean>`exists (select 1 from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.settlement_id = sb.id and a.unmatched_at is null and (${isUuid(raw) ? sql`d.id = ${raw}::uuid or` : sql``} d.reference_normalized = ${ref} or d.reference_normalized like ${likeOf(ref)}))` : sql<boolean>`false`;
    const payment = sql<boolean>`exists (select 1 from payments p where p.tenant_id = ${T} and p.settlement_batch_id = sb.id and (
        ${isUuid(raw) ? sql`p.id = ${raw}::uuid or` : sql``} lower(coalesce(p.processor_transaction_id, '')) = ${lower} or lower(coalesce(p.processor_reference_id, '')) = ${lower}
        or exists (select 1 from tickets t where t.tenant_id = ${T} and t.id = p.ticket_id and lower(coalesce(t.ticket_number::text, '')) = ${lower})))`;
    const cust: RawBuilder<boolean>[] = [];
    if (hasLetters && raw.length >= 2 && !raw.includes('@')) cust.push(sql<boolean>`c.full_name ilike ${likeOf(raw)}`);
    if (raw.includes('@')) cust.push(sql<boolean>`lower(coalesce(c.email, '')) = ${lower}`);
    if (!hasLetters && digits.length >= 7) cust.push(sql<boolean>`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${likeOf(digits)}`);
    const customer = cust.length ? sql<boolean>`exists (select 1 from payments p join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id where p.tenant_id = ${T} and p.settlement_batch_id = sb.id and (${sql.join(cust, sql` or `)}))` : sql<boolean>`false`;
    const exception = isUuid(raw) ? sql<boolean>`exists (select 1 from reconciliation_exceptions e where e.tenant_id = ${T} and e.id = ${raw}::uuid and coalesce(nullif(split_part(e.source_ref, ':', 2), ''), e.source_ref) = sb.id::text)` : sql<boolean>`false`;
    return {
      where: sql<boolean>`(${idExact} or ${refExact} or ${refPrefix} or ${refLike} or ${amount} or ${proc} or ${deposit} or ${payment} or ${customer} or ${exception})`,
      rank: sql<number>`case when ${idExact} or ${refExact} or ${exception} then 0 when ${payment} or ${amount} then 1 when ${refPrefix} or ${deposit} then 2 when ${refLike} or ${proc} then 3 else 4 end`,
      by: sql<string>`case when ${idExact} or ${refExact} or ${refPrefix} or ${refLike} then 'settlement' when ${exception} then 'exception' when ${payment} then 'payment'
        when ${amount} then 'amount' when ${deposit} then 'bank_deposit' when ${proc} then 'processor' else 'customer' end`,
    };
  }
  private where(ctx: FinanceCtx, f: ReconFilters) {
    const T = ctx.tenantId, p = f.period;
    let date: RawBuilder<boolean>;
    switch (f.basis) {
      case 'expected_deposit': date = dateInPeriod(sql`sb.arrival`, p); break;
      case 'created': date = tsInPeriod(sql`sb.created_at`, p); break;
      case 'bank_posted': date = sql<boolean>`exists (select 1 from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
          where a.tenant_id = ${T} and a.settlement_id = sb.id and a.unmatched_at is null and ${dateInPeriod(sql`d.deposit_date`, p)})`; break;
      case 'payment': date = sql<boolean>`exists (select 1 from payments p where p.tenant_id = ${T} and p.settlement_batch_id = sb.id and ${tsInPeriod(sql`p.created_at`, p)})`; break;
      default: date = tsInPeriod(sql`coalesce(sb.settled_at, sb.created_at)`, p);
    }
    const s = this.search(ctx, f.q);
    const parts: RawBuilder<boolean>[] = [date, s.where];
    if (f.status) parts.push(sql<boolean>`sb.recon_status = ${f.status}`);
    if (f.processor) parts.push(sql<boolean>`lower(coalesce(sb.processor_type, '')) = ${f.processor.toLowerCase()}`);
    if (f.bankAccountId) parts.push(sql<boolean>`exists (select 1 from reconciliation_allocations a join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.settlement_id = sb.id and a.unmatched_at is null and d.bank_account_id = ${f.bankAccountId}::uuid)`);
    if (f.open) parts.push(sql<boolean>`sb.expected_cents > sb.allocated_cents`);
    return { where: sql<boolean>`${sql.join(parts, sql` and `)}`, rank: s.rank, by: s.by };
  }
  private order(f: ReconFilters) {
    return {
      created_desc: sql`sb.created_at desc, sb.id desc`, created_asc: sql`sb.created_at asc, sb.id asc`, settled_desc: sql`coalesce(sb.settled_at, sb.created_at) desc, sb.id desc`,
      arrival_asc: sql`sb.arrival asc, sb.id desc`, difference_desc: sql`(sb.expected_cents - sb.matched_cents) desc, sb.id desc`, expected_desc: sql`sb.expected_cents desc, sb.id desc`,
    }[f.sort];
  }
  private row(r: any) {
    const expected = N(r.expected_cents), matched = N(r.matched_cents);
    return {
      id: String(r.id), settlementRef: r.ref ?? null, processor: r.processor_type ?? null, settledAt: iso(r.settled_at), createdAt: iso(r.created_at),
      grossCents: N(r.gross_cents), feeCents: N(r.fee_cents), adjustmentsCents: N(r.adjustments_cents) - N(r.refunds_cents) - N(r.chargebacks_cents),
      expectedNetCents: expected, expectedArrival: ymd(r.arrival_ymd), arrivalSourced: !!r.arrival_sourced, transactionCount: N(r.transaction_count), currency: String(r.currency || 'USD'),
      linkedDeposits: N(r.deposit_count), depositRefs: Array.isArray(r.deposit_refs) ? r.deposit_refs.filter(Boolean).map(String) : [],
      matchedCents: matched, allocatedCents: N(r.allocated_cents), remainingCents: Math.max(0, expected - N(r.allocated_cents)), differenceCents: matched - expected,
      status: String(r.recon_status) as ReconStatus, providerStatus: String(r.status || 'settled'), openExceptions: N(r.exceptions_n), matchedBy: r.matched_by ?? null,
    };
  }
  async listSettlements(ctx: FinanceCtx, f: ReconFilters, pr: PageReq) {
    const tz = f.period.tz; const w = this.where(ctx, f);
    const total = N((await sql<any>`${this.base(ctx, tz)} select count(*)::int as n from sb where ${w.where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`${this.base(ctx, tz)} select sb.*, ${w.by} as matched_by from sb where ${w.where} order by ${f.q ? sql`${w.rank} asc, ${this.order(f)}` : this.order(f)} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** The five KPIs over the same scope as the table (spec §08), with the Net Difference calculation spelled out. */
  async kpis(ctx: FinanceCtx, f: ReconFilters) {
    const T = ctx.tenantId, tz = f.period.tz; const w = this.where(ctx, { ...f, status: undefined, open: false });
    const k = (await sql<any>`${this.base(ctx, tz)} select count(*)::int as n,
        coalesce(sum(sb.expected_cents) filter (where sb.expected_cents > 0 and sb.status not in ('failed', 'returned')), 0)::bigint as expected,
        coalesce(sum(sb.matched_cents), 0)::bigint as matched,
        count(*) filter (where sb.is_missing)::int as missing, coalesce(sum(sb.expected_cents) filter (where sb.is_missing), 0)::bigint as missing_cents,
        coalesce(sum(sb.expected_cents) filter (where sb.expected_cents > 0 and sb.status not in ('failed', 'returned') and sb.today > sb.arrival + ${GRACE_DAYS}::int), 0)::bigint as due_expected,
        coalesce(sum(sb.matched_cents) filter (where sb.expected_cents > 0 and sb.today > sb.arrival + ${GRACE_DAYS}::int), 0)::bigint as due_matched,
        count(*) filter (where sb.expected_cents > 0 and sb.today <= sb.arrival + ${GRACE_DAYS}::int)::int as not_due_n,
        coalesce(sum(sb.expected_cents) filter (where sb.expected_cents > 0 and sb.today <= sb.arrival + ${GRACE_DAYS}::int), 0)::bigint as not_due_cents,
        count(*) filter (where sb.recon_status = 'matched')::int as matched_n, count(*) filter (where sb.recon_status = 'partially_matched')::int as partial_n,
        count(*) filter (where sb.recon_status in ('exception', 'under_review'))::int as exception_n,
        count(*) filter (where sb.recon_status in ('expected', 'pending'))::int as expected_n
      from sb where ${w.where}`.execute(this.db)).rows[0] || {};
    const u = (await sql<any>`with dal as (select a.deposit_id, sum(a.amount_cents)::bigint as allocated from reconciliation_allocations a where a.tenant_id = ${T} and a.unmatched_at is null group by a.deposit_id)
      select count(*)::int as n, coalesce(sum(d.amount_cents - coalesce(dal.allocated, 0)), 0)::bigint as cents
      from bank_deposits d left join dal on dal.deposit_id = d.id
      where d.tenant_id = ${T} and d.status <> 'returned' and d.amount_cents - coalesce(dal.allocated, 0) > 0 and ${dateInPeriod(sql`d.deposit_date`, f.period)}`.execute(this.db)).rows[0] || {};
    const dueExpected = N(k.due_expected), dueMatched = N(k.due_matched);
    return {
      expectedDepositsCents: N(k.expected), matchedCents: N(k.matched), settlements: N(k.n), missingDeposits: N(k.missing), missingCents: N(k.missing_cents),
      netDifferenceCents: dueMatched - dueExpected,
      netDifference: { dueMatchedCents: dueMatched, dueExpectedCents: dueExpected, notYetDueCount: N(k.not_due_n), notYetDueCents: N(k.not_due_cents),
        excludes: `Payouts not yet ${GRACE_DAYS} days past their expected arrival (counted in Not yet due), and bank deposits not allocated to a settlement.` },
      byStatus: { matched: N(k.matched_n), partiallyMatched: N(k.partial_n), exception: N(k.exception_n), expected: N(k.expected_n), overdue: N(k.missing) },
      unmatchedDeposits: N(u.n), unmatchedDepositCents: N(u.cents), graceDays: GRACE_DAYS, fundingDays: FUNDING_DAYS,
    };
  }

  /** One settlement for the review / match dialog: its allocations (active and unmatched), payments and notes. */
  async settlementDetail(ctx: FinanceCtx, id: string, tz: string) {
    if (!isUuid(id)) return null;
    const T = ctx.tenantId;
    const r = (await sql<any>`${this.base(ctx, tz)} select sb.* from sb where sb.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) return null;
    const allocations = await this.allocationsOf(ctx, sql`a.settlement_id = ${id}::uuid`);
    const notes = await this.notesOf(ctx, 'settlement', id);
    const payments = (await sql<any>`select p.id, p.processor_transaction_id, p.amount_cents, p.status, p.created_at, t.ticket_number, c.id as customer_id, c.full_name, c.normalized_phone
      from payments p left join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
      where p.tenant_id = ${T} and p.settlement_batch_id = ${id}::uuid order by p.created_at desc, p.id desc limit 10`.execute(this.db)).rows;
    const exceptions = (await sql<any>`select id, kind, severity, title, status, amount_cents, created_at from reconciliation_exceptions
      where tenant_id = ${T} and coalesce(nullif(split_part(source_ref, ':', 2), ''), source_ref) = ${id} order by created_at desc limit 10`.execute(this.db)).rows;
    return {
      settlement: this.row(r), allocations, notes,
      payments: payments.map((p: any) => ({ id: String(p.id), processorTransactionId: p.processor_transaction_id ?? null, amountCents: N(p.amount_cents), status: String(p.status), createdAt: iso(p.created_at),
        ticketNumber: p.ticket_number != null ? String(p.ticket_number) : null, customer: p.customer_id ? { id: String(p.customer_id), name: String(p.full_name || ''), phone: phoneLast4(p.normalized_phone) } : null })),
      exceptions: exceptions.map((e: any) => ({ id: String(e.id), kind: String(e.kind), class: classOfKind(String(e.kind)), severity: String(e.severity), title: String(e.title), status: String(e.status), amountCents: N(e.amount_cents), createdAt: iso(e.created_at) })),
    };
  }
  private async allocationsOf(ctx: FinanceCtx, cond: RawBuilder<unknown>) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select a.id, a.settlement_id, a.deposit_id, a.amount_cents, a.source, a.evidence_json, a.note, a.created_at, a.unmatched_at, a.unmatch_reason,
        s.settlement_id as settlement_ref, s.processor_type, d.reference, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_date, d.amount_cents as deposit_amount_cents, b.nickname, b.account_last4,
        coalesce(u.full_name, u.email) as created_by, coalesce(u2.full_name, u2.email) as unmatched_by
      from reconciliation_allocations a
      join payment_settlements s on s.id = a.settlement_id and s.tenant_id = a.tenant_id
      join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
      left join bank_accounts b on b.id = d.bank_account_id and b.tenant_id = d.tenant_id
      left join users u on u.id = a.created_by_user_id and u.tenant_id = a.tenant_id left join users u2 on u2.id = a.unmatched_by_user_id and u2.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and ${cond} order by a.created_at desc, a.id desc limit 50`.execute(this.db)).rows;
    return rows.map((a: any) => ({
      id: String(a.id), settlementId: String(a.settlement_id), settlementRef: a.settlement_ref ?? null, processor: a.processor_type ?? null, depositId: String(a.deposit_id),
      depositReference: a.reference ?? null, depositDate: ymd(a.deposit_date), depositAmountCents: N(a.deposit_amount_cents), account: masked(a.nickname, a.account_last4),
      amountCents: N(a.amount_cents), source: String(a.source), evidence: a.evidence_json ?? {}, note: a.note ?? null, createdAt: iso(a.created_at), createdBy: a.created_by ?? null,
      active: a.unmatched_at == null, unmatchedAt: iso(a.unmatched_at), unmatchedBy: a.unmatched_by ?? null, unmatchReason: a.unmatch_reason ?? null,
    }));
  }
  private async notesOf(ctx: FinanceCtx, type: 'settlement' | 'deposit' | 'exception', id: string) {
    const rows = (await sql<any>`select n.id, n.body, n.created_at, n.author_role, coalesce(u.full_name, u.email) as author from reconciliation_notes n left join users u on u.id = n.author_user_id and u.tenant_id = n.tenant_id
      where n.tenant_id = ${ctx.tenantId} and n.target_type = ${type} and n.target_id = ${id}::uuid order by n.created_at desc, n.id desc limit 30`.execute(this.db)).rows;
    return rows.map((n: any) => ({ id: String(n.id), body: String(n.body), createdAt: iso(n.created_at), author: n.author ?? null, authorRole: n.author_role ?? null }));
  }

  // ── bank deposits ─────────────────────────────────────────────────────────────────────────────────────────────
  /** `tz` = the salon's time zone: a deposit without a bank-posted date falls on the salon's day it was entered (never the UTC day). */
  private depositBase(ctx: FinanceCtx, tz: string) {
    const T = ctx.tenantId;
    return sql`with dal as (select a.deposit_id, coalesce(sum(a.amount_cents), 0)::bigint as allocated, count(*)::int as n from reconciliation_allocations a
          where a.tenant_id = ${T} and a.unmatched_at is null group by a.deposit_id),
      sal as (select a.settlement_id, coalesce(sum(a.amount_cents), 0)::bigint as allocated from reconciliation_allocations a where a.tenant_id = ${T} and a.unmatched_at is null group by a.settlement_id),
      db0 as (
        select d.id, d.bank_account_id, d.amount_cents, d.currency, d.deposit_date, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_ymd, coalesce(d.deposit_date, (d.created_at at time zone ${tz})::date) as posted_day, d.posted_at, d.description, d.reference, d.reference_normalized, d.external_bank_txn_id,
               d.source, d.status, d.notes, d.created_at, b.nickname, b.bank_name, b.account_last4, coalesce(u.full_name, u.email) as created_by,
               coalesce(dal.allocated, 0)::bigint as allocated_cents, d.amount_cents - coalesce(dal.allocated, 0) as remaining_cents,
               (select count(*)::int from reconciliation_notes n where n.tenant_id = ${T} and n.target_type = 'deposit' and n.target_id = d.id) as notes_n,
               (select count(*)::int from payment_settlements s left join sal on sal.settlement_id = s.id
                 where s.tenant_id = ${T} and coalesce(s.expected_net_cents, s.net_cents) - coalesce(sal.allocated, 0) > 0
                   and (coalesce(s.settled_at, s.created_at) at time zone ${tz})::date between coalesce(d.deposit_date, (d.created_at at time zone ${tz})::date) - 10 and coalesce(d.deposit_date, (d.created_at at time zone ${tz})::date) + 1
                   and (coalesce(s.expected_net_cents, s.net_cents) - coalesce(sal.allocated, 0) <= d.amount_cents - coalesce(dal.allocated, 0)
                        or (d.reference_normalized is not null and length(regexp_replace(upper(coalesce(s.settlement_id, '')), '[^A-Z0-9]', '', 'g')) >= 4
                            and strpos(d.reference_normalized, regexp_replace(upper(s.settlement_id), '[^A-Z0-9]', '', 'g')) > 0))) as candidates_n
        from bank_deposits d left join dal on dal.deposit_id = d.id
        left join bank_accounts b on b.id = d.bank_account_id and b.tenant_id = d.tenant_id
        left join users u on u.id = d.created_by_user_id and u.tenant_id = d.tenant_id
        where d.tenant_id = ${T})`;
  }
  private depositRow(r: any) {
    const allocated = N(r.allocated_cents), remaining = N(r.remaining_cents);
    const matchState = remaining <= 0 ? 'reconciled' : allocated > 0 ? 'partial_allocation' : N(r.candidates_n) > 0 ? 'possible_candidate' : N(r.notes_n) > 0 ? 'reviewed_unresolved' : 'no_candidates';
    return {
      id: String(r.id), bankAccountId: String(r.bank_account_id), account: masked(r.nickname, r.account_last4), bankName: r.bank_name ?? null,
      amountCents: N(r.amount_cents), currency: String(r.currency || 'USD'), depositDate: ymd(r.deposit_ymd), postedAt: iso(r.posted_at), reference: r.reference ?? null,
      description: r.description ?? null, source: String(r.source || 'manual'), status: String(r.status || 'posted'), notes: r.notes ?? null,
      createdAt: iso(r.created_at), createdBy: r.created_by ?? null, allocatedCents: allocated, remainingCents: Math.max(0, remaining),
      matchState: matchState as 'reconciled' | 'partial_allocation' | 'possible_candidate' | 'reviewed_unresolved' | 'no_candidates', candidates: N(r.candidates_n), reviewNotes: N(r.notes_n),
    };
  }
  private depositSearch(raw: string): RawBuilder<boolean> {
    if (!raw) return sql<boolean>`true`;
    const lower = raw.toLowerCase(), cents = moneyToCents(raw), ref = normRef(raw);
    const conds: RawBuilder<boolean>[] = [sql<boolean>`lower(coalesce(db0.nickname, '')) like ${likeOf(lower)}`, sql<boolean>`lower(coalesce(db0.description, '')) like ${likeOf(lower)}`];
    if (ref.length >= 2) conds.push(sql<boolean>`coalesce(db0.reference_normalized, '') like ${likeOf(ref)}`, sql<boolean>`lower(coalesce(db0.external_bank_txn_id, '')) = ${lower}`);
    if (isUuid(raw)) conds.push(sql<boolean>`db0.id = ${raw}::uuid`);
    if (cents != null) conds.push(sql<boolean>`db0.amount_cents = ${cents}`, sql<boolean>`db0.remaining_cents = ${cents}`);
    if (/^\d{4}$/.test(raw)) conds.push(sql<boolean>`db0.account_last4 = ${raw}`);
    return sql<boolean>`(${sql.join(conds, sql` or `)})`;
  }
  async listDeposits(ctx: FinanceCtx, f: ReconFilters, pr: PageReq, opts: { unmatchedOnly: boolean }) {
    const parts: RawBuilder<boolean>[] = [dateInPeriod(sql`db0.posted_day`, f.period), this.depositSearch(f.q)];
    if (opts.unmatchedOnly) parts.push(sql<boolean>`db0.remaining_cents > 0 and db0.status <> 'returned'`);
    if (f.bankAccountId) parts.push(sql<boolean>`db0.bank_account_id = ${f.bankAccountId}::uuid`);
    const where = sql<boolean>`${sql.join(parts, sql` and `)}`;
    const total = N((await sql<any>`${this.depositBase(ctx, f.period.tz)} select count(*)::int as n from db0 where ${where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`${this.depositBase(ctx, f.period.tz)} select db0.* from db0 where ${where} order by db0.created_at desc, db0.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.depositRow(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount, dateBasis: 'bank_posted' as const };
  }
  async depositDetail(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) return null;
    const tz = await salonTimeZone(this.db, ctx.tenantId);
    const r = (await sql<any>`${this.depositBase(ctx, tz)} select db0.* from db0 where db0.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) return null;
    return { deposit: this.depositRow(r), allocations: await this.allocationsOf(ctx, sql`a.deposit_id = ${id}::uuid`), notes: await this.notesOf(ctx, 'deposit', id) };
  }

  /** Suggested settlements for a deposit — RULE-BASED evidence with a confidence label, never applied by itself
   *  (spec §13: a suggestion is not a ledger fact; a person reviews and matches). */
  async suggestions(ctx: FinanceCtx, depositId: string, tz: string) {
    const d = await this.depositDetail(ctx, depositId);
    if (!d) return null;
    const dep = d.deposit; const T = ctx.tenantId;
    const anchor = dep.depositDate ?? (dep.createdAt ? dep.createdAt.slice(0, 10) : null);
    if (dep.remainingCents <= 0 || !anchor) return { deposit: dep, suggestions: [], note: 'This deposit is fully allocated.' };
    const ref = dep.reference ? normRef(dep.reference) : '';
    const rows = (await sql<any>`${this.base(ctx, tz)} select sb.* from sb
      where sb.expected_cents - sb.allocated_cents > 0 and sb.recon_status not in ('no_payout')
        and (coalesce(sb.settled_at, sb.created_at) at time zone ${tz})::date between ${anchor}::date - 14 and ${anchor}::date + 1
      order by coalesce(sb.settled_at, sb.created_at) desc, sb.id desc limit 200`.execute(this.db)).rows.map((r: any) => this.row(r));
    void T;
    const out = rows.map((s) => {
      const settledDay = (s.settledAt ?? s.createdAt ?? '').slice(0, 10);
      const dayDelta = settledDay ? daysBetween(settledDay, anchor) : null;
      const arrivalDelta = s.expectedArrival ? daysBetween(s.expectedArrival, anchor) : null;
      const sref = s.settlementRef ? normRef(s.settlementRef) : '';
      const idMatch = ref.length >= 4 && sref.length >= 4 && ref.includes(sref);
      const amountDelta = dep.remainingCents - s.remainingCents;
      const exact = amountDelta === 0;
      const near = Math.abs(amountDelta) <= Math.max(100, Math.round(s.remainingCents * 0.02));
      const basis = idMatch ? 'exact_reference' : exact && dayDelta != null && dayDelta >= 0 && dayDelta <= 5 ? 'amount_and_date' : near && dayDelta != null && Math.abs(dayDelta) <= 5 ? 'similar_amount' : null;
      if (!basis) return null;
      const confidence = basis === 'exact_reference' ? 'high' : basis === 'amount_and_date' ? 'medium' : 'low';
      return {
        settlement: s, basis, confidence,
        evidence: { referenceMatch: idMatch, amountDeltaCents: amountDelta, settlementRemainingCents: s.remainingCents, depositRemainingCents: dep.remainingCents, dayDelta, arrivalDelta, processor: s.processor, account: dep.account },
        suggestedAmountCents: Math.min(dep.remainingCents, s.remainingCents),
      };
    }).filter(Boolean) as Array<{ settlement: ReturnType<ReconWorkspaceRepository['row']>; basis: string; confidence: 'high' | 'medium' | 'low'; evidence: Record<string, unknown>; suggestedAmountCents: number }>;
    const rank = { high: 0, medium: 1, low: 2 } as const;
    out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || Math.abs(Number(a.evidence.amountDeltaCents)) - Math.abs(Number(b.evidence.amountDeltaCents)));
    return { deposit: dep, suggestions: out.slice(0, 5), note: 'Suggestions are rule-based (reference, amount and date evidence). They are not ledger facts: a person reviews and matches.' };
  }

  // ── matching (allocations) ────────────────────────────────────────────────────────────────────────────────────
  async allocate(ctx: FinanceCtx, b: { settlementId: string; depositId: string; amountCents: unknown; reviewed: boolean; note?: string | null; idempotencyKey: string; basis?: string | null; canApprove: boolean }) {
    if (!isUuid(b.idempotencyKey)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (!isUuid(b.settlementId)) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404);
    if (!isUuid(b.depositId)) throw new FinanceError('That bank deposit could not be found.', 'BANK_DEPOSIT_NOT_FOUND', 404);
    const amount = positiveCents(b.amountCents);
    if (amount == null) throw new FinanceError('Enter an amount greater than $0.00.', 'ALLOCATION_AMOUNT_INVALID');
    if (!b.reviewed) throw new FinanceError('Confirm that you reviewed the evidence before matching.', 'ALLOCATION_REVIEW_REQUIRED');
    const note = b.note ? String(b.note).trim().slice(0, 1000) : null;
    const claimed = ['exact_reference', 'amount_and_date', 'similar_amount'].includes(String(b.basis)) ? String(b.basis) : 'manual';
    const T = ctx.tenantId;
    const result = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id from reconciliation_allocations where tenant_id = ${T} and idempotency_key = ${b.idempotencyKey}`.execute(trx)).rows[0];
      if (prior) return { id: String(prior.id), duplicate: true };
      const s = (await sql<any>`select id, settlement_id, currency, coalesce(expected_net_cents, net_cents)::bigint as expected from payment_settlements where tenant_id = ${T} and id = ${b.settlementId}::uuid for update`.execute(trx)).rows[0];
      if (!s) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404);
      const d = (await sql<any>`select id, reference, currency, amount_cents, status from bank_deposits where tenant_id = ${T} and id = ${b.depositId}::uuid for update`.execute(trx)).rows[0];
      if (!d) throw new FinanceError('That bank deposit could not be found.', 'BANK_DEPOSIT_NOT_FOUND', 404);
      if (String(d.status) === 'returned') throw new FinanceError('A returned deposit cannot be matched.', 'ALLOCATION_DEPOSIT_RETURNED', 409);
      if (String(s.currency || 'USD') !== String(d.currency || 'USD')) throw new FinanceError('The settlement and the deposit are in different currencies.', 'ALLOCATION_CURRENCY_MISMATCH', 409);
      const sa = N((await sql<any>`select coalesce(sum(amount_cents), 0)::bigint as a from reconciliation_allocations where tenant_id = ${T} and settlement_id = ${b.settlementId}::uuid and unmatched_at is null`.execute(trx)).rows[0]?.a);
      const da = N((await sql<any>`select coalesce(sum(amount_cents), 0)::bigint as a from reconciliation_allocations where tenant_id = ${T} and deposit_id = ${b.depositId}::uuid and unmatched_at is null`.execute(trx)).rows[0]?.a);
      const sRemain = N(s.expected) - sa, dRemain = N(d.amount_cents) - da;
      if (amount > sRemain || amount > dRemain) {
        throw new FinanceError('That is more than is still unmatched.', 'ALLOCATION_EXCEEDS_REMAINING', 409, { settlementRemainingCents: Math.max(0, sRemain), depositRemainingCents: Math.max(0, dRemain) });
      }
      // an allocation that neither completes the payout nor uses up the deposit is the uncertain kind → an approver (owner)
      if (amount < sRemain && amount < dRemain && !b.canApprove) {
        throw new FinanceError('A partial match on both sides needs an owner to approve it.', 'ALLOCATION_NEEDS_APPROVER', 403);
      }
      // Deposit Recon guide audit (Nov 4 2026): the evidence basis is decided HERE from the two records, never taken from the request —
      // a claimed "exact reference" that the references do not show is recorded as a manual match (the claim is kept for review)
      const refsMatch = !!s.settlement_id && !!d.reference && normRef(String(s.settlement_id)).length >= 3 && normRef(String(d.reference)).includes(normRef(String(s.settlement_id)));   // the bank line carries the batch id
      const sameAmount = N(d.amount_cents) === N(s.expected);
      const near = Math.abs(N(d.amount_cents) - N(s.expected)) <= Math.max(100, Math.round(N(s.expected) * 0.02));
      const basis = claimed === 'exact_reference' ? (refsMatch ? 'exact_reference' : 'manual')
        : claimed === 'amount_and_date' ? (sameAmount ? 'amount_and_date' : 'manual')
        : claimed === 'similar_amount' ? (near ? 'similar_amount' : 'manual') : 'manual';
      const evidence = { basis, claimedBasis: claimed, settlementRef: s.settlement_id ?? null, depositReference: d.reference ?? null, settlementRemainingBeforeCents: sRemain, depositRemainingBeforeCents: dRemain,
        reviewedBy: isUuid(ctx.userId) ? ctx.userId : null, reviewedRole: ctx.role ?? null };
      const ins = (await sql<any>`insert into reconciliation_allocations (tenant_id, settlement_id, deposit_id, amount_cents, currency, source, evidence_json, note, idempotency_key, created_by_user_id)
        values (${T}, ${b.settlementId}::uuid, ${b.depositId}::uuid, ${amount}, ${String(d.currency || 'USD')}, ${basis === 'manual' ? 'manual' : 'suggestion_accepted'}, ${JSON.stringify(evidence)}::jsonb, ${note}, ${b.idempotencyKey}, ${isUuid(ctx.userId) ? ctx.userId : null})
        returning id`.execute(trx)).rows[0];
      return { id: String(ins.id), duplicate: false, amount, basis, settlementRemainingCents: sRemain - amount, depositRemainingCents: dRemain - amount };
    });
    if (!result.duplicate) await audit(this.auditor, ctx, 'reconciliation', 'allocation_created', 'reconciliation_allocation', result.id, { settlementId: b.settlementId, depositId: b.depositId, amountCents: amount, basis: 'basis' in result ? result.basis : claimed }, this.log('audit', ctx));
    return result;
  }

  async unmatch(ctx: FinanceCtx, id: string, reason: string) {
    if (!isUuid(id)) throw new FinanceError('That match could not be found.', 'ALLOCATION_NOT_FOUND', 404);
    const why = String(reason ?? '').trim();
    if (why.length < 3) throw new FinanceError('Give a reason for unmatching.', 'ALLOCATION_REASON_REQUIRED');
    const T = ctx.tenantId;
    const r = (await sql<any>`update reconciliation_allocations set unmatched_at = now(), unmatched_by_user_id = ${isUuid(ctx.userId) ? ctx.userId : null}, unmatch_reason = ${why.slice(0, 1000)}
      where tenant_id = ${T} and id = ${id}::uuid and unmatched_at is null returning id, settlement_id, deposit_id, amount_cents`.execute(this.db)).rows[0];
    if (!r) {
      const exists = (await sql<any>`select unmatched_at from reconciliation_allocations where tenant_id = ${T} and id = ${id}::uuid`.execute(this.db)).rows[0];
      if (!exists) throw new FinanceError('That match could not be found.', 'ALLOCATION_NOT_FOUND', 404);
      throw new FinanceError('This match was already undone.', 'ALLOCATION_ALREADY_UNMATCHED', 409);
    }
    await audit(this.auditor, ctx, 'reconciliation', 'allocation_unmatched', 'reconciliation_allocation', id, { settlementId: String(r.settlement_id), depositId: String(r.deposit_id), amountCents: N(r.amount_cents), reason: why.slice(0, 200) }, this.log('audit', ctx));
    return { id, unmatched: true };
  }

  // ── bank accounts (masked; owner-only administration; a label is NOT a payout instruction) ──────────────────────
  async bankAccounts(ctx: FinanceCtx) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select b.id, b.nickname, b.bank_name, b.account_type, b.account_last4, b.currency, b.status, b.is_default, b.created_at, b.deactivated_at,
        (select count(*)::int from bank_deposits d where d.tenant_id = ${T} and d.bank_account_id = b.id) as deposits,
        (select to_char(max(d.deposit_date), 'YYYY-MM-DD') from bank_deposits d where d.tenant_id = ${T} and d.bank_account_id = b.id) as last_deposit
      from bank_accounts b where b.tenant_id = ${T} order by (b.status = 'active') desc, b.is_default desc, b.created_at desc, b.id desc`.execute(this.db)).rows;
    return rows.map((b: any) => ({
      id: String(b.id), nickname: String(b.nickname), bankName: b.bank_name ?? null, accountType: String(b.account_type || 'checking'), last4: b.account_last4 ? String(b.account_last4).slice(-4) : null,
      masked: masked(b.nickname, b.account_last4), currency: String(b.currency || 'USD'), status: String(b.status), isDefault: !!b.is_default, createdAt: iso(b.created_at), deactivatedAt: iso(b.deactivated_at),
      deposits: N(b.deposits), lastDepositDate: ymd(b.last_deposit),
    }));
  }
  async createBankAccount(ctx: FinanceCtx, b: { nickname?: unknown; bankName?: unknown; accountType?: unknown; accountLast4?: unknown; currency?: unknown }) {
    const nickname = String(b.nickname ?? '').trim();
    if (nickname.length < 2 || nickname.length > 60) throw new FinanceError('Give the account a nickname (2–60 characters).', 'BANK_ACCOUNT_INVALID', 400, { field: 'nickname' });
    const last4 = b.accountLast4 == null || b.accountLast4 === '' ? null : String(b.accountLast4).trim();
    if (last4 != null && !/^\d{4}$/.test(last4)) throw new FinanceError('Enter only the last 4 digits of the account.', 'BANK_ACCOUNT_INVALID', 400, { field: 'accountLast4' });
    const type = ['checking', 'savings', 'other'].includes(String(b.accountType)) ? String(b.accountType) : 'checking';
    const T = ctx.tenantId;
    const row = await this.db.transaction().execute(async (trx) => {
      const dup = (await sql<any>`select id from bank_accounts where tenant_id = ${T} and status = 'active' and lower(nickname) = ${nickname.toLowerCase()} and coalesce(account_last4, '') = ${last4 ?? ''}`.execute(trx)).rows[0];
      if (dup) throw new FinanceError('This bank account is already on file.', 'BANK_ACCOUNT_DUPLICATE', 409, { id: String(dup.id) });
      const any = (await sql<any>`select count(*)::int as n from bank_accounts where tenant_id = ${T} and is_default`.execute(trx)).rows[0];
      return (await sql<any>`insert into bank_accounts (tenant_id, nickname, bank_name, account_type, account_last4, currency, is_default, created_by_user_id)
        values (${T}, ${nickname}, ${b.bankName ? String(b.bankName).trim().slice(0, 80) : null}, ${type}, ${last4}, 'USD', ${N(any?.n) === 0}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0];
    });
    await audit(this.auditor, ctx, 'reconciliation', 'bank_account_added', 'bank_account', String(row.id), { nickname, last4: last4 ? `••••${last4}` : null }, this.log('audit', ctx));
    return (await this.bankAccounts(ctx)).find((x) => x.id === String(row.id))!;
  }
  async updateBankAccount(ctx: FinanceCtx, id: string, b: { nickname?: unknown; makeDefault?: unknown; deactivate?: unknown }) {
    if (!isUuid(id)) throw new FinanceError('That bank account could not be found.', 'BANK_ACCOUNT_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const changes: Record<string, unknown> = {};
    await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select id, nickname, status, is_default from bank_accounts where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!cur) throw new FinanceError('That bank account could not be found.', 'BANK_ACCOUNT_NOT_FOUND', 404);
      if (b.nickname !== undefined) {
        const nickname = String(b.nickname ?? '').trim();
        if (nickname.length < 2 || nickname.length > 60) throw new FinanceError('Give the account a nickname (2–60 characters).', 'BANK_ACCOUNT_INVALID', 400, { field: 'nickname' });
        await sql`update bank_accounts set nickname = ${nickname}, updated_at = now() where tenant_id = ${T} and id = ${id}::uuid`.execute(trx);
        changes.nickname = { from: cur.nickname, to: nickname };
      }
      if (b.makeDefault === true) {
        if (String(cur.status) !== 'active') throw new FinanceError('Only an active account can be the default.', 'BANK_ACCOUNT_INACTIVE', 409);
        await sql`update bank_accounts set is_default = false, updated_at = now() where tenant_id = ${T} and is_default and id <> ${id}::uuid`.execute(trx);
        await sql`update bank_accounts set is_default = true, updated_at = now() where tenant_id = ${T} and id = ${id}::uuid`.execute(trx);
        changes.isDefault = true;
      }
      if (b.deactivate === true) {
        // the account stays on file (historical deposits reference it); it just stops being offered for new deposits
        assertTransition(BANK_ACCOUNT, String(cur.status), 'inactive');
        await sql`update bank_accounts set status = 'inactive', is_default = false, deactivated_at = now(), deactivated_by_user_id = ${isUuid(ctx.userId) ? ctx.userId : null}, updated_at = now()
          where tenant_id = ${T} and id = ${id}::uuid and status = ${String(cur.status)}`.execute(trx);
        changes.status = { from: cur.status, to: 'inactive' };
      }
    });
    if (Object.keys(changes).length) await audit(this.auditor, ctx, 'reconciliation', 'bank_account_updated', 'bank_account', id, changes, this.log('audit', ctx));
    return (await this.bankAccounts(ctx)).find((x) => x.id === id)!;
  }

  /** Record a Deposit: a RECORD only (no transfer, no charge, no settlement marked paid). Idempotent on the request key;
   *  a normalised reference already on the same account is refused unless the person confirms it is a different credit. */
  async createDeposit(ctx: FinanceCtx, b: { bankAccountId?: unknown; amountCents?: unknown; depositDate?: unknown; reference?: unknown; notes?: unknown; idempotencyKey?: unknown; allowDuplicateReference?: unknown }, today: string) {
    const key = String(b.idempotencyKey ?? '');
    if (!isUuid(key)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    const accountId = String(b.bankAccountId ?? '');
    if (!isUuid(accountId)) throw new FinanceError('Choose a bank account.', 'BANK_ACCOUNT_NOT_FOUND', 404);
    const amount = positiveCents(b.amountCents, DEPOSIT_MAX_CENTS);
    if (amount == null) throw new FinanceError('Enter an amount between $0.01 and $1,000,000.00.', 'DEPOSIT_AMOUNT_INVALID');
    const date = String(b.depositDate ?? '');
    if (!isValidYmd(date)) throw new FinanceError('Enter a valid date.', 'DATE_INVALID', 400, { field: 'depositDate' });
    if (date > today) throw new FinanceError('A bank posting date cannot be in the future.', 'DEPOSIT_DATE_IN_FUTURE');
    const reference = b.reference ? String(b.reference).trim().slice(0, 120) : null;
    const refNorm = reference ? normRef(reference) || null : null;
    const notes = b.notes ? String(b.notes).trim().slice(0, 1000) : null;
    const T = ctx.tenantId;
    const out = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id from bank_deposits where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) return { id: String(prior.id), duplicate: true };
      const acct = (await sql<any>`select id, status from bank_accounts where tenant_id = ${T} and id = ${accountId}::uuid`.execute(trx)).rows[0];
      if (!acct) throw new FinanceError('That bank account could not be found.', 'BANK_ACCOUNT_NOT_FOUND', 404);
      if (String(acct.status) !== 'active') throw new FinanceError('That bank account is deactivated.', 'BANK_ACCOUNT_INACTIVE', 409);
      if (refNorm && b.allowDuplicateReference !== true) {
        const dup = (await sql<any>`select id, amount_cents, to_char(deposit_date, 'YYYY-MM-DD') as deposit_date from bank_deposits where tenant_id = ${T} and bank_account_id = ${accountId}::uuid and reference_normalized = ${refNorm} limit 1`.execute(trx)).rows[0];
        if (dup) throw new FinanceError('A deposit with this bank reference is already recorded on this account.', 'DEPOSIT_DUPLICATE_REFERENCE', 409, { depositId: String(dup.id), amountCents: N(dup.amount_cents), depositDate: ymd(dup.deposit_date) });
      }
      const ins = (await sql<any>`insert into bank_deposits (tenant_id, bank_account_id, amount_cents, currency, deposit_date, reference, reference_normalized, source, status, notes, idempotency_key, created_by_user_id)
        values (${T}, ${accountId}::uuid, ${amount}, 'USD', ${date}::date, ${reference}, ${refNorm}, 'manual', 'posted', ${notes}, ${key}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0];
      return { id: String(ins.id), duplicate: false };
    });
    if (!out.duplicate) await audit(this.auditor, ctx, 'reconciliation', 'deposit_recorded', 'bank_deposit', out.id, { bankAccountId: accountId, amountCents: amount, depositDate: date, source: 'manual' }, this.log('audit', ctx));
    const detail = await this.depositDetail(ctx, out.id);
    return { ...out, deposit: detail!.deposit };
  }

  async addNote(ctx: FinanceCtx, type: 'settlement' | 'deposit' | 'exception', id: string, body: unknown) {
    const text = String(body ?? '').trim();
    if (text.length < 1 || text.length > 2000) throw new FinanceError('Write a note (up to 2,000 characters).', 'RECON_NOTE_INVALID');
    if (!isUuid(id)) throw new FinanceError('That record could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const table = type === 'settlement' ? sql`payment_settlements` : type === 'deposit' ? sql`bank_deposits` : sql`reconciliation_exceptions`;
    const ok = (await sql<any>`select 1 from ${table} where tenant_id = ${T} and id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!ok) throw new FinanceError('That record could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const r = (await sql<any>`insert into reconciliation_notes (tenant_id, target_type, target_id, body, author_user_id, author_role)
      values (${T}, ${type}, ${id}::uuid, ${text}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${ctx.role ?? null}) returning id, created_at`.execute(this.db)).rows[0];
    await audit(this.auditor, ctx, 'reconciliation', 'note_added', type === 'exception' ? 'reconciliation_exception' : type === 'deposit' ? 'bank_deposit' : 'settlement', id, { noteId: String(r.id), length: text.length }, this.log('audit', ctx));
    return { id: String(r.id), createdAt: iso(r.created_at) };
  }

  // ── fees ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async fees(ctx: FinanceCtx, f: ReconFilters, pr: PageReq, category?: string) {
    const T = ctx.tenantId, p = f.period;
    const parts: RawBuilder<boolean>[] = [tsInPeriod(sql`coalesce(s.settled_at, s.created_at)`, p)];
    if (f.processor) parts.push(sql<boolean>`lower(coalesce(s.processor_type, '')) = ${f.processor.toLowerCase()}`);
    if (f.q) { const lower = f.q.toLowerCase(); const cents = moneyToCents(f.q);
      parts.push(sql<boolean>`(lower(coalesce(s.settlement_id, '')) like ${likeOf(lower)} or lower(coalesce(s.processor_type, '')) like ${likeOf(lower)} ${cents != null ? sql`or s.fee_cents = ${cents} or s.gross_cents = ${cents}` : sql``})`); }
    if (category === 'deducted') parts.push(sql<boolean>`s.fee_cents > 0`);
    else if (category === 'zero_fee') parts.push(sql<boolean>`s.fee_cents = 0`);
    else if (category === 'adjusted') parts.push(sql<boolean>`(s.adjustments_cents <> 0 or s.refunds_cents <> 0 or s.chargebacks_cents <> 0)`);
    else if (category === 'components') parts.push(sql<boolean>`(s.payload_json_safe ? 'interchangeCents' or s.payload_json_safe ? 'assessmentCents' or s.payload_json_safe ? 'markupCents')`);
    const where = sql<boolean>`${sql.join(parts, sql` and `)}`;
    const k = (await sql<any>`select count(*)::int as n, coalesce(sum(s.fee_cents), 0)::bigint as fees, coalesce(sum(s.gross_cents), 0)::bigint as gross,
        coalesce(sum(coalesce(s.expected_net_cents, s.net_cents)), 0)::bigint as net from payment_settlements s where s.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0] || {};
    const total = N(k.n); const pg = clampPage(pr, total);
    const sortSql = f.sort === 'expected_desc' ? sql`s.fee_cents desc, s.id desc` : sql`s.created_at desc, s.id desc`;
    const rows = (await sql<any>`select s.id, s.settlement_id, s.processor_type, s.settled_at, s.created_at, s.gross_cents, s.fee_cents, s.net_cents, s.expected_net_cents, s.adjustments_cents, s.refunds_cents, s.chargebacks_cents,
        (s.payload_json_safe->>'interchangeCents') as interchange, (s.payload_json_safe->>'assessmentCents') as assessment, (s.payload_json_safe->>'markupCents') as markup
      from payment_settlements s where s.tenant_id = ${T} and ${where} order by ${sortSql} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    const comp = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
    const gross = N(k.gross), fees = N(k.fees);
    return {
      kpis: { totalFeesCents: fees, grossCents: gross, netPayoutCents: N(k.net), effectiveRateBps: gross > 0 ? Math.round((fees * 10000) / gross) : null, settlements: total },
      items: rows.map((r: any) => ({ id: String(r.id), settlementRef: r.settlement_id ?? null, processor: r.processor_type ?? null, settledAt: iso(r.settled_at ?? r.created_at),
        grossCents: N(r.gross_cents), interchangeCents: comp(r.interchange), assessmentCents: comp(r.assessment), markupCents: comp(r.markup),
        otherAdjustmentsCents: N(r.adjustments_cents) - N(r.refunds_cents) - N(r.chargebacks_cents), feeCents: N(r.fee_cents), netPayoutCents: N(r.expected_net_cents ?? r.net_cents) })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
    };
  }

  // ── exceptions ──────────────────────────────────────────────────────────────────────────────────────────────────
  async exceptions(ctx: FinanceCtx, f: ReconFilters, pr: PageReq, x: { status?: string; severity?: string; cls?: ExceptionClass }) {
    const T = ctx.tenantId;
    const parts: RawBuilder<boolean>[] = [sql<boolean>`e.tenant_id = ${T}`, tsInPeriod(sql`e.created_at`, f.period)];
    if (x.status === 'active') parts.push(sql<boolean>`e.status <> 'resolved'`);
    else if (x.status) parts.push(sql<boolean>`e.status = ${x.status}`);
    if (x.severity) parts.push(sql<boolean>`e.severity = ${x.severity}`);
    if (x.cls) parts.push(sql<boolean>`e.kind = any(${CLASS_KINDS[x.cls]}::text[])`);
    if (f.q) { const lower = f.q.toLowerCase();
      parts.push(sql<boolean>`(lower(e.title) like ${likeOf(lower)} or lower(coalesce(e.source_ref, '')) like ${likeOf(lower)} or lower(coalesce(e.detail, '')) like ${likeOf(lower)}
        ${isUuid(f.q) ? sql`or e.id = ${f.q}::uuid` : sql``} or lower(coalesce(s.settlement_id, '')) like ${likeOf(lower)} or coalesce(d.reference_normalized, '') like ${likeOf(normRef(f.q) || '~')})`); }
    const from = sql`from reconciliation_exceptions e
      left join payment_settlements s on s.tenant_id = e.tenant_id and s.id::text = coalesce(nullif(split_part(e.source_ref, ':', 2), ''), e.source_ref)
      left join bank_deposits d on d.tenant_id = e.tenant_id and d.id::text = coalesce(nullif(split_part(e.source_ref, ':', 2), ''), e.source_ref)
      left join bank_accounts b on b.tenant_id = d.tenant_id and b.id = d.bank_account_id
      left join users u on u.id = e.assigned_to_user_id and u.tenant_id = e.tenant_id
      where ${sql.join(parts, sql` and `)}`;
    const k = (await sql<any>`select count(*)::int as n, count(*) filter (where e.status = 'open' or e.status = 'reopened')::int as open_n, count(*) filter (where e.status = 'in_review')::int as review_n,
        count(*) filter (where e.status = 'escalated')::int as esc_n, count(*) filter (where e.status = 'resolved')::int as resolved_n,
        coalesce(sum(abs(e.amount_cents)) filter (where e.status <> 'resolved'), 0)::bigint as at_risk,
        count(*) filter (where e.status <> 'resolved' and e.created_at + (case ${sql.join(Object.entries(EXCEPTION_REVIEW_DAYS).map(([sev, d]) => sql`when e.severity = ${sev} then ${d}::int`), sql` `)} else 5 end) * interval '1 day' < now())::int as overdue_n ${from}`.execute(this.db)).rows[0] || {};
    const total = N(k.n); const pg = clampPage(pr, total);
    const rows = (await sql<any>`select e.id, e.kind, e.severity, e.title, e.detail, e.amount_cents, e.status, e.source_ref, e.assigned_to_user_id, e.resolution_note, e.resolved_at, e.created_at, s.id as s_id, s.settlement_id as settlement_ref, s.processor_type, d.id as d_id, d.reference as deposit_reference, b.nickname, b.account_last4, coalesce(u.full_name, u.email) as reviewer,
        ((now() at time zone ${f.period.tz})::date - (e.created_at at time zone ${f.period.tz})::date)::int as age_days
      ${from} order by e.created_at desc, e.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return {
      kpis: { total, open: N(k.open_n), inReview: N(k.review_n), escalated: N(k.esc_n), resolved: N(k.resolved_n), amountAtRiskCents: N(k.at_risk), overdue: N(k.overdue_n) },
      cardAttempts: await this.unresolvedCardAttempts(ctx),
      items: rows.map((e: any) => ({
        id: String(e.id), kind: String(e.kind), class: classOfKind(String(e.kind)), severity: String(e.severity), title: String(e.title), detail: e.detail ?? null, amountCents: N(e.amount_cents),
        status: String(e.status), sourceRef: e.source_ref ?? null, settlementId: e.s_id ? String(e.s_id) : null, depositId: e.d_id ? String(e.d_id) : null,
        settlementRef: e.settlement_ref ?? null, processor: e.processor_type ?? null, depositReference: e.deposit_reference ?? null, account: e.nickname ? masked(e.nickname, e.account_last4) : null,
        reviewer: e.reviewer ?? null, assignedToUserId: e.assigned_to_user_id ?? null, resolutionNote: e.resolution_note ?? null, resolvedAt: iso(e.resolved_at), createdAt: iso(e.created_at), ageDays: N(e.age_days),
        // round 10 (AI Deposit Reconciliation 01): the per-case review due date from its severity (the one EXCEPTION_REVIEW_DAYS rule)
        ...caseDue({ severity: String(e.severity) as ExceptionSeverity, createdAt: iso(e.created_at) ?? '', status: String(e.status) as ExceptionStatus }),
      })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
    };
  }
  /** extras PAYMENTS 09 — one inbox: the card attempts nobody has resolved yet sit beside the reconciliation cases instead of
   *  only on Split Payments / Check Payments System. Read-only and current (not period-bound — an unresolved attempt is open
   *  NOW): a card attempt still in flight past CARD_ATTEMPT_STALE_MIN, one sent to review, or one the stranded sweep could not
   *  verify and nobody resolved. Branch-scoped when the person is. Each item carries its own evidence (state, the sweep's
   *  resolution note, the last processor error code, card brand / last 4 — never a full number). */
  async unresolvedCardAttempts(ctx: FinanceCtx) {
    const br = ctx.branchId && isUuid(ctx.branchId) ? sql`and a.branch_id = ${ctx.branchId}::uuid` : sql``;
    const where = sql`from payment_attempts a left join tickets t on t.tenant_id = a.tenant_id and t.id = a.ticket_id
      where a.tenant_id = ${ctx.tenantId}::uuid ${br} and a.resolved_at is null
        and (a.status = any(${CARD_ATTEMPT_REVIEW}::text[]) or a.stranded_at is not null
          or (a.status = any(${CARD_ATTEMPT_IN_FLIGHT}::text[]) and a.created_at < now() - make_interval(mins => ${CARD_ATTEMPT_STALE_MIN})))`;
    const k = (await sql<{ n: number; cents: string | number }>`select count(*)::int as n, coalesce(sum(a.amount_cents), 0)::bigint as cents ${where}`.execute(this.db)).rows[0];
    const rows = (await sql<any>`select a.id, a.ticket_id, t.ticket_number, a.amount_cents, a.status, a.stranded_at, a.resolution, a.last_error_code, a.card_brand, a.card_last4, a.created_at,
        floor(extract(epoch from (now() - a.created_at)) / 60)::int as age_min
      ${where} order by a.created_at asc, a.id asc limit ${CARD_ATTEMPT_LIST}`.execute(this.db)).rows;
    return {
      total: N(k?.n), amountCents: N(k?.cents), staleAfterMinutes: CARD_ATTEMPT_STALE_MIN,
      items: rows.map((a: any) => ({
        id: String(a.id), ticketId: a.ticket_id ? String(a.ticket_id) : null, ticketNumber: a.ticket_number ?? null, amountCents: N(a.amount_cents), state: String(a.status),
        reason: a.stranded_at ? 'stranded' as const : CARD_ATTEMPT_REVIEW.includes(String(a.status)) ? 'needs_review' as const : 'in_flight_too_long' as const,
        resolutionNote: a.resolution ?? null, lastErrorCode: a.last_error_code ?? null, card: a.card_last4 ? { brand: a.card_brand ?? null, last4: String(a.card_last4) } : null,
        createdAt: iso(a.created_at), ageMinutes: N(a.age_min),
      })),
    };
  }
  async exceptionDetail(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) return null;
    const e = (await sql<any>`select e.id, e.kind, e.severity, e.title, e.detail, e.amount_cents, e.status, e.source_ref, e.resolution_note, e.resolved_at, e.created_at, coalesce(u.full_name, u.email) as reviewer from reconciliation_exceptions e left join users u on u.id = e.assigned_to_user_id and u.tenant_id = e.tenant_id
      where e.tenant_id = ${ctx.tenantId} and e.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!e) return null;
    // Deposit Recon guide audit (Nov 4 2026): this workspace's writes go to audit_events (the auditor) — the history read only
    // the legacy audit_logs and so showed nothing. Both are read: the auditor's rows, and older rows written to audit_logs.
    const audits = (await sql<any>`select action, created_at, actor_role from (
        select action, created_at, actor_role from audit_events where tenant_id = ${ctx.tenantId} and resource_id = ${id}
        union all select action_type, created_at, role from audit_logs where tenant_id = ${ctx.tenantId} and entity_id = ${id}) h
      order by created_at desc limit 20`.execute(this.db)).rows;
    return {
      exception: { id: String(e.id), kind: String(e.kind), class: classOfKind(String(e.kind)), severity: String(e.severity), title: String(e.title), detail: e.detail ?? null, amountCents: N(e.amount_cents),
        status: String(e.status), sourceRef: e.source_ref ?? null, reviewer: e.reviewer ?? null, resolutionNote: e.resolution_note ?? null, resolvedAt: iso(e.resolved_at), createdAt: iso(e.created_at),
        ...caseDue({ severity: String(e.severity) as ExceptionSeverity, createdAt: iso(e.created_at) ?? '', status: String(e.status) as ExceptionStatus }) },
      notes: await this.notesOf(ctx, 'exception', id),
      history: audits.map((a: any) => ({ action: String(a.action), at: iso(a.created_at), role: a.actor_role ?? null })),
    };
  }
  /** Investigate: raise (or return the open) case for a settlement or deposit — never a duplicate of an unresolved case. */
  async raiseException(ctx: FinanceCtx, b: { targetType: 'settlement' | 'deposit'; targetId: string; kind: string; note?: string | null }, create: (input: { kind: string; title: string; detail: string | null; amountCents: number; sourceRef: string }) => Promise<{ id: string }>) {
    if (!isUuid(b.targetId)) throw new FinanceError('That record could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const tgt = b.targetType === 'settlement'
      ? (await sql<any>`select id, settlement_id as ref, coalesce(expected_net_cents, net_cents)::bigint as amount, processor_type from payment_settlements where tenant_id = ${T} and id = ${b.targetId}::uuid`.execute(this.db)).rows[0]
      : (await sql<any>`select id, reference as ref, amount_cents as amount from bank_deposits where tenant_id = ${T} and id = ${b.targetId}::uuid`.execute(this.db)).rows[0];
    if (!tgt) throw new FinanceError('That record could not be found.', 'RESOURCE_NOT_FOUND', 404);
    const sourceRef = `${b.kind}:${b.targetId}`;
    const open = (await sql<any>`select id from reconciliation_exceptions where tenant_id = ${T} and source_ref = ${sourceRef} and status <> 'resolved' limit 1`.execute(this.db)).rows[0];
    if (open) return { id: String(open.id), existing: true };
    const label = { missing_deposit: 'Missing deposit', amount_mismatch: 'Amount mismatch', duplicate: 'Possible duplicate', unmatched_deposit: 'Unmatched bank credit', fee_difference: 'Fee / reversal discrepancy', integration_error: 'Integration / data error' }[b.kind] ?? 'Investigation';
    const what = b.targetType === 'settlement' ? `settlement ${tgt.ref ?? String(tgt.id).slice(0, 8)}` : `bank deposit ${tgt.ref ?? String(tgt.id).slice(0, 8)}`;
    const made = await create({ kind: b.kind, title: `${label} — ${what}`, detail: b.note ? String(b.note).trim().slice(0, 1000) : null, amountCents: N(tgt.amount), sourceRef });
    await audit(this.auditor, ctx, 'reconciliation', 'exception_raised', 'reconciliation_exception', made.id, { kind: b.kind, targetType: b.targetType, targetId: b.targetId }, this.log('audit', ctx));
    return { id: made.id, existing: false };
  }
  async auditException(ctx: FinanceCtx, id: string, action: string, metadata: Record<string, unknown>) {
    await audit(this.auditor, ctx, 'reconciliation', action, 'reconciliation_exception', id, metadata, this.log('audit', ctx));
  }
  /** Who can be assigned a case: this salon's staff who can work reconciliation (owners and managers). */
  async reviewers(ctx: FinanceCtx) {
    const rows = (await sql<any>`select u.id, coalesce(u.full_name, u.email) as name, u.role from users u where u.tenant_id = ${ctx.tenantId} and u.role in ('OWNER', 'MANAGER')
      and coalesce(u.status, 'active') = 'active' order by u.role, name limit 50`.execute(this.db)).rows;
    return rows.map((u: any) => ({ id: String(u.id), name: String(u.name || ''), role: String(u.role) }));
  }

  // ── reports ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async report(ctx: FinanceCtx, type: ReportType, f: ReconFilters, pr: PageReq): Promise<{ type: ReportType; columns: Array<{ key: string; label: string; money?: boolean; align?: 'right' }>; rows: Record<string, unknown>[]; total: number; page: number; pageSize: number; pageCount: number; totals: Record<string, number>; definition: string; dateBasis: string }> {
    const all = await this.reportRows(ctx, type, f);
    const pg = clampPage(pr, all.rows.length);
    return { type, columns: all.columns, rows: all.rows.slice(pg.offset, pg.offset + pg.pageSize), total: all.rows.length, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount, totals: all.totals, definition: all.definition, dateBasis: all.dateBasis };
  }
  async reportCsv(ctx: FinanceCtx, type: ReportType, f: ReconFilters): Promise<string> {
    const all = await this.reportRows(ctx, type, f);
    const p = f.period;
    const doc = csvDocument(`Deposit reconciliation — ${type.replace(/_/g, ' ')}`,
      [['Generated', new Date().toISOString()], ['Period', p.from && p.to ? `${p.from} to ${p.to} (${p.tz})` : 'All time'], ['Date basis', all.dateBasis], ['Currency', 'USD (amounts in dollars)'],
       ['Processor', f.processor ?? 'All'], ['Bank account', f.bankAccountId ? 'Selected account' : 'All'], ['Definition', all.definition]],
      all.columns.map((c) => c.label), all.rows.map((r) => all.columns.map((c) => (c.money ? usd(N(r[c.key])) : r[c.key] ?? ''))),
      Object.entries(all.totals).map(([k, v]) => [`Total ${k.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()}`, /Cents$/.test(k) ? usd(v) : String(v)]));
    await audit(this.auditor, ctx, 'reconciliation', 'report_exported', 'reconciliation_report', null, { type, rows: all.rows.length, from: p.from, to: p.to }, this.log('audit', ctx));
    return doc;
  }
  async reportForPdf(ctx: FinanceCtx, type: ReportType, f: ReconFilters) {
    const all = await this.reportRows(ctx, type, f);
    await audit(this.auditor, ctx, 'reconciliation', 'report_exported', 'reconciliation_report', null, { type, rows: all.rows.length, from: f.period.from, to: f.period.to, format: 'pdf' }, this.log('audit', ctx));
    return all;
  }
  private async reportRows(ctx: FinanceCtx, type: ReportType, f: ReconFilters): Promise<{ columns: ReportColumn[]; rows: Record<string, unknown>[]; totals: Record<string, number>; definition: string; dateBasis: string }> {
    const T = ctx.tenantId, tz = f.period.tz, LIMIT = 20_000;
    const w = this.where(ctx, { ...f, q: '' });
    const money = (key: string, label: string): ReportColumn => ({ key, label, money: true, align: 'right' });
    const col = (key: string, label: string): ReportColumn => ({ key, label });
    const sumOf = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + N(r[k]), 0)]));
    switch (type) {
      case 'settlement_summary': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select to_char((coalesce(sb.settled_at, sb.created_at) at time zone ${tz})::date, 'YYYY-MM-DD') as day, count(*)::int as settlements,
            sum(sb.gross_cents)::bigint as gross, sum(sb.fee_cents)::bigint as fees, sum(sb.expected_cents)::bigint as expected, sum(sb.matched_cents)::bigint as matched
          from sb where ${w.where} group by 1 order by 1 desc limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => ({ day: ymd(r.day), settlements: N(r.settlements), grossCents: N(r.gross), feesCents: N(r.fees), expectedCents: N(r.expected), matchedCents: N(r.matched), differenceCents: N(r.matched) - N(r.expected) }));
        return { columns: [col('day', 'Settlement date'), col('settlements', 'Settlements'), money('grossCents', 'Gross'), money('feesCents', 'Fees'), money('expectedCents', 'Expected payout'), money('matchedCents', 'Matched'), money('differenceCents', 'Difference')],
          rows, totals: sumOf(rows, ['settlements', 'grossCents', 'feesCents', 'expectedCents', 'matchedCents', 'differenceCents']), definition: 'Processor-reported settlement batches by salon-local settlement date. Matched = bank deposits allocated to them.', dateBasis: f.basis };
      }
      case 'matched_deposits': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select a.id, a.amount_cents, a.source, a.created_at, d.reference, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_date, b.nickname, b.account_last4, sb.ref as settlement_ref, sb.processor_type
          from reconciliation_allocations a join sb on sb.id = a.settlement_id join bank_deposits d on d.id = a.deposit_id and d.tenant_id = a.tenant_id
          left join bank_accounts b on b.id = d.bank_account_id and b.tenant_id = d.tenant_id
          where a.tenant_id = ${T} and a.unmatched_at is null and ${w.where} ${f.bankAccountId ? sql`and d.bank_account_id = ${f.bankAccountId}::uuid` : sql``}
          order by a.created_at desc, a.id desc limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => ({ matchedAt: iso(r.created_at)?.slice(0, 10), depositDate: ymd(r.deposit_date), depositReference: r.reference ?? '', account: masked(r.nickname, r.account_last4) ?? '', settlement: r.settlement_ref ?? '', processor: r.processor_type ?? '', source: String(r.source), allocatedCents: N(r.amount_cents) }));
        return { columns: [col('matchedAt', 'Matched on'), col('depositDate', 'Bank posted'), col('depositReference', 'Bank reference'), col('account', 'Account'), col('settlement', 'Settlement'), col('processor', 'Processor'), col('source', 'Source'), money('allocatedCents', 'Allocated')],
          rows, totals: sumOf(rows, ['allocatedCents']), definition: 'Active allocations (a person matched them) of the settlements in scope.', dateBasis: f.basis };
      }
      case 'unmatched_deposits': {
        const parts: RawBuilder<boolean>[] = [dateInPeriod(sql`db0.posted_day`, f.period), sql<boolean>`db0.remaining_cents > 0 and db0.status <> 'returned'`];
        if (f.bankAccountId) parts.push(sql<boolean>`db0.bank_account_id = ${f.bankAccountId}::uuid`);
        const rows = (await sql<any>`${this.depositBase(ctx, f.period.tz)} select db0.* from db0 where ${sql.join(parts, sql` and `)} order by db0.created_at desc, db0.id desc limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => this.depositRow(r)).map((d) => ({ depositDate: d.depositDate, reference: d.reference ?? '', account: d.account ?? '', source: d.source, state: d.matchState, amountCents: d.amountCents, remainingCents: d.remainingCents }));
        return { columns: [col('depositDate', 'Bank posted'), col('reference', 'Bank reference'), col('account', 'Account'), col('source', 'Source'), col('state', 'Match state'), money('amountCents', 'Amount'), money('remainingCents', 'Unallocated')],
          rows, totals: sumOf(rows, ['amountCents', 'remainingCents']), definition: 'Bank deposits (by bank posted date) with an unallocated amount.', dateBasis: 'bank_posted' };
      }
      case 'missing_overdue': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select sb.* from sb where ${w.where} and sb.is_missing order by sb.arrival asc, sb.id desc limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => this.row(r)).map((s) => ({ settlement: s.settlementRef ?? s.id, processor: s.processor ?? '', settled: s.settledAt?.slice(0, 10) ?? '', expectedArrival: `${s.expectedArrival ?? ''}${s.arrivalSourced ? '' : ' (est.)'}`, expectedCents: s.expectedNetCents }));
        return { columns: [col('settlement', 'Settlement'), col('processor', 'Processor'), col('settled', 'Settled'), col('expectedArrival', 'Expected arrival'), money('expectedCents', 'Expected payout')],
          rows, totals: sumOf(rows, ['expectedCents']), definition: `Payouts with nothing matched ${GRACE_DAYS} days after the expected arrival (provider date, else settlement date + ${FUNDING_DAYS} days).`, dateBasis: f.basis };
      }
      case 'processing_fees': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select coalesce(sb.processor_type, 'unknown') as processor, to_char(coalesce(sb.settled_at, sb.created_at) at time zone ${tz}, 'YYYY-MM') as month,
            count(*)::int as settlements, sum(sb.gross_cents)::bigint as gross, sum(sb.fee_cents)::bigint as fees from sb where ${w.where} group by 1, 2 order by 2 desc, 1 limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => ({ month: String(r.month), processor: String(r.processor), settlements: N(r.settlements), grossCents: N(r.gross), feesCents: N(r.fees), effectiveRate: N(r.gross) > 0 ? `${(Math.round((N(r.fees) * 10000) / N(r.gross)) / 100).toFixed(2)}%` : '—' }));
        return { columns: [col('month', 'Month'), col('processor', 'Processor'), col('settlements', 'Settlements'), money('grossCents', 'Gross'), money('feesCents', 'Fees'), col('effectiveRate', 'Effective rate')],
          rows, totals: sumOf(rows, ['settlements', 'grossCents', 'feesCents']), definition: 'Fees the processor deducted in each batch. Component breakdowns appear only where the processor supplies them.', dateBasis: f.basis };
      }
      case 'exceptions_aging': {
        const rows = (await sql<any>`select case when age < 8 then '0_7' when age < 31 then '8_30' when age < 61 then '31_60' else '61_plus' end as bucket, min(age) as ord,
            count(*) filter (where status in ('open', 'reopened', 'escalated'))::int as open_n, count(*) filter (where status = 'in_review')::int as review_n, count(*) filter (where status = 'resolved')::int as resolved_n,
            coalesce(sum(abs(amount_cents)) filter (where status <> 'resolved'), 0)::bigint as at_risk
          from (select e.*, ((now() at time zone ${tz})::date - (e.created_at at time zone ${tz})::date)::int as age from reconciliation_exceptions e where e.tenant_id = ${T} and ${tsInPeriod(sql`e.created_at`, f.period)}) x
          group by 1 order by 2`.execute(this.db)).rows
          .map((r: any) => ({ bucket: String(r.bucket), open: N(r.open_n), inReview: N(r.review_n), resolved: N(r.resolved_n), atRiskCents: N(r.at_risk) }));
        return { columns: [col('bucket', 'Age'), col('open', 'Open'), col('inReview', 'In review'), col('resolved', 'Resolved'), money('atRiskCents', 'Unresolved amount')],
          rows, totals: sumOf(rows, ['open', 'inReview', 'resolved', 'atRiskCents']), definition: 'Exception cases by age (created date, salon time). Resolved cases stay in this report.', dateBasis: 'created' };
      }
      case 'net_difference_trend': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select to_char(date_trunc('week', (coalesce(sb.settled_at, sb.created_at) at time zone ${tz}))::date, 'YYYY-MM-DD') as wk,
            sum(sb.expected_cents) filter (where sb.expected_cents > 0 and sb.today > sb.arrival + ${GRACE_DAYS}::int)::bigint as due_expected, sum(sb.matched_cents) filter (where sb.expected_cents > 0 and sb.today > sb.arrival + ${GRACE_DAYS}::int)::bigint as due_matched,
            sum(sb.expected_cents) filter (where sb.expected_cents > 0 and sb.today <= sb.arrival + ${GRACE_DAYS}::int)::bigint as not_due
          from sb where ${w.where} group by 1 order by 1 desc limit ${LIMIT}`.execute(this.db)).rows
          .map((r: any) => ({ week: ymd(r.wk), dueExpectedCents: N(r.due_expected), dueMatchedCents: N(r.due_matched), differenceCents: N(r.due_matched) - N(r.due_expected), notYetDueCents: N(r.not_due) }));
        return { columns: [col('week', 'Week of'), money('dueExpectedCents', 'Expected (due)'), money('dueMatchedCents', 'Matched'), money('differenceCents', 'Net difference'), money('notYetDueCents', 'Not yet due (excluded)')],
          rows, totals: sumOf(rows, ['dueExpectedCents', 'dueMatchedCents', 'differenceCents', 'notYetDueCents']), definition: `Matched − expected for payouts past their expected arrival plus ${GRACE_DAYS} grace days (the same rule as Missing), by settlement week.`, dateBasis: f.basis };
      }
      case 'bank_accounts': {
        const rows = (await sql<any>`with dal as (select a.deposit_id, sum(a.amount_cents)::bigint as allocated from reconciliation_allocations a where a.tenant_id = ${T} and a.unmatched_at is null group by a.deposit_id)
          select b.id, b.nickname, b.account_last4, b.status, count(d.id)::int as deposits, coalesce(sum(d.amount_cents), 0)::bigint as total, coalesce(sum(coalesce(dal.allocated, 0)), 0)::bigint as allocated
          from bank_accounts b left join bank_deposits d on d.bank_account_id = b.id and d.tenant_id = b.tenant_id and d.status <> 'returned' and ${dateInPeriod(sql`coalesce(d.deposit_date, (d.created_at at time zone ${f.period.tz})::date)`, f.period)}
          left join dal on dal.deposit_id = d.id
          where b.tenant_id = ${T} ${f.bankAccountId ? sql`and b.id = ${f.bankAccountId}::uuid` : sql``} group by b.id, b.nickname, b.account_last4, b.status order by b.nickname`.execute(this.db)).rows
          .map((r: any) => ({ account: masked(r.nickname, r.account_last4) ?? '', status: String(r.status), deposits: N(r.deposits), depositsCents: N(r.total), allocatedCents: N(r.allocated), unallocatedCents: N(r.total) - N(r.allocated) }));
        return { columns: [col('account', 'Account'), col('status', 'Status'), col('deposits', 'Deposits'), money('depositsCents', 'Deposited'), money('allocatedCents', 'Matched'), money('unallocatedCents', 'Unmatched')],
          rows, totals: sumOf(rows, ['deposits', 'depositsCents', 'allocatedCents', 'unallocatedCents']), definition: 'Bank deposits per account (bank posted date) and how much of them is matched to settlements.', dateBasis: 'bank_posted' };
      }
      case 'processor_comparison': {
        const rows = (await sql<any>`${this.base(ctx, tz)} select coalesce(sb.processor_type, 'unknown') as processor, count(*)::int as settlements, sum(sb.gross_cents)::bigint as gross, sum(sb.fee_cents)::bigint as fees,
            sum(sb.expected_cents)::bigint as expected, sum(sb.matched_cents)::bigint as matched from sb where ${w.where} group by 1 order by 1`.execute(this.db)).rows
          .map((r: any) => ({ processor: String(r.processor), settlements: N(r.settlements), grossCents: N(r.gross), feesCents: N(r.fees), effectiveRate: N(r.gross) > 0 ? `${(Math.round((N(r.fees) * 10000) / N(r.gross)) / 100).toFixed(2)}%` : '—', expectedCents: N(r.expected), matchedCents: N(r.matched), differenceCents: N(r.matched) - N(r.expected) }));
        return { columns: [col('processor', 'Processor'), col('settlements', 'Settlements'), money('grossCents', 'Gross'), money('feesCents', 'Fees'), col('effectiveRate', 'Effective rate'), money('expectedCents', 'Expected'), money('matchedCents', 'Matched'), money('differenceCents', 'Difference')],
          rows, totals: sumOf(rows, ['settlements', 'grossCents', 'feesCents', 'expectedCents', 'matchedCents', 'differenceCents']), definition: 'Settlements per processor in scope.', dateBasis: f.basis };
      }
    }
  }

  /** Universal search across the four record groups (spec §05) — typed, ranked results that deep-link. */
  async universalSearch(ctx: FinanceCtx, raw: string, tz: string) {
    const q = searchText(raw); if (!q) return { query: '', results: [] };
    const all: Period = { preset: 'all', from: null, to: null, tz, today: '' };
    const f: ReconFilters = { period: all, basis: 'settlement', q, sort: 'created_desc' };
    const [s, d, e] = await Promise.all([
      this.listSettlements(ctx, f, { page: 1, pageSize: 6 }),
      this.listDeposits(ctx, f, { page: 1, pageSize: 6 }, { unmatchedOnly: false }),
      this.exceptions(ctx, f, { page: 1, pageSize: 4 }, {}),
    ]);
    return {
      query: q,
      results: [
        ...s.items.map((x) => ({ type: x.matchedBy === 'customer' || x.matchedBy === 'payment' ? 'payment' : 'settlement', id: x.id, label: x.settlementRef ?? x.id.slice(0, 8), amountCents: x.expectedNetCents, date: x.settledAt, status: x.status, via: x.matchedBy })),
        ...d.items.map((x) => ({ type: 'bank_deposit', id: x.id, label: x.reference ?? x.account ?? x.id.slice(0, 8), amountCents: x.amountCents, date: x.depositDate, status: x.matchState, via: null })),
        ...e.items.map((x) => ({ type: 'exception', id: x.id, label: x.title, amountCents: x.amountCents, date: x.createdAt, status: x.status, via: null })),
      ],
      totals: { settlements: s.total, deposits: d.total, exceptions: e.total },
    };
  }
}
