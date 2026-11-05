import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for duplicate review (§28/29): validates the group + canonical, re-confirms server-side that the
// members are a real duplicate group (can't flag arbitrary users), audits the canonical/flagged decision, and NEVER
// merges or deletes (no merge/delete repo methods are even called). The group list passes through from the repo.
function harness(confirm: { tenantId: string | null; maskedEmail: string } | null = { tenantId: 't1', maskedEmail: 'a•••@x.test' }) {
  const repo = {
    duplicateGroups: vi.fn(async () => [{ tenantId: 't1', tenant: 'Glamour', maskedEmail: 'a•••@x.test', members: [
      { workerId: 'u1', name: 'Ann A', role: 'TECHNICIAN', status: 'active', lastLogin: null, createdAt: '2026-01-01T00:00:00Z' },
      { workerId: 'u2', name: 'Ann Alt', role: 'TECHNICIAN', status: 'invited', lastLogin: null, createdAt: '2026-02-01T00:00:00Z' },
    ] }]),
    confirmDuplicateGroup: vi.fn(async () => confirm),
    recordWorkforceAudit: vi.fn(async () => undefined),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.reviewDuplicate', () => {
  it('records a review (canonical + flagged + reason) for a confirmed group', async () => {
    const { svc, repo } = harness();
    const r = await svc.reviewDuplicate(ctx, { canonicalId: 'u1', memberIds: ['u1', 'u2'], reason: 'keep the original record' });
    expect(r).toEqual({ ok: true, canonicalId: 'u1', flaggedIds: ['u2'], maskedEmail: 'a•••@x.test' });
    expect(repo.confirmDuplicateGroup).toHaveBeenCalledWith('u1', ['u1', 'u2']);
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_duplicate_reviewed', 'u1', expect.objectContaining({ canonicalId: 'u1', flaggedIds: ['u2'], reason: 'keep the original record' }));
  });

  it('rejects invalid input before confirming or auditing', async () => {
    const { svc, repo } = harness();
    await expect(svc.reviewDuplicate(ctx, { canonicalId: 'u3', memberIds: ['u1', 'u2'], reason: 'a valid reason here' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.confirmDuplicateGroup).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('rejects when the group is not confirmed as a real duplicate (no audit)', async () => {
    const { svc, repo } = harness(null);
    await expect(svc.reviewDuplicate(ctx, { canonicalId: 'u1', memberIds: ['u1', 'u2'], reason: 'these look the same' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('exposes duplicate groups from the repo', async () => {
    const { svc } = harness();
    const g = await svc.getDuplicateGroups(ctx);
    expect(g).toHaveLength(1);
    expect(g[0].members.map((m) => m.workerId)).toEqual(['u1', 'u2']);
  });
});
