// extras GLOBAL LOYALTY REWARDS 11 (round 10): the read-only idempotency conflict center.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => ({ idempotency: vi.fn() }));
vi.mock('../api/superAdminLoyaltyNetworkApi', async (orig) => ({ ...(await orig<any>()), superAdminLoyaltyNetworkApi: api }));
import { IdempotencyCenter } from './LoyaltyIntegrityTab';

describe('IdempotencyCenter', () => {
  it('lists replays and conflicts with the masked key and how often it repeated; the outcome filter goes to the server; no action buttons', async () => {
    api.idempotency.mockResolvedValue({ total: 2, conflicts: 1, page: 1, pageSize: 10, pageCount: 1, items: [
      { id: 'e1', tenantId: 't', salon: 'Lotus', scope: 'token_purchase', outcome: 'conflict', keyRef: '…-key-001', resourceId: 'p1', repeats: 2, detail: {}, at: '2026-11-13T10:00:00Z' },
      { id: 'e2', tenantId: 't', salon: 'Lotus', scope: 'redemption', outcome: 'replay', keyRef: '…abcd1234', resourceId: 'r1', repeats: 2, detail: {}, at: '2026-11-13T09:00:00Z' }] });
    render(<IdempotencyCenter />);
    const rows = await screen.findAllByTestId('sa-ln-idem-row');
    expect(rows[0]).toHaveTextContent('Conflict — refused'); expect(rows[0]).toHaveTextContent('…-key-001'); expect(rows[1]).toHaveTextContent('Replay — same result');
    expect(screen.getByTestId('sa-ln-idem-total')).toHaveTextContent('2 repeated · 1 conflict(s)');
    expect(screen.getByTestId('sa-ln-idem').querySelectorAll('button')).toHaveLength(0);
    fireEvent.change(screen.getByTestId('sa-ln-idem-outcome'), { target: { value: 'conflict' } });
    await waitFor(() => expect(api.idempotency).toHaveBeenLastCalledWith({ outcome: 'conflict', page: 1, pageSize: 10 }));
  });
});
