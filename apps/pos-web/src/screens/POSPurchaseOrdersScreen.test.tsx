import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, getMock, createMock, approveMock, receiveMock, cancelMock, vendorsMock, productsMock } = vi.hoisted(() => ({ listMock: vi.fn(), getMock: vi.fn(), createMock: vi.fn(), approveMock: vi.fn(), receiveMock: vi.fn(), cancelMock: vi.fn(), vendorsMock: vi.fn(), productsMock: vi.fn() }));
vi.mock('../api/posPurchaseOrdersApi', () => ({ posPurchaseOrdersApi: { list: listMock, get: getMock, create: createMock, approve: approveMock, receive: receiveMock, cancel: cancelMock, vendors: vendorsMock, products: productsMock } }));
import { POSPurchaseOrdersScreen } from './POSPurchaseOrdersScreen';
beforeEach(() => { [listMock, getMock, createMock, approveMock, receiveMock, cancelMock, vendorsMock, productsMock].forEach((m) => m.mockReset()); vendorsMock.mockResolvedValue({ vendors: [{ id: 'v1', name: 'Acme Supply' }] }); productsMock.mockResolvedValue({ products: [{ id: 'p1', name: 'Gel Polish', color_number: '204' }] }); });

const po = (o: any = {}) => ({ id: 'po1', po_number: 'PO-ABC', status: 'draft', vendor_name: 'Acme Supply', total_cents: 12000, created_at: '2026-07-06T10:00:00Z', expected_date: null, line_count: 2, qty_ordered: 10, qty_received: 0, ...o });

describe('POSPurchaseOrdersScreen', () => {
  it('renders KPIs + PO rows with status', async () => {
    listMock.mockResolvedValue({ purchaseOrders: [po(), po({ id: 'po2', po_number: 'PO-XYZ', status: 'received', qty_received: 10 })] });
    render(<MemoryRouter><POSPurchaseOrdersScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Purchase Orders' })).toBeInTheDocument();
    expect(screen.getByText('PO-ABC')).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Received').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$120.00').length).toBeGreaterThan(0);
  });
  it('approves a draft PO', async () => {
    listMock.mockResolvedValue({ purchaseOrders: [po()] });
    approveMock.mockResolvedValue({});
    render(<MemoryRouter><POSPurchaseOrdersScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('po1'));
  });
  it('receives an approved PO in full (sends remaining quantities)', async () => {
    listMock.mockResolvedValue({ purchaseOrders: [po({ status: 'approved' })] });
    getMock.mockResolvedValue({ lines: [{ id: 'l1', product_id: 'p1', product_name: 'Gel Polish', color_number: '204', quantity_ordered: 10, quantity_received: 3, unit_cost_cents: 1200 }] });
    receiveMock.mockResolvedValue({});
    render(<MemoryRouter><POSPurchaseOrdersScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(receiveMock).toHaveBeenCalledWith('po1', [{ lineId: 'l1', quantity: 7 }]));
  });
  it('validates that a new PO needs a line', async () => {
    listMock.mockResolvedValue({ purchaseOrders: [] });
    render(<MemoryRouter><POSPurchaseOrdersScreen /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Purchase Orders' });
    fireEvent.click(screen.getByRole('button', { name: '+ New PO' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create PO' }));
    expect(await screen.findByText(/at least one product/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
