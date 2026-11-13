// TenantInventoryScreen — round 10 (Inventory Management 09): before a transfer is sent, each line shows this location's on-hand
// before → after and where it goes; asking for more than is here says so (the server moves only what it has).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../components/usePermissions', async (o) => ({ ...(await o<typeof import('../components/usePermissions')>()), useCan: () => () => true }));
vi.mock('../api/posInventoryScreenApi', async () => { const h = await import('./_invmocks.test-helpers'); return { posInventoryScreenApi: h.anyApi({ metrics: async () => h.METRICS }) }; });
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi({
  products: async () => ({ products: [{ id: 'p1', name: 'Gel Red', color_number: '12', onHand: 5 }, { id: 'p2', name: 'Top Coat', color_number: null, onHand: 1 }] }),
  transferBranches: async () => ({ branches: [{ id: 'b2', name: 'Second', city: null }] }),
}) }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('transfer before / after preview', () => {
  it('shows here before → after and the destination per line; too many is flagged', async () => {
    render(<MemoryRouter initialEntries={['/tenant/inventory?tab=transfers']}><TenantInventoryScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('new-transfer'));
    await screen.findByText('Second');   // the destination list has loaded
    const modal = document.querySelector('.inv-modal') as HTMLElement;
    const selects = modal.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'b2' } });
    fireEvent.change(selects[1], { target: { value: 'p1' } });
    const qty = modal.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '2' } });
    expect(screen.getByTestId('transfer-preview-line')).toHaveTextContent('Gel Red #12: here 5 → 3 · to Second');
    fireEvent.change(qty, { target: { value: '7' } });
    expect(screen.getByTestId('transfer-preview-line')).toHaveTextContent('here 5 → 0');
    expect(screen.getByTestId('transfer-preview-line')).toHaveTextContent('only 5 on hand here');
  });
});
