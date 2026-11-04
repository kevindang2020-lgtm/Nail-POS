// invoices.service.ts — customer invoicing: create (with lines), list + summary, detail, status changes.
import { normalizeLines, computeInvoiceTotals, nextInvoiceNumber, buildInvoicesSummary, INVOICE_STATUSES,
  type InvoicesContext, type InvoicesState, type InvoiceInput, type Invoice } from './invoices.dto';
import type { InvoicesRepositoryPort } from './invoices.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

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
    if (!inv) throw withCode(new InvoicesValidationError('Invoice not found'), 'INVOICE_NOT_FOUND');
    return inv;
  }
  async create(ctx: InvoicesContext, input: InvoiceInput): Promise<Invoice> {
    this.auth(ctx);
    const lines = normalizeLines(input?.lines || []);
    if (lines.length === 0) throw withCode(new InvoicesValidationError('At least one line item with a description and quantity is required'), 'INVOICE_LINES_REQUIRED');
    if (input?.customerId && this.repo.customerInSalon && !(await this.repo.customerInSalon(ctx, String(input.customerId))))
      throw withCode(new InvoicesValidationError('Choose a customer from this salon.'), 'INVOICE_CUSTOMER_NOT_FOUND');
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
    // Invoices mandate (Oct 29 2026) §13: "paid" is reached only by posted payments (POST /pos/invoices/:id/payments) and a
    // void needs a reason (POST /pos/invoices/:id/void) — this legacy toggle no longer marks money received or voids.
    if (status === 'paid') throw withCode(new InvoicesValidationError('Record the payment instead of marking the invoice paid.'), 'INVOICE_USE_RECORD_PAYMENT');
    if (status === 'void') throw withCode(new InvoicesValidationError('Void the invoice with a reason.'), 'INVOICE_VOID_REASON_REQUIRED');
    const updated = await this.repo.setStatus(ctx, id, status);
    if (!updated) throw withCode(new InvoicesValidationError('Invoice not found'), 'INVOICE_NOT_FOUND');
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
    if (!inv || inv.customerId !== customerId) throw withCode(new InvoicesValidationError('Invoice not found'), 'INVOICE_NOT_FOUND');
    return inv;
  }
  // Pay one's own invoice in-app (skip-line style). Only a 'sent' invoice is payable; result is 'paid'.
  async customerPay(ctx: InvoicesContext, id: string): Promise<Invoice> {
    const customerId = await this.requireCustomer(ctx);
    const inv = await this.repo.get(ctx, id);
    if (!inv || inv.customerId !== customerId) throw withCode(new InvoicesValidationError('Invoice not found'), 'INVOICE_NOT_FOUND');
    if (inv.status === 'paid') return inv;                 // idempotent
    if (inv.status !== 'sent') throw withCode(new InvoicesValidationError('This invoice is not payable'), 'INVOICE_NOT_PAYABLE');
    // Invoices mandate (Oct 29 2026) §13: this route used to flip the invoice to 'paid' WITHOUT taking any money (no card
    // charge, no payment entry). Until an in-app invoice charge exists, it refuses honestly instead of faking a payment.
    throw withCode(new InvoicesValidationError('Online invoice payment is not available yet. Please pay at the salon.'), 'INVOICE_ONLINE_PAY_UNAVAILABLE');
  }
}
