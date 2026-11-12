import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SystemCheckButton, systemCheckCsv } from './SystemCheck';
import { downloadText } from './FitKit';
import { posSystemChecksApi } from '../api/posSystemChecksApi';

vi.mock('../api/posSystemChecksApi', () => ({ posSystemChecksApi: { run: vi.fn() } }));
vi.mock('./FitKit', async (orig) => ({ ...(await orig<typeof import('./FitKit')>()), downloadText: vi.fn() }));

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
  it('extras Team Management #08: the team check lists training, certificate-date and waiting-approval checks with their fixes', async () => {
    vi.mocked(posSystemChecksApi.run).mockResolvedValue({ domain: 'technicians', overall: 'WARNING', checkedAt: '2026-11-12T20:00:00Z', branchId: null, checks: [
      { key: 'training_overdue', state: 'WARNING', count: 3 }, { key: 'training_certificate_unlinked', state: 'READY', count: 0 },
      { key: 'verified_certificate_no_date', state: 'WARNING', count: 1 }, { key: 'verified_certificate_expired', state: 'READY', count: 0 }, { key: 'profile_change_waiting', state: 'NOT_TESTED', count: null },
    ] });
    render(<SystemCheckButton domain="technicians" testId="syschk-team" />);
    fireEvent.click(screen.getByTestId('syschk-team'));
    const rows = await screen.findAllByTestId('syschk-team-row');
    expect(rows[0]).toHaveTextContent('No open training is past its due date');
    expect(rows[0]).toHaveTextContent('Follow up with those people or move the due date.');
    expect(rows[0]).toHaveTextContent('3 found');
    expect(rows[2]).toHaveTextContent('Every verified certificate has an issue date');
    expect(rows[4]).toHaveTextContent('could not run');
  });
  it('extras Team Management #14: "Download report" saves the on-screen result as a CSV of states and counts only', async () => {
    const res = { domain: 'technicians' as const, overall: 'WARNING' as const, checkedAt: '2026-11-12T20:00:00.000Z', branchId: 'b1', checks: [
      { key: 'training_overdue', state: 'WARNING' as const, count: 3 }, { key: 'missing_name', state: 'READY' as const, count: 0 }, { key: 'profile_change_waiting', state: 'NOT_TESTED' as const, count: null },
    ] };
    vi.mocked(posSystemChecksApi.run).mockResolvedValue(res);
    render(<SystemCheckButton domain="technicians" testId="syschk-team" />);
    fireEvent.click(screen.getByTestId('syschk-team'));
    fireEvent.click(await screen.findByTestId('syschk-team-download'));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [name, text] = vi.mocked(downloadText).mock.calls[0];
    expect(name).toBe('check-technicians-2026-11-12T20-00-00-000Z.csv');
    expect(text).toBe(systemCheckCsv('technicians', res));
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('Check Technicians System');
    expect(lines[1]).toBe('Checked at,2026-11-12T20:00:00.000Z');
    expect(lines[2]).toMatch(/^Scope,/);
    expect(lines[5]).toBe('Check,State,Rows found,What to do');
    expect(lines[6]).toMatch(/^No open training is past its due date,.+,3,Follow up with those people or move the due date\.$/);
    expect(lines[7]).toMatch(/^Every technician has a name,.+,0,$/);
    expect(lines[8]).toMatch(/,—,.*could not run/);
    expect(lines).toHaveLength(9);                                             // nothing but the page, time, scope, result and the checks
  });
  it('a value with a comma or quote is quoted in the CSV', () => {
    const csv = systemCheckCsv('invoices', { domain: 'invoices', overall: 'READY', checkedAt: 'x', branchId: null, checks: [{ key: 'total_mismatch', state: 'READY', count: 0 }] });
    expect(csv).toContain('"Subtotal, tax and discount add up to the total",');
  });
});
