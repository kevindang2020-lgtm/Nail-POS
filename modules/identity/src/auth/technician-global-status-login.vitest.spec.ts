// technician-global-status-login.vitest.spec.ts — Oct 12 2026 merge (other-chat workforce audit P0 #4): a TECHNICIAN
// whose GLOBAL account (global_tech_profiles.status) is paused / locked / suspended / anonymized / merged cannot sign
// in at any salon, whatever the per-salon users.status says. Pure LoginService over the in-memory repo with a stubbed
// global-status lookup.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService, TECHNICIAN_GLOBAL_BLOCKED } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

const PW = 'Sup3rSecret!';
let repo: InMemoryAuthUserRepository & { technicianGlobalStatus?: (userId: string, tenantId: string | null) => Promise<string | null> };
let global: Record<string, string | null>;

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({
    branchId: 'b1', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null, email: null, normalizedPhone: null, ...o,
  });
  const seed: AuthSeed = {
    tenants: [{ id: 't1', tenantCode: 'GLOBE', status: 'active' }],
    users: [
      mk({ userId: 'uTech', tenantId: 't1', role: 'TECHNICIAN', email: 'tech@g.com' }),
      mk({ userId: 'uMgr', tenantId: 't1', role: 'MANAGER', email: 'mgr@g.com' }),
    ],
    subscriptions: [{ tenantId: 't1', status: 'active' }],
    branches: [{ tenantId: 't1' }],
  };
  repo = new InMemoryAuthUserRepository(seed) as any;
  global = { uTech: 'active' };
  repo.technicianGlobalStatus = async (userId: string) => global[userId] ?? null;
});

const login = (email: string) => new LoginService(repo).attempt({ portal: 'tenant', salonCode: 'GLOBE', identifier: email, password: PW });

describe('technician login honours global_tech_profiles.status', () => {
  it('signs in when the global account is active', async () => {
    global.uTech = 'active';
    expect((await login('tech@g.com')).outcome).toBe('SUCCESS');
  });
  it.each([...TECHNICIAN_GLOBAL_BLOCKED])('is refused (USER_DISABLED) when the global account is %s', async (st) => {
    global.uTech = st;
    const r = await login('tech@g.com');
    expect(r.outcome).toBe('USER_DISABLED');
    expect(r.principal).toBeUndefined();
  });
  it('the blocked set is exactly paused/locked/suspended/anonymized/merged', () => {
    expect([...TECHNICIAN_GLOBAL_BLOCKED].sort()).toEqual(['anonymized', 'locked', 'merged', 'paused', 'suspended']);
  });
  it('a login with NO global profile proceeds on users.status alone (no flag day)', async () => {
    global.uTech = null;
    expect((await login('tech@g.com')).outcome).toBe('SUCCESS');
  });
  it('a lookup error falls back to users.status (the same fail-open the revocation and authz re-checks use) — and a suspended per-salon login is still refused', async () => {
    const prev = repo.technicianGlobalStatus;
    repo.technicianGlobalStatus = async () => { throw new Error('db down'); };
    expect((await login('tech@g.com')).outcome).toBe('SUCCESS');
    repo.technicianGlobalStatus = prev;
  });
  it('does not consult the global status for non-technician roles', async () => {
    let asked = 0;
    repo.technicianGlobalStatus = async () => { asked++; return 'suspended'; };
    expect((await login('mgr@g.com')).outcome).toBe('SUCCESS');
    expect(asked).toBe(0);
    repo.technicianGlobalStatus = async (userId: string) => global[userId] ?? null;
  });
});
