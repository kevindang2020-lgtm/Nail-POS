// GlobalRewardsTender — C1 audit (Nov 4 2026) §4.3: Checkout shows what the sale is expected to earn before payment.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { co } = vi.hoisted(() => ({ co: { rewardsQuote: vi.fn(), payRewards: vi.fn(), removeRewards: vi.fn() } }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: co }));
import { GlobalRewardsTender } from './GlobalRewardsTender';

describe('earning estimate', () => {
  it('shows "earns about N points" for an eligible customer; nothing once paid', async () => {
    co.rewardsQuote.mockResolvedValue({ available: true, availableTenths: 50, maxBlocks: 0, pointsPerRedeemBlock: 10, redeemBlockValueCents: 100, current: null, earn: { available: true, pointTenths: 100 } });
    const { unmount } = render(<GlobalRewardsTender ticketId="t1" isPaid={false} onChanged={() => {}} />);
    expect((await screen.findByTestId('co-global-rewards-earn')).textContent).toMatch(/10(\.0)? points/);
    unmount();
    render(<GlobalRewardsTender ticketId="t1" isPaid onChanged={() => {}} />);
    await screen.findByTestId('co-global-rewards');
    expect(screen.queryByTestId('co-global-rewards-earn')).toBeNull();
  });
});
