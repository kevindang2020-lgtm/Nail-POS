import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryOnboardingRepo } from './onboarding.repository';
import { OnboardingService, OnboardingError } from './onboarding.service';

const ctx = { userId: 'admin-1', role: 'SUPER_ADMIN', actorName: 'Super Admin', ip: '127.0.0.1', tenantId: null };

async function seedAt(repo: InMemoryOnboardingRepo, stage: string, patch: Record<string, unknown> = {}) {
  const id = await repo.insertRecord({ applicationId: 'app-' + Math.random().toString(36).slice(2) });
  await repo.updateRecord(id, { currentStage: stage as never, ...patch });
  return id;
}

describe('OnboardingService.overview', () => {
  it('returns an honest empty overview on an empty repo (no fabricated data)', async () => {
    const svc = new OnboardingService(new InMemoryOnboardingRepo(), null);
    const o = await svc.overview(ctx, {});
    expect(o.kpis.applicationsReceived).toBe(0);
    expect(o.pendingApprovals.total).toBe(0);
    expect(o.stageDistribution.total).toBe(0);
    expect(o.workflow).toHaveLength(14);
    expect(o.applications.rows).toEqual([]);
    expect(o.permissions.activate).toBe(true);
  });

  it('reconciles KPIs, distribution, health, donuts, and pending approvals from real rows', async () => {
    const repo = new InMemoryOnboardingRepo();
    await seedAt(repo, 'identity_verification', { identity: 'expired', missingDocsCount: 2, merchant: 'under_review' });
    await seedAt(repo, 'final_review', { merchant: 'approved', bank: 'verified', hardware: 'delivered', dataImport: 'completed', training: 'completed', usersInvited: true });
    const activated = await seedAt(repo, 'tenant_activated', { merchant: 'approved' });
    await repo.updateRecord(activated, { activationType: 'new' });
    await repo.addApproval({ onboardingId: activated, approvalType: 'final_review' });

    const svc = new OnboardingService(repo, null);
    const o = await svc.overview(ctx, {});
    expect(o.kpis.applicationsReceived).toBe(3);
    expect(o.kpis.tenantsActivated).toBe(1);
    expect(o.kpis.finalReviewsPending).toBe(1);
    expect(o.pendingApprovals.total).toBe(1);
    expect(o.pendingApprovals.byType.final_review).toBe(1);
    // health reconciles to the underlying rows
    const missing = o.onboardingHealth.find((h) => h.key === 'missingDocuments');
    expect(missing?.count).toBe(2);
    const expiredId = o.onboardingHealth.find((h) => h.key === 'expiredIdentityVerification');
    expect(expiredId?.count).toBe(1);
    // donut totals equal the application count
    expect(o.merchantStatus.total).toBe(3);
    expect(o.activationSummary.total).toBe(1);
    expect(o.activationSummary.newTenants).toBe(1);
  });
});

describe('OnboardingService commands & safeguards', () => {
  let repo: InMemoryOnboardingRepo;
  let svc: OnboardingService;
  beforeEach(() => { repo = new InMemoryOnboardingRepo(); svc = new OnboardingService(repo, null); });

  it('advances a stage and recomputes completion + writes history', async () => {
    const id = await seedAt(repo, 'application_received');
    const rec = await svc.transitionStage(ctx, id, 'business_info_submitted');
    expect(rec?.currentStage).toBe('business_info_submitted');
    expect(rec?.completionPct).toBe(Math.round((1 / 14) * 100));
    const hist = await svc.listHistory(id);
    expect(hist.some((h) => h.toState === 'business_info_submitted')).toBe(true);
  });

  it('rejects an invalid (backward) transition', async () => {
    const id = await seedAt(repo, 'hardware_assigned');
    await expect(svc.transitionStage(ctx, id, 'identity_verification')).rejects.toBeInstanceOf(OnboardingError);
  });

  it('requires a reason to reject a step', async () => {
    const id = await seedAt(repo, 'identity_verification');
    await expect(svc.transitionStage(ctx, id, 'rejected', {})).rejects.toMatchObject({ code: 'bad_request' });
    const rec = await svc.transitionStage(ctx, id, 'rejected', { reason: 'fraud signals' });
    expect(rec?.currentStage).toBe('rejected');
  });

  it('return-for-correction requires reason + corrections and records an applicant-visible note', async () => {
    const id = await seedAt(repo, 'legal_documents_submitted');
    await expect(svc.returnForCorrection(ctx, id, '', '')).rejects.toBeInstanceOf(OnboardingError);
    await svc.returnForCorrection(ctx, id, 'license invalid', 'Re-upload a current business license');
    const rec = await svc.getRecord(id);
    expect(rec?.currentStage).toBe('returned_for_correction');
    const notes = await svc.listNotes(ctx, id);
    expect(notes.some((n) => n.noteType === 'return_for_correction' && n.visibility === 'applicant_visible')).toBe(true);
  });

  it('blocks activation when prerequisites are unmet, then allows it once satisfied (idempotent thereafter)', async () => {
    const id = await seedAt(repo, 'final_review', { identity: 'pending', missingDocsCount: 1 });
    await expect(svc.activateTenant(ctx, id)).rejects.toMatchObject({ code: 'bad_request' });

    await repo.updateRecord(id, { identity: 'verified', merchant: 'approved', bank: 'verified', dataImport: 'completed', training: 'completed', usersInvited: true, missingDocsCount: 0 });
    const rec = await svc.activateTenant(ctx, id, { note: 'all checks pass', activationType: 'new' });
    expect(rec?.currentStage).toBe('tenant_activated');
    expect(rec?.completionPct).toBe(100);

    // second activation is refused (idempotency / no double-activation)
    await expect(svc.activateTenant(ctx, id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('decideApproval requires an approver and a reason to reject', async () => {
    const id = await seedAt(repo, 'merchant_application_submitted');
    const { id: approvalId } = await svc.addApproval(ctx, id, 'merchant_application');
    await expect(svc.decideApproval({ ...ctx, userId: null }, approvalId, { status: 'approved' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.decideApproval(ctx, approvalId, { status: 'rejected' })).rejects.toMatchObject({ code: 'bad_request' });
    const ok = await svc.decideApproval(ctx, approvalId, { status: 'approved' });
    expect(ok.ok).toBe(true);
  });

  it('createApplication is idempotent per application_id', async () => {
    const rec = await svc.createApplication(ctx, { applicationId: 'app-xyz' });
    expect(rec?.currentStage).toBe('application_received');
    await expect(svc.createApplication(ctx, { applicationId: 'app-xyz' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('export generates real CSV but honestly reports XLSX/PDF as not configured (platform convention)', async () => {
    await svc.createApplication(ctx, { applicationId: 'app-exp' });
    const csv = await svc.export(ctx, {}, 'csv');
    expect(csv.format).toBe('csv');
    expect(csv.csv?.split('\r\n')[0]).toMatch(/^Tenant,Owner Email/);
    expect(csv.disabledReason).toBeUndefined();
    for (const fmt of ['excel', 'pdf'] as const) {
      const r = await svc.export(ctx, {}, fmt);
      expect(r.format).toBe(fmt);
      expect(r.csv).toBeUndefined();
      expect(r.disabledReason).toBe('Export is not configured yet.');
    }
  });

  it('enforces the two-person approval sequence end-to-end', async () => {
    const rec = await svc.createApplication(ctx, { applicationId: 'app-2p' });
    const id = rec!.id;
    const { id: approvalId } = await svc.addApproval(ctx, id, 'final_review', 'final_review', true);
    const u1 = { userId: 'user-1', role: 'SUPER_ADMIN' as const, tenantId: null };
    const u2 = { userId: 'user-2', role: 'SUPER_ADMIN' as const, tenantId: null };
    // first approval -> awaiting second, still pending
    const first = await svc.decideApproval(u1, approvalId, { status: 'approved' });
    expect(first).toMatchObject({ awaitingSecond: true, status: 'pending' });
    // same user cannot complete the second approval
    await expect(svc.decideApproval(u1, approvalId, { status: 'approved' })).rejects.toMatchObject({ code: 'conflict' });
    // a different user finalizes it
    const second = await svc.decideApproval(u2, approvalId, { status: 'approved' });
    expect(second).toMatchObject({ awaitingSecond: false, status: 'approved' });
    const fresh = await svc.listApprovals({ onboardingId: id } as never);
    expect(fresh[0]).toMatchObject({ status: 'approved', decidedByUserId: 'user-1', secondApproverUserId: 'user-2' });
    // re-deciding a finalized approval is refused
    await expect(svc.decideApproval(u2, approvalId, { status: 'approved' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reviews documents with guards (scan-clean to approve, reason to reject, no re-review)', async () => {
    const rec = await svc.createApplication(ctx, { applicationId: 'app-doc' });
    const reviewer = { userId: 'rev-1', role: 'SUPER_ADMIN' as const, tenantId: null };
    // seed two documents directly via the repo (metadata only; no file bytes)
    const cleanId = await repo.addDocument({ onboardingId: rec!.id, category: 'business_license', fileName: 'lic.pdf', virusScanStatus: 'clean' });
    const pendingScanId = await repo.addDocument({ onboardingId: rec!.id, category: 'tax_document', fileName: 'tax.pdf', virusScanStatus: 'pending' });
    // cannot approve a doc whose scan has not completed cleanly
    await expect(svc.reviewDocument(reviewer, pendingScanId, { status: 'approved' })).rejects.toMatchObject({ code: 'conflict' });
    // reject requires a reason (enforced by the evaluator → conflict)
    await expect(svc.reviewDocument(reviewer, cleanId, { status: 'rejected' })).rejects.toMatchObject({ code: 'conflict' });
    // approve a clean doc
    const ok = await svc.reviewDocument(reviewer, cleanId, { status: 'approved' });
    expect(ok).toMatchObject({ status: 'approved' });
    // cannot re-review a finalized doc
    await expect(svc.reviewDocument(reviewer, cleanId, { status: 'rejected', rejectionReason: 'too late' })).rejects.toMatchObject({ code: 'conflict' });
    const docs = await svc.listDocuments(rec!.id);
    expect(docs.find((d) => d.id === cleanId)).toMatchObject({ status: 'approved', reviewerUserId: 'rev-1' });
  });

});
