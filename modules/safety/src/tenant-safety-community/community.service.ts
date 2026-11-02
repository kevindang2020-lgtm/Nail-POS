// community.service.ts — the Safety Community CORE (BUILD_PLAN Phase 8, agent A): tenant settings, roles →
// capabilities, visibility, the posting workflow, the safe response shape. It performs NO policy of its own: every
// visibility, permission, privacy, wording and workflow decision is delegated to the Phase-1 pure core
// (community-classification / -privacy-scan / -workflow / -permissions). Provides COMMUNITY_CORE for the moderation
// (agent B) and interactions (agent C) halves of the module.
//
// Bugs fixed here (docs/audit-2026-10-06/spec-tenant-safety-community.md): 1 the real session roles are UPPERCASE
// (every tenant user used to map to "technician"), 4 callers pass the REAL current status, 8 an empty branch is null,
// 9 tenant responses never carry another salon's ids / user ids / scan flags, 10 identifier search refused + the search
// and dispute rate limits really counted, 11 managerApprovalRequired + notify_categories honoured.
import {
  COMMUNITY_RULES_VERSION,
  type CommunityAppealView, type CommunityAuthor, type CommunityIncidentView, type CommunityMyListKind, type CommunityMyPostView,
  type CommunityPage, type CommunityPostView, type CommunityScanSummary, type CommunitySettingsView, type CommunitySubmitResult,
  type CommunityViewerActions, type CommunityWordingIssue,
} from '@aipowersalon/api-contracts/tenant';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { canView, assertExplicitAdvisorySubmission, isCommunityVisible, type CommunityRole, type Viewer, type SafetyRecord } from './community-classification';
import { scanCommunityText, type CommunityScanResult } from './community-privacy-scan';
import { transition, isPublishedState, MODERATION_REQUIRED_CATEGORIES, type WorkflowContext, type WorkflowEvent, type WorkflowState } from './community-workflow';
import { checkWording, effectiveCapabilities, type Capability } from './community-permissions';
import { InMemoryCommunityAuditSink, type CommunityAuditSink, type CommunityAuditAction } from './community-audit';
import { screenQuery } from './community-search';
import { checkAbuse, requiresEscalatedVerification, type AbuseAction } from './community-abuse';
import { suggestSanitizedDraft, type AiBackend } from './community-ai-assist';
import { canFileAppeal, type AppealSubject } from './community-appeals';
import {
  CommunityError, invalid, body as bodyOf, str, oneOf, expectedVersion as expectedVersionOf, paging, parseFeedQuery, parseAdvisory,
  parseIncident, parseReport, parseSettingsUpdate, bool, APPEAL_SUBJECTS, type AdvisoryFields,
} from './community-input';
import type { CommunityCorePort, CommunityEventsPort, CommunityFanoutPort, CommunityRestrictionsPort, CommunityRestrictionState, CommunityViewerInfo } from './community.ports';
import { normalizeSettings, type AppealRow, type CommunityCtx, type CommunityRepo, type IncidentRow, type PostPatch, type PostRow, type TenantSettingsRow, type ViewerFlags } from './community.repository';
import { hasPermission, hasTenantWideScope, isPlatformPrincipal } from '@aipowersalon/permissions';

export { CommunityError } from './community-input';

/** COMMUNITY_CORE's viewer, plus whether this user acknowledged the CURRENT rules (agent C: comments need it). */
export type CoreViewerInfo = CommunityViewerInfo & { rulesAcknowledged: boolean; settings: Required<TenantSettingsRow> };

export interface CommunityServiceDeps {
  audit?: CommunityAuditSink; events?: CommunityEventsPort | null; fanout?: CommunityFanoutPort | null;
  restrictions?: CommunityRestrictionsPort | null; ai?: AiBackend | null;
}

/**
 * BUILD_PLAN Phase 9 (Constitution 2 §148): the community role a SESSION acts as is derived from its PERMISSIONS — the
 * platform plane moderates; the salon-wide reach (owner.branches.compare) is the owner; community.advisory.approve is a
 * branch manager; community.advisory.draft is the front desk; anyone else reads like a technician. So a template that
 * leaves out the community keys, or a DENY on community.advisory.approve, really narrows what the person may do here
 * (it used to follow the role NAME). A context with no permissions at all (internal callers, fixtures) keeps the legacy
 * name mapping below.
 */
export function communityRoleOf(ctx: { role?: string | null; permissions?: readonly string[] | null }): CommunityRole {
  if (isPlatformPrincipal(ctx)) return 'moderator';
  const perms = ctx.permissions ?? [];
  if (!perms.length) return communityRole(ctx.role);
  const p = { tenantId: '', branchId: '', userId: '', role: String(ctx.role ?? '') as any, permissions: [...perms] };
  if (hasTenantWideScope(p)) return 'owner';
  if (hasPermission(p, 'community.advisory.approve')) return 'branch_manager';
  if (hasPermission(p, 'community.advisory.draft')) return 'receptionist';
  return 'technician';
}

/** Session role (UPPERCASE in req.ctx) → community role — the legacy mapping for a context that carries no permissions.
 *  Unknown roles get nothing (technician has no default caps). */
export function communityRole(r: string | null | undefined): CommunityRole {
  switch (String(r ?? '').toUpperCase()) {
    case 'OWNER': return 'owner';
    case 'ADMIN': case 'TENANT_ADMIN': return 'tenant_admin';
    case 'MANAGER': case 'BRANCH_MANAGER': return 'branch_manager';
    case 'FRONT_DESK': case 'RECEPTION': case 'RECEPTIONIST': return 'receptionist';
    case 'SUPER_ADMIN': case 'MODERATOR': return 'moderator';
    default: return 'technician';
  }
}

const BLOCK = new Set(['card', 'cvv', 'ssn', 'bank', 'gov_id']);
const NO_RESTRICTIONS: CommunityRestrictionState = { suspended: false, postingRestricted: false, commentingRestricted: false };
const POSTING_CAPS = new Set<Capability>(['create_advisory_draft', 'submit_advisory', 'approve_advisory']);
const DRAFT_EDITABLE = new Set(['incident_draft', 'returned_for_correction', 'sensitive_data_detected', 'evidence_requested']);
const SUBMITTABLE = DRAFT_EDITABLE;
const LIVE_EDITABLE = (s: string) => isPublishedState(s) || s === 'corrected' || s === 'disputed';
const RETURNED = new Set(['returned_for_correction', 'rejected', 'evidence_requested', 'sensitive_data_detected', 'insufficient_information']);
const VISIBLE = ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report', 'disputed', 'corrected', 'resolved'];
const MY_KIND: Record<CommunityMyListKind, readonly string[] | null> = {
  drafts: ['incident_draft', 'tenant_review', 'privacy_scan'],
  submitted: ['manager_approval', 'moderation_review'],
  awaiting_approval: ['manager_approval'],
  published: VISIBLE,
  returned: [...RETURNED],
  all: null,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVER_ROLES = new Set<CommunityRole>(['owner', 'tenant_admin', 'branch_manager']);
export const REPORT_THRESHOLD_KEY = 'community.auto_hide_report_threshold';

export class CommunityService implements CommunityCorePort {
  private readonly audit: CommunityAuditSink;
  private readonly events: CommunityEventsPort | null;
  private fanout: CommunityFanoutPort | null;
  private restrictions: CommunityRestrictionsPort | null;
  /** the risk-fingerprint store (agent C), bound late; records ONLY when the platform flag + policy + salt are all set */
  private risk: { recordFromText(postId: string, rawText: string): Promise<unknown> } | null = null;
  private readonly ai: AiBackend | null;

  constructor(private readonly repo: CommunityRepo, deps: CommunityServiceDeps = {}) {
    this.audit = deps.audit ?? new InMemoryCommunityAuditSink();
    this.events = deps.events ?? null;
    this.fanout = deps.fanout ?? null;
    this.restrictions = deps.restrictions ?? null;
    this.ai = deps.ai ?? null;
  }

  /** late binding of the ports that may themselves depend on COMMUNITY_CORE (see the module) */
  bind(ports: { fanout?: CommunityFanoutPort | null; restrictions?: CommunityRestrictionsPort | null; risk?: { recordFromText(postId: string, rawText: string): Promise<unknown> } | null }): void {
    if (ports.risk !== undefined) this.risk = ports.risk;
    if (ports.fanout !== undefined) this.fanout = ports.fanout;
    if (ports.restrictions !== undefined) this.restrictions = ports.restrictions;
  }

  // ════════════════════════════ COMMUNITY_CORE ════════════════════════════

  async viewer(ctx: CommunityCtx): Promise<CoreViewerInfo> {
    const role = communityRoleOf(ctx);
    if (role === 'moderator') {
      // a Super Admin moderator has no salon: no settings row, no restrictions, never blocked by the rules modal
      const settings = { ...normalizeSettings(null, ctx.tenantId), enabled: true };
      return { ctx, role, capabilities: effectiveCapabilities('moderator'), settings, communityEnabled: true, restrictions: NO_RESTRICTIONS, rulesAcknowledged: true };
    }
    const settings = normalizeSettings(await this.repo.getSettings(ctx.tenantId), ctx.tenantId);
    const capabilities = effectiveCapabilities(role, settings.roleGrants[role] as Capability[] | undefined, settings.roleRemovals[role] as Capability[] | undefined);
    const restrictions = this.restrictions ? await this.restrictions.active(ctx.tenantId, ctx.userId || null) : NO_RESTRICTIONS;
    const rulesAcknowledged = !!ctx.userId && await this.repo.hasAcknowledgedRules(ctx.tenantId, ctx.userId, COMMUNITY_RULES_VERSION);
    return { ctx, role, capabilities, settings, communityEnabled: settings.enabled, restrictions, rulesAcknowledged };
  }

  /** `mode: 'read'` checks the community is on and the capability, nothing else (own lists, private incidents). */
  async requireCapability(ctx: CommunityCtx, cap: Capability, mode: 'write' | 'read' = 'write'): Promise<CoreViewerInfo> {
    const v = await this.viewer(ctx);
    if (v.role !== 'moderator') {
      if (!v.communityEnabled) throw new CommunityError('community_disabled', 403);
      if (mode === 'write' && v.restrictions.suspended && cap !== 'view_community') throw new CommunityError('community_suspended', 403);
      if (mode === 'write' && v.restrictions.postingRestricted && POSTING_CAPS.has(cap)) throw new CommunityError('community_posting_restricted', 403);
    }
    if (!v.capabilities.has(cap)) throw new CommunityError('permission_denied', 403, { cap, role: v.role });
    return v;
  }

  async visiblePost(ctx: CommunityCtx, postId: string): Promise<PostRow> {
    if (!UUID_RE.test(postId)) throw new CommunityError('post_not_found', 404);
    const post = await this.repo.getPost(postId);
    if (!post) throw new CommunityError('post_not_found', 404);
    const v = await this.viewer(ctx);
    this.assertCanSee(v, post);
    return post;
  }

  async postView(ctx: CommunityCtx, row: PostRow, opts: { detail?: boolean } = {}): Promise<CommunityPostView> {
    const v = await this.viewer(ctx);
    return (await this.views(v, [row], !!opts.detail))[0];
  }

  async authorLabelFor(tenantId: string, display: 'tenant_name' | 'display_name' | 'anonymous', region: string | null): Promise<string> {
    const s = normalizeSettings(await this.repo.getSettings(tenantId), tenantId);
    if (display === 'anonymous' && s.allowAnonymous) return region ? `A salon in ${region}` : 'A salon';
    const name = await this.repo.tenantDisplayName(tenantId);
    if (display === 'tenant_name') return name ?? 'A salon';
    return s.displayName?.trim() || name || 'A salon';
  }

  // ════════════════════════════ settings + rules ════════════════════════════

  async getSettings(ctx: CommunityCtx): Promise<CommunitySettingsView> {
    const v = await this.viewer(ctx);
    return this.settingsView(v.settings, v.rulesAcknowledged);
  }

  async updateSettings(ctx: CommunityCtx, raw: unknown): Promise<CommunitySettingsView> {
    const v = await this.viewer(ctx);
    // settings are reachable while the community is OFF (that is how a salon turns it on) and while suspended
    if (!v.capabilities.has('manage_tenant_settings')) throw new CommunityError('permission_denied', 403, { cap: 'manage_tenant_settings', role: v.role });
    const u = parseSettingsUpdate(raw);
    const next = { ...v.settings, ...strip({ ...u, notify: undefined, expectedVersion: undefined }) };
    if (next.authorDisplay === 'anonymous' && next.allowAnonymous === false) throw invalid('authorDisplay', 'anonymous_not_allowed');
    const patch = strip({
      enabled: u.enabled, receptionistApprovalRequired: u.receptionistApprovalRequired, managerApprovalRequired: u.managerApprovalRequired,
      displayName: u.displayName, authorDisplay: u.authorDisplay, allowAnonymous: u.allowAnonymous, branchVisibility: u.branchVisibility,
      retentionDays: u.retentionDays, regionPreferences: u.regionPreferences, roleGrants: u.roleGrants, roleRemovals: u.roleRemovals,
      notifyCategories: u.notify?.categories, pushEnabled: u.notify?.push, emailEnabled: u.notify?.email, criticalSmsEnabled: u.notify?.criticalSms,
    });
    const saved = await this.repo.tx(async (repo, trx) => {
      const row = u.expectedVersion === 0 ? await repo.insertSettings(ctx.tenantId, patch, ctx.userId) : await repo.updateSettings(ctx.tenantId, u.expectedVersion, patch, ctx.userId);
      if (!row) throw new CommunityError('version_conflict', 409, { currentVersion: v.settings.version });
      await this.emit(ctx, ctx.tenantId, DOMAIN_EVENTS.COMMUNITY_SETTINGS_CHANGED, { type: 'community_settings', id: ctx.tenantId, version: row.version ?? 1 }, { version: row.version ?? 1 }, trx);
      return row;
    });
    await this.record(ctx, 'settings.changed', ctx.tenantId, { fields: Object.keys(patch), version: saved.version });
    return this.settingsView(normalizeSettings(saved, ctx.tenantId), v.rulesAcknowledged);
  }

  async acknowledgeRules(ctx: CommunityCtx, raw: unknown): Promise<{ acknowledged: true; rulesVersion: string }> {
    const b = bodyOf(raw);
    const version = str(b.rulesVersion, 'rulesVersion', { max: 40, required: true })!;
    if (version !== COMMUNITY_RULES_VERSION) throw new CommunityError('rules_version_mismatch', 409, { currentRulesVersion: COMMUNITY_RULES_VERSION });
    if (!ctx.userId) throw new CommunityError('permission_denied', 403);
    await this.repo.acknowledgeRules(ctx.tenantId, ctx.userId, version);
    await this.record(ctx, 'rules.acknowledged', '', { rulesVersion: version });
    return { acknowledged: true, rulesVersion: version };
  }

  // ════════════════════════════ feed / search / detail ════════════════════════════

  async feed(ctx: CommunityCtx, raw: unknown): Promise<CommunityPage<CommunityPostView>> {
    const q = parseFeedQuery(raw);
    const v = await this.requireCapability(ctx, 'view_community');
    let term: string | null = null;
    if (q.q) {
      await this.gate(ctx, 'search');                  // repeated identifier probing pauses search entirely
      const screen = screenQuery(q.q);
      if (!screen.allowed) {
        await this.record(ctx, 'search.rejected', '', { rejection: screen.rejection });
        throw new CommunityError('search_identifier_rejected', 400, { field: 'q', rejection: screen.rejection, message: screen.message });
      }
      await this.record(ctx, 'search.performed', '', { length: q.q.length });   // the hourly search counter reads these
      term = q.q;
    }
    const res = await this.repo.listFeed({
      viewerTenantId: ctx.tenantId, viewerUserId: ctx.userId, term, category: q.category, severity: q.severity, region: q.region,
      status: q.status, sort: q.sort, followingOnly: q.followingOnly, limit: q.limit, offset: q.offset,
    });
    const visible = res.items.filter((p) => this.canSee(v, p));
    return { items: await this.views(v, visible, false), page: q.page, pageSize: q.pageSize, total: res.total, hasMore: q.offset + res.items.length < res.total };
  }

  async getPost(ctx: CommunityCtx, postId: string): Promise<CommunityPostView> {
    const v = await this.requireCapability(ctx, 'view_community');
    const post = await this.visiblePost(ctx, postId);
    return (await this.views(v, [post], true))[0];
  }

  // ════════════════════════════ my advisories ════════════════════════════

  async listMine(ctx: CommunityCtx, raw: unknown): Promise<CommunityPage<CommunityMyPostView>> {
    const q = bodyOf(raw);
    const kind = oneOf(q.kind, 'kind', Object.keys(MY_KIND) as CommunityMyListKind[]) ?? 'all';
    const pg = paging(q);
    const v = await this.requireCapability(ctx, 'create_advisory_draft', 'read');
    const res = await this.repo.listMine(ctx.tenantId, MY_KIND[kind], this.branchOnly(v), pg.limit, pg.offset);
    return { items: await this.myViews(v, res.items), page: pg.page, pageSize: pg.pageSize, total: res.total, hasMore: pg.offset + res.items.length < res.total };
  }

  async getMine(ctx: CommunityCtx, postId: string): Promise<CommunityMyPostView> {
    const v = await this.requireCapability(ctx, 'create_advisory_draft', 'read');
    const post = await this.ownPost(v, postId);
    return (await this.myViews(v, [post]))[0];
  }

  async createAdvisory(ctx: CommunityCtx, raw: unknown): Promise<CommunityMyPostView> {
    const input = parseAdvisory(raw, false);
    const v = await this.requireCapability(ctx, 'create_advisory_draft');
    this.requireRules(v);
    await this.gate(ctx, 'post');
    const authorDisplay = input.authorDisplay ?? v.settings.authorDisplay;
    if (authorDisplay === 'anonymous' && !v.settings.allowAnonymous) throw invalid('authorDisplay', 'anonymous_not_allowed');
    let incident: IncidentRow | null = null;
    if (input.fromIncidentId) {
      incident = await this.repo.getIncident(ctx, input.fromIncidentId);
      if (!incident) throw new CommunityError('incident_not_found', 404);
      const d = canView(this.asViewer(v), { classification: 'private_incident', ownerTenantId: incident.tenantId, ownerBranchId: incident.branchId, status: 'incident_draft' });
      if (!d.allowed) throw new CommunityError('not_visible', 403, { reason: d.reason });
      if (incident.advisoryPostId) throw new CommunityError('incident_already_promoted', 409);
      // never automatic: the advisory is the SANITIZED text the user wrote, not the incident's raw detail
      const gate = assertExplicitAdvisorySubmission({ fromPrivateIncident: true, sanitizedAdvisoryProvided: !!input.body?.trim(), submittedByAuthorizedUser: true });
      if (!gate.ok) throw new CommunityError('advisory_submission_rejected', 400, { reason: gate.reason });
    }
    const scanned = scanFields(input);
    const post = await this.repo.tx(async (repo) => {
      const p = await repo.createPost({
        originTenantId: ctx.tenantId, originBranchId: ctx.branchId || null, createdByUserId: ctx.userId,
        category: input.category!, severity: input.severity!, region: input.region ?? null, title: scanned.fields.title!, redactedBody: scanned.fields.body!,
        incidentDate: input.incidentDate ?? null, scamMethod: scanned.fields.scamMethod ?? null, channels: input.channels ?? [],
        recommendation: scanned.fields.recommendation ?? null, tags: scanned.fields.tags ?? [], paymentProcessor: input.paymentProcessor ?? null,
        amountRange: input.amountRange ?? null, officialReference: scanned.fields.officialReference ?? null, authorDisplay,
        privacyScanFlags: scanned.categories, status: 'incident_draft', visibility: 'draft',
      });
      await repo.insertPostVersion(versionRow(p, ctx.userId, null));
      if (incident) await repo.linkIncidentAdvisory(ctx, incident.id, p.id);
      return p;
    });
    await this.record(ctx, 'advisory.drafted', post.id, { category: post.category, redactedCategories: scanned.categories });
    if (incident) await this.record(ctx, 'advisory.promoted', post.id, { fromIncidentId: incident.id });
    // salted one-way fingerprints of coarse indicators from the RAW text (never stored) — a no-op unless the platform
    // flag, the policy reference and the salt are all set; failure never blocks the draft
    if (this.risk) await this.risk.recordFromText(post.id, [input.body ?? '', input.scamMethod ?? ''].join('\n')).catch(() => undefined);
    return (await this.myViews(v, [post]))[0];
  }

  async updateAdvisory(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunitySubmitResult> {
    const b = bodyOf(raw);
    const expected = expectedVersionOf(b);
    const changeNote = str(b.changeNote, 'changeNote', { max: 500 });
    const input = parseAdvisory({ ...b, expectedVersion: undefined, changeNote: undefined }, true);
    const v = await this.requireCapability(ctx, 'create_advisory_draft');
    this.requireRules(v);
    const post = await this.ownPost(v, postId);
    if (!DRAFT_EDITABLE.has(post.status)) throw new CommunityError('invalid_state', 409, { status: post.status });
    this.requireAuthorOrApprover(v, post);
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    if (input.authorDisplay === 'anonymous' && !v.settings.allowAnonymous) throw invalid('authorDisplay', 'anonymous_not_allowed');
    const scanned = scanFields(input);
    // a new body replaces the old findings; otherwise the old findings (from text already redacted) still stand
    const flags = union(input.body !== undefined ? [] : post.privacyScanFlags, scanned.categories);
    const patch: PostPatch = strip({ ...input, ...scanned.fields, authorDisplay: input.authorDisplay ?? undefined, fromIncidentId: undefined, body: undefined, redactedBody: scanned.fields.body, privacyScanFlags: flags }) as PostPatch;
    const updated = await this.repo.tx(async (repo) => {
      const u = await repo.updatePost(post.id, expected, post.status, patch);
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, changeNote));
      return u;
    });
    await this.record(ctx, 'advisory.updated', post.id, { fields: Object.keys(input), redactedCategories: scanned.categories });
    return { post: (await this.myViews(v, [updated]))[0], scan: scanSummary(updated, flags), wording: wordingIssue(updated, false) };
  }

  async submitAdvisory(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunitySubmitResult> {
    const b = bodyOf(raw);
    const expected = expectedVersionOf(b);
    const officialReportReferenced = bool(b.officialReportReferenced, 'officialReportReferenced', false)!;
    const v = await this.requireCapability(ctx, 'create_advisory_draft');
    this.requireRules(v);
    const post = await this.ownPost(v, postId);
    if (!SUBMITTABLE.has(post.status)) throw new CommunityError('invalid_state', 409, { status: post.status });
    this.requireAuthorOrApprover(v, post);
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });

    // neutral wording: accusatory words need a rewrite — or an official report reference, and then a moderator decides
    const wording = checkWording(postText(post), { officialReportReferenced, moderationApprovedWording: false });
    const wordingNeedsModeration = wording.requiresRewrite && officialReportReferenced && !!post.officialReference;
    if (wording.requiresRewrite && !wordingNeedsModeration) throw new CommunityError('wording_requires_rewrite', 400, { matched: wording.matched, suggestions: wording.suggestions });

    // Decide from the flags captured when the text was written (the RAW text), not a re-scan of the redacted body.
    const scan = scanOf(post);
    const escalated = requiresEscalatedVerification(await this.repo.tenantReputation(ctx.tenantId));
    const moderationRequired = post.severity === 'critical' || MODERATION_REQUIRED_CATEGORIES.has(post.category) || escalated || wordingNeedsModeration || post.status === 'evidence_requested';
    const r = transition(post.status as WorkflowState, 'submit', this.wctx(v, post, { scan, moderationRequired }));
    if (!r.ok) throw workflowError(r.error, post.status);
    const published = isPublishedState(r.state);
    const patch: PostPatch = {
      status: r.state, moderationRequired, submittedByUserId: ctx.userId, visibility: published ? 'community_published' : 'draft',
      ...(published ? { publishedNow: true, approvedByUserId: ctx.userId, authorLabel: await this.labelFor(post) } : {}),
    };
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, expected, post.status, patch);
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, null));
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_SUBMITTED, { status: u.status }, trx);
      if (published) await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED, { status: u.status, severity: u.severity, category: u.category }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.submitted', post.id, { outcome: updated.status, flags: post.privacyScanFlags, moderationRequired, escalatedForReputation: escalated });
    if (published) await this.published(updated);
    return { post: (await this.myViews(v, [updated]))[0], scan: scanSummary(updated, updated.privacyScanFlags), wording: wording.requiresRewrite ? { matched: wording.matched ?? '', suggestions: wording.suggestions } : null };
  }

  async approveAdvisory(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityMyPostView> {
    const expected = expectedVersionOf(bodyOf(raw));
    const v = await this.requireCapability(ctx, 'approve_advisory');
    const post = await this.ownPost(v, postId);
    if (post.status !== 'manager_approval') throw new CommunityError('invalid_state', 409, { status: post.status, reason: 'not_awaiting_approval' });
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    const r = transition('manager_approval', 'manager_approve', this.wctx(v, post, { moderationRequired: post.moderationRequired }));
    if (!r.ok) throw workflowError(r.error, post.status);
    const published = isPublishedState(r.state);
    const patch: PostPatch = {
      status: r.state, approvedByUserId: ctx.userId, visibility: published ? 'community_published' : 'draft',
      ...(published ? { publishedNow: true, authorLabel: await this.labelFor(post) } : {}),
    };
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, expected, 'manager_approval', patch);
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, null));
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_APPROVED, { status: u.status }, trx);
      if (published) await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED, { status: u.status, severity: u.severity, category: u.category }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.approved', post.id, { outcome: updated.status, published, heldForModeration: updated.status === 'moderation_review' });
    if (published) await this.published(updated);
    return (await this.myViews(v, [updated]))[0];
  }

  async returnAdvisory(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityMyPostView> {
    const b = bodyOf(raw);
    const expected = expectedVersionOf(b);
    const note = scanCommunityText(str(b.note, 'note', { min: 3, max: 1000, required: true })!).redactedText;
    const v = await this.requireCapability(ctx, 'approve_advisory');
    const post = await this.ownPost(v, postId);
    if (post.status !== 'manager_approval') throw new CommunityError('invalid_state', 409, { status: post.status });
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    const r = transition('manager_approval', 'manager_return', this.wctx(v, post));
    if (!r.ok) throw workflowError(r.error, post.status);
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, expected, 'manager_approval', { status: r.state });
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, note));       // the note IS the returnReason the author sees
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_RETURNED, { status: u.status, by: 'approver' }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.returned', post.id, { outcome: updated.status });
    return (await this.myViews(v, [updated]))[0];
  }

  async withdrawAdvisory(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityMyPostView> {
    const expected = expectedVersionOf(bodyOf(raw));
    const v = await this.requireCapability(ctx, 'create_advisory_draft', 'read');
    if (v.restrictions.suspended) throw new CommunityError('community_suspended', 403);
    const post = await this.ownPost(v, postId);
    this.requireAuthorOrApprover(v, post);
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    const r = transition(post.status as WorkflowState, 'withdraw', this.wctx(v, post));
    if (!r.ok) throw workflowError(r.error, post.status);
    const updated = await this.repo.tx(async (repo) => {
      const u = await repo.updatePost(post.id, expected, post.status, { status: r.state, visibility: 'draft' });
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, null));
      return u;
    });
    await this.record(ctx, 'advisory.withdrawn', post.id, { from: post.status });
    return (await this.myViews(v, [updated]))[0];
  }

  // ════════════════════════════ published advisories (the posting salon) ════════════════════════════

  async editPublished(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunitySubmitResult> {
    const b = bodyOf(raw);
    const expected = expectedVersionOf(b);
    const changeNote = str(b.changeNote, 'changeNote', { max: 500 });
    const input = parseAdvisory({ ...b, expectedVersion: undefined, changeNote: undefined }, true);
    const v = await this.requireCapability(ctx, 'submit_advisory');
    this.requireRules(v);
    const post = await this.ownPost(v, postId);
    if (!LIVE_EDITABLE(post.status)) throw new CommunityError('invalid_state', 409, { status: post.status });
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    const scanned = scanFields(input);
    const blocked = scanned.categories.some((c) => BLOCK.has(c));
    const category = input.category ?? post.category; const severity = input.severity ?? post.severity;
    const needsModeration = severity === 'critical' || MODERATION_REQUIRED_CATEGORIES.has(category);
    const newlyNeedsModeration = needsModeration && !post.moderationRequired;
    const r = transition(post.status as WorkflowState, 'edit', { ...this.wctx(v, post), category, severity: severity as any, moderationRequired: newlyNeedsModeration, scan: { redactedText: '', findings: [], blocked, flagged: scanned.categories.length > 0, categories: scanned.categories as any } });
    if (!r.ok) throw workflowError(r.error, post.status);
    const hidden = !isCommunityVisible(r.state);
    const flags = union(input.body !== undefined ? [] : post.privacyScanFlags, scanned.categories);
    const patch: PostPatch = strip({
      ...input, ...scanned.fields, authorDisplay: input.authorDisplay ?? undefined, fromIncidentId: undefined, body: undefined, redactedBody: scanned.fields.body, privacyScanFlags: flags,
      status: r.state, visibility: hidden ? 'draft' : undefined, moderationRequired: post.moderationRequired || needsModeration, activityNow: true,
    }) as PostPatch;
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, expected, post.status, patch);
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, changeNote));
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, { status: u.status, change: 'edited' }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.edited', post.id, { fields: Object.keys(input), outcome: updated.status, hiddenForModeration: hidden });
    if (!hidden) await this.changed(updated, 'edited');
    return { post: (await this.myViews(v, [updated]))[0], scan: scanSummary(updated, flags), wording: wordingIssue(updated, false) };
  }

  async addUpdate(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityPostView> {
    const text = str(bodyOf(raw).body, 'body', { min: 3, max: 2000, required: true })!;
    const v = await this.requireCapability(ctx, 'submit_advisory');
    this.requireRules(v);
    const post = await this.ownPost(v, postId);
    if (!LIVE_EDITABLE(post.status) || post.visibility !== 'community_published') throw new CommunityError('invalid_state', 409, { status: post.status });
    const scan = scanCommunityText(text);
    if (scan.blocked) throw new CommunityError('update_contains_payment_data', 400, { field: 'body', categories: scan.categories });
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, post.version, post.status, { activityNow: true });
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.addUpdate(ctx, post.id, scan.redactedText);
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, { status: u.status, change: 'update_added' }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.update_added', post.id, { redactedCategories: scan.categories });
    await this.changed(updated, 'update_added');
    return (await this.views(v, [updated], true))[0];
  }

  async resolvePost(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityPostView> {
    const b = bodyOf(raw);
    const expected = expectedVersionOf(b);
    const rawNote = str(b.note, 'note', { max: 1000 });
    const note = rawNote ? scanCommunityText(rawNote).redactedText : null;
    const v = await this.requireCapability(ctx, 'submit_advisory');
    const post = await this.ownPost(v, postId);
    if (post.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: post.version });
    const r = transition(post.status as WorkflowState, 'resolve', this.wctx(v, post));
    if (!r.ok) throw workflowError(r.error, post.status);
    const updated = await this.repo.tx(async (repo, trx) => {
      const u = await repo.updatePost(post.id, expected, post.status, { status: r.state, resolvedNow: true, resolutionNote: note, activityNow: true });
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, note));
      await this.postEvent(ctx, u, DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, { status: u.status, change: 'resolved' }, trx);
      return u;
    });
    await this.record(ctx, 'advisory.resolved', post.id, {});
    await this.changed(updated, 'resolved');
    return (await this.views(v, [updated], true))[0];
  }

  // ════════════════════════════ reports, disputes, appeals ════════════════════════════

  /** One open report per salon per post. Reports never remove anything: past the platform threshold the post simply
   *  needs a moderator (agent B's report queue reads community_reports). */
  async reportPost(ctx: CommunityCtx, postId: string, raw: unknown): Promise<{ ok: true }> {
    const input = parseReport(raw);
    const v = await this.requireCapability(ctx, 'view_community');
    if (v.restrictions.suspended) throw new CommunityError('community_suspended', 403);
    const post = await this.visiblePost(ctx, postId);
    if (!isCommunityVisible(post.status) || post.visibility !== 'community_published') throw new CommunityError('invalid_state', 409, { status: post.status });
    if (post.originTenantId === ctx.tenantId) throw new CommunityError('cannot_report_own_post', 400);
    await this.gate(ctx, 'report');
    const detail = input.detail ? scanCommunityText(input.detail).redactedText : null;
    const res = await this.repo.tx((repo) => repo.createReport(ctx, post.id, input.reason, detail));
    if (!res) throw new CommunityError('already_reported', 409);
    await this.record(ctx, 'post.reported', post.id, { reason: input.reason });
    const threshold = Number(await this.repo.platformSetting(REPORT_THRESHOLD_KEY)) || 5;
    if (res.reportCount >= threshold) await this.record(ctx, 'post.report_threshold_reached', post.id, { reportCount: res.reportCount, threshold });
    return { ok: true };
  }

  /** A dispute labels a published post "disputed" (still visible, clearly contested); moderation decides. */
  async disputePost(ctx: CommunityCtx, postId: string, raw: unknown): Promise<{ ok: true; status: string }> {
    const b = bodyOf(raw);
    const reasonRaw = str(b.reason, 'reason', { min: 8, max: 1000, required: true })!;
    const raisedByKind = oneOf(b.raisedByKind, 'raisedByKind', ['tenant', 'subject'] as const) ?? 'tenant';
    const v = await this.requireCapability(ctx, 'view_community');
    if (v.restrictions.suspended) throw new CommunityError('community_suspended', 403);
    const post = await this.visiblePost(ctx, postId);
    if (!(isPublishedState(post.status) || post.status === 'disputed') || post.visibility !== 'community_published') throw new CommunityError('invalid_state', 409, { status: post.status });
    if (post.originTenantId === ctx.tenantId) throw new CommunityError('cannot_dispute_own_post', 400);
    await this.gate(ctx, 'dispute');
    const reason = scanCommunityText(reasonRaw).redactedText;
    const after = await this.repo.tx(async (repo, trx) => {
      const d = await repo.createDispute(ctx, post.id, reason, raisedByKind);
      if (!d) throw new CommunityError('already_disputed', 409);
      if (!isPublishedState(post.status)) return post;
      const r = transition(post.status as WorkflowState, 'dispute', this.wctx(v, post));
      if (!r.ok) throw workflowError(r.error, post.status);
      const u = await repo.updatePost(post.id, post.version, post.status, { status: r.state, activityNow: true });
      if (!u) throw new CommunityError('version_conflict', 409);
      await repo.insertPostVersion(versionRow(u, ctx.userId, null));
      await this.postEvent({ tenantId: post.originTenantId, branchId: null, userId: '', role: ctx.role }, u,   // another salon's user never rides the posting salon's event
         DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, { status: u.status, change: 'disputed' }, trx);
      return u;
    });
    await this.record(ctx, 'post.disputed', post.id, { raisedByKind });
    if (after.status !== post.status) await this.changed(after, 'disputed');
    return { ok: true, status: after.status };
  }

  async fileAppeal(ctx: CommunityCtx, postId: string, raw: unknown): Promise<CommunityAppealView> {
    const b = bodyOf(raw);
    const subject = oneOf(b.subject, 'subject', APPEAL_SUBJECTS, true)! as AppealSubject;
    const reason = scanCommunityText(str(b.reason, 'reason', { min: 8, max: 2000, required: true })!).redactedText;
    const commentId = b.commentId == null ? null : (typeof b.commentId === 'string' && UUID_RE.test(b.commentId) ? b.commentId : (() => { throw invalid('commentId', 'uuid_required'); })());
    const v = await this.viewer(ctx);                     // a suspended salon may still appeal its suspension
    const post = UUID_RE.test(postId) ? await this.repo.getPost(postId) : null;
    if (!post) throw new CommunityError('post_not_found', 404);
    let target = post.originTenantId;
    switch (subject) {
      case 'post_rejected': if (post.status !== 'rejected') throw new CommunityError('invalid_state', 409, { status: post.status }); break;
      case 'post_removed': if (post.status !== 'removed') throw new CommunityError('invalid_state', 409, { status: post.status }); break;
      case 'comment_removed': {
        if (!commentId) throw invalid('commentId', 'required');
        const c = await this.repo.commentRef(commentId);
        if (!c || c.postId !== post.id) throw new CommunityError('comment_not_found', 404);
        if (c.visibility !== 'removed') throw new CommunityError('invalid_state', 409, { status: c.visibility });
        target = c.tenantId; break;
      }
      case 'community_suspended':
        if (!v.restrictions.suspended) throw new CommunityError('not_suspended', 409);
        target = ctx.tenantId; break;
      default: break;                                      // verification_status / severity_change: the salon's own post
    }
    const gate = canFileAppeal({ role: v.role, tenantId: ctx.tenantId, targetTenantId: target });
    if (!gate.ok) throw new CommunityError('appeal_not_allowed', 403, { reason: gate.reason });
    if (await this.repo.openAppealExists(ctx.tenantId, post.id, subject, commentId)) throw new CommunityError('appeal_already_open', 409);
    const originalDeciderUserId = await this.repo.lastModeratorFor(post.id);
    const appeal = await this.repo.createAppeal(ctx, { postId: post.id, commentId, subject, reason, originalDecision: subject, originalDeciderUserId });
    await this.record(ctx, 'appeal.filed', appeal.id, { subject, postId: post.id });
    return appealView(appeal);
  }

  async listAppeals(ctx: CommunityCtx): Promise<CommunityAppealView[]> {
    const v = await this.viewer(ctx);
    if (!APPROVER_ROLES.has(v.role)) throw new CommunityError('permission_denied', 403, { role: v.role });
    return (await this.repo.listAppealsForTenant(ctx.tenantId, 100)).map(appealView);
  }

  // ════════════════════════════ private incidents (never cross-tenant) ════════════════════════════

  async listIncidents(ctx: CommunityCtx, raw: unknown): Promise<CommunityPage<CommunityIncidentView>> {
    const pg = paging(bodyOf(raw));
    const v = await this.requireCapability(ctx, 'create_private_incident', 'read');
    // canView: owners / admins read every incident, a branch manager its branch (+ salon-wide), reception never
    if (!APPROVER_ROLES.has(v.role)) throw new CommunityError('incident_read_not_allowed', 403, { role: v.role });
    const scope = v.role === 'branch_manager' ? { branchOnly: ctx.branchId || null } : { branchOnly: undefined };
    const res = await this.repo.listIncidents(ctx.tenantId, scope, pg.limit, pg.offset);
    return { items: res.items.map(incidentView), page: pg.page, pageSize: pg.pageSize, total: res.total, hasMore: pg.offset + res.items.length < res.total };
  }

  async createIncident(ctx: CommunityCtx, raw: unknown): Promise<CommunityIncidentView> {
    const input = parseIncident(raw);
    await this.requireCapability(ctx, 'create_private_incident', 'read');
    const inc = await this.repo.createIncident(ctx, input);
    await this.record(ctx, 'incident.created', inc.id, { category: input.category, severity: input.severity });
    return incidentView(inc);
  }

  async getIncident(ctx: CommunityCtx, id: string): Promise<CommunityIncidentView> {
    const v = await this.requireCapability(ctx, 'create_private_incident', 'read');
    const inc = UUID_RE.test(id) ? await this.repo.getIncident(ctx, id) : null;
    if (!inc) throw new CommunityError('incident_not_found', 404);
    const d = canView(this.asViewer(v), { classification: 'private_incident', ownerTenantId: inc.tenantId, ownerBranchId: inc.branchId, status: 'incident_draft' });
    if (!d.allowed) throw new CommunityError('not_visible', 403, { reason: d.reason });
    return incidentView(inc);
  }

  // ════════════════════════════ AI writing help ════════════════════════════

  /** A SUGGESTION only — it never writes, publishes or advances a post; the model's output is re-screened. */
  async assist(ctx: CommunityCtx, raw: unknown): Promise<{ suggestion: string | null; flags: string[] }> {
    const text = str(bodyOf(raw).body, 'body', { min: 10, max: 5000, required: true })!;
    await this.requireCapability(ctx, 'create_advisory_draft');
    if (!this.ai) throw new CommunityError('ai_not_configured', 503);
    const r = await suggestSanitizedDraft(this.ai, text);
    return { suggestion: r.sanitizedBody, flags: [...r.redactions, ...(r.withheldReason ? [r.withheldReason] : [])] };
  }

  // ════════════════════════════ internals ════════════════════════════

  private asViewer(v: CoreViewerInfo): Viewer {
    return { tenantId: v.ctx.tenantId, role: v.role, communityEnabled: v.communityEnabled, canAccessCommunity: v.capabilities.has('view_community'), branchIds: v.ctx.branchId ? [v.ctx.branchId] : [], moderationCaseId: null };
  }
  private canSee(v: CoreViewerInfo, post: PostRow): boolean {
    try { this.assertCanSee(v, post); return true; } catch { return false; }
  }
  private assertCanSee(v: CoreViewerInfo, post: PostRow): void {
    const record: SafetyRecord = { classification: post.classification, ownerTenantId: post.originTenantId, ownerBranchId: post.originBranchId, status: post.status };
    const d = canView(this.asViewer(v), record);
    if (!d.allowed) {
      if (d.reason === 'advisory_not_published') throw new CommunityError('post_not_found', 404);   // never confirm another salon's draft exists
      throw new CommunityError('not_visible', 403, { reason: d.reason });
    }
    // a published-state row that is not actually community_published (removed / hidden) is only the owner's
    if (post.originTenantId !== v.ctx.tenantId && v.role !== 'moderator' && post.visibility !== 'community_published') throw new CommunityError('post_not_found', 404);
    // branch visibility: drafts of another branch stay with that branch (owners / admins see all)
    if (post.originTenantId === v.ctx.tenantId && !isCommunityVisible(post.status) && v.settings.branchVisibility === 'own_branch'
      && v.role !== 'owner' && v.role !== 'tenant_admin' && post.originBranchId && post.originBranchId !== v.ctx.branchId) {
      throw new CommunityError('not_visible', 403, { reason: 'branch_scope' });
    }
  }
  private branchOnly(v: CoreViewerInfo): string | null | undefined {
    if (v.settings.branchVisibility !== 'own_branch' || v.role === 'owner' || v.role === 'tenant_admin') return undefined;
    return v.ctx.branchId || null;
  }
  private async ownPost(v: CoreViewerInfo, postId: string): Promise<PostRow> {
    const post = UUID_RE.test(postId) ? await this.repo.getPost(postId) : null;
    if (!post || post.originTenantId !== v.ctx.tenantId) throw new CommunityError('post_not_found', 404);
    const b = this.branchOnly(v);
    if (b !== undefined && post.originBranchId && post.originBranchId !== b) throw new CommunityError('not_visible', 403, { reason: 'branch_scope' });
    return post;
  }
  private requireAuthorOrApprover(v: CoreViewerInfo, post: PostRow): void {
    if (post.createdByUserId !== v.ctx.userId && !v.capabilities.has('approve_advisory')) throw new CommunityError('not_your_draft', 403);
  }
  private requireRules(v: CoreViewerInfo): void {
    if (!v.rulesAcknowledged) throw new CommunityError('rules_not_acknowledged', 403, { rulesVersion: COMMUNITY_RULES_VERSION });
  }
  private wctx(v: CoreViewerInfo, post: PostRow, extra: Partial<WorkflowContext> = {}): WorkflowContext {
    return {
      role: v.role, receptionistApprovalRequired: v.settings.receptionistApprovalRequired, managerApprovalRequired: v.settings.managerApprovalRequired,
      category: post.category, severity: post.severity as WorkflowContext['severity'], verificationLabel: post.verificationLabel,
      moderationRequired: post.moderationRequired, ...extra,
    };
  }
  private async labelFor(post: PostRow): Promise<string> {
    return this.authorLabelFor(post.originTenantId, post.authorDisplay ?? 'display_name', post.region);
  }

  /** Abuse gate — rate limits + identity-probe restriction. Throws 429 with a retry hint. */
  private async gate(ctx: CommunityCtx, action: AbuseAction): Promise<void> {
    if (isPlatformPrincipal(ctx)) return;   // the platform's moderators are not rate-limited by a salon's abuse gate
    const d = checkAbuse(action, await this.repo.abuseCounters(ctx.tenantId));
    if (!d.allowed) {
      await this.record(ctx, 'abuse.blocked', '', { action, reason: d.reason });
      throw new CommunityError('rate_limited', 429, { reason: d.reason, retryAfterMinutes: d.retryAfterMinutes, message: d.message });
    }
  }

  private async record(ctx: CommunityCtx, action: CommunityAuditAction, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.audit.record({ ...ctx, branchId: ctx.branchId || null }, action, entityId, meta);
  }
  private async emit(ctx: CommunityCtx, tenantId: string, type: string, aggregate: { type: 'community_post' | 'community_settings'; id: string; version?: number }, payload: Record<string, unknown>, trx: unknown): Promise<void> {
    if (!this.events) return;
    await this.events.emit({ tenantId, branchId: ctx.branchId || null, userId: ctx.userId }, type, aggregate, payload, trx);
  }
  /** a post event goes to the POSTING salon (origin tenant); payload = ids of that post + facts, nothing else */
  private async postEvent(ctx: CommunityCtx, post: PostRow, type: string, payload: Record<string, unknown>, trx: unknown): Promise<void> {
    await this.emit({ ...ctx, branchId: post.originTenantId === ctx.tenantId ? ctx.branchId : null }, post.originTenantId, type, { type: 'community_post', id: post.id, version: post.version }, { postId: post.id, ...payload }, trx);
  }
  /** alerts never undo a publication */
  private async published(post: PostRow): Promise<void> {
    if (!this.fanout) return;
    try { await this.fanout.advisoryPublished(post); } catch { /* the port promises not to throw; belt and braces */ }
  }
  private async changed(post: PostRow, change: Parameters<CommunityFanoutPort['advisoryChanged']>[1]): Promise<void> {
    if (!this.fanout) return;
    try { await this.fanout.advisoryChanged(post, change); } catch { /* best-effort */ }
  }

  private settingsView(s: Required<TenantSettingsRow>, ack: boolean): CommunitySettingsView {
    return {
      enabled: s.enabled, receptionistApprovalRequired: s.receptionistApprovalRequired, managerApprovalRequired: s.managerApprovalRequired,
      displayName: s.displayName, authorDisplay: s.authorDisplay, allowAnonymous: s.allowAnonymous, branchVisibility: s.branchVisibility,
      retentionDays: s.retentionDays, regionPreferences: s.regionPreferences, riskMatchingEnabled: s.riskMatchingEnabled,
      notify: { categories: s.notifyCategories as any, push: s.pushEnabled, email: s.emailEnabled, criticalSms: s.criticalSmsEnabled },
      roleGrants: s.roleGrants, roleRemovals: s.roleRemovals, version: s.exists ? s.version : 0,
      rulesVersion: COMMUNITY_RULES_VERSION, rulesAcknowledgedByMe: ack,
    };
  }

  /** THE safe tenant-facing shape (bug 9): no origin tenant / branch / user ids, no other salon's scan flags. */
  private async views(v: CoreViewerInfo, rows: PostRow[], detail: boolean): Promise<CommunityPostView[]> {
    if (!rows.length) return [];
    const flags = await this.repo.viewerFlags(v.ctx.tenantId, v.ctx.userId, rows.map((r) => r.id));
    const labels = new Map<string, string>();
    const out: CommunityPostView[] = [];
    for (const r of rows) {
      const key = `${r.originTenantId}|${r.authorDisplay}|${r.region}`;
      let label = r.authorLabel ?? labels.get(key);
      if (!label) { label = await this.labelFor(r); labels.set(key, label); }
      const own = r.originTenantId === v.ctx.tenantId;
      const f: ViewerFlags = flags.get(r.id) ?? { following: false, similar: false, evidenceCount: 0, evidenceReviewed: 0 };
      const author: CommunityAuthor = { label, isOwnSalon: own, anonymous: r.authorDisplay === 'anonymous' && label.startsWith('A salon') };
      const view: CommunityPostView = {
        id: r.id, title: r.title, body: r.redactedBody, category: r.category as any, severity: r.severity as any, status: r.status as any,
        verificationLabel: r.verificationLabel as any, region: r.region, incidentDate: r.incidentDate ?? null, scamMethod: r.scamMethod ?? null,
        channels: (r.channels ?? []) as any, recommendation: r.recommendation ?? null, tags: r.tags ?? [], paymentProcessor: r.paymentProcessor ?? null,
        amountRange: (r.amountRange ?? null) as any, officialReference: r.officialReference ?? null, author,
        counts: { comments: r.commentCount ?? 0, similar: r.similarCount ?? 0, followers: r.followerCount ?? 0 },
        publishedAt: r.publishedAt ?? null, lastActivityAt: r.lastActivityAt ?? null, resolvedAt: r.resolvedAt ?? null, resolutionNote: r.resolutionNote ?? null,
        commentsLocked: !!r.commentsLocked, following: f.following, similarReportedByMe: f.similar,
        evidence: { count: f.evidenceCount, reviewed: r.verificationLabel === 'evidence_reviewed' || f.evidenceReviewed > 0 },
        viewerActions: viewerActions(v, r), version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt ?? r.createdAt,
      };
      if (detail) {
        view.updates = (await this.repo.listUpdates(r.id)).map((u) => ({ id: u.id, body: u.redactedBody, createdAt: u.createdAt, author }));
        view.related = (await this.repo.listRelated(r.id)).map((x) => ({ id: x.id, title: x.title, relation: x.relation, severity: x.severity as any, publishedAt: x.publishedAt }));
      }
      out.push(view);
    }
    return out;
  }

  /** the posting salon's own view: adds the workflow detail (scan CATEGORIES, never the matched text) */
  private async myViews(v: CoreViewerInfo, rows: PostRow[]): Promise<CommunityMyPostView[]> {
    const base = await this.views(v, rows, false);
    const out: CommunityMyPostView[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      out.push({
        ...base[i],
        privacyScanFlags: [...r.privacyScanFlags], moderationRequired: r.moderationRequired, authorDisplay: r.authorDisplay ?? 'display_name',
        createdByMe: r.createdByUserId === v.ctx.userId,
        awaitingMyApproval: r.status === 'manager_approval' && v.capabilities.has('approve_advisory') && !v.restrictions.suspended && !v.restrictions.postingRestricted,
        returnReason: RETURNED.has(r.status) ? await this.repo.returnReason(r.id) : null,
        fromIncidentId: await this.repo.incidentForPost(v.ctx.tenantId, r.id),
      });
    }
    return out;
  }
}

// ── pure helpers ──

function viewerActions(v: CoreViewerInfo, r: PostRow): CommunityViewerActions {
  const own = r.originTenantId === v.ctx.tenantId;
  const live = r.visibility === 'community_published' && isCommunityVisible(r.status);
  const free = !v.restrictions.suspended;
  const posting = free && !v.restrictions.postingRestricted;
  const caps = v.capabilities;
  const ownLive = own && live && caps.has('submit_advisory') && posting && LIVE_EDITABLE(r.status);
  return {
    // the box shows before the rules are accepted — posting asks for them (the POST still refuses 403 rules_not_acknowledged)
    canComment: live && caps.has('comment') && !r.commentsLocked && free && !v.restrictions.commentingRestricted,
    canEdit: ownLive, canAddUpdate: ownLive, canResolve: ownLive,
    canReport: live && !own && free && caps.has('view_community'),
    canDispute: live && !own && free && (isPublishedState(r.status) || r.status === 'disputed'),
    canAppeal: own && APPROVER_ROLES.has(v.role) && (r.status === 'rejected' || r.status === 'removed'),
    canFollow: live && free && caps.has('view_community'),
    canUploadEvidence: own && free && caps.has('upload_evidence') && r.status !== 'removed' && r.status !== 'archived',
    canMarkSimilar: live && !own && free && caps.has('view_community'),
  };
}

function scanFields(input: AdvisoryFields): { fields: { title?: string; body?: string; scamMethod?: string | null; recommendation?: string | null; officialReference?: string | null; tags?: string[] }; categories: string[] } {
  const cats = new Set<string>();
  const one = (t: string | null | undefined) => { if (t == null) return t; const s = scanCommunityText(t); s.categories.forEach((c) => cats.add(c)); return s.redactedText; };
  const fields: any = {};
  if (input.title !== undefined) fields.title = one(input.title);
  if (input.body !== undefined) fields.body = one(input.body);
  if (input.scamMethod !== undefined) fields.scamMethod = one(input.scamMethod);
  if (input.recommendation !== undefined) fields.recommendation = one(input.recommendation);
  if (input.officialReference !== undefined) fields.officialReference = one(input.officialReference);
  if (input.tags !== undefined) fields.tags = (input.tags ?? []).map((t) => one(t) as string);
  return { fields, categories: [...cats] };
}
function scanOf(post: PostRow): CommunityScanResult {
  const flags = post.privacyScanFlags ?? [];
  return { redactedText: post.redactedBody, findings: [], blocked: flags.some((f) => BLOCK.has(f)), flagged: flags.length > 0, categories: flags as any };
}
function scanSummary(post: PostRow, flags: string[]): CommunityScanSummary {
  return { blocked: flags.some((f) => BLOCK.has(f)), flagged: flags.length > 0, categories: [...flags], redactedPreview: post.redactedBody };
}
function postText(post: PostRow): string { return [post.title, post.redactedBody, post.recommendation ?? '', post.scamMethod ?? ''].join('\n'); }
function wordingIssue(post: PostRow, officialReportReferenced: boolean): CommunityWordingIssue | null {
  const w = checkWording(postText(post), { officialReportReferenced, moderationApprovedWording: false });
  return w.requiresRewrite ? { matched: w.matched ?? '', suggestions: w.suggestions } : null;
}
function versionRow(p: PostRow, userId: string | null, changeNote: string | null) {
  return {
    postId: p.id, version: p.version, title: p.title, redactedBody: p.redactedBody, status: p.status, editedByUserId: userId && UUID_RE.test(userId) ? userId : null, changeNote,
    snapshot: { category: p.category, severity: p.severity, region: p.region, scamMethod: p.scamMethod ?? null, recommendation: p.recommendation ?? null, tags: p.tags ?? [], verificationLabel: p.verificationLabel, visibility: p.visibility },
  };
}
function workflowError(error: string, status: string): CommunityError {
  if (/role_required$/.test(error)) return new CommunityError('permission_denied', 403, { reason: error });
  return new CommunityError('invalid_state', 409, { status, reason: error });
}
function union(a: string[], b: string[]): string[] { return [...new Set([...a, ...b])]; }
function strip<T extends object>(o: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
function appealView(a: AppealRow): CommunityAppealView {
  return { id: a.id, postId: a.postId, subject: a.subject, reason: a.reason, status: a.status as CommunityAppealView['status'], decisionNote: a.decisionNote, createdAt: a.createdAt, decidedAt: a.decidedAt ?? null };
}
function incidentView(i: IncidentRow): CommunityIncidentView {
  return { id: i.id, branchId: i.branchId, category: i.category as any, severity: i.severity as any, occurredOn: i.occurredOn ?? null, rawDetail: i.rawDetail, advisoryPostId: i.advisoryPostId, createdAt: i.createdAt };
}
export type { WorkflowEvent };
