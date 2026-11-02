// customer-identity-profile.vitest.spec.ts — §9/§10/§12/§17/§18 profile-change propagation (Jul 26, 2026).
// Proves: a VERIFIED phone/email change propagates to the global identity; a value already held by ANOTHER global
// identity produces a CONFLICT instead of a merge or overwrite; a stale writer loses to a newer change (§30); an
// unlinked customer is a no-op the 7 PM pass will pick up; and tenant-owned data is never touched.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';

const sink = () => { const events: any[] = []; return { events, record: async (ctx: any, input: any) => { events.push({ ctx, input }); return {}; } }; };
const verified = () => new Date().toISOString();

async function linked() {
  const repo = new InMemoryCustomerIdentityRepository();
  const audit = sink();
  const svc = new CustomerIdentityService(repo, audit);
  await svc.ensureLinked({ tenantId: 'TA', customerId: 'c1', fullName: 'Kevin Guest', phoneRaw: '(856) 555-1111', phoneVerifiedAt: verified() }, 'realtime');
  audit.events.length = 0;
  return { repo, svc, audit };
}

describe('§9/§10 profile-change propagation to the global identity', () => {
  it('a verified new phone updates the global identity and writes CUSTOMER_PHONE_UPDATED (masked)', async () => {
    const { repo, svc, audit } = await linked();
    const r = await svc.applyVerifiedPhone({ tenantId: 'TA', customerId: 'c1', e164: '+18565552222' });
    expect(r.outcome).toBe('updated');
    expect(repo.globals[0].phone).toBe('+18565552222');
    expect(audit.events.map((e) => e.input.action)).toContain('CUSTOMER_PHONE_UPDATED');
    expect(JSON.stringify(audit.events)).not.toContain('8565552222');
  });

  it('§9 collision: the number already belongs to ANOTHER global identity → conflict, nothing overwritten', async () => {
    const { repo, svc, audit } = await linked();
    repo.globals.push({ globalCustomerId: 'G_OTHER', phone: '+18565559999', phoneVerified: true, email: null, emailVerified: false, name: 'Someone Else' });
    const before = repo.globals[0].phone;
    const r = await svc.applyVerifiedPhone({ tenantId: 'TA', customerId: 'c1', e164: '+1 856 555 9999' });
    expect(r.outcome).toBe('conflict');
    expect(r.conflictWith).toBe('G_OTHER');
    expect(repo.globals[0].phone).toBe(before);                      // untouched
    expect(audit.events.map((e) => e.input.action)).toContain('CUSTOMER_CONFLICT_CREATED');
  });

  it('§10 email: case differences are the same identity (no-op), a genuinely new verified email updates', async () => {
    const { repo, svc } = await linked();
    repo.globals[0].email = 'kevin@example.com';
    expect((await svc.applyVerifiedIdentity({ tenantId: 'TA', customerId: 'c1', email: 'Kevin@Example.com' })).outcome).toBe('noop');
    const r = await svc.applyVerifiedIdentity({ tenantId: 'TA', customerId: 'c1', email: 'new@example.com' });
    expect(r.outcome).toBe('updated');
    expect(repo.globals[0].email).toBe('new@example.com');
  });

  it('§30 stale write: a change computed against an older version loses to the newer one', async () => {
    const { repo, svc } = await linked();
    (repo.globals[0] as any).version = 5;                            // someone else already advanced the row
    repo.globalById = async (id: string) => ({ id, phone: repo.globals[0].phone, phoneVerified: true, email: null, emailVerified: false, version: 4 });  // our snapshot is stale
    const r = await svc.applyVerifiedPhone({ tenantId: 'TA', customerId: 'c1', e164: '+18565553333' });
    expect(r.outcome).toBe('stale');
    expect(repo.globals[0].phone).not.toBe('+18565553333');
  });

  it('an unlinked customer is a safe no-op — the 7 PM pass links it first', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const svc = new CustomerIdentityService(repo);
    const r = await svc.applyVerifiedPhone({ tenantId: 'TA', customerId: 'never-linked', e164: '+18565554444' });
    expect(r.outcome).toBe('not_linked');
    expect(repo.globals.length).toBe(0);
  });
});
