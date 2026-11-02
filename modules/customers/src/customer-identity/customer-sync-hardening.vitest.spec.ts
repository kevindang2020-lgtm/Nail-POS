// customer-sync-hardening.vitest.spec.ts — the four gaps closed on Jul 27, 2026.
//   (2) a SECOND, database-enforced guard against concurrent platform runs (migration 422)
//   (4) scoped RE-SYNC forces re-examination of already-linked, unchanged customers
//   (5) imports link a bounded batch inline; the overflow is honestly reported as deferred
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository, type UnreconciledCustomer } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService } from './customer-reconciliation.service';

const cust = (tenantId: string, customerId: string, phone: string | null, email: string | null = null): UnreconciledCustomer =>
  ({ tenantId, customerId, firstName: 'C', lastName: 'G', fullName: `C ${customerId}`, phoneRaw: phone, email, updatedAt: '2026-07-26T10:00:00Z' });

function harness() {
  const repo = new InMemoryCustomerIdentityRepository();
  const identity = new CustomerIdentityService(repo);
  const svc = new CustomerReconciliationService(repo, identity);
  return { repo, identity, svc };
}

describe('(2) concurrent platform runs are refused by the database guard, not just the advisory lock', () => {
  it('a second platform-wide run cannot start while one is RUNNING — and no second run row is created', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565550001')];
    // Simulate the pooler failure mode: the advisory lock is NOT held (another backend has it), so the run gets
    // past the lock — exactly the case migration 422 exists for.
    repo.runs.unshift({ id: 'in-flight', trigger: 'scheduled', scope: 'all', status: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null });
    const r = await svc.runReconciliation('scheduled');
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toMatch(/database guard/);
    expect(repo.runs.filter((x) => x.status === 'RUNNING').length).toBe(1);   // still just the one
  });

  it('a SCOPED re-sync is deliberately NOT blocked by an in-flight platform run (support must not be stuck)', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565550001')];
    repo.runs.unshift({ id: 'in-flight', trigger: 'scheduled', scope: 'all', status: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null });
    const r = await svc.runReconciliation('manual', { kind: 'tenant', tenantId: 'TA' }, 'sa1');
    expect(r.ran).toBe(true);
    expect(r.status).toBe('COMPLETED');
  });
});

describe('(4) scoped RE-SYNC forces re-examination of already-linked records', () => {
  it('re-syncing one customer actually scans it, where the nightly pass would skip it', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565550001'), cust('TA', 'c2', '+18565550002')];
    await svc.runReconciliation('manual');                       // both linked
    const nightly = await svc.runReconciliation('scheduled');
    expect(nightly.customersScanned).toBe(0);                    // incremental: nothing to do

    const forced = await svc.runReconciliation('manual', { kind: 'customer', tenantId: 'TA', customerId: 'c1' }, 'sa1');
    expect(forced.customersScanned).toBe(1);                     // the button now does something
  });

  it('a link that no longer matches the record becomes a LINK_MISMATCH review row — never a silent repoint', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565550001')];
    await svc.runReconciliation('manual');
    const globalId = repo.links[0].globalCustomerId;

    // The customer's number was corrected to a completely different person's; the old mapping is now wrong.
    repo.customers[0].phoneRaw = '+18565559999';
    const forced = await svc.runReconciliation('manual', { kind: 'customer', tenantId: 'TA', customerId: 'c1' }, 'sa1');
    expect(forced.status).toBe('COMPLETED_WITH_ISSUES');
    const mismatch = repo.conflictRows.find((c) => c.kind === 'LINK_MISMATCH');
    expect(mismatch).toBeTruthy();
    expect(mismatch.customerId).toBe('c1');
    expect(repo.links[0].globalCustomerId).toBe(globalId);       // untouched — a human decides
    expect(mismatch.mainMasked).toBe('••••9999');                // masked, per §23
  });

  it('a still-correct link is re-examined quietly — no conflict noise', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565550001')];
    await svc.runReconciliation('manual');
    const forced = await svc.runReconciliation('manual', { kind: 'customer', tenantId: 'TA', customerId: 'c1' }, 'sa1');
    expect(forced.status).toBe('COMPLETED');
    expect(repo.conflictRows.length).toBe(0);
  });
});

describe('(5) imports link inline up to a cap and report the remainder honestly', () => {
  it('a small import is fully linked before the response returns', async () => {
    const { repo, identity } = harness();
    repo.customers = [cust('TA', 'i1', '+18565550011'), cust('TA', 'i2', '+18565550012'), cust('TA', 'i3', '+18565550013')];
    const r = await identity.linkUnlinkedForTenant('TA', 500);
    expect(r.linked).toBe(3);
    expect(r.newGlobals).toBe(3);
    expect(r.deferred).toBe(false);
    expect(repo.links.length).toBe(3);
  });

  it('a large import links the cap inline and flags the rest as deferred — the nightly pass then finishes them', async () => {
    const { repo, identity, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = Array.from({ length: 12 }, (_, i) => cust('TA', `i${i}`, `+1856555${String(1000 + i)}`));
    const r = await identity.linkUnlinkedForTenant('TA', 5);
    expect(r.linked).toBe(5);
    expect(r.deferred).toBe(true);                               // honest: not everything is linked yet
    expect(repo.links.length).toBe(5);

    const nightly = await svc.runReconciliation('scheduled');    // the safety net picks up exactly the remainder
    expect(nightly.customersScanned).toBe(7);
    expect(repo.links.length).toBe(12);
  });

  it('an identity failure during import linking is swallowed — the import still succeeds', async () => {
    const { repo, identity } = harness();
    repo.customers = [cust('TA', 'i1', '+18565550011')];
    repo.customersToReconcile = async () => { throw new Error('identity db down'); };
    const r = await identity.linkUnlinkedForTenant('TA', 500);
    expect(r).toEqual({ linked: 0, newGlobals: 0, review: 0, deferred: false });
  });
});
