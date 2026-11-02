// customer-default-salon.vitest.spec.ts — a customer with accounts at several salons signs in to their DEFAULT salon
// (users.customer_default_at, migration 493: the one most recently chosen at sign-up or in Profile → My salon). Before
// Oct 3 2026 it was simply the first account found. Also: customer sign-in no longer writes the identity record
// (including its password hash) to the server log.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';
import { pickDefaultSalon, type CustomerIdentity, type CustomerLoginCandidate } from './auth-user.repository';

const PW = 'Customer-Passphrase-1!';
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222';
let hash: string;
beforeAll(async () => { hash = await hashPassword(PW); });
afterEach(() => vi.restoreAllMocks());

const repo = (identity: CustomerIdentity | null, legacy: CustomerLoginCandidate[] = []) => ({
  async findCustomerIdentity() { return identity; },
  async findCustomersForLogin() { return legacy; },
  async findTenantUserForLogin() { return { tenantFound: false, branchCount: 0 } as any; },
  async findSuperAdminForLogin() { return {}; },
  async markTotpStepUsed() { return true; },
}) as any;
const login = (r: any) => new LoginService(r).attempt({ portal: 'customer', identifier: '+18565551234', password: PW });
const salon = (tenantId: string, userId: string, defaultAt: string | null) => ({ tenantId, userId, salonName: tenantId === T1 ? 'Polished' : 'Luxe', tenantStatus: 'active', subscriptionStatus: 'active', defaultAt });
const legacyUser = (tenantId: string, userId: string, defaultAt: string | null): CustomerLoginCandidate => ({
  user: { userId, tenantId, branchId: null, role: 'CUSTOMER', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: 'Ana', email: 'ana@x.test', normalizedPhone: '+18565551234' } as any,
  tenantStatus: 'active' as any, subscriptionStatus: 'active' as any, salonName: 'S', defaultAt,
});

describe('pickDefaultSalon', () => {
  it('the most recently chosen wins; never-chosen accounts keep the old order', () => {
    expect(pickDefaultSalon([{ id: 'a', defaultAt: null }, { id: 'b', defaultAt: '2026-10-01T00:00:00Z' }, { id: 'c', defaultAt: '2026-10-03T00:00:00Z' }]).id).toBe('c');
    expect(pickDefaultSalon([{ id: 'a', defaultAt: null }, { id: 'b', defaultAt: null }]).id).toBe('a');
  });
});

describe('customer sign-in lands at the default salon', () => {
  it('identity path: the salon chosen most recently, even when it is not listed first', async () => {
    const identity: CustomerIdentity = { identityId: 'i1', passwordHash: hash, status: 'active',
      salons: [salon(T1, 'u1', '2026-09-01T00:00:00Z'), salon(T2, 'u2', '2026-10-03T12:00:00Z')] as any };
    const r = await login(repo(identity));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T2);
  });
  it('per-salon path (no identity): same rule', async () => {
    const r = await login(repo(null, [legacyUser(T1, 'u1', null), legacyUser(T2, 'u2', '2026-10-03T12:00:00Z')]));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T2);
  });
  it('customer sign-in writes nothing about the identity to the log (it used to print the record incl. its password hash)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const identity: CustomerIdentity = { identityId: 'i1', passwordHash: hash, status: 'active', salons: [salon(T1, 'u1', null)] as any };
    await login(repo(identity));
    expect(log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).not.toMatch(/identity|\$argon2|\$2[aby]\$|passwordHash/i);
  });
});
