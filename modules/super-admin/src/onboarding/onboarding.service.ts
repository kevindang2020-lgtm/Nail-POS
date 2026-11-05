// onboarding.service.ts — orchestrates the Super-Admin "Onboarding & Approvals" surface over the repo + pure core.
// Builds the one-shot `overview` payload (all modules reconciling from real rows) and performs the safeguarded
// commands: stage transitions (validated by the core's state machine, with reason/skip gating), specialist assignment,
// notes (visibility-scoped), approval decisions, and tenant activation (validates every mandatory prerequisite, is
// idempotent, and refuses to bypass the state machine). Every mutating command appends to the onboarding ledger
// (stage_history / approvals) — the subsystem's append-only audit trail — and best-effort mirrors to the central
// AuditService when a tenant context exists. Super-admin-only: the controller's SuperAdminGuard is the authorization.
import { AutomationEngineService } from '@aipowersalon/platform';
import type { AppDatabase } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';
import type {
  OnboardingRepo, NewOnboardingRecord, ApprovalType, ApprovalStatus, NoteRow,
} from './onboarding.repository';
import {
  evaluateTransition, defaultCompletedStages, completionPct, rollupKpis, stageDistribution, healthMetrics,
  merchantDonut, hardwareDonut, dataImportDonut, trainingDonut, workflowCounts, alertSeverity,
  isStage, isOutcome, STAGE_LABELS, onboardingRowsToCsv, evaluateApprovalDecision, evaluateDocumentReview,
  type OnboardingState, type OnboardingStage, type DocumentStatus,
} from './onboarding-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { OnboardingExportFormat, OnboardingExportResult } from '@aipowersalon/api-contracts/platform';
import type { OnboardingExportFormat, OnboardingExportResult } from '@aipowersalon/api-contracts/platform';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { OnboardingQuery } from '@aipowersalon/api-contracts/platform';
import type { OnboardingQuery } from '@aipowersalon/api-contracts/platform';

export class OnboardingError extends Error {
  constructor(public code: 'not_found' | 'bad_request' | 'forbidden' | 'conflict', message: string) { super(message); }
}

export interface AdminCtx { userId?: string | null; role?: string | null; actorName?: string | null; ip?: string | null; tenantId?: string | null }


// Which onboarding sub-status each mandatory prerequisite checks before activation is permitted.
const ACTIVATION_PREREQS: { key: string; ok: (r: { identity: string; merchant: string; bank: string; dataImport: string; training: string; usersInvited: boolean; missingDocsCount: number; currentStage: OnboardingState }) => boolean; label: string }[] = [
  { key: 'identity', label: 'Identity verification approved', ok: (r) => r.identity === 'verified' || r.identity === 'manually_reviewed' },
  { key: 'documents', label: 'No outstanding required documents', ok: (r) => r.missingDocsCount === 0 },
  { key: 'merchant', label: 'Merchant account approved (or not required)', ok: (r) => r.merchant === 'approved' || r.merchant === 'not_submitted' },
  { key: 'bank', label: 'Bank account verified (or not required)', ok: (r) => r.bank === 'verified' || r.bank === 'not_started' },
  { key: 'data_import', label: 'Data import completed (or not required)', ok: (r) => ['completed', 'completed_with_warnings', 'not_started'].includes(r.dataImport) },
  { key: 'training', label: 'Training completed or waived', ok: (r) => r.training === 'completed' || r.training === 'waived' },
  { key: 'users', label: 'Required users invited', ok: (r) => r.usersInvited },
  { key: 'final_review', label: 'At final review', ok: (r) => r.currentStage === 'final_review' },
];


export class OnboardingService {
  constructor(private readonly repo: OnboardingRepo, private readonly audit: AuditService | null = null, private readonly db: AppDatabase = null) {}

  /** Visibility levels a super-admin reader may see (everything). Applicant-only readers would get a narrower set. */
  private readonly adminVisibility = ['internal', 'applicant_visible', 'merchant_team', 'security_compliance'];

  // ---------------------------------------------------------------------------------------------------------------
  // One-shot overview — every module reconciles from the same real summaries.
  // ---------------------------------------------------------------------------------------------------------------
  async overview(_ctx: AdminCtx, q: OnboardingQuery = {}) {
    const [page, summaries, approvalCounts, workload, missingDocs, activation, recentHist, recentNotes, trend] = await Promise.all([
      this.repo.listRecords({
        search: q.search, applicationType: q.applicationType, stage: q.stage, specialistId: q.specialistId,
        merchantStatus: q.merchantStatus as never, hardwareStatus: q.hardwareStatus as never, importStatus: q.importStatus as never,
        trainingStatus: q.trainingStatus as never, hasMissingDocuments: q.hasMissingDocuments,
        sort: (q.sort as never) ?? 'updated', direction: q.direction ?? 'desc', page: q.page ?? 1, pageSize: q.pageSize ?? 10,
      }),
      this.repo.summaries(),
      this.repo.approvalCountsByType(),
      this.repo.specialistWorkload(),
      this.repo.missingDocsTotal(),
      this.repo.activationSummary(),
      this.repo.recentHistory(8),
      this.repo.recentNotes(5, this.adminVisibility),
      this.repo.completionTrend(7),
    ]);

    const totalPending = (Object.values(approvalCounts) as number[]).reduce((s, n) => s + n, 0);
    const kpis = rollupKpis(summaries, totalPending);
    const health = healthMetrics(summaries, missingDocs);
    const onboardingHealth = (Object.entries(health) as [string, number][]).map(([key, count]) => ({
      key, label: STAGE_LABELS[key as OnboardingState] ?? humanize(key), count, severity: alertSeverity(toSnake(key), count),
    }));

    return {
      generatedAt: new Date().toISOString(),
      kpis,
      applications: page,
      onboardingHealth,
      pendingApprovals: { byType: approvalCounts, total: totalPending },
      workflow: workflowCounts(summaries),
      completionTrend: trend,
      stageDistribution: stageDistribution(summaries),
      merchantStatus: merchantDonut(summaries),
      shipmentStatus: hardwareDonut(summaries),
      dataImportStatus: dataImportDonut(summaries),
      trainingProgress: trainingDonut(summaries),
      specialistWorkload: workload,
      recentActivity: recentHist.map((h) => ({ id: h.id, onboardingId: h.onboardingId, from: h.fromState, to: h.toState, reason: h.reason, at: h.createdAt })),
      approvalNotes: recentNotes,
      activationSummary: activation,
      rejectedExpired: this.rejectedExpired(summaries),
      permissions: this.permissions(),
    };
  }

  private rejectedExpired(summaries: { state: OnboardingState; identity: string }[]) {
    const c = (pred: (s: { state: OnboardingState; identity: string }) => boolean) => summaries.reduce((n, s) => n + (pred(s) ? 1 : 0), 0);
    return {
      rejectedApplications: c((s) => s.state === 'rejected'),
      expiredIdentityVerifications: c((s) => s.identity === 'expired'),
      cancelledOnboarding: c((s) => s.state === 'cancelled'),
      expiredApplications: c((s) => s.state === 'expired'),
    };
  }

  /** Super-admins (past the guard) may perform every onboarding action. Surfaced for the frontend to gate buttons. */
  private permissions() {
    return {
      view: true, create: true, assignSpecialist: true, review: true, identityOverride: true, dataImportApprove: true,
      approve: true, reject: true, returnForCorrection: true, activate: true, export: true, notesView: true, notesCreate: true, auditView: true,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Commands (each appends to the ledger + best-effort central audit).
  // ---------------------------------------------------------------------------------------------------------------

  async createApplication(ctx: AdminCtx, input: NewOnboardingRecord) {
    if (!input.applicationId) throw new OnboardingError('bad_request', 'applicationId is required');
    const existing = await this.repo.getByApplicationId(input.applicationId);
    if (existing) throw new OnboardingError('conflict', 'Onboarding already started for this application');
    const id = await this.repo.insertRecord(input);
    await this.repo.addHistory({ onboardingId: id, fromState: null, toState: 'application_received', actorUserId: ctx.userId ?? null, actorRole: ctx.role ?? null });
    await this.writeAudit(ctx, 'onboarding.create', id, 'Onboarding application created');
    return this.repo.getRecord(id);
  }

  async transitionStage(ctx: AdminCtx, id: string, toState: OnboardingState, opts: { reason?: string | null; allowSkip?: boolean; resumeStage?: OnboardingStage } = {}) {
    const rec = await this.requireRecord(id);
    const hasReason = !!(opts.reason && opts.reason.trim());
    const result = evaluateTransition(rec.currentStage, toState, { allowSkip: opts.allowSkip, hasReason }, opts.resumeStage);
    if (!result.ok) throw new OnboardingError('bad_request', result.reason ?? `Cannot move to ${STAGE_LABELS[toState] ?? toState}`);

    // Recompute completion from the resulting stage set (forward stages imply the prior ones complete).
    const completion = isStage(toState) ? completionPct(defaultCompletedStages(toState)) : rec.completionPct;
    await this.repo.updateRecord(id, {
      currentStage: toState,
      completionPct: completion,
      resumeStage: isOutcome(toState) && isStage(rec.currentStage) ? rec.currentStage : null,
    });
    await this.repo.addHistory({ onboardingId: id, fromState: rec.currentStage, toState, skippedStages: result.skips, reason: opts.reason ?? null, actorUserId: ctx.userId ?? null, actorRole: ctx.role ?? null });
    await this.writeAudit(ctx, 'onboarding.transition', id, `${STAGE_LABELS[rec.currentStage] ?? rec.currentStage} → ${STAGE_LABELS[toState] ?? toState}`, opts.reason);
    return this.repo.getRecord(id);
  }

  /** The tenant this case's application became (Super Admin "Mark Converted"). Set once; relinking to a different
   *  tenant is refused. */
  async linkTenant(ctx: AdminCtx, id: string, tenantId: string) {
    const rec = await this.requireRecord(id);
    if (rec.tenantId && rec.tenantId !== tenantId) throw new OnboardingError('conflict', `This onboarding case already belongs to tenant ${rec.tenantId}.`);
    if (rec.tenantId === tenantId) return rec;
    await this.repo.updateRecord(id, { tenantId });
    await this.writeAudit({ ...ctx, tenantId }, 'onboarding.link_tenant', id, 'Onboarding case linked to its tenant');
    return this.repo.getRecord(id);
  }

  async assignSpecialist(ctx: AdminCtx, id: string, specialistUserId: string | null) {
    await this.requireRecord(id);
    await this.repo.updateRecord(id, { specialistUserId });
    await this.writeAudit(ctx, 'onboarding.assign_specialist', id, specialistUserId ? `Assigned specialist ${specialistUserId}` : 'Unassigned specialist');
    return this.repo.getRecord(id);
  }

  async addNote(ctx: AdminCtx, id: string, input: { body: string; noteType?: NoteRow['noteType']; visibility?: NoteRow['visibility']; stage?: string | null; followUpDate?: string | null }) {
    await this.requireRecord(id);
    if (!input.body?.trim()) throw new OnboardingError('bad_request', 'Note body is required');
    const noteId = await this.repo.addNote({
      onboardingId: id, authorUserId: ctx.userId ?? null, authorName: ctx.actorName ?? null,
      noteType: input.noteType ?? 'note', body: input.body.trim(), stage: input.stage ?? null,
      visibility: input.visibility ?? 'internal', attachmentDocumentId: null, followUpDate: input.followUpDate ?? null,
    });
    await this.writeAudit(ctx, 'onboarding.note', id, `Note added (${input.visibility ?? 'internal'})`);
    return { id: noteId };
  }

  async requestInfo(ctx: AdminCtx, id: string, message: string, deadline?: string | null) {
    if (!message?.trim()) throw new OnboardingError('bad_request', 'A message describing the requested information is required');
    return this.addNote(ctx, id, { body: message, noteType: 'request_info', visibility: 'applicant_visible', followUpDate: deadline ?? null });
  }

  async returnForCorrection(ctx: AdminCtx, id: string, reason: string, corrections: string) {
    if (!reason?.trim()) throw new OnboardingError('bad_request', 'A reason is required to return for correction');
    if (!corrections?.trim()) throw new OnboardingError('bad_request', 'Correction requirements are required');
    await this.addNote(ctx, id, { body: `Return for correction: ${corrections.trim()}`, noteType: 'return_for_correction', visibility: 'applicant_visible' });
    return this.transitionStage(ctx, id, 'returned_for_correction', { reason });
  }

  async addApproval(ctx: AdminCtx, id: string, approvalType: ApprovalType, stage?: string | null, requiresSecondApproval = false) {
    await this.requireRecord(id);
    const approvalId = await this.repo.addApproval({ onboardingId: id, approvalType, stage, requiresSecondApproval });
    await this.writeAudit(ctx, 'onboarding.approval.queue', id, `Queued ${approvalType} approval`);
    return { id: approvalId };
  }

  async decideApproval(ctx: AdminCtx, approvalId: string, decision: { status: ApprovalStatus; reason?: string | null }) {
    if (!ctx.userId) throw new OnboardingError('forbidden', 'An authenticated approver is required');
    if ((decision.status === 'rejected' || decision.status === 'returned') && !decision.reason?.trim()) {
      throw new OnboardingError('bad_request', 'A reason is required to reject or return an approval');
    }
    const appr = await this.repo.getApproval(approvalId);
    if (!appr) throw new OnboardingError('not_found', 'Approval not found');
    const action = evaluateApprovalDecision(appr, ctx.userId, decision.status);
    switch (action.kind) {
      case 'error':
        throw new OnboardingError('conflict', action.reason);
      case 'finalize':
        await this.repo.decideApproval(approvalId, { status: action.status, decidedByUserId: ctx.userId, decidedByRole: ctx.role ?? null, reason: decision.reason ?? null });
        await this.writeAudit(ctx, 'onboarding.approval.decide', appr.onboardingId, `${appr.approvalType} ${action.status}`, decision.reason);
        return { ok: true, status: action.status, awaitingSecond: false };
      case 'await_second':
        // record the first approval but keep the row pending until a distinct second approver signs off
        await this.repo.decideApproval(approvalId, { status: 'pending', decidedByUserId: ctx.userId, decidedByRole: ctx.role ?? null, reason: decision.reason ?? null });
        await this.writeAudit(ctx, 'onboarding.approval.first_approve', appr.onboardingId, `${appr.approvalType} first approval — awaiting second approver`);
        return { ok: true, status: 'pending' as ApprovalStatus, awaitingSecond: true };
      case 'second_approve':
        await this.repo.secondApprove(approvalId, { secondApproverUserId: ctx.userId });
        await this.writeAudit(ctx, 'onboarding.approval.second_approve', appr.onboardingId, `${appr.approvalType} second approval — approved (two-person)`);
        return { ok: true, status: 'approved' as ApprovalStatus, awaitingSecond: false };
    }
  }

  /** Activation: validates EVERY mandatory prerequisite, refuses if already activated (idempotency), and routes
   *  through the state machine (never a raw status toggle). For critical activation the controller also requires a
   *  typed tenant-name confirmation; the reason/activation note is captured here. */
  async activateTenant(ctx: AdminCtx, id: string, opts: { note?: string | null; activationType?: 'new' | 'upgraded' | 'reactivated' } = {}) {
    const rec = await this.requireRecord(id);
    if (rec.currentStage === 'tenant_activated') throw new OnboardingError('conflict', 'Tenant is already activated');

    const failures = ACTIVATION_PREREQS.filter((p) => !p.ok({
      identity: rec.identity, merchant: rec.merchant, bank: rec.bank, dataImport: rec.dataImport,
      training: rec.training, usersInvited: rec.usersInvited, missingDocsCount: rec.missingDocsCount, currentStage: rec.currentStage,
    })).map((p) => p.label);
    if (failures.length > 0) throw new OnboardingError('bad_request', `Activation blocked — unmet prerequisites: ${failures.join('; ')}`);

    await this.repo.updateRecord(id, { currentStage: 'tenant_activated', completionPct: 100, activatedAt: new Date().toISOString(), activationType: opts.activationType ?? 'new' });
    await this.repo.addHistory({ onboardingId: id, fromState: rec.currentStage, toState: 'tenant_activated', reason: opts.note ?? null, actorUserId: ctx.userId ?? null, actorRole: ctx.role ?? null });
    await this.writeAudit(ctx, 'onboarding.activate', id, 'Tenant activated', opts.note, 'critical');
    // Onboarding reached 100% → emit ONBOARDING_COMPLETED into the automation engine. Fire-and-forget + guarded +
    // idempotent per onboarding record; activation is already committed and must not be affected by automation.
    if (this.db) {
      const engine = new AutomationEngineService(this.db as any);
      engine.ingestEvent({ eventId: `onboarding-complete|${id}`, type: 'ONBOARDING_COMPLETED', tenantId: rec.tenantId ?? null, entityId: String(id), entityType: 'onboarding_record', triggeredBy: 'system', payload: { salonName: rec.salonName ?? null, completionPct: 100, activationType: opts.activationType ?? 'new' } })
        .catch(() => { /* automation is best-effort */ });
    }
    return this.repo.getRecord(id);
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Audited export honoring the active filters/sort. Mirrors the platform-wide reports.export() convention:
   *  CSV is generated for real (formula-injection-guarded, no sensitive columns); XLSX/PDF are intentionally not
   *  configured platform-wide and return an honest `disabledReason` rather than a fabricated binary. Capped at 5000
   *  rows. The act (and its outcome) is recorded to the audit log. */
  async export(ctx: AdminCtx, q: OnboardingQuery = {}, format: OnboardingExportFormat = 'csv'): Promise<OnboardingExportResult> {
    if (format === 'excel' || format === 'pdf') {
      await this.writeAudit(ctx, 'onboarding.export', 'pipeline', `Export requested (${format}) — not configured`);
      return { format, filename: '', disabledReason: 'Export is not configured yet.' };
    }
    const page = await this.repo.listRecords({
      search: q.search, applicationType: q.applicationType, stage: q.stage, specialistId: q.specialistId,
      merchantStatus: q.merchantStatus as never, hardwareStatus: q.hardwareStatus as never, importStatus: q.importStatus as never,
      trainingStatus: q.trainingStatus as never, hasMissingDocuments: q.hasMissingDocuments,
      sort: (q.sort as never) ?? 'updated', direction: q.direction ?? 'desc', page: 1, pageSize: 5000,
    });
    await this.writeAudit(ctx, 'onboarding.export', 'pipeline', `Exported ${page.rows.length} onboarding rows (csv)`);
    return { format: 'csv', filename: `onboarding-pipeline-${new Date().toISOString().slice(0, 10)}.csv`, csv: onboardingRowsToCsv(page.rows) };
  }

  async getRecord(id: string) { return this.requireRecord(id); }
  async listHistory(id: string) { await this.requireRecord(id); return this.repo.listHistory(id); }
  async listNotes(ctx: AdminCtx, id: string) { await this.requireRecord(id); return this.repo.listNotes(id, this.adminVisibility); }
  async listDocuments(id: string) { await this.requireRecord(id); return this.repo.listDocuments(id); }
  /** Approve / reject / claim-for-review a single document. Enforces reviewable-state, reject-needs-reason, and the
   *  no-approve-on-failed/incomplete-scan safety rule (pure evaluator); records the reviewer + an audit event. */
  async reviewDocument(ctx: AdminCtx, documentId: string, decision: { status: DocumentStatus; rejectionReason?: string | null }) {
    if (!ctx.userId) throw new OnboardingError('forbidden', 'An authenticated reviewer is required');
    const doc = await this.repo.getDocument(documentId);
    if (!doc) throw new OnboardingError('not_found', 'Document not found');
    const action = evaluateDocumentReview({ status: doc.status as DocumentStatus, virusScanStatus: doc.virusScanStatus as never }, decision.status, decision.rejectionReason);
    if (action.kind === 'error') throw new OnboardingError('conflict', action.reason);
    await this.repo.reviewDocument(documentId, { status: action.status, reviewerUserId: ctx.userId, rejectionReason: action.rejectionReason });
    await this.writeAudit(ctx, 'onboarding.document.review', doc.onboardingId, `Document ${doc.fileName ?? doc.category} ${action.status}`, action.rejectionReason);
    return { ok: true, status: action.status };
  }
  async listApprovals(filter: { status?: ApprovalStatus; approvalType?: ApprovalType } = {}) { return this.repo.listApprovals(filter); }

  private async requireRecord(id: string) {
    const rec = await this.repo.getRecord(id);
    if (!rec) throw new OnboardingError('not_found', 'Onboarding record not found');
    return rec;
  }

  private async writeAudit(ctx: AdminCtx, action: string, resourceId: string, summary: string, reason?: string | null, severity?: 'critical') {
    // Always recorded in the onboarding ledger (stage_history/approvals). Additionally mirror to the central audit log
    // when a tenant context exists (post-activation / tenant-scoped); record() self-guards and never throws.
    if (!this.audit || !ctx.tenantId) return;
    await this.audit.record(
      { tenantId: ctx.tenantId, userId: ctx.userId ?? null, role: ctx.role ?? null, actorName: ctx.actorName ?? null, ip: ctx.ip ?? null },
      { module: 'onboarding', action, resourceType: 'onboarding_record', resourceId, summary, severity: severity ?? 'low', metadata: reason ? { reason } : undefined },
    );
  }
}

const toSnake = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();
const humanize = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
