import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { contextMock, lowMock, reorderMock, slowMock } = vi.hoisted(() => ({
  contextMock: vi.fn(), lowMock: vi.fn(), reorderMock: vi.fn(), slowMock: vi.fn(),
}));
vi.mock('../api/posAiInventoryApi', () => ({
  posAiInventoryApi: { context: contextMock, lowStock: lowMock, reorder: reorderMock, slowMoving: slowMock },
}));
import { POSAiInventoryScreen } from './POSAiInventoryScreen';

beforeEach(() => {
  contextMock.mockResolvedValue({ productCount: 42, inStock: 30, low: 6, critical: 3, outOfStock: 2, overstock: 1, costVisible: true, inboundWired: true });
  lowMock.mockResolvedValue({ branchId: 'B1', items: [
    { productId: 'p1', name: 'Acetone', sku: 'AC-1', categoryName: 'Consumable', sellableAvailable: 3, reorderLevel: 10, confirmedInbound: 0, severity: 'critical', vendorName: 'BeautyCo', leadTimeDays: 7 },
  ] });
  reorderMock.mockResolvedValue({ branchId: 'B1', costVisible: true, recommendations: [] });
  slowMock.mockResolvedValue({ branchId: 'B1', costVisible: true, windowDays: 90, items: [] });
});

describe('POSAiInventoryScreen', () => {
  it('renders the Command Center KPIs', async () => {
    render(<POSAiInventoryScreen />);
    expect(await screen.findByText('42')).toBeInTheDocument();      // products
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('loads Low Stock when its tab is selected', async () => {
    render(<POSAiInventoryScreen />);
    await screen.findByText('42');
    fireEvent.click(screen.getByText('Low Stock'));
    expect(await screen.findByText('Acetone')).toBeInTheDocument();
    expect(screen.getByText('BeautyCo')).toBeInTheDocument();
  });
});
