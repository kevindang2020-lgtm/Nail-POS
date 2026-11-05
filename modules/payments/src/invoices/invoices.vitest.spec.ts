import { describe, it, expect } from 'vitest';
import { normalizeLines, computeInvoiceTotals, nextInvoiceNumber, buildInvoicesSummary, type Invoice } from './invoices.dto';
import { InMemoryInvoicesRepository } from './invoices.repository';
import { InvoicesService, InvoicesValidationError, InvoicesForbiddenError } from './invoices.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.process_payment'] };

describe('invoices — pure helpers', () => {
  it('normalizes lines (drops blanks) and computes totals with tax', () => {
    const lines = normalizeLines([
      { description: 'Gel manicure', quantity: 2, unitPriceCents: 4500 },
      { description: '', quantity: 1, unitPriceCents: 1000 },       // dropped (no description)
      { description: 'Nail art', quantity: 3, unitPriceCents: 1500 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].lineTotalCents).toBe(9000);
    const totals = computeInvoiceTotals(lines, 800);
    expect(totals.subtotalCents).toBe(9000 + 4500); // 13500
    expect(totals.taxCents).toBe(800);
    expect(totals.totalCents).toBe(14300);
  });
  it('generates the next INV-#### number', () => {
    expect(nextInvoiceNumber([])).toBe('INV-0001');
    expect(nextInvoiceNumber(['INV-0001', 'INV-0007', 'garbage'])).toBe('INV-0008');
  });
  it('summarizes by status with outstanding + paid totals', () => {
    const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i', invoiceNumber: 'INV-0001', customerId: null, customerName: null, status: 'draft', issueDate: '2026-07-07', dueDate: null, subtotalCents: 0, taxCents: 0, totalCents: 0, notes: null, createdAt: '', ...o });
    const s = buildInvoicesSummary([inv({ status: 'sent', totalCents: 5000 }), inv({ status: 'paid', totalCents: 3000 }), inv({ status: 'draft' })]);
    expect(s).toMatchObject({ total: 3, draft: 1, sent: 1, paid: 1, outstandingCents: 5000, paidCents: 3000 });
  });
});

describe('invoices — service', () => {
  it('creates an invoice with computed totals + auto number, then transitions status', async () => {
    const svc = new InvoicesService(new InMemoryInvoicesRepository());
    const inv = await svc.create(ctx, { customerId: null, lines: [{ description: 'Pedicure', quantity: 1, unitPriceCents: 6000 }], taxCents: 500 });
    expect(inv.invoiceNumber).toBe('INV-0001');
    expect(inv.totalCents).toBe(6500);
    expect(inv.status).toBe('draft');
    const sent = await svc.setStatus(ctx, inv.id, 'sent');
    expect(sent.status).toBe('sent');
  });
  it('rejects an invoice with no valid lines, an invalid status, and unauthenticated access', async () => {
    const svc = new InvoicesService(new InMemoryInvoicesRepository());
    await expect(svc.create(ctx, { lines: [] })).rejects.toBeInstanceOf(InvoicesValidationError);
    const inv = await svc.create(ctx, { lines: [{ description: 'X', quantity: 1, unitPriceCents: 100 }] });
    await expect(svc.setStatus(ctx, inv.id, 'bogus')).rejects.toBeInstanceOf(InvoicesValidationError);
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(InvoicesForbiddenError);
  });
});

describe('invoices — customer self-service', () => {
  const custCtx = { tenantId: 't1', branchId: 'b1', userId: 'u-self', role: 'CUSTOMER', permissions: [] } as any;
  const makeInv = (o: any) => ({ id: o.id, invoiceNumber: o.invoiceNumber || 'INV-0001', customerId: o.customerId ?? null, customerName: null, status: o.status || 'sent', issueDate: '2026-07-07', dueDate: null, subtotalCents: o.totalCents || 5000, taxCents: 0, totalCents: o.totalCents || 5000, notes: null, createdAt: '' });
  it('lists only the signed-in customer\'s sent/paid invoices and pays a sent one', async () => {
    const repo = new InMemoryInvoicesRepository([
      makeInv({ id: 'mine1', customerId: 'cust-self', status: 'sent', totalCents: 5000 }),
      makeInv({ id: 'mine2', customerId: 'cust-self', status: 'paid', totalCents: 3000 }),
    ], 'cust-self');
    const svc = new InvoicesService(repo);
    const st = await svc.customerList(custCtx);
    expect(st.invoices).toHaveLength(2);
    const paid = await svc.customerPay(custCtx, 'mine1');
    expect(paid.status).toBe('paid');
  });
  it('rejects paying an invoice that is not the customer\'s, and non-customers', async () => {
    const repo = new InMemoryInvoicesRepository([makeInv({ id: 'other', customerId: 'someone-else', status: 'sent' })], 'cust-self');
    const svc = new InvoicesService(repo);
    await expect(svc.customerPay(custCtx, 'other')).rejects.toBeInstanceOf(InvoicesValidationError); // not owned -> not found
    const svc2 = new InvoicesService(new InMemoryInvoicesRepository([], null)); // resolveCustomerId -> null
    await expect(svc2.customerList(custCtx)).rejects.toBeInstanceOf(InvoicesForbiddenError);
  });
  it('refuses to pay a draft (not yet sent) invoice', async () => {
    const repo = new InMemoryInvoicesRepository([makeInv({ id: 'd1', customerId: 'cust-self', status: 'draft' })], 'cust-self');
    // draft isn't returned by listForCustomer, but a direct pay attempt must still be refused
    const svc = new InvoicesService(repo);
    await expect(svc.customerPay(custCtx, 'd1')).rejects.toBeInstanceOf(InvoicesValidationError);
  });
});
