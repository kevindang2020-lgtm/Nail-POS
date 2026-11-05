import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminGiftCardSettlementApi', () => ({
  giftCardSettlementApi: { state: vi.fn(), createBatch: vi.fn(), batch: vi.fn(), setBatchStatus: vi.fn() },
}));
import { giftCardSettlementApi } from '../api/superAdminGiftCardSettlementApi';
import GiftCardSettlementScreen from './GiftCardSettlementScreen';

beforeEach(() => { vi.clearAllMocks(); });

describe('GiftCardSettlementScreen', () => {
  it('shows pending obligations and per-salon positions', async () => {
    (giftCardSettlementApi.state as any).mockResolvedValue({
      pending: { count: 2, totalCents: 6000, feeCents: 150, netCents: 5850, entries: [] },
      batches: [],
      positions: [{ tenantId: 'salon-b', receivableCents: 6000, payableCents: 0, netCents: 6000 }, { tenantId: 'salon-a', receivableCents: 0, payableCents: 6000, netCents: -6000 }],
    });
    render(<MemoryRouter><GiftCardSettlementScreen /></MemoryRouter>);
    expect(await screen.findByText(/2 entr/)).toBeInTheDocument();
    expect(screen.getByText('salon-b')).toBeInTheDocument();
    expect(screen.getByText('-$60.00')).toBeInTheDocument();
  });

  it('creates a settlement batch from pending obligations', async () => {
    (giftCardSettlementApi.state as any).mockResolvedValue({ pending: { count: 1, totalCents: 5000, feeCents: 0, netCents: 5000, entries: [] }, batches: [], positions: [] });
    (giftCardSettlementApi.createBatch as any).mockResolvedValue({});
    render(<MemoryRouter><GiftCardSettlementScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Create settlement batch' }));
    await waitFor(() => expect(giftCardSettlementApi.createBatch).toHaveBeenCalled());
  });

  it('advances a batch through the reviewed lifecycle', async () => {
    (giftCardSettlementApi.state as any).mockResolvedValue({
      pending: { count: 0, totalCents: 0, feeCents: 0, netCents: 0, entries: [] },
      batches: [{ id: 'b1', programId: null, status: 'pending_review', totalCents: 6000, feeCents: 150, netCents: 5850, approvedByUserId: null, approvedAt: null, createdAt: '2026-07-01T00:00:00Z', entryCount: 2 }],
      positions: [],
    });
    (giftCardSettlementApi.setBatchStatus as any).mockResolvedValue({});
    render(<MemoryRouter><GiftCardSettlementScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(giftCardSettlementApi.setBatchStatus).toHaveBeenCalledWith('b1', 'approved'));
  });

  it('loads and shows a batch\'s clearing entries on demand', async () => {
    (giftCardSettlementApi.state as any).mockResolvedValue({
      pending: { count: 0, totalCents: 0, feeCents: 0, netCents: 0, entries: [] },
      batches: [{ id: 'b1', programId: null, status: 'pending_review', totalCents: 6000, feeCents: 150, netCents: 5850, approvedByUserId: null, approvedAt: null, createdAt: '2026-07-01T00:00:00Z', entryCount: 1 }],
      positions: [],
    });
    (giftCardSettlementApi.batch as any).mockResolvedValue({ batch: {}, entries: [{ id: 'e1', programId: null, issuingTenantId: 'aaaaaaaa-1111', redeemingTenantId: 'bbbbbbbb-2222', amountCents: 3000, platformFeeCents: 75, status: 'cleared', createdAt: '2026-07-01T00:00:00Z' }] });
    render(<MemoryRouter><GiftCardSettlementScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View entries' }));
    await waitFor(() => expect(giftCardSettlementApi.batch).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText(/cleared/)).toBeInTheDocument();
  });
});
