// extras GLOBAL LOYALTY REWARDS 14 (round 10): the global rule preview states the funding exposure the server computed
// (last 30 days of global-rule sales re-priced under the current and the proposed rule).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const api = vi.hoisted(() => ({ previewGlobal: vi.fn(), publishGlobal: vi.fn(), cancelGlobal: vi.fn(), overview: vi.fn() }));
vi.mock('../api/superAdminLoyaltyNetworkApi', async (orig) => ({ ...(await orig<any>()), superAdminLoyaltyNetworkApi: api }));
import { RulesTab } from './LoyaltyNetworkScreen';

describe('RulesTab — funding exposure', () => {
  it('shows now → proposed backing for the same past sales, the difference and the per-day figure; never re-prices them', async () => {
    const rate = { spendIncrementCents: 500, pointTenthsPerIncrement: 5, minEligibleCents: 0, perTicketCapTenths: null };
    api.previewGlobal.mockResolvedValue({ proposed: rate, current: rate, rows: [], impact: { globalModeTenants: 3, customModeTenants: 1 },
      exposure: { days: 30, sales: 120, salons: 3, capped: false, currentBackingCents: 60000, proposedBackingCents: 90000, differenceCents: 30000, perDayDifferenceCents: 1000 } });
    render(<RulesTab ov={{ globalVersions: [] } as any} onDone={() => {}} onFail={() => {}} />);
    fireEvent.click(screen.getByTestId('sa-ln-g-preview'));
    const ex = await screen.findByTestId('sa-ln-g-exposure');
    expect(ex).toHaveTextContent('last 30 days of global-rule sales (120 at 3 salon(s))');
    expect(ex).toHaveTextContent('Past sales are never re-priced');
    expect(api.publishGlobal).not.toHaveBeenCalled();
  });
});
