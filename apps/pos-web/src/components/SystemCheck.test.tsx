import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SystemCheckButton } from './SystemCheck';
import { posSystemChecksApi } from '../api/posSystemChecksApi';

vi.mock('../api/posSystemChecksApi', () => ({ posSystemChecksApi: { run: vi.fn() } }));

describe('SystemCheckButton (extras arc, Nov 9 2026)', () => {
  it('runs the page check and shows each result with its count and fix; NOT TESTED is never a pass', async () => {
    vi.mocked(posSystemChecksApi.run).mockResolvedValue({ domain: 'invoices', overall: 'FAILED', checkedAt: '2026-11-09T20:00:00Z', branchId: null, checks: [
      { key: 'total_mismatch', state: 'FAILED', count: 2 }, { key: 'open_past_due', state: 'READY', count: 0 }, { key: 'overpaid', state: 'NOT_TESTED', count: null },
    ] });
    render(<SystemCheckButton domain="invoices" />);
    fireEvent.click(screen.getByTestId('syschk-invoices'));
    expect(posSystemChecksApi.run).toHaveBeenCalledWith('invoices');
    const rows = await screen.findAllByTestId('syschk-invoices-row');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['FAILED', 'READY', 'NOT_TESTED']);
    expect(rows[0]).toHaveTextContent('Subtotal, tax and discount add up to the total');
    expect(rows[0]).toHaveTextContent('Open the invoice and correct the amounts.');
    expect(rows[0]).toHaveTextContent('2 found');
    expect(rows[2]).toHaveTextContent('could not run');
    expect(screen.getByTestId('syschk-invoices-overall')).toHaveTextContent('Problems found');
  });
  it('a failed call shows the error, not a result', async () => {
    vi.mocked(posSystemChecksApi.run).mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<SystemCheckButton domain="expenses" />);
    fireEvent.click(screen.getByTestId('syschk-expenses'));
    expect(await screen.findByTestId('syschk-expenses-error')).toBeInTheDocument();
    expect(screen.queryByTestId('syschk-expenses-overall')).toBeNull();
  });
  it('extras: Suppliers & Purchasing has its own check (supplier data, purchase-order integrity, receiving & stock)', async () => {
    vi.mocked(posSystemChecksApi.run).mockResolvedValue({ domain: 'suppliers', overall: 'FAILED', checkedAt: '2026-11-12T20:00:00Z', branchId: null, checks: [
      { key: 'po_total_mismatch', state: 'FAILED', count: 1 }, { key: 'duplicate_supplier_names', state: 'WARNING', count: 2 }, { key: 'received_without_movement', state: 'READY', count: 0 },
    ] });
    render(<SystemCheckButton domain="suppliers" />);
    fireEvent.click(screen.getByTestId('syschk-suppliers'));
    expect(posSystemChecksApi.run).toHaveBeenCalledWith('suppliers');
    const rows = await screen.findAllByTestId('syschk-suppliers-row');
    expect(rows[0]).toHaveTextContent('Purchase order totals match their lines');
    expect(rows[1]).toHaveTextContent('No two active suppliers share a name');
    expect(rows[1]).toHaveTextContent('2 found');
  });
});
