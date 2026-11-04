import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../api/posCashDrawerApi', async (orig) => ({ ...(await orig<typeof import('../api/posCashDrawerApi')>()), posCashDrawerApi: { registers: vi.fn(), state: vi.fn(), open: vi.fn(), reconcile: vi.fn(), movement: vi.fn(), movements: vi.fn(), voidMovement: vi.fn() } }));
import { posCashDrawerApi } from '../api/posCashDrawerApi';
import { POSCashDrawerScreen } from './POSCashDrawerScreen';
// the screen uses the business date the SERVER names (the branch's day), never the browser's UTC date (audit Nov 3 2026)
const TODAY = '2026-06-16';

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
    (posCashDrawerApi.registers as any).mockResolvedValue({ registers: [{ registerId: 'main', name: 'Main register' }] });
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
    expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(17650, undefined, TODAY, expect.any(String), 'main');   // D15: an Idempotency-Key per count
  });

  it('voids a movement from the list', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movements as any).mockResolvedValue({ businessDate: '2026-06-16', movements: [{ id: 'mv1', direction: 'out', amountCents: 500, reason: 'petty', note: null, createdAt: null, voided: false }] });
    (posCashDrawerApi.voidMovement as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByText('Void'));
    await waitFor(() => expect(posCashDrawerApi.voidMovement).toHaveBeenCalledWith('mv1', TODAY, 'main'));
  });

  it('records a cash-out movement', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movement as any).mockResolvedValue(drawer({ paidOutCents: 500, expectedCashCents: 17150 }));
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    fireEvent.click(screen.getByText('Cash out'));                        // direction
    fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: '5.00' } });
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(posCashDrawerApi.movement).toHaveBeenCalledWith('out', 500, undefined, undefined, TODAY, expect.any(String), 'main'));
  });

  it('a cash-out that failed and is retried reuses its Idempotency-Key (recorded once); the next cash-out gets a new key (D15)', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movement as any).mockReset();
    (posCashDrawerApi.movement as any).mockRejectedValueOnce(new Error('network')).mockResolvedValue(drawer({ paidOutCents: 500, expectedCashCents: 17150 }));
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    fireEvent.click(screen.getByText('Cash out'));
    fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: '5.00' } });
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(posCashDrawerApi.movement).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByText('Record') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(posCashDrawerApi.movement).toHaveBeenCalledTimes(2));
    const calls = (posCashDrawerApi.movement as any).mock.calls;
    expect(calls[1][5]).toBe(calls[0][5]);
    fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: '5.00' } });
    fireEvent.click(screen.getByText('Record'));
    await waitFor(() => expect(posCashDrawerApi.movement).toHaveBeenCalledTimes(3));
    expect((posCashDrawerApi.movement as any).mock.calls[2][5]).not.toBe(calls[0][5]);
  });

  it('D15 (Nov 4 2026): with registers set up, each register has its own drawer — picking one reads and counts that one', async () => {
    (posCashDrawerApi.registers as any).mockResolvedValue({ registers: [{ registerId: 'main', name: 'Unassigned cash' }, { registerId: 'st-back', name: 'Back' }, { registerId: 'st-front', name: 'Front' }] });
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.reconcile as any).mockResolvedValue(drawer({ countedCents: 17650, varianceCents: 0, status: 'reconciled' }));
    render(<POSCashDrawerScreen />);
    const pick = await screen.findByLabelText('Register');
    expect(screen.getByText('Cash with no register')).toBeTruthy();
    fireEvent.change(pick, { target: { value: 'st-front' } });
    await waitFor(() => expect(posCashDrawerApi.state).toHaveBeenCalledWith(TODAY, 'st-front'));
    await waitFor(() => expect(posCashDrawerApi.movements).toHaveBeenCalledWith(TODAY, 'st-front'));
    fireEvent.change(await screen.findByLabelText(/Counted cash/), { target: { value: '176.50' } });
    fireEvent.click(screen.getByText('Reconcile'));
    await waitFor(() => expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(17650, undefined, TODAY, expect.any(String), 'st-front'));
  });

  it('a location with no registers set up shows no picker (one drawer, as before)', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    expect(screen.queryByLabelText('Register')).toBeNull();
  });
});
