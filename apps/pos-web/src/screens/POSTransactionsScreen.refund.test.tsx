// POSTransactionsScreen.refund.test.tsx — Refund is offered on a transaction only to staff who may refund, only for a
// payment with a ticket that is not already refunded, and opens the refund panel for that ticket.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let perms: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u', role: 'MANAGER', permissions: perms } }) }));
vi.mock('../api/posReportsApi', () => ({ posReportsApi: { transactions: vi.fn(async () => [
  { id: 'p1', ticketId: 't1', at: '2026-10-02T15:00:00Z', customer: 'Grace Kim', technician: 'Mia', service: 'Gel', paymentMethod: 'card', grossCents: 6000, tipCents: 0, taxCents: 0, netCents: 6000, status: 'completed' },
  { id: 'p2', ticketId: 't2', at: '2026-10-02T15:10:00Z', customer: 'Ana Lee', technician: 'Mia', service: 'Pedi', paymentMethod: 'cash', grossCents: 4000, tipCents: 0, taxCents: 0, netCents: 4000, status: 'refunded' },
] ) } }));
vi.mock('../components/TicketRefundPanel', () => ({ TicketRefundPanel: ({ ticketId, label }: any) => <div>Refund panel for {ticketId} ({label})</div> }));
import { POSTransactionsScreen } from './POSTransactionsScreen';

beforeEach(() => { perms = []; });

describe('Transactions → Refund', () => {
  it('staff without the refund permission see no Refund action', async () => {
    perms = ['reports.view'];
    render(<POSTransactionsScreen />);
    await screen.findByText('Grace Kim');
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });
  it('a manager can refund a completed payment (not an already refunded one); it opens the panel for that ticket', async () => {
    perms = ['reports.view', 'checkout.manage_overrides'];
    render(<POSTransactionsScreen />);
    await screen.findByText('Grace Kim');
    const buttons = screen.getAllByRole('button', { name: 'Refund' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(screen.getByText('Refund panel for t1 (Grace Kim)')).toBeInTheDocument();
  });
});
