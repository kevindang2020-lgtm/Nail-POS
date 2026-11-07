import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
// the screen links to End-of-Day Cash (Nov 7 2026), so it renders inside a router
const render = (ui: ReactElement, path = '/cash-drawer') => rtlRender(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../api/posCashDrawerApi', async (orig) => ({ ...(await orig<typeof import('../api/posCashDrawerApi')>()), posCashDrawerApi: { registers: vi.fn(), state: vi.fn(), open: vi.fn(), reconcile: vi.fn(), movement: vi.fn(), movements: vi.fn(), voidMovement: vi.fn(), approve: vi.fn(), history: vi.fn(), activity: vi.fn() } }));
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

const activity = (items: any[], over: Record<string, unknown> = {}) => ({ preset: 'session', from: TODAY, to: TODAY, items, totals: { cashInCents: items.reduce((a, r) => a + (r.state === 'voided' ? 0 : r.cashInCents), 0), cashOutCents: items.reduce((a, r) => a + (r.state === 'voided' ? 0 : r.cashOutCents), 0) }, total: items.length, page: 1, pageSize: 3, pages: 1, ...over });
const row = (over: Record<string, unknown>) => ({ kind: 'sale', id: 'r1', businessDate: TODAY, at: '2026-06-16T15:00:00Z', cashInCents: 0, cashOutCents: 0, state: 'approved', reason: null, ticketId: null, ticketNumber: null, customer: null, employee: null, ...over });

describe('POSCashDrawerScreen (register reconciliation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (posCashDrawerApi.movements as any).mockResolvedValue({ businessDate: '2026-06-16', movements: [] });
    (posCashDrawerApi.voidMovement as any).mockResolvedValue(drawer());
    (posCashDrawerApi.registers as any).mockResolvedValue({ registers: [{ registerId: 'main', name: 'Main register' }] });
    (posCashDrawerApi.history as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, pages: 1 });
    (posCashDrawerApi.activity as any).mockResolvedValue(activity([]));
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
    (posCashDrawerApi.activity as any).mockResolvedValue(activity([row({ kind: 'cash_out', id: 'mv1', cashOutCents: 500, state: 'recorded', reason: 'petty', employee: 'Fran Desk' })]));
    (posCashDrawerApi.voidMovement as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByTestId('act-void'));
    await waitFor(() => expect(posCashDrawerApi.voidMovement).toHaveBeenCalledWith('mv1', TODAY, 'main'));
  });

  it('records a cash-out movement', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.movement as any).mockResolvedValue(drawer({ paidOutCents: 500, expectedCashCents: 17150 }));
    render(<POSCashDrawerScreen />);
    await screen.findByText('Cash Drawer');
    fireEvent.click(screen.getByRole('button', { name: 'Cash out' }));                        // direction
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
    fireEvent.click(screen.getByRole('button', { name: 'Cash out' }));
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
    await waitFor(() => expect(posCashDrawerApi.activity).toHaveBeenCalledWith(expect.objectContaining({ registerId: 'st-front', date: TODAY })));   // the register's own ledger
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
    fireEvent.click(await screen.findByTestId('tab-history'));
    expect(await screen.findByTestId('hist-row')).toHaveTextContent('Fran Desk');
    expect(screen.getByTestId('hist-pager').querySelector('[aria-current="page"]')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('by-denom'));
    fireEvent.change(screen.getByTestId('denom-10000'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('denom-1000'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('denom-use'));
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
    fireEvent.click(await screen.findByTestId('tab-history'));
    fireEvent.click(await screen.findByTestId('hist-row'));
    const ov = await screen.findByTestId('hist-overlay');
    expect(ov).toHaveTextContent('Mo Manager'); expect(ov).toHaveTextContent('$100 × 1');
    expect(await screen.findByTestId('hist-overlay-move')).toHaveTextContent('Supplies');
    expect(posCashDrawerApi.movements).toHaveBeenCalledWith('2026-06-15', 'main');
    fireEvent.click(screen.getByTestId('hist-overlay-close'));
    expect(screen.queryByTestId('hist-overlay')).toBeNull();
    const work = container.querySelector('.work')!;
    expect(work.lastElementChild?.firstElementChild?.getAttribute('data-testid')).toBe('money-protection');   // the AI strip is the screen's last block
  });

  it('SUNMI addendum (Nov 7 2026): Variance reads "Pending count" until the drawer is counted — never a verified $0.00', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    expect(await screen.findByTestId('kpi-variance')).toHaveTextContent('Pending count');
  });

  it('SUNMI addendum §08: the Cash Drawer Activity ledger lists every cash event with its customer, employee and ticket; a row opens its details', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.activity as any).mockResolvedValue(activity([
      row({ id: 'p1', cashInCents: 4500, ticketNumber: '1042', customer: 'Nina Ortiz', employee: 'Rosa Front' }),
      row({ kind: 'float', id: 's1', cashInCents: 10000, state: 'open', employee: 'Rosa Front' }),
    ]));
    render(<POSCashDrawerScreen />);
    const rows = await screen.findAllByTestId('act-row');
    expect(rows[0]).toHaveTextContent('Cash sale'); expect(rows[0]).toHaveTextContent('Nina Ortiz'); expect(rows[0]).toHaveTextContent('#1042'); expect(rows[0]).toHaveTextContent('$45.00');
    expect(rows[1]).toHaveTextContent('Opening float');
    expect(screen.getByTestId('act-totals')).toHaveTextContent('net $145.00');
    await waitFor(() => expect(posCashDrawerApi.activity).toHaveBeenCalledWith(expect.objectContaining({ registerId: 'main', preset: 'session', date: TODAY, page: 1 })));
    fireEvent.click(rows[0]);
    expect(await screen.findByTestId('act-overlay')).toHaveTextContent('Rosa Front');
  });

  it('SUNMI addendum §09: one search box and a period — each re-asks the server from page 1', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    await screen.findByTestId('act-search');
    fireEvent.change(screen.getByTestId('act-search'), { target: { value: '#1042' } });
    await waitFor(() => expect(posCashDrawerApi.activity).toHaveBeenLastCalledWith(expect.objectContaining({ q: '#1042', page: 1 })));
    fireEvent.click(screen.getByTestId('preset-week'));
    await waitFor(() => expect(posCashDrawerApi.activity).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'week', q: '#1042' })));
    fireEvent.change(screen.getByTestId('act-kind'), { target: { value: 'cash_out' } });
    await waitFor(() => expect(posCashDrawerApi.activity).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cash_out' })));
  });

  it('a ledger that fails to load says so — it never reads as "no movements"', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.activity as any).mockRejectedValue(new Error('db down'));
    render(<POSCashDrawerScreen />);
    expect(await screen.findByText('db down')).toBeTruthy();
  });

  it('AI Fraud / Money Protection sits after the activity ledger (original guide: moved to the bottom)', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    render(<POSCashDrawerScreen />);
    const ledger = await screen.findByTestId('drawer-activity'); const ai = screen.getByTestId('money-protection');
    expect(ledger.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the day named in the address (from End-of-Day Cash) and links to that day\'s Daily Closeout', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer({ businessDate: '2026-06-14' }));
    render(<POSCashDrawerScreen />, '/cash-drawer?date=2026-06-14');
    await waitFor(() => expect(posCashDrawerApi.state).toHaveBeenCalledWith('2026-06-14', 'main'));
    expect(await screen.findByTestId('open-closeout')).toBeTruthy();
  });

  it('Check drawer (read-only): the activity adds up to Expected; an earlier uncounted drawer and a pending sign-off are flagged', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.activity as any).mockResolvedValue(activity([row({ id: 'p1', cashInCents: 7650 }), row({ kind: 'float', id: 's1', cashInCents: 10000, state: 'open' })]));
    (posCashDrawerApi.history as any).mockImplementation(async (q: any) => q.status === 'open'
      ? { items: [{ businessDate: '2026-06-12', registerId: 'main', status: 'open' }, { businessDate: TODAY, registerId: 'main', status: 'open' }], total: 2, page: 1, pageSize: 50, pages: 1 }
      : q.status === 'needs_review' ? { items: [{ businessDate: '2026-06-10', registerId: 'main', status: 'discrepancy', approvalRequired: true, approvedAt: null }], total: 1, page: 1, pageSize: 50, pages: 1 }
      : { items: [], total: 0, page: 1, pageSize: 10, pages: 1 });
    render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByTestId('drawer-check'));
    await screen.findByTestId('drawer-checks');
    expect(screen.getByTestId('chk-ledger').getAttribute('data-state')).toBe('pass');      // 7650 + 10000 = 17650 = expected
    expect(screen.getByTestId('chk-count').getAttribute('data-state')).toBe('warn');       // not counted yet
    expect(screen.getByTestId('chk-stale')).toHaveTextContent('2026-06-12');               // an earlier day, never counted
    expect(screen.getByTestId('chk-stale')).not.toHaveTextContent(TODAY);
    expect(screen.getByTestId('chk-review')).toHaveTextContent('2026-06-10');
    for (const f of ['open', 'reconcile', 'movement', 'voidMovement', 'approve']) expect((posCashDrawerApi as any)[f]).not.toHaveBeenCalled();   // read-only
  });

  it('Check drawer: an activity that does not add up to Expected is a Problem', async () => {
    (posCashDrawerApi.state as any).mockResolvedValue(drawer());
    (posCashDrawerApi.activity as any).mockResolvedValue(activity([row({ id: 'p1', cashInCents: 100 })]));
    render(<POSCashDrawerScreen />);
    fireEvent.click(await screen.findByTestId('drawer-check'));
    const l = await screen.findByTestId('chk-ledger');
    expect(l.getAttribute('data-state')).toBe('fail'); expect(l).toHaveTextContent('$176.50');
  });
});
