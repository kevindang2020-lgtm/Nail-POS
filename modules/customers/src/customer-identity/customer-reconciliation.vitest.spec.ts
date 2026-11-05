// customer-reconciliation.vitest.spec.ts — the 7 PM engine's semantics (Jul 26, 2026).
// Pins: incremental cursor (linked+unchanged customers are NOT rescanned), per-tenant failure isolation → PARTIAL
// (§26), conflict fingerprint dedupe across nights (occurrence bump, one row), advisory-lock skip, scoped
// re-sync ignoring the cursor, and honest status ladder COMPLETED / COMPLETED_WITH_ISSUES / PARTIAL.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository, type UnreconciledCustomer } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService } from './customer-reconciliation.service';

const cust = (tenantId: string, customerId: string, phone: string | null, email: string | null = null, updatedAt = '2026-07-26T10:00:00Z'): UnreconciledCustomer =>
  ({ tenantId, customerId, firstName: 'C', lastName: 'G', fullName: `C ${customerId}`, phoneRaw: phone, email, updatedAt });

function harness() {
  const repo = new InMemoryCustomerIdentityRepository();
  const svc = new CustomerReconciliationService(repo, new CustomerIdentityService(repo));
  return { repo, svc };
}

describe('customer reconciliation engine', () => {
  it('two tenants sharing a phone → ONE global, two links, COMPLETED; the second run is incremental and scans nothing', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA', 'TB'];
    repo.customers = [cust('TA', 'c-a1', '(856) 555-1234'), cust('TB', 'c-b1', '+1 856 555 1234')];
    const r1 = await svc.runReconciliation('manual');
    expect(r1.status).toBe('COMPLETED');
    expect(r1.customersScanned).toBe(2);
    expect(r1.newGlobals).toBe(1);
    expect(r1.linkedExisting).toBe(1);
    expect(repo.globals.length).toBe(1);
    expect(repo.links.length).toBe(2);

    const r2 = await svc.runReconciliation('manual');           // both linked, nothing changed since r1
    expect(r2.status).toBe('COMPLETED');
    expect(r2.customersScanned).toBe(0);                        // §29: no nightly full re-scan
  });

  it('one tenant throwing makes the run PARTIAL without stopping the others (§26)', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['T_BAD', 'T_OK'];
    repo.customers = [cust('T_OK', 'c-ok', '+18565550001')];
    const orig = repo.customersToReconcile.bind(repo);
    repo.customersToReconcile = async (tenantId, ...rest) => {
      if (tenantId === 'T_BAD') throw new Error('tenant db exploded');
      return orig(tenantId, ...rest);
    };
    const r = await svc.runReconciliation('manual');
    expect(r.status).toBe('PARTIAL');
    expect(r.errors).toBe(1);
    expect(r.linkedExisting! + r.newGlobals!).toBe(1);          // T_OK still fully processed
    expect(repo.tenantStats.find((s) => s.tenantId === 'T_BAD')?.status).toBe('failed');
    expect(repo.tenantStats.find((s) => s.tenantId === 'T_OK')?.status).toBe('ok');
  });

  it('the §39 conflict (phone→X, email→Y) becomes ONE deduplicated review row across two nights, and the run says COMPLETED_WITH_ISSUES', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.globals = [
      { globalCustomerId: 'GX', phone: '+18565551234', phoneVerified: false, email: null, emailVerified: false, name: null },
      { globalCustomerId: 'GY', phone: null, phoneVerified: false, email: 'kevin@example.com', emailVerified: false, name: null },
    ];
    repo.customers = [cust('TA', 'c-mix', '(856) 555-1234', 'Kevin@Example.com')];
    const r1 = await svc.runReconciliation('manual');
    expect(r1.status).toBe('COMPLETED_WITH_ISSUES');
    expect(r1.duplicateSuspects).toBe(1);
    expect(r1.conflicts).toBe(1);
    expect(repo.conflictRows.length).toBe(1);
    expect(repo.conflictRows[0].kind).toBe('PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS');

    // Night 2: the same unresolved situation — the customer is still unlinked, so it IS rescanned; the conflict dedupes.
    const r2 = await svc.runReconciliation('manual');
    expect(repo.conflictRows.length).toBe(1);
    expect(repo.conflictRows[0].occurrences).toBe(2);
    expect(r2.conflicts).toBe(0);                               // bumped, not newly created
    expect(r2.duplicateSuspects).toBe(1);
  });

  it('advisory lock: a concurrent run skips honestly with no phantom run row', async () => {
    const { repo, svc } = harness();
    repo.locked = true;
    const r = await svc.runReconciliation('scheduled');
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toMatch(/advisory lock/);
    expect(repo.runs.length).toBe(0);
  });

  it('RE-SYNC one customer: scoped runs ignore the incremental cursor and touch only that customer', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c-1', '+18565550001'), cust('TA', 'c-2', '+18565550002')];
    await svc.runReconciliation('manual');                      // links both
    const r = await svc.runReconciliation('manual', { kind: 'customer', tenantId: 'TA', customerId: 'c-1' }, 'sa1');
    expect(r.ran).toBe(true);
    expect(r.customersScanned).toBe(1);                          // FIXED Jul 27: a scoped RE-SYNC forces re-examination of an already-linked, unchanged customer (see customer-sync-hardening.vitest.spec)
    const r2 = await svc.runReconciliation('manual', { kind: 'tenant', tenantId: 'TA' }, 'sa1');
    expect(r2.status).toBe('COMPLETED');
  });
});
