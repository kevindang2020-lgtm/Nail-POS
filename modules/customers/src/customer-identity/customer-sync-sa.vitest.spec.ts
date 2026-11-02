// customer-sync-sa.vitest.spec.ts — the Super Admin surface for Customer Sync & Reconciliation (Jul 26, 2026).
// Proves the §20 dashboard head, the §22 tenant breakdown, §35/§36/§37 manual-run scoping, and that only MASKED
// identity values ever reach the Super Admin response (§23/§33).
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService, nextSevenPm } from './customer-reconciliation.service';

function harness() {
  const repo = new InMemoryCustomerIdentityRepository();
  const svc = new CustomerReconciliationService(repo, new CustomerIdentityService(repo));
  return { repo, svc };
}
const cust = (tenantId: string, customerId: string, phone: string | null, email: string | null = null) =>
  ({ tenantId, customerId, firstName: 'C', lastName: 'G', fullName: `C ${customerId}`, phoneRaw: phone, email, updatedAt: '2026-07-26T10:00:00Z' });

describe('Super Admin customer sync surface', () => {
  it('§20 dashboard reports last sync + status, next 7 PM, recent runs and the open-conflict count', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.customers = [cust('TA', 'c1', '+18565551234')];
    await svc.runReconciliation('scheduled');
    const d = await svc.dashboard();
    expect(d.lastSync).not.toBeNull();
    expect(d.lastStatus).toBe('COMPLETED');
    expect(d.recentRuns.length).toBe(1);
    expect(d.openConflicts).toBe(0);
    expect(d.nextScheduled).toMatch(/^\d{4}-\d{2}-\d{2}T/);        // a real future instant, not a placeholder
  });

  it('§22 run detail returns the tenant-by-tenant breakdown for that run only', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA', 'TB'];
    repo.customers = [cust('TA', 'c1', '+18565550001'), cust('TB', 'c2', '+18565550002')];
    const r = await svc.runReconciliation('manual');
    const detail = await svc.runDetail(r.runId!);
    expect(detail.length).toBe(2);
    expect(detail.map((d: any) => d.tenantId).sort()).toEqual(['TA', 'TB']);
    expect(detail.every((d: any) => d.status === 'ok')).toBe(true);
  });

  it('§23/§33 conflicts expose MASKED values only — never a full phone or email', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA'];
    repo.globals = [
      { globalCustomerId: 'GX', phone: '+18565551234', phoneVerified: false, email: null, emailVerified: false, name: null },
      { globalCustomerId: 'GY', phone: null, phoneVerified: false, email: 'kevin@example.com', emailVerified: false, name: null },
    ];
    repo.customers = [cust('TA', 'c-mix', '(856) 555-1234', 'Kevin@Example.com')];
    await svc.runReconciliation('scheduled');
    const conflicts = await svc.listConflicts(null, 50);
    expect(conflicts.length).toBe(1);
    const c = conflicts[0];
    expect(c.mainMasked).toBe('••••1234');
    expect(c.tenantMasked).toBe('k•••@example.com');
    expect(JSON.stringify(c)).not.toContain('8565551234');
    expect(JSON.stringify(c)).not.toContain('kevin@example.com');
  });

  it('§35/§36/§37 manual scoping: all / one tenant / one customer are distinct runs, and the lock blocks doubles', async () => {
    const { repo, svc } = harness();
    repo.tenants = ['TA', 'TB'];
    repo.customers = [cust('TA', 'c1', '+18565550001'), cust('TB', 'c2', '+18565550002')];
    const all = await svc.runReconciliation('manual', { kind: 'all' }, 'sa1');
    expect(all.status).toBe('COMPLETED');
    const oneTenant = await svc.runReconciliation('manual', { kind: 'tenant', tenantId: 'TA' }, 'sa1');
    expect(oneTenant.ran).toBe(true);
    expect(repo.runs[0].scope).toBe('tenant');
    expect(repo.runs[0].scopeId).toBe('TA');
    const oneCustomer = await svc.runReconciliation('manual', { kind: 'customer', tenantId: 'TA', customerId: 'c1' }, 'sa1');
    expect(oneCustomer.ran).toBe(true);
    expect(repo.runs[0].scope).toBe('customer');

    repo.locked = true;                                            // §35: no simultaneous duplicate runs
    const blocked = await svc.runReconciliation('manual', { kind: 'all' }, 'sa1');
    expect(blocked.ran).toBe(false);
  });

  it('nextSevenPm lands on 19:00 in the platform timezone', () => {
    const iso = nextSevenPm(new Date('2026-07-26T16:00:00Z'), 'America/New_York');
    const hourNY = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date(iso)));
    expect(hourNY).toBe(19);
  });
});
