// CustomerInvoicesPanel — Invoices guide (Nov 4 2026) §14: a customer's invoices and balance on the profile, filtered by the
// customer id on the server; a role without invoice access sees a note (not an error); a row opens the invoice.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn() }));
vi.mock('../api/posInvoicesApi', () => ({ posInvoicesApi: api }));
import { CustomerInvoicesPanel } from './CustomerInvoicesPanel';

const row = (n: number, o: Record<string, unknown> = {}) => ({ id: `i-${n}`, invoiceNumber: `INV-000${n}`, displayStatus: 'sent', issueDate: '2026-10-2' + n, totalCents: 1000 * n, balanceCents: 1000 * n, ...o });
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
const mount = () => render(<MemoryRouter initialEntries={['/customers']}><Routes><Route path="/customers" element={<CustomerInvoicesPanel customerId="c-1" customerName="Ann Lee" />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
beforeEach(() => { api.list.mockReset(); api.summary.mockReset(); });

describe('CustomerInvoicesPanel', () => {
  it('lists this customer\'s invoices (server-filtered by id) with the balance due; a row opens the invoice with the customer filter on', async () => {
    api.list.mockResolvedValue({ items: [row(2, { displayStatus: 'overdue' }), row(1, { displayStatus: 'paid', balanceCents: 0 })], page: 1, pageSize: 5, total: 2, pageCount: 1 });
    api.summary.mockResolvedValue({ kpis: { outstandingCents: 2000, outstandingInvoices: 1, overdueInvoices: 1, total: 2 } });
    mount();
    expect(await screen.findByTestId('customer-invoices-balance')).toHaveTextContent('$20.00');
    expect(screen.getByTestId('customer-invoices-balance')).toHaveTextContent('1 overdue');
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c-1', preset: 'all', sort: 'created_desc', page: 1, pageSize: 5 }));
    expect(api.summary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c-1', preset: 'all' }));
    fireEvent.click(screen.getByTestId('customer-invoice-INV-0002'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/tenant/payments/invoices?customerId=c-1&customerName=Ann%20Lee&invoiceId=i-2'));
  });
  it('a role without invoice access sees a note, not an error; none says so', async () => {
    api.list.mockRejectedValue({ status: 403 }); api.summary.mockRejectedValue({ status: 403 });
    mount();
    expect(await screen.findByText('Your role cannot view invoices.')).toBeInTheDocument();
  });
  it('no invoices says so', async () => {
    api.list.mockResolvedValue({ items: [], page: 1, pageSize: 5, total: 0, pageCount: 1 }); api.summary.mockResolvedValue({ kpis: { outstandingCents: 0, outstandingInvoices: 0, overdueInvoices: 0, total: 0 } });
    mount();
    expect(await screen.findByText('No invoices for this customer.')).toBeInTheDocument();
  });
});
