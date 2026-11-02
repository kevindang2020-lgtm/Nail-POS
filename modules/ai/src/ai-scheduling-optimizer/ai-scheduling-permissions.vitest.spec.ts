// ai-scheduling-permissions.vitest.spec — BUILD_PLAN Phase 7: the optimizer's routes use their own ai_scheduling.* keys.
// The old pos.ai_scheduling_optimizer.* keys were mapped onto booking.* in security-core, so a TECHNICIAN (booking.manage)
// could generate, accept and apply. The mapping is gone; the real grants are the rbac ones.
import { describe, it, expect } from 'vitest';
import { hasPermission, requiredCapability, ROLE_PERMISSIONS } from '@aipowersalon/permissions';

const as = (role: keyof typeof ROLE_PERMISSIONS) => ({ tenantId: 't', role, permissions: ROLE_PERMISSIONS[role] as string[] });
describe('ai_scheduling.* grants', () => {
  it('the legacy pos.ai_scheduling_optimizer.* keys no longer resolve to booking capabilities', () => {
    expect(requiredCapability('pos.ai_scheduling_optimizer.manage')).not.toBe('booking.manage');
    expect(hasPermission(as('TECHNICIAN') as any, 'pos.ai_scheduling_optimizer.manage')).toBe(false);
    expect(hasPermission(as('TECHNICIAN') as any, 'pos.ai_scheduling_optimizer.view')).toBe(false);
  });
  it('technician: view_own only; front desk: view + generate; manager: no configure; owner: everything', () => {
    const tech = as('TECHNICIAN');
    for (const k of ['ai_scheduling.view', 'ai_scheduling.generate', 'ai_scheduling.review', 'ai_scheduling.apply', 'ai_scheduling.configure']) expect(hasPermission(tech as any, k), k).toBe(false);
    expect(hasPermission(tech as any, 'ai_scheduling.view_own')).toBe(true);
    const fd = as('FRONT_DESK');
    expect(hasPermission(fd as any, 'ai_scheduling.generate')).toBe(true);
    expect(hasPermission(fd as any, 'ai_scheduling.review')).toBe(false);
    const mgr = as('MANAGER');
    for (const k of ['ai_scheduling.review', 'ai_scheduling.approve', 'ai_scheduling.apply', 'ai_scheduling.export']) expect(hasPermission(mgr as any, k), k).toBe(true);
    expect(hasPermission(mgr as any, 'ai_scheduling.configure')).toBe(false);
    expect(hasPermission(as('OWNER') as any, 'ai_scheduling.configure')).toBe(true);
  });
});
