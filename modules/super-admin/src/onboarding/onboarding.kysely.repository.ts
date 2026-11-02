// onboarding.kysely.repository.ts — production Postgres implementation of OnboardingRepo. Platform-wide (authorization
// is the SuperAdminGuard; this is the one cross-tenant oversight surface). Reads join onboarding_records → the
// tenant_applications spine (salon/owner/email) and → users (specialist name). Filtering/sorting/pagination is pushed
// into SQL but mirrors the pure helpers in onboarding-core so in-memory and Postgres agree. storage_key is never
// selected into a read shape; short-lived signed access is minted elsewhere.
import { sql, type Kysely } from 'kysely';
import { applyListQuery, parseListQuery, type DB, type ParsedListQuery } from '@aipowersalon/database';
import { ONBOARDING_RECORDS_SPEC } from './onboarding.module.list-queries';
import {
  ONBOARDING_STAGES, stageIndex, isStage, attachSla,
  type OnboardingRecordRow, type ListParams, type OnboardingAppSummary, type OnboardingState,
  type Identity, type MerchantUnderwriting, type Bank, type HardwareShipment, type DataImport, type Training,
} from './onboarding-core';
import type {
  OnboardingRepo, NewOnboardingRecord, RecordPatch, StageHistoryEntry, HistoryRow, ApprovalRow, ApprovalStatus,
  ApprovalType, NoteRow, DocumentRow, SpecialistWorkloadRow,
} from './onboarding.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { ONBOARDING_APPROVAL, ONBOARDING_DOCUMENT } from '../lifecycles';

const iso = (d: Date | string | null): string | null => (d == null ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString()));
const dateStr = (d: Date | string | null): string | null => (d == null ? null : (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)));


type RecRow = {
  id: string; application_id: string; application_type: string; parent_tenant_id: string | null; tenant_id: string | null;
  salon_name: string | null; owner_name: string | null; owner_email: string | null; branch_count: number;
  current_stage: string; resume_stage: string | null; completion_pct: number; specialist_user_id: string | null;
  specialist_name: string | null; identity_status: string; merchant_status: string; bank_status: string;
  hardware_status: string; data_import_status: string; training_status: string; users_invited: boolean;
  missing_docs_count: number; priority: string; target_activation_date: Date | string | null;
  activated_at: Date | string | null; activation_type: string | null; created_at: Date | string; updated_at: Date | string;
  stage_entered_at: Date | string;
};

function mapRow(r: RecRow): OnboardingRecordRow {
  return attachSla({
    id: r.id, applicationId: r.application_id, applicationType: (r.application_type as 'new_tenant' | 'new_branch'),
    parentTenantId: r.parent_tenant_id, tenantId: r.tenant_id, salonName: r.salon_name, ownerName: r.owner_name,
    ownerEmail: r.owner_email, branchCount: Number(r.branch_count), currentStage: r.current_stage as OnboardingState,
    resumeStage: (isStage(r.resume_stage ?? '') ? r.resume_stage : null) as OnboardingRecordRow['resumeStage'],
    completionPct: Number(r.completion_pct), stageEnteredAt: iso(r.stage_entered_at)!, stageAgeHours: 0, slaBand: 'ok',
    specialistUserId: r.specialist_user_id, specialistName: r.specialist_name,
    identity: r.identity_status as Identity, merchant: r.merchant_status as MerchantUnderwriting, bank: r.bank_status as Bank,
    hardware: r.hardware_status as HardwareShipment, dataImport: r.data_import_status as DataImport, training: r.training_status as Training,
    usersInvited: r.users_invited, missingDocsCount: Number(r.missing_docs_count), priority: r.priority as OnboardingRecordRow['priority'],
    targetActivationDate: dateStr(r.target_activation_date), activatedAt: iso(r.activated_at),
    activationType: (r.activation_type as OnboardingRecordRow['activationType']), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  });
}

export class KyselyOnboardingRepo implements OnboardingRepo {
  constructor(private db: Kysely<DB>) {}

  private baseSelect() {
    return this.db
      .selectFrom('onboarding_records as r')
      .innerJoin('tenant_applications as ta', 'ta.id', 'r.application_id')
      .leftJoin('users as u', 'u.id', 'r.specialist_user_id')
      .select([
        'r.id', 'r.application_id', 'r.application_type', 'r.parent_tenant_id', 'r.tenant_id',
        'ta.salon_name as salon_name', 'ta.owner_name as owner_name', 'ta.email as owner_email',
        'r.branch_count', 'r.current_stage', 'r.resume_stage', 'r.completion_pct', 'r.specialist_user_id',
        'u.full_name as specialist_name', 'r.identity_status', 'r.merchant_status', 'r.bank_status',
        'r.hardware_status', 'r.data_import_status', 'r.training_status', 'r.users_invited', 'r.missing_docs_count',
        'r.priority', 'r.target_activation_date', 'r.activated_at', 'r.activation_type', 'r.created_at', 'r.updated_at', 'r.stage_entered_at',
      ]);
  }

  // BUILD_PLAN Phase 12 (DoD #21/#22): the filters, search and sort come from the ONE declaration the interceptor also
  // validates (ONBOARDING_RECORDS_SPEC) — columns from the spec, values bound. Only the missing-documents count stays here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyFilters(qb: any, p: ListParams, parsed: ParsedListQuery) {
    qb = applyListQuery(qb, parsed, { sort: false, limit: false });
    if (p.hasMissingDocuments === true) qb = qb.where('r.missing_docs_count', '>', 0);
    if (p.hasMissingDocuments === false) qb = qb.where('r.missing_docs_count', '=', 0);
    return qb;
  }

  async listRecords(p: ListParams) {
    const parsed = parseListQuery({ ...p, hasMissingDocuments: undefined }, ONBOARDING_RECORDS_SPEC);
    const ps = parsed.limit;

    const countRow = await this.applyFilters(
      this.db.selectFrom('onboarding_records as r').innerJoin('tenant_applications as ta', 'ta.id', 'r.application_id').leftJoin('users as u', 'u.id', 'r.specialist_user_id'),
      p, parsed,
    ).select(sql<number>`count(*)::int`.as('n')).executeTakeFirst();
    const total = Number(countRow?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const page = Math.max(1, Math.min(p.page ?? 1, totalPages));

    const rows = (await applyListQuery(this.applyFilters(this.baseSelect(), p, parsed), parsed, { filters: false, search: false, range: false, limit: false })
      .limit(ps).offset((page - 1) * ps)
      .execute()) as RecRow[];
    return { rows: rows.map(mapRow), total, page, pageSize: ps, totalPages };
  }

  async summaries(): Promise<OnboardingAppSummary[]> {
    const rows = await this.db.selectFrom('onboarding_records').select([
      'id', 'current_stage', 'identity_status', 'merchant_status', 'bank_status', 'hardware_status', 'data_import_status', 'training_status', 'users_invited',
    ]).execute();
    return rows.map((r) => ({ id: r.id, state: r.current_stage as OnboardingState, identity: r.identity_status as Identity, merchant: r.merchant_status as MerchantUnderwriting, bank: r.bank_status as Bank, hardware: r.hardware_status as HardwareShipment, dataImport: r.data_import_status as DataImport, training: r.training_status as Training, usersInvited: r.users_invited }));
  }

  async getRecord(id: string) {
    const r = (await this.baseSelect().where('r.id', '=', id).executeTakeFirst()) as RecRow | undefined;
    return r ? mapRow(r) : null;
  }
  async getByApplicationId(applicationId: string) {
    const r = (await this.baseSelect().where('r.application_id', '=', applicationId).executeTakeFirst()) as RecRow | undefined;
    return r ? mapRow(r) : null;
  }

  async insertRecord(input: NewOnboardingRecord) {
    const row = await this.db.insertInto('onboarding_records').values({
      application_id: input.applicationId, application_type: input.applicationType ?? 'new_tenant',
      parent_tenant_id: input.parentTenantId ?? null, branch_count: input.branchCount ?? 0,
      specialist_user_id: input.specialistUserId ?? null, priority: input.priority ?? 'normal',
      target_activation_date: input.targetActivationDate ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async updateRecord(id: string, patch: RecordPatch) {
    const set: Record<string, unknown> = { updated_at: sql`now()` };
    if (patch.currentStage !== undefined) { set.current_stage = patch.currentStage; set.stage_entered_at = sql`now()`; }
    if (patch.resumeStage !== undefined) set.resume_stage = patch.resumeStage;
    if (patch.completionPct !== undefined) set.completion_pct = patch.completionPct;
    if (patch.specialistUserId !== undefined) set.specialist_user_id = patch.specialistUserId;
    if (patch.identity !== undefined) set.identity_status = patch.identity;
    if (patch.merchant !== undefined) set.merchant_status = patch.merchant;
    if (patch.bank !== undefined) set.bank_status = patch.bank;
    if (patch.hardware !== undefined) set.hardware_status = patch.hardware;
    if (patch.dataImport !== undefined) set.data_import_status = patch.dataImport;
    if (patch.training !== undefined) set.training_status = patch.training;
    if (patch.usersInvited !== undefined) set.users_invited = patch.usersInvited;
    if (patch.missingDocsCount !== undefined) set.missing_docs_count = patch.missingDocsCount;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.tenantId !== undefined) set.tenant_id = patch.tenantId;
    if (patch.activatedAt !== undefined) set.activated_at = patch.activatedAt;
    if (patch.activationType !== undefined) set.activation_type = patch.activationType;
    await this.db.updateTable('onboarding_records').set(set).where('id', '=', id).execute();
  }

  async addHistory(e: StageHistoryEntry) {
    const row = await this.db.insertInto('onboarding_stage_history').values({
      onboarding_id: e.onboardingId, from_state: e.fromState, to_state: e.toState,
      skipped_stages: sql`${JSON.stringify(e.skippedStages ?? [])}::jsonb`, reason: e.reason ?? null,
      actor_user_id: e.actorUserId ?? null, actor_role: e.actorRole ?? null, audit_event_id: e.auditEventId ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
  async listHistory(onboardingId: string): Promise<HistoryRow[]> {
    const rows = await this.db.selectFrom('onboarding_stage_history').selectAll().where('onboarding_id', '=', onboardingId).orderBy('created_at', 'desc').execute();
    return rows.map((h) => ({ id: h.id, onboardingId: h.onboarding_id, fromState: h.from_state, toState: h.to_state, skippedStages: Array.isArray(h.skipped_stages) ? (h.skipped_stages as string[]) : [], reason: h.reason, actorUserId: h.actor_user_id, actorRole: h.actor_role, auditEventId: h.audit_event_id, createdAt: iso(h.created_at)! }));
  }

  async listApprovals(filter: { status?: ApprovalStatus; approvalType?: ApprovalType; onboardingId?: string }): Promise<ApprovalRow[]> {
    let qb = this.db.selectFrom('onboarding_approvals').selectAll();
    if (filter.status) qb = qb.where('status', '=', filter.status);
    if (filter.approvalType) qb = qb.where('approval_type', '=', filter.approvalType);
    if (filter.onboardingId) qb = qb.where('onboarding_id', '=', filter.onboardingId);
    const rows = await qb.orderBy('created_at', 'desc').execute();
    return rows.map((a) => ({ id: a.id, onboardingId: a.onboarding_id, approvalType: a.approval_type as ApprovalType, stage: a.stage, status: a.status as ApprovalStatus, decision: a.decision, decidedByUserId: a.decided_by_user_id, decidedByRole: a.decided_by_role, decidedAt: iso(a.decided_at), reason: a.reason, previousStatus: a.previous_status, newStatus: a.new_status, requiresSecondApproval: a.requires_second_approval, secondApproverUserId: a.second_approver_user_id, secondApprovedAt: iso(a.second_approved_at), applicantNotified: a.applicant_notified, auditEventId: a.audit_event_id, createdAt: iso(a.created_at)!, updatedAt: iso(a.updated_at)! }));
  }
  async addApproval(a: { onboardingId: string; approvalType: ApprovalType; stage?: string | null; requiresSecondApproval?: boolean }) {
    const row = await this.db.insertInto('onboarding_approvals').values({ onboarding_id: a.onboardingId, approval_type: a.approvalType, stage: a.stage ?? null, requires_second_approval: a.requiresSecondApproval ?? false }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
  async decideApproval(id: string, d: { status: ApprovalStatus; decidedByUserId: string; decidedByRole?: string | null; reason?: string | null; auditEventId?: string | null }) {
    await this.db.updateTable('onboarding_approvals').set({
      previous_status: sql`status`, status: d.status, new_status: d.status, decided_by_user_id: d.decidedByUserId,
      decided_by_role: d.decidedByRole ?? null, reason: d.reason ?? null, audit_event_id: d.auditEventId ?? null,
      decided_at: sql`now()`, updated_at: sql`now()`,
    }).where('id', '=', id).where(canMoveToSql(ONBOARDING_APPROVAL, d.status) as any).execute();
  }
  async getApproval(id: string): Promise<ApprovalRow | null> {
    const a = await this.db.selectFrom('onboarding_approvals').selectAll().where('id', '=', id).executeTakeFirst();
    if (!a) return null;
    return { id: a.id, onboardingId: a.onboarding_id, approvalType: a.approval_type as ApprovalType, stage: a.stage, status: a.status as ApprovalStatus, decision: a.decision, decidedByUserId: a.decided_by_user_id, decidedByRole: a.decided_by_role, decidedAt: iso(a.decided_at), reason: a.reason, previousStatus: a.previous_status, newStatus: a.new_status, requiresSecondApproval: a.requires_second_approval, secondApproverUserId: a.second_approver_user_id, secondApprovedAt: iso(a.second_approved_at), applicantNotified: a.applicant_notified, auditEventId: a.audit_event_id, createdAt: iso(a.created_at)!, updatedAt: iso(a.updated_at)! };
  }
  async secondApprove(id: string, d: { secondApproverUserId: string; auditEventId?: string | null }) {
    // The DB CHECK (second_approver_user_id <> decided_by_user_id) is the backstop; the service evaluator already enforces it.
    await this.db.updateTable('onboarding_approvals').set({
      second_approver_user_id: d.secondApproverUserId, second_approved_at: sql`now()`,
      previous_status: sql`status`, status: 'approved', new_status: 'approved',
      audit_event_id: d.auditEventId ?? sql`audit_event_id`, updated_at: sql`now()`,
    }).where('id', '=', id).where(canMoveToSql(ONBOARDING_APPROVAL, 'approved') as any).execute();
  }
  async approvalCountsByType(): Promise<Record<ApprovalType, number>> {
    const rows = await this.db.selectFrom('onboarding_approvals').select(['approval_type']).select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'pending').groupBy('approval_type').execute();
    const counts = { merchant_application: 0, bank_verification: 0, hardware_assignment: 0, data_import: 0, user_invitation: 0, training_completion: 0, final_review: 0, identity_verification: 0, step: 0 } as Record<ApprovalType, number>;
    for (const r of rows) counts[r.approval_type as ApprovalType] = Number(r.n);
    return counts;
  }

  async listNotes(onboardingId: string, allowedVisibility: string[]): Promise<NoteRow[]> {
    if (allowedVisibility.length === 0) return [];
    const rows = await this.db.selectFrom('onboarding_notes').selectAll().where('onboarding_id', '=', onboardingId).where('visibility', 'in', allowedVisibility).orderBy('created_at', 'desc').execute();
    return rows.map(mapNote);
  }
  async recentNotes(limit: number, allowedVisibility: string[]): Promise<NoteRow[]> {
    if (allowedVisibility.length === 0) return [];
    const rows = await this.db.selectFrom('onboarding_notes').selectAll().where('visibility', 'in', allowedVisibility).orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map(mapNote);
  }
  async addNote(n: Omit<NoteRow, 'id' | 'createdAt'>) {
    const row = await this.db.insertInto('onboarding_notes').values({ onboarding_id: n.onboardingId, author_user_id: n.authorUserId, author_name: n.authorName, note_type: n.noteType, body: n.body, stage: n.stage, visibility: n.visibility, attachment_document_id: n.attachmentDocumentId, follow_up_date: n.followUpDate }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async listDocuments(onboardingId: string): Promise<DocumentRow[]> {
    // storage_key intentionally NOT selected — the read shape never carries the private object key.
    const rows = await this.db.selectFrom('onboarding_documents').select([
      'id', 'onboarding_id', 'category', 'file_name', 'status', 'reviewer_user_id', 'reviewed_at', 'rejection_reason', 'issue_date', 'expiration_date', 'version', 'virus_scan_status', 'created_at', 'updated_at',
    ]).where('onboarding_id', '=', onboardingId).orderBy('created_at', 'desc').execute();
    return rows.map((d) => ({ id: d.id, onboardingId: d.onboarding_id, category: d.category, fileName: d.file_name, status: d.status, reviewerUserId: d.reviewer_user_id, reviewedAt: iso(d.reviewed_at), rejectionReason: d.rejection_reason, issueDate: dateStr(d.issue_date), expirationDate: dateStr(d.expiration_date), version: Number(d.version), virusScanStatus: d.virus_scan_status, createdAt: iso(d.created_at)!, updatedAt: iso(d.updated_at)! }));
  }

  async getDocument(id: string): Promise<DocumentRow | null> {
    // storage_key intentionally NOT selected — review never needs the private object key.
    const d = await this.db.selectFrom('onboarding_documents').select([
      'id', 'onboarding_id', 'category', 'file_name', 'status', 'reviewer_user_id', 'reviewed_at', 'rejection_reason', 'issue_date', 'expiration_date', 'version', 'virus_scan_status', 'created_at', 'updated_at',
    ]).where('id', '=', id).executeTakeFirst();
    if (!d) return null;
    return { id: d.id, onboardingId: d.onboarding_id, category: d.category, fileName: d.file_name, status: d.status, reviewerUserId: d.reviewer_user_id, reviewedAt: iso(d.reviewed_at), rejectionReason: d.rejection_reason, issueDate: dateStr(d.issue_date), expirationDate: dateStr(d.expiration_date), version: Number(d.version), virusScanStatus: d.virus_scan_status, createdAt: iso(d.created_at)!, updatedAt: iso(d.updated_at)! };
  }
  async addDocument(d: { onboardingId: string; category: string; fileName?: string | null; status?: string; virusScanStatus?: string; expirationDate?: string | null }): Promise<string> {
    const row = await this.db.insertInto('onboarding_documents').values({
      onboarding_id: d.onboardingId, category: d.category, file_name: d.fileName ?? null,
      status: d.status ?? 'pending', virus_scan_status: d.virusScanStatus ?? 'pending', expiration_date: d.expirationDate ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
  async reviewDocument(id: string, d: { status: string; reviewerUserId: string; rejectionReason?: string | null }): Promise<void> {
    await this.db.updateTable('onboarding_documents').set({
      status: d.status, reviewer_user_id: d.reviewerUserId, reviewed_at: sql`now()`,
      rejection_reason: d.rejectionReason ?? null, updated_at: sql`now()`,
    }).where('id', '=', id).where(canMoveToSql(ONBOARDING_DOCUMENT, d.status) as any).execute();
  }

  async specialistWorkload(): Promise<SpecialistWorkloadRow[]> {
    const rows = await this.db.selectFrom('onboarding_records as r').leftJoin('users as u', 'u.id', 'r.specialist_user_id')
      .select(['r.specialist_user_id', 'u.full_name as specialist_name'])
      .select(sql<number>`sum(case when r.current_stage = 'tenant_activated' then 1 else 0 end)::int`.as('completed'))
      .select(sql<number>`sum(case when r.current_stage <> 'tenant_activated' then 1 else 0 end)::int`.as('active'))
      .where('r.specialist_user_id', 'is not', null).groupBy(['r.specialist_user_id', 'u.full_name']).execute();
    return rows.map((r) => ({ specialistUserId: r.specialist_user_id as string, specialistName: r.specialist_name, active: Number(r.active), completed: Number(r.completed) }));
  }

  async missingDocsTotal(): Promise<number> {
    const row = await this.db.selectFrom('onboarding_records').select(sql<number>`coalesce(sum(missing_docs_count),0)::int`.as('n')).executeTakeFirst();
    return Number(row?.n ?? 0);
  }
  async activationSummary() {
    const row = await this.db.selectFrom('onboarding_records').where('current_stage', '=', 'tenant_activated')
      .select(sql<number>`count(*)::int`.as('total'))
      .select(sql<number>`sum(case when activation_type = 'upgraded' then 1 else 0 end)::int`.as('upgraded'))
      .select(sql<number>`sum(case when activation_type = 'reactivated' then 1 else 0 end)::int`.as('reactivated'))
      .select(sql<number>`sum(case when activation_type = 'new' or activation_type is null then 1 else 0 end)::int`.as('new_tenants'))
      .executeTakeFirst();
    return { total: Number(row?.total ?? 0), newTenants: Number(row?.new_tenants ?? 0), upgraded: Number(row?.upgraded ?? 0), reactivated: Number(row?.reactivated ?? 0) };
  }
  async recentHistory(limit: number): Promise<HistoryRow[]> {
    const rows = await this.db.selectFrom('onboarding_stage_history').selectAll().orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map((h) => ({ id: h.id, onboardingId: h.onboarding_id, fromState: h.from_state, toState: h.to_state, skippedStages: Array.isArray(h.skipped_stages) ? (h.skipped_stages as string[]) : [], reason: h.reason, actorUserId: h.actor_user_id, actorRole: h.actor_role, auditEventId: h.audit_event_id, createdAt: iso(h.created_at)! }));
  }

  async completionTrend(days: number): Promise<{ date: string; applications: number; completions: number }[]> {
    // Gap-filled day series: generate_series of the last `days` UTC days left-joined to per-day created/activated counts.
    const rows = await sql<{ day: Date; applications: number; completions: number }>`
      with series as (
        select generate_series((current_date - (${days - 1} || ' days')::interval)::date, current_date, '1 day')::date as day
      )
      select s.day,
             coalesce(c.applications, 0)::int as applications,
             coalesce(a.completions, 0)::int as completions
      from series s
      left join (select created_at::date as day, count(*)::int as applications from onboarding_records group by 1) c on c.day = s.day
      left join (select activated_at::date as day, count(*)::int as completions from onboarding_records where activated_at is not null group by 1) a on a.day = s.day
      order by s.day asc
    `.execute(this.db);
    return rows.rows.map((r) => ({ date: (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10)), applications: Number(r.applications), completions: Number(r.completions) }));
  }
}

function mapNote(n: { id: string; onboarding_id: string; author_user_id: string | null; author_name: string | null; note_type: string; body: string; stage: string | null; visibility: string; attachment_document_id: string | null; follow_up_date: Date | string | null; created_at: Date | string }): NoteRow {
  return { id: n.id, onboardingId: n.onboarding_id, authorUserId: n.author_user_id, authorName: n.author_name, noteType: n.note_type as NoteRow['noteType'], body: n.body, stage: n.stage, visibility: n.visibility as NoteRow['visibility'], attachmentDocumentId: n.attachment_document_id, followUpDate: dateStr(n.follow_up_date), createdAt: iso(n.created_at)! };
}

// keep the stage ordering import referenced (defensive: ensures core stays the single source of truth for ordering)
void ONBOARDING_STAGES; void stageIndex;
