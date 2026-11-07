// Payments & Money → End-of-Day Cash (Oct 29 2026 one-screen rebuild): the five server KPIs and the difference strip, one row per
// technician and business day, the count overlay (full count / partial hand-off, count sheet, the version seen, one key per
// submission), the version conflict, a manager's resolution, and honest error / permission states.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), technicians: vi.fn(), unit: vi.fn(), exportCsv: vi.fn(), reconcile: vi.fn(), resolve: vi.fn(), state: vi.fn(), detail: vi.fn() }));
vi.mock('../api/posCashHandoffApi', () => ({ posCashHandoffApi: api }));
import { POSCashHandoffScreen } from './POSCashHandoffScreen';

const PERIOD = { preset: 'today', from: '2026-10-29', to: '2026-10-29', tz: 'America/New_York', today: '2026-10-29' };
const summary = { period: PERIOD, basis: 'business', permissions: { count: true, resolve: true, export: true, customer: true },
  kpis: { expectedCents: 67000, countedCents: 54500, technicians: 4, reconciled: 1, awaiting: 2, units: 4, submitted: 0, underReview: 1, resolved: 0, payments: 5 },
  difference: { totalCents: -500, shortUnits: 1, shortCents: -500, overUnits: 0, overCents: 0, balancedUnits: 1, uncountedExpectedCents: 12000, transferredCents: 0 } };
const u = (o: Record<string, unknown>) => ({ id: 'h1', technicianId: 't1', technician: 'Bao Tran', technicianActive: true, businessDate: '2026-10-29', branch: 'Main', expectedCents: 25000, paymentCount: 1, countedCents: 24500, differenceCents: -500,
  status: 'discrepancy', state: 'short', version: 2, drawerTransferCents: 0, submittedAt: null, countedAt: '2026-10-29T23:00:00Z', resolvedAt: null, createdAt: '2026-10-29T23:00:00Z', updatedAt: null, countedBy: 'Vy', resolvedBy: null, notes: null, resolutionReason: null, ...o });
const mai = u({ id: null, technicianId: 't4', technician: 'Mai Nguyen', expectedCents: 4000, countedCents: null, differenceCents: null, status: 'open', state: 'open', version: 0 });
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1, period: PERIOD });
const mount = () => render(<MemoryRouter><POSCashHandoffScreen /></MemoryRouter>);
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.summary.mockResolvedValue(summary); api.list.mockResolvedValue(pageOf([u({}), mai])); api.technicians.mockResolvedValue([{ id: 't1', name: 'Bao Tran', active: true }, { id: 't4', name: 'Mai Nguyen', active: true }]); });

describe('POSCashHandoffScreen', () => {
  it('shows the server KPIs and the difference strip; Today is the default period', async () => {
    mount();
    expect(await screen.findByTestId('kpi-expected')).toHaveTextContent('$670.00');
    expect(screen.getByTestId('kpi-awaiting')).toHaveTextContent('2'); expect(screen.getByTestId('difference-strip')).toHaveTextContent('−$5.00');
    await waitFor(() => expect(api.list.mock.calls[0][0]).toMatchObject({ preset: 'today', dateField: 'business', sort: 'created_desc' }));
    expect(screen.getAllByTestId('handoff-row')[0]).toHaveTextContent('Short');
  });
  it('a partial hand-off is sent as mode add with the version seen and an idempotency key', async () => {
    api.unit.mockResolvedValue({ unit: mai, lines: [], events: [], drawerMovements: [], audit: [], permissions: { count: true } });
    api.reconcile.mockResolvedValue({ technicianName: 'Mai Nguyen', countedCents: 2500, result: { status: 'discrepancy', varianceCents: -1500, version: 1, eventId: 'e', drawerMovementId: null, replayed: false } });
    mount(); await screen.findAllByTestId('handoff-row');
    fireEvent.click(screen.getAllByTestId('count')[1]); await screen.findByTestId('count-figures');
    fireEvent.click(screen.getByTestId('mode-add')); fireEvent.change(screen.getByTestId('amount'), { target: { value: '25' } });
    expect(screen.getByTestId('save-count')).toBeDisabled();   // a difference needs a reason
    fireEvent.change(screen.getByTestId('notes'), { target: { value: 'First half' } }); fireEvent.click(screen.getByTestId('save-count'));
    await waitFor(() => expect(api.reconcile).toHaveBeenCalled());
    const [tech, body] = api.reconcile.mock.calls[0];
    expect(tech).toBe('t4'); expect(body).toMatchObject({ countedCents: 2500, mode: 'add', date: '2026-10-29', expectedVersion: 0 }); expect(typeof body.idempotencyKey).toBe('string');
  });
  it('a version conflict keeps the dialog open and says someone else saved first', async () => {
    api.unit.mockResolvedValue({ unit: u({}), lines: [], events: [], drawerMovements: [], audit: [], permissions: { count: true } });
    api.reconcile.mockRejectedValue(Object.assign(new Error('changed'), { status: 409, code: 'HANDOFF_VERSION_CONFLICT' }));
    mount(); await screen.findAllByTestId('handoff-row');
    fireEvent.click(screen.getAllByTestId('count')[0]); await screen.findByTestId('count-figures');
    fireEvent.change(screen.getByTestId('amount'), { target: { value: '250' } }); fireEvent.click(screen.getByTestId('save-count'));
    expect(await screen.findByTestId('conflict')).toHaveTextContent(/Someone else saved a count first/);
  });
  it('resolving needs a reason and sends the version', async () => {
    api.resolve.mockResolvedValue({});
    mount(); await screen.findAllByTestId('handoff-row');
    fireEvent.click(screen.getByTestId('review')); expect(screen.getByTestId('save-resolve')).toBeDisabled();
    fireEvent.change(screen.getByTestId('resolve-reason'), { target: { value: 'Recounted' } }); fireEvent.click(screen.getByTestId('save-resolve'));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('t1', { reason: 'Recounted', date: '2026-10-29', expectedVersion: 2 }, expect.any(String)));
  });
  it('a read failure is an error state, never a verified $0; 403 is a permission state', async () => {
    api.summary.mockRejectedValue({ status: 503 }); api.list.mockRejectedValue({ status: 503 });
    const { unmount } = mount(); expect((await screen.findAllByText(/could not be reached/i)).length).toBeGreaterThan(0); expect(screen.queryByTestId('kpi-expected')).toBeNull(); unmount();
    api.summary.mockRejectedValue({ status: 403 }); api.list.mockRejectedValue({ status: 403 });
    mount(); expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument(); expect(screen.queryByTestId('record-handoff')).toBeNull();
  });
  it('a link from the Cash Drawer (?date=) opens that business day, and Cash Drawer goes back to the same day (Nov 7 2026)', async () => {
    render(<MemoryRouter initialEntries={['/cash-handoffs?date=2026-11-05']}><POSCashHandoffScreen /></MemoryRouter>);
    await waitFor(() => expect(api.list.mock.calls[0][0]).toMatchObject({ preset: 'custom', from: '2026-11-05', to: '2026-11-05' }));
    expect(await screen.findByTestId('open-drawer')).toBeTruthy();
  });
});
