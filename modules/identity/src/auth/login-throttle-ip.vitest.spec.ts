// login-throttle-ip.vitest.spec — Constitution 12 §58: an attacker cannot lock an owner out from every location.
//
// The throttle was designed to key on (portal, salon, identifier, IP), but the controller never passed an IP, so it
// keyed per ACCOUNT: five failures from anywhere locked the account for everyone. With the IP wired, the attacker's
// failures lock the attacker's address.
import { describe, it, expect } from 'vitest';
import { LoginService, InMemoryLoginThrottle } from './auth-login.service';
import { InMemoryAuthUserRepository, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

const PW = 'Correct-Horse-9!';
async function svc() {
  const hash = await hashPassword(PW);
  const u: MemUser = { userId: 'o1', tenantId: 'tA', branchId: 'bA', role: 'OWNER', email: 'own@ip.test', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: 'O' } as any;
  const repo = new InMemoryAuthUserRepository({ tenants: [{ id: 'tA', tenantId: 'tA', tenantCode: 'IPT', status: 'active' }], users: [u], branches: [{ id: 'bA', tenantId: 'tA' }], subscriptions: [] } as any);
  return new LoginService(repo, new InMemoryLoginThrottle());
}
const attempt = (s: LoginService, password: string, ip?: string) => s.attempt({ portal: 'tenant', salonCode: 'IPT', identifier: 'own@ip.test', password, ip } as any);

describe('§58 the login throttle keys on the caller\'s IP', () => {
  it('an attacker failing from one IP locks THAT IP — the owner signs in from hers', async () => {
    const s = await svc();
    for (let i = 0; i < 8; i++) await attempt(s, 'wrong', '198.51.100.9');
    expect((await attempt(s, PW, '198.51.100.9')).outcome).not.toBe('SUCCESS');       // the attacker's address is locked
    expect((await attempt(s, PW, '203.0.113.7')).outcome).toBe('SUCCESS');            // the owner, elsewhere, is not
  });
  it('(without an IP — the old wiring — the same failures lock the owner out everywhere)', async () => {
    const s = await svc();
    for (let i = 0; i < 8; i++) await attempt(s, 'wrong');
    expect((await attempt(s, PW)).outcome).not.toBe('SUCCESS');
  });
});
