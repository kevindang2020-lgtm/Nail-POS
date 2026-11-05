import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { listMock, payMock } = vi.hoisted(() => ({ listMock: vi.fn(), payMock: vi.fn() }));
vi.mock('../api/customerInvoicesApi', () => ({ customerInvoicesApi: { list: listMock, pay: payMock } }));
import { CustomerInvoicesScreen } from './CustomerInvoicesScreen';

const resp = (invoices: any[]) => ({ kpis: { total: invoices.length, draft: 0, sent: invoices.filter((i) => i.status === 'sent').length, paid: invoices.filter((i) => i.status === 'paid').length, outstandingCents: invoices.filter((i) => i.status === 'sent').reduce((a, i) => a + i.totalCents, 0), paidCents: 0 }, invoices });
const inv = (o: any = {}) => ({ id: 'i1', invoiceNumber: 'INV-9001', status: 'sent', issueDate: '2026-07-07', dueDate: '2026-08-01', subtotalCents: 5000, taxCents: 400, totalCents: 5400, notes: null, ...o });

describe('CustomerInvoicesScreen (customer app)', () => {
  beforeEach(() => { listMock.mockReset(); payMock.mockReset(); });

  it('lists the customer invoices with the amount due', async () => {
    listMock.mockResolvedValue(resp([inv(), inv({ id: 'i2', invoiceNumber: 'INV-9000', status: 'paid', totalCents: 3000 })]));
    render(<MemoryRouter><CustomerInvoicesScreen /></MemoryRouter>);
    expect(await screen.findByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText(/INV-9001/)).toBeInTheDocument();
    expect(screen.getByText('$54.00')).toBeInTheDocument();
    expect(screen.getByText(/\$54\.00 due/)).toBeInTheDocument();       // outstanding summary
    expect(screen.getByText('Paid')).toBeInTheDocument();               // paid pill
  });

  it('pays an outstanding invoice and refreshes', async () => {
    listMock.mockResolvedValueOnce(resp([inv()]));                       // initial
    payMock.mockResolvedValue({});
    listMock.mockResolvedValueOnce(resp([inv({ status: 'paid' })]));     // after pay
    render(<MemoryRouter><CustomerInvoicesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(payMock).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText(/INV-9001 paid/)).toBeInTheDocument();
  });

  it('surfaces a payment error', async () => {
    listMock.mockResolvedValue(resp([inv()])); payMock.mockRejectedValue({ message: 'This invoice is not payable' });
    render(<MemoryRouter><CustomerInvoicesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    expect(await screen.findByText(/not payable/i)).toBeInTheDocument();
  });
});
