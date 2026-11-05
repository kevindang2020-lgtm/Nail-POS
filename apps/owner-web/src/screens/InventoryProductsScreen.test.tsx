// InventoryProductsScreen (owner, read-only): products/needs-reorder/value KPIs, a stock-health status breakdown,
// catalog meta, top categories by value, and an urgency-sorted reorder list. Verifies KPI + status rendering, the
// reorder list, the "—" valuation when the server nulls it (non-finance), and the well-stocked empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerInventoryApi: { overview: vi.fn() } }));

import { ownerInventoryApi } from '../api/ownerApi';
import { InventoryProductsScreen } from './InventoryProductsScreen';

const overview = (over: any = {}) => ({
  totalProducts: 320, stockPositions: 412,
  statusCounts: { inStock: 360, low: 28, critical: 14, outOfStock: 6, overstock: 4 },
  needsReorderCount: 48, stockValueCents: 1843200, retailValueCents: 4120000,
  brandsCount: 12, vendorsCount: 7, categoriesCount: 9,
  topCategories: [{ category: 'Gel Polish', products: 80, stockValueCents: 720000 }],
  reorderList: [{ productId: 'p1', name: 'OPI Bubble Bath', branchId: 'b1', branchName: 'Main', onHand: 0, reorderLevel: 6, status: 'out_of_stock', suggestedQty: 12 }],
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerInventoryApi.overview as any).mockResolvedValue(overview()); });

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('InventoryProductsScreen', () => {
  it('renders the KPIs and stock-health breakdown', async () => {
    render(<InventoryProductsScreen />);
    await waitFor(() => expect(screen.getByText('Products')).toBeInTheDocument());
    expect(card('Products')).toHaveTextContent('320');
    expect(card('Needs Reorder')).toHaveTextContent('48');
    expect(card('Stock Value')).toHaveTextContent('$18,432');
    const ootKpi = screen.getAllByText('Out of stock').map((el) => el.closest('.owner-kpi')).find(Boolean) as HTMLElement;
    expect(ootKpi).toHaveTextContent('6');
    expect(screen.getByText(/12 brands/)).toBeInTheDocument();
  });

  it('renders the urgency-sorted reorder list with a status badge and suggested order', async () => {
    render(<InventoryProductsScreen />);
    await waitFor(() => expect(screen.getByText('OPI Bubble Bath')).toBeInTheDocument());
    expect(screen.getByText(/Main · 0 on hand · reorder at 6/)).toBeInTheDocument();
    expect(screen.getByText('order +12')).toBeInTheDocument();
  });

  it('shows "—" for valuation when the server nulls it (non-finance user)', async () => {
    (ownerInventoryApi.overview as any).mockResolvedValue(overview({ stockValueCents: null, retailValueCents: null, topCategories: [{ category: 'Gel Polish', products: 80, stockValueCents: null }] }));
    render(<InventoryProductsScreen />);
    await waitFor(() => expect(screen.getByText('Stock Value')).toBeInTheDocument());
    expect(card('Stock Value')).toHaveTextContent('—');
  });

  it('shows a well-stocked empty state when nothing needs reorder', async () => {
    (ownerInventoryApi.overview as any).mockResolvedValue(overview({ reorderList: [], needsReorderCount: 0 }));
    render(<InventoryProductsScreen />);
    await waitFor(() => expect(screen.getByText('Everything is well stocked.')).toBeInTheDocument());
  });
});
