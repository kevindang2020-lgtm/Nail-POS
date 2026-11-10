import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpenseHistory } from './POSExpensesScreen';

describe('ExpenseHistory (extras arc, Nov 10 2026)', () => {
  it('lists who did what, newest first, with the reason; unknown and system actors are named honestly', () => {
    render(<ExpenseHistory items={[
      { id: 'h1', action: 'created', actorUserId: 'u1', actorName: 'Kim Owner', reason: null, at: '2026-11-08T15:00:00Z' },
      { id: 'h2', action: 'voided', actorUserId: 'u2', actorName: null, reason: 'Entered twice', at: '2026-11-09T15:00:00Z' },
      { id: 'h3', action: 'auto_approved', actorUserId: null, reason: null, at: '2026-11-08T16:00:00Z' },
    ]} />);
    const rows = screen.getAllByTestId('expense-history-row');
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Voided', 'Approved automatically by an owner rule', 'Created']);
    expect(rows[0]).toHaveTextContent('Entered twice');
    expect(rows[0]).toHaveTextContent('by a former team member');
    expect(rows[1]).toHaveTextContent('by the system');
    expect(rows[2]).toHaveTextContent('by Kim Owner');
  });
  it('says so when nothing is recorded', () => {
    render(<ExpenseHistory items={[]} />);
    expect(screen.getByTestId('expense-history')).toHaveTextContent('No changes recorded yet.');
  });
});
