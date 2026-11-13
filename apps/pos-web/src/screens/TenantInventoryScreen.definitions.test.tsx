// TenantInventoryScreen — round 10 (Inventory Management 01): "How these numbers are counted" lists the server's own KPI
// definitions (one line per card it defines, in the screen's language); the value lines only when this viewer sees money.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { st } = vi.hoisted(() => ({ st: { money: true } }));
vi.mock('../api/posInventoryScreenApi', async () => {
  const h = await import('./_invmocks.test-helpers');
  return { posInventoryScreenApi: h.anyApi({ metrics: async () => ({ ...h.METRICS, inventoryValueCents: st.money ? 12345 : null, retailValueCents: st.money ? 20000 : null,
    definitions: { products: 'x', bottles: 'x', open: 'x', unopened: 'x', lowStock: 'x', outOfStock: 'x', expiringSoon: 'x', pendingReports: 'x', inventoryValue: 'x', retailValue: 'x', needReorder: 'x', somethingNew: 'x' } }) }) };
});
vi.mock('../api/inventoryApi', async () => ({ inventoryApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posInventoryAlertsApi', async () => ({ posInventoryAlertsApi: (await import('./_invmocks.test-helpers')).anyApi() }));
vi.mock('../api/posAiApi', async () => ({ posAiApi: (await import('./_invmocks.test-helpers')).anyApi() }));
import { TenantInventoryScreen } from './TenantInventoryScreen';

describe('Inventory KPI definitions', () => {
  it('one translated line per defined card; an unknown key is not printed raw; value lines follow the money permission', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/tenant/inventory']}><TenantInventoryScreen /></MemoryRouter>);
    const d = await screen.findByTestId('kpi-definitions');
    expect(within(d).getByText('How these numbers are counted')).toBeInTheDocument();
    expect(within(d).getAllByRole('listitem')).toHaveLength(11);
    expect(within(d).getByTestId('kpi-def-expiringSoon')).toHaveTextContent('within 30 days');
    expect(within(d).getByTestId('kpi-def-inventoryValue')).toHaveTextContent('cost × usable, unexpired bottles');
    expect(within(d).queryByTestId('kpi-def-somethingNew')).toBeNull();
    unmount(); st.money = false;
    render(<MemoryRouter initialEntries={['/tenant/inventory']}><TenantInventoryScreen /></MemoryRouter>);
    const d2 = await screen.findByTestId('kpi-definitions');
    expect(within(d2).queryByTestId('kpi-def-inventoryValue')).toBeNull();
    expect(within(d2).getAllByRole('listitem')).toHaveLength(9);
  });
});
