import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import type { BranchDirRow } from './branch-directory-core';

// Nest-free: fake repo + no db (audit no-op). Verifies the server-side export builds guarded CSV from the repo's full
// filtered set, exposes no secret columns, and returns a dated filename + accurate row count.
const row = (o: Partial<BranchDirRow>): BranchDirRow => ({
  id: 'b1', name: 'Downtown', tenantId: 't1', tenantName: 'Luxe', city: 'Camden', state: 'NJ', status: 'active',
  manager: 'Sam Green', staff: 5, todaysAppts: 12, revenueMtdCents: 250000, devices: 3, openTickets: 1, queueWaiting: 2, healthScore: 88, ...o,
});

describe('SuperAdminPlatformService branchesExport (§44)', () => {
  it('produces guarded CSV with header, dollar revenue, and accurate count', async () => {
    const rows = [row({}), row({ id: 'b2', name: '=DANGER', revenueMtdCents: 99900, healthScore: null })];
    const branchesExport = vi.fn().mockResolvedValue(rows);
    const svc = new SuperAdminPlatformService({ branchesExport } as any, undefined);
    const out = await svc.branchesExport({ userId: 'admin-1', email: 'a@x.com' }, { search: 'down', status: 'active' });
    expect(out.mime).toBe('text/csv');
    expect(out.rowCount).toBe(2);
    expect(out.filename).toMatch(/^branches-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = out.content.split('\n');
    expect(lines[0]).toMatch(/Branch,Branch ID,Parent Tenant/);
    expect(lines[1]).toContain('2500.00'); // cents → dollars
    expect(lines[2]).toContain("'=DANGER"); // formula neutralized
    expect(out.content).not.toMatch(/token|secret|password|pin_hash/i);
    expect(branchesExport).toHaveBeenCalledWith({ search: 'down', status: 'active' });
  });

  it('handles an empty result set (header only)', async () => {
    const svc = new SuperAdminPlatformService({ branchesExport: vi.fn().mockResolvedValue([]) } as any, undefined);
    const out = await svc.branchesExport({ userId: 'a', email: 'a@x.com' }, {});
    expect(out.rowCount).toBe(0);
    expect(out.content.split('\n').length).toBe(1); // header only
  });
});
