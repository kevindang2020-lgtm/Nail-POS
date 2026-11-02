// OwnerCashSummaryScreen (owner money oversight, read-only): end-of-day total cash = register drawer pool + technician
// cash pool. Verifies the total position + balanced/over/short label, each pool's variance sign (+ for over, − for short),
// the reconciled/discrepancy/awaiting counts, the CSV-export wiring (pulls drawer + handoff and builds the report), and 403.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('./cashReportCsv', () => ({ buildCashReportCsv: vi.fn(() => 'col1,col2\n1,2') }));
vi.mock('../api/ownerApi', () => ({
  ownerCashSummaryApi: { state: vi.fn() },
  ownerCashDrawerApi: { state: vi.fn() },
  ownerCashHandoffApi: { state: vi.fn() },
}));

import { ownerCashSummaryApi, ownerCashDrawerApi, ownerCashHandoffApi } from '../api/ownerApi';
import { buildCashReportCsv } from './cashReportCsv';
import { OwnerCashSummaryScreen } from './OwnerCashSummaryScreen';

const pool = (over: any = {}) => ({ expectedCents: 0, countedCents: 0, varianceCents: 0, unitCount: 1, reconciledCount: 0, discrepancyCount: 0, awaitingCount: 0, ...over });
const summary = (over: any = {}) => ({
  businessDate: '2026-06-17',
  register: pool({ expectedCents: 80000, countedCents: 80300, varianceCents: 300, unitCount: 2, reconciledCount: 1, discrepancyCount: 1 }),
  techCash: pool({ expectedCents: 13300, countedCents: 13000, varianceCents: -300, unitCount: 3, reconciledCount: 2, discrepancyCount: 1 }),
  total: { expectedCents: 93300, countedCents: 93300, varianceCents: 0 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCashSummaryApi.state as any).mockResolvedValue(summary());
  (ownerCashDrawerApi.state as any).mockResolvedValue({ businessDate: '2026-06-17', branches: [{ branchId: 'a' }] });
  (ownerCashHandoffApi.state as any).mockResolvedValue({ businessDate: '2026-06-17', technicians: [{ technicianId: 't' }] });
  (global.URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (global.URL as any).revokeObjectURL = vi.fn();
});

describe('OwnerCashSummaryScreen', () => {
  it('shows the total position and a balanced label when register over offsets tech short', async () => {
    render(<OwnerCashSummaryScreen />);
    expect(await screen.findByText('Balanced — counted matches expected')).toBeInTheDocument();
  });

  it('labels each pool variance with the correct sign', async () => {
    render(<OwnerCashSummaryScreen />);
    await screen.findByText('Balanced — counted matches expected');
    expect(screen.getByText('+$3.00')).toBeInTheDocument();   // register: counted > expected (over)
    expect(screen.getByText('−$3.00')).toBeInTheDocument();   // tech cash: counted < expected (short)
  });

  it('shows the reconciled / discrepancy / awaiting counts per pool', async () => {
    render(<OwnerCashSummaryScreen />);
    await screen.findByText('Balanced — counted matches expected');
    expect(screen.getByText('1 reconciled · 1 discrepancy · 0 awaiting')).toBeInTheDocument();   // register
    expect(screen.getByText('2 reconciled · 1 discrepancy · 0 awaiting')).toBeInTheDocument();   // tech
  });

  it('shows Over/Short at the total when the day does not balance', async () => {
    (ownerCashSummaryApi.state as any).mockResolvedValue(summary({ total: { expectedCents: 93300, countedCents: 93550, varianceCents: 250 } }));
    render(<OwnerCashSummaryScreen />);
    expect(await screen.findByText('Over $2.50')).toBeInTheDocument();
  });

  it('builds the CSV from the drawer + handoff detail on export', async () => {
    render(<OwnerCashSummaryScreen />);
    await screen.findByText('Balanced — counted matches expected');
    fireEvent.click(screen.getByText('Download CSV'));
    await waitFor(() => {
      expect(ownerCashDrawerApi.state).toHaveBeenCalled();
      expect(ownerCashHandoffApi.state).toHaveBeenCalled();
      expect(buildCashReportCsv).toHaveBeenCalledWith(expect.objectContaining({ businessDate: '2026-06-17' }), [{ branchId: 'a' }], [{ technicianId: 't' }]);
    });
  });

  it('shows a friendly message on a 403', async () => {
    (ownerCashSummaryApi.state as any).mockRejectedValue({ status: 403 });
    render(<OwnerCashSummaryScreen />);
    expect(await screen.findByText('You do not have access to the cash summary.')).toBeInTheDocument();
  });
});
