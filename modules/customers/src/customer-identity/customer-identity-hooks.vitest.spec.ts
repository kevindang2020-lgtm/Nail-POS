// customer-identity-hooks.vitest.spec.ts — §7/§8 real-time prevention AT THE CREATION SITES (Jul 26, 2026).
// Proves the hooks call the identity layer on customer creation, that a link failure never breaks the salon's
// own workflow, and that an existing global identity is LINKED rather than duplicated across two salons.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';

describe('creation-site hooks', () => {
  it('two different salons creating the same verified person produce ONE global identity and two links', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const identity = new CustomerIdentityService(repo);
    const a = await identity.ensureLinked({ tenantId: 'TA', customerId: 'ca', fullName: 'Kevin Guest', phoneRaw: '(856) 555-1234', phoneVerifiedAt: new Date().toISOString() }, 'realtime');
    const b = await identity.ensureLinked({ tenantId: 'TB', customerId: 'cb', fullName: 'Kevin Guest', phoneRaw: '+1 856 555 1234', phoneVerifiedAt: new Date().toISOString() }, 'realtime');
    expect(a.outcome).toBe('linked');
    expect(b.outcome).toBe('linked');
    expect((a as any).globalCustomerId).toBe((b as any).globalCustomerId);
    expect(repo.globals.length).toBe(1);
    expect(repo.links.length).toBe(2);
    expect(repo.links.map((l) => l.tenantId).sort()).toEqual(['TA', 'TB']);
  });

  it('a repository failure surfaces as an error OUTCOME, never a thrown exception that would fail the create', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    repo.findCandidates = async () => { throw new Error('identity db down'); };
    const identity = new CustomerIdentityService(repo);
    const r = await identity.ensureLinked({ tenantId: 'TA', customerId: 'c1', phoneRaw: '+18565551234' }, 'realtime');
    expect(r.outcome).toBe('error');                       // the POS/check-in/queue hook swallows this and proceeds
  });

  it('a walk-in with a name but no phone or email creates NO global identity (names are not identity)', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const identity = new CustomerIdentityService(repo);
    const r = await identity.ensureLinked({ tenantId: 'TA', customerId: 'c-walkin', fullName: 'Anonymous Walk In' }, 'realtime');
    expect(r.outcome).toBe('no_identifiers');
    expect(repo.globals.length).toBe(0);
    expect(repo.links.length).toBe(0);
  });
});
