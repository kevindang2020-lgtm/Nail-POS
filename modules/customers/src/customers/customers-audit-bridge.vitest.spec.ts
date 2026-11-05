import { AuditService, InMemoryAuditRepository } from '@aipowersalon/audit';
import { describe, it, expect } from 'vitest';
import { CustomersService } from './customers.service';
import { InMemoryCustomersRepository } from './customers.repository';

// Phase 4: customer operations (view/create/edit/merge/archive) now persist to the unified, tenant-scoped audit trail.
// Merges and archives are compliance-relevant, so they belong in audit_events (read by S22). Audit is optional, so the
// existing direct-construction tests keep working.
const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.view'] };

describe('Customers → unified audit trail bridge', () => {
  it('persists a tenant-scoped audit event for a customer action', async () => {
    const audit = new AuditService(new InMemoryAuditRepository());
    const svc = new CustomersService(new InMemoryCustomersRepository(), audit);

    await svc.getState(ctx as any, {});

    const page = await audit.list('t_A', {});
    expect(page.items.some((r) => r.module === 'customers')).toBe(true);
    // Tenant isolation on the audit trail.
    expect((await audit.list('t_OTHER', {})).pagination.totalItems).toBe(0);
  });

  it('works without an audit service (optional dependency)', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    await expect(svc.getState(ctx as any, {})).resolves.toBeTruthy();
  });
});
