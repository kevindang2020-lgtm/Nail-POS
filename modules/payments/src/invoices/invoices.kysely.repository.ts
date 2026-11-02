// invoices.kysely.repository.ts — Kysely adapter over invoices + invoice_lines. Tenant/branch scoped.
import { dateColumnYmd } from '@aipowersalon/date-time';
import { assertTransition, InvalidStateTransitionError } from '@aipowersalon/database';
import { INVOICE } from '../payments-lifecycles';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { InvoicesContext, Invoice, InvoiceLine, InvoiceStatus } from './invoices.dto';
import type { InvoicesRepositoryPort, InvoiceCreateData } from './invoices.repository';
import { emptyOnReadError } from '../read-fallback';

export class KyselyInvoicesRepository implements InvoicesRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: InvoicesContext): any {
    let q = qb.where('invoices.tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('invoices.branch_id', '=', ctx.branchId), eb('invoices.branch_id', 'is', null)]));
    return q;
  }
  private mapRow(r: any): Invoice {
    return { id: String(r.id), invoiceNumber: String(r.invoice_number), customerId: r.customer_id ? String(r.customer_id) : null,
      customerName: r.customer_name ? String(r.customer_name) : null, status: String(r.status) as InvoiceStatus,
      issueDate: dateColumnYmd(r.issue_date) ?? '', dueDate: dateColumnYmd(r.due_date),
      subtotalCents: Number(r.subtotal_cents || 0), taxCents: Number(r.tax_cents || 0), totalCents: Number(r.total_cents || 0),
      notes: r.notes ?? null, createdAt: r.created_at ? new Date(r.created_at).toISOString() : '' };
  }
  async list(ctx: InvoicesContext): Promise<Invoice[]> {
    const rows = await this.scoped(this.db.selectFrom('invoices').leftJoin('customers', 'customers.id', 'invoices.customer_id'), ctx)
      .select(['invoices.id as id', 'invoices.invoice_number as invoice_number', 'invoices.customer_id as customer_id', 'customers.full_name as customer_name',
        'invoices.status as status', 'invoices.issue_date as issue_date', 'invoices.due_date as due_date', 'invoices.subtotal_cents as subtotal_cents',
        'invoices.tax_cents as tax_cents', 'invoices.total_cents as total_cents', 'invoices.notes as notes', 'invoices.created_at as created_at'])
      .orderBy('invoices.created_at', 'desc').limit(500).execute().catch(emptyOnReadError('invoices.list'));
    return (rows as any[]).map((r) => this.mapRow(r));
  }
  async get(ctx: InvoicesContext, id: string): Promise<Invoice | null> {
    const r = await this.scoped(this.db.selectFrom('invoices').leftJoin('customers', 'customers.id', 'invoices.customer_id'), ctx)
      .where('invoices.id', '=', id)
      .select(['invoices.id as id', 'invoices.invoice_number as invoice_number', 'invoices.customer_id as customer_id', 'customers.full_name as customer_name',
        'invoices.status as status', 'invoices.issue_date as issue_date', 'invoices.due_date as due_date', 'invoices.subtotal_cents as subtotal_cents',
        'invoices.tax_cents as tax_cents', 'invoices.total_cents as total_cents', 'invoices.notes as notes', 'invoices.created_at as created_at'])
      .executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    const inv = this.mapRow(r);
    const lines = await this.db.selectFrom('invoice_lines').where('tenant_id', '=', ctx.tenantId).where('invoice_id', '=', id)
      .select(['id', 'description', 'quantity', 'unit_price_cents', 'line_total_cents', 'position']).orderBy('position', 'asc').execute().catch(emptyOnReadError('invoices.get'));
    inv.lines = lines.map((l) => ({ id: String(l.id), description: String(l.description), quantity: Number(l.quantity), unitPriceCents: Number(l.unit_price_cents), lineTotalCents: Number(l.line_total_cents), position: Number(l.position) }));
    return inv;
  }
  async existingNumbers(ctx: InvoicesContext): Promise<string[]> {
    const rows = await this.db.selectFrom('invoices').where('tenant_id', '=', ctx.tenantId).select('invoice_number').execute().catch(emptyOnReadError('invoices.existingNumbers'));
    return (rows as any[]).map((r) => String(r.invoice_number));
  }
  async create(ctx: InvoicesContext, d: InvoiceCreateData): Promise<Invoice> {
    const branchId = ctx.branchId || null;
    const row = await this.db.insertInto('invoices').values({
      tenant_id: ctx.tenantId, branch_id: branchId, customer_id: d.customerId, invoice_number: d.invoiceNumber, status: 'draft',
      subtotal_cents: d.subtotalCents, tax_cents: d.taxCents, total_cents: d.totalCents, due_date: d.dueDate, notes: d.notes,
      created_by_user_id: ctx.userId, updated_at: new Date(),
    } as any).returning(['id', 'invoice_number', 'issue_date', 'created_at']).executeTakeFirstOrThrow();
    const id = String(row.id);
    if (d.lines.length) {
      await this.db.insertInto('invoice_lines').values(d.lines.map((l) => ({
        invoice_id: id, tenant_id: ctx.tenantId, description: l.description, quantity: l.quantity,
        unit_price_cents: l.unitPriceCents, line_total_cents: l.lineTotalCents, position: l.position,
      }))).execute();
    }
    return (await this.get(ctx, id))!;
  }
  async setStatus(ctx: InvoicesContext, id: string, status: string): Promise<Invoice | null> {
    // Phase 12 (#27): through the INVOICE machine — a paid or void invoice is final (409), and the write is conditional on
    // the status read (a concurrent change gets 409, not a lost update)
    const cur: any = await this.scoped(this.db.selectFrom('invoices'), ctx).select(['invoices.status as status']).where('invoices.id', '=', id).executeTakeFirst();
    if (!cur) return null;
    assertTransition(INVOICE, cur.status, status);
    const res = await this.scoped(this.db.updateTable('invoices'), ctx).set({ status, updated_at: new Date() }).where('invoices.id', '=', id).where('invoices.status', '=', cur.status).executeTakeFirst();
    if (!Number((res as any)?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(INVOICE, null, status, 'concurrent');
    return this.get(ctx, id);
  }

  async resolveCustomerId(ctx: InvoicesContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('customers').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null)
      .executeTakeFirst().catch(() => undefined);
    return r?.id ?? null;
  }

  async listForCustomer(ctx: InvoicesContext, customerId: string): Promise<Invoice[]> {
    const rows = await this.db.selectFrom('invoices').leftJoin('customers', 'customers.id', 'invoices.customer_id')
      .where('invoices.tenant_id', '=', ctx.tenantId).where('invoices.customer_id', '=', customerId)
      .where('invoices.status', 'in', ['sent', 'partially_paid', 'paid'])
      .select(['invoices.id as id', 'invoices.invoice_number as invoice_number', 'invoices.customer_id as customer_id', 'customers.full_name as customer_name',
        'invoices.status as status', 'invoices.issue_date as issue_date', 'invoices.due_date as due_date', 'invoices.subtotal_cents as subtotal_cents',
        'invoices.tax_cents as tax_cents', 'invoices.total_cents as total_cents', 'invoices.notes as notes', 'invoices.created_at as created_at'])
      .orderBy('invoices.created_at', 'desc').limit(200).execute().catch(emptyOnReadError('invoices.listForCustomer'));
    return rows.map((r) => this.mapRow(r));
  }
}
