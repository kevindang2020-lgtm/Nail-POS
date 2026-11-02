import { describe, it, expect } from 'vitest';
import { InMemoryOnboardingRepo, overviewRollup } from './onboarding.repository';
import { filterRecords, sortRecords, paginate, type OnboardingRecordRow } from './onboarding-core';

const row = (over: Partial<OnboardingRecordRow>): OnboardingRecordRow => ({
  id: Math.random().toString(36).slice(2), applicationId: 'app-' + Math.random().toString(36).slice(2),
  applicationType: 'new_tenant', parentTenantId: null, tenantId: null,
  salonName: 'Salon', ownerName: 'Owner', ownerEmail: 'o@x.com', branchCount: 1,
  currentStage: 'application_received', resumeStage: null, completionPct: 10, specialistUserId: null, specialistName: null,
  identity: 'not_started', merchant: 'not_submitted', bank: 'not_started', hardware: 'not_ordered',
  dataImport: 'not_started', training: 'not_started', usersInvited: false, missingDocsCount: 0, priority: 'normal',
  targetActivationDate: null, activatedAt: null, activationType: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

describe('list helpers', () => {
  const rows = [
    row({ salonName: 'Glamour Studio', currentStage: 'identity_verification', completionPct: 38, missingDocsCount: 2, merchant: 'under_review', specialistUserId: 's1' }),
    row({ salonName: 'Luxe Salon', currentStage: 'merchant_account_approved', completionPct: 67, merchant: 'approved', hardware: 'shipped', specialistUserId: 's2' }),
    row({ salonName: 'Pure Beauty', currentStage: 'application_received', completionPct: 10, missingDocsCount: 5, merchant: 'not_submitted' }),
  ];
  it('filters by search, stage, merchant status, and missing docs', () => {
    expect(filterRecords(rows, { search: 'luxe' }).map((r) => r.salonName)).toEqual(['Luxe Salon']);
    expect(filterRecords(rows, { stage: 'application_received' })).toHaveLength(1);
    expect(filterRecords(rows, { merchantStatus: 'approved' })).toHaveLength(1);
    expect(filterRecords(rows, { hasMissingDocuments: true })).toHaveLength(2);
    expect(filterRecords(rows, { hasMissingDocuments: false })).toHaveLength(1);
    expect(filterRecords(rows, { specialistId: 's1' })).toHaveLength(1);
  });
  it('sorts by completion ascending/descending', () => {
    expect(sortRecords(rows, 'completion', 'asc').map((r) => r.completionPct)).toEqual([10, 38, 67]);
    expect(sortRecords(rows, 'completion', 'desc').map((r) => r.completionPct)).toEqual([67, 38, 10]);
  });
  it('sorts by stage ordinal', () => {
    const ordered = sortRecords(rows, 'stage', 'asc').map((r) => r.currentStage);
    expect(ordered[0]).toBe('application_received');
    expect(ordered[2]).toBe('merchant_account_approved');
  });
  it('paginates with clamped page/size and reports totals', () => {
    const big = Array.from({ length: 25 }, (_, i) => row({ salonName: `S${i}` }));
    const p1 = paginate(big, 1, 10);
    expect(p1.rows).toHaveLength(10); expect(p1.total).toBe(25); expect(p1.totalPages).toBe(3);
    const p3 = paginate(big, 99, 10); // over-page clamps to last
    expect(p3.page).toBe(3); expect(p3.rows).toHaveLength(5);
  });
});

describe('InMemoryOnboardingRepo', () => {
  it('inserts an onboarding record starting at application_received with empty status', async () => {
    const repo = new InMemoryOnboardingRepo();
    const id = await repo.insertRecord({ applicationId: 'app-1', applicationType: 'new_tenant' });
    const rec = await repo.getRecord(id);
    expect(rec?.currentStage).toBe('application_received');
    expect(rec?.merchant).toBe('not_submitted');
    expect(rec?.completionPct).toBe(0);
  });
  it('updates record status fields and keeps specialist name in sync', async () => {
    const repo = new InMemoryOnboardingRepo();
    repo.specialistNames.set('u1', 'Sarah Johnson');
    const id = await repo.insertRecord({ applicationId: 'app-2' });
    await repo.updateRecord(id, { currentStage: 'identity_verification', identity: 'pending', completionPct: 14, specialistUserId: 'u1' });
    const rec = await repo.getRecord(id);
    expect(rec?.currentStage).toBe('identity_verification');
    expect(rec?.identity).toBe('pending');
    expect(rec?.specialistName).toBe('Sarah Johnson');
  });
  it('approval queue: add → counts by type → decide removes from pending', async () => {
    const repo = new InMemoryOnboardingRepo();
    const id = await repo.insertRecord({ applicationId: 'app-3' });
    const a1 = await repo.addApproval({ onboardingId: id, approvalType: 'merchant_application' });
    await repo.addApproval({ onboardingId: id, approvalType: 'final_review' });
    let counts = await repo.approvalCountsByType();
    expect(counts.merchant_application).toBe(1);
    expect(counts.final_review).toBe(1);
    await repo.decideApproval(a1, { status: 'approved', decidedByUserId: 'admin-1', reason: 'docs ok' });
    counts = await repo.approvalCountsByType();
    expect(counts.merchant_application).toBe(0); // decided → no longer pending
    const decided = (await repo.listApprovals({ onboardingId: id })).find((a) => a.id === a1);
    expect(decided?.status).toBe('approved');
    expect(decided?.previousStatus).toBe('pending');
  });
  it('notes are filtered by reader visibility (internal/risk hidden from applicant readers)', async () => {
    const repo = new InMemoryOnboardingRepo();
    const id = await repo.insertRecord({ applicationId: 'app-4' });
    await repo.addNote({ onboardingId: id, authorUserId: 'u1', authorName: 'Sarah J.', noteType: 'risk', body: 'internal risk flag', stage: null, visibility: 'internal', attachmentDocumentId: null, followUpDate: null });
    await repo.addNote({ onboardingId: id, authorUserId: 'u1', authorName: 'Sarah J.', noteType: 'request_info', body: 'please re-upload license', stage: null, visibility: 'applicant_visible', attachmentDocumentId: null, followUpDate: null });
    const applicantView = await repo.listNotes(id, ['applicant_visible']);
    expect(applicantView).toHaveLength(1);
    expect(applicantView[0].visibility).toBe('applicant_visible');
    const adminView = await repo.listNotes(id, ['internal', 'applicant_visible', 'security_compliance', 'merchant_team']);
    expect(adminView).toHaveLength(2);
  });
  it('overviewRollup reconciles KPIs + distribution from repo summaries', async () => {
    const repo = new InMemoryOnboardingRepo();
    const a = await repo.insertRecord({ applicationId: 'app-5' });
    const b = await repo.insertRecord({ applicationId: 'app-6' });
    await repo.updateRecord(a, { currentStage: 'tenant_activated' });
    await repo.updateRecord(b, { currentStage: 'final_review' });
    await repo.addApproval({ onboardingId: b, approvalType: 'final_review' });
    const { kpis, distribution } = await overviewRollup(repo);
    expect(kpis.applicationsReceived).toBe(2);
    expect(kpis.tenantsActivated).toBe(1);
    expect(kpis.finalReviewsPending).toBe(1);
    expect(kpis.pendingApprovals).toBe(1);
    expect(distribution.total).toBe(2);
    expect(distribution.buckets.reduce((s, x) => s + x.count, 0)).toBe(2);
  });
  it('specialist workload aggregates active vs completed', async () => {
    const repo = new InMemoryOnboardingRepo();
    repo.specialistNames.set('u1', 'Sarah Johnson');
    const a = await repo.insertRecord({ applicationId: 'app-7', specialistUserId: 'u1' });
    const b = await repo.insertRecord({ applicationId: 'app-8', specialistUserId: 'u1' });
    await repo.updateRecord(b, { currentStage: 'tenant_activated' });
    void a;
    const wl = await repo.specialistWorkload();
    expect(wl).toHaveLength(1);
    expect(wl[0]).toMatchObject({ specialistName: 'Sarah Johnson', active: 1, completed: 1 });
  });
});
