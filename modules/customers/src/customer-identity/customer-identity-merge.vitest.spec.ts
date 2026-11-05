// customer-identity-merge.vitest.spec.ts — §15/§24 reversible merge + §19 conflict lifecycle (Jul 26, 2026).
// Proves: merge requires explicit confirmation; the source identity is RETIRED, never deleted (reversible); its
// tenant links are repointed; a legal hold blocks the merge outright; the preview exposes MASKED values and
// relationship counts only — never another salon's data; and conflict statuses transition and record the actor.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService } from './customer-reconciliation.service';

async function twoIdentities(holds?: any) {
  const repo = new InMemoryCustomerIdentityRepository();
  const identity = new CustomerIdentityService(repo);
  const svc = new CustomerReconciliationService(repo, identity, holds);
  await identity.ensureLinked({ tenantId: 'TA', customerId: 'ca', fullName: 'Kevin Guest', phoneRaw: '+18565551111' }, 'realtime');
  await identity.ensureLinked({ tenantId: 'TB', customerId: 'cb', fullName: 'Kevin Guest', email: 'kevin@example.com' }, 'realtime');
  const [a, b] = repo.globals.map((g) => g.globalCustomerId);
  return { repo, svc, a, b };
}

describe('§24 merge & §19 conflict lifecycle', () => {
  it('a merge without confirmation is refused (no silent destructive action)', async () => {
    const { svc, a, b } = await twoIdentities();
    expect(await svc.mergeIdentities(a, b, 'sa1', false)).toMatchObject({ ok: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(await svc.mergeIdentities(a, a, 'sa1', true)).toMatchObject({ ok: false, reason: 'INVALID_PAIR' });
  });

  it('a confirmed merge repoints the links and RETIRES the source — the original row survives (reversible)', async () => {
    const { repo, svc, a, b } = await twoIdentities();
    const r = await svc.mergeIdentities(a, b, 'sa1', true);
    expect(r).toMatchObject({ ok: true, moved: 1 });
    const source: any = repo.globals.find((g) => g.globalCustomerId === a);
    expect(source).toBeTruthy();                                  // §15: never destroyed
    expect(source.status).toBe('merged');
    expect(source.mergedIntoId).toBe(b);
    expect(repo.links.every((l) => l.globalCustomerId === b)).toBe(true);
    expect(repo.links.length).toBe(2);                            // both salon relationships preserved
  });

  it('§15 a legal hold on any linked customer blocks the merge', async () => {
    const holds = { assertDeletable: async () => ({ deletable: false, blockingHolds: [{ id: 'h1' }] }) };
    const { repo, svc, a, b } = await twoIdentities(holds);
    const r = await svc.mergeIdentities(a, b, 'sa1', true);
    expect(r).toMatchObject({ ok: false, reason: 'LEGAL_HOLD' });
    expect(repo.globals.find((g) => g.globalCustomerId === a)!.status ?? 'active').toBe('active');
  });

  it('§24 preview shows masked values and RELATIONSHIP COUNTS only — no salon data crosses', async () => {
    const { svc, a, b } = await twoIdentities();
    const p = await svc.mergePreview(a, b);
    expect(p.a.phoneMasked).toBe('••••1111');
    expect(p.b.emailMasked).toBe('k•••@example.com');
    expect(p.a.linkedTenants).toBe(1);
    expect(p.b.linkedTenants).toBe(1);
    const json = JSON.stringify(p);
    expect(json).not.toContain('8565551111');
    expect(json).not.toContain('kevin@example.com');
    expect(json).not.toContain('notes');                          // tenant-owned fields are simply not in the shape
  });

  it('§19 conflict statuses transition and record who resolved them', async () => {
    const { repo, svc } = await twoIdentities();
    await repo.upsertConflict({ fingerprint: 'F1', kind: 'PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS', tenantId: 'TA', customerId: 'ca', runId: 'r1' });
    expect(await svc.resolveConflict('F1', 'KEEP_SEPARATE', 'sa1')).toBe(true);
    expect(repo.conflictRows[0].status).toBe('KEEP_SEPARATE');
    expect(repo.conflictRows[0].resolvedByUserId).toBe('sa1');
  });
});
