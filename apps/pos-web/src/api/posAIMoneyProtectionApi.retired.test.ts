// The six Money Protection guides (Nov 3 2026): the center replaces the old reads — these client methods are retired.
import { describe, it, expect } from 'vitest';
import { posAIMoneyProtectionApi } from './posAIMoneyProtectionApi';
describe('posAIMoneyProtectionApi — retired reads', () => {
  it.each(['state', 'rules', 'getSettings', 'updateSetting', 'alerts', 'listInvestigations', 'getInvestigation'])('%s is gone', (k) => {
    expect((posAIMoneyProtectionApi as Record<string, unknown>)[k]).toBeUndefined();
  });
  it('the center and the human actions remain', () => {
    expect(typeof posAIMoneyProtectionApi.center.alerts).toBe('function');
    expect(typeof posAIMoneyProtectionApi.resolveInvestigation).toBe('function');
  });
});
