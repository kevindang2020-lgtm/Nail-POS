// auth-login-scope.vitest.spec.ts — BUILD_PLAN Phase 9: sign-in reads the template SCOPE (Kevin's decision (1)) and mints the
// authorization versions into the session.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';
import { loginResponse } from './auth.http';
import { verifySession } from './auth-session-token';

const PW = 'Sup3rSecret!';
let seed: AuthSeed;
beforeAll(async () => {
  const hash = await hashPassword(PW);
  const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({ branchId: 'b1', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null, email: null, normalizedPhone: null, ...o });
  seed = { tenants: [{ id: 'tA', tenantCode: 'PALACE', status: 'active' }], users: [mk({ userId: 'uDesk', tenantId: 'tA', role: 'FRONT_DESK', email: 'desk@a.com' })], subscriptions: [{ tenantId: 'tA', status: 'active' }], branches: [{ tenantId: 'tA' }] };
});
const attempt = async (extra: Record<string, any>) => {
  const repo: any = Object.assign(new InMemoryAuthUserRepository(seed), extra);
  return new LoginService(repo).attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'desk@a.com', password: PW });
};

describe('template scope at sign-in', () => {
  it('home branch inside the allowed set → signed in there', async () => {
    const r = await attempt({ enterableBranchesFor: async () => ['b1', 'b2'] });
    expect(r.outcome).toBe('SUCCESS'); expect(r.principal!.branchId).toBe('b1');
  });
  it('home branch NOT allowed, exactly one allowed → that one', async () => {
    const r = await attempt({ enterableBranchesFor: async () => ['b2'] });
    expect(r.outcome).toBe('SUCCESS'); expect(r.principal!.branchId).toBe('b2');
  });
  it('home branch NOT allowed, several allowed → the branch picker (which lists only those)', async () => {
    const r = await attempt({ enterableBranchesFor: async () => ['b2', 'b3'] });
    expect(r.outcome).toBe('BRANCH_SELECTION_REQUIRED'); expect(r.principal!.branchId).toBeNull(); expect(r.principal!.needsBranchSelection).toBe(true);
  });
  it('no confinement (null) or a failed lookup → unchanged', async () => {
    expect((await attempt({ enterableBranchesFor: async () => null })).principal!.branchId).toBe('b1');
    expect((await attempt({ enterableBranchesFor: async () => { throw new Error('db'); } })).principal!.branchId).toBe('b1');
  });
});

describe('authorization versions are minted into the session', () => {
  it('av / tv ride in the signed token; a repository that cannot answer mints none (the request path then never widens)', async () => {
    const r = await attempt({ authorizationVersions: async () => ({ av: 7, tv: 3 }) });
    expect(r.principal).toMatchObject({ av: 7, tv: 3 });
    const spec = loginResponse(r, { secret: 's3cret', sid: 'sid-1' });
    const v = verifySession(spec.cookie!.value, { secret: 's3cret' });
    expect(v.valid && v.payload).toMatchObject({ av: 7, tv: 3, sid: 'sid-1' });
    const none = await attempt({});
    expect(none.principal!.av).toBeUndefined();
  });
});
