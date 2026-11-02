// customer-identity.vitest.spec.ts — one customer, one login, many salons.
//
// ── What was wrong ──
//
// A customer was a `users` row scoped to ONE salon. The same person visiting two salons had **two accounts** and,
// if they registered separately, **two different passwords**. They'd change it at one salon and be baffled the
// other still wanted the old one. There was no "me" — only "me at this salon".
//
// ── What this adds ──
//
// `customer_identities` (one row per PERSON, and the thing that has a password) + `customer_identity_links`
// (which salon accounts are that person). The per-salon rows are untouched — every appointment, every loyalty
// balance still points at them. The identity is laid on top as the thing you authenticate as.
//
// ── Why it can ship without a flag day ──
//
// Login tries the identity, and falls back to the old per-salon lookup when there is no identity row. A customer
// who hasn't been backfilled signs in exactly as before. If the identity layer were wrong, it degrades to today's
// behaviour rather than locking anyone out.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';
import type { CustomerIdentity, CustomerLoginCandidate, LoginUserRecord } from './auth-user.repository';

const PW = 'Customer-Passphrase-1!';
const OLD_PW = 'Their-Old-Salon-Password-9!';
const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

let hash: string;
let oldHash: string;
beforeAll(async () => { hash = await hashPassword(PW); oldHash = await hashPassword(OLD_PW); });

const salon = (tenantId: string, userId: string, name: string, over: any = {}) => ({
  tenantId, userId, salonName: name, tenantStatus: 'active', subscriptionStatus: 'active', ...over,
});

/** A repo with an identity, and (separately) the legacy per-salon accounts. */
function repo(identity: CustomerIdentity | null, legacy: CustomerLoginCandidate[] = []) {
  return {
    async findCustomerIdentity() { return identity; },
    async findCustomersForLogin() {
      return legacy.filter((c) => String((c.user as any).role).toUpperCase() === 'CUSTOMER');
    },
    async findTenantUserForLogin() { return { tenantFound: false, branchCount: 0 } as any; },
    async findSuperAdminForLogin() { return {}; },
    async markTotpStepUsed() { return true; },
  } as any;
}

const svc = (identity: CustomerIdentity | null, legacy: CustomerLoginCandidate[] = []) =>
  new LoginService(repo(identity, legacy));

const login = (s: LoginService, password = PW) =>
  s.attempt({ portal: 'customer', identifier: '+18565551234', password });

describe('ONE password, MANY salons', () => {
  it('a customer at two salons signs in with a single password', async () => {
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'active',
      salons: [salon(T1, 'u1', 'Polished'), salon(T2, 'u2', 'Luxe Nails')] as any,
    };
    const r = await login(svc(identity));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.role).toBe('CUSTOMER');
  });

  it('the identity\'s password is what counts — not whatever each salon row happened to store', async () => {
    // The per-salon rows still carry their old hashes. They must NOT be able to sign in with them any more; the
    // identity is now the single source of truth for "my password".
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'active',
      salons: [salon(T1, 'u1', 'Polished')] as any,
    };
    const legacy: CustomerLoginCandidate[] = [{
      user: { userId: 'u1', tenantId: T1, role: 'CUSTOMER', status: 'active', passwordHash: oldHash } as any,
      tenantStatus: 'active', subscriptionStatus: 'active', salonName: 'Polished',
    } as any];

    expect((await login(svc(identity, legacy), PW)).outcome).toBe('SUCCESS');
    // the OLD per-salon password no longer works — one password means one password
    expect((await login(svc(identity, legacy), OLD_PW)).outcome).toBe('INVALID_CREDENTIALS');
  });

  it('a wrong password is refused, and says nothing about the account existing', async () => {
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'active', salons: [salon(T1, 'u1', 'Polished')] as any,
    };
    const r = await login(svc(identity), 'nope');
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
    expect(r.message).not.toMatch(/no account|not found|exists/i);
  });
});

describe('a suspended salon does not lock the person out of the others', () => {
  it('signs in to the salon that still works', async () => {
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'active',
      salons: [salon(T1, 'u1', 'Polished', { tenantStatus: 'suspended' }), salon(T2, 'u2', 'Luxe Nails')] as any,
    };
    const r = await login(svc(identity));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T2);
  });

  it('when EVERY salon is blocked, it says so — it does NOT report a wrong password', async () => {
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'active',
      salons: [salon(T1, 'u1', 'Polished', { tenantStatus: 'suspended' })] as any,
    };
    const r = await login(svc(identity));
    expect(r.outcome).toBe('TENANT_SUSPENDED');
    // Reporting INVALID_CREDENTIALS here would send them round in circles retyping a password that is correct.
    expect(r.outcome).not.toBe('INVALID_CREDENTIALS');
  });
});

describe('a disabled identity cannot sign in anywhere', () => {
  it('is refused even with the right password and healthy salons', async () => {
    const identity: CustomerIdentity = {
      identityId: 'i1', passwordHash: hash, status: 'disabled',
      salons: [salon(T1, 'u1', 'Polished')] as any,
    };
    expect((await login(svc(identity))).outcome).toBe('USER_DISABLED');
  });
});

describe('BACKWARD COMPATIBLE — no flag day', () => {
  it('a customer with NO identity row signs in exactly as before', async () => {
    const legacy: CustomerLoginCandidate[] = [{
      user: { userId: 'u1', tenantId: T1, role: 'CUSTOMER', status: 'active', passwordHash: oldHash } as any,
      tenantStatus: 'active', subscriptionStatus: 'active', salonName: 'Polished',
    } as any];
    const r = await login(svc(null, legacy), OLD_PW);   // identity lookup returns null → old path
    expect(r.outcome).toBe('SUCCESS');
  });

  it('an unknown person is refused by both paths, identically', async () => {
    const r = await login(svc(null, []));
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
  });
});

describe('STAFF still cannot sign in on the customer app', () => {
  it('a manager has no identity, and the legacy path filters them out too', async () => {
    const legacy: CustomerLoginCandidate[] = [{
      user: { userId: 'm1', tenantId: T1, role: 'MANAGER', status: 'active', passwordHash: hash } as any,
      tenantStatus: 'active', subscriptionStatus: 'active', salonName: 'Polished',
    } as any];
    // no identity (the backfill excludes staff), and the per-salon lookup only ever returns role = CUSTOMER
    const r = await login(svc(null, legacy));
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
  });
});
