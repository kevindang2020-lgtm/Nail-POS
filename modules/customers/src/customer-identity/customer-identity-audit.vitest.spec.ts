// customer-identity-audit.vitest.spec.ts — §25 audit history for identity changes (Jul 26, 2026).
// Every automated identity decision writes an auditable event: creation, duplicate-prevention link, and the
// ambiguous case that was deliberately NOT merged. Values are masked; the reconciliation run id travels with the
// event; and an audit failure never changes the identity outcome.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';

const sink = () => { const events: any[] = []; return { events, record: async (ctx: any, input: any) => { events.push({ ctx, input }); return {}; } }; };

describe('§25 identity audit events', () => {
  it('CUSTOMER_GLOBAL_CREATED then CUSTOMER_GLOBAL_LINKED (duplicate prevented), both masked and tenant-scoped', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const audit = sink();
    const svc = new CustomerIdentityService(repo, audit);
    await svc.ensureLinked({ tenantId: 'TA', customerId: 'ca', fullName: 'Kevin Guest', phoneRaw: '(856) 555-1234', email: 'Kevin@Example.com', phoneVerifiedAt: new Date().toISOString() }, 'realtime');
    await svc.ensureLinked({ tenantId: 'TB', customerId: 'cb', fullName: 'Kevin Guest', phoneRaw: '+1 856 555 1234', phoneVerifiedAt: new Date().toISOString() }, 'reconciliation', 'run_7');

    expect(audit.events.map((e) => e.input.action)).toEqual(['CUSTOMER_GLOBAL_CREATED', 'CUSTOMER_GLOBAL_LINKED']);
    const [created, linked] = audit.events;
    expect(created.ctx.tenantId).toBe('TA');
    expect(linked.ctx.tenantId).toBe('TB');                       // each salon's own audit trail
    // B-14 remainder: the ONE system-context shape (systemContext) — the audit row then keeps no user and names the job
    expect(created.ctx).toMatchObject({ userId: 'system:customer-identity', role: 'SYSTEM', actor: 'customer-identity', actorName: 'Customer Identity' });
    expect(linked.input.metadata.duplicatePrevented).toBe(true);
    expect(linked.input.metadata.reconciliationRunId).toBe('run_7');
    expect(linked.input.metadata.globalCustomerId).toBe(created.input.metadata.globalCustomerId);
    // masked values only
    expect(created.input.metadata.phoneMasked).toBe('••••1234');
    expect(JSON.stringify(created)).not.toContain('8565551234');
    expect(JSON.stringify(created)).not.toContain('kevin@example.com');
  });

  it('an ambiguous identity writes CUSTOMER_DUPLICATE_FLAGGED and merges nothing', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    repo.globals = [
      { globalCustomerId: 'GX', phone: '+18565551234', phoneVerified: false, email: null, emailVerified: false, name: null },
      { globalCustomerId: 'GY', phone: null, phoneVerified: false, email: 'kevin@example.com', emailVerified: false, name: null },
    ];
    const audit = sink();
    const svc = new CustomerIdentityService(repo, audit);
    const r = await svc.ensureLinked({ tenantId: 'TA', customerId: 'c-mix', phoneRaw: '(856) 555-1234', email: 'Kevin@Example.com' }, 'realtime');
    expect(r.outcome).toBe('review');
    expect(audit.events[0].input.action).toBe('CUSTOMER_DUPLICATE_FLAGGED');
    expect(audit.events[0].input.metadata.reason).toBe('PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS');
    expect(repo.links.length).toBe(0);
    expect(repo.globals.length).toBe(2);                          // nothing created, nothing merged
  });

  it('an audit sink failure never changes the identity outcome', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const svc = new CustomerIdentityService(repo, { record: async () => { throw new Error('audit down'); } });
    const r = await svc.ensureLinked({ tenantId: 'TA', customerId: 'c1', phoneRaw: '+18565551234' }, 'realtime');
    expect(r.outcome).toBe('linked');
    expect(repo.links.length).toBe(1);
  });

  it('the §8 verified-identity race emits CUSTOMER_DUPLICATE_PREVENTED with no raw phone in the trail', async () => {
    const repo = new InMemoryCustomerIdentityRepository();
    const audit = sink();
    const svc = new CustomerIdentityService(repo, audit);
    const verified = new Date().toISOString();
    // Salon A wins the race and owns the verified identity…
    await svc.ensureLinked({ tenantId: 'TA', customerId: 'ca', fullName: 'Kevin Guest', phoneRaw: '(856) 555-1234', phoneVerifiedAt: verified }, 'realtime');
    // …Salon B's concurrent create finds no candidate yet and attempts its own global — the unique index collapses it.
    repo.findCandidates = async () => [];
    audit.events.length = 0;
    await svc.ensureLinked({ tenantId: 'TB', customerId: 'cb', fullName: 'Kevin Guest', phoneRaw: '+1 856 555 1234', phoneVerifiedAt: verified }, 'realtime');
    const actions = audit.events.map((e) => e.input.action);
    expect(actions).toContain('CUSTOMER_DUPLICATE_PREVENTED');
    expect(repo.globals.length).toBe(1);
    expect(JSON.stringify(audit.events)).not.toContain('8565551234');
  });
});
