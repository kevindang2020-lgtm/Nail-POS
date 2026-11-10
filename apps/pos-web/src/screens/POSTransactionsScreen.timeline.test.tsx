import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentTimeline } from './POSTransactionsScreen';

describe('PaymentTimeline (extras arc, Nov 10 2026)', () => {
  it('lists the recorded states with amount and batch reference', () => {
    render(<PaymentTimeline items={[
      { kind: 'deposited', at: '2026-11-07T12:00:00Z', ref: 'BATCH-88' },
      { kind: 'settled', at: '2026-11-06T04:00:00Z', ref: 'BATCH-88' },
      { kind: 'approved', at: '2026-11-05T18:00:01Z', ref: 'TXN-1' },
      { kind: 'created', at: '2026-11-05T18:00:00Z', amountCents: 6316 },
    ]} />);
    const rows = screen.getAllByTestId('payment-timeline-row');
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Deposited to the bank', 'Included in a settlement batch', 'Approved by the processor', 'Payment started']);
    expect(rows[3]).toHaveTextContent('$63.16');
    expect(rows[1]).toHaveTextContent('BATCH-88');
  });
  it('shows nothing when no state has a recorded time', () => {
    const { container } = render(<PaymentTimeline items={[]} />);
    expect(container.textContent).toBe('');
  });
});
