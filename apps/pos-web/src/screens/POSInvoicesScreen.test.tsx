import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, createMock, statusMock } = vi.hoisted(() => ({ stateMock: vi.fn(), createMock: vi.fn(), statusMock: vi.fn() }));
vi.mock('../api/posInvoicesApi', () => ({ posInvoicesApi: { state: stateMock, create: createMock, setStatus: statusMock } }));
import { POSInvoicesScreen } from './POSInvoicesScreen';
beforeEach(() => { stateMock.mockReset(); createMock.mockReset(); statusMock.mockReset(); });

const inv = (o: any = {}) => ({ id: 'i1', invoiceNumber: 'INV-0001', customerName: 'Ana', status: 'sent', issueDate: '2026-07-07', dueDate: '2026-08-01', subtotalCents: 10500, taxCents: 800, totalCents: 11300, ...o });
const state = (invoices: any[]) => ({ kpis: { total: invoices.length, draft: invoices.filter((i) => i.status === 'draft').length, sent: invoices.filter((i) => i.status === 'sent').length, paid: invoices.filter((i) => i.status === 'paid').length, outstandingCents: 11300, paidCents: 0 }, invoices });

describe('POSInvoicesScreen', () => {
  it('renders KPIs + invoice rows', async () => {
    stateMock.mockResolvedValue(state([inv()]));
    render(<POSInvoicesScreen />);
    expect(await screen.findByRole('heading', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.getAllByText('$113.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });
  it('validates that at least one line is required', async () => {
    stateMock.mockResolvedValue(state([]));
    render(<POSInvoicesScreen />);
    await screen.findByRole('heading', { name: 'Invoices' });
    fireEvent.click(screen.getByRole('button', { name: '+ New Invoice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
    expect(await screen.findByText(/at least one line item/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
  it('creates an invoice with a line item (dollars -> cents)', async () => {
    stateMock.mockResolvedValue(state([])); createMock.mockResolvedValue({});
    render(<POSInvoicesScreen />);
    await screen.findByRole('heading', { name: 'Invoices' });
    fireEvent.click(screen.getByRole('button', { name: '+ New Invoice' }));
    fireEvent.change(screen.getByPlaceholderText('Item description'), { target: { value: 'Gel manicure' } });   // Sep 2026 redesign wording
    fireEvent.change(screen.getByLabelText('Unit $'), { target: { value: '45.00' } });   // the redesign wraps it in a 'Unit $' label
    fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0].lines[0]).toMatchObject({ description: 'Gel manicure', quantity: 1, unitPriceCents: 4500 });
  });
  it('transitions a draft to sent', async () => {
    stateMock.mockResolvedValue(state([inv({ status: 'draft' })])); statusMock.mockResolvedValue({});
    render(<POSInvoicesScreen />);
    await screen.findByText('INV-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith('i1', 'sent'));
  });
});
