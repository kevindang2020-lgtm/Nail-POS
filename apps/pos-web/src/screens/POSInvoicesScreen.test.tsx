// Invoices (Oct 29 2026 one-screen rebuild): dates never render "Invalid Date", an unlinked invoice says so, a new invoice
// requires a salon customer, and Record Payment is an amount ≤ the balance (not a status toggle).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), lookupCustomers: vi.fn(), createInvoice: vi.fn(), edit: vi.fn(), send: vi.fn(), recordPayment: vi.fn(), void: vi.fn(), linkCustomer: vi.fn(), pdf: vi.fn(), exportCsv: vi.fn() }));
vi.mock('../api/posInvoicesApi', () => ({ posInvoicesApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSInvoicesScreen } from './POSInvoicesScreen';

const PERIOD = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const acts = { edit: false, send: false, recordPayment: true, void: false, linkCustomer: true };
const inv = (o: Record<string, unknown> = {}) => ({ id: 'i-2', invoiceNumber: 'INV-0002', status: 'sent', displayStatus: 'overdue', issueDate: '2026-10-21', dueDate: null, createdAt: '2026-10-21T12:00:00Z', sentAt: null, paidAt: null, voidedAt: null, voidReason: null,
  subtotalCents: 1000, discountCents: 0, taxCents: 0, totalCents: 1000, paidCents: 0, balanceCents: 1000, payments: 0, notes: null,
  customer: { id: null, state: 'unlinked', name: null, profileName: null, phone: null, email: null }, actions: acts, ...o });
const summary = { period: PERIOD, dateBasis: 'issued', scope: 'period', permissions: { create: true, recordPayment: true, manage: true },
  kpis: { outstandingCents: 1000, outstandingInvoices: 1, overdueInvoices: 1, cashCollectedCents: 0, paidInvoices: 0, partiallyPaidInvoices: 0, drafts: 0, draftCents: 0, total: 1, voided: 0 } };
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 12, total: items.length, pageCount: 1, period: PERIOD });
const detail = (o: Record<string, unknown> = {}) => ({ invoice: inv(o), lines: [{ id: 'l1', description: 'Nail art add-on', quantity: 1, unitPriceCents: 1000, lineTotalCents: 1000 }], payments: [], delivery: { note: '' }, permissions: { recordPayment: true, send: true, manage: true } });
const mount = () => render(<MemoryRouter><POSInvoicesScreen /></MemoryRouter>);

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.summary.mockResolvedValue(summary); api.list.mockResolvedValue(pageOf([inv()])); });

describe('POSInvoicesScreen', () => {
  it('renders rows: "Not set" for a missing date (never Invalid Date) and an honest unlinked customer', async () => {
    mount();
    expect(await screen.findByText('INV-0002')).toBeInTheDocument();
    expect(screen.getByText('Unlinked customer')).toBeInTheDocument();
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(api.list.mock.calls[0][0]).toMatchObject({ preset: 'all', sort: 'created_desc', page: 1 });
  });
  it('a new invoice cannot be saved without a salon customer; with one it sends cents and the customer id', async () => {
    api.lookupCustomers.mockResolvedValue({ items: [{ id: 'c-1', name: 'John Smith', phone: '(856) 555-1234', email: null, invoices: 1 }] });
    api.createInvoice.mockResolvedValue(detail({ id: 'i-45', invoiceNumber: 'INV-0045', status: 'draft', displayStatus: 'draft' }));
    api.detail.mockResolvedValue(detail({ id: 'i-45', invoiceNumber: 'INV-0045', status: 'draft', displayStatus: 'draft' }));
    mount();
    await screen.findByText('INV-0002');
    fireEvent.click(screen.getByTestId('new-invoice'));
    fireEvent.change(screen.getByTestId('line-desc'), { target: { value: 'Gel manicure' } });
    fireEvent.change(screen.getByTestId('line-price'), { target: { value: '45.00' } });
    expect(screen.getByTestId('save-draft')).toBeDisabled();
    fireEvent.change(screen.getByTestId('customer-find'), { target: { value: 'John' } });
    fireEvent.click(await screen.findByTestId('customer-option'));
    await waitFor(() => expect(screen.getByTestId('save-draft')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(api.createInvoice.mock.calls[0][0]).toMatchObject({ customerId: 'c-1', send: false, lines: [{ description: 'Gel manicure', quantity: 1, unitPriceCents: 4500 }] });
  });
  it('Invoices guide audit (Nov 4 2026): a saved invoice in This Month is highlighted, not called "hidden by filters"', async () => {
    api.lookupCustomers.mockResolvedValue({ items: [{ id: 'c-1', name: 'John Smith', phone: '(856) 555-1234', email: null, invoices: 1 }] });
    const made = detail({ id: 'i-46', invoiceNumber: 'INV-0046', status: 'draft', displayStatus: 'draft', issueDate: '2026-10-29' });
    api.createInvoice.mockResolvedValue(made); api.detail.mockResolvedValue(made);
    mount();
    await screen.findByText('INV-0002');
    fireEvent.click(screen.getByTestId('preset-month'));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'month' })));
    api.list.mockResolvedValue(pageOf([inv({ id: 'i-46', invoiceNumber: 'INV-0046' }), inv()]));
    fireEvent.click(screen.getByTestId('new-invoice'));
    fireEvent.change(screen.getByTestId('line-desc'), { target: { value: 'Gel manicure' } });
    fireEvent.change(screen.getByTestId('line-price'), { target: { value: '45.00' } });
    fireEvent.change(screen.getByTestId('customer-find'), { target: { value: 'John' } });
    fireEvent.click(await screen.findByTestId('customer-option'));
    await waitFor(() => expect(screen.getByTestId('save-draft')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('save-draft'));
    const note = await screen.findByTestId('note');
    await waitFor(() => expect(note).toHaveTextContent('INV-0046'));
    expect(note).not.toHaveTextContent(/filters/i);
  });
  it('Record Payment refuses more than the balance and sends the amount in cents', async () => {
    api.detail.mockResolvedValue(detail()); api.recordPayment.mockResolvedValue(detail({ status: 'partially_paid', displayStatus: 'partially_paid', paidCents: 400, balanceCents: 600 }));
    mount();
    await screen.findByText('INV-0002');
    fireEvent.click(screen.getByTestId('row-pay'));
    const amount = await screen.findByTestId('pay-amount');
    fireEvent.change(amount, { target: { value: '25.00' } });
    expect(screen.getByText('That is more than the balance due.')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-payment')).toBeDisabled();
    fireEvent.change(amount, { target: { value: '4.00' } });
    fireEvent.click(screen.getByTestId('confirm-payment'));
    await waitFor(() => expect(api.recordPayment).toHaveBeenCalled());
    expect(api.recordPayment.mock.calls[0]).toEqual(['i-2', expect.objectContaining({ amountCents: 400, method: 'cash', paidOn: '2026-10-29' })]);
  });
});
