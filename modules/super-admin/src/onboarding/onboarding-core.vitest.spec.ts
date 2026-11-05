import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STAGES, STAGE_LABELS, SKIPPABLE_STAGES, nextStage, stageIndex, isTerminal,
  evaluateTransition, completionPct, defaultCompletedStages, rollupKpis, stageDistribution, reconciles,
  alertSeverity, isInProgress, completionTrend, csvCell, onboardingRowsToCsv,
  evaluateApprovalDecision, isAwaitingSecond, evaluateDocumentReview, stageAgeHours, slaBand, attachSla, type OnboardingAppSummary, type OnboardingState,
} from './onboarding-core';

const app = (over: Partial<OnboardingAppSummary>): OnboardingAppSummary => ({
  id: Math.random().toString(36).slice(2),
  state: 'application_received',
  identity: 'not_started', merchant: 'not_submitted', bank: 'not_started',
  hardware: 'not_ordered', dataImport: 'not_started', training: 'not_started', usersInvited: false,
  ...over,
});

describe('onboarding stage model', () => {
  it('has exactly 14 ordered canonical stages with labels', () => {
    expect(ONBOARDING_STAGES.length).toBe(14);
    expect(ONBOARDING_STAGES[0]).toBe('application_received');
    expect(ONBOARDING_STAGES[13]).toBe('tenant_activated');
    for (const s of ONBOARDING_STAGES) expect(STAGE_LABELS[s]).toBeTruthy();
  });
  it('nextStage walks the chain and stops at activation', () => {
    expect(nextStage('application_received')).toBe('business_info_submitted');
    expect(nextStage('final_review')).toBe('tenant_activated');
    expect(nextStage('tenant_activated')).toBeNull();
  });
  it('only tenant_activated / rejected / cancelled / expired are terminal', () => {
    expect(isTerminal('tenant_activated')).toBe(true);
    expect(isTerminal('rejected')).toBe(false);   // developer (Sep 2026): a rejected application can be REOPENED — from the first stage, with a reason (pinned below)
    expect(isTerminal('final_review')).toBe(false);
    expect(isTerminal('paused')).toBe(false);
  });
});

describe('transition rules', () => {
  it('allows the immediate forward step with no reason', () => {
    const r = evaluateTransition('application_received', 'business_info_submitted');
    expect(r.ok).toBe(true);
    expect(r.skips).toEqual([]);
    expect(r.requiresReason).toBe(false);
  });
  it('refuses to move backward', () => {
    const r = evaluateTransition('hardware_assigned', 'identity_verification');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not_forward');
  });
  it('blocks skipping an unskippable stage even with a skip rule', () => {
    // legal_documents_submitted is between identity_verification and subscription_selected and is NOT skippable
    const r = evaluateTransition('identity_verification', 'subscription_selected', { allowSkip: true, hasReason: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('unskippable_stage');
  });
  it('requires an approved skip rule + reason to bypass skippable stages', () => {
    // merchant_application_submitted .. data_imported are all skippable
    const noRule = evaluateTransition('subscription_selected', 'users_invited', {});
    expect(noRule.ok).toBe(false);
    expect(noRule.code).toBe('requires_skip_rule');

    const noReason = evaluateTransition('subscription_selected', 'users_invited', { allowSkip: true });
    expect(noReason.ok).toBe(false);
    expect(noReason.code).toBe('requires_reason');

    const ok = evaluateTransition('subscription_selected', 'users_invited', { allowSkip: true, hasReason: true });
    expect(ok.ok).toBe(true);
    expect(ok.skips.every((s) => SKIPPABLE_STAGES.has(s))).toBe(true);
    expect(ok.requiresReason).toBe(true);
  });
  it('rejection / return / cancel require a reason; pause does not', () => {
    expect(evaluateTransition('identity_verification', 'rejected', {}).code).toBe('requires_reason');
    expect(evaluateTransition('identity_verification', 'rejected', { hasReason: true }).ok).toBe(true);
    expect(evaluateTransition('identity_verification', 'returned_for_correction', { hasReason: true }).ok).toBe(true);
    expect(evaluateTransition('identity_verification', 'paused', {}).ok).toBe(true);
  });
  it('cannot advance out of a terminal state', () => {
    const r = evaluateTransition('tenant_activated', 'final_review');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('terminal');
  });
  it('resumes a returned/paused application back to its target stage with reason', () => {
    const ok = evaluateTransition('returned_for_correction', 'identity_verification', { hasReason: true }, 'identity_verification');
    expect(ok.ok).toBe(true);
    const mismatch = evaluateTransition('returned_for_correction', 'identity_verification', {}, 'legal_documents_submitted');
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe('invalid_target');
  });
});

describe('completion math', () => {
  it('is checklist-based out of 14 stages', () => {
    expect(completionPct([])).toBe(0);
    expect(completionPct([...ONBOARDING_STAGES])).toBe(100);
    expect(completionPct(ONBOARDING_STAGES.slice(0, 7))).toBe(Math.round((7 / 14) * 100));
  });
  it('defaultCompletedStages reflects forward progress', () => {
    expect(defaultCompletedStages('application_received')).toEqual([]);
    expect(defaultCompletedStages('identity_verification')).toEqual(['application_received', 'business_info_submitted']);
    expect(defaultCompletedStages('tenant_activated').length).toBe(14);
    expect(completionPct(defaultCompletedStages('tenant_activated'))).toBe(100);
  });
});

describe('KPI rollup', () => {
  const apps: OnboardingAppSummary[] = [
    app({ state: 'identity_verification', identity: 'pending' }),
    app({ state: 'merchant_account_approved', merchant: 'approved', bank: 'verified', identity: 'verified' }),
    app({ state: 'hardware_assigned', hardware: 'delivered', merchant: 'approved', bank: 'verified' }),
    app({ state: 'data_imported', dataImport: 'completed', merchant: 'approved' }),
    app({ state: 'training_completed', training: 'completed', usersInvited: true }),
    app({ state: 'final_review' }),
    app({ state: 'tenant_activated', training: 'completed', usersInvited: true, merchant: 'approved', bank: 'verified' }),
    app({ state: 'rejected', merchant: 'declined' }),
  ];
  it('counts each KPI from real summaries', () => {
    const k = rollupKpis(apps, 82);
    expect(k.applicationsReceived).toBe(8);
    expect(k.pendingApprovals).toBe(82);
    expect(k.tenantsActivated).toBe(1);
    expect(k.inProgress).toBe(6); // 7 in active stages minus the 1 activated; rejected excluded
    expect(k.identityVerificationPending).toBe(1);
    expect(k.merchantApproved).toBe(4);
    expect(k.bankVerified).toBe(3);
    expect(k.hardwareAssigned).toBe(1);
    expect(k.dataImportsCompleted).toBe(1);
    expect(k.usersInvited).toBe(2);
    expect(k.trainingCompleted).toBe(2);
    expect(k.finalReviewsPending).toBe(1);
  });
  it('isInProgress excludes activation and outcome states', () => {
    expect(isInProgress('final_review')).toBe(true);
    expect(isInProgress('tenant_activated')).toBe(false);
    expect(isInProgress('rejected' as OnboardingState)).toBe(false);
  });
});

describe('stage distribution reconciliation', () => {
  it('sums exactly to the active-pipeline total (terminal failures excluded)', () => {
    const apps: OnboardingAppSummary[] = [
      app({ state: 'application_received' }),
      app({ state: 'application_received' }),
      app({ state: 'final_review' }),
      app({ state: 'tenant_activated' }),
      app({ state: 'rejected' }),
      app({ state: 'cancelled' }),
    ];
    const { buckets, total } = stageDistribution(apps);
    expect(total).toBe(4); // 2 received + 1 final + 1 activated; rejected + cancelled excluded
    expect(reconciles(buckets, total)).toBe(true);
    expect(buckets.find((b) => b.stage === 'application_received')?.count).toBe(2);
  });
});

describe('alert severity', () => {
  it('treats bank + import failures as critical, doc backlogs as informational', () => {
    expect(alertSeverity('bank_verification_failures', 5)).toBe('critical');
    expect(alertSeverity('data_import_issues', 4)).toBe('critical');
    expect(alertSeverity('training_overdue', 11)).toBe('critical');
    expect(alertSeverity('training_overdue', 3)).toBe('warning');
    expect(alertSeverity('missing_documents', 29)).toBe('warning');
    expect(alertSeverity('missing_documents', 0)).toBe('ok');
    expect(stageIndex('tenant_activated')).toBe(13);
  });
});

describe('completion trend', () => {
  it('gap-fills every day in the window and counts applications vs completions (activations)', () => {
    const now = new Date('2026-05-06T12:00:00.000Z');
    const rows = [
      { createdAt: '2026-05-06T09:00:00.000Z', activatedAt: '2026-05-06T11:00:00.000Z' }, // app + completion today
      { createdAt: '2026-05-05T09:00:00.000Z', activatedAt: null },                          // app yesterday
      { createdAt: '2026-05-01T09:00:00.000Z', activatedAt: '2026-05-04T09:00:00.000Z' },    // app May 1, completion May 4
    ];
    const trend = completionTrend(rows, 7, now);
    expect(trend).toHaveLength(7);
    expect(trend[trend.length - 1]).toEqual({ date: '2026-05-06', applications: 1, completions: 1 });
    expect(trend.find((t) => t.date === '2026-05-05')).toEqual({ date: '2026-05-05', applications: 1, completions: 0 });
    expect(trend.find((t) => t.date === '2026-05-04')).toEqual({ date: '2026-05-04', applications: 0, completions: 1 });
    expect(trend.find((t) => t.date === '2026-05-01')).toEqual({ date: '2026-05-01', applications: 1, completions: 0 });
  });
});

describe('two-person approval evaluator', () => {
  const base = { status: 'pending' as const, decidedByUserId: null, secondApproverUserId: null, requiresSecondApproval: false };
  it('finalizes a single-approver approval immediately', () => {
    expect(evaluateApprovalDecision(base, 'u1', 'approved')).toEqual({ kind: 'finalize', status: 'approved' });
  });
  it('rejections finalize immediately at any stage and require nothing special here', () => {
    expect(evaluateApprovalDecision(base, 'u1', 'rejected')).toEqual({ kind: 'finalize', status: 'rejected' });
    expect(evaluateApprovalDecision({ ...base, requiresSecondApproval: true, decidedByUserId: 'u1' }, 'u2', 'returned')).toEqual({ kind: 'finalize', status: 'returned' });
  });
  it('first approval of a two-person rule awaits a second approver', () => {
    expect(evaluateApprovalDecision({ ...base, requiresSecondApproval: true }, 'u1', 'approved')).toEqual({ kind: 'await_second' });
  });
  it('blocks the same user from providing the second approval (differ-from-first rule)', () => {
    const awaiting = { ...base, requiresSecondApproval: true, decidedByUserId: 'u1' };
    const r = evaluateApprovalDecision(awaiting, 'u1', 'approved');
    expect(r.kind).toBe('error');
    expect(isAwaitingSecond(awaiting)).toBe(true);
  });
  it('lets a different user complete the second approval', () => {
    expect(evaluateApprovalDecision({ ...base, requiresSecondApproval: true, decidedByUserId: 'u1' }, 'u2', 'approved')).toEqual({ kind: 'second_approve' });
  });
  it('refuses to re-decide an already-decided approval', () => {
    expect(evaluateApprovalDecision({ ...base, status: 'approved' }, 'u1', 'approved').kind).toBe('error');
    expect(evaluateApprovalDecision({ ...base, status: 'rejected' }, 'u1', 'approved').kind).toBe('error');
  });
});

describe('csv export', () => {
  it('neutralizes spreadsheet formula injection and escapes correctly', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('Glamour, Inc')).toBe('"Glamour, Inc"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell('normal')).toBe('normal');
  });
  it('serializes rows with a header and no sensitive columns', () => {
    const csv = onboardingRowsToCsv([{
      id: 'o1', applicationId: 'a1', applicationType: 'new_tenant', parentTenantId: null, tenantId: null,
      salonName: '=Evil', ownerName: 'Jane', ownerEmail: 'j@x.com', branchCount: 3, currentStage: 'identity_verification',
      completionPct: 38, stageEnteredAt: '2026-05-04T00:00:00Z', stageAgeHours: 48, slaBand: 'ok',
      specialistUserId: null, specialistName: null, identity: 'pending', merchant: 'under_review',
      bank: 'not_started', hardware: 'pending', dataImport: 'not_started', training: 'not_started', usersInvited: false,
      missingDocsCount: 2, priority: 'normal', targetActivationDate: null, activatedAt: null, activationType: null,
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-06T00:00:00Z',
    }]);
    const [header, row] = csv.split('\r\n');
    expect(header.startsWith('Tenant,Owner Email,Application Type')).toBe(true);
    // status columns (Bank/Merchant) carry workflow states, never account numbers/secrets — assert the truly sensitive fields are absent
    expect(header).not.toMatch(/account number|routing|ssn|tax id|storage|token|secret|cardholder|processor key/i);
    expect(row).toContain("'=Evil"); // injection-guarded
    expect(row).toContain('Unassigned');
  });
});

describe('document review evaluator', () => {
  const pendingClean = { status: 'pending' as const, virusScanStatus: 'clean' as const };
  it('approves a clean, pending document', () => {
    expect(evaluateDocumentReview(pendingClean, 'approved', null)).toEqual({ kind: 'apply', status: 'approved', rejectionReason: null });
  });
  it('refuses to approve an infected or unscanned document', () => {
    expect(evaluateDocumentReview({ status: 'pending', virusScanStatus: 'infected' }, 'approved', null).kind).toBe('error');
    expect(evaluateDocumentReview({ status: 'pending', virusScanStatus: 'pending' }, 'approved', null).kind).toBe('error');
    expect(evaluateDocumentReview({ status: 'pending', virusScanStatus: 'error' }, 'approved', null).kind).toBe('error');
  });
  it('requires a reason to reject', () => {
    expect(evaluateDocumentReview(pendingClean, 'rejected', '  ').kind).toBe('error');
    expect(evaluateDocumentReview(pendingClean, 'rejected', 'illegible')).toEqual({ kind: 'apply', status: 'rejected', rejectionReason: 'illegible' });
  });
  it('only reviews pending/under_review documents', () => {
    expect(evaluateDocumentReview({ status: 'approved', virusScanStatus: 'clean' }, 'rejected', 'x').kind).toBe('error');
    expect(evaluateDocumentReview({ status: 'rejected', virusScanStatus: 'clean' }, 'approved', null).kind).toBe('error');
    expect(evaluateDocumentReview({ status: 'under_review', virusScanStatus: 'clean' }, 'approved', null).kind).toBe('apply');
  });
});

describe('SLA / stage aging', () => {
  const now = new Date('2026-05-10T00:00:00.000Z');
  it('computes stage age in hours, never negative', () => {
    expect(stageAgeHours('2026-05-09T00:00:00.000Z', now)).toBeCloseTo(24, 5);
    expect(stageAgeHours('2026-05-20T00:00:00.000Z', now)).toBe(0); // future → clamped
  });
  it('bands a normal stage at 72h (aging) and 168h (breached)', () => {
    expect(slaBand('identity_verification', 1)).toBe('ok');
    expect(slaBand('identity_verification', 80)).toBe('aging');
    expect(slaBand('identity_verification', 200)).toBe('breached');
  });
  it('gives slow stages more runway via overrides', () => {
    // 200h would breach a normal stage, but merchant underwriting only ages by then
    expect(slaBand('merchant_application_submitted', 200)).toBe('aging');
    expect(slaBand('merchant_application_submitted', 400)).toBe('breached');
  });
  it('never breaches terminal/outcome states', () => {
    expect(slaBand('tenant_activated', 99999)).toBe('ok');
    expect(slaBand('rejected', 99999)).toBe('ok');
  });
  it('attachSla augments a row with rounded age + band', () => {
    const row = attachSla({ currentStage: 'identity_verification' as OnboardingState, stageEnteredAt: '2026-05-03T00:00:00.000Z' }, now);
    expect(row.stageAgeHours).toBe(168);
    expect(row.slaBand).toBe('breached');
  });
});

describe('Sep 2026 merge — reopening a rejected application (developer feature) cannot skip stages', () => {
  it('rejected -> only the first stage, and a reason is required', () => {
    const first = ONBOARDING_STAGES[0];
    const ok = evaluateTransition('rejected', first);
    expect(ok.ok).toBe(true); expect(ok.requiresReason).toBe(true);
    const jump = evaluateTransition('rejected', ONBOARDING_STAGES[ONBOARDING_STAGES.length - 1]);
    expect(jump.ok).toBe(false); expect(jump.code).toBe('invalid_target');
  });
});
