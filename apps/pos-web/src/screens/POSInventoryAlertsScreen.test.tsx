import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, ackMock } = vi.hoisted(() => ({ listMock: vi.fn(), ackMock: vi.fn() }));
vi.mock('../api/posInventoryAlertsApi', () => ({ posInventoryAlertsApi: { list: listMock, acknowledge: ackMock } }));
import { POSInventoryAlertsScreen } from './POSInventoryAlertsScreen';
beforeEach(() => { listMock.mockReset(); ackMock.mockReset(); });

const alert = (o: any = {}) => ({ id: 'a1', product_id: 'p1', product_name: 'Gel Polish Red', color_number: '204', status: 'out_of_stock', on_hand: 0, created_at: '2026-07-06T10:00:00Z', acknowledged_at: null, ...o });
const resp = (alerts: any[]) => ({ alerts, openCount: alerts.filter((a) => !a.acknowledged_at).length });

describe('POSInventoryAlertsScreen', () => {
  it('renders alert KPIs + rows by severity', async () => {
    listMock.mockResolvedValue(resp([alert(), alert({ id: 'a2', product_name: 'Base Coat', status: 'critical', on_hand: 2, color_number: null })]));
    render(<POSInventoryAlertsScreen />);
    expect(await screen.findByRole('heading', { name: 'Stock Alerts' })).toBeInTheDocument();
    expect(screen.getByText(/Gel Polish Red/)).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
  });
  it('acknowledges an alert and refreshes', async () => {
    listMock.mockResolvedValueOnce(resp([alert()]));
    ackMock.mockResolvedValue({ ok: true });
    listMock.mockResolvedValueOnce(resp([alert({ acknowledged_at: '2026-07-06T11:00:00Z' })]));
    render(<POSInventoryAlertsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(ackMock).toHaveBeenCalledWith('a1'));
  });
  it('shows a healthy empty state', async () => {
    listMock.mockResolvedValue(resp([]));
    render(<POSInventoryAlertsScreen />);
    expect(await screen.findByText(/inventory is healthy/)).toBeInTheDocument();
  });
  it('toggling "show acknowledged" re-queries with the flag', async () => {
    listMock.mockResolvedValue(resp([alert()]));
    render(<POSInventoryAlertsScreen />);
    await screen.findByText(/Gel Polish Red/);
    fireEvent.click(screen.getByLabelText(/Show acknowledged/i));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(true));
  });
});
