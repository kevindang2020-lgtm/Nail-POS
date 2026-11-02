// community-moderation.service.ts — BUILD_PLAN Phase 8 (agent B): the Super Admin "Safety Community Moderation" center.
//
// Fixes the audit's moderation bugs (docs/audit-2026-10-06/spec-tenant-safety-community.md):
//   • bug 2 — the moderator is the session's own user (req.ctx.userId, a real uuid); no uuid → refused, never "undefined".
//   • bug 3 — every write runs under a REAL community_moderation_cases row: a given caseId must exist and be open; without
//             one the action opens (or reuses the open) case for that post + kind (unique index uq_cmc_open_post_kind).
//   • bug 4 — transitions go through the core's pure workflow with the post's REAL current status; publish lands on
//             publishedStateFor(label), never evidence_reviewed unless that is the label.
//   • bug 5 — sensitive_data_detected has its own queue and the moderator can redact / publish / reject / request changes.
//   • bug 12 — remove works from every visible state (published_*, disputed, corrected, resolved).
//   • appeals — decided_by + decided_at are set with the status (ck_appeal_decided), and reviewer separation uses the
//             real moderator id.
// Every action writes community_moderation_actions (case, action, actor, post / comment / target salon, reason, detail),
// an audit_logs row and COMMUNITY_MODERATION_ACTION_TAKEN (tenantId = the salon acted on) in ONE transaction with the
// change. Post writes are compare-and-set on `version` (409 version_conflict) and add a community_post_versions row.
// The message to the posting salon (`messageToTenant`) is stored in the action's detail — agent A reads it back as
// CommunityMyPostView.returnReason — and the salon's owner / approvers are told by email to sign in and read it.
import type {
  ModOverview, ModPostView, ModPostDetail, ModPage, ModQueue, ModCaseKind, ModCaseStatus, ModPriority, ModCaseView, ModCaseDetail,
  ModActionView, ModReportView, ModDisputeView, ModAppealView, ModEvidenceView, ModCommentView, ModRestrictionView, ModTenantConduct,
  ModPostActionRequest, ModPostAction, ModCommentActionRequest, ModTenantActionRequest, ModReportResolve, ModDisputeDecision,
  ModAppealDecision, ModEvidenceReview, ModIncidentAccessRequest, ModActionResult, ModPlatformSettings, ModPlatformSettingsUpdate,
  ModAnalytics, ModOpenCase, ModCaseUpdate,
} from '@aipowersalon/api-contracts/platform';
import { COMMUNITY_CATEGORIES, COMMUNITY_RULES_VERSION, type CommunityEvidenceAccess, type CommunityIncidentView, type CommunitySeverity } from '@aipowersalon/api-contracts/tenant';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { transition, publishedStateFor, type WorkflowContext, type WorkflowEvent, type WorkflowState } from './community-workflow';
import { isCommunityVisible, type AdvisoryStatus } from './community-classification';
import { scanCommunityText } from './community-privacy-scan';
import { moderationSignals } from './community-ai-assist';
import { canReviewAppeal, type AppealSubject } from './community-appeals';
import type { CommunityCorePort, CommunityEventsPort, CommunityEvidenceModerationPort, CommunityFanoutPort, CommunityRestrictionsPort, CommunityRestrictionState } from './community.ports';
import type { PostRow } from './community.repository';
import { isUuid, type CommunityModerationRepo, type CaseRow, type Exec, type ModPostRow, type PostWrite, type RestrictionRow, type CommentRowM } from './community-moderation.repository';

/** Same wire shape as the core's CommunityError ({ ok:false, code, ...extra } with `status`). */
export class CommunityModerationError extends Error {
  constructor(public code: string, public status = 400, public extra?: Record<string, unknown>) { super(code); this.name = 'CommunityModerationError'; }
}
const fail = (code: string, status = 400, extra?: Record<string, unknown>): never => { throw new CommunityModerationError(code, status, extra); };

export const MIN_REASON = 8;
export const POST_ACTIONS: readonly ModPostAction[] = ['publish', 'reject', 'request_evidence', 'request_changes', 'redact', 'set_label', 'set_severity',
  'remove', 'restore', 'lock_comments', 'unlock_comments', 'merge_into', 'link_related', 'mark_resolved'];
const LABELS = ['unverified', 'evidence_reviewed', 'multiple_reports', 'official_report'] as const;
const SEVERITIES: readonly CommunitySeverity[] = ['informational', 'low', 'moderate', 'high', 'critical'];
const QUEUES = ['review', 'sensitive', 'returned', 'published', 'removed'] as const;
const CASE_KINDS: readonly ModCaseKind[] = ['post_review', 'report', 'dispute', 'appeal', 'sensitive_data', 'evidence', 'comment', 'tenant_conduct', 'incident_access'];
const CASE_STATUSES: readonly ModCaseStatus[] = ['open', 'investigating', 'resolved', 'closed'];
const PRIORITIES: readonly ModPriority[] = ['low', 'normal', 'high', 'urgent'];
const REDACT_FIELDS = ['title', 'body', 'recommendation', 'official_reference'] as const;
type FanoutChange = Parameters<CommunityFanoutPort['advisoryChanged']>[1];

/** The domain events this half records (§7 of the Phase 8 contract), named explicitly for the architecture test. */
const MOD_EVENTS = {
  COMMUNITY_ADVISORY_PUBLISHED: DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED, COMMUNITY_ADVISORY_REMOVED: DOMAIN_EVENTS.COMMUNITY_ADVISORY_REMOVED,
  COMMUNITY_ADVISORY_RETURNED: DOMAIN_EVENTS.COMMUNITY_ADVISORY_RETURNED, COMMUNITY_ADVISORY_UPDATED: DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED,
  COMMUNITY_COMMENT_REMOVED: DOMAIN_EVENTS.COMMUNITY_COMMENT_REMOVED, COMMUNITY_MODERATION_CASE_OPENED: DOMAIN_EVENTS.COMMUNITY_MODERATION_CASE_OPENED,
  COMMUNITY_MODERATION_ACTION_TAKEN: DOMAIN_EVENTS.COMMUNITY_MODERATION_ACTION_TAKEN, COMMUNITY_TENANT_RESTRICTED: DOMAIN_EVENTS.COMMUNITY_TENANT_RESTRICTED,
} as const;

export interface ModActor { userId: string }
/** The posting salon's owner / approvers hear about a moderator's message (in-app copy lives on the post; this is the nudge). */
export interface CommunityTenantNotifier { notify(tenantId: string, msg: { subject: string; body: string }): Promise<{ sent: number; failed: number }> }

// ── input helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const bad = (field: string, extra: Record<string, unknown> = {}): never => fail('invalid_input', 400, { field, ...extra });
export function reasonOf(v: unknown, field = 'reason'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < MIN_REASON) bad(field, { minLength: MIN_REASON });
  if (s.length > 2000) bad(field, { maxLength: 2000 });
  return s;
}
const optText = (v: unknown, field: string, max = 2000): string | null => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return bad(field);
  const s = v.trim(); if (s.length > max) bad(field, { maxLength: max });
  return s || null;
};
const optUuid = (v: unknown, field: string): string | null => { if (v == null || v === '') return null; if (!isUuid(v)) bad(field); return v as string; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], field: string): T => { if (typeof v !== 'string' || !list.includes(v as T)) bad(field, { allowed: list }); return v as T; };
const optOneOf = <T extends string>(v: unknown, list: readonly T[], field: string): T | null => (v == null || v === '' ? null : oneOf(v, list, field));
export function paging(q: { page?: unknown; pageSize?: unknown }): { page: number; pageSize: number; limit: number; offset: number } {
  const page = q.page == null || q.page === '' ? 1 : Number(q.page);
  const pageSize = q.pageSize == null || q.pageSize === '' ? 20 : Number(q.pageSize);
  if (!Number.isInteger(page) || page < 1) bad('page');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) bad('pageSize', { max: 50 });
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}
const pageOf = <T>(items: T[], total: number, p: { page: number; pageSize: number }): ModPage<T> => ({ items, page: p.page, pageSize: p.pageSize, total, hasMore: p.page * p.pageSize < total });
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const utcDay = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function visibilityFor(status: string): 'draft' | 'community_published' | 'removed' {
  if (isCommunityVisible(status as AdvisoryStatus)) return 'community_published';
  if (status === 'removed' || status === 'archived') return 'removed';
  return 'draft';
}
const priorityFor = (severity: string): ModPriority => (severity === 'critical' ? 'urgent' : severity === 'high' ? 'high' : 'normal');

// ── the pure post-action planner ────────────────────────────────────────────────────────────────────────────────────
export interface PostActionInput {
  action: ModPostAction; reason: string; expectedVersion: number; caseId: string | null;
  label: string | null; severity: string | null; targetPostId: string | null; messageToTenant: string | null;
  redactions: { field: typeof REDACT_FIELDS[number]; find: string; replaceWith: string }[];
}
export function validatePostAction(b: Partial<ModPostActionRequest> | null | undefined): PostActionInput {
  const x: any = b ?? {};
  const action = oneOf(x.action, POST_ACTIONS, 'action');
  const reason = reasonOf(x.reason);
  const expectedVersion = Number(x.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) bad('expectedVersion');
  const label = optOneOf(x.label, LABELS, 'label');
  const severity = optOneOf(x.severity, SEVERITIES, 'severity');
  const targetPostId = optUuid(x.targetPostId, 'targetPostId');
  const messageToTenant = optText(x.messageToTenant, 'messageToTenant');
  let redactions: PostActionInput['redactions'] = [];
  if (action === 'redact') {
    if (!Array.isArray(x.redactions) || !x.redactions.length || x.redactions.length > 20) bad('redactions');
    redactions = x.redactions.map((r: any, i: number) => {
      const field = oneOf(r?.field, REDACT_FIELDS, `redactions[${i}].field`);
      if (typeof r?.find !== 'string' || !r.find.length || r.find.length > 500) bad(`redactions[${i}].find`);
      const replaceWith = r?.replaceWith == null ? '[REDACTED]' : String(r.replaceWith).slice(0, 100);
      return { field, find: r.find, replaceWith };
    });
  }
  if (action === 'set_label' && !label) bad('label');
  if (action === 'set_severity' && !severity) bad('severity');
  if ((action === 'merge_into' || action === 'link_related') && !targetPostId) bad('targetPostId');
  // the salon must be told what to fix: an internal reason never doubles as the message (A shows it as returnReason)
  if ((action === 'request_evidence' || action === 'request_changes' || action === 'reject') && (!messageToTenant || messageToTenant.length < MIN_REASON)) bad('messageToTenant', { minLength: MIN_REASON });
  return { action, reason, expectedVersion, caseId: optUuid(x.caseId, 'caseId'), label, severity, targetPostId, messageToTenant, redactions };
}

export interface PostPlan {
  next: PostWrite;
  event: WorkflowEvent | null;
  domainEvent: 'COMMUNITY_ADVISORY_PUBLISHED' | 'COMMUNITY_ADVISORY_REMOVED' | 'COMMUNITY_ADVISORY_RETURNED' | 'COMMUNITY_ADVISORY_UPDATED';
  change: string;
  fanout: { kind: 'published' } | { kind: 'changed'; change: FanoutChange } | null;
  caseOutcome: 'resolved' | 'investigating' | null;
  notifyTenant: boolean;
  relate: { targetPostId: string; relation: 'related' | 'merged_into' } | null;
  redacted: { field: string }[];
  scanFlags: string[];
}

const wctx = (post: PostRow, label: string): WorkflowContext => ({
  role: 'moderator', receptionistApprovalRequired: true, managerApprovalRequired: true, category: post.category,
  severity: post.severity as WorkflowContext['severity'], verificationLabel: label, moderationRequired: post.moderationRequired,
});
function step(post: PostRow, event: WorkflowEvent, label: string): WorkflowState {
  const r = transition(post.status as WorkflowState, event, wctx(post, label));
  if (!r.ok) return fail('illegal_transition', 409, { status: post.status, action: event, error: r.error });
  return r.state;
}
const REVIEW_STATES = new Set(['moderation_review', 'sensitive_data_detected', 'evidence_requested']);

/** Decide the next full state of a post for one moderator action. PURE: no I/O; throws CommunityModerationError. */
export function planPostAction(post: PostRow, req: PostActionInput, opts: { now: string; authorLabel: string | null; target: PostRow | null }): PostPlan {
  const cur: PostWrite = {
    status: post.status, visibility: post.visibility, verificationLabel: post.verificationLabel, severity: post.severity, title: post.title,
    redactedBody: post.redactedBody, recommendation: post.recommendation ?? null, officialReference: post.officialReference ?? null,
    privacyScanFlags: [...(post.privacyScanFlags ?? [])], commentsLocked: !!post.commentsLocked, removedReason: post.removedReason ?? null,
    mergedIntoPostId: post.mergedIntoPostId ?? null, authorLabel: post.authorLabel ?? null, publishedAt: post.publishedAt ?? null,
    resolvedAt: post.resolvedAt ?? null, resolutionNote: post.resolutionNote ?? null,
  };
  const wasVisible = isCommunityVisible(post.status as AdvisoryStatus);
  const plan: PostPlan = { next: cur, event: null, domainEvent: 'COMMUNITY_ADVISORY_UPDATED', change: req.action, fanout: null, caseOutcome: null, notifyTenant: false, relate: null, redacted: [], scanFlags: [] };
  const setStatus = (s: string) => { cur.status = s; cur.visibility = visibilityFor(s); };
  const rescanAll = () => {
    const fields: [keyof PostWrite, string | null][] = [['title', cur.title], ['redactedBody', cur.redactedBody], ['recommendation', cur.recommendation], ['officialReference', cur.officialReference]];
    const flags = new Set(cur.privacyScanFlags);
    for (const [k, v] of fields) {
      if (v == null || v === '') continue;
      const s = scanCommunityText(v);
      if (s.blocked) fail('sensitive_data_blocked', 422, { field: k === 'redactedBody' ? 'body' : k, categories: s.categories });
      (cur as any)[k] = s.redactedText;
      for (const c of s.categories) { flags.add(c); plan.scanFlags.push(c); }
    }
    cur.privacyScanFlags = [...flags];
  };
  if (post.status === 'archived') fail('illegal_transition', 409, { status: post.status, action: req.action });

  switch (req.action) {
    case 'publish': {
      const label = req.label ?? post.verificationLabel;
      step(post, 'moderator_publish', label);
      rescanAll();                                              // a sensitive post is re-scanned before anyone sees it
      cur.verificationLabel = label; setStatus(publishedStateFor(label));
      cur.authorLabel = opts.authorLabel; cur.publishedAt = post.publishedAt ?? opts.now;
      Object.assign(plan, { event: 'moderator_publish', domainEvent: 'COMMUNITY_ADVISORY_PUBLISHED', fanout: { kind: 'published' }, caseOutcome: 'resolved' });
      break;
    }
    case 'reject':
      setStatus(step(post, 'moderator_reject', cur.verificationLabel));
      Object.assign(plan, { event: 'moderator_reject', domainEvent: 'COMMUNITY_ADVISORY_RETURNED', caseOutcome: 'resolved', notifyTenant: true });
      break;
    case 'request_evidence':
      setStatus(step(post, 'moderator_request_evidence', cur.verificationLabel));
      Object.assign(plan, { event: 'moderator_request_evidence', domainEvent: 'COMMUNITY_ADVISORY_RETURNED', caseOutcome: 'investigating', notifyTenant: true });
      break;
    case 'request_changes':
      setStatus(step(post, 'moderator_request_changes', cur.verificationLabel));
      Object.assign(plan, { event: 'moderator_request_changes', domainEvent: 'COMMUNITY_ADVISORY_RETURNED', caseOutcome: 'investigating', notifyTenant: true });
      break;
    case 'redact': {
      const key = { title: 'title', body: 'redactedBody', recommendation: 'recommendation', official_reference: 'officialReference' } as const;
      const flags = new Set(cur.privacyScanFlags);
      req.redactions.forEach((r, i) => {
        const k = key[r.field]; const before = cur[k] as string | null;
        if (!before || !before.includes(r.find)) bad(`redactions[${i}].find`, { reason: 'not_found' });
        const replaced = before!.split(r.find).join(r.replaceWith);
        const s = scanCommunityText(replaced);                 // re-scan: whatever the find missed is redacted too
        cur[k] = s.redactedText;
        for (const c of s.categories) { flags.add(c); plan.scanFlags.push(c); }
        plan.redacted.push({ field: r.field });
      });
      if (!cur.title.trim()) bad('redactions', { reason: 'title_empty' });
      cur.privacyScanFlags = [...flags];
      if (wasVisible) plan.fanout = { kind: 'changed', change: 'edited' };
      plan.change = 'redacted';
      break;
    }
    case 'set_label': {
      if (post.status === 'removed') fail('illegal_transition', 409, { status: post.status, action: req.action });
      if (req.label === post.verificationLabel) fail('no_change', 409, { field: 'label' });
      cur.verificationLabel = req.label!;
      if (post.status.startsWith('published_')) { step(post, 'relabel', req.label!); setStatus(publishedStateFor(req.label)); cur.authorLabel = opts.authorLabel ?? cur.authorLabel; plan.event = 'relabel'; }
      if (wasVisible) plan.fanout = { kind: 'changed', change: 'label' };
      plan.change = 'label';
      break;
    }
    case 'set_severity':
      if (post.status === 'removed') fail('illegal_transition', 409, { status: post.status, action: req.action });
      if (req.severity === post.severity) fail('no_change', 409, { field: 'severity' });
      cur.severity = req.severity!;
      if (wasVisible) plan.fanout = { kind: 'changed', change: 'severity' };
      plan.change = 'severity';
      break;
    case 'remove':
      setStatus(step(post, 'remove', cur.verificationLabel));
      cur.removedReason = req.messageToTenant ?? req.reason;
      Object.assign(plan, { event: 'remove', domainEvent: 'COMMUNITY_ADVISORY_REMOVED', fanout: { kind: 'changed', change: 'removed' }, caseOutcome: 'resolved', notifyTenant: true });
      break;
    case 'restore':
      step(post, 'restore', cur.verificationLabel);
      setStatus(publishedStateFor(cur.verificationLabel));
      cur.removedReason = null; cur.mergedIntoPostId = null; cur.authorLabel = opts.authorLabel; cur.publishedAt = post.publishedAt ?? opts.now;
      Object.assign(plan, { event: 'restore', domainEvent: 'COMMUNITY_ADVISORY_PUBLISHED', fanout: { kind: 'published' }, caseOutcome: 'resolved' });
      break;
    case 'lock_comments': case 'unlock_comments': {
      const lock = req.action === 'lock_comments';
      if (cur.commentsLocked === lock) fail('no_change', 409, { field: 'commentsLocked' });
      cur.commentsLocked = lock; plan.change = lock ? 'comments_locked' : 'comments_unlocked';
      break;
    }
    case 'merge_into': {
      const t = opts.target;
      if (!t || t.id === post.id) bad('targetPostId');
      if (!isCommunityVisible(t!.status as AdvisoryStatus) || t!.mergedIntoPostId) fail('merge_target_not_visible', 409, { targetPostId: t!.id });
      if (wasVisible) { setStatus(step(post, 'remove', cur.verificationLabel)); Object.assign(plan, { event: 'remove', domainEvent: 'COMMUNITY_ADVISORY_REMOVED', fanout: { kind: 'changed', change: 'merged' } }); }
      else if (REVIEW_STATES.has(post.status)) { setStatus(step(post, 'moderator_reject', cur.verificationLabel)); Object.assign(plan, { event: 'moderator_reject', domainEvent: 'COMMUNITY_ADVISORY_RETURNED' }); }
      else fail('illegal_transition', 409, { status: post.status, action: req.action });
      cur.mergedIntoPostId = t!.id; cur.removedReason = req.messageToTenant ?? req.reason;
      Object.assign(plan, { caseOutcome: 'resolved', notifyTenant: true, relate: { targetPostId: t!.id, relation: 'merged_into' }, change: 'merged' });
      break;
    }
    case 'link_related': {
      const t = opts.target;
      if (!t || t.id === post.id) bad('targetPostId');
      plan.relate = { targetPostId: t!.id, relation: 'related' }; plan.change = 'related_linked';
      break;
    }
    case 'mark_resolved':
      setStatus(step(post, 'resolve', cur.verificationLabel));
      cur.resolvedAt = opts.now; cur.resolutionNote = req.messageToTenant ?? null;   // shown to every salon: never the internal reason
      Object.assign(plan, { event: 'resolve', fanout: { kind: 'changed', change: 'resolved' }, caseOutcome: 'resolved', change: 'resolved' });
      break;
  }
  if (cur.status.startsWith('published_') && cur.visibility !== 'community_published') throw new Error('invariant: published state must be community_published');
  return plan;
}

const signalsOf = (p: PostRow): ModPostView['signals'] => {
  const s = moderationSignals([p.title, p.redactedBody, p.recommendation ?? '', p.officialReference ?? ''].join('\n'));
  const flags = [...s.personalInfoDetected, ...(s.paymentDataDetected ? ['payment_data'] : []), ...(s.accusatoryLanguage ? ['accusatory_language'] : [])];
  return { flags, score: flags.length, notes: s.advisory };
};
export function toModPostView(r: ModPostRow, withSignals = false): ModPostView {
  return {
    id: r.id, title: r.title, body: r.redactedBody, category: r.category as ModPostView['category'], severity: r.severity as CommunitySeverity,
    status: r.status as ModPostView['status'], verificationLabel: r.verificationLabel as ModPostView['verificationLabel'], visibility: r.visibility,
    region: r.region, incidentDate: r.incidentDate ?? null, scamMethod: r.scamMethod ?? null, channels: (r.channels ?? []) as ModPostView['channels'],
    recommendation: r.recommendation ?? null, tags: r.tags ?? [], paymentProcessor: r.paymentProcessor ?? null, amountRange: (r.amountRange ?? null) as ModPostView['amountRange'],
    officialReference: r.officialReference ?? null, authorDisplay: (r.authorDisplay ?? 'display_name') as ModPostView['authorDisplay'], authorLabel: r.authorLabel ?? null,
    originTenantId: r.originTenantId, originTenantName: r.originTenantName, originBranchName: r.originBranchName, createdByName: r.createdByName,
    privacyScanFlags: r.privacyScanFlags ?? [], moderationRequired: r.moderationRequired, commentsLocked: !!r.commentsLocked, removedReason: r.removedReason ?? null,
    counts: { comments: r.commentCount ?? 0, reports: r.reportCount ?? 0, openReports: r.openReports, similar: r.similarCount ?? 0, disputes: r.disputeCount, evidence: r.evidenceCount },
    signals: withSignals ? signalsOf(r) : null,
    version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt ?? r.createdAt, publishedAt: r.publishedAt ?? null,
  };
}
const caseView = (c: CaseRow): ModCaseView => ({
  id: c.id, kind: c.kind as ModCaseKind, status: c.status as ModCaseStatus, priority: c.priority as ModPriority, reason: c.reason,
  postId: c.postId, postTitle: c.postTitle, commentId: c.commentId, incidentId: c.incidentId, targetTenantId: c.targetTenantId, targetTenantName: c.targetTenantName,
  openedByName: c.openedByName, assignedToUserId: c.assignedToUserId, assignedToName: c.assignedToName, resolutionNote: c.resolutionNote,
  createdAt: c.createdAt, updatedAt: c.updatedAt, closedAt: c.closedAt,
});
const restrictionView = (r: RestrictionRow): ModRestrictionView => ({ id: r.id, tenantId: r.tenantId, tenantName: r.tenantName, userId: r.userId, kind: r.kind, reason: r.reason, expiresAt: r.expiresAt, createdAt: r.createdAt, liftedAt: r.liftedAt });
const commentView = (c: CommentRowM): ModCommentView => ({ id: c.id, postId: c.postId, parentId: c.parentId, body: c.body, tenantName: c.tenantName, authorLabel: c.authorLabel, removed: c.visibility === 'removed', removedReason: c.removedReason, reportCount: c.reportCount, createdAt: c.createdAt });

/** COMMUNITY_RESTRICTIONS — read by the core (posting / suspension) and interactions (commenting). Its own provider (only
 *  the repository) so the core, which needs it, and this service, which needs the core, never form a DI cycle. */
export class CommunityRestrictions implements CommunityRestrictionsPort {
  constructor(private readonly repo: Pick<CommunityModerationRepo, 'activeKinds'>) {}
  async active(tenantId: string, userId: string | null): Promise<CommunityRestrictionState> {
    const kinds = new Set(await this.repo.activeKinds(tenantId, userId));
    return { suspended: kinds.has('suspended'), postingRestricted: kinds.has('posting_restricted'), commentingRestricted: kinds.has('commenting_restricted') };
  }
}

// ── the service ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class CommunityModerationService {
  constructor(
    private readonly repo: CommunityModerationRepo,
    private readonly events: CommunityEventsPort,
    private readonly fanout: CommunityFanoutPort | null = null,
    private readonly evidencePort: CommunityEvidenceModerationPort | null = null,
    private readonly core: CommunityCorePort | null = null,
    private readonly notifier: CommunityTenantNotifier | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private me(actor: ModActor | null | undefined): string {
    if (!actor || !isUuid(actor.userId)) fail('moderator_identity_required', 403);   // bug 2: never act as "undefined"
    return actor!.userId;
  }

  private async emit(trx: Exec, tenantId: string, type: keyof typeof MOD_EVENTS, actor: string, aggregate: { type: Parameters<CommunityEventsPort['emit']>[2]['type']; id: string; version?: number | null }, payload: Record<string, unknown>) {
    await this.events.emit({ tenantId, branchId: null, userId: actor }, MOD_EVENTS[type], aggregate, payload, trx);
  }

  /** bug 3: a REAL case for every write. Given → must exist, be open, and match the target; absent → open / reuse. */
  private async caseFor(trx: Exec, actor: string, t: { caseId: string | null; kind: ModCaseKind; postId: string | null; commentId?: string | null; incidentId?: string | null; targetTenantId: string; reason: string; priority?: ModPriority }): Promise<CaseRow> {
    if (t.caseId) {
      const c = await this.repo.lockCase(trx, t.caseId);
      if (!c) return fail('case_not_found', 404, { caseId: t.caseId });
      if (c.status !== 'open' && c.status !== 'investigating') fail('case_closed', 409, { caseId: c.id, status: c.status });
      if ((c.postId && t.postId && c.postId !== t.postId) || (c.targetTenantId && c.targetTenantId !== t.targetTenantId)) fail('case_mismatch', 409, { caseId: c.id });
      return c;
    }
    const existing = t.postId ? await this.repo.openCaseForPost(trx, t.postId, t.kind) : await this.repo.openCaseForTenant(trx, t.targetTenantId, t.kind);
    if (existing) return existing;
    const { row, created } = await this.repo.insertCase(trx, { kind: t.kind, reason: t.reason, priority: t.priority ?? 'normal', postId: t.postId, commentId: t.commentId ?? null, incidentId: t.incidentId ?? null, targetTenantId: t.targetTenantId, openedBy: actor });
    if (created) await this.emit(trx, t.targetTenantId, 'COMMUNITY_MODERATION_CASE_OPENED', actor, { type: 'community_case', id: row.id }, { caseId: row.id, kind: row.kind, postId: row.postId, priority: row.priority });
    return row;
  }

  /** The action row + audit + COMMUNITY_MODERATION_ACTION_TAKEN — the trail every write leaves, inside its transaction. */
  private async record(trx: Exec, actor: string, a: { caseId: string; action: string; postId: string | null; commentId: string | null; targetTenantId: string; reason: string; detail: Record<string, unknown>; entityType: string; entityId: string | null }) {
    const id = await this.repo.insertAction(trx, { caseId: a.caseId, action: a.action, actor, postId: a.postId, commentId: a.commentId, targetTenantId: a.targetTenantId, reason: a.reason,
      detail: { ...a.detail, ...(a.postId ? { postId: a.postId } : {}) } });   // detail.postId kept for older readers (lastModeratorFor)
    await this.repo.audit(trx, { tenantId: a.targetTenantId, userId: actor, action: `community.moderation.${a.action}`, entityType: a.entityType, entityId: a.entityId, meta: { caseId: a.caseId, actionId: id, reason: a.reason, ...a.detail } });
    await this.emit(trx, a.targetTenantId, 'COMMUNITY_MODERATION_ACTION_TAKEN', actor, { type: 'community_case', id: a.caseId }, { caseId: a.caseId, action: a.action, postId: a.postId, commentId: a.commentId });
    return id;
  }

  private async labelFor(p: PostRow): Promise<string> {
    const display = (p.authorDisplay ?? 'display_name') as 'tenant_name' | 'display_name' | 'anonymous';
    if (this.core) return this.core.authorLabelFor(p.originTenantId, display, p.region);
    const parts = await this.repo.authorLabelParts(p.originTenantId);       // no core wired (unit harness): same rule
    if (display === 'anonymous') return p.region ? `A salon in ${p.region}` : 'A salon';
    if (display === 'display_name') return parts.displayName || parts.tenantName || 'A salon';
    return parts.tenantName || 'A salon';
  }

  private async afterCommit(post: PostRow | null, fan: PostPlan['fanout'], notice: { tenantId: string; subject: string; body: string } | null): Promise<void> {
    if (post && fan && this.fanout) {
      try { if (fan.kind === 'published') await this.fanout.advisoryPublished(post); else await this.fanout.advisoryChanged(post, fan.change); }
      catch { /* the port never throws by contract; publication stands even if an alert failed */ }
    }
    if (notice && this.notifier) { try { await this.notifier.notify(notice.tenantId, { subject: notice.subject, body: notice.body }); } catch { /* best-effort nudge; the message itself is on the post */ } }
  }

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async overview(actor: ModActor): Promise<ModOverview> {
    const r = await this.repo.overview(this.me(actor));
    const n = (k: string) => Number(r[k] ?? 0);
    const h = (k: string) => (r[k] == null ? null : Math.round(Number(r[k]) * 10) / 10);
    const queues: Record<ModQueue, number> = { review: n('q_review'), sensitive: n('q_sensitive'), reports: n('q_reports'), comment_reports: n('q_comment_reports'), disputes: n('q_disputes'),
      appeals: n('q_appeals'), evidence: n('q_evidence'), returned: n('q_returned'), published: n('q_published'), removed: n('q_removed') };
    return { queues, cases: { open: n('c_open'), investigating: n('c_investigating'), urgent: n('c_urgent'), assignedToMe: n('c_mine') },
      published7d: n('published7d'), removed7d: n('removed7d'), rejected7d: n('rejected7d'), restrictionsActive: n('restrictions_active'), tenantsEnabled: n('tenants_enabled'),
      avgHoursToDecision: h('avg_hours'), oldestWaitingHours: h('oldest_hours'), generatedAt: this.now().toISOString() };
  }
  async listPosts(q: any): Promise<ModPage<ModPostView>> {
    const p = paging(q ?? {});
    const queue = oneOf(q?.queue ?? 'review', QUEUES, 'queue');
    const term = optText(q?.q, 'q', 120);
    const res = await this.repo.listPosts({ queue, q: term, category: optOneOf(q?.category, COMMUNITY_CATEGORIES, 'category'), severity: optOneOf(q?.severity, SEVERITIES, 'severity'), limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map((r) => toModPostView(r)), res.total, p);
  }
  async postDetail(id: string): Promise<ModPostDetail> {
    const post = await this.repo.getPost(id);
    if (!post) return fail('post_not_found', 404);
    const d = await this.repo.postDetailParts(post!.id);
    return {
      post: toModPostView(post!, true),
      versions: d.versions.map((v: any) => ({ version: Number(v.version), title: v.title ?? null, body: v.redacted_body ?? null, status: v.status ?? null, editedBy: v.edited_by_name ?? null, changeNote: v.change_note ?? null, createdAt: v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at) })),
      reports: d.reports.map(reportView), disputes: d.disputes.map(disputeView), evidence: d.evidence.map(evidenceView), cases: d.cases.map(caseView),
      related: d.related.map((x: any) => ({ id: String(x.id), title: x.title, relation: x.relation, score: x.score == null ? null : Number(x.score) })),
      redactions: d.redactions.map((x: any) => ({ field: x.field, reason: x.reason, by: x.by_name ?? null, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at) })),
    };
  }
  async postComments(id: string): Promise<ModCommentView[]> {
    if (!(await this.repo.getPost(id))) fail('post_not_found', 404);
    return (await this.repo.listComments(id)).map(commentView);
  }

  // ── post actions ──────────────────────────────────────────────────────────────────────────────────────────────────
  async postAction(actor: ModActor, postId: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor);
    const req = validatePostAction(body as any);
    const now = this.now().toISOString();
    let after: PostRow | null = null; let plan: PostPlan | null = null; let caseId = '';
    await this.repo.tx(async (trx) => {
      const post = await this.repo.lockPost(trx, postId);
      if (!post) return fail('post_not_found', 404);
      if (post.version !== req.expectedVersion) fail('version_conflict', 409, { currentVersion: post.version });
      const target = req.targetPostId ? await this.repo.lockPost(trx, req.targetPostId) : null;
      if (req.targetPostId && !target) bad('targetPostId', { reason: 'not_found' });
      const needsLabel = req.action === 'publish' || req.action === 'restore' || (req.action === 'set_label' && post!.status.startsWith('published_'));
      plan = planPostAction(post!, req, { now, authorLabel: needsLabel ? await this.labelFor(post!) : null, target });
      const c = await this.caseFor(trx, me, { caseId: req.caseId, kind: post!.status === 'sensitive_data_detected' ? 'sensitive_data' : 'post_review', postId: post!.id,
        targetTenantId: post!.originTenantId, reason: req.reason, priority: priorityFor(post!.severity) });
      caseId = c.id;
      after = await this.repo.updatePost(trx, post!.id, req.expectedVersion, plan.next);
      if (!after) fail('version_conflict', 409);
      await this.repo.insertPostVersion(trx, after!, me, `moderator ${req.action}: ${req.reason}`, { action: req.action, caseId: c.id, from: post!.status, to: after!.status, label: after!.verificationLabel, severity: after!.severity });
      for (const r of plan.redacted) await this.repo.insertRedaction(trx, { postId: post!.id, commentId: null, evidenceId: null, field: r.field, reason: req.reason, caseId: c.id, by: me });
      if (plan.relate) {
        await this.repo.linkPosts(trx, post!.id, plan.relate.targetPostId, plan.relate.relation, me);
        if (plan.relate.relation === 'related') await this.repo.linkPosts(trx, plan.relate.targetPostId, post!.id, 'related', me);
      }
      await this.record(trx, me, { caseId: c.id, action: req.action, postId: post!.id, commentId: null, targetTenantId: post!.originTenantId, reason: req.reason, entityType: 'community_post', entityId: post!.id,
        detail: { from: post!.status, to: after!.status, version: after!.version, ...(req.messageToTenant ? { messageToTenant: req.messageToTenant } : {}),
          ...(req.label ? { label: req.label } : {}), ...(req.severity ? { severity: req.severity } : {}), ...(req.targetPostId ? { targetPostId: req.targetPostId } : {}),
          ...(plan.redacted.length ? { redactedFields: plan.redacted.map((x) => x.field), scanFlags: plan.scanFlags } : {}) } });
      await this.emit(trx, post!.originTenantId, plan.domainEvent, me, { type: 'community_post', id: post!.id, version: after!.version },
        { postId: post!.id, status: after!.status, change: plan.change, severity: after!.severity, category: after!.category });
      if (plan.caseOutcome) await this.repo.updateCase(trx, c.id, { status: plan.caseOutcome, priority: c.priority, assignedTo: c.assignedToUserId ?? me, resolutionNote: plan.caseOutcome === 'resolved' ? req.reason : c.resolutionNote });
    });
    const p = after as unknown as PostRow; const pl = plan as unknown as PostPlan;
    const verb = req.action === 'reject' ? 'declined' : req.action === 'request_evidence' ? 'asked for evidence on' : req.action === 'request_changes' ? 'asked for changes to' : req.action === 'remove' ? 'removed' : 'merged';
    await this.afterCommit(p, pl.fanout, pl.notifyTenant ? { tenantId: p.originTenantId, subject: 'Safety Community: a moderator needs your attention',
      body: `AI PowerSalon moderation ${verb} your safety advisory "${p.title}". Sign in and open Safety Community → My posts to read the moderator's note.` } : null);
    const view = await this.repo.getPost(p.id);
    return { ok: true, caseId, post: view ? toModPostView(view) : undefined };
  }

  // ── comments ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async commentAction(actor: ModActor, commentId: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor);
    const b: any = body ?? {};
    const action = oneOf(b.action, ['remove', 'restore', 'redact'] as const, 'action');
    const reason = reasonOf(b.reason);
    const caseId0 = optUuid(b.caseId, 'caseId');
    let caseId = '';
    await this.repo.tx(async (trx) => {
      const c = await this.repo.lockComment(trx, commentId);
      if (!c) return fail('comment_not_found', 404);
      const kase = await this.caseFor(trx, me, { caseId: caseId0, kind: 'comment', postId: c!.postId, commentId: c!.id, targetTenantId: c!.tenantId, reason });
      caseId = kase.id;
      const detail: Record<string, unknown> = {};
      if (action === 'remove') {
        if (c!.visibility === 'removed') fail('illegal_transition', 409, { status: 'removed', action });
        await this.repo.setCommentVisibility(trx, c!, false, reason, me);
        await this.emit(trx, c!.tenantId, 'COMMUNITY_COMMENT_REMOVED', me, { type: 'community_comment', id: c!.id }, { postId: c!.postId, commentId: c!.id });
      } else if (action === 'restore') {
        if (c!.visibility !== 'removed') fail('illegal_transition', 409, { status: c!.visibility, action });
        await this.repo.setCommentVisibility(trx, c!, true, null, me);
      } else {
        const find = typeof b.find === 'string' ? b.find : '';
        if (!find || find.length > 500) bad('find');
        if (!c!.body.includes(find)) bad('find', { reason: 'not_found' });
        const replaced = c!.body.split(find).join(b.replaceWith == null ? '[REDACTED]' : String(b.replaceWith).slice(0, 100));
        const s = scanCommunityText(replaced);
        detail.version = await this.repo.redactComment(trx, c!, s.redactedText, s.categories, me);
        detail.scanFlags = s.categories;
        await this.repo.insertRedaction(trx, { postId: c!.postId, commentId: c!.id, evidenceId: null, field: 'comment', reason, caseId: kase.id, by: me });
      }
      await this.record(trx, me, { caseId: kase.id, action: `comment_${action}`, postId: c!.postId, commentId: c!.id, targetTenantId: c!.tenantId, reason, detail, entityType: 'community_comment', entityId: c!.id });
    });
    const after = await this.repo.getComment(commentId);
    return { ok: true, caseId, comment: after ? commentView(after) : undefined };
  }

  // ── cases ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async listCases(actor: ModActor, q: any): Promise<ModPage<ModCaseView>> {
    const me = this.me(actor); const p = paging(q ?? {});
    const mine = q?.mine === true || q?.mine === 'true' || q?.mine === '1';
    const res = await this.repo.listCases({ status: optOneOf(q?.status, CASE_STATUSES, 'status'), kind: optOneOf(q?.kind, CASE_KINDS, 'kind'), assignedTo: mine ? me : null, limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map(caseView), res.total, p);
  }
  async openCase(actor: ModActor, body: unknown): Promise<ModCaseView> {
    const me = this.me(actor); const b: any = body ?? {};
    const kind = oneOf(b.kind, CASE_KINDS, 'kind'); const reason = reasonOf(b.reason);
    const priority = optOneOf(b.priority, PRIORITIES, 'priority') ?? 'normal';
    const postId = optUuid(b.postId, 'postId'); const commentId = optUuid(b.commentId, 'commentId'); const incidentId = optUuid(b.incidentId, 'incidentId');
    let target = optUuid(b.targetTenantId, 'targetTenantId');
    let caseId = '';
    await this.repo.tx(async (trx) => {
      let pid = postId;
      if (commentId) { const c = await this.repo.getComment(commentId, trx); if (!c) return fail('comment_not_found', 404); pid = pid ?? c!.postId; target = target ?? c!.tenantId; }
      if (pid) { const p = await this.repo.getPost(pid, trx); if (!p) return fail('post_not_found', 404); if (target && target !== p!.originTenantId && !commentId) fail('case_mismatch', 409); target = target ?? p!.originTenantId; }
      if (incidentId) { const i = await this.repo.getIncident(incidentId); if (!i) return fail('incident_not_found', 404); if (target && target !== i!.tenantId) fail('case_mismatch', 409); target = i!.tenantId; }
      if (!target) return bad('targetTenantId', { reason: 'a case needs a post, comment, incident or salon' });
      if (!(await this.repo.tenantExists(target!, trx))) fail('tenant_not_found', 404);
      // an explicit open always creates for non-post kinds; for a post the unique index hands back the open one
      const { row, created } = await this.repo.insertCase(trx, { kind, reason, priority, postId: pid, commentId, incidentId, targetTenantId: target!, openedBy: me });
      caseId = row.id;
      if (created) {
        await this.emit(trx, target!, 'COMMUNITY_MODERATION_CASE_OPENED', me, { type: 'community_case', id: row.id }, { caseId: row.id, kind, postId: pid, priority });
        await this.repo.audit(trx, { tenantId: target!, userId: me, action: 'community.moderation.case_opened', entityType: 'community_case', entityId: row.id, meta: { kind, reason, postId: pid, incidentId } });
      }
    });
    return caseView((await this.repo.getCase(caseId))!);
  }
  async caseDetail(id: string): Promise<ModCaseDetail> {
    const c = await this.repo.getCase(id);
    if (!c) return fail('case_not_found', 404);
    const actions = await this.repo.listActions({ caseId: c!.id, postId: null, limit: 200, offset: 0 });
    const post = c!.postId ? await this.repo.getPost(c!.postId) : null;
    return { case: caseView(c!), actions: actions.rows.map(actionView), post: post ? toModPostView(post) : null };
  }
  async updateCase(actor: ModActor, id: string, body: unknown): Promise<ModCaseView> {
    const me = this.me(actor); const b: Partial<ModCaseUpdate> = (body ?? {});
    const status = optOneOf(b.status, CASE_STATUSES, 'status'); const priority = optOneOf(b.priority, PRIORITIES, 'priority');
    const note = b.resolutionNote === undefined ? undefined : optText(b.resolutionNote, 'resolutionNote');
    if (!b.assignToMe && !status && !priority && note === undefined) bad('body', { reason: 'nothing_to_change' });
    if ((status === 'resolved' || status === 'closed') && (!note || note.length < MIN_REASON)) bad('resolutionNote', { minLength: MIN_REASON });
    await this.repo.tx(async (trx) => {
      const c = await this.repo.lockCase(trx, id);
      if (!c) return fail('case_not_found', 404);
      try {
        await this.repo.updateCase(trx, c!.id, { status: status ?? c!.status, priority: priority ?? c!.priority, assignedTo: b.assignToMe ? me : c!.assignedToUserId, resolutionNote: note === undefined ? c!.resolutionNote : note });
      } catch (e: any) {
        if (String(e?.code) === '23505' || /uq_cmc_open_post_kind/.test(String(e?.message))) fail('case_already_open', 409, { postId: c!.postId, kind: c!.kind });
        throw e;
      }
      const target = c!.targetTenantId;
      if (target) await this.record(trx, me, { caseId: c!.id, action: 'case_updated', postId: c!.postId, commentId: c!.commentId, targetTenantId: target, reason: note ?? `case ${status ?? 'updated'}`,
        entityType: 'community_case', entityId: c!.id, detail: { from: c!.status, to: status ?? c!.status, priority: priority ?? c!.priority, assignedToMe: !!b.assignToMe } });
    });
    return caseView((await this.repo.getCase(id))!);
  }
  async listActions(q: any): Promise<ModPage<ModActionView>> {
    const p = paging(q ?? {});
    const res = await this.repo.listActions({ caseId: optUuid(q?.caseId, 'caseId'), postId: optUuid(q?.postId, 'postId'), limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map(actionView), res.total, p);
  }

  // ── reports ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async listReports(q: any): Promise<ModPage<ModReportView>> {
    const p = paging(q ?? {});
    const kind = optOneOf(q?.kind, ['post', 'comment'] as const, 'kind') ?? 'post';
    const status = q?.status === 'all' ? null : optOneOf(q?.status, ['open', 'reviewing', 'actioned', 'dismissed'] as const, 'status') ?? 'open';
    const res = await this.repo.listReports({ kind, status, limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map(reportView), res.total, p);
  }
  async resolveReport(actor: ModActor, id: string, kindQ: unknown, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor); const b: any = body ?? {};
    const kind = optOneOf(kindQ, ['post', 'comment'] as const, 'kind') ?? 'post';
    const resolution = oneOf(b.resolution, ['actioned', 'dismissed'] as const, 'resolution'); const reason = reasonOf(b.reason);
    const caseId0 = optUuid(b.caseId, 'caseId');
    let caseId = '';
    await this.repo.tx(async (trx) => {
      const r = await this.repo.lockReport(trx, kind, id);
      if (!r) return fail('report_not_found', 404);
      if (r!.status !== 'open' && r!.status !== 'reviewing') fail('already_resolved', 409, { status: r!.status });
      const post = await this.repo.getPost(r!.postId, trx);
      if (!post) return fail('post_not_found', 404);
      const comment = r!.commentId ? await this.repo.getComment(r!.commentId, trx) : null;
      const target = comment ? comment.tenantId : post!.originTenantId;
      const kase = await this.caseFor(trx, me, { caseId: caseId0, kind: kind === 'comment' ? 'comment' : 'report', postId: post!.id, commentId: r!.commentId, targetTenantId: target, reason });
      caseId = kase.id;
      await this.repo.resolveReport(trx, kind, r!.id, resolution, kase.id, me, reason);
      await this.record(trx, me, { caseId: kase.id, action: `report_${resolution}`, postId: post!.id, commentId: r!.commentId, targetTenantId: target, reason, entityType: kind === 'comment' ? 'community_comment' : 'community_post', entityId: r!.commentId ?? post!.id, detail: { reportId: r!.id, kind } });
      if (!caseId0 && kase.kind === 'report') {
        const left = await this.repo.listReports({ kind: 'post', status: 'open', postId: post!.id, limit: 1, offset: 0 });
        if (!left.total) await this.repo.updateCase(trx, kase.id, { status: 'resolved', priority: kase.priority, assignedTo: kase.assignedToUserId ?? me, resolutionNote: reason });
      }
    });
    return { ok: true, caseId };
  }

  // ── disputes ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async listDisputes(q: any): Promise<ModPage<ModDisputeView>> {
    const p = paging(q ?? {});
    const status = q?.status === 'all' ? null : optOneOf(q?.status, ['open', 'under_review', 'upheld', 'overturned', 'withdrawn'] as const, 'status') ?? 'open';
    const res = await this.repo.listDisputes({ status, limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map(disputeView), res.total, p);
  }
  /** upheld → the post stands (disputed → its published state); corrected → disputed → corrected; overturned → removed. */
  async decideDispute(actor: ModActor, id: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor); const b: any = body ?? {};
    const decision = oneOf(b.decision, ['upheld', 'corrected', 'overturned'] as const, 'decision'); const note = reasonOf(b.note, 'note');
    const caseId0 = optUuid(b.caseId, 'caseId');
    let caseId = ''; let after: PostRow | null = null; let fan: PostPlan['fanout'] = null;
    await this.repo.tx(async (trx) => {
      const d = await this.repo.lockDispute(trx, id);
      if (!d) return fail('dispute_not_found', 404);
      if (d!.status !== 'open' && d!.status !== 'under_review') fail('already_decided', 409, { status: d!.status });
      const post = await this.repo.lockPost(trx, d!.postId);
      if (!post) return fail('post_not_found', 404);
      const kase = await this.caseFor(trx, me, { caseId: caseId0, kind: 'dispute', postId: post!.id, targetTenantId: post!.originTenantId, reason: note });
      caseId = kase.id;
      let event: WorkflowEvent | null = null; let next: string = post!.status; let change: FanoutChange | null = null;
      if (decision === 'upheld') { if (post!.status === 'disputed') { step(post!, 'dispute_upheld', post!.verificationLabel); event = 'dispute_upheld'; next = publishedStateFor(post!.verificationLabel); change = 'restored'; } }
      else if (decision === 'corrected') { next = step(post!, 'correct', post!.verificationLabel); event = 'correct'; change = 'corrected'; }
      else if (isCommunityVisible(post!.status as AdvisoryStatus)) { next = step(post!, 'remove', post!.verificationLabel); event = 'remove'; change = 'removed'; }
      if (event) {
        const w: PostWrite = { status: next, visibility: visibilityFor(next), verificationLabel: post!.verificationLabel, severity: post!.severity, title: post!.title, redactedBody: post!.redactedBody,
          recommendation: post!.recommendation ?? null, officialReference: post!.officialReference ?? null, privacyScanFlags: post!.privacyScanFlags ?? [], commentsLocked: !!post!.commentsLocked,
          removedReason: event === 'remove' ? note : post!.removedReason ?? null, mergedIntoPostId: post!.mergedIntoPostId ?? null, authorLabel: post!.authorLabel ?? null,
          publishedAt: post!.publishedAt ?? null, resolvedAt: post!.resolvedAt ?? null, resolutionNote: post!.resolutionNote ?? null };
        after = await this.repo.updatePost(trx, post!.id, post!.version, w);
        if (!after) fail('version_conflict', 409);
        await this.repo.insertPostVersion(trx, after!, me, `dispute ${decision}: ${note}`, { action: `dispute_${decision}`, caseId: kase.id, disputeId: d!.id, from: post!.status, to: next });
        await this.emit(trx, post!.originTenantId, event === 'remove' ? 'COMMUNITY_ADVISORY_REMOVED' : 'COMMUNITY_ADVISORY_UPDATED', me, { type: 'community_post', id: post!.id, version: after!.version }, { postId: post!.id, status: next, change: `dispute_${decision}` });
        fan = { kind: 'changed', change: change === 'restored' ? 'restored' : change! };
      }
      await this.repo.decideDispute(trx, d!.id, decision === 'overturned' ? 'overturned' : 'upheld', decision === 'corrected' ? `[corrected] ${note}` : note, kase.id, me);
      await this.record(trx, me, { caseId: kase.id, action: `dispute_${decision}`, postId: post!.id, commentId: null, targetTenantId: post!.originTenantId, reason: note, entityType: 'community_post', entityId: post!.id, detail: { disputeId: d!.id, from: post!.status, to: next } });
      await this.repo.updateCase(trx, kase.id, { status: 'resolved', priority: kase.priority, assignedTo: kase.assignedToUserId ?? me, resolutionNote: note });
    });
    await this.afterCommit(after, fan, null);
    const view = after ? await this.repo.getPost((after as PostRow).id) : null;
    return { ok: true, caseId, post: view ? toModPostView(view) : undefined };
  }

  // ── appeals ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async listAppeals(actor: ModActor, q: any): Promise<ModPage<ModAppealView>> {
    const me = this.me(actor); const p = paging(q ?? {});
    const status = q?.status === 'all' ? null : optOneOf(q?.status, ['submitted', 'under_review', 'upheld', 'overturned', 'withdrawn'] as const, 'status') ?? 'submitted';
    const res = await this.repo.listAppeals({ status, limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map((a) => ({ id: a.id, postId: a.postId, commentId: a.commentId, appellantTenantName: a.appellantTenantName, subject: a.subject, reason: a.reason, status: a.status,
      originalDecision: a.originalDecision, originalDeciderIsMe: a.originalDeciderUserId === me, decisionNote: a.decisionNote, caseId: a.caseId, createdAt: a.createdAt })), res.total, p);
  }
  async decideAppeal(actor: ModActor, id: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor); const b: any = body ?? {};
    const decision = oneOf(b.decision, ['uphold', 'overturn'] as const, 'decision'); const note = reasonOf(b.note, 'note');
    const caseId0 = optUuid(b.caseId, 'caseId'); const allowSame = b.allowSameDecider === true;
    let caseId = ''; let after: PostRow | null = null; let fan: PostPlan['fanout'] = null; let comment: CommentRowM | null = null;
    // the author label is resolved before the transaction (the core reads on its own connection)
    const pre = await this.repo.getAppeal(id);
    const preLabel = pre?.postId && pre.subject === 'post_removed' ? await this.repo.getPost(pre.postId).then((p) => (p ? this.labelFor(p) : null)) : null;
    await this.repo.tx(async (trx) => {
      const a = await this.repo.lockAppeal(trx, id);
      if (!a) return fail('appeal_not_found', 404);
      const gate = canReviewAppeal({ userId: me, role: 'moderator' }, { id: a!.id, appellantTenantId: a!.appellantTenantId, subject: a!.subject as AppealSubject, status: a!.status as any, originalDeciderUserId: a!.originalDeciderUserId }, allowSame);
      if (!gate.ok) fail(gate.reason === 'original_decider_cannot_review' ? 'appeal_same_decider' : 'already_decided', gate.reason === 'original_decider_cannot_review' ? 403 : 409, { reason: gate.reason });
      const post = a!.postId ? await this.repo.lockPost(trx, a!.postId) : null;
      const kase = await this.caseFor(trx, me, { caseId: caseId0, kind: 'appeal', postId: post?.id ?? null, commentId: a!.commentId, targetTenantId: a!.appellantTenantId, reason: note });
      caseId = kase.id;
      const status = decision === 'overturn' ? 'overturned' : 'upheld';
      if (!(await this.repo.decideAppeal(trx, a!.id, status, me, note, kase.id))) fail('already_decided', 409);
      const effect: Record<string, unknown> = {};
      if (decision === 'overturn') {
        if (post && a!.subject === 'post_removed' && post.status === 'removed') {
          step(post, 'restore', post.verificationLabel);
          const next = publishedStateFor(post.verificationLabel);
          after = await this.repo.updatePost(trx, post.id, post.version, { ...writeOf(post), status: next, visibility: visibilityFor(next), removedReason: null, mergedIntoPostId: null, authorLabel: preLabel ?? post.authorLabel ?? null, publishedAt: post.publishedAt ?? this.now().toISOString() });
          effect.post = next; fan = { kind: 'published' };
        } else if (post && a!.subject === 'post_rejected' && post.status === 'rejected') {
          // the workflow has no rejected:* event — an overturned rejection goes back to the review queue (never straight to
          // published: winning an appeal never skips moderation; community-appeals.restoredStatusOnOverturn's rule)
          after = await this.repo.updatePost(trx, post.id, post.version, { ...writeOf(post), status: 'moderation_review', visibility: 'draft' });
          effect.post = 'moderation_review';
        } else if (a!.subject === 'comment_removed' && a!.commentId) {
          const c = await this.repo.lockComment(trx, a!.commentId);
          if (c && c.visibility === 'removed' && c.tenantId === a!.appellantTenantId) { await this.repo.setCommentVisibility(trx, c, true, null, me); comment = c; effect.comment = 'restored'; }
        } else if (a!.subject === 'community_suspended') {
          effect.liftedSuspensions = await this.repo.liftAll(trx, a!.appellantTenantId, 'suspended', me);
          await this.emit(trx, a!.appellantTenantId, 'COMMUNITY_TENANT_RESTRICTED', me, { type: 'community_restriction', id: kase.id }, { kind: 'suspended', active: false });
        }
        if (after) {
          const ap = after as PostRow;
          await this.repo.insertPostVersion(trx, ap, me, `appeal overturned: ${note}`, { action: 'appeal_overturn', caseId: kase.id, appealId: a!.id, from: post!.status, to: ap.status });
          await this.emit(trx, ap.originTenantId, ap.status.startsWith('published_') ? 'COMMUNITY_ADVISORY_PUBLISHED' : 'COMMUNITY_ADVISORY_UPDATED', me, { type: 'community_post', id: ap.id, version: ap.version }, { postId: ap.id, status: ap.status, change: 'appeal_overturned' });
        }
      }
      await this.record(trx, me, { caseId: kase.id, action: `appeal_${status}`, postId: post?.id ?? null, commentId: a!.commentId, targetTenantId: a!.appellantTenantId, reason: note, entityType: 'community_appeal', entityId: a!.id,
        detail: { appealId: a!.id, subject: a!.subject, sameDeciderOverride: allowSame && a!.originalDeciderUserId === me, ...effect } });
      await this.repo.updateCase(trx, kase.id, { status: 'resolved', priority: kase.priority, assignedTo: kase.assignedToUserId ?? me, resolutionNote: note });
    });
    await this.afterCommit(after, fan, null);
    const view = after ? await this.repo.getPost((after as PostRow).id) : null;
    const cm = comment ? await this.repo.getComment((comment as CommentRowM).id) : null;
    return { ok: true, caseId, post: view ? toModPostView(view) : undefined, comment: cm ? commentView(cm) : undefined };
  }

  // ── evidence (through agent C's port) ─────────────────────────────────────────────────────────────────────────────
  async listEvidence(q: any): Promise<ModPage<ModEvidenceView>> {
    const p = paging(q ?? {});
    const status = optOneOf(q?.status, ['all', 'needs_review', 'unscanned', 'clean', 'infected', 'error', 'pending', 'redacted'] as const, 'status');
    const res = await this.repo.listEvidence({ status, limit: p.limit, offset: p.offset });
    return pageOf(res.rows.map(evidenceView), res.total, p);
  }
  private port(): CommunityEvidenceModerationPort {
    if (!this.evidencePort) fail('evidence_storage_not_configured', 503);
    return this.evidencePort!;
  }
  private async viaPort<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e: any) {
      if (e && typeof e.code === 'string' && typeof e.status === 'number') throw new CommunityModerationError(e.code, e.status, e.extra);
      return fail('evidence_moderation_unavailable', 503);
    }
  }
  async evidenceAccess(actor: ModActor, id: string, q: any): Promise<CommunityEvidenceAccess> {
    const me = this.me(actor);
    const caseId = optUuid(q?.caseId, 'caseId'); if (!caseId) bad('caseId');
    const reason = reasonOf(q?.reason);
    const ev = await this.repo.getEvidence(id);
    if (!ev) return fail('evidence_not_found', 404);
    const port = this.port();
    await this.repo.tx(async (trx) => { await this.caseFor(trx, me, { caseId, kind: 'evidence', postId: ev!.postId, targetTenantId: ev!.tenantId, reason }); });
    const out = await this.viaPort(() => port.moderatorAccess({ evidenceId: ev!.id, caseId: caseId!, moderatorUserId: me, reason }));
    await this.repo.tx(async (trx) => {
      await this.record(trx, me, { caseId: caseId!, action: 'evidence_accessed', postId: ev!.postId, commentId: null, targetTenantId: ev!.tenantId, reason, entityType: 'community_evidence', entityId: ev!.id, detail: { evidenceId: ev!.id, expiresAt: out.expiresAt } });
    });
    return { url: out.url, expiresAt: out.expiresAt };
  }
  async evidenceReview(actor: ModActor, id: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor); const b: Partial<ModEvidenceReview> = (body ?? {});
    const decision = oneOf(b.decision, ['clean', 'redacted', 'reject'] as const, 'decision'); const reason = reasonOf(b.reason);
    const ev = await this.repo.getEvidence(id);
    if (!ev) return fail('evidence_not_found', 404);
    const port = this.port();
    let caseId = '';
    await this.repo.tx(async (trx) => { caseId = (await this.caseFor(trx, me, { caseId: optUuid(b.caseId, 'caseId'), kind: 'evidence', postId: ev!.postId, targetTenantId: ev!.tenantId, reason })).id; });
    const out = await this.viaPort(() => port.review({ evidenceId: ev!.id, caseId, moderatorUserId: me, decision, reason }));
    await this.repo.tx(async (trx) => {
      await this.record(trx, me, { caseId, action: `evidence_${decision}`, postId: ev!.postId, commentId: null, targetTenantId: ev!.tenantId, reason, entityType: 'community_evidence', entityId: ev!.id, detail: { evidenceId: ev!.id, ...out } });
    });
    return { ok: true, caseId };
  }

  // ── private incident (an incident_access case is the only key) ───────────────────────────────────────────────────
  async incidentAccess(actor: ModActor, id: string, body: unknown): Promise<{ ok: true; caseId: string; tenantName: string; incident: CommunityIncidentView }> {
    const me = this.me(actor); const b: Partial<ModIncidentAccessRequest> = (body ?? {});
    const caseId = optUuid(b.caseId, 'caseId'); if (!caseId) bad('caseId');
    const reason = reasonOf(b.reason);
    const inc = await this.repo.getIncident(id);
    if (!inc) return fail('incident_not_found', 404);
    await this.repo.tx(async (trx) => {
      const c = await this.repo.lockCase(trx, caseId!);
      if (!c) return fail('case_not_found', 404);
      if (c!.kind !== 'incident_access') fail('case_kind_mismatch', 409, { kind: c!.kind, required: 'incident_access' });
      if (c!.status !== 'open' && c!.status !== 'investigating') fail('case_closed', 409, { status: c!.status });
      if ((c!.incidentId && c!.incidentId !== inc!.id) || (c!.targetTenantId && c!.targetTenantId !== inc!.tenantId)) fail('case_mismatch', 409);
      await this.repo.updateCase(trx, c!.id, { status: 'investigating', priority: c!.priority, assignedTo: c!.assignedToUserId ?? me, resolutionNote: c!.resolutionNote, incidentId: inc!.id });
      // loud: the salon's own audit trail + an event the salon hears + the case trail
      await this.record(trx, me, { caseId: c!.id, action: 'incident_accessed', postId: null, commentId: null, targetTenantId: inc!.tenantId, reason, entityType: 'tenant_private_incident', entityId: inc!.id, detail: { incidentId: inc!.id, privateIncident: true } });
    });
    return { ok: true, caseId: caseId!, tenantName: inc!.tenantName, incident: { id: inc!.id, branchId: inc!.branchId, category: inc!.category as CommunityIncidentView['category'], severity: inc!.severity as CommunitySeverity, occurredOn: inc!.occurredOn, rawDetail: inc!.rawDetail, advisoryPostId: inc!.advisoryPostId, createdAt: inc!.createdAt } };
  }

  // ── salons + restrictions ─────────────────────────────────────────────────────────────────────────────────────────
  private async conduct(rows: Awaited<ReturnType<CommunityModerationRepo['tenantConduct']>>['rows']): Promise<ModTenantConduct[]> {
    const restr = rows.length ? await this.repo.listRestrictions({ tenantIds: rows.map((r) => r.tenantId), active: null }) : [];
    return rows.map((r) => ({ ...r, restrictions: restr.filter((x) => x.tenantId === r.tenantId).map(restrictionView) }));
  }
  async listTenants(q: any): Promise<ModPage<ModTenantConduct>> {
    const p = paging(q ?? {});
    const res = await this.repo.tenantConduct({ tenantId: null, q: optText(q?.q, 'q', 120), limit: p.limit, offset: p.offset });
    return pageOf(await this.conduct(res.rows), res.total, p);
  }
  async tenant(tenantId: string): Promise<ModTenantConduct> {
    if (!isUuid(tenantId)) fail('tenant_not_found', 404);
    const res = await this.repo.tenantConduct({ tenantId, q: null, limit: 1, offset: 0 });
    if (!res.rows.length) return fail('tenant_not_found', 404);
    return (await this.conduct(res.rows))[0];
  }
  async tenantAction(actor: ModActor, tenantId: string, body: unknown): Promise<ModActionResult> {
    const me = this.me(actor); const b: any = body ?? {};
    const action = oneOf(b.action, ['restrict_posting', 'restrict_commenting', 'suspend', 'lift', 'contact'] as const, 'action');
    const reason = reasonOf(b.reason);
    const userId = optUuid(b.userId, 'userId');
    const message = optText(b.message, 'message');
    if (action === 'contact' && (!message || message.length < MIN_REASON)) bad('message', { minLength: MIN_REASON });
    let expiresAt: string | null = null;
    if (b.expiresAt != null && b.expiresAt !== '') {
      const t = Date.parse(String(b.expiresAt));
      if (Number.isNaN(t) || t <= this.now().getTime()) bad('expiresAt', { reason: 'must be a future time' });
      expiresAt = new Date(t).toISOString();
    }
    const restrictionId = optUuid(b.restrictionId, 'restrictionId');
    if (action === 'lift' && !restrictionId) bad('restrictionId');
    let caseId = ''; let restriction: RestrictionRow | null = null;
    const salon = await this.repo.tenantExists(tenantId);
    if (!salon) return fail('tenant_not_found', 404);
    if (userId && !(await this.repo.userInTenant(userId, tenantId))) bad('userId', { reason: 'not a user of this salon' });
    await this.repo.tx(async (trx) => {
      const kase = await this.caseFor(trx, me, { caseId: optUuid(b.caseId, 'caseId'), kind: 'tenant_conduct', postId: null, targetTenantId: tenantId, reason });
      caseId = kase.id;
      const kind = action === 'restrict_posting' ? 'posting_restricted' : action === 'restrict_commenting' ? 'commenting_restricted' : action === 'suspend' ? 'suspended' : null;
      if (kind) {
        const dup = await this.repo.activeRestrictionOf(trx, tenantId, userId, kind);
        if (dup) fail('already_restricted', 409, { restrictionId: dup.id, kind });
        restriction = await this.repo.insertRestriction(trx, { tenantId, userId, kind, reason, caseId: kase.id, by: me, expiresAt });
        await this.emit(trx, tenantId, 'COMMUNITY_TENANT_RESTRICTED', me, { type: 'community_restriction', id: restriction.id }, { restrictionId: restriction.id, kind, active: true, scope: userId ? 'user' : 'salon' });
      } else if (action === 'lift') {
        restriction = await this.repo.liftRestriction(trx, tenantId, restrictionId!, me);
        if (!restriction) fail('restriction_not_found', 404);
        await this.emit(trx, tenantId, 'COMMUNITY_TENANT_RESTRICTED', me, { type: 'community_restriction', id: restriction!.id }, { restrictionId: restriction!.id, kind: restriction!.kind, active: false });
      }
      await this.record(trx, me, { caseId: kase.id, action: `tenant_${action}`, postId: null, commentId: null, targetTenantId: tenantId, reason, entityType: 'community_restriction', entityId: (restriction as RestrictionRow | null)?.id ?? null,
        detail: { ...(restriction ? { restrictionId: (restriction as RestrictionRow).id, kind: (restriction as RestrictionRow).kind } : {}), ...(userId ? { userId } : {}), ...(expiresAt ? { expiresAt } : {}), ...(message ? { messageToTenant: message } : {}) } });
    });
    const label = { restrict_posting: 'restricted posting for', restrict_commenting: 'restricted commenting for', suspend: 'suspended Safety Community access for', lift: 'lifted a restriction on', contact: 'sent a message to' }[action];
    await this.afterCommit(null, null, { tenantId, subject: 'Safety Community: a message from AI PowerSalon moderation',
      body: action === 'contact' ? `AI PowerSalon moderation: ${message}` : `AI PowerSalon moderation ${label} your salon. Reason: ${reason}` });
    const r = restriction as RestrictionRow | null;
    const fresh = r ? (await this.repo.listRestrictions({ tenantIds: [tenantId], active: null })).find((x) => x.id === r.id) ?? r : null;
    return { ok: true, caseId, restriction: fresh ? restrictionView(fresh) : undefined };
  }
  async listRestrictions(q: any): Promise<ModRestrictionView[]> {
    const active = q?.active == null || q?.active === '' ? true : q.active === true || q.active === 'true' ? true : q.active === 'false' || q.active === false ? false : bad('active');
    return (await this.repo.listRestrictions({ tenantIds: null, active: active as boolean })).map(restrictionView);
  }

  // ── analytics + platform settings ─────────────────────────────────────────────────────────────────────────────────
  async analytics(q: any): Promise<ModAnalytics> {
    const today = this.now();
    const to = q?.to == null || q?.to === '' ? utcDay(today) : (isDate(q.to) ? q.to : bad('to'));
    const from = q?.from == null || q?.from === '' ? utcDay(new Date(Date.parse(to + 'T00:00:00Z') - 29 * 86400_000)) : (isDate(q.from) ? q.from : bad('from'));
    if (from > to) bad('from', { reason: 'after to' });
    if (Date.parse(to) - Date.parse(from) > 366 * 86400_000) bad('from', { reason: 'range over a year' });
    const r = await this.repo.analytics(from as string, to as string);
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<CommunitySeverity, number>;
    for (const x of r.bySeverity ?? []) if (x.severity in bySeverity) bySeverity[x.severity as CommunitySeverity] = Number(x.n);
    const decided = Number(r.decided ?? 0);
    return { from: from as string, to: to as string, published: Number(r.published ?? 0), rejected: Number(r.rejected ?? 0), removed: Number(r.removed ?? 0),
      disputes: Number(r.disputes ?? 0), appeals: Number(r.appeals ?? 0), overturnRate: decided ? Math.round((Number(r.overturned ?? 0) / decided) * 1000) / 1000 : null,
      byCategory: (r.byCategory ?? []).map((x: any) => ({ category: x.category, count: Number(x.n) })), bySeverity,
      medianHoursToDecision: r.median_hours == null ? null : Math.round(Number(r.median_hours) * 10) / 10 };
  }
  async settings(): Promise<ModPlatformSettings> {
    const s = await this.repo.readSettings();
    return { riskMatchingEnabled: s.riskMatchingEnabled, rulesVersion: COMMUNITY_RULES_VERSION, autoHideReportThreshold: s.autoHideReportThreshold, version: s.version };
  }
  async updateSettings(actor: ModActor, body: unknown): Promise<ModPlatformSettings> {
    const me = this.me(actor); const b: Partial<ModPlatformSettingsUpdate> = (body ?? {});
    const expected = Number(b.expectedVersion);
    if (!Number.isInteger(expected) || expected < 0) bad('expectedVersion');
    const reason = reasonOf(b.reason);
    if (b.riskMatchingEnabled !== undefined && typeof b.riskMatchingEnabled !== 'boolean') bad('riskMatchingEnabled');
    if (b.autoHideReportThreshold !== undefined && (!Number.isInteger(b.autoHideReportThreshold) || b.autoHideReportThreshold! < 1 || b.autoHideReportThreshold! > 100)) bad('autoHideReportThreshold', { min: 1, max: 100 });
    if (b.riskMatchingEnabled === undefined && b.autoHideReportThreshold === undefined) bad('body', { reason: 'nothing_to_change' });
    await this.repo.tx(async (trx) => {
      await this.repo.lockSettings(trx);
      const cur = await this.repo.readSettings(trx);
      if (cur.version !== expected) fail('version_conflict', 409, { currentVersion: cur.version });
      const changed: Record<string, unknown> = {};
      if (b.riskMatchingEnabled !== undefined && b.riskMatchingEnabled !== cur.riskMatchingEnabled) { await this.repo.writeSetting(trx, 'community.risk_matching_enabled', b.riskMatchingEnabled, 'boolean', me, reason); changed.riskMatchingEnabled = b.riskMatchingEnabled; }
      if (b.autoHideReportThreshold !== undefined && b.autoHideReportThreshold !== cur.autoHideReportThreshold) { await this.repo.writeSetting(trx, 'community.auto_hide_report_threshold', b.autoHideReportThreshold, 'number', me, reason); changed.autoHideReportThreshold = b.autoHideReportThreshold; }
      if (!Object.keys(changed).length) fail('no_change', 409);
      await this.repo.audit(trx, { tenantId: null, userId: me, action: 'community.moderation.settings_changed', entityType: 'platform_settings', entityId: null, meta: { reason, changed, from: { riskMatchingEnabled: cur.riskMatchingEnabled, autoHideReportThreshold: cur.autoHideReportThreshold } } });
    });
    return this.settings();
  }
}

function writeOf(p: PostRow): PostWrite {
  return { status: p.status, visibility: p.visibility, verificationLabel: p.verificationLabel, severity: p.severity, title: p.title, redactedBody: p.redactedBody,
    recommendation: p.recommendation ?? null, officialReference: p.officialReference ?? null, privacyScanFlags: p.privacyScanFlags ?? [], commentsLocked: !!p.commentsLocked,
    removedReason: p.removedReason ?? null, mergedIntoPostId: p.mergedIntoPostId ?? null, authorLabel: p.authorLabel ?? null, publishedAt: p.publishedAt ?? null,
    resolvedAt: p.resolvedAt ?? null, resolutionNote: p.resolutionNote ?? null };
}
const reportView = (r: { id: string; kind: 'post' | 'comment'; postId: string; commentId: string | null; reporterTenantName: string; reason: string; detail: string | null; status: string; caseId: string | null; createdAt: string }): ModReportView =>
  ({ id: r.id, kind: r.kind, postId: r.postId, commentId: r.commentId, reporterTenantName: r.reporterTenantName, reason: r.reason, detail: r.detail, status: r.status as ModReportView['status'], caseId: r.caseId, createdAt: r.createdAt });
const disputeView = (d: { id: string; postId: string; raisedByKind: string; raisedByTenantName: string | null; reason: string; status: string; resolutionNote: string | null; caseId: string | null; createdAt: string }): ModDisputeView =>
  ({ id: d.id, postId: d.postId, raisedByKind: d.raisedByKind as ModDisputeView['raisedByKind'], raisedByTenantName: d.raisedByTenantName, reason: d.reason, status: d.status as ModDisputeView['status'], resolutionNote: d.resolutionNote, caseId: d.caseId, createdAt: d.createdAt });
const evidenceView = (e: { id: string; postId: string | null; tenantName: string; mimeType: string | null; sizeBytes: number | null; uploadStatus: string; scanStatus: string; redactionStatus: string; createdAt: string }): ModEvidenceView =>
  ({ id: e.id, postId: e.postId, tenantName: e.tenantName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, uploadStatus: e.uploadStatus, scanStatus: e.scanStatus, redactionStatus: e.redactionStatus, createdAt: e.createdAt });
const actionView = (a: { id: string; action: string; actorName: string | null; reason: string | null; postId: string | null; commentId: string | null; targetTenantName: string | null; detail: Record<string, unknown>; createdAt: string }): ModActionView =>
  ({ id: a.id, action: a.action, actorName: a.actorName, reason: a.reason, postId: a.postId, commentId: a.commentId, targetTenantName: a.targetTenantName, detail: a.detail, createdAt: a.createdAt });
