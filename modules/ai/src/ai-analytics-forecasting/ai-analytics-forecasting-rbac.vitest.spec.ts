// ai-analytics-forecasting-rbac.vitest.spec.ts — the dedicated ai_analytics.view feature permission.
import { requiredCapability, can, permissionsFor } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';

describe('ai_analytics.view', () => {
  it('maps the granular gate to the coarse capability', () => {
    expect(requiredCapability('pos.ai_analytics.view')).toBe('ai_analytics.view');
  });
  it('granted to OWNER and MANAGER only', () => {
    expect(can('OWNER', 'ai_analytics.view')).toBe(true);
    expect(can('MANAGER', 'ai_analytics.view')).toBe(true);
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'] as const) {
      expect(can(role, 'ai_analytics.view')).toBe(false);
    }
  });
  it('is in the OWNER permission set', () => {
    expect(permissionsFor('OWNER')).toContain('ai_analytics.view');
  });
});
