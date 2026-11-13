import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SystemCheckButton, systemCheckCsv } from './SystemCheck';
import { downloadText } from './FitKit';
import { posSystemChecksApi } from '../api/posSystemChecksApi';

vi.mock('../api/posSystemChecksApi', () => ({ posSystemChecksApi: { run: vi.fn(), rows: vi.fn() } }));
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
  it('extras Device Integration Logs 01: the device-logs check names silent kiosks / terminals, unregistered sources and stuck jobs with their fixes', async () => {
    vi.mocked(posSystemChecksApi.run).mockResolvedValue({ domain: 'device-logs', overall: 'WARNING', checkedAt: '2026-11-13T20:00:00Z', branchId: null, checks: [
      { key: 'kiosk_alive_no_events', state: 'WARNING', count: 1 }, { key: 'terminal_alive_no_events', state: 'READY', count: 0 },
      { key: 'device_event_unregistered_source', state: 'WARNING', count: 3 }, { key: 'job_stuck_running', state: 'READY', count: 0 },
    ] });
    render(<SystemCheckButton domain="device-logs" />);
    fireEvent.click(screen.getByTestId('syschk-device-logs'));
    expect(posSystemChecksApi.run).toHaveBeenCalledWith('device-logs');
    const rows = await screen.findAllByTestId('syschk-device-logs-row');
    expect(rows[0]).toHaveTextContent('Every working check-in kiosk is sending its events');
    expect(rows[0]).toHaveTextContent('Reopen the check-in page');
    expect(rows[2]).toHaveTextContent('Every device event comes from a registered device');
    expect(rows[2]).toHaveTextContent('3 found');
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
  it('extras Membership Overview 16·15: a discrepant membership check opens its source rows (ledger / payment / redemption) on demand', async () => {
    vi.mocked(posSystemChecksApi.run).mockResolvedValue({ domain: 'memberships', overall: 'FAILED', checkedAt: '2026-11-12T20:00:00Z', branchId: null, checks: [
      { key: 'redemption_ledger_mismatch', state: 'FAILED', count: 1 }, { key: 'charged_after_cancel', state: 'READY', count: 0 }, { key: 'payment_pending_stuck', state: 'WARNING', count: 1 },
    ] });
    vi.mocked(posSystemChecksApi.rows).mockImplementation(async (_d, key) => (key === 'redemption_ledger_mismatch'
      ? { domain: 'memberships', key, checkedAt: '2026-11-12T20:00:00Z', branchId: null, available: true, truncated: false, limit: 25,
        rows: [{ membershipId: 'm1', memberNumber: 'M-0042', customerName: 'Mem Ber', source: 'redemption_vs_ledger', sourceId: 'b1', ticketId: 't1', ticketNumber: '1007', amountCents: null, at: null, detail: '1/2' }] }
      : { domain: 'memberships', key, checkedAt: '2026-11-12T20:00:00Z', branchId: null, available: true, truncated: true, limit: 25,
        rows: [{ membershipId: 'm2', memberNumber: null, customerName: 'Ann', source: 'payment', sourceId: 'p1', ticketId: null, ticketNumber: null, amountCents: 4900, at: '2026-11-09T15:00:00Z', detail: 'pending' }] }));
    render(<SystemCheckButton domain="memberships" />);
    fireEvent.click(screen.getByTestId('syschk-memberships'));
    await screen.findAllByTestId('syschk-memberships-row');
    expect(screen.queryByTestId('syschk-memberships-src-charged_after_cancel')).toBeNull();   // a passing check has nothing to drill
    expect(posSystemChecksApi.rows).not.toHaveBeenCalled();                                  // asked only when opened
    fireEvent.click(screen.getByTestId('syschk-memberships-src-redemption_ledger_mismatch'));
    expect(posSystemChecksApi.rows).toHaveBeenCalledWith('memberships', 'redemption_ledger_mismatch');
    const row = await screen.findByTestId('syschk-memberships-src-redemption_ledger_mismatch-row');
    expect(row).toHaveTextContent(/Redemptions vs ledger.*#M-0042 · Mem Ber.*#1007.*—.*1 redemption record\(s\) vs 2 ledger entry\(ies\)/);
    fireEvent.click(screen.getByTestId('syschk-memberships-src-payment_pending_stuck'));
    const pay = await screen.findByTestId('syschk-memberships-src-payment_pending_stuck-row');
    expect(pay).toHaveTextContent(/Membership payment.*Ann.*\$49\.00.*Pending/);
    expect(screen.getByTestId('syschk-memberships-src-payment_pending_stuck-table')).toHaveTextContent('Showing the newest 25; more exist.');
  });
});
