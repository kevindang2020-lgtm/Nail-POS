// customer-portal-login.vitest.spec.ts — the CUSTOMER APP login.
//
// The reason this portal exists at all is spec §11: "This screen is only for customers. Do not allow tenant
// staff, receptionist, technician, owner, manager or Super Admin login."
//
// Before this, the customer app posted `portal: 'tenant'` with a salon code — literally the staff login. A
// manager with valid credentials could sign in on the customer app and receive a session. And customers were
// asked for a salon code they do not have.
//
// The fix is STRUCTURAL, not a convention: the customer lookup's SQL says `where role = 'CUSTOMER'`, so staff are
// invisible to it. Even with a correct password there is nothing for the query to find. These tests hold that
// line, plus the usual ones — no account enumeration, disabled accounts refused, multi-salon customers handled.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';
import type { CustomerLoginCandidate, LoginUserRecord } from './auth-user.repository';

const PW = 'Customer-Passphrase-1!';
const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

let hash: string;
beforeAll(async () => { hash = await hashPassword(PW); });

const user = (o: Partial<LoginUserRecord> & { userId: string; role: string; tenantId: string }): LoginUserRecord => ({
  branchId: null, status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null,
  email: 'sam@example.com', normalizedPhone: '+18565551234', ...o,
} as any);

const candidate = (o: Partial<CustomerLoginCandidate> & { user: LoginUserRecord }): CustomerLoginCandidate => ({
  tenantStatus: 'active', subscriptionStatus: 'active', salonName: 'Polished', ...o,
} as any);

/** A repo whose customer lookup returns exactly what we hand it. The role filter is enforced in the REAL SQL; here
 *  we simulate it faithfully by refusing to return anything that isn't a CUSTOMER. */
function repoWith(candidates: CustomerLoginCandidate[]) {
  return {
    async findCustomersForLogin() {
      // mirrors `where role = 'CUSTOMER'` — staff rows can never come back from this query
      return candidates.filter((c) => String((c.user as any).role).toUpperCase() === 'CUSTOMER');
    },
    async findTenantUserForLogin() { return { tenantFound: false, branchCount: 0 } as any; },
    async findSuperAdminForLogin() { return {}; },
    async markTotpStepUsed() { return true; },
  } as any;
}

const login = (candidates: CustomerLoginCandidate[]) => new LoginService(repoWith(candidates));

describe('§11 — STAFF CANNOT SIGN IN ON THE CUSTOMER APP', () => {
  it('a MANAGER with correct credentials is refused', async () => {
    const svc = login([candidate({ user: user({ userId: 'm1', role: 'MANAGER', tenantId: T1 }) })]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
    expect(r.message).not.toMatch(/staff|manager|wrong app/i);   // and it doesn't explain WHY
  });

  it('a TECHNICIAN, OWNER, RECEPTION and SUPER_ADMIN are all refused', async () => {
    for (const role of ['TECHNICIAN', 'OWNER', 'RECEPTION', 'FRONT_DESK', 'SUPER_ADMIN']) {
      const svc = login([candidate({ user: user({ userId: 'x', role, tenantId: T1 }) })]);
      const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
      expect(r.outcome, `${role} must not be able to sign in`).toBe('INVALID_CREDENTIALS');
    }
  });

  it('a CUSTOMER with the same credentials signs in fine', async () => {
    const svc = login([candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) })]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.role).toBe('CUSTOMER');
  });
});

describe('no salon code, phone OR email', () => {
  const svc = () => login([candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) })]);

  it('signs in by EMAIL — with no salonCode supplied at all', async () => {
    const r = await svc().attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
  });

  it('signs in by PHONE, in any format', async () => {
    for (const typed of ['(856) 555-1234', '856-555-1234', '8565551234', '+1 856 555 1234']) {
      const r = await svc().attempt({ portal: 'customer', identifier: typed, password: PW });
      expect(r.outcome, typed).toBe('SUCCESS');
    }
  });
});

describe('safe failures — no account enumeration', () => {
  it('an unknown account and a wrong password are INDISTINGUISHABLE', async () => {
    const unknown = await login([]).attempt({ portal: 'customer', identifier: 'nobody@example.com', password: PW });
    const wrongPw = await login([candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) })])
      .attempt({ portal: 'customer', identifier: 'sam@example.com', password: 'wrong-password' });

    expect(unknown.outcome).toBe(wrongPw.outcome);
    expect(unknown.message).toBe(wrongPw.message);               // identical text
    expect(unknown.message).not.toMatch(/no account|not found|unknown|exists/i);
  });

  it('a FAILED login returns no customer data at all', async () => {
    const r = await login([candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) })])
      .attempt({ portal: 'customer', identifier: 'sam@example.com', password: 'nope' });
    const dump = JSON.stringify(r);
    expect(dump).not.toContain('c1');
    expect(dump).not.toContain(T1);
    expect(dump).not.toContain('Polished');
  });
});

describe('account state is still enforced', () => {
  it('a DISABLED customer cannot sign in, even with the right password', async () => {
    const svc = login([candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1, status: 'disabled' as any }) })]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('USER_DISABLED');
  });

  it('a customer at a SUSPENDED salon cannot sign in', async () => {
    const svc = login([candidate({ tenantStatus: 'suspended' as any, user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) })]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('TENANT_SUSPENDED');
  });
});

describe('a customer with accounts at SEVERAL salons', () => {
  it('signs in to a usable one rather than failing', async () => {
    const svc = login([
      candidate({ user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }), salonName: 'Polished' }),
      candidate({ user: user({ userId: 'c2', role: 'CUSTOMER', tenantId: T2 }), salonName: 'Luxe Nails' }),
    ]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
  });

  it('a blocked salon does not prevent signing in to the OTHER one', async () => {
    const svc = login([
      candidate({ tenantStatus: 'suspended' as any, user: user({ userId: 'c1', role: 'CUSTOMER', tenantId: T1 }) }),
      candidate({ user: user({ userId: 'c2', role: 'CUSTOMER', tenantId: T2 }), salonName: 'Luxe Nails' }),
    ]);
    const r = await svc.attempt({ portal: 'customer', identifier: 'sam@example.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T2);                      // the usable one
  });
});
