import { describe, it, expect } from 'vitest';
import { walletForecastDays } from './RewardsNetworkPanel';
describe('walletForecastDays (estimate only)', () => {
  it('available ÷ this month’s daily use, rounded down', () => {
    expect(walletForecastDays(10_000, 3_000, 10)).toBe(33);   // 300/day → 33 days
    expect(walletForecastDays(0, 3_000, 10)).toBe(0);
  });
  it('no use this month → no estimate (never invented)', () => {
    expect(walletForecastDays(10_000, 0, 10)).toBeNull();
    expect(walletForecastDays(10_000, 500, 0)).toBeNull();
  });
});
