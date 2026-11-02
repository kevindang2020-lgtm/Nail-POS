import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { sumMock, alertMock } = vi.hoisted(() => ({ sumMock: vi.fn(), alertMock: vi.fn() }));
vi.mock('../api/posInventoryReportApi', () => ({ posInventoryReportApi: { summary: sumMock, alerts: alertMock } }));
import { POSInventoryReportScreen } from './POSInventoryReportScreen';
beforeEach(() => { sumMock.mockReset(); alertMock.mockReset(); });

const summary = { summary: { totalProducts: 40, totalBottles: 120, openBottles: 15, unopenedBottles: 105, lowStock: 3, outOfStock: 1, expiringSoon: 2, pendingReports: 0, inventoryValueCents: 250000 } };
const alerts = { alerts: [{ productId: 'p1', name: 'OPI Red', colorNumber: 'R12', onHand: 1, status: 'low', suggested: 6 }] };

describe('POSInventoryReportScreen', () => {
  it('renders inventory KPIs + reorder attention table', async () => {
    sumMock.mockResolvedValue(summary); alertMock.mockResolvedValue(alerts);
    render(<POSInventoryReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Inventory Report' })).toBeInTheDocument();
    expect(screen.getByText('$2,500.00')).toBeInTheDocument();  // inventory value
    expect(screen.getByText('OPI Red')).toBeInTheDocument();
    expect(screen.getByText('+6')).toBeInTheDocument();          // suggested reorder
  });
  it('shows healthy empty state when no alerts', async () => {
    sumMock.mockResolvedValue(summary); alertMock.mockResolvedValue({ alerts: [] });
    render(<POSInventoryReportScreen />);
    expect(await screen.findByText(/above their reorder level/)).toBeInTheDocument();
  });
});
