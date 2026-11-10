import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceTimeline } from './POSInvoicesScreen';

describe('InvoiceTimeline (extras arc, Nov 10 2026)', () => {
  it('shows the invoice life newest first from recorded dates only', () => {
    render(<InvoiceTimeline
      inv={{ createdAt: '2026-11-01T14:00:00Z', issueDate: '2026-11-01', sentAt: '2026-11-01T15:00:00Z', paidAt: '2026-11-05T18:00:00Z', voidedAt: null, voidReason: null }}
      payments={[{ id: 'p1', amountCents: 2000, method: 'cash', createdAt: '2026-11-03T16:00:00Z', recordedBy: 'Kim Owner' }, { id: 'p2', amountCents: 3000, method: 'card', createdAt: '2026-11-05T18:00:00Z' }]}
      credits={[]} />);
    const rows = screen.getAllByTestId('invoice-timeline-row').map((r) => r.querySelector('b')?.textContent);
    expect(rows).toEqual(['Payment of $30.00 recorded', 'Paid in full', 'Payment of $20.00 recorded', 'Sent to the customer', 'Invoice created']);
    expect(screen.getByTestId('invoice-timeline')).toHaveTextContent('by Kim Owner');
  });
  it('a voided invoice shows when and why', () => {
    render(<InvoiceTimeline inv={{ createdAt: '2026-11-01T14:00:00Z', issueDate: null, sentAt: null, paidAt: null, voidedAt: '2026-11-02T14:00:00Z', voidReason: 'Duplicate of INV-12' }} payments={[]} credits={[]} />);
    const first = screen.getAllByTestId('invoice-timeline-row')[0];
    expect(first).toHaveTextContent('Voided');
    expect(first).toHaveTextContent('Duplicate of INV-12');
  });
});
