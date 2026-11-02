import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for cross-tenant transfer (§31): validates elevated rules, confirms the destination tenant exists
// and differs, creates a REVIEWED request + audits it, and on decision only records the outcome (audit metadata marks
// provisioning 'deferred' — no access/history is moved). Refuses same-tenant, unknown destination, unknown worker, and
// decisions on already-resolved requests, all before mutation.
function harness(opts: { target?: { userId: string; name: string; tenantId: string | null } | null; tenantExists?: boolean; req?: { id: string; userId: string; toTenantId: string; status: string } | null } = {}) {
  const target = opts.target === undefined ? { userId: 'u1', name: 'Sam', tenantId: 't1' } : opts.target;
  const repo = {
    workerCrossTransferTarget: vi.fn(async () => target),
    tenantExists: vi.fn(async () => opts.tenantExists ?? true),
    createCrossTransferRequest: vi.fn(async () => ({ id: 'req-1' })),
    crossTransferList: vi.fn(async () => [{ id: 'req-1', workerId: 'u1', workerName: 'Sam', fromTenant: 'A', toTenant: 'B', toBranch: null, effectiveDate: null, status: 'requested', reason: 'x', requestedAt: null, decidedAt: null, decisionNote: null }]),
    getCrossTransferRequest: vi.fn(async () => opts.req === undefined ? { id: 'req-1', userId: 'u1', toTenantId: 't2', status: 'requested' } : opts.req),
    decideCrossTransfer: vi.fn(async (_id: string, decision: string) => ({ id: 'req-1', userId: 'u1', toTenantId: 't2', status: decision === 'approve' ? 'approved' : 'rejected' })),
    recordWorkforceAudit: vi.fn(async () => undefined),
  };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService cross-tenant transfer (§31)', () => {
  it('creates a reviewed request to a different, existing tenant and audits it', async () => {
    const { svc, repo } = harness();
    const r = await svc.requestCrossTenantTransfer(ctx, 'u1', { toTenantId: 't2', reason: 'approved relocation to sister brand' });
    expect(r).toEqual({ ok: true, id: 'req-1', status: 'requested' });
    expect(repo.tenantExists).toHaveBeenCalledWith('t2');
    expect(repo.createCrossTransferRequest).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', fromTenantId: 't1', toTenantId: 't2' }));
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_cross_tenant_transfer_requested', 'u1', expect.objectContaining({ toTenantId: 't2' }));
  });

  it('rejects a same-tenant destination before touching the repo', async () => {
    const { svc, repo } = harness();
    await expect(svc.requestCrossTenantTransfer(ctx, 'u1', { toTenantId: 't1', reason: 'this is long enough to pass' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.createCrossTransferRequest).not.toHaveBeenCalled();
  });

  it('rejects when the destination tenant does not exist', async () => {
    const { svc, repo } = harness({ tenantExists: false });
    await expect(svc.requestCrossTenantTransfer(ctx, 'u1', { toTenantId: 'tX', reason: 'valid business justification' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.createCrossTransferRequest).not.toHaveBeenCalled();
    expect(repo.recordWorkforceAudit).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown worker', async () => {
    const { svc } = harness({ target: null });
    await expect(svc.requestCrossTenantTransfer(ctx, 'ghost', { toTenantId: 't2', reason: 'valid business justification' })).rejects.toMatchObject({ code: 'not_found' });
  });

  // ── THIS TEST WAS CHANGED, AND THE OLD ASSERTION IS WORTH KEEPING IN VIEW ────────────────────────────
  //
  // It used to be:
  //
  //     it('records an approval decision WITHOUT provisioning (audit marks it deferred)', …)
  //       expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(…, { provisioning: 'deferred' })
  //
  // It passed. It was green for months. And what it was asserting was the BUG: a Super Admin approved a
  // cross-tenant transfer, every screen showed "approved", the audit row said `provisioning: 'deferred'` — and
  // the technician was still at the old salon with no access to the new one and nothing anywhere to say why.
  //
  // A test can pin a defect in place as firmly as it can protect a feature. The assertion is updated rather than
  // deleted, so the diff shows exactly which behaviour changed and that it changed on purpose.
  it('an approved transfer is EXECUTED through the canonical membership path', async () => {
    const { svc, repo } = harness();
    const execute = vi.fn().mockResolvedValue({ executed: true, membershipId: 'm1', membershipStatus: 'pending_tech_approval', profileId: 'p1' });
    const withExecutor = new SuperAdminStaffService(repo as any, { execute });

    const r = await withExecutor.decideCrossTenantTransfer(ctx, 'req-1', { decision: 'approve' });

    expect(r).toMatchObject({ ok: true, id: 'req-1', status: 'approved' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', userId: 'u1', toTenantId: 't2' }));
    // and the audit records what actually HAPPENED, not that it was put off
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_cross_tenant_transfer_decided', 'u1',
      expect.objectContaining({ decision: 'approve', execution: expect.objectContaining({ executed: true, membershipStatus: 'pending_tech_approval' }) }));
  });

  it('a REJECTED transfer executes nothing', async () => {
    const { repo } = harness();
    const execute = vi.fn();
    const withExecutor = new SuperAdminStaffService(repo as any, { execute });
    await withExecutor.decideCrossTenantTransfer(ctx, 'req-1', { decision: 'reject', note: 'a sufficiently long rejection note' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('with no executor wired (no database), approval says so instead of claiming success', async () => {
    const { svc, repo } = harness();
    const r: any = await svc.decideCrossTenantTransfer(ctx, 'req-1', { decision: 'approve' });
    expect(r.execution).toMatchObject({ executed: false, reason: 'executor_not_configured' });
    expect(repo.recordWorkforceAudit).toHaveBeenCalledWith(ctx, 'workforce_cross_tenant_transfer_decided', 'u1',
      expect.objectContaining({ execution: expect.objectContaining({ executed: false }) }));
  });

  it('refuses to decide an already-resolved request', async () => {
    const { svc, repo } = harness({ req: { id: 'req-1', userId: 'u1', toTenantId: 't2', status: 'approved' } });
    await expect(svc.decideCrossTenantTransfer(ctx, 'req-1', { decision: 'reject', note: 'a sufficiently long rejection note' })).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.decideCrossTransfer).not.toHaveBeenCalled();
  });

  it('lists pending cross-tenant requests from the repo', async () => {
    const { svc } = harness();
    const rows = await svc.getCrossTenantTransfers(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'req-1', toTenant: 'B' });
  });
});
