// refunds-voids-screen.repository.ts — Refunds & Voids mandate (Oct 29 2026): the read model behind POS Payments & Money →
// Refunds & Voids (/tenant/payments/refunds-voids). Raw SQL, tenant + location scoped, ONE ROW PER REVERSAL, read from the
// authoritative ledger, never a parallel one:
//   • a REFUND is a payment_refunds row — Checkout's claim-first reservation against ONE original tender (the cap, the
//     processor answer and the settlement all hang on it): reserved / pending → Pending; processing → Processing, or
//     Needs review once the sweep could not decide (review_reason / stranded_at); refunded → Completed; failed → Failed;
//     cancelled / voided → Cancelled. A released reservation is deleted by Checkout and so never appears;
//   • a VOID is the ORIGINAL tender marked 'voided' (Checkout's markPaymentVoided — the face value), joined to the void
//     record row (amount 0, the processor's void reference) and to the audit row that carries the reason and the actor;
//     a void is Completed when it exists — Checkout records nothing for a declined or lost void;
//   • TOTAL REVERSED = completed refund amounts + voided face values (an operational figure — not cash returned, and never
//     the two rows of one void counted twice);
//   • remaining REFUNDABLE on a tender = captured − Σ refunds that are not failed / cancelled (pending ones reserve it).
// Writes (refund, void, settle an unknown refund) stay on the authorised Checkout routes; this module never moves money.
import { Logger } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import {
  type FinanceCtx, type Period, type PageReq, type Paged, FinanceError, resolvePeriod, salonTimeZone, tsInPeriod, clampPage, isUuid, N, iso, likeOf, digitsOf,
  csvDocument, usd, audit, type AuditRecorder, oneOf, moneyToCents,
} from './finance-scope';
import { methodKey } from './split-payments-screen.repository';

export const RV_BASES = ['requested', 'completed', 'original'] as const;
export const RV_TYPES = ['refund', 'partial_refund', 'void'] as const;
export const RV_STATES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'needs_review'] as const;
export const RV_METHODS = ['cash', 'card', 'gift_card', 'other'] as const;
export const RV_SORTS = ['created_desc', 'created_asc', 'completed_desc', 'amount_desc', 'amount_asc', 'type_asc', 'status_asc'] as const;
export interface RvFilters {
  period: Period; basis: (typeof RV_BASES)[number]; q: string; type?: (typeof RV_TYPES)[number]; state?: (typeof RV_STATES)[number]; method?: (typeof RV_METHODS)[number];
  processor?: string; registerId?: string; minCents?: number; maxCents?: number; sort: (typeof RV_SORTS)[number];
}
const CAPTURED = [...REVENUE_BEARING_STATUSES];                       // a tender Checkout will refund or void: approved / partial (+ paid / captured)
const RESERVING = ['reserved', 'pending', 'processing', 'refunded'];  // refund rows that hold (or took) the money
const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };
const METHOD_SQL: Record<string, RawBuilder<boolean>> = {
  cash: sql<boolean>`a.method = 'cash'`, card: sql<boolean>`a.method in ('card', 'credit_card', 'debit_card')`, gift_card: sql<boolean>`a.method in ('gift_card', 'gift')`,
  other: sql<boolean>`a.method not in ('cash', 'card', 'credit_card', 'debit_card', 'gift_card', 'gift')`,
};

export class RefundsVoidsScreenRepository {
  private readonly log = new Logger('RefundsVoidsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): RvFilters {
    const cents = (v: unknown, field: string) => { if (v == null || v === '') return undefined; const n = typeof v === 'number' ? v : moneyToCents(String(v)); if (n == null || n < 0) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field }); return n; };
    const f: RvFilters = {
      period, basis: oneOf(q.dateField, RV_BASES, 'dateField') ?? 'requested', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      type: oneOf(q.type, RV_TYPES, 'type'), state: oneOf(q.status, RV_STATES, 'status'), method: oneOf(q.method, RV_METHODS, 'method'),
      processor: typeof q.processor === 'string' && /^[a-z0-9_-]{1,40}$/i.test(q.processor) ? q.processor.toLowerCase() : undefined, registerId: typeof q.register === 'string' && isUuid(q.register) ? q.register : undefined,
      minCents: cents(q.minAmount, 'minAmount'), maxCents: cents(q.maxAmount, 'maxAmount'), sort: oneOf(q.sort, RV_SORTS, 'sort') ?? 'created_desc',
    };
    if (f.minCents != null && f.maxCents != null && f.minCents > f.maxCents) throw new FinanceError('The minimum amount must not be above the maximum.', 'VALIDATION_FAILED', 400, { field: 'minAmount' });
    return f;
  }
  private scope(ctx: FinanceCtx): RawBuilder<boolean> { return ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(a.branch_id = ${ctx.branchId}::uuid or a.branch_id is null)` : sql<boolean>`true`; }

  /** One row per reversal: refunds (payment_refunds) ∪ voids (original tenders marked voided), each with its original tender. */
  private base(ctx: FinanceCtx): RawBuilder<unknown> {
    const T = ctx.tenantId;
    return sql`select u.kind, u.id, u.payment_id, u.reversed_cents, u.raw_status, u.state, u.requested_at, u.completed_at, u.reason, coalesce(u.processor, op.processor) as processor, u.provider_ref, u.actor_id, u.review_reason, u.last_error, u.settled_by, u.reversal_payment_id, u.settlement_batch_id,
        coalesce(u.branch_id, op.branch_id) as branch_id, op.tenant_id, op.ticket_id, op.method, op.amount_cents as original_cents, coalesce(op.tip_cents, 0)::bigint as original_tip_cents, op.status as original_status, op.created_at as original_at, op.processor_transaction_id as original_ref, op.card_brand, op.card_last4, op.gift_card_last4, op.payment_surface,
        (case when u.kind = 'void' then 'void' when u.reversed_cents >= op.amount_cents then 'refund' else 'partial_refund' end) as type,
        t.ticket_number, t.customer_id, t.checkout_register_id, t.primary_technician_id, cx.full_name as customer_name, cx.normalized_phone as customer_phone, cx.email as customer_email, coalesce(ac.full_name, ac.email) as actor, b.name as branch_name, st.name as register_name
      from (
        select 'refund' as kind, r.id, r.payment_id, r.amount_cents::bigint as reversed_cents, r.status as raw_status,
          (case r.status when 'refunded' then 'completed' when 'reserved' then 'pending' when 'pending' then 'pending' when 'failed' then 'failed' when 'cancelled' then 'cancelled' when 'voided' then 'cancelled'
            when 'processing' then (case when r.review_reason is not null or r.stranded_at is not null then 'needs_review' else 'processing' end) else 'needs_review' end) as state,
          r.created_at as requested_at, (case when r.status = 'refunded' then coalesce(r.settled_at, r.created_at) else null end) as completed_at, r.reason, r.processor_type as processor,
          r.processor_refund_id as provider_ref, r.created_by_user_id as actor_id, r.review_reason, r.last_error, r.settled_by, rp.id as reversal_payment_id, rp.settlement_batch_id, r.branch_id
        from payment_refunds r join payments p0 on p0.id = r.payment_id and p0.tenant_id = r.tenant_id
        left join lateral (select rp.id, rp.settlement_batch_id from payments rp where rp.tenant_id = r.tenant_id and rp.ticket_id = p0.ticket_id and rp.status = 'refunded' and r.processor_refund_id is not null
          and (rp.id::text = r.processor_refund_id or rp.processor_transaction_id = r.processor_refund_id) order by rp.created_at limit 1) rp on true
        where r.tenant_id = ${T}
        union all
        select 'void', p.id, p.id, p.amount_cents::bigint, p.status, 'completed', coalesce(vr.created_at, al.created_at, p.updated_at), coalesce(vr.created_at, al.created_at, p.updated_at), al.reason, p.processor,
          coalesce(vr.processor_transaction_id, p.processor_transaction_id), al.user_id, null, null, null, vr.id, null, p.branch_id
        from payments p
        left join lateral (select v.id, v.created_at, v.processor_transaction_id from payments v where v.tenant_id = p.tenant_id and v.ticket_id = p.ticket_id and v.status in ('voided', 'void') and v.amount_cents = 0 and v.created_at >= p.created_at order by v.created_at limit 1) vr on true
        left join lateral (select a.user_id, a.created_at, a.metadata_json->'metadata'->>'reason' as reason from audit_logs a where a.tenant_id = p.tenant_id and a.action_type = 'pos_checkout_void_created' and a.entity_id = p.id::text order by a.created_at desc limit 1) al on true
        where p.tenant_id = ${T} and p.status in ('voided', 'void') and p.amount_cents > 0
      ) u
      join payments op on op.id = u.payment_id and op.tenant_id = ${T}
      left join tickets t on t.id = op.ticket_id and t.tenant_id = ${T}
      left join customers cx on cx.id = t.customer_id and cx.tenant_id = ${T}
      left join users ac on ac.id = u.actor_id
      left join branches b on b.id = coalesce(u.branch_id, op.branch_id) and b.tenant_id = ${T}
      left join pos_stations st on st.id = t.checkout_register_id and st.tenant_id = ${T}`;
  }
  private basisCol(b: RvFilters['basis']): RawBuilder<unknown> { return { requested: sql`a.requested_at`, completed: sql`a.completed_at`, original: sql`a.original_at` }[b]; }
  private where(ctx: FinanceCtx, f: RvFilters): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [this.scope(ctx), tsInPeriod(this.basisCol(f.basis), f.period)];
    if (f.type) parts.push(sql<boolean>`a.type = ${f.type}`);
    if (f.state) parts.push(sql<boolean>`a.state = ${f.state}`);
    if (f.method) parts.push(METHOD_SQL[f.method]);
    if (f.processor) parts.push(sql<boolean>`lower(coalesce(a.processor, '')) = ${f.processor}`);
    if (f.registerId) parts.push(sql<boolean>`a.checkout_register_id = ${f.registerId}::uuid`);
    if (f.minCents != null) parts.push(sql<boolean>`a.reversed_cents >= ${f.minCents}`);
    if (f.maxCents != null) parts.push(sql<boolean>`a.reversed_cents <= ${f.maxCents}`);
    if (f.q) parts.push(this.search(f.q).where);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }
  /** customer name / email / phone · ticket # · payment / refund / void id · processor reference · amount — exact references first */
  private search(q: string): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, ''); const tn = q.replace(/^#/, '').trim();
    const exact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) exact.push(sql<boolean>`(a.id = ${q}::uuid or a.payment_id = ${q}::uuid or a.reversal_payment_id = ${q}::uuid or a.ticket_id = ${q}::uuid or a.customer_id = ${q}::uuid)`);
    if (/^\d{1,8}$/.test(tn)) exact.push(sql<boolean>`a.ticket_number = ${tn}`);
    if (/^[A-Za-z0-9_-]{4,}$/.test(q)) exact.push(sql<boolean>`(a.provider_ref = ${q} or a.original_ref = ${q})`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(q) ? moneyToCents(q) : null;
    if (amt != null && amt > 0) exact.push(sql<boolean>`(a.reversed_cents = ${amt} or a.original_cents = ${amt})`);
    if (d.length >= 7) { const tail = d.slice(-10); exact.push(sql<boolean>`right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`); }
    if (q.includes('@')) exact.push(sql<boolean>`lower(coalesce(a.customer_email, '')) = ${lower}`);
    if (q.length >= 2 && !/^\d+$/.test(q)) { part.push(sql<boolean>`lower(coalesce(a.customer_name, '')) like ${likeOf(lower)}`); if (q.length >= 4) part.push(sql<boolean>`lower(coalesce(a.customer_email, '')) like ${likeOf(lower)}`); }
    if (/^\d{2,8}$/.test(tn)) part.push(sql<boolean>`a.ticket_number like ${tn + '%'}`);
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    return { where: sql<boolean>`(${ex} or ${pa})`, rank: sql<number>`(case when ${ex} then 2 when ${pa} then 1 else 0 end)` };
  }
  private row(ctx: FinanceCtx, r: any) {
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    return {
      id: String(r.id), kind: String(r.kind) as 'refund' | 'void', type: String(r.type), state: String(r.state), rawStatus: String(r.raw_status), requestedAt: iso(r.requested_at), completedAt: iso(r.completed_at),
      paymentId: String(r.payment_id), reversalPaymentId: r.reversal_payment_id ? String(r.reversal_payment_id) : null, ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number ?? null,
      customer: r.customer_id ? { id: String(r.customer_id), name: r.customer_name ?? null, phone: canContact ? showPhone(r.customer_phone) : maskPhone(r.customer_phone) } : null,
      originalCents: N(r.original_cents), reversedCents: N(r.reversed_cents), method: methodKey(r.method), rawMethod: String(r.method ?? ''), processor: r.processor ?? null, providerRef: r.provider_ref ?? null, originalRef: r.original_ref ?? null,
      card: r.card_brand || r.card_last4 ? `${r.card_brand ?? ''} ••${r.card_last4 ?? '••'}`.trim() : null, giftCardLast4: r.gift_card_last4 ?? null, channel: r.payment_surface ?? null,
      reason: r.reason ?? null, actor: r.actor ?? null, reviewReason: r.review_reason ?? null, lastError: r.last_error ? String(r.last_error).slice(0, 160) : null, settledBy: r.settled_by ?? null,
      settlementId: r.settlement_batch_id ? String(r.settlement_batch_id) : null, branch: r.branch_name ?? null, register: r.register_name ?? null, originalAt: iso(r.original_at), originalStatus: String(r.original_status ?? ''),
      ...(r.rank !== undefined && r.rank !== 0 ? { matchedBy: r.rank === 2 ? 'reference' : 'name' } : {}),
    };
  }
  private static readonly ORDER = {
    created_desc: sql`a.requested_at desc nulls last, a.id desc`, created_asc: sql`a.requested_at asc nulls last, a.id asc`, completed_desc: sql`a.completed_at desc nulls last, a.requested_at desc, a.id desc`,
    amount_desc: sql`a.reversed_cents desc, a.requested_at desc, a.id desc`, amount_asc: sql`a.reversed_cents asc, a.requested_at desc, a.id desc`, type_asc: sql`a.type asc, a.requested_at desc, a.id desc`, status_asc: sql`a.state asc, a.requested_at desc, a.id desc`,
  };

  async list(ctx: FinanceCtx, f: RvFilters, pr: PageReq): Promise<Paged<ReturnType<RefundsVoidsScreenRepository['row']>>> {
    const w = this.where(ctx, f); const s = this.search(f.q);
    const total = N((await sql<any>`select count(*)::int as n from (${this.base(ctx)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`select a.*, ${f.q ? s.rank : sql`0`} as rank from (${this.base(ctx)}) a where ${w}
      order by ${f.q ? sql`rank desc, ` : sql``}${RefundsVoidsScreenRepository.ORDER[f.sort]} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(ctx, r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** Refunds · Voids · Total Reversed · Pending · Needs Review over the whole scope (period, method, processor, register — never the page or the search). */
  async summary(ctx: FinanceCtx, f: RvFilters) {
    const w = this.where(ctx, { ...f, q: '', type: undefined, state: undefined, minCents: undefined, maxCents: undefined });
    const r = (await sql<any>`select count(*) filter (where a.kind = 'refund' and a.state = 'completed')::int as refunds, coalesce(sum(a.reversed_cents) filter (where a.kind = 'refund' and a.state = 'completed'), 0)::bigint as refunded,
        count(*) filter (where a.kind = 'refund' and a.type = 'partial_refund' and a.state = 'completed')::int as partial_refunds,
        count(*) filter (where a.kind = 'void')::int as voids, coalesce(sum(a.reversed_cents) filter (where a.kind = 'void'), 0)::bigint as voided,
        count(*) filter (where a.state in ('pending', 'processing'))::int as pending, coalesce(sum(a.reversed_cents) filter (where a.state in ('pending', 'processing')), 0)::bigint as pending_cents,
        count(*) filter (where a.state in ('failed', 'needs_review'))::int as review, coalesce(sum(a.reversed_cents) filter (where a.state in ('failed', 'needs_review')), 0)::bigint as review_cents,
        count(*) filter (where a.state = 'needs_review')::int as unknown_count, count(*) filter (where a.state = 'failed')::int as failed_count, count(*) filter (where a.state = 'cancelled')::int as cancelled,
        coalesce(sum(a.reversed_cents) filter (where a.state = 'completed' and a.method = 'cash' and a.kind = 'refund'), 0)::bigint as cash_refunded,
        coalesce(sum(a.reversed_cents) filter (where a.state = 'completed' and a.method in ('card', 'credit_card', 'debit_card') and a.kind = 'refund'), 0)::bigint as card_refunded,
        coalesce(sum(a.reversed_cents) filter (where a.state = 'completed' and a.method in ('gift_card', 'gift') and a.kind = 'refund'), 0)::bigint as gift_refunded,
        count(*)::int as listed
      from (${this.base(ctx)}) a where ${w}`.execute(this.db)).rows[0] ?? {};
    return {
      kpis: { refunds: N(r.refunds), refundedCents: N(r.refunded), partialRefunds: N(r.partial_refunds), voids: N(r.voids), voidedCents: N(r.voided), totalReversed: N(r.refunds) + N(r.voids), totalReversedCents: N(r.refunded) + N(r.voided),
        pending: N(r.pending), pendingCents: N(r.pending_cents), needsReview: N(r.review), needsReviewCents: N(r.review_cents), unknown: N(r.unknown_count), failed: N(r.failed_count), cancelled: N(r.cancelled), listed: N(r.listed),
        byMethod: { cashCents: N(r.cash_refunded), cardCents: N(r.card_refunded), giftCardCents: N(r.gift_refunded) } },
      definitions: { refunds: 'completed refunds (the processor, cash or gift-card ledger confirmed them) — pending and failed ones are counted apart', voids: 'original authorisations / payments successfully voided, at face value — not cash returned',
        totalReversed: 'completed refund amounts + voided face values (operational; not cash returned)', pending: 'reservations without a final answer (reserved, pending, processing)', needsReview: 'failed, or the processor answer was lost and the sweep could not decide' },
      period: f.period, basis: f.basis, asOf: new Date().toISOString(),
      permissions: { refund: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.refund'), void: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.void'),
        approve: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'checkout.approve_refund'), export: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.reports.export'), customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') },
    };
  }

  /** The reversal with its original tender, the ticket's other tenders, every refund on that tender, ledger links and the audit trail. */
  async detail(ctx: FinanceCtx, kind: string, id: string) {
    if ((kind !== 'refund' && kind !== 'void') || !isUuid(id)) throw new FinanceError('That reversal could not be found.', 'REVERSAL_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const r = (await sql<any>`select a.*, 0 as rank from (${this.base(ctx)}) a where a.kind = ${kind} and a.id = ${id}::uuid and ${this.scope(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That reversal could not be found.', 'REVERSAL_NOT_FOUND', 404);
    const reversal = this.row(ctx, r);
    const original = await this.tender(ctx, String(r.payment_id));
    const tenders = r.ticket_id ? (await sql<any>`select p.id, p.method, p.amount_cents, p.status, p.processor_transaction_id, p.created_at, p.card_brand, p.card_last4, p.gift_card_last4,
        (select coalesce(sum(x.amount_cents), 0) from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status in (${sql.join(RESERVING)})) as reserved_cents
      from payments p where p.tenant_id = ${T} and p.ticket_id = ${String(r.ticket_id)}::uuid and p.status in (${sql.join(CAPTURED)}) order by p.created_at, p.id`.execute(this.db)).rows : [];
    const refunds = (await sql<any>`select x.id, x.amount_cents, x.status, x.reason, x.processor_refund_id, x.created_at, x.settled_at, x.settled_by, x.review_reason, x.stranded_at, coalesce(u.full_name, u.email) as actor
      from payment_refunds x left join users u on u.id = x.created_by_user_id where x.tenant_id = ${T} and x.payment_id = ${String(r.payment_id)}::uuid order by x.created_at desc`.execute(this.db)).rows;
    const gift = r.reversal_payment_id ? (await sql<any>`select g.id, g.type, g.amount_cents, g.balance_after_cents, g.created_at, gc.card_number_last4 from gift_card_transactions g left join gift_cards gc on gc.id = g.gift_card_id and gc.tenant_id = g.tenant_id
      where g.tenant_id = ${T} and g.payment_id = ${String(r.reversal_payment_id)}::uuid order by g.created_at limit 3`.execute(this.db)).rows : [];
    const settlement = r.settlement_batch_id ? (await sql<any>`select s.id, s.settlement_id, s.status, s.settled_at, s.net_cents, s.refunds_cents from payment_settlements s where s.tenant_id = ${T} and s.id = ${String(r.settlement_batch_id)}::uuid`.execute(this.db)).rows[0] : null;
    const ids = [String(r.payment_id), String(r.id), ...(r.ticket_id ? [String(r.ticket_id)] : [])];
    const auditRows = (await sql<any>`select a.action_type, a.created_at, a.role, a.metadata_json, coalesce(u.full_name, u.email) as actor from audit_logs a left join users u on u.id = a.user_id
      where a.tenant_id = ${T} and a.entity_id in (${sql.join(ids)}) and (a.action_type like '%refund%' or a.action_type like '%void%') order by a.created_at desc limit 30`.execute(this.db)).rows;
    const fin = r.ticket_id ? (await sql<any>`select coalesce(t.subtotal_cents, 0) as subtotal_cents, coalesce(t.discount_cents, 0) as discount_cents, coalesce(t.tax_cents, 0) as tax_cents, coalesce(t.tip_cents, 0) as tip_cents, coalesce(t.total_cents, 0) as total_cents, t.status
      from tickets t where t.tenant_id = ${T} and t.id = ${String(r.ticket_id)}::uuid`.execute(this.db)).rows[0] : null;
    const tip = r.ticket_id ? (await sql<any>`select x.technician_id, x.tip_cents, tc.full_name from ticket_tip_allocations x left join technicians tc on tc.id = x.technician_id and tc.tenant_id = x.tenant_id where x.tenant_id = ${T} and x.ticket_id = ${String(r.ticket_id)}::uuid order by x.tip_cents desc`.execute(this.db)).rows : [];
    const loyalty = r.ticket_id ? (await sql<any>`select l.id, l.points, coalesce(l.reversed_points, 0) as reversed_points, l.source, l.created_at from loyalty_point_earnings l where l.tenant_id = ${T} and l.ticket_id = ${String(r.ticket_id)}::uuid order by l.created_at desc limit 10`.execute(this.db)).rows : [];
    return {
      reversal, original,
      tenders: tenders.map((p: any) => ({ id: String(p.id), method: methodKey(p.method), amountCents: N(p.amount_cents), status: String(p.status), reservedCents: N(p.reserved_cents), refundableCents: Math.max(0, N(p.amount_cents) - N(p.reserved_cents)), processorRef: p.processor_transaction_id ?? null,
        card: p.card_brand || p.card_last4 ? `${p.card_brand ?? ''} ••${p.card_last4 ?? '••'}`.trim() : null, giftCardLast4: p.gift_card_last4 ?? null, at: iso(p.created_at), isOriginal: String(p.id) === String(r.payment_id) })),
      refunds: refunds.map((x: any) => ({ id: String(x.id), amountCents: N(x.amount_cents), status: String(x.status), reason: x.reason ?? null, providerRef: x.processor_refund_id ?? null, at: iso(x.created_at), settledAt: iso(x.settled_at), settledBy: x.settled_by ?? null, reviewReason: x.review_reason ?? null, strandedAt: iso(x.stranded_at), actor: x.actor ?? null, isThis: String(x.id) === String(r.id) })),
      giftLedger: gift.map((g: any) => ({ id: String(g.id), type: String(g.type), amountCents: N(g.amount_cents), balanceAfterCents: g.balance_after_cents == null ? null : N(g.balance_after_cents), last4: g.card_number_last4 ?? null, at: iso(g.created_at) })),
      settlement: settlement ? { id: String(settlement.id), reference: settlement.settlement_id ?? null, status: String(settlement.status ?? ''), settledAt: iso(settlement.settled_at), netCents: N(settlement.net_cents), refundsCents: N(settlement.refunds_cents) } : null,
      financials: fin ? { subtotalCents: N(fin.subtotal_cents), discountCents: N(fin.discount_cents), taxCents: N(fin.tax_cents), tipCents: N(fin.tip_cents), totalCents: N(fin.total_cents), ticketStatus: String(fin.status ?? '') } : null,
      tipAllocations: tip.map((x: any) => ({ technicianId: String(x.technician_id), name: x.full_name ?? null, cents: N(x.tip_cents) })),
      loyalty: loyalty.map((l: any) => ({ id: String(l.id), points: N(l.points), reversedPoints: N(l.reversed_points), source: l.source ?? null, at: iso(l.created_at) })),
      audit: auditRows.map((a: any) => ({ action: String(a.action_type), at: iso(a.created_at), actor: a.actor ?? a.role ?? null, detail: a.metadata_json?.metadata ?? null })),
      permissions: { refund: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.refund'), void: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.void'), customer: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') },
    };
  }

  /** One captured tender with its refund position and what Checkout would allow (eligibility is explained, never guessed). */
  private async tender(ctx: FinanceCtx, paymentId: string) {
    const r = (await sql<any>`select p.id, p.ticket_id, p.method, p.amount_cents, coalesce(p.tip_cents, 0) as tip_cents, p.status, p.processor, p.processor_transaction_id, p.created_at, p.approved_at, p.card_brand, p.card_last4, p.gift_card_last4, p.payment_surface, p.settlement_batch_id, p.branch_id,
        (select coalesce(sum(x.amount_cents), 0) from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status = 'refunded') as refunded_cents,
        (select coalesce(sum(x.amount_cents), 0) from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status in ('reserved', 'pending', 'processing')) as pending_cents,
        (select count(*)::int from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status = 'processing') as processing_count,
        (select count(*)::int from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id) as refund_rows
      from payments p where p.tenant_id = ${ctx.tenantId} and p.id = ${paymentId}::uuid`.execute(this.db)).rows[0];
    return r ? this.tenderRow(ctx, r) : null;
  }
  private tenderRow(ctx: FinanceCtx, p: any) {
    const captured = (CAPTURED as readonly string[]).includes(String(p.status)); const refunded = N(p.refunded_cents), pending = N(p.pending_cents), amount = N(p.amount_cents);
    const refundable = captured ? Math.max(0, amount - refunded - pending) : 0;
    const settled = !!p.settlement_batch_id; const method = methodKey(p.method);
    const refundWhy = !captured ? 'not_captured' : N(p.processing_count) > 0 ? 'pending_verification' : refundable <= 0 ? 'nothing_left' : null;
    // Checkout's void refuses a tender with ANY refund row (its refundedTotalCents sums every row, a failed one included)
    const voidWhy = !captured ? 'not_captured' : method !== 'card' ? 'not_card' : refunded + pending > 0 || N(p.refund_rows) > 0 ? 'already_refunded' : settled ? 'settled' : null;   // a void cancels a card authorisation; cash / gift card are refunded
    return {
      id: String(p.id), ticketId: p.ticket_id ? String(p.ticket_id) : null, method, rawMethod: String(p.method ?? ''), amountCents: amount, tipCents: N(p.tip_cents), status: String(p.status), captured, processor: p.processor ?? null, processorRef: p.processor_transaction_id ?? null,
      card: p.card_brand || p.card_last4 ? `${p.card_brand ?? ''} ••${p.card_last4 ?? '••'}`.trim() : null, giftCardLast4: p.gift_card_last4 ?? null, channel: p.payment_surface ?? null, at: iso(p.created_at), approvedAt: iso(p.approved_at),
      refundedCents: refunded, pendingCents: pending, refundableCents: refundable, settlementId: p.settlement_batch_id ? String(p.settlement_batch_id) : null,
      eligibility: { refund: refundWhy === null && hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.refund'), refundWhy: refundWhy ?? (hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.refund') ? null : 'permission'),
        void: voidWhy === null && hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.void'), voidWhy: voidWhy ?? (hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.void') ? null : 'permission') },
    };
  }

  /** Find Original Payment (§6): captured tenders by customer / phone / email, ticket, payment id, processor reference, amount; each with its refund position. */
  async find(ctx: FinanceCtx, q: string, period: Period, limit = 30) {
    const query = q.trim().slice(0, 100);
    if (query.length < 2) throw new FinanceError('Enter at least two characters.', 'VALIDATION_FAILED', 400, { field: 'query' });
    const T = ctx.tenantId; const lower = query.toLowerCase(), d = digitsOf(query).replace(/^1(?=\d{10}$)/, ''); const tn = query.replace(/^#/, '').trim();
    const exact: RawBuilder<boolean>[] = []; const part: RawBuilder<boolean>[] = [];
    if (isUuid(query)) exact.push(sql<boolean>`(p.id = ${query}::uuid or p.ticket_id = ${query}::uuid or t.customer_id = ${query}::uuid)`);
    if (/^\d{1,8}$/.test(tn)) exact.push(sql<boolean>`t.ticket_number = ${tn}`);
    if (/^[A-Za-z0-9_-]{4,}$/.test(query)) exact.push(sql<boolean>`p.processor_transaction_id = ${query}`);
    const amt = /^\$?\d{1,6}(\.\d{1,2})?$/.test(query) ? moneyToCents(query) : null;
    if (amt != null && amt > 0) exact.push(sql<boolean>`p.amount_cents = ${amt}`);
    if (d.length >= 7) { const tail = d.slice(-10); exact.push(sql<boolean>`right(regexp_replace(coalesce(cx.normalized_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`); }
    if (query.includes('@')) exact.push(sql<boolean>`lower(coalesce(cx.email, '')) = ${lower}`);
    if (query.length >= 2 && !/^\d+$/.test(query)) { part.push(sql<boolean>`lower(coalesce(cx.full_name, '')) like ${likeOf(lower)}`); if (query.length >= 4) part.push(sql<boolean>`lower(coalesce(cx.email, '')) like ${likeOf(lower)}`); }
    if (/^\d{2,8}$/.test(tn)) part.push(sql<boolean>`t.ticket_number like ${tn + '%'}`);
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    const scope = ctx.branchId && isUuid(ctx.branchId) ? sql<boolean>`(p.branch_id = ${ctx.branchId}::uuid or p.branch_id is null)` : sql<boolean>`true`;
    const rows = (await sql<any>`select p.id, p.ticket_id, p.method, p.amount_cents, coalesce(p.tip_cents, 0) as tip_cents, p.status, p.processor, p.processor_transaction_id, p.created_at, p.approved_at, p.card_brand, p.card_last4, p.gift_card_last4, p.payment_surface, p.settlement_batch_id, p.branch_id,
        t.ticket_number, t.customer_id, t.status as ticket_status, cx.full_name as customer_name, cx.normalized_phone as customer_phone, b.name as branch_name,
        (select coalesce(sum(x.amount_cents), 0) from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status = 'refunded') as refunded_cents,
        (select coalesce(sum(x.amount_cents), 0) from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status in ('reserved', 'pending', 'processing')) as pending_cents,
        (select count(*)::int from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id and x.status = 'processing') as processing_count,
        (select count(*)::int from payment_refunds x where x.tenant_id = p.tenant_id and x.payment_id = p.id) as refund_rows,
        (case when ${ex} then 2 when ${pa} then 1 else 0 end) as rank
      from payments p left join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id left join customers cx on cx.id = t.customer_id and cx.tenant_id = p.tenant_id left join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
      where p.tenant_id = ${T} and ${scope} and p.status in (${sql.join(CAPTURED)}) and p.amount_cents > 0 and ${tsInPeriod(sql`p.created_at`, period)} and (${ex} or ${pa})
      order by rank desc, p.created_at desc, p.id desc limit ${Math.max(1, Math.min(100, limit))}`.execute(this.db)).rows;
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    return { query, period, items: rows.map((p: any) => ({ ...this.tenderRow(ctx, p), ticketNumber: p.ticket_number ?? null, ticketStatus: p.ticket_status ?? null, branch: p.branch_name ?? null, matchedBy: p.rank === 2 ? 'reference' : 'name',
      customer: p.customer_id ? { id: String(p.customer_id), name: p.customer_name ?? null, phone: canContact ? showPhone(p.customer_phone) : maskPhone(p.customer_phone) } : null })) };
  }

  /** The processors and registers that appear in the ledger (the filter lists). */
  async facets(ctx: FinanceCtx): Promise<{ processors: string[]; registers: { id: string; name: string }[] }> {
    const T = ctx.tenantId;
    const pr = (await sql<any>`select distinct lower(p.processor) as processor from payments p where p.tenant_id = ${T} and p.processor is not null and p.processor <> '' order by 1 limit 20`.execute(this.db)).rows;
    const st = (await sql<any>`select st.id, st.name from pos_stations st where st.tenant_id = ${T} and (${ctx.branchId && isUuid(ctx.branchId) ? sql`st.branch_id = ${ctx.branchId}::uuid` : sql`true`}) and st.retired_at is null order by st.name`.execute(this.db)).rows;
    return { processors: pr.map((r: any) => String(r.processor)), registers: st.map((r: any) => ({ id: String(r.id), name: String(r.name ?? '') })) };
  }

  /** CSV of every matching reversal (all pages); masked contact, no card data, no processor secrets; audited. */
  async exportCsv(ctx: FinanceCtx, f: RvFilters): Promise<string> {
    const w = this.where(ctx, f);
    const rows = (await sql<any>`select a.*, 0 as rank from (${this.base(ctx)}) a where ${w} order by a.requested_at desc, a.id desc limit 20000`.execute(this.db)).rows.map((r: any) => this.row({ ...ctx, permissions: ctx.permissions.filter((p) => p !== 'pos.customers.view') }, r));
    const sum = await this.summary(ctx, f);
    const doc = csvDocument('Refunds and voids', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'], ['Search', f.q || '—'], ['Type', f.type ?? 'all'], ['Status', f.state ?? 'all'], ['Basis', 'completed refunds + voided face values; pending and failed listed with their state'], ['Currency', 'USD'], ['Contact', 'masked']],
      ['Reversal', 'Type', 'Status', 'Requested', 'Completed', 'Ticket', 'Customer', 'Original amount', 'Reversed amount', 'Method', 'Processor', 'Provider reference', 'Reason', 'By', 'Register'],
      rows.map((x) => [x.id, x.type, x.state, x.requestedAt ?? '', x.completedAt ?? '', x.ticketNumber ?? '', x.customer?.name ?? '', usd(x.originalCents), usd(x.reversedCents), x.method, x.processor ?? '', x.providerRef ?? '', x.reason ?? '', x.actor ?? '', x.register ?? '']),
      [['Rows', String(rows.length)], ['Completed refunds (period)', usd(sum.kpis.refundedCents)], ['Voids (period)', usd(sum.kpis.voidedCents)], ['Total reversed (period)', usd(sum.kpis.totalReversedCents)]]);
    await audit(this.auditor, ctx, 'refunds_voids', 'refunds_voids_exported', 'payment_refund', null, { rows: rows.length, type: f.type ?? 'all', status: f.state ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`refunds & voids export audit failed: ${(e as Error).message}`));
    return doc;
  }
}
