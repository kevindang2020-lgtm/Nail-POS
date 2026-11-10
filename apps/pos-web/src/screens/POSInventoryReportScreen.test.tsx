// batch 9 guide 11 (Nov 10 2026): the cards read the Inventory metrics (expired apart), health notes, paged reorder + history
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { metricsMock, productsMock, movesMock } = vi.hoisted(() => ({ metricsMock: vi.fn(), productsMock: vi.fn(), movesMock: vi.fn() }));
vi.mock('../api/posInventoryReportApi', () => ({ posInventoryReportApi: { metrics: metricsMock, products: productsMock, movements: movesMock } }));
import { POSInventoryReportScreen } from './POSInventoryReportScreen';

const metrics = (over: Record<string, unknown> = {}) => ({ asOf: '2026-11-10T15:00:00Z', timeZone: 'America/New_York', today: '2026-11-10', products: 11, bottles: 140, lowStock: 11, critical: 11, outOfStock: 0, needReorder: 11,
  expiringSoon: 128, expired: 6, expiryHorizonDays: 30, stockDrift: 2, inventoryValueCents: 12150, productsWithoutCost: 1, definitions: { expiringSoon: 'Usable bottles whose expiration date is within 30 days' }, ...over });
const prods = { total: 11, page: 1, pageSize: 25, pages: 1, rows: [{ id: 'p1', name: 'OPI Gel Color - Alpine Snow', colorNumber: 'L00', sku: 'OPI-L00', onHand: 1, severity: 'critical', suggestedReorder: 9, unit: 'bottle', expired: 1, expiring: 2 }] };
const moves = { total: 1, page: 1, pageSize: 25, pages: 1, period: { from: '2026-11-01', to: '2026-11-10', tz: 'America/New_York', today: '2026-11-10' },
  rows: [{ id: 'm1', productId: 'p1', product: 'OPI Gel Color - Alpine Snow', type: 'service_use', before: 2, change: -1, after: 1, reason: null, at: '2026-11-09T15:00:00Z', actor: 'Lisa T', poNumber: null }] };
beforeEach(() => { metricsMock.mockReset(); productsMock.mockReset(); movesMock.mockReset(); productsMock.mockResolvedValue(prods); movesMock.mockResolvedValue(moves); });
const at = () => render(<MemoryRouter initialEntries={['/tenant/reports/inventory']}><POSInventoryReportScreen /></MemoryRouter>);

describe('POSInventoryReportScreen', () => {
  it('keeps the five cards; Expiring Soon is bottles and expired bottles are counted apart; health notes are specific', async () => {
    metricsMock.mockResolvedValue(metrics());
    at();
    expect(await screen.findByText('$121.50')).toBeInTheDocument();
    expect(screen.getByTestId('inv-expiring')).toHaveTextContent('128');
    expect(screen.getByTestId('inv-critical')).toHaveTextContent('11 critical');
    expect(screen.getByTestId('inv-h-expired')).toHaveTextContent('6 expired bottles');
    expect(screen.getByTestId('inv-h-drift')).toHaveTextContent('2 products');
    expect(screen.getByTestId('inv-h-nocost')).toBeInTheDocument();
  });
  it('Reorder Attention is server-paged and searched; a status chip narrows it', async () => {
    metricsMock.mockResolvedValue(metrics());
    at();
    expect(await screen.findByText('OPI-L00')).toBeInTheDocument();
    expect(productsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_reorder', sort: 'critical', page: 1 }));
    fireEvent.click(screen.getByTestId('inv-st-out_of_stock'));
    await waitFor(() => expect(productsMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'out_of_stock', page: 1 })));
    fireEvent.change(screen.getByTestId('inv-search'), { target: { value: 'L00' } });
    await waitFor(() => expect(productsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'L00' })));
  });
  it('the stock-movement history is newest first for the chosen period', async () => {
    metricsMock.mockResolvedValue(metrics({ expired: 0, stockDrift: 0, productsWithoutCost: 0 }));
    at();
    expect(await screen.findByTestId('inv-h-ok')).toBeInTheDocument();
    expect(await screen.findByText('Lisa T')).toBeInTheDocument();
    expect(movesMock).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', page: 1 }));
  });
});
