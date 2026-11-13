// GLOBAL LOYALTY REWARDS 03 (round 10): the depletion estimate is the SERVER's (walletFundingForecast over the wallet ledger's
// last 30 days, pinned in modules/loyalty global-rewards-core.vitest.spec.ts + global-rewards-engine.pgtest). The POS no longer
// computes its own — the old walletForecastDays (this calendar month ÷ the DEVICE's day of month) was removed. This file pins that.
import { describe, it, expect } from 'vitest';
import * as panel from './RewardsNetworkPanel';
describe('wallet forecast (server-owned)', () => {
  it('the panel exports no forecast arithmetic of its own', () => {
    expect((panel as Record<string, unknown>).walletForecastDays).toBeUndefined();
  });
});
