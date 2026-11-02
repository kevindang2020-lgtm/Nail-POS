import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for controlled worker branch transfer (§30): request records (no move yet) + audits; same-branch and
// reason-less requests rejected; pipeline is summarized; decide approves (move executes downstream in repo) or rejects,
// only from 'requested', and audits. Repo faked to assert orchestration.
function harness(over: Partial<Record<string, any>> = {}) {
  const repo = {
    workerTransferTarget: vi.fn(async () => ({ userId: 'u1', name: 'Sarah', tenantId: 't1', branchId: 'b1' })),
    createWorkerTransferRequest: vi.fn(async () => ({ id: 'req1' })),
    recordWorkforceAudit: vi.fn(async () => {}),
    workerTransferPipeline: vi.fn(async () => ({ counts: [{ status: 'requested', count: 2 }, { status: 'approved', count: 1 }], pending: [{ id: 'req1', workerId: 'u1', workerName: 'Sarah', tenant: 'T', fromBranch: 'A', toBranch: 'B', status: 'requested', reason: 'cover leave', requestedAt: null, decidedAt: null, decisionNote: null }] })),
    getWorkerTransferRequest: vi.fn(async () => ({ id: 'req1', tenantId: 't1', userId: 'u1', toBranchId: 'b2', status: 'requested' })),
    decideWorkerTransfer: vi.fn(async (id: string, decision: string) => ({ id, tenantId: 't1', userId: 'u1', toBranchId: 'b2', status: decision === 'approve' ? 'approved' : 'rejected' })),
    ...over,
  };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService worker transfer (§30)', () => {
  it('records a transfer request (no move) and audits', async () => {
    const { svc, repo } = harness();
    const r = await svc.requestWorkerTransfer(ctx, 'u1', { toBranchId: 'b2', reason: 'cover maternity leave' });
    expect(r).toEqual({ ok: true, id: 'req1', status: 'requested' });
    expect(repo.createWorkerTransferRequest).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', fromBranchId: 'b1', toBranchId: 'b2', reason: 'cover maternity leave' }));
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_transfer_requested', 'u1', expect.objectContaining({ requestId: 'req1', toBranchId: 'b2' }));
  });

  it('rejects a same-branch or reason-less request before insert', async () => {
    const { svc, repo } = harness();
    await expect(svc.requestWorkerTransfer(ctx, 'u1', { toBranchId: 'b1', reason: 'valid enough reason' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.requestWorkerTransfer(ctx, 'u1', { toBranchId: 'b2', reason: 'no' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.createWorkerTransferRequest).not.toHaveBeenCalled();
  });

  it('404s an unknown worker', async () => {
    const { svc } = harness({ workerTransferTarget: vi.fn(async () => null) });
    await expect(svc.requestWorkerTransfer(ctx, 'ghost', { toBranchId: 'b2', reason: 'a valid reason here' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('summarizes the pipeline for the panel', async () => {
    const { svc } = harness();
    const p = await svc.getWorkforceTransfers(ctx);
    expect(p.available).toBe(true);
    expect(p.total).toBe(3);
    expect(p.byStatus.requested).toBe(2);
    expect(p.pending).toHaveLength(1);
  });

  it('approves a pending request and audits the decision', async () => {
    const { svc, repo } = harness();
    const r = await svc.decideWorkerTransfer(ctx, 'req1', { decision: 'approve' });
    expect(r).toEqual({ ok: true, id: 'req1', status: 'approved' });
    expect(repo.decideWorkerTransfer).toHaveBeenCalledWith('req1', 'approve', null, 'admin-1');
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_transfer_decided', 'u1', expect.objectContaining({ decision: 'approve', status: 'approved' }));
  });

  it('refuses to decide a request that is already decided', async () => {
    const { svc, repo } = harness({ getWorkerTransferRequest: vi.fn(async () => ({ id: 'req1', tenantId: 't1', userId: 'u1', toBranchId: 'b2', status: 'approved' })) });
    await expect(svc.decideWorkerTransfer(ctx, 'req1', { decision: 'reject', note: 'headcount balanced already' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.decideWorkerTransfer).not.toHaveBeenCalled();
  });

  it('requires a note to reject', async () => {
    const { svc } = harness();
    await expect(svc.decideWorkerTransfer(ctx, 'req1', { decision: 'reject', note: 'no' })).rejects.toMatchObject({ code: 'invalid' });
  });
});
