import { describe, it, expect } from 'vitest';
import { SuperAdminStaffService, SuperAdminStaffError, type WorkforceProfile } from './super-admin-staff.service';

// Service-level contract for the read-only workforce profile (§27): it passes a found profile straight through, and a
// null repo result (missing / non-staff role / out of scope) becomes an honest not_found error — never a fabricated
// profile. Masking + secret exclusion are the repository's responsibility (verified by typecheck on the WorkforceProfile
// shape: no password/token/secret fields exist on it to leak).
const sample: WorkforceProfile = {
  workerId: 'u1', name: 'Sarah Johnson', firstName: 'Sarah', lastName: 'Johnson',
  maskedEmail: 's•••@glamour.test', maskedPhone: '••• ••• 1234', role: 'TECHNICIAN', roleCategory: 'technician',
  tenantId: 't1', tenant: 'Glamour Studio', branchId: 'b1', branch: 'Downtown', status: 'active', createdAt: '2026-01-02T00:00:00Z',
  access: { accountStatus: 'active', accessStatus: 'OK', mfaEnabled: true, mustChangePassword: false, lastLogin: '2026-06-20T10:00:00Z', activeSessions: 2, appRegistrations: 1 },
  monitoring: { availability: { available: false, reason: 'x' }, connectivity: { available: false, reason: 'x' }, payrollSync: { available: false, reason: 'x' } },
  history: [{ id: 'a1', actionType: 'user_profile_updated', entityType: 'user', userId: 'u1', tenantId: 't1', at: '2026-06-20T10:00:00Z' }],
};
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.getWorkforceProfile', () => {
  it('returns the repository profile for a known worker', async () => {
    const svc = new SuperAdminStaffService({ workforceProfile: async (id: string) => (id === 'u1' ? sample : null) } as any);
    const p = await svc.getWorkforceProfile(ctx, 'u1');
    expect(p.workerId).toBe('u1');
    expect(p.maskedEmail).toBe('s•••@glamour.test');
    expect(p.access.activeSessions).toBe(2);
    expect(p.monitoring.payrollSync.available).toBe(false);
    expect(Object.keys(p)).not.toContain('passwordHash');
  });

  it('throws not_found when the worker is missing, non-staff, or out of scope', async () => {
    const svc = new SuperAdminStaffService({ workforceProfile: async () => null } as any);
    await expect(svc.getWorkforceProfile(ctx, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.getWorkforceProfile(ctx, 'nope')).rejects.toBeInstanceOf(SuperAdminStaffError);
  });
});
