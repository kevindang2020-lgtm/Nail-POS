// onboarding.repository.ts — data access for the Super-Admin Onboarding & Approvals subsystem over onboarding_records
// (+ stage_history / approvals / documents / notes), with tenant_applications as the spine. InMemory starts empty (no
// fabricated data) and reuses the pure list/filter/sort/paginate helpers from onboarding-core so its behavior matches
// the Postgres repo. Mutations are intentionally narrow; permission + audit are applied one layer up in the service.
import { randomUUID } from 'crypto';
import {
  listRecords as listRecordsPure, rollupKpis, stageDistribution, completionTrend, attachSla,
  type OnboardingRecordRow, type ListParams, type OnboardingAppSummary, type OnboardingState,
} from './onboarding-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { ApprovalType, ApprovalStatus, ApprovalRow } from '@aipowersalon/api-contracts/platform';
import type { ApprovalType, ApprovalStatus, ApprovalRow } from '@aipowersalon/api-contracts/platform';

export interface NewOnboardingRecord {
  applicationId: string;
  applicationType?: 'new_tenant' | 'new_branch';
  parentTenantId?: string | null;
  branchCount?: number;
  specialistUserId?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  targetActivationDate?: string | null;
}

/** Narrow patch the service applies after the core has validated a transition/decision. */
export type RecordPatch = Partial<Pick<OnboardingRecordRow,
  'currentStage' | 'resumeStage' | 'completionPct' | 'specialistUserId' | 'identity' | 'merchant' | 'bank' |
  'hardware' | 'dataImport' | 'training' | 'usersInvited' | 'missingDocsCount' | 'priority' | 'tenantId' |
  'activatedAt' | 'activationType'>>;

export interface StageHistoryEntry {
  onboardingId: string; fromState: string | null; toState: string; skippedStages?: string[];
  reason?: string | null; actorUserId?: string | null; actorRole?: string | null; auditEventId?: string | null;
}
export interface HistoryRow extends StageHistoryEntry { id: string; createdAt: string }



export interface NoteRow {
  id: string; onboardingId: string; authorUserId: string | null; authorName: string | null;
  noteType: 'note' | 'request_info' | 'rejection' | 'return_for_correction' | 'approval' | 'risk'; body: string;
  stage: string | null; visibility: 'internal' | 'applicant_visible' | 'merchant_team' | 'security_compliance';
  attachmentDocumentId: string | null; followUpDate: string | null; createdAt: string;
}

export interface DocumentRow {
  id: string; onboardingId: string; category: string; fileName: string | null; status: string;
  reviewerUserId: string | null; reviewedAt: string | null; rejectionReason: string | null;
  issueDate: string | null; expirationDate: string | null; version: number; virusScanStatus: string;
  createdAt: string; updatedAt: string; // NOTE: storage_key is deliberately NOT exposed by the repo read shape.
}

export interface SpecialistWorkloadRow { specialistUserId: string; specialistName: string | null; active: number; completed: number }

export interface OnboardingRepo {
  listRecords(p: ListParams): Promise<{ rows: OnboardingRecordRow[]; total: number; page: number; pageSize: number; totalPages: number }>;
  summaries(): Promise<OnboardingAppSummary[]>;
  getRecord(id: string): Promise<OnboardingRecordRow | null>;
  getByApplicationId(applicationId: string): Promise<OnboardingRecordRow | null>;
  insertRecord(input: NewOnboardingRecord): Promise<string>;
  updateRecord(id: string, patch: RecordPatch): Promise<void>;
  addHistory(e: StageHistoryEntry): Promise<string>;
  listHistory(onboardingId: string): Promise<HistoryRow[]>;
  listApprovals(filter: { status?: ApprovalStatus; approvalType?: ApprovalType; onboardingId?: string }): Promise<ApprovalRow[]>;
  getApproval(id: string): Promise<ApprovalRow | null>;
  addApproval(a: { onboardingId: string; approvalType: ApprovalType; stage?: string | null; requiresSecondApproval?: boolean }): Promise<string>;
  decideApproval(id: string, d: { status: ApprovalStatus; decidedByUserId: string; decidedByRole?: string | null; reason?: string | null; auditEventId?: string | null }): Promise<void>;
  secondApprove(id: string, d: { secondApproverUserId: string; auditEventId?: string | null }): Promise<void>;
  approvalCountsByType(): Promise<Record<ApprovalType, number>>;
  listNotes(onboardingId: string, allowedVisibility: string[]): Promise<NoteRow[]>;
  recentNotes(limit: number, allowedVisibility: string[]): Promise<NoteRow[]>;
  addNote(n: Omit<NoteRow, 'id' | 'createdAt'>): Promise<string>;
  listDocuments(onboardingId: string): Promise<DocumentRow[]>;
  getDocument(id: string): Promise<DocumentRow | null>;
  addDocument(d: { onboardingId: string; category: string; fileName?: string | null; status?: string; virusScanStatus?: string; expirationDate?: string | null }): Promise<string>;
  reviewDocument(id: string, d: { status: string; reviewerUserId: string; rejectionReason?: string | null }): Promise<void>;
  specialistWorkload(): Promise<SpecialistWorkloadRow[]>;
  missingDocsTotal(): Promise<number>;
  activationSummary(): Promise<{ total: number; newTenants: number; upgraded: number; reactivated: number }>;
  recentHistory(limit: number): Promise<HistoryRow[]>;
  completionTrend(days: number): Promise<{ date: string; applications: number; completions: number }[]>;
}

const nowIso = () => new Date().toISOString();
const EMPTY_APPROVAL_COUNTS = (): Record<ApprovalType, number> => ({
  merchant_application: 0, bank_verification: 0, hardware_assignment: 0, data_import: 0,
  user_invitation: 0, training_completion: 0, final_review: 0, identity_verification: 0, step: 0,
});

export class InMemoryOnboardingRepo implements OnboardingRepo {
  public records: OnboardingRecordRow[] = [];
  public history: HistoryRow[] = [];
  public approvals: ApprovalRow[] = [];
  public notes: NoteRow[] = [];
  public documents: DocumentRow[] = [];
  /** Optional join sources the in-memory repo reads for names; empty by default (no fabricated data). */
  public specialistNames = new Map<string, string>();

  async listRecords(p: ListParams) { return listRecordsPure(this.records.map((r) => attachSla({ ...r })), p); }
  async summaries(): Promise<OnboardingAppSummary[]> {
    return this.records.map((r) => ({ id: r.id, state: r.currentStage, identity: r.identity, merchant: r.merchant, bank: r.bank, hardware: r.hardware, dataImport: r.dataImport, training: r.training, usersInvited: r.usersInvited }));
  }
  async getRecord(id: string) { const r = this.records.find((x) => x.id === id); return r ? { ...r } : null; }
  async getByApplicationId(applicationId: string) { const r = this.records.find((x) => x.applicationId === applicationId); return r ? { ...r } : null; }

  async insertRecord(input: NewOnboardingRecord) {
    const id = randomUUID(); const ts = nowIso();
    this.records.unshift(attachSla({
      id, applicationId: input.applicationId, applicationType: input.applicationType ?? 'new_tenant',
      parentTenantId: input.parentTenantId ?? null, tenantId: null, salonName: null, ownerName: null, ownerEmail: null,
      branchCount: input.branchCount ?? 0, currentStage: 'application_received' as OnboardingState, resumeStage: null, completionPct: 0,
      stageEnteredAt: ts, stageAgeHours: 0, slaBand: 'ok' as const,
      specialistUserId: input.specialistUserId ?? null, specialistName: input.specialistUserId ? this.specialistNames.get(input.specialistUserId) ?? null : null,
      identity: 'not_started', merchant: 'not_submitted', bank: 'not_started', hardware: 'not_ordered',
      dataImport: 'not_started', training: 'not_started', usersInvited: false, missingDocsCount: 0,
      priority: input.priority ?? 'normal', targetActivationDate: input.targetActivationDate ?? null,
      activatedAt: null, activationType: null, createdAt: ts, updatedAt: ts,
    }));
    return id;
  }
  async updateRecord(id: string, patch: RecordPatch) {
    const r = this.records.find((x) => x.id === id); if (!r) return;
    const stageChanged = patch.currentStage !== undefined && patch.currentStage !== r.currentStage;
    Object.assign(r, patch, { updatedAt: nowIso() });
    if (stageChanged) r.stageEnteredAt = nowIso();
    if (patch.specialistUserId !== undefined) r.specialistName = patch.specialistUserId ? this.specialistNames.get(patch.specialistUserId) ?? null : null;
    Object.assign(r, attachSla(r)); // keep derived stage-age/SLA fresh
  }

  async addHistory(e: StageHistoryEntry) {
    const id = randomUUID();
    this.history.unshift({ id, createdAt: nowIso(), skippedStages: e.skippedStages ?? [], reason: e.reason ?? null, actorUserId: e.actorUserId ?? null, actorRole: e.actorRole ?? null, auditEventId: e.auditEventId ?? null, onboardingId: e.onboardingId, fromState: e.fromState, toState: e.toState });
    return id;
  }
  async listHistory(onboardingId: string) { return this.history.filter((h) => h.onboardingId === onboardingId).map((h) => ({ ...h })); }

  async listApprovals(filter: { status?: ApprovalStatus; approvalType?: ApprovalType; onboardingId?: string }) {
    return this.approvals.filter((a) => (!filter.status || a.status === filter.status) && (!filter.approvalType || a.approvalType === filter.approvalType) && (!filter.onboardingId || a.onboardingId === filter.onboardingId)).map((a) => ({ ...a }));
  }
  async addApproval(a: { onboardingId: string; approvalType: ApprovalType; stage?: string | null; requiresSecondApproval?: boolean }) {
    const id = randomUUID(); const ts = nowIso();
    this.approvals.unshift({ id, onboardingId: a.onboardingId, approvalType: a.approvalType, stage: a.stage ?? null, status: 'pending', decision: null, decidedByUserId: null, decidedByRole: null, decidedAt: null, reason: null, previousStatus: null, newStatus: null, requiresSecondApproval: a.requiresSecondApproval ?? false, secondApproverUserId: null, secondApprovedAt: null, applicantNotified: false, auditEventId: null, createdAt: ts, updatedAt: ts });
    return id;
  }
  async decideApproval(id: string, d: { status: ApprovalStatus; decidedByUserId: string; decidedByRole?: string | null; reason?: string | null; auditEventId?: string | null }) {
    const a = this.approvals.find((x) => x.id === id); if (!a) return;
    a.previousStatus = a.status; a.status = d.status; a.newStatus = d.status; a.decidedByUserId = d.decidedByUserId;
    a.decidedByRole = d.decidedByRole ?? null; a.reason = d.reason ?? null; a.auditEventId = d.auditEventId ?? null;
    a.decidedAt = nowIso(); a.updatedAt = nowIso();
  }
  async getApproval(id: string) { const a = this.approvals.find((x) => x.id === id); return a ? { ...a } : null; }
  async secondApprove(id: string, d: { secondApproverUserId: string; auditEventId?: string | null }) {
    const a = this.approvals.find((x) => x.id === id); if (!a) return;
    a.secondApproverUserId = d.secondApproverUserId; a.secondApprovedAt = nowIso();
    a.previousStatus = a.status; a.status = 'approved'; a.newStatus = 'approved';
    if (d.auditEventId) a.auditEventId = d.auditEventId; a.updatedAt = nowIso();
  }
  async approvalCountsByType() {
    const counts = EMPTY_APPROVAL_COUNTS();
    for (const a of this.approvals) if (a.status === 'pending') counts[a.approvalType]++;
    return counts;
  }

  async listNotes(onboardingId: string, allowedVisibility: string[]) {
    const allow = new Set(allowedVisibility);
    return this.notes.filter((n) => n.onboardingId === onboardingId && allow.has(n.visibility)).map((n) => ({ ...n }));
  }
  async recentNotes(limit: number, allowedVisibility: string[]) {
    const allow = new Set(allowedVisibility);
    return this.notes.filter((n) => allow.has(n.visibility)).slice(0, limit).map((n) => ({ ...n }));
  }
  async addNote(n: Omit<NoteRow, 'id' | 'createdAt'>) {
    const id = randomUUID();
    this.notes.unshift({ ...n, id, createdAt: nowIso() });
    return id;
  }

  async listDocuments(onboardingId: string) { return this.documents.filter((d) => d.onboardingId === onboardingId).map((d) => ({ ...d })); }
  async getDocument(id: string) { const d = this.documents.find((x) => x.id === id); return d ? { ...d } : null; }
  async addDocument(d: { onboardingId: string; category: string; fileName?: string | null; status?: string; virusScanStatus?: string; expirationDate?: string | null }) {
    const id = randomUUID(); const ts = nowIso();
    this.documents.push({ id, onboardingId: d.onboardingId, category: d.category, fileName: d.fileName ?? null, status: d.status ?? 'pending', reviewerUserId: null, reviewedAt: null, rejectionReason: null, issueDate: null, expirationDate: d.expirationDate ?? null, version: 1, virusScanStatus: d.virusScanStatus ?? 'pending', createdAt: ts, updatedAt: ts });
    return id;
  }
  async reviewDocument(id: string, d: { status: string; reviewerUserId: string; rejectionReason?: string | null }) {
    const doc = this.documents.find((x) => x.id === id); if (!doc) return;
    doc.status = d.status; doc.reviewerUserId = d.reviewerUserId; doc.reviewedAt = nowIso();
    doc.rejectionReason = d.rejectionReason ?? null; doc.updatedAt = nowIso();
  }

  async specialistWorkload(): Promise<SpecialistWorkloadRow[]> {
    const by = new Map<string, { active: number; completed: number }>();
    for (const r of this.records) {
      if (!r.specialistUserId) continue;
      const w = by.get(r.specialistUserId) ?? { active: 0, completed: 0 };
      if (r.currentStage === 'tenant_activated') w.completed++; else if (typeof r.currentStage === 'string') w.active++;
      by.set(r.specialistUserId, w);
    }
    return [...by.entries()].map(([specialistUserId, w]) => ({ specialistUserId, specialistName: this.specialistNames.get(specialistUserId) ?? null, ...w }));
  }

  async missingDocsTotal() { return this.records.reduce((n, r) => n + r.missingDocsCount, 0); }
  async activationSummary() {
    const activated = this.records.filter((r) => r.currentStage === 'tenant_activated');
    return {
      total: activated.length,
      newTenants: activated.filter((r) => r.activationType === 'new' || r.activationType == null).length,
      upgraded: activated.filter((r) => r.activationType === 'upgraded').length,
      reactivated: activated.filter((r) => r.activationType === 'reactivated').length,
    };
  }
  async recentHistory(limit: number) { return this.history.slice(0, limit).map((h) => ({ ...h })); }
  async completionTrend(days: number) {
    return completionTrend(this.records.map((r) => ({ createdAt: r.createdAt, activatedAt: r.activatedAt })), days);
  }
}

/** Convenience used by the service + tests: KPI rollup + distribution straight from a repo's summaries. */
export async function overviewRollup(repo: OnboardingRepo): Promise<{ kpis: ReturnType<typeof rollupKpis>; distribution: ReturnType<typeof stageDistribution> }> {
  const [summaries, counts] = await Promise.all([repo.summaries(), repo.approvalCountsByType()]);
  const pending = (Object.values(counts) as number[]).reduce((s, n) => s + n, 0);
  return { kpis: rollupKpis(summaries, pending), distribution: stageDistribution(summaries) };
}

export type { OnboardingState };
