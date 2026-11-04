// Invoices (Oct 29 2026 one-screen rebuild): dates never render "Invalid Date", an unlinked invoice says so, a new invoice
// requires a salon customer, and Record Payment is an amount ≤ the balance (not a status toggle).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), detail: vi.fn(), lookupCustomers: vi.fn(), createInvoice: vi.fn(), edit: vi.fn(), send: vi.fn(), recordPayment: vi.fn(), void: vi.fn(), linkCustomer: vi.fn(), pdf: vi.fn(), exportCsv: vi.fn(), credit: vi.fn(), catalog: vi.fn(), deliver: vi.fn() }));
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
  it('a paid invoice is corrected with a credit note: the overpaid part needs a refund method; credits and refunds show in the detail', async () => {
    const paid = { status: 'paid', displayStatus: 'paid', totalCents: 10000, subtotalCents: 10000, paidCents: 10000, balanceCents: 0, payments: 1, actions: { ...acts, recordPayment: false, credit: true } };
    api.list.mockResolvedValue(pageOf([inv(paid)]));
    api.detail.mockResolvedValue(detail(paid));
    api.credit.mockResolvedValue({ ...detail({ ...paid, creditedCents: 3000, refundedCents: 3000, credits: 1 }), creditNumber: 'CN-0001',
      credits: [{ id: 'cn1', creditNumber: 'CN-0001', creditCents: 3000, refundCents: 3000, refundMethod: 'cash', refundReference: null, reason: 'Service redone', issuedOn: '2026-10-29', issuedBy: 'Owner' }] });
    mount();
    fireEvent.click(await screen.findByText('INV-0002'));
    fireEvent.click(await screen.findByTestId('credit'));
    const amount = await screen.findByTestId('credit-amount');
    expect(amount).toHaveValue('100.00');   // nothing owed: everything left is creditable
    fireEvent.change(amount, { target: { value: '150.00' } });
    expect(screen.getByText('That is more than is left to credit on this invoice.')).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: '30.00' } });
    fireEvent.change(screen.getByTestId('credit-reason'), { target: { value: 'Service redone' } });
    expect(screen.getByTestId('credit-refund-preview')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('confirm-credit')).toBeDisabled();   // the refund method is required
    fireEvent.change(screen.getByTestId('credit-refund-method'), { target: { value: 'cash' } });
    api.detail.mockResolvedValue({ ...detail({ ...paid, creditedCents: 3000, refundedCents: 3000, credits: 1 }), credits: [{ id: 'cn1', creditNumber: 'CN-0001', creditCents: 3000, refundCents: 3000, refundMethod: 'cash', refundReference: null, reason: 'Service redone', issuedOn: '2026-10-29', issuedBy: 'Owner' }] });
    fireEvent.click(screen.getByTestId('confirm-credit'));
    await waitFor(() => expect(api.credit).toHaveBeenCalledWith('i-2', expect.objectContaining({ amountCents: 3000, reason: 'Service redone', refundMethod: 'cash' })));
    expect(await screen.findByTestId('credits')).toHaveTextContent('CN-0001');
    expect(screen.getByTestId('credited')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('refunded')).toHaveTextContent('$30.00');
  });
  it('arriving from a customer profile filters by that customer and opens the invoice; a customer can be picked and cleared', async () => {
    api.detail.mockResolvedValue(detail());
    api.lookupCustomers.mockResolvedValue({ items: [{ id: 'c-9', name: 'Bob Smith', phone: null, email: null, invoices: 3 }] });
    render(<MemoryRouter initialEntries={['/tenant/payments/invoices?customerId=c-1&customerName=Ann%20Lee&invoiceId=i-2']}><POSInvoicesScreen /></MemoryRouter>);
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c-1' })));
    expect(api.summary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c-1' }));
    expect(await screen.findByText('Customer: Ann Lee')).toBeInTheDocument();
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('i-2'));
    fireEvent.click(screen.getByTestId('customer-filter'));
    fireEvent.change(screen.getByTestId('customer-filter-find'), { target: { value: 'Bob' } });
    fireEvent.click(await screen.findByTestId('customer-filter-option'));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ customerId: 'c-9', page: 1 })));
    fireEvent.click(screen.getByRole('button', { name: /remove filter customer: bob smith/i }));
    await waitFor(() => expect(api.list.mock.calls[api.list.mock.calls.length - 1]![0].customerId).toBeUndefined());
  });
  it('a line can be filled from the salon catalog (description + price copied, still editable)', async () => {
    api.catalog.mockResolvedValue({ items: [{ kind: 'service', id: 's1', name: 'Gel Manicure', unitPriceCents: 4500, sku: null }, { kind: 'product', id: 'p1', name: 'Gel Top Coat', unitPriceCents: 1800, sku: 'GTC-1' }] });
    mount();
    await screen.findByText('INV-0002');
    fireEvent.click(screen.getByTestId('new-invoice'));
    fireEvent.click(screen.getByTestId('from-catalog'));
    const opts = await screen.findAllByTestId('catalog-option');
    fireEvent.click(opts[0]!);
    expect(screen.getAllByTestId('line-desc')[0]).toHaveValue('Gel Manicure');   // the blank first line is used
    expect(screen.getAllByTestId('line-price')[0]).toHaveValue('45.00');
    fireEvent.click(opts[1]!);
    expect(screen.getAllByTestId('line-desc')[1]).toHaveValue('Gel Top Coat');
    expect(screen.getByTestId('form-total')).toHaveTextContent('$63.00');
    fireEvent.change(screen.getByTestId('catalog-find'), { target: { value: 'gel' } });
    await waitFor(() => expect(api.catalog).toHaveBeenLastCalledWith('gel'));
  });
  it('an issued invoice can be emailed / texted; the attempt shows Submitted, never Delivered until the provider confirms; not connected says so', async () => {
    const dv = { note: '', email: 'available', sms: 'not_connected', canSend: { email: true, sms: false }, destination: { email: 'ann@example.com', phone: '(856) 555-1234' }, attempts: [] };
    api.detail.mockResolvedValue({ ...detail(), delivery: dv });
    api.deliver.mockResolvedValue({ attempt: { status: 'submitted', channel: 'email' } });
    mount();
    fireEvent.click(await screen.findByText('INV-0002'));
    const btn = await screen.findByTestId('deliver-email');
    expect(btn).toHaveTextContent('ann@example.com');
    expect(screen.queryByTestId('deliver-sms')).toBeNull();
    expect(screen.getByText('Text messages are not connected for this salon.')).toBeInTheDocument();
    api.detail.mockResolvedValue({ ...detail(), delivery: { ...dv, attempts: [{ id: 'a1', channel: 'email', destination: 'an***@example.com', status: 'submitted', reason: null, createdAt: '2026-10-29T15:00:00Z', deliveredAt: null }] } });
    fireEvent.click(btn);
    await waitFor(() => expect(api.deliver).toHaveBeenCalledWith('i-2', expect.objectContaining({ channel: 'email' })));
    const attempts = await screen.findByTestId('delivery-attempts');
    expect(attempts).toHaveTextContent('Submitted'); expect(attempts).not.toHaveTextContent('Delivered');
  });
});
