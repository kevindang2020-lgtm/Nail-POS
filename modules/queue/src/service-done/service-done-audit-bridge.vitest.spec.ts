import { AuditService, InMemoryAuditRepository } from '@aipowersalon/audit';
import { describe, it, expect } from 'vitest';
import { ServiceDoneService } from './service-done.service';
import { InMemoryServiceDoneRepository } from './service-done.repository';

// Phase 3: the operational core writes durable audit events. Service Done already kept an in-process action log; it now
// also forwards each log point to the unified, tenant-scoped audit_events store (Phase 2 foundation). The audit service
// is an optional dependency, so direct construction (the existing test pattern) keeps working.
const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: ['pos.service_done.view'] };

describe('Service Done → unified audit trail bridge', () => {
  it('records a tenant-scoped audit event when an action is logged', async () => {
    const audit = new AuditService(new InMemoryAuditRepository());
    const svc = new ServiceDoneService(new InMemoryServiceDoneRepository(), undefined, audit);

    await svc.getState(ctx as any, {});

    const page = await audit.list('t_A', {});
    expect(page.pagination.totalItems).toBeGreaterThanOrEqual(1);
    expect(page.items.some((r) => r.module === 'service-done' && r.action === 'pos_service_done_viewed')).toBe(true);

    // Tenant isolation: a different tenant sees none of t_A's audit events.
    expect((await audit.list('t_OTHER', {})).pagination.totalItems).toBe(0);
  });

  it('still works when no audit service is provided (optional dependency)', async () => {
    const svc = new ServiceDoneService(new InMemoryServiceDoneRepository());
    await expect(svc.getState(ctx as any, {})).resolves.toBeTruthy();
  });
});
