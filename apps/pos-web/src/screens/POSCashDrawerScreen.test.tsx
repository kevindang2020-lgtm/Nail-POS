import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../api/posCashDrawerApi', async (orig) => ({ ...(await orig<typeof import('../api/posCashDrawerApi')>()), posCashDrawerApi: { state: vi.fn(), open: vi.fn(), reconcile: vi.fn(), movement: vi.fn(), movements: vi.fn(), voidMovement: vi.fn() } }));
import { posCashDrawerApi } from '../api/posCashDrawerApi';
import { POSCashDrawerScreen } from './POSCashDrawerScreen';
const TODAY = new Date().toISOString().slice(0, 10);

const drawer = (over: Record<string, unknown> = {}) => ({
  branchId: 'b1', businessDate: '2026-06-16',
  openingFloatCents: 10000, expectedSalesCents: 7650, refundsCents: 0, paidInCents: 0, paidOutCents: 0, expectedCashCents: 17650,
  countedCents: null, varianceCents: null, cashPaymentCount: 2, status: 'open', openedAt: null, reconciledAt: null, notes: null,
  ...over,
});

describe('POSCashDrawerScreen (register reconciliation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (posCashDrawerApi.movements as any).mockResolvedValue({ businessDate: '2026-06-16', movements: [] });
    (posCashDrawerApi.voidMovement as any).mockResolvedValue(drawer());
  });

  it('shows the expected-cash breakdown', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    expect(await screen.findByText('Cash Drawer')).toBeTruthy();
    expect(screen.getAllByText('$176.50').length).toBeGreaterThan(0); // expected in drawer
    expect(screen.getByText('$100.00')).toBeTruthy();                  // float KPI
  });

  it('reconciles the counted cash', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.reconcile as any).mockResolvedValue(drawer({ countedCents: 17650, varianceCents: 0, status: 'reconciled' }));
    render(<POSCashDrawerScreen />);
    const input = await screen.findByLabelText(/Counted cash/);
    fireEvent.change(input, { target: { value: '176.50' } });
    fireEvent.click(screen.getByText('Reconcile'));
    expect(await screen.findByText(/matched \$176.50/)).toBeTruthy();
    expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(17650, undefined, TODAY);
  });

  it('voids a movement from the list', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movements as any).mockResolvedValue({ businessDate: '2026-06-16', movements: [{ id: 'mv1', direction: 'out', amountCents: 500, reason: 'petty', note: null, createdAt: null, voided: false }] });
    (posCashDrawerApi.voidMovement as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByText('Void'));
    await waitFor(() => expect(posCashDrawerApi.voidMovement).toHaveBeenCalledWith('mv1', TODAY));
  });

  it('records a cash-out movement', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movement as any).mockResolvedValue(drawer({ paidOutCents: 500, expectedCashCents: 17150 }));
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    fireEvent.click(screen.getByText('Cash out'));                        // direction
    fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: '5.00' } });
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(posCashDrawerApi.movement).toHaveBeenCalledWith('out', 500, undefined, undefined, TODAY));
  });
});
