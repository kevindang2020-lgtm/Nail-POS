// Jul 29, 2026 — pinned after auth-matrix-e2e found it LIVE: a role='CUSTOMER' row was findable through the
// TENANT (staff) portal. Spec §11 symmetry: the customer door structurally cannot find staff — the staff door
// must structurally not find customers. Fixed in both the Kysely repo and the InMemory twin; this spec pins it.
import { describe, it, expect } from 'vitest';
import { InMemoryAuthUserRepository } from './auth-user.repository';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';

describe('tenant portal excludes CUSTOMER rows (spec §11 symmetry)', () => {
  it('the staff-door repo lookup never returns a CUSTOMER row (fix lives in both repos)', async () => {
    const pw = await hashPassword('Cust!2345');
    const repo = new InMemoryAuthUserRepository({
      tenants: [{ id: 't1', tenantCode: 'PALACE', status: 'active' }],
      branches: [{ id: 'b1', tenantId: 't1', status: 'active' }],
      subscriptions: [{ tenantId: 't1', status: 'active' }],
      users: [
        { userId: 'u1', tenantId: 't1', branchId: 'b1', email: 'cust@palace.test', normalizedPhone: null, passwordHash: pw, role: 'CUSTOMER', status: 'active', mfaEnabled: false },
        { userId: 'u2', tenantId: 't1', branchId: 'b1', email: 'mgr@palace.test', normalizedPhone: null, passwordHash: pw, role: 'MANAGER', status: 'active', mfaEnabled: false },
      ],
    } as any);
    // CUSTOMER identifier through the tenant (staff) portal → not found.
    const cust = await repo.findTenantUserForLogin('PALACE', { kind: 'email', value: 'cust@palace.test' } as any);
    expect(cust.user).toBeFalsy();
    // control: a real staff member at the SAME salon IS found, so the filter is role-specific, not blanket.
    const mgr = await repo.findTenantUserForLogin('PALACE', { kind: 'email', value: 'mgr@palace.test' } as any);
    expect(mgr.user).toBeTruthy();
  });
});
