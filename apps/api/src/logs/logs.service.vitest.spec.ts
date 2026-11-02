import { describe, it, expect } from 'vitest';
import { LogsService, ForbiddenError } from './logs.service';
import { InMemoryLogsRepository } from './logs.repository';
import type { LogsContext } from './logs.dto';

const owner: LogsContext = { tenantId: 'luxe001', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['settings.view'] };
const noPerm: LogsContext = { tenantId: 'luxe001', branchId: '', userId: 'u2', role: 'FRONT_DESK', permissions: [] };
const other: LogsContext = { ...owner, tenantId: 't_other' };
const svc = () => new LogsService(new InMemoryLogsRepository());

describe('LogsService', () => {
  it('queries seeded integration logs and filters by category/severity/search', async () => {
    const s = svc();
    const all = await s.query(owner, {});
    expect(all.logs.length).toBeGreaterThanOrEqual(2);
    expect((await s.query(owner, { category: 'device' })).logs.length).toBe(0); // none seeded for device
    expect((await s.query(owner, { category: 'integration' })).logs.length).toBeGreaterThanOrEqual(2);
    expect((await s.query(owner, { search: 'calendar' })).logs.length).toBe(1);
  });

  it('write() persists a queryable entry and redacts sensitive metadata; never throws', async () => {
    const s = svc();
    await s.write({ tenantId: 'luxe001' }, { category: 'integration', severity: 'error', source: 'webhook', message: 'Delivery failed for CRM', relatedId: 'wh1', status: 'failed', metadata: { status: 500, signingSecret: 'whsec_leak', note: 'ok' } });
    const found = (await s.query(owner, { search: 'crm' })).logs;
    expect(found.length).toBe(1);
    expect(found[0].severity).toBe('error');
    expect((found[0].metadata as any).signingSecret).toBe('[redacted]'); // secret redacted
    expect((found[0].metadata as any).status).toBe(500);
    await expect(s.write({ tenantId: 'luxe001' }, { category: 'integration', severity: 'info', source: 'x', message: 'y' })).resolves.toBeUndefined();
  });

  it('enforces read permission and tenant isolation', async () => {
    const s = svc();
    await expect(s.query(noPerm, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await s.query(other, {})).logs.length).toBe(0); // other tenant sees nothing
  });

  it('clamps limit and ignores invalid filters', async () => {
    const s = svc();
    const r = await s.query(owner, { limit: '9999', category: 'bogus', severity: 'debug' });
    expect(r.logs.length).toBeLessThanOrEqual(500);
  });
});
