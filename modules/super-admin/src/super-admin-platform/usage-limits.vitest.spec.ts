import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';

// Regression: a non-numeric limit typed in the UI arrives as JSON `null` (NaN serializes to null), and Number(null) === 0,
// which previously slipped past the `>= 0` check and silently set the tenant's limit to 0. The service must reject it.
function svc() { const repo = new InMemorySuperAdminPlatformRepo(); return { repo, s: new SuperAdminPlatformService(repo) }; }
const ctx = { userId: 'admin1', ip: '1.2.3.4' } as any;

describe('setUsageLimit validation', () => {
  it('rejects a null limit (the JSON form of non-numeric input) instead of coercing it to 0', async () => {
    const { s } = svc();
    await expect(s.setUsageLimit(ctx, 't1', 'customers', null as any)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.setUsageLimit(ctx, 't1', 'customers', undefined as any)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.setUsageLimit(ctx, 't1', 'customers', '' as any)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects NaN, negative, and over-max limits', async () => {
    const { s } = svc();
    await expect(s.setUsageLimit(ctx, 't1', 'customers', NaN as any)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.setUsageLimit(ctx, 't1', 'customers', -5)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.setUsageLimit(ctx, 't1', 'customers', 200_000_000)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects an unknown metric and a missing tenant', async () => {
    const { s } = svc();
    await expect(s.setUsageLimit(ctx, 't1', 'bogus', 100)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.setUsageLimit(ctx, '', 'customers', 100)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('accepts a valid limit and rounds to a whole number', async () => {
    const { s } = svc();
    await expect(s.setUsageLimit(ctx, 't1', 'customers', 250.6)).resolves.toMatchObject({ tenantId: 't1', metric: 'customers', limitValue: 251 });
    await expect(s.setUsageLimit(ctx, 't1', 'sms', 0)).resolves.toMatchObject({ metric: 'sms', limitValue: 0 });
  });
});
