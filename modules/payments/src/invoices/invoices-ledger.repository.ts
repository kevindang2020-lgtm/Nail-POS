// invoices-ledger.repository.ts — Invoices mandate (Oct 29 2026): the server side of POS Payments & Money → Invoices
// (/tenant/payments/invoices). Raw, parameterised SQL; the tenant is the session's and is written in every statement.
//
// ROOT CAUSES FIXED HERE (spec §15):
//   "Invalid Date"   until Oct 23 the repository sent `String(issue_date).slice(0, 10)` — node-postgres hands a DATE back as
//                    a JS Date, so the API answered "Wed Oct 28" and the POS built `new Date("Wed Oct 28T00:00:00")` →
//                    Invalid Date. Dates now leave the server ONLY as 'YYYY-MM-DD' (or null), and the POS formats them with
//                    one timezone-free helper that shows "Not set" for a missing value (never "Invalid Date").
//   "—" customer     the New Invoice form never sent a customer, so the invoices were genuinely unlinked. New invoices
//                    require a customer chosen from this salon's records; the bill-to snapshot (name / phone / email as
//                    they were) is stored with the invoice; an older unlinked invoice says "Unlinked customer" and a
//                    manager can link it (audited) — the system never guesses an identity from a name.
//   Mark Paid        was a status toggle with no money. Payment is now an immutable invoice_payments entry (amount ≤
//                    balance, idempotent), and the status follows the balance: partially_paid, then paid.
//
// DEFINITIONS (spec §10; INVOICE_DEFINITIONS in the handoff):
//   balance          total − Σ credit notes − (Σ posted invoice_payments − Σ refunds) (integer cents; migration 797)
//   Overdue          DERIVED: status sent / partially_paid, a due date before today (salon time) and a balance > 0.
//                    The list, the filter and the KPIs use this one definition; it is never stored.
//   Outstanding      Σ balance of issued, non-void invoices (sent / partially_paid) with a balance, in scope
//   Paid             cash collected = Σ invoice_payments by PAYMENT date in the period (+ the count of fully paid invoices)
//   Drafts / Total   counts in scope (Total includes void, shown separately)
//   scope            the selected period on the selected date basis (Issued by default) + search + amount range; the
//                    status filter narrows the list only, so the cards keep describing the whole period.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { logException } from '@aipowersalon/observability';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { assertTransition } from '@aipowersalon/database';
import { INVOICE } from '../payments-lifecycles';
import { normalizeLines, nextInvoiceNumber, type InvoiceLineInput } from './invoices.dto';
import {
  FinanceError, isUuid, N, iso, ymd, clampPage, resolvePeriod, salonTimeZone, tsInPeriod, dateInPeriod, searchText, digitsOf, likeOf, prefixOf,
  positiveCents, oneOf, isValidYmd, csvDocument, usd, audit, type AuditRecorder, type FinanceCtx, type Period, type PageReq,
} from '../finance-screens/finance-scope';

export const INVOICE_LIST_STATUSES = ['draft', 'sent', 'overdue', 'partially_paid', 'paid', 'credited', 'void'] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];
export const INVOICE_DATE_BASES = ['issued', 'due', 'created', 'paid'] as const;
export const INVOICE_SORTS = ['created_desc', 'created_asc', 'issue_desc', 'issue_asc', 'due_asc', 'due_desc', 'amount_desc', 'amount_asc', 'customer_asc'] as const;
export const PAYMENT_METHODS = ['cash', 'check', 'card_external', 'bank_transfer', 'other'] as const;
export const MAX_INVOICE_CENTS = 100_000_000;

export interface InvoiceFilters {
  period: Period; basis: (typeof INVOICE_DATE_BASES)[number]; q: string; status?: InvoiceListStatus; amountMin?: number; amountMax?: number;
  sort: (typeof INVOICE_SORTS)[number]; customerId?: string;
}
const phoneShown = (display: unknown, normalized: unknown): string | null => {
  const d = String(display ?? '').trim(); if (d) return d;
  const n = String(normalized ?? '').replace(/\D/g, '');
  if (n.length === 11 && n.startsWith('1')) return `(${n.slice(1, 4)}) ${n.slice(4, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return n || null;
};

/** an address shown in the attempt history: enough to recognise it, not to copy it */
export function maskDestination(channel: string, to: string): string {
  if (channel === 'email') { const [u, d] = to.split('@'); return d ? `${(u ?? '').slice(0, 2)}***@${d}` : '***'; }
  const digits = to.replace(/\D/g, ''); return digits.length >= 4 ? `•••-${digits.slice(-4)}` : '•••';
}

export class InvoicesLedgerRepository {
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null, private readonly messenger: TenantMessenger | null = null) {}
  private log = (ctx: FinanceCtx) => (e: unknown) => logException(e, { where: 'invoices-ledger.audit', tenantId: ctx.tenantId });

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'all', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): InvoiceFilters {
    const amt = (v: unknown, field: string) => {
      if (v == null || v === '') return undefined;
      const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > MAX_INVOICE_CENTS) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field });
      return n;
    };
    const amountMin = amt(q.amountMin, 'amountMin'), amountMax = amt(q.amountMax, 'amountMax');
    if (amountMin != null && amountMax != null && amountMin > amountMax) throw new FinanceError('The minimum amount must not be more than the maximum.', 'AMOUNT_RANGE_INVALID');
    const customerId = typeof q.customerId === 'string' && q.customerId ? q.customerId : undefined;
    if (customerId && !isUuid(customerId)) throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400, { field: 'customerId' });
    return {
      period, basis: oneOf(q.dateField, INVOICE_DATE_BASES, 'dateField') ?? 'issued', q: searchText(q.search), status: oneOf(q.status, INVOICE_LIST_STATUSES, 'status'),
      amountMin, amountMax, sort: oneOf(q.sort, INVOICE_SORTS, 'sort') ?? 'created_desc', customerId,
    };
  }

  /** Every invoice of the tenant with its payments, balance, derived display status and the customer as linked. */
  private base(ctx: FinanceCtx, tz: string) {
    const T = ctx.tenantId;
    return sql`with pay as (select ip.invoice_id, coalesce(sum(ip.amount_cents), 0)::bigint as paid, count(*)::int as n, max(ip.paid_on) as last_paid_on
          from invoice_payments ip where ip.tenant_id = ${T} group by ip.invoice_id),
      cr as (select ic.invoice_id, coalesce(sum(ic.credit_cents), 0)::bigint as credited, coalesce(sum(ic.refund_cents), 0)::bigint as refunded, count(*)::int as n
          from invoice_credits ic where ic.tenant_id = ${T} group by ic.invoice_id),
      ib as (
        select i.id, i.invoice_number, i.status, i.issue_date, i.due_date, to_char(i.issue_date, 'YYYY-MM-DD') as issue_ymd, to_char(i.due_date, 'YYYY-MM-DD') as due_ymd, i.subtotal_cents, i.tax_cents, i.discount_cents, i.total_cents, i.notes, i.created_at, i.updated_at,
               i.sent_at, i.paid_at, i.voided_at, i.void_reason, i.customer_id, i.bill_to_name, i.bill_to_phone, i.bill_to_phone_digits, i.bill_to_email, i.created_by_user_id,
               c.id as linked_customer_id, c.full_name as customer_name, c.phone_display as customer_phone_display, c.normalized_phone as customer_phone, c.email as customer_email,
               c.archived_at as customer_archived_at,
               coalesce(pay.paid, 0)::bigint as paid_cents, coalesce(pay.n, 0)::int as payments_n, pay.last_paid_on,
               coalesce(cr.credited, 0)::bigint as credited_cents, coalesce(cr.refunded, 0)::bigint as refunded_cents, coalesce(cr.n, 0)::int as credits_n,
               (i.total_cents - coalesce(cr.credited, 0) - (coalesce(pay.paid, 0) - coalesce(cr.refunded, 0)))::bigint as balance_cents,
               case when i.status in ('sent', 'partially_paid') and i.due_date is not null and i.due_date < (now() at time zone ${tz})::date
                         and i.total_cents - coalesce(cr.credited, 0) - (coalesce(pay.paid, 0) - coalesce(cr.refunded, 0)) > 0 then 'overdue' else i.status end as display_status,
               coalesce(c.full_name, i.bill_to_name, '') as sort_name
        from invoices i
        left join customers c on c.id = i.customer_id and c.tenant_id = i.tenant_id
        left join pay on pay.invoice_id = i.id
        left join cr on cr.invoice_id = i.id
        where i.tenant_id = ${T})`;
  }
  private search(raw: string): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    if (!raw) return { where: sql<boolean>`true`, rank: sql<number>`0` };
    const lower = raw.toLowerCase(), upper = raw.toUpperCase().replace(/\s+/g, ''), digits = digitsOf(raw), hasLetters = /[a-z]/i.test(raw);
    // an all-digit query shorter than a phone number is an invoice-number fragment ("0002" → INV-0002), never a phone match
    const numberish = /^(inv-?)?\d{1,6}$/i.test(raw.trim());
    const asNumber = numberish ? `INV-${digits.padStart(4, '0')}` : upper;
    const numExact = sql<boolean>`(upper(ib.invoice_number) = ${upper} or upper(ib.invoice_number) = ${asNumber})`;
    const numPartial = sql<boolean>`upper(ib.invoice_number) like ${likeOf(numberish ? digits : upper)}`;
    const conds: RawBuilder<boolean>[] = [numExact, numPartial];
    let exactContact: RawBuilder<boolean> = sql<boolean>`false`, exactName: RawBuilder<boolean> = sql<boolean>`false`;
    if (!hasLetters && digits.length >= 7) {
      const phoneLike = sql<boolean>`(coalesce(ib.bill_to_phone_digits, '') like ${likeOf(digits)} or regexp_replace(coalesce(ib.customer_phone, ''), '\\D', '', 'g') like ${likeOf(digits)})`;
      conds.push(phoneLike);
      // exact = the same number once the country code is set aside (8565551234 ≡ +1 856 555 1234)
      const tail = digits.length > 10 ? digits.slice(-10) : digits;
      exactContact = sql<boolean>`(right(coalesce(ib.bill_to_phone_digits, ''), ${tail.length}) = ${tail} or right(regexp_replace(coalesce(ib.customer_phone, ''), '\\D', '', 'g'), ${tail.length}) = ${tail})`;
    }
    if (raw.includes('@')) {
      conds.push(sql<boolean>`(lower(coalesce(ib.bill_to_email, '')) like ${likeOf(lower)} or lower(coalesce(ib.customer_email, '')) like ${likeOf(lower)})`);
      exactContact = sql<boolean>`(lower(coalesce(ib.bill_to_email, '')) = ${lower} or lower(coalesce(ib.customer_email, '')) = ${lower})`;
    } else if (hasLetters && raw.length >= 2) {
      conds.push(sql<boolean>`(coalesce(ib.bill_to_name, '') ilike ${likeOf(raw)} or coalesce(ib.customer_name, '') ilike ${likeOf(raw)})`);
      exactName = sql<boolean>`(lower(coalesce(ib.bill_to_name, '')) = ${lower} or lower(coalesce(ib.customer_name, '')) = ${lower})`;
    }
    void prefixOf;
    return { where: sql<boolean>`(${sql.join(conds, sql` or `)})`, rank: sql<number>`case when ${numExact} then 0 when ${exactContact} then 1 when ${exactName} then 2 else 3 end` };
  }
  private where(f: InvoiceFilters, opts: { withStatus: boolean }) {
    const p = f.period;
    const date = f.basis === 'due' ? dateInPeriod(sql`ib.due_date`, p) : f.basis === 'created' ? tsInPeriod(sql`ib.created_at`, p)
      : f.basis === 'paid' ? tsInPeriod(sql`ib.paid_at`, p) : dateInPeriod(sql`ib.issue_date`, p);
    const s = this.search(f.q);
    const parts: RawBuilder<boolean>[] = [date, s.where];
    if (opts.withStatus && f.status) parts.push(sql<boolean>`ib.display_status = ${f.status}`);
    if (f.amountMin != null) parts.push(sql<boolean>`ib.total_cents >= ${f.amountMin}`);
    if (f.amountMax != null) parts.push(sql<boolean>`ib.total_cents <= ${f.amountMax}`);
    if (f.customerId) parts.push(sql<boolean>`ib.customer_id = ${f.customerId}::uuid`);
    return { where: sql<boolean>`${sql.join(parts, sql` and `)}`, rank: s.rank };
  }
  private order(f: InvoiceFilters) {
    return {
      created_desc: sql`ib.created_at desc, ib.id desc`, created_asc: sql`ib.created_at asc, ib.id asc`, issue_desc: sql`ib.issue_date desc, ib.created_at desc, ib.id desc`,
      issue_asc: sql`ib.issue_date asc, ib.created_at asc, ib.id asc`, due_asc: sql`ib.due_date asc nulls last, ib.id desc`, due_desc: sql`ib.due_date desc nulls last, ib.id desc`,
      amount_desc: sql`ib.total_cents desc, ib.id desc`, amount_asc: sql`ib.total_cents asc, ib.id desc`, customer_asc: sql`lower(ib.sort_name) asc, ib.created_at desc, ib.id desc`,
    }[f.sort];
  }
  row(r: any) {
    const linked = r.linked_customer_id != null;
    const customerState = linked ? (r.customer_archived_at ? 'archived' : 'linked') : r.customer_id ? 'missing' : r.bill_to_name ? 'snapshot_only' : 'unlinked';
    const status = String(r.status), display = String(r.display_status);
    const balance = N(r.balance_cents);
    return {
      id: String(r.id), invoiceNumber: String(r.invoice_number), status, displayStatus: display as InvoiceListStatus,
      issueDate: ymd(r.issue_ymd), dueDate: ymd(r.due_ymd), createdAt: iso(r.created_at), sentAt: iso(r.sent_at), paidAt: iso(r.paid_at), voidedAt: iso(r.voided_at), voidReason: r.void_reason ?? null,
      subtotalCents: N(r.subtotal_cents), discountCents: N(r.discount_cents), taxCents: N(r.tax_cents), totalCents: N(r.total_cents), paidCents: N(r.paid_cents), balanceCents: status === 'void' ? 0 : balance,
      creditedCents: N(r.credited_cents), refundedCents: N(r.refunded_cents), credits: N(r.credits_n),
      payments: N(r.payments_n),
      customer: {
        id: linked ? String(r.linked_customer_id) : null, state: customerState as 'linked' | 'archived' | 'missing' | 'snapshot_only' | 'unlinked',
        // the bill-to snapshot is what the invoice was issued to; the live profile name is shown beside it when they differ
        name: (r.bill_to_name ?? r.customer_name ?? null) as string | null, profileName: linked ? String(r.customer_name || '') : null,
        phone: r.bill_to_phone ?? phoneShown(r.customer_phone_display, r.customer_phone), email: r.bill_to_email ?? r.customer_email ?? null,
      },
      notes: r.notes ?? null,
      actions: {
        edit: status === 'draft', send: status === 'draft', recordPayment: (status === 'sent' || status === 'partially_paid') && balance > 0,
        void: (status === 'draft' || status === 'sent') && N(r.payments_n) === 0 && N(r.credits_n) === 0, linkCustomer: !linked,
        // Invoices guide (Nov 4 2026) §13: an issued invoice (paid or not) is corrected with a credit note, never zeroed
        credit: (status === 'sent' || status === 'partially_paid' || status === 'paid') && N(r.total_cents) - N(r.credited_cents) > 0,
      },
    };
  }

  async list(ctx: FinanceCtx, f: InvoiceFilters, pr: PageReq) {
    const tz = f.period.tz; const w = this.where(f, { withStatus: true });
    const total = N((await sql<any>`${this.base(ctx, tz)} select count(*)::int as n from ib where ${w.where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`${this.base(ctx, tz)} select ib.* from ib where ${w.where} order by ${f.q ? sql`${w.rank} asc, ${this.order(f)}` : this.order(f)} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(r)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  async summary(ctx: FinanceCtx, f: InvoiceFilters) {
    const T = ctx.tenantId, tz = f.period.tz; const w = this.where(f, { withStatus: false });
    const k = (await sql<any>`${this.base(ctx, tz)} select count(*)::int as total, count(*) filter (where ib.status = 'void')::int as void_n,
        count(*) filter (where ib.status = 'draft')::int as drafts, coalesce(sum(ib.total_cents) filter (where ib.status = 'draft'), 0)::bigint as draft_cents,
        count(*) filter (where ib.status in ('sent', 'partially_paid') and ib.balance_cents > 0)::int as outstanding_n,
        coalesce(sum(ib.balance_cents) filter (where ib.status in ('sent', 'partially_paid') and ib.balance_cents > 0), 0)::bigint as outstanding,
        count(*) filter (where ib.display_status = 'overdue')::int as overdue_n, coalesce(sum(ib.balance_cents) filter (where ib.display_status = 'overdue'), 0)::bigint as overdue_cents,
        count(*) filter (where ib.status = 'paid')::int as paid_n, count(*) filter (where ib.status = 'partially_paid')::int as partial_n,
        count(*) filter (where ib.display_status = 'sent')::int as sent_n, count(*) filter (where ib.status = 'credited')::int as credited_n
      from ib where ${w.where}`.execute(this.db)).rows[0] || {};
    // cash collected is by PAYMENT date (whatever the list's date basis) — the card says so
    // Invoices guide audit (Nov 4 2026): with a search or amount filter on, the Paid card counts the payments of the MATCHING invoices
    // (any issue date) — it used to count every payment of the period while the scope line said "period and filters"
    const filtersOn = !!(f.q || f.amountMin != null || f.amountMax != null);
    const fw = filtersOn ? this.where({ ...f, period: { ...f.period, from: null, to: null } } as InvoiceFilters, { withStatus: false }) : null;
    const cash = (await sql<any>`${fw ? sql`${this.base(ctx, tz)} ` : sql``}select coalesce(sum(ip.amount_cents), 0)::bigint as cents, count(*)::int as n from invoice_payments ip
      where ip.tenant_id = ${T} and ${dateInPeriod(sql`ip.paid_on`, f.period)} ${fw ? sql`and ip.invoice_id in (select ib.id from ib where ${fw.where})` : sql``}`.execute(this.db)).rows[0] || {};
    // money handed back on credit notes leaves the collected figure on the day it was refunded; credits issued are shown beside it
    const back = (await sql<any>`${fw ? sql`${this.base(ctx, tz)} ` : sql``}select coalesce(sum(ic.refund_cents), 0)::bigint as refunded, coalesce(sum(ic.credit_cents), 0)::bigint as credited, count(*)::int as n from invoice_credits ic
      where ic.tenant_id = ${T} and ${dateInPeriod(sql`ic.issued_on`, f.period)} ${fw ? sql`and ic.invoice_id in (select ib.id from ib where ${fw.where})` : sql``}`.execute(this.db)).rows[0] || {};
    return {
      period: f.period, dateBasis: f.basis, scope: f.q || f.amountMin != null || f.amountMax != null ? 'period_and_filters' : 'period',
      kpis: {
        outstandingCents: N(k.outstanding), outstandingInvoices: N(k.outstanding_n), overdueInvoices: N(k.overdue_n), overdueCents: N(k.overdue_cents),
        cashCollectedCents: N(cash.cents) - N(back.refunded), grossCollectedCents: N(cash.cents), refundedCents: N(back.refunded), creditedCents: N(back.credited), creditNotes: N(back.n), creditedInvoices: N(k.credited_n), paymentsRecorded: N(cash.n), paidInvoices: N(k.paid_n), partiallyPaidInvoices: N(k.partial_n),
        drafts: N(k.drafts), draftCents: N(k.draft_cents), total: N(k.total), voided: N(k.void_n), sent: N(k.sent_n),
      },
      dataAsOf: new Date().toISOString(),
    };
  }

  async detail(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) return null;
    const tz = await salonTimeZone(this.db, ctx.tenantId);
    const r = (await sql<any>`${this.base(ctx, tz)} select ib.* from ib where ib.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) return null;
    const T = ctx.tenantId;
    const lines = (await sql<any>`select id, description, quantity, unit_price_cents, line_total_cents, position from invoice_lines where tenant_id = ${T} and invoice_id = ${id}::uuid order by position asc, id asc`.execute(this.db)).rows;
    const payments = (await sql<any>`select ip.id, ip.amount_cents, to_char(ip.paid_on, 'YYYY-MM-DD') as paid_on, ip.method, ip.reference, ip.note, ip.created_at, coalesce(u.full_name, u.email) as recorded_by
      from invoice_payments ip left join users u on u.id = ip.recorded_by_user_id and u.tenant_id = ip.tenant_id where ip.tenant_id = ${T} and ip.invoice_id = ${id}::uuid order by ip.created_at asc, ip.id asc`.execute(this.db)).rows;
    const credits = (await sql<any>`select ic.id, ic.credit_number, ic.credit_cents, ic.refund_cents, ic.refund_method, ic.refund_reference, ic.reason, to_char(ic.issued_on, 'YYYY-MM-DD') as issued_on, ic.created_at, coalesce(u.full_name, u.email) as issued_by
      from invoice_credits ic left join users u on u.id = ic.created_by and u.tenant_id = ic.tenant_id where ic.tenant_id = ${T} and ic.invoice_id = ${id}::uuid order by ic.created_at asc, ic.id asc`.execute(this.db)).rows;
    return {
      invoice: this.row(r),
      credits: credits.map((c: any) => ({ id: String(c.id), creditNumber: String(c.credit_number), creditCents: N(c.credit_cents), refundCents: N(c.refund_cents), refundMethod: c.refund_method ?? null, refundReference: c.refund_reference ?? null,
        reason: String(c.reason), issuedOn: ymd(c.issued_on), createdAt: iso(c.created_at), issuedBy: c.issued_by ?? null })),
      lines: lines.map((l: any) => ({ id: String(l.id), description: String(l.description), quantity: N(l.quantity), unitPriceCents: N(l.unit_price_cents), lineTotalCents: N(l.line_total_cents), position: N(l.position) })),
      payments: payments.map((p: any) => ({ id: String(p.id), amountCents: N(p.amount_cents), paidOn: ymd(p.paid_on), method: String(p.method), reference: p.reference ?? null, note: p.note ?? null, createdAt: iso(p.created_at), recordedBy: p.recorded_by ?? null })),
      delivery: await this.deliveryState(ctx, id, r),
    };
  }

  // ── Delivery (Invoices guide Nov 4 2026 §14): the salon's configured sender; submitted ≠ delivered ──
  private deliveryChannels() {
    return { email: this.messenger?.sendEmail ? 'available' as const : 'not_connected' as const, sms: this.messenger ? 'available' as const : 'not_connected' as const };
  }
  private async deliveryState(ctx: FinanceCtx, id: string, r: any) {
    const ch = this.deliveryChannels();
    const attempts = (await sql<any>`select d.id, d.channel, d.destination, d.status, d.reason, d.created_at, n.status as notif_status, n.delivered_at, n.provider_error_code
        from invoice_deliveries d left join notifications n on n.id = d.notification_id and n.tenant_id = d.tenant_id
        where d.tenant_id = ${ctx.tenantId} and d.invoice_id = ${id}::uuid order by d.created_at desc, d.id desc limit 20`.execute(this.db)).rows;
    const issued = ['sent', 'partially_paid', 'paid'].includes(String(r.status));
    const email = r.bill_to_email ?? null, phone = r.bill_to_phone_digits ?? null;
    const note = ch.email === 'not_connected' && ch.sms === 'not_connected' ? 'Invoice delivery to customers is not connected. Sending marks the invoice issued; share the PDF with the customer.' : '';
    return {
      email: ch.email, sms: ch.sms, note,
      canSend: { email: issued && ch.email === 'available' && !!email, sms: issued && ch.sms === 'available' && !!phone },
      destination: { email, phone: r.bill_to_phone ?? null },
      attempts: attempts.map((a: any) => ({ id: String(a.id), channel: String(a.channel), destination: maskDestination(String(a.channel), String(a.destination)), createdAt: iso(a.created_at), reason: a.reason ?? null,
        // what the provider confirmed, never more: delivered only when the ledger row says so
        status: a.notif_status === 'delivered' ? 'delivered' : a.notif_status === 'failed' && a.status === 'submitted' ? 'undelivered' : String(a.status), deliveredAt: iso(a.delivered_at) })),
    };
  }
  /** Send an issued invoice to the bill-to email / phone. Claim-before-send on the request key (a retry sends nothing). */
  async deliver(ctx: FinanceCtx, id: string, b: Record<string, unknown>) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const key = String(b.idempotencyKey ?? '');
    if (!isUuid(key)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    const channel = oneOf(b.channel, ['email', 'sms'] as const, 'channel');
    if (!channel) throw new FinanceError('Choose email or text message.', 'VALIDATION_FAILED', 400, { field: 'channel' });
    const ch = this.deliveryChannels();
    if (ch[channel] !== 'available') throw new FinanceError(channel === 'email' ? 'Invoice email is not connected for this salon.' : 'Text messages are not connected for this salon.', 'INVOICE_DELIVERY_NOT_CONNECTED', 409, { channel });
    const T = ctx.tenantId; const actor = isUuid(ctx.userId) ? ctx.userId : null;
    const claim = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id, invoice_id, status from invoice_deliveries where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) { if (String(prior.invoice_id) !== id) throw new FinanceError('This request id was already used.', 'IDEMPOTENCY_KEY_REQUIRED'); return { duplicate: true as const }; }
      const inv = (await sql<any>`select id, status, invoice_number, customer_id, bill_to_name, bill_to_email, bill_to_phone_digits, total_cents, due_date, to_char(due_date, 'YYYY-MM-DD') as due_ymd from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!inv) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      if (!['sent', 'partially_paid', 'paid'].includes(String(inv.status))) throw new FinanceError(String(inv.status) === 'draft' ? 'Issue the invoice before sending it to the customer.' : 'This invoice cannot be sent.', 'INVOICE_NOT_DELIVERABLE', 409, { status: String(inv.status) });
      const to = channel === 'email' ? (inv.bill_to_email ? String(inv.bill_to_email).trim() : '') : (inv.bill_to_phone_digits ? '+' + (String(inv.bill_to_phone_digits).length === 10 ? '1' : '') + String(inv.bill_to_phone_digits) : '');
      if (!to) throw new FinanceError(channel === 'email' ? 'This invoice has no email address to send to.' : 'This invoice has no phone number to text.', 'INVOICE_DELIVERY_NO_DESTINATION', 409, { channel });
      const row = (await sql<any>`insert into invoice_deliveries (tenant_id, invoice_id, channel, destination, status, idempotency_key, created_by, updated_by)
        values (${T}, ${id}::uuid, ${channel}, ${to}, 'submitting', ${key}, ${actor}, ${actor}) returning id`.execute(trx)).rows[0];
      return { duplicate: false as const, deliveryId: String(row.id), to, inv };
    });
    if (claim.duplicate) return { duplicate: true, ...(await this.detail(ctx, id))! };
    const { inv, to, deliveryId } = claim;
    const balance = (await this.detail(ctx, id))!.invoice.balanceCents;
    const salon = await this.salonIdentity(ctx);
    // customer-facing text is English (guide §14 — no separate localisation decision exists)
    const dueText = inv.due_ymd ? `, due ${inv.due_ymd}` : '';
    const body = `Invoice ${inv.invoice_number} from ${salon.name}: total $${usd(N(inv.total_cents))}, balance due $${usd(balance)}${dueText}.${salon.phone ? ` Questions? Call ${salon.phone}.` : ''}`;
    let status: 'submitted' | 'simulated' | 'blocked' | 'failed'; let reason: string | null = null; let providerId: string | null = null; let notificationId: string | null = null;
    try {
      const res = channel === 'email'
        ? await this.messenger!.sendEmail!({ tenantId: T, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, to, subject: `Invoice ${inv.invoice_number} from ${salon.name}`, body, purpose: 'notification', category: 'manual', customerId: inv.customer_id ? String(inv.customer_id) : null, idempotencyKey: key })
        : await this.messenger!.sendSms({ tenantId: T, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, to, body, purpose: 'notification', customerId: inv.customer_id ? String(inv.customer_id) : null });
      status = res.sent ? (res.simulated ? 'simulated' : 'submitted') : res.status === 'blocked' ? 'blocked' : 'failed';
      reason = res.sent ? null : (res.reason ?? res.status); providerId = res.providerId ?? null; notificationId = res.notificationId && isUuid(res.notificationId) ? res.notificationId : null;
    } catch (e: any) { status = 'failed'; reason = String(e?.message ?? 'send_failed').slice(0, 200); logException(e, { where: 'invoices-ledger.deliver', tenantId: T }); }   // never retried here — it could double-send
    await sql`update invoice_deliveries set status = ${status}, reason = ${reason}, provider_id = ${providerId}, notification_id = ${notificationId}, updated_by = ${actor}, updated_at = now()
      where tenant_id = ${T} and id = ${deliveryId}::uuid and status = 'submitting'`.execute(this.db);
    await audit(this.auditor, ctx, 'payments', 'invoice_delivery_attempted', 'invoice', id, { deliveryId, channel, status, reason, destination: maskDestination(channel, to) }, this.log(ctx));
    return { duplicate: false, attempt: { id: deliveryId, channel, status, reason }, ...(await this.detail(ctx, id))! };
  }

  /** Customer lookup for New Invoice / Link Customer: this salon's live customers by name, phone or email. */
  async customerLookup(ctx: FinanceCtx, raw: unknown) {
    const q = searchText(raw); if (q.length < 2) return { items: [] };
    const T = ctx.tenantId, lower = q.toLowerCase(), digits = digitsOf(q), hasLetters = /[a-z]/i.test(q);
    const conds: RawBuilder<boolean>[] = [];
    if (hasLetters && !q.includes('@')) conds.push(sql<boolean>`c.full_name ilike ${likeOf(q)}`);
    if (q.includes('@')) conds.push(sql<boolean>`lower(coalesce(c.email, '')) like ${likeOf(lower)}`);
    if (!hasLetters && digits.length >= 4) conds.push(sql<boolean>`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${likeOf(digits)}`);
    if (!conds.length) return { items: [] };
    const rows = (await sql<any>`select c.id, c.full_name, c.phone_display, c.normalized_phone, c.email,
        (select count(*)::int from invoices i where i.tenant_id = ${T} and i.customer_id = c.id) as invoices
      from customers c where c.tenant_id = ${T} and c.archived_at is null and (${sql.join(conds, sql` or `)})
      order by (lower(c.full_name) = ${lower}) desc, lower(c.full_name) asc, c.id asc limit 8`.execute(this.db)).rows;
    return { items: rows.map((c: any) => ({ id: String(c.id), name: String(c.full_name || ''), phone: phoneShown(c.phone_display, c.normalized_phone), email: c.email ?? null, invoices: N(c.invoices) })) };
  }

  /** Invoices guide (Nov 4 2026) §11 line items: this salon's active services and retail products for New Invoice. The line
   *  keeps its own description and price (a snapshot) — a later catalog change never rewrites an issued invoice. */
  async catalogLookup(ctx: FinanceCtx, raw: unknown) {
    const q = searchText(raw); const T = ctx.tenantId;
    const like = q ? likeOf(q) : null;
    const services = (await sql<any>`select s.id, s.name, s.price_cents from services s where s.tenant_id = ${T} and s.status = 'active' and s.archived_at is null
        ${like ? sql`and s.name ilike ${like}` : sql``} order by lower(s.name), s.id limit 12`.execute(this.db)).rows;
    const products = (await sql<any>`select p.id, p.name, p.sku, p.retail_price_cents from inventory_products p where p.tenant_id = ${T} and p.active and p.is_retail and p.archived_at is null and p.retail_price_cents is not null
        ${like ? sql`and (p.name ilike ${like} or coalesce(p.sku, '') ilike ${like})` : sql``} order by lower(p.name), p.id limit 12`.execute(this.db)).rows;
    return { items: [
      ...services.map((r: any) => ({ kind: 'service' as const, id: String(r.id), name: String(r.name), unitPriceCents: N(r.price_cents), sku: null as string | null })),
      ...products.map((r: any) => ({ kind: 'product' as const, id: String(r.id), name: String(r.name), unitPriceCents: N(r.retail_price_cents), sku: r.sku ? String(r.sku) : null })),
    ] };
  }

  private async customerSnapshot(trx: Kysely<any>, ctx: FinanceCtx, customerId: string) {
    const c = (await sql<any>`select id, full_name, phone_display, normalized_phone, email from customers where tenant_id = ${ctx.tenantId} and id = ${customerId}::uuid and archived_at is null`.execute(trx)).rows[0];
    if (!c) throw new FinanceError('Choose a customer from this salon.', 'INVOICE_CUSTOMER_NOT_FOUND', 404);
    const phone = phoneShown(c.phone_display, c.normalized_phone);
    return { id: String(c.id), name: String(c.full_name || '').trim() || null, phone, phoneDigits: digitsOf(String(c.normalized_phone ?? phone ?? '')) || null, email: c.email ? String(c.email) : null };
  }
  private draftFields(b: Record<string, unknown>, today: string) {
    const lines = normalizeLines((Array.isArray(b.lines) ? b.lines : []) as InvoiceLineInput[]);
    if (!lines.length) throw new FinanceError('Add at least one line with a description and a quantity.', 'INVOICE_LINES_REQUIRED');
    for (const l of lines) if (l.quantity > 10_000 || l.unitPriceCents > MAX_INVOICE_CENTS) throw new FinanceError('A line amount is too large.', 'INVOICE_AMOUNT_INVALID');
    const issueDate = b.issueDate ? String(b.issueDate) : today;
    if (!isValidYmd(issueDate)) throw new FinanceError('Enter a valid issue date.', 'DATE_INVALID', 400, { field: 'issueDate' });
    const dueDate = b.dueDate ? String(b.dueDate) : null;
    if (dueDate != null && !isValidYmd(dueDate)) throw new FinanceError('Enter a valid due date.', 'DATE_INVALID', 400, { field: 'dueDate' });
    if (dueDate != null && dueDate < issueDate) throw new FinanceError('The due date must be on or after the issue date.', 'INVOICE_DATES_INVALID');
    const subtotal = lines.reduce((a, l) => a + l.lineTotalCents, 0);
    const tax = b.taxCents == null || b.taxCents === '' ? 0 : Math.round(Number(b.taxCents));
    const discount = b.discountCents == null || b.discountCents === '' ? 0 : Math.round(Number(b.discountCents));
    if (!Number.isFinite(tax) || tax < 0 || tax > MAX_INVOICE_CENTS) throw new FinanceError('Enter a valid tax amount.', 'INVOICE_AMOUNT_INVALID', 400, { field: 'taxCents' });
    if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) throw new FinanceError('The discount must be between $0.00 and the subtotal.', 'INVOICE_AMOUNT_INVALID', 400, { field: 'discountCents' });
    const total = subtotal - discount + tax;
    if (total <= 0) throw new FinanceError('The invoice total must be more than $0.00.', 'INVOICE_AMOUNT_INVALID');
    if (total > MAX_INVOICE_CENTS) throw new FinanceError('The invoice total is too large.', 'INVOICE_AMOUNT_INVALID');
    const notes = b.notes ? String(b.notes).trim().slice(0, 5000) : null;
    return { lines, issueDate, dueDate, subtotal, tax, discount, total, notes };
  }

  /** New Invoice: Save Draft or Send. Idempotent on the request key (a double tap creates one invoice). */
  async create(ctx: FinanceCtx, b: Record<string, unknown>) {
    const key = String(b.idempotencyKey ?? '');
    if (!isUuid(key)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    const customerId = String(b.customerId ?? '');
    if (!isUuid(customerId)) throw new FinanceError('Choose a customer from this salon.', 'INVOICE_CUSTOMER_NOT_FOUND', 404);
    const tz = await salonTimeZone(this.db, ctx.tenantId); const today = resolvePeriod({ preset: 'today' }, tz).today;
    const d = this.draftFields(b, today);
    const send = b.send === true;
    const T = ctx.tenantId;
    const out = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id from invoices where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) return { id: String(prior.id), duplicate: true };
      const c = await this.customerSnapshot(trx, ctx, customerId);
      // the number: one writer at a time per salon (advisory lock), then the next INV-#### — the unique index backs it
      await sql`select pg_advisory_xact_lock(hashtext(${'invoice_number:' + T}))`.execute(trx);
      const nums = (await sql<any>`select invoice_number from invoices where tenant_id = ${T} and invoice_number like 'INV-%'`.execute(trx)).rows.map((x: any) => String(x.invoice_number));
      const number = nextInvoiceNumber(nums);
      const status = send ? 'sent' : 'draft';
      if (send) assertTransition(INVOICE, 'draft', 'sent');
      const ins = (await sql<any>`insert into invoices (tenant_id, branch_id, customer_id, invoice_number, status, issue_date, due_date, subtotal_cents, tax_cents, discount_cents, total_cents, notes,
          created_by_user_id, bill_to_name, bill_to_phone, bill_to_phone_digits, bill_to_email, idempotency_key, sent_at)
        values (${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${c.id}::uuid, ${number}, ${status}, ${d.issueDate}::date, ${d.dueDate}::date, ${d.subtotal}, ${d.tax}, ${d.discount}, ${d.total}, ${d.notes},
          ${isUuid(ctx.userId) ? ctx.userId : null}, ${c.name}, ${c.phone}, ${c.phoneDigits}, ${c.email}, ${key}, ${send ? sql`now()` : null})
        returning id`.execute(trx)).rows[0];
      const id = String(ins.id);
      for (const l of d.lines) {
        await sql`insert into invoice_lines (invoice_id, tenant_id, description, quantity, unit_price_cents, line_total_cents, position)
          values (${id}::uuid, ${T}, ${l.description}, ${l.quantity}, ${l.unitPriceCents}, ${l.lineTotalCents}, ${l.position})`.execute(trx);
      }
      return { id, duplicate: false, number, status };
    });
    if (!out.duplicate) await audit(this.auditor, ctx, 'payments', send ? 'invoice_created_and_sent' : 'invoice_created', 'invoice', out.id, { invoiceNumber: out.number, totalCents: d.total, customerId }, this.log(ctx));
    return { duplicate: out.duplicate, ...(await this.detail(ctx, out.id))! };
  }

  /** Edit a DRAFT (an issued invoice is never rewritten — it is voided or credited). */
  async edit(ctx: FinanceCtx, id: string, b: Record<string, unknown>) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const tz = await salonTimeZone(this.db, ctx.tenantId); const today = resolvePeriod({ preset: 'today' }, tz).today;
    const d = this.draftFields(b, today);
    const T = ctx.tenantId;
    await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select id, status, customer_id from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!cur) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      if (String(cur.status) !== 'draft') throw new FinanceError('Only a draft can be edited. Void or credit an issued invoice instead.', 'INVOICE_NOT_EDITABLE', 409);
      const customerId = b.customerId ? String(b.customerId) : cur.customer_id ? String(cur.customer_id) : '';
      if (!isUuid(customerId)) throw new FinanceError('Choose a customer from this salon.', 'INVOICE_CUSTOMER_NOT_FOUND', 404);
      const c = await this.customerSnapshot(trx, ctx, customerId);
      await sql`update invoices set customer_id = ${c.id}::uuid, bill_to_name = ${c.name}, bill_to_phone = ${c.phone}, bill_to_phone_digits = ${c.phoneDigits}, bill_to_email = ${c.email},
          issue_date = ${d.issueDate}::date, due_date = ${d.dueDate}::date, subtotal_cents = ${d.subtotal}, tax_cents = ${d.tax}, discount_cents = ${d.discount}, total_cents = ${d.total}, notes = ${d.notes},
          updated_at = now(), updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}
        where tenant_id = ${T} and id = ${id}::uuid and status = 'draft'`.execute(trx);
      await sql`delete from invoice_lines where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx);
      for (const l of d.lines) {
        await sql`insert into invoice_lines (invoice_id, tenant_id, description, quantity, unit_price_cents, line_total_cents, position)
          values (${id}::uuid, ${T}, ${l.description}, ${l.quantity}, ${l.unitPriceCents}, ${l.lineTotalCents}, ${l.position})`.execute(trx);
      }
    });
    await audit(this.auditor, ctx, 'payments', 'invoice_edited', 'invoice', id, { totalCents: d.total, lines: d.lines.length }, this.log(ctx));
    return (await this.detail(ctx, id))!;
  }

  /** Send = issue: draft → sent. Delivery to the customer is not connected for invoices — the answer says so. */
  async send(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const moved = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select status, customer_id from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!cur) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      if (String(cur.status) === 'sent') return false;   // a second tap: already issued
      if (!cur.customer_id) throw new FinanceError('Link a customer before sending this invoice.', 'INVOICE_CUSTOMER_NOT_FOUND', 404);
      try { assertTransition(INVOICE, String(cur.status), 'sent'); } catch { throw new FinanceError('This invoice cannot be sent in its current state.', 'INVOICE_STATE_INVALID', 409, { status: cur.status }); }
      await sql`update invoices set status = 'sent', sent_at = now(), updated_at = now() where tenant_id = ${T} and id = ${id}::uuid and status = ${String(cur.status)}`.execute(trx);
      return true;
    });
    if (moved) await audit(this.auditor, ctx, 'payments', 'invoice_sent', 'invoice', id, { delivery: 'not_connected' }, this.log(ctx));
    return { ...(await this.detail(ctx, id))!, sent: moved };
  }

  /** Record Payment: an immutable entry (cash / check / external card / bank transfer) — NOT a card charge. */
  async recordPayment(ctx: FinanceCtx, id: string, b: Record<string, unknown>) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const key = String(b.idempotencyKey ?? '');
    if (!isUuid(key)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    const amount = positiveCents(b.amountCents, MAX_INVOICE_CENTS);
    if (amount == null) throw new FinanceError('Enter a payment amount greater than $0.00.', 'INVOICE_PAYMENT_INVALID', 400, { field: 'amountCents' });
    const method = oneOf(b.method, PAYMENT_METHODS, 'method');
    if (!method) throw new FinanceError('Choose how it was paid.', 'INVOICE_PAYMENT_INVALID', 400, { field: 'method' });
    const tz = await salonTimeZone(this.db, ctx.tenantId); const today = resolvePeriod({ preset: 'today' }, tz).today;
    const paidOn = String(b.paidOn ?? '');
    if (!isValidYmd(paidOn)) throw new FinanceError('Enter a valid payment date.', 'DATE_INVALID', 400, { field: 'paidOn' });
    if (paidOn > today) throw new FinanceError('The payment date cannot be in the future.', 'INVOICE_PAYMENT_INVALID', 400, { field: 'paidOn' });
    const reference = b.reference ? String(b.reference).trim().slice(0, 120) : null;
    const note = b.note ? String(b.note).trim().slice(0, 1000) : null;
    const T = ctx.tenantId;
    const out = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id, invoice_id from invoice_payments where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) { if (String(prior.invoice_id) !== id) throw new FinanceError('This request id was already used.', 'IDEMPOTENCY_KEY_REQUIRED'); return { duplicate: true, paymentId: String(prior.id), status: null as string | null, balance: null as number | null }; }
      const inv = (await sql<any>`select id, status, total_cents, issue_date from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!inv) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      const st = String(inv.status);
      if (st === 'draft') throw new FinanceError('Send the invoice before recording a payment.', 'INVOICE_NOT_PAYABLE', 409);
      if (st !== 'sent' && st !== 'partially_paid') throw new FinanceError('This invoice cannot be paid.', 'INVOICE_NOT_PAYABLE', 409, { status: st });
      const paid = N((await sql<any>`select coalesce(sum(amount_cents), 0)::bigint as p from invoice_payments where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0]?.p);
      const cr = (await sql<any>`select coalesce(sum(credit_cents), 0)::bigint as c, coalesce(sum(refund_cents), 0)::bigint as r from invoice_credits where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0] || {};
      const balance = N(inv.total_cents) - N(cr.c) - (paid - N(cr.r));   // a credit note lowers what is owed (migration 797)
      if (amount > balance) throw new FinanceError('That is more than the balance due.', 'INVOICE_PAYMENT_EXCEEDS_BALANCE', 409, { balanceCents: balance });
      const pay = (await sql<any>`insert into invoice_payments (tenant_id, invoice_id, amount_cents, currency, paid_on, method, reference, note, idempotency_key, recorded_by_user_id)
        values (${T}, ${id}::uuid, ${amount}, 'USD', ${paidOn}::date, ${method}, ${reference}, ${note}, ${key}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0];
      const after = balance - amount;
      const next = after === 0 ? 'paid' : 'partially_paid';
      assertTransition(INVOICE, st, next);
      await sql`update invoices set status = ${next}, paid_at = ${next === 'paid' ? sql`now()` : sql`paid_at`}, updated_at = now() where tenant_id = ${T} and id = ${id}::uuid and status = ${st}`.execute(trx);
      return { duplicate: false, paymentId: String(pay.id), status: next, balance: after };
    });
    if (!out.duplicate) await audit(this.auditor, ctx, 'payments', 'invoice_payment_recorded', 'invoice', id, { paymentId: out.paymentId, amountCents: amount, method, paidOn, statusAfter: out.status }, this.log(ctx));
    return { duplicate: out.duplicate, paymentId: out.paymentId, ...(await this.detail(ctx, id))! };
  }

  /** Credit note (Invoices guide Nov 4 2026 §13): lowers what an issued invoice asks for. Up to the balance it simply
   *  reduces the balance; beyond it the customer has overpaid, so that part is returned as a recorded refund (method
   *  required) in the same immutable entry. Idempotent on the request key; the invoice row is locked; audited. */
  async issueCredit(ctx: FinanceCtx, id: string, b: Record<string, unknown>) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const key = String(b.idempotencyKey ?? '');
    if (!isUuid(key)) throw new FinanceError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    const amount = positiveCents(b.amountCents, MAX_INVOICE_CENTS);
    if (amount == null) throw new FinanceError('Enter a credit amount greater than $0.00.', 'INVOICE_CREDIT_INVALID', 400, { field: 'amountCents' });
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new FinanceError('Give a reason for the credit.', 'INVOICE_CREDIT_REASON_REQUIRED', 400, { field: 'reason' });
    const refundMethod = b.refundMethod == null || b.refundMethod === '' ? null : oneOf(b.refundMethod, PAYMENT_METHODS, 'refundMethod') ?? null;
    const refundReference = b.refundReference ? String(b.refundReference).trim().slice(0, 120) : null;
    const tz = await salonTimeZone(this.db, ctx.tenantId); const today = resolvePeriod({ preset: 'today' }, tz).today;
    const T = ctx.tenantId;
    const out = await this.db.transaction().execute(async (trx) => {
      const prior = (await sql<any>`select id, invoice_id, credit_number from invoice_credits where tenant_id = ${T} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) { if (String(prior.invoice_id) !== id) throw new FinanceError('This request id was already used.', 'IDEMPOTENCY_KEY_REQUIRED'); return { duplicate: true, creditId: String(prior.id), number: String(prior.credit_number), refund: 0, from: '', to: '' }; }
      const inv = (await sql<any>`select id, status, total_cents, invoice_number from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!inv) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      const st = String(inv.status);
      if (st !== 'sent' && st !== 'partially_paid' && st !== 'paid') throw new FinanceError(st === 'draft' ? 'A draft is edited or voided, not credited.' : 'This invoice cannot be credited.', 'INVOICE_NOT_CREDITABLE', 409, { status: st });
      const paid = N((await sql<any>`select coalesce(sum(amount_cents), 0)::bigint as p from invoice_payments where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0]?.p);
      const prev = (await sql<any>`select coalesce(sum(credit_cents), 0)::bigint as c, coalesce(sum(refund_cents), 0)::bigint as r from invoice_credits where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0] || {};
      const total = N(inv.total_cents), credited = N(prev.c), netPaid = paid - N(prev.r);
      const creditable = total - credited;
      if (amount > creditable) throw new FinanceError('That is more than is left to credit on this invoice.', 'INVOICE_CREDIT_EXCEEDS_TOTAL', 409, { creditableCents: creditable });
      const balance = creditable - netPaid;
      const refund = Math.max(0, amount - balance);
      if (refund > 0 && !refundMethod) throw new FinanceError('Part of this credit is money the customer already paid. Choose how it is refunded.', 'INVOICE_REFUND_METHOD_REQUIRED', 400, { refundCents: refund, field: 'refundMethod' });
      await sql`select pg_advisory_xact_lock(hashtext(${'invoice_credit_number:' + T}))`.execute(trx);
      const last = (await sql<any>`select max(substring(credit_number from 4)::int) as n from invoice_credits where tenant_id = ${T} and credit_number ~ '^CN-[0-9]+$'`.execute(trx)).rows[0]?.n;
      const number = `CN-${String(N(last) + 1).padStart(4, '0')}`;
      const row = (await sql<any>`insert into invoice_credits (tenant_id, invoice_id, credit_number, credit_cents, refund_cents, refund_method, refund_reference, reason, issued_on, idempotency_key, created_by)
        values (${T}, ${id}::uuid, ${number}, ${amount}, ${refund}, ${refund > 0 ? refundMethod : null}, ${refund > 0 ? refundReference : null}, ${reason.slice(0, 500)}, ${today}::date, ${key}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0];
      const leftTotal = creditable - amount, leftNetPaid = netPaid - refund, after = leftTotal - leftNetPaid;
      const next = leftTotal === 0 ? 'credited' : after === 0 ? 'paid' : leftNetPaid > 0 ? 'partially_paid' : 'sent';
      assertTransition(INVOICE, st, next);
      await sql`update invoices set status = ${next}, paid_at = ${next === 'paid' ? sql`coalesce(paid_at, now())` : sql`paid_at`}, updated_at = now() where tenant_id = ${T} and id = ${id}::uuid and status = ${st}`.execute(trx);
      return { duplicate: false, creditId: String(row.id), number, refund, from: st, to: next, invoiceNumber: String(inv.invoice_number) };
    });
    if (!out.duplicate) await audit(this.auditor, ctx, 'payments', 'invoice_credit_issued', 'invoice', id, { creditId: out.creditId, creditNumber: out.number, creditCents: amount, refundCents: out.refund, refundMethod: out.refund ? refundMethod : null, from: out.from, to: out.to, reason: reason.slice(0, 200) }, this.log(ctx));
    return { duplicate: out.duplicate, creditId: out.creditId, creditNumber: out.number, ...(await this.detail(ctx, id))! };
  }

  /** Void with a reason. An invoice with posted payments is NOT voided — it needs a refund / credit (spec §13). */
  async void(ctx: FinanceCtx, id: string, reason: unknown) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const why = String(reason ?? '').trim();
    if (why.length < 3) throw new FinanceError('Give a reason for voiding this invoice.', 'INVOICE_VOID_REASON_REQUIRED');
    const T = ctx.tenantId;
    const prev = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select status, invoice_number from invoices where tenant_id = ${T} and id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!cur) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      const st = String(cur.status);
      if (st === 'void') return null;
      const n = N((await sql<any>`select count(*)::int as n from invoice_payments where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0]?.n);
      if (n > 0 || st === 'paid' || st === 'partially_paid') throw new FinanceError('This invoice has payments. Issue a refund or a credit instead of voiding it.', 'INVOICE_HAS_PAYMENTS', 409);
      const nc = N((await sql<any>`select count(*)::int as n from invoice_credits where tenant_id = ${T} and invoice_id = ${id}::uuid`.execute(trx)).rows[0]?.n);
      if (nc > 0 || st === 'credited') throw new FinanceError('This invoice has a credit note. Credit the rest instead of voiding it.', 'INVOICE_HAS_CREDITS', 409);
      try { assertTransition(INVOICE, st, 'void'); } catch { throw new FinanceError('This invoice cannot be voided in its current state.', 'INVOICE_STATE_INVALID', 409, { status: st }); }
      await sql`update invoices set status = 'void', voided_at = now(), voided_by_user_id = ${isUuid(ctx.userId) ? ctx.userId : null}, void_reason = ${why.slice(0, 500)}, updated_at = now()
        where tenant_id = ${T} and id = ${id}::uuid and status = ${st}`.execute(trx);
      return { from: st, number: String(cur.invoice_number) };
    });
    if (prev) await audit(this.auditor, ctx, 'payments', 'invoice_voided', 'invoice', id, { from: prev.from, invoiceNumber: prev.number, reason: why.slice(0, 200) }, this.log(ctx));
    return (await this.detail(ctx, id))!;
  }

  /** Repair an unlinked invoice: link it to a chosen customer of this salon (audited). The snapshot is filled only if empty
   *  unless the manager asks to update it — an issued invoice keeps the name it was issued to. */
  async linkCustomer(ctx: FinanceCtx, id: string, b: { customerId?: unknown; updateBillTo?: unknown }) {
    if (!isUuid(id)) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
    const customerId = String(b.customerId ?? '');
    if (!isUuid(customerId)) throw new FinanceError('Choose a customer from this salon.', 'INVOICE_CUSTOMER_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const prev = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select i.customer_id, i.bill_to_name, (select count(*)::int from customers c where c.tenant_id = i.tenant_id and c.id = i.customer_id) as live
        from invoices i where i.tenant_id = ${T} and i.id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (!cur) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      if (cur.customer_id && N(cur.live) > 0) throw new FinanceError('This invoice is already linked to a customer.', 'INVOICE_ALREADY_LINKED', 409);
      const c = await this.customerSnapshot(trx, ctx, customerId);
      const fill = b.updateBillTo === true || !cur.bill_to_name;
      await sql`update invoices set customer_id = ${c.id}::uuid,
          bill_to_name = ${fill ? c.name : sql`bill_to_name`}, bill_to_phone = ${fill ? c.phone : sql`bill_to_phone`}, bill_to_phone_digits = ${fill ? c.phoneDigits : sql`bill_to_phone_digits`}, bill_to_email = ${fill ? c.email : sql`bill_to_email`},
          updated_at = now() where tenant_id = ${T} and id = ${id}::uuid`.execute(trx);
      return { from: cur.customer_id ? String(cur.customer_id) : null, snapshotUpdated: fill };
    });
    await audit(this.auditor, ctx, 'payments', 'invoice_customer_linked', 'invoice', id, { customerId, previousCustomerId: prev.from, snapshotUpdated: prev.snapshotUpdated }, this.log(ctx));
    return (await this.detail(ctx, id))!;
  }

  /** The PDF (preview / print / download) carries the customer's name and contact — its generation is recorded. */
  async auditDocument(ctx: FinanceCtx, id: string, disposition: 'inline' | 'attachment') {
    await audit(this.auditor, ctx, 'payments', 'invoice_pdf_generated', 'invoice', id, { disposition }, this.log(ctx));
  }

  async salonIdentity(ctx: FinanceCtx) {
    const t = (await sql<any>`select coalesce(display_name, legal_name) as name from tenants where id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    const b = (await sql<any>`select name, address, city, state, zip, phone from branches where tenant_id = ${ctx.tenantId} and deleted_at is null
      ${isUuid(ctx.branchId) ? sql`order by (id = ${ctx.branchId}::uuid) desc, created_at asc` : sql`order by created_at asc`} limit 1`.execute(this.db)).rows[0];
    const addr = b ? [b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter(Boolean).join(' ').trim() : '';
    return { name: String(t?.name || b?.name || 'Salon'), address: addr || null, phone: b?.phone ?? null };
  }

  async exportCsv(ctx: FinanceCtx, f: InvoiceFilters): Promise<string> {
    const tz = f.period.tz; const w = this.where(f, { withStatus: true });
    const rows = (await sql<any>`${this.base(ctx, tz)} select ib.* from ib where ${w.where} order by ${this.order(f)} limit 20000`.execute(this.db)).rows.map((r: any) => this.row(r));
    const p = f.period;
    const doc = csvDocument('Invoices',
      [['Generated', new Date().toISOString()], ['Period', p.from && p.to ? `${p.from} to ${p.to} (${p.tz})` : 'All time'], ['Date basis', f.basis], ['Status', f.status ?? 'All'], ['Search', f.q ? 'yes' : '—'], ['Currency', 'USD (amounts in dollars)'],
       ['Definition', 'Balance = total − credit notes − (recorded payments − refunds). Overdue = issued, past its due date, with a balance.']],
      ['Invoice #', 'Customer', 'Issued', 'Due', 'Status', 'Total', 'Credited', 'Paid', 'Refunded', 'Balance'],
      rows.map((r) => [r.invoiceNumber, r.customer.name ?? 'Unlinked customer', r.issueDate ?? 'Not set', r.dueDate ?? 'Not set', r.displayStatus, usd(r.totalCents), usd(r.creditedCents), usd(r.paidCents), usd(r.refundedCents), usd(r.balanceCents)]),
      [['Invoices', String(rows.length)], ['Total', usd(rows.reduce((a, r) => a + r.totalCents, 0))], ['Balance due', usd(rows.reduce((a, r) => a + r.balanceCents, 0))]]);
    await audit(this.auditor, ctx, 'payments', 'invoices_exported', 'invoice_report', null, { rows: rows.length, from: p.from, to: p.to, status: f.status ?? null }, this.log(ctx));
    return doc;
  }
}
