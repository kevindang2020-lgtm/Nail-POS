// ai-billing-invoices.ts — Four-Module Completion Guide (Oct 30 2026) §11 / AI-01: invoice-backed AI charges, tax and
// proration. The PROVIDER invoice is authoritative; this file records what the provider said, never what we wish it said.
//
//   • ingest(event)    one provider invoice snapshot (webhook). Deduplicated on (provider, provider_event_id) in the
//                      append-only ai_billing_invoice_events; an OLDER snapshot (provider_updated_at) never overwrites a
//                      newer one; an identical snapshot is "unchanged". Retried / re-delivered webhooks change nothing.
//   • reconcile(...)   re-reads the provider through an injected READ-ONLY client (listInvoices) and records each invoice
//                      through the same path, with a visible ai_billing_reconciliation_runs row. There is no charge, refund
//                      or invoice-edit method on the client — this code cannot move money or modify live billing.
// Money: integer cents, signed lines (credits negative). Tax NULL means the provider gave no tax figure: it is shown as
// Pending (draft) / Unknown (finalized), never invented. Finalized ≠ paid: a finalized invoice may have $0 paid.
import { utcDate } from '@aipowersalon/date-time';
import { createHash } from 'crypto';
import { withCode } from '@aipowersalon/api-contracts';
import { sql, type Kysely } from 'kysely';
import { logException } from '@aipowersalon/observability';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_BILLING_RECONCILIATION_RUN } from '../ai-lifecycles';

export const INVOICE_STATUSES = ['draft', 'open', 'finalized', 'paid', 'void', 'uncollectible'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const LINE_KINDS = ['subscription', 'proration', 'usage', 'tax', 'discount', 'credit', 'other'] as const;
export type InvoiceLineKind = (typeof LINE_KINDS)[number];

export interface ProviderInvoiceLine {
  id: string; packageCode?: string | null; kind: InvoiceLineKind; description?: string | null; quantity?: number;
  amountCents: number; periodStart?: string | null; periodEnd?: string | null;
}
export interface ProviderInvoice {
  id: string; number?: string | null; status: InvoiceStatus; currency?: string | null;
  invoiceDate?: string | null; periodStart?: string | null; periodEnd?: string | null;
  subtotalCents?: number | null; taxCents?: number | null; discountCents?: number | null; creditCents?: number | null;
  totalCents?: number | null; amountPaidCents?: number | null; amountRefundedCents?: number | null; amountDueCents?: number | null;
  finalizedAt?: string | null; paidAt?: string | null; voidedAt?: string | null; reference?: string | null;
  /** the provider's own last-modified time of this invoice — orders snapshots (an older one never wins) */
  updatedAt: string;
  packageCode?: string | null;
  lines: ProviderInvoiceLine[];
}
export interface InvoiceEvent { provider: string; eventId: string; eventType: string; tenantId: string; invoice: ProviderInvoice }
export type IngestOutcome = 'created' | 'updated' | 'unchanged' | 'stale' | 'rejected' | 'duplicate';
export interface IngestResult { outcome: IngestOutcome; reason?: string; invoiceLinkId?: string | null }

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
const optInt = (v: unknown) => v == null || int(v);
const day = (v: string | null | undefined) => (v && DAY.test(v) ? v.slice(0, 10) : null);

/** Pure: is this snapshot something we can record faithfully? (We refuse rather than guess.) */
export function checkInvoice(inv: ProviderInvoice | null | undefined): string | null {
  if (!inv || typeof inv !== 'object') return 'not_an_invoice';
  if (!inv.id || String(inv.id).length > 200) return 'missing_invoice_id';
  if (!(INVOICE_STATUSES as readonly string[]).includes(String(inv.status))) return 'unknown_status';
  if (!inv.updatedAt || Number.isNaN(Date.parse(inv.updatedAt))) return 'missing_provider_updated_at';
  for (const k of ['subtotalCents', 'taxCents', 'discountCents', 'creditCents', 'totalCents', 'amountPaidCents', 'amountRefundedCents', 'amountDueCents'] as const) if (!optInt(inv[k])) return `non_integer_${k}`;
  if ((inv.discountCents ?? 0) < 0 || (inv.creditCents ?? 0) < 0 || (inv.amountPaidCents ?? 0) < 0 || (inv.amountRefundedCents ?? 0) < 0) return 'negative_amount';
  if (!Array.isArray(inv.lines)) return 'missing_lines';
  const ids = new Set<string>();
  for (const l of inv.lines) {
    if (!l?.id || ids.has(String(l.id))) return 'bad_line_id'; ids.add(String(l.id));
    if (!(LINE_KINDS as readonly string[]).includes(String(l.kind))) return 'unknown_line_kind';
    if (!int(l.amountCents)) return 'non_integer_line_amount';
  }
  return null;
}

export interface InvoiceFigures {
  subtotalCents: number | null; prorationCents: number; taxCents: number | null; discountCents: number; creditCents: number;
  totalCents: number | null; totalSource: 'provider' | 'computed' | 'unknown'; mismatch: boolean;
  amountPaidCents: number; amountRefundedCents: number; amountDueCents: number | null; finalized: boolean;
}
/** Pure: the figures of one snapshot. The provider's own subtotal / tax / total win; lines fill a gap only when the
 *  provider omitted it, and a disagreement between the provider's total and its own lines is flagged, not "fixed". */
export function invoiceFigures(inv: ProviderInvoice): InvoiceFigures {
  const sum = (k: InvoiceLineKind[]) => inv.lines.filter((l) => k.includes(l.kind)).reduce((a, l) => a + l.amountCents, 0);
  const has = (k: InvoiceLineKind) => inv.lines.some((l) => l.kind === k);
  const charges = inv.lines.length ? sum(['subscription', 'usage', 'other']) : null;
  const proration = sum(['proration']);
  const subtotal = charges ?? (inv.subtotalCents ?? null);
  const tax = inv.taxCents ?? (has('tax') ? sum(['tax']) : null);
  const discount = inv.discountCents ?? Math.abs(sum(['discount']));
  const credit = inv.creditCents ?? Math.abs(sum(['credit']));
  const computed = subtotal != null && tax != null ? subtotal + proration + tax - discount - credit : null;
  const total = inv.totalCents ?? computed;
  const paid = inv.amountPaidCents ?? 0; const refunded = inv.amountRefundedCents ?? 0;
  const finalized = inv.status !== 'draft' && inv.status !== 'void';
  const due = inv.status === 'void' ? 0 : inv.amountDueCents ?? (finalized && total != null ? Math.max(0, total - paid) : null);
  return { subtotalCents: subtotal, prorationCents: proration, taxCents: tax, discountCents: discount, creditCents: credit, totalCents: total,
    totalSource: inv.totalCents != null ? 'provider' : computed != null ? 'computed' : 'unknown', mismatch: inv.totalCents != null && computed != null && inv.totalCents !== computed,
    amountPaidCents: paid, amountRefundedCents: refunded, amountDueCents: due, finalized };
}
/** Pure: what the screen may say about tax. */
export function taxState(status: string, taxCents: number | null | undefined): 'provided' | 'pending' | 'unknown' {
  if (taxCents != null) return 'provided';
  return status === 'draft' ? 'pending' : 'unknown';
}
export function snapshotHash(inv: ProviderInvoice): string {
  const lines = [...inv.lines].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const { updatedAt: _u, ...rest } = inv;
  return createHash('sha256').update(JSON.stringify({ ...rest, lines })).digest('hex');
}

/** READ-ONLY provider port. Deliberately no charge / refund / finalize / void method. */
export interface AiInvoiceProviderClient {
  readonly provider: string;
  readonly configured: boolean;
  listInvoices(q: { tenantId: string }): Promise<ProviderInvoice[]>;
}
/** the reconciliation-run columns runOf reads — never the whole row (error_text / idempotency_key stay server-side) */
const RUN_COLS = sql`r.id, r.status, r.provider, r.invoices_seen, r.created_count, r.updated_count, r.unchanged_count, r.stale_count, r.rejected_count, r.error_code`;

export class InvoiceClientError extends Error { constructor(readonly code: 'provider_not_configured' | 'provider_error', message: string) { super(message); this.name = 'InvoiceClientError'; } }
/** The default in every environment until the owner connects a billing provider: a run is recorded as failed with
 *  `provider_not_configured` — visible, never a silent zero. */
export class UnconfiguredInvoiceClient implements AiInvoiceProviderClient {
  readonly provider = 'none'; readonly configured = false;
  async listInvoices(): Promise<ProviderInvoice[]> { throw withCode(new InvoiceClientError('provider_not_configured', 'No AI billing provider is connected for invoice reconciliation.'), 'AI_BILLING_PROVIDER_NOT_CONFIGURED'); }
}
/** Fixtures (tests / harness): invoices per tenant, returned as deep copies. */
export class FixtureInvoiceClient implements AiInvoiceProviderClient {
  readonly configured = true;
  constructor(public byTenant: Record<string, ProviderInvoice[]>, readonly provider = 'fixture') {}
  async listInvoices(q: { tenantId: string }): Promise<ProviderInvoice[]> { return JSON.parse(JSON.stringify(this.byTenant[q.tenantId] ?? [])); }
}

/** Stripe-shaped `invoice.*` webhook → InvoiceEvent (tenant / package from metadata). Not an invoice → null. */
export function mapStripeInvoiceEvent(raw: any): { ok: true; value: InvoiceEvent } | { ok: false; reason: string } | null {
  const o = raw?.data?.object;
  if (!raw || typeof raw.type !== 'string' || !raw.type.startsWith('invoice.') || o?.object !== 'invoice') return null;
  const tenantId = o?.metadata?.tenant_id; if (!tenantId) return { ok: false, reason: 'missing_tenant' };
  const d = (u: unknown) => (typeof u === 'number' ? utcDate(new Date(u * 1000)) : null);   // the provider's UTC billing dates
  const t = (u: unknown) => (typeof u === 'number' ? new Date(u * 1000).toISOString() : null);
  const st = String(o.status ?? '');
  const status: InvoiceStatus = st === 'open' ? 'open' : st === 'paid' ? 'paid' : st === 'void' ? 'void' : st === 'uncollectible' ? 'uncollectible' : 'draft';
  const lines: ProviderInvoiceLine[] = (o.lines?.data ?? []).map((l: any) => ({ id: String(l.id), packageCode: l.metadata?.package_code ?? o.metadata?.package_code ?? null,
    kind: l.proration ? 'proration' : 'subscription', description: l.description ?? null, quantity: Number(l.quantity ?? 1) || 1, amountCents: Number(l.amount ?? 0),
    periodStart: d(l.period?.start), periodEnd: d(l.period?.end) }));
  const discount = Array.isArray(o.total_discount_amounts) ? o.total_discount_amounts.reduce((a: number, x: any) => a + Number(x?.amount ?? 0), 0) : null;
  return { ok: true, value: { provider: 'stripe', eventId: String(raw.id ?? ''), eventType: raw.type, tenantId: String(tenantId), invoice: {
    id: String(o.id ?? ''), number: o.number ?? null, status, currency: o.currency ? String(o.currency).toUpperCase() : 'USD', invoiceDate: d(o.created),
    periodStart: d(o.period_start), periodEnd: d(o.period_end), subtotalCents: null, taxCents: typeof o.tax === 'number' ? o.tax : null,
    discountCents: discount, creditCents: null, totalCents: typeof o.total === 'number' ? o.total : null, amountPaidCents: Number(o.amount_paid ?? 0),
    amountRefundedCents: 0, amountDueCents: typeof o.amount_remaining === 'number' ? o.amount_remaining : null,
    finalizedAt: t(o.status_transitions?.finalized_at), paidAt: t(o.status_transitions?.paid_at), voidedAt: t(o.status_transitions?.voided_at),
    reference: o.number ?? null, updatedAt: t(raw.created) ?? new Date().toISOString(), packageCode: o.metadata?.package_code ?? null, lines } } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ReconcileResult {
  runId: string; duplicate: boolean; status: 'succeeded' | 'partial' | 'failed'; provider: string; seen: number;
  created: number; updated: number; unchanged: number; stale: number; rejected: number; errorCode: string | null;
}

export class AiInvoiceLedger {
  constructor(private readonly db: Kysely<any>) {}

  /** one provider invoice snapshot. Idempotent on (provider, eventId); ordered by the provider's updatedAt. */
  async ingest(ev: InvoiceEvent, opts: { source?: 'webhook' | 'reconciliation'; runId?: string | null } = {}): Promise<IngestResult> {
    const provider = String(ev?.provider ?? '').slice(0, 60); const eventId = String(ev?.eventId ?? '').slice(0, 300);
    if (!provider || !eventId) return { outcome: 'rejected', reason: 'missing_event_id' };
    const tenantId = UUID.test(String(ev?.tenantId ?? '')) ? String(ev.tenantId) : null;
    const inv = ev?.invoice;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'ai-inv:' + provider + ':' + String(inv?.id ?? eventId)}))`.execute(trx);
      // provider event ids are unique per provider; an event for an unknown / invalid tenant is still logged (rejected)
      const seen = tenantId ? (await sql<any>`select e.outcome from ai_billing_invoice_events e where e.tenant_id = ${tenantId} and e.provider = ${provider} and e.provider_event_id = ${eventId}`.execute(trx)).rows[0] : null;
      if (seen) return { outcome: 'duplicate' as const, reason: String(seen.outcome) };
      const log = (tenant: string | null, outcome: string, reason: string | null) => sql`insert into ai_billing_invoice_events (tenant_id, provider, provider_event_id, provider_invoice_id, event_type, outcome, reason, run_id)
        values (${tenant}, ${provider}, ${eventId}, ${inv?.id ? String(inv.id).slice(0, 200) : null}, ${String(ev.eventType ?? 'unknown').slice(0, 80)}, ${outcome}, ${reason}, ${opts.runId ?? null})
        on conflict (provider, provider_event_id) do nothing`.execute(trx);
      const bad = checkInvoice(inv);
      const tenantOk = tenantId ? (await sql<any>`select 1 from tenants t where t.id = ${tenantId}`.execute(trx)).rows.length > 0 : false;
      if (bad || !tenantOk) { const reason = bad ?? 'unknown_tenant'; await log(tenantOk ? tenantId : null, 'rejected', reason); return { outcome: 'rejected' as const, reason }; }
      const T = tenantId as string; const i = inv as ProviderInvoice; const f = invoiceFigures(i); const hash = snapshotHash(i);
      const codes = [...new Set(i.lines.map((l) => l.packageCode).filter((c): c is string => !!c))];
      const pkg = i.packageCode ?? (codes.length === 1 ? codes[0]! : null);
      const sub = pkg ? (await sql<any>`select s.id from tenant_ai_subscriptions s where s.tenant_id = ${T} and s.package_code = ${pkg}`.execute(trx)).rows[0] : null;
      const cur = (await sql<any>`select l.id, l.provider_updated_at, l.snapshot_hash from ai_billing_invoice_links l
        where l.tenant_id = ${T} and l.provider = ${provider} and l.provider_invoice_id = ${i.id} for update`.execute(trx)).rows[0];
      const source = opts.source ?? 'webhook';
      let outcome: IngestOutcome; let linkId: string;
      if (cur && new Date(i.updatedAt).getTime() < new Date(cur.provider_updated_at).getTime()) { outcome = 'stale'; linkId = String(cur.id); }
      else if (cur && cur.snapshot_hash === hash) { outcome = 'unchanged'; linkId = String(cur.id); }
      else {
        const vals = sql`${i.number ?? null}, ${pkg}, ${sub?.id ?? null}, ${i.status}, ${String(i.currency ?? 'USD').toUpperCase().slice(0, 3)}, ${day(i.invoiceDate)}::date, ${day(i.periodStart)}::date, ${day(i.periodEnd)}::date,
          ${f.subtotalCents}, ${f.taxCents}, ${f.discountCents}, ${f.creditCents}, ${f.prorationCents}, ${f.totalCents}, ${f.amountPaidCents}, ${f.amountRefundedCents}, ${f.amountDueCents},
          ${i.finalizedAt ?? null}::timestamptz, ${i.paidAt ?? null}::timestamptz, ${i.voidedAt ?? null}::timestamptz, ${i.reference ? String(i.reference).slice(0, 200) : null}, ${i.updatedAt}::timestamptz, ${hash}, ${source}, ${eventId}`;
        if (cur) {
          await sql`update ai_billing_invoice_links l set (invoice_number, package_code, subscription_id, status, currency, invoice_date, period_start, period_end, subtotal_cents, tax_cents, discount_cents,
              credit_cents, proration_cents, total_cents, amount_paid_cents, amount_refunded_cents, amount_due_cents, finalized_at, paid_at, voided_at, reference, provider_updated_at, snapshot_hash, source, last_event_id)
            = (${vals}), updated_at = now() where l.tenant_id = ${T} and l.id = ${cur.id}`.execute(trx);
          await sql`delete from ai_billing_invoice_line_snapshots s where s.tenant_id = ${T} and s.invoice_link_id = ${cur.id}`.execute(trx);
          outcome = 'updated'; linkId = String(cur.id);
        } else {
          const ins = await sql<any>`insert into ai_billing_invoice_links (tenant_id, provider, provider_invoice_id, invoice_number, package_code, subscription_id, status, currency, invoice_date, period_start, period_end,
              subtotal_cents, tax_cents, discount_cents, credit_cents, proration_cents, total_cents, amount_paid_cents, amount_refunded_cents, amount_due_cents, finalized_at, paid_at, voided_at, reference,
              provider_updated_at, snapshot_hash, source, last_event_id)
            values (${T}, ${provider}, ${i.id}, ${vals}) returning id`.execute(trx);
          outcome = 'created'; linkId = String(ins.rows[0].id);
        }
        for (const l of i.lines) {
          await sql`insert into ai_billing_invoice_line_snapshots (tenant_id, invoice_link_id, provider_line_id, package_code, kind, description, quantity, amount_cents, period_start, period_end)
            values (${T}, ${linkId}, ${String(l.id).slice(0, 200)}, ${l.packageCode ?? pkg}, ${l.kind}, ${l.description ? String(l.description).slice(0, 300) : null}, ${Math.trunc(Number(l.quantity ?? 1)) || 1}, ${l.amountCents},
              ${day(l.periodStart)}::date, ${day(l.periodEnd)}::date)`.execute(trx);
        }
      }
      await log(T, outcome, f.mismatch ? 'provider_total_differs_from_lines' : null);
      return { outcome, invoiceLinkId: linkId, ...(f.mismatch ? { reason: 'provider_total_differs_from_lines' } : {}) };
    });
  }

  /** Re-read the provider for one tenant (read-only client) and record every invoice. Idempotent on the run key. */
  async reconcile(tenantId: string, client: AiInvoiceProviderClient, o: { trigger: 'manual' | 'scheduled' | 'test'; actorUserId?: string | null; idempotencyKey?: string | null }): Promise<ReconcileResult> {
    const key = o.idempotencyKey ?? null;
    if (key) {
      const prior = (await sql<any>`select ${RUN_COLS} from ai_billing_reconciliation_runs r where r.tenant_id = ${tenantId} and r.idempotency_key = ${key}`.execute(this.db)).rows[0];
      if (prior) return { ...this.runOf(prior), duplicate: true };
    }
    const run = (await sql<any>`insert into ai_billing_reconciliation_runs (tenant_id, provider, trigger, status, idempotency_key, actor_user_id)
      values (${tenantId}, ${client.provider}, ${o.trigger}, 'running', ${key}, ${o.actorUserId && UUID.test(o.actorUserId) ? o.actorUserId : null})
      on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(this.db)).rows[0];
    if (!run) { const prior = (await sql<any>`select ${RUN_COLS} from ai_billing_reconciliation_runs r where r.tenant_id = ${tenantId} and r.idempotency_key = ${key}`.execute(this.db)).rows[0]; return { ...this.runOf(prior), duplicate: true }; }
    const runId = String(run.id);
    const c = { seen: 0, created: 0, updated: 0, unchanged: 0, stale: 0, rejected: 0 };
    let errorCode: string | null = null; let errorText: string | null = null;
    try {
      const list = await client.listInvoices({ tenantId });
      for (const inv of list) {
        c.seen++;
        try {
          const r = await this.ingest({ provider: client.provider, eventId: `reconcile:${runId}:${String(inv?.id ?? c.seen)}`, eventType: 'reconciliation', tenantId, invoice: inv }, { source: 'reconciliation', runId });
          if (r.outcome === 'duplicate') c.unchanged++; else c[r.outcome]++;
        } catch (e) { c.rejected++; logException(e, { where: 'ai-invoice.reconcile.ingest', tenantId }); }
      }
    } catch (e) {
      errorCode = e instanceof InvoiceClientError ? e.code : 'provider_error';
      errorText = String((e as Error)?.message ?? e).slice(0, 300);
      if (errorCode !== 'provider_not_configured') logException(e, { where: 'ai-invoice.reconcile.list', tenantId });
    }
    const status = errorCode ? 'failed' : c.rejected ? 'partial' : 'succeeded';
    const done = (await sql<any>`update ai_billing_reconciliation_runs r set status = ${status}, invoices_seen = ${c.seen}, created_count = ${c.created}, updated_count = ${c.updated},
        unchanged_count = ${c.unchanged}, stale_count = ${c.stale}, rejected_count = ${c.rejected}, error_code = ${errorCode}, error_text = ${errorText}, finished_at = now()
      where r.tenant_id = ${tenantId} and r.id = ${runId} and ${canMoveToSql(AI_BILLING_RECONCILIATION_RUN, status, 'r')} returning ${RUN_COLS}`.execute(this.db)).rows[0];
    if (!done) throw withCode(new Error('This reconciliation run already finished.'), 'INVALID_STATE_TRANSITION');
    return { ...this.runOf(done), duplicate: false };
  }
  private runOf(r: any): Omit<ReconcileResult, 'duplicate'> {
    return { runId: String(r.id), status: r.status, provider: String(r.provider ?? ''), seen: Number(r.invoices_seen ?? 0), created: Number(r.created_count ?? 0), updated: Number(r.updated_count ?? 0),
      unchanged: Number(r.unchanged_count ?? 0), stale: Number(r.stale_count ?? 0), rejected: Number(r.rejected_count ?? 0), errorCode: r.error_code ?? null };
  }
}
