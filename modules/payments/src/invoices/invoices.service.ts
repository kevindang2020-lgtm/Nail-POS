// invoices.service.ts — customer invoicing: create (with lines), list + summary, detail, status changes.
import { normalizeLines, computeInvoiceTotals, nextInvoiceNumber, buildInvoicesSummary, INVOICE_STATUSES,
  type InvoicesContext, type InvoicesState, type InvoiceInput, type Invoice } from './invoices.dto';
import type { InvoicesRepositoryPort } from './invoices.repository';

export class InvoicesForbiddenError extends Error {}
export class InvoicesValidationError extends Error {}

export class InvoicesService {
  constructor(private readonly repo: InvoicesRepositoryPort) {}
  private auth(ctx: InvoicesContext) { if (!ctx?.userId || !ctx?.tenantId) throw new InvoicesForbiddenError('Not authenticated'); }

  async getState(ctx: InvoicesContext): Promise<InvoicesState> {
    this.auth(ctx);
    const invoices = await this.repo.list(ctx);
    return { kpis: buildInvoicesSummary(invoices), invoices };
  }
  async get(ctx: InvoicesContext, id: string): Promise<Invoice> {
    this.auth(ctx);
    const inv = await this.repo.get(ctx, id);
    if (!inv) throw new InvoicesValidationError('Invoice not found');
    return inv;
  }
  async create(ctx: InvoicesContext, input: InvoiceInput): Promise<Invoice> {
    this.auth(ctx);
    const lines = normalizeLines(input?.lines || []);
    if (lines.length === 0) throw new InvoicesValidationError('At least one line item with a description and quantity is required');
    const totals = computeInvoiceTotals(lines, input?.taxCents || 0);
    const invoiceNumber = nextInvoiceNumber(await this.repo.existingNumbers(ctx));
    return this.repo.create(ctx, {
      invoiceNumber, customerId: input.customerId || null, dueDate: input.dueDate || null, notes: input.notes || null,
      subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, totalCents: totals.totalCents, lines,
    });
  }
  async setStatus(ctx: InvoicesContext, id: string, status: string): Promise<Invoice> {
    this.auth(ctx);
    if (!INVOICE_STATUSES.includes(status as any)) throw new InvoicesValidationError('Invalid status');
    const updated = await this.repo.setStatus(ctx, id, status);
    if (!updated) throw new InvoicesValidationError('Invoice not found');
    return updated;
  }

  // ---- Customer self-service (customer app): the customer is derived from the session. ----
  private async requireCustomer(ctx: InvoicesContext): Promise<string> {
    if (!ctx?.userId || !ctx?.tenantId) throw new InvoicesForbiddenError('Not authenticated');
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw new InvoicesForbiddenError('Not a customer account');
    return customerId;
  }
  async customerList(ctx: InvoicesContext): Promise<InvoicesState> {
    const customerId = await this.requireCustomer(ctx);
    const invoices = await this.repo.listForCustomer(ctx, customerId);
    return { kpis: buildInvoicesSummary(invoices), invoices };
  }
  async customerGet(ctx: InvoicesContext, id: string): Promise<Invoice> {
    const customerId = await this.requireCustomer(ctx);
    const inv = await this.repo.get(ctx, id);
    if (!inv || inv.customerId !== customerId) throw new InvoicesValidationError('Invoice not found');
    return inv;
  }
  // Pay one's own invoice in-app (skip-line style). Only a 'sent' invoice is payable; result is 'paid'.
  async customerPay(ctx: InvoicesContext, id: string): Promise<Invoice> {
    const customerId = await this.requireCustomer(ctx);
    const inv = await this.repo.get(ctx, id);
    if (!inv || inv.customerId !== customerId) throw new InvoicesValidationError('Invoice not found');
    if (inv.status === 'paid') return inv;                 // idempotent
    if (inv.status !== 'sent') throw new InvoicesValidationError('This invoice is not payable');
    const paid = await this.repo.setStatus(ctx, id, 'paid');
    if (!paid) throw new InvoicesValidationError('Invoice not found');
    return paid;
  }
}
