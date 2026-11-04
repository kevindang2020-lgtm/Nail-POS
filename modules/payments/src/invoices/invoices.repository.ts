// invoices.repository.ts — port + in-memory adapter.
import type { InvoicesContext, Invoice, InvoiceLine } from './invoices.dto';
export interface InvoiceCreateData {
  invoiceNumber: string; customerId: string | null; dueDate: string | null; notes: string | null;
  subtotalCents: number; taxCents: number; totalCents: number; lines: InvoiceLine[];
}
export interface InvoicesRepositoryPort {
  list(ctx: InvoicesContext): Promise<Invoice[]>;
  get(ctx: InvoicesContext, id: string): Promise<Invoice | null>;
  existingNumbers(ctx: InvoicesContext): Promise<string[]>;
  /** Optional (database adapter): the customer belongs to this salon */
  customerInSalon?(ctx: InvoicesContext, customerId: string): Promise<boolean>;
  create(ctx: InvoicesContext, data: InvoiceCreateData): Promise<Invoice>;
  setStatus(ctx: InvoicesContext, id: string, status: string): Promise<Invoice | null>;
  // Customer-facing (self-service): resolve the signed-in customer + their own invoices.
  resolveCustomerId(ctx: InvoicesContext): Promise<string | null>;
  listForCustomer(ctx: InvoicesContext, customerId: string): Promise<Invoice[]>;
}
export class InMemoryInvoicesRepository implements InvoicesRepositoryPort {
  private rows: Invoice[] = [];
  private selfCustomerId: string | null;
  constructor(seed: Invoice[] = [], selfCustomerId: string | null = null) { this.rows = seed.slice(); this.selfCustomerId = selfCustomerId; }
  async list(): Promise<Invoice[]> { return this.rows.map((r) => ({ ...r, lines: undefined })); }
  async get(_c: InvoicesContext, id: string): Promise<Invoice | null> { return this.rows.find((r) => r.id === id) || null; }
  async existingNumbers(): Promise<string[]> { return this.rows.map((r) => r.invoiceNumber); }
  async create(_c: InvoicesContext, d: InvoiceCreateData): Promise<Invoice> {
    const inv: Invoice = { id: `inv_${this.rows.length + 1}`, invoiceNumber: d.invoiceNumber, customerId: d.customerId, customerName: null,
      status: 'draft', issueDate: new Date().toISOString().slice(0, 10), dueDate: d.dueDate, subtotalCents: d.subtotalCents, taxCents: d.taxCents,
      totalCents: d.totalCents, notes: d.notes, lines: d.lines, createdAt: new Date().toISOString() };
    this.rows.unshift(inv); return inv;
  }
  async setStatus(_c: InvoicesContext, id: string, status: string): Promise<Invoice | null> {
    const r = this.rows.find((x) => x.id === id); if (!r) return null; r.status = status as any; return r;
  }
  async resolveCustomerId(): Promise<string | null> { return this.selfCustomerId; }
  async listForCustomer(_c: InvoicesContext, customerId: string): Promise<Invoice[]> {
    return this.rows.filter((r) => r.customerId === customerId && (r.status === 'sent' || r.status === 'paid')).map((r) => ({ ...r, lines: undefined }));
  }
}
