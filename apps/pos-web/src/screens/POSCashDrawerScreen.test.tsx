import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../api/posCashDrawerApi', async (orig) => ({ ...(await orig<typeof import('../api/posCashDrawerApi')>()), posCashDrawerApi: { registers: vi.fn(), state: vi.fn(), open: vi.fn(), reconcile: vi.fn(), movement: vi.fn(), movements: vi.fn(), voidMovement: vi.fn(), approve: vi.fn(), history: vi.fn() } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../components/AiAssistantPanel', () => ({ AiAssistantPanel: () => <div data-testid="money-protection" /> }));
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
    (posCashDrawerApi.history as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, pages: 1 });
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
    expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(17650, undefined, TODAY, expect.any(String), 'main', { expectedCashCents: 17650, denominations: undefined });   // D15 gaps: the expected cash the counter saw   // D15: an Idempotency-Key per count
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
    await waitFor(() => expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(17650, undefined, TODAY, expect.any(String), 'st-front', expect.objectContaining({ expectedCashCents: 17650 })));
  });

  it('a location with no registers set up shows no picker (one drawer, as before)', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    expect(screen.queryByLabelText('Register')).toBeNull();
  });

  it('D15 gaps: count by bills and coins, a manager signs off a large difference, and the history lists past drawers', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.reconcile as any).mockResolvedValue(drawer({ countedCents: 12000, varianceCents: -5650, status: 'discrepancy', approvalRequired: true, approvedAt: null, denominations: { '10000': 1, '1000': 2 } }));
    (posCashDrawerApi.approve as any).mockResolvedValue(drawer({ countedCents: 12000, varianceCents: -5650, status: 'discrepancy', approvalRequired: true, approvedAt: '2026-06-16T22:00:00Z', approvedBy: 'Mo Manager', approvalNote: 'Change given twice' }));
    (posCashDrawerApi.history as any).mockResolvedValue({ items: [{ businessDate: '2026-06-15', registerId: 'main', register: null, status: 'reconciled', openingFloatCents: 10000, expectedCashCents: 15000, countedCents: 15000, varianceCents: 0, countedAt: null, countedBy: 'Fran Desk', notes: 'all good', approvalRequired: false, approvedAt: null, approvedBy: null, approvalNote: null, denominations: null }], total: 11, page: 1, pageSize: 10, pages: 2 });
    render(<POSCashDrawerScreen />);
    expect(await screen.findByTestId('hist-row')).toHaveTextContent('Fran Desk');
    expect(screen.getByTestId('hist-pager').querySelectorAll('button')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('by-denom'));
    fireEvent.change(screen.getByTestId('denom-10000'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('denom-1000'), { target: { value: '2' } });
    expect((screen.getByTestId('count-input') as HTMLInputElement).value).toBe('120.00');
    fireEvent.click(screen.getByText('Reconcile'));
    await waitFor(() => expect(posCashDrawerApi.reconcile).toHaveBeenCalledWith(12000, undefined, TODAY, expect.any(String), 'main', { expectedCashCents: 17650, denominations: { '10000': 1, '1000': 2 } }));
    expect(await screen.findByTestId('needs-review')).toBeTruthy();
    fireEvent.change(screen.getByTestId('sign-note'), { target: { value: 'Change given twice' } });
    fireEvent.click(screen.getByTestId('sign-off'));
    expect(await screen.findByTestId('signed-off')).toHaveTextContent('Mo Manager');
    fireEvent.change(screen.getByTestId('hist-status'), { target: { value: 'needs_review' } });
    await waitFor(() => expect(posCashDrawerApi.history).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'needs_review', page: 1 })));
  });

  it('D15 gaps: a history row opens the day — counts, sign-off, and that day\'s cash in / out; Money Protection sits at the bottom', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.history as any).mockResolvedValue({ items: [{ businessDate: '2026-06-15', registerId: 'main', register: null, status: 'discrepancy', openingFloatCents: 10000, expectedCashCents: 15000, countedCents: 12000, varianceCents: -3000, countedAt: null, countedBy: 'Fran Desk', notes: null, approvalRequired: true, approvedAt: '2026-06-15T23:00:00Z', approvedBy: 'Mo Manager', approvalNote: 'Change given twice', denominations: { '10000': 1, '1000': 2 } }], total: 1, page: 1, pageSize: 10, pages: 1 });
    (posCashDrawerApi.movements as any).mockImplementation(async (date?: string) => ({ businessDate: date, movements: date === '2026-06-15' ? [{ id: 'm1', direction: 'out', amountCents: 2000, reason: 'Supplies', note: null, createdAt: null, voided: false }] : [] }));
    const { container } = render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByTestId('hist-row'));
    const ov = await screen.findByTestId('hist-overlay');
    expect(ov).toHaveTextContent('Mo Manager'); expect(ov).toHaveTextContent('$100 × 1');
    expect(await screen.findByTestId('hist-overlay-move')).toHaveTextContent('Supplies');
    expect(posCashDrawerApi.movements).toHaveBeenCalledWith('2026-06-15', 'main');
    fireEvent.click(screen.getByTestId('hist-overlay-close'));
    expect(screen.queryByTestId('hist-overlay')).toBeNull();
    const work = container.querySelector('.work')!;
    expect(work.lastElementChild?.getAttribute('data-testid')).toBe('money-protection');
  });
});
