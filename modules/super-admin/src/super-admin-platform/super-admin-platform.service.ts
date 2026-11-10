// super-admin-platform.service.ts — business rules for applications, leads, hardware, and support access.
import { isPlatformRole, platformPermissionsFor } from '@aipowersalon/permissions';
import { normalizeIdentifier, verifyPassword, rateLimitDecision } from '@aipowersalon/auth';
import { tenantPred, type OverviewScope, type DB } from '@aipowersalon/database';
import { encryptField, decryptField } from './field-encryption';
import { APPLICATION_STATUSES, APPLICATION_PRIORITIES, APPLICATION_CONTACT_CHANNELS, canTransitionApplication } from './applications-lifecycle-core';
import { randomBytes } from 'node:crypto';
import { SELF_REQUESTABLE_ROLES, requestableRoles } from './access-request-core';   // batch 8 decision 6
import type { RequestableRolesResponse } from '@aipowersalon/api-contracts/tenant';
import { applyPerformanceQuery } from './tenant-performance-core';
import { portalUrl } from '@aipowersalon/config';
import { AutomationEngineService } from '@aipowersalon/platform';
import {
  toGatewayView, filterGateways, paginate, computeKpis, statusBreakdown, topProcessors, mapEvent, toCsv, maskMid,
  type GatewayFilters,
} from '@aipowersalon/payments';
import { deriveTxnStatus, maskCard, totalChargedCents, refundStatusLabel, settlementStatusLabel, maskEmail, maskPhone, assemblePaymentKpis, normalizeEventLabel, eventTone } from './payments-core';
// Every mutating action is written to audit_logs (action_type 'super_admin_*'), matching the tenants module.
import { Kysely, sql } from 'kysely';
import type { SuperAdminPlatformRepo, PlatformListQuery, NoteInput, AuditQuery, UsersQuery } from './super-admin-platform.repository';
import { ROLE_PERMISSIONS, definitionOf } from '@aipowersalon/permissions';
import type { ProviderSecrets } from '@aipowersalon/security';   // MFA secrets arrive through the MFA_SECRETS port (Constitution 13 §94)
import { matchedTotpStep, assertNotLastOwner, recordAuthorizationChange, StaffRoleError, LAST_OWNER } from '@aipowersalon/identity';
import { AI_FEATURE_KEYS } from '@aipowersalon/platform';
import { validateCreateBranch, type CreateBranchInput } from './branch-create-core';
import { buildMediaUrl } from '@aipowersalon/media';
import { validateAssignManager } from './branch-manager-core';
import { validateTransferRequest } from './branch-transfer-core';
import { rowsToCsv } from './branch-export-core';
import { validateWeeklyHours } from './branch-hours-core';
import { validateBulkStatus, summarizeBulk } from './branch-bulk-core';
import { validateAllocateDevice } from './branch-device-core';
import { validateStatusChange } from './branch-lifecycle-core';
import { usersExportCsv, usersExportFilename } from './users-export-core';
import { acceptUrl } from '@aipowersalon/identity';
import { InvitationDelivery } from '@aipowersalon/identity';
import { buildInvitationDeliveryPayload, deliveryStatusFor } from '@aipowersalon/identity';
import { nextRunAt as computeNextRun, isCadence, isSupportedReport, CADENCES } from './scheduled-reports-core';
import { canMoveToSql } from '@aipowersalon/database';
import { USER_ACCOUNT } from '@aipowersalon/identity';
import type { CredentialDelivery, DeliveryMethod } from '../admin-credential-delivery';
import { platformHierarchyDecision } from './platform-user-hierarchy';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/** wave 4 pilot: the staff roles a SALON may invite itself (RECEPTIONIST is the front-desk word for RECEPTION). */
const SALON_INVITE_ROLES: Record<string, string> = { RECEPTION: 'RECEPTION', RECEPTIONIST: 'RECEPTION', FRONT_DESK: 'FRONT_DESK', MANAGER: 'MANAGER' };

export class PlatformError extends Error { constructor(public code: 'invalid' | 'not_found' | 'rate_limited' | 'forbidden' | 'conflict' | 'gone' | 'unavailable', message: string, public reason?: string) { super(message); } }

/** Security Deep Scan C2: a Super Admin-initiated reset states why (audited), like every other sensitive platform action. */
export const MIN_RESET_REASON = 10;

// Common disposable-email providers (transparent flag only — submissions are saved and reviewed, never auto-rejected).
const DISPOSABLE_EMAIL_DOMAINS = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com']);
// Coarse USPS first-3-digit ZIP prefix ranges by state (flag-only: a mismatch is a review reason, NEVER a block;
// the table is intentionally coarse — enclave prefixes inside another state's range produce false NEGATIVES only).
const STATE_ZIP_PREFIX_RANGES: Record<string, [number, number][]> = {
  AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729]], CA: [[900, 961]], CO: [[800, 816]],
  CT: [[60, 69]], DE: [[197, 199]], DC: [[200, 205], [569, 569]], FL: [[320, 349]], GA: [[300, 319], [398, 399]],
  HI: [[967, 968]], ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]], IA: [[500, 528]], KS: [[660, 679]],
  KY: [[400, 427]], LA: [[700, 714]], ME: [[39, 49]], MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]],
  MN: [[550, 567]], MS: [[386, 397]], MO: [[630, 658]], MT: [[590, 599]], NE: [[680, 693]], NV: [[889, 898]],
  NH: [[30, 38]], NJ: [[70, 89]], NM: [[870, 884]], NY: [[5, 5], [100, 149]], NC: [[270, 289]], ND: [[580, 588]],
  OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]], PA: [[150, 196]], RI: [[28, 29]], SC: [[290, 299]],
  SD: [[570, 577]], TN: [[370, 385]], TX: [[733, 733], [750, 799], [885, 885]], UT: [[840, 847]],
  VT: [[50, 59]], VA: [[201, 201], [220, 246]], WA: [[980, 994]], WV: [[247, 268]], WI: [[530, 549]],
  WY: [[820, 831]], PR: [[6, 9]], VI: [[8, 8]], GU: [[969, 969]], AE: [[90, 98]], AA: [[340, 340]], AP: [[962, 966]],
};
// Extract link domains from free text (http(s):// or www.) — a classic spam tell in an application message.
function linkDomainsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/(?:https?:\/\/|www\.)([a-z0-9.-]+\.[a-z]{2,})/gi)) out.add(m[1].toLowerCase());
  return [...out];
}
const SUSPICIOUS_PHONES = new Set(['1234567890', '0123456789', '9876543210']);
const APP_STATUSES = ['new', 'reviewing', 'qualified', 'not_qualified', 'demo_scheduled', 'approved', 'converted', 'archived'];
const LEAD_STATUSES = ['new', 'contacted', 'demo_scheduled', 'converted_to_application', 'archived', 'spam'];
const LEAD_KINDS = ['demo_request', 'contact', 'free_package', 'newsletter'];
const HW_STATUSES = ['not_started', 'pending_approval', 'ordered', 'ready', 'delivered', 'installed', 'activated', 'on_hold', 'cancelled'];

export interface AdminCtx { permissions?: string[]; userId?: string; email?: string; ip?: string }

// Appointment Oversight controlled-support actions (§25/§36). Each one a salon would normally perform; under
// Super Admin they are permitted ONLY inside an active support session and every one is written to audit_logs.
const APPT_SUPPORT_ACTIONS = new Set([
  'appointment_rescheduled', 'appointment_cancelled', 'technician_reassigned', 'duplicate_resolved',
  'conflict_resolved', 'reminder_retried', 'sync_retried', 'deposit_corrected', 'confirmation_corrected', 'note_added',
]);

// Customer Data Oversight controlled-support actions (§9/§37). Sensitive customer-data actions a salon would normally
// own; under Super Admin they are permitted ONLY inside an active support session for the tenant and every one — most
// importantly a PII reveal — is written to audit_logs.
const CUSTOMER_SUPPORT_ACTIONS = new Set([
  'pii_revealed', 'customer_exported', 'duplicate_resolved', 'duplicate_marked_not', 'customer_merged', 'merge_reversed',
  'privacy_request_opened', 'privacy_request_completed', 'consent_changed', 'data_corrected', 'customer_anonymized', 'segment_changed', 'note_added',
]);

// Customer privacy requests (§27). Types + lifecycle statuses; 'overdue' is derived, not a stored status.
const PRIVACY_REQUEST_TYPES = new Set(['access', 'correct', 'export', 'delete', 'anonymize', 'restrict', 'withdraw_consent', 'opt_out_marketing']);
const PRIVACY_STATUSES = new Set(['new', 'identity_verification_required', 'verified', 'in_review', 'tenant_action_required', 'processing', 'completed', 'rejected', 'cancelled']);
const PRIVACY_TERMINAL = new Set(['completed', 'rejected', 'cancelled']);

/** Structural slice of OnboardingService used for approval → onboarding conversion (kept narrow so specs stay Nest-free). */
export interface OnboardingConvertLike {
  createApplication(ctx: unknown, input: { applicationId: string; applicationType?: 'new_tenant' | 'new_branch'; priority?: 'low' | 'normal' | 'high' | 'urgent'; specialistUserId?: string | null }): Promise<any>;
  /** the onboarding case learns the tenant its application became (optional: older wirings lack it) */
  linkTenant?(ctx: unknown, onboardingId: string, tenantId: string): Promise<unknown>;
}

export class SuperAdminPlatformService {
  constructor(private readonly repo: SuperAdminPlatformRepo, private readonly db?: Kysely<DB>, private readonly onboarding?: OnboardingConvertLike, private readonly confirmations?: { sendConfirmation(app: unknown): Promise<void> }, private readonly mfaSecrets?: ProviderSecrets,
              /** C2 / A3: delivers a temporary password to the ACCOUNT HOLDER only (email / SMS). Absent → resets are refused. */
              private readonly credentials?: CredentialDelivery) {}

  /** A3: the target of a generic Users action, refused when it is a platform account of equal or higher rank (or yourself). */
  private async actionTarget(ctx: AdminCtx, id: string, action: string): Promise<any> {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const u: any = await this.repo.userById(id);
    if (!u) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    const d = platformHierarchyDecision({ userId: ctx.userId, permissions: ctx.permissions }, { id: String(u.id ?? id), role: u.role ?? null, platformRole: u.platform_role ?? null }, action);
    if (!d.ok) throw new PlatformError('forbidden', d.message, d.code === 'rank' ? 'PLATFORM_RANK_REQUIRED' : undefined);
    return u;
  }
  /** C2: send the temporary password to the account's own email / phone — never to the caller. */
  private async deliverToHolder(u: any, method: DeliveryMethod | undefined, context: 'user_reset' | 'invite_resend') {
    if (!this.credentials) throw new PlatformError('unavailable', 'Password delivery is not configured on this server, so nothing was changed.', 'CANNOT_DELIVER');
    const out = await this.credentials.deliverTemporaryPassword({ userId: String(u.id), email: u.email ?? null, phone: u.normalized_phone ?? null }, method ?? 'auto', context);
    if (!out.ok) throw new PlatformError('unavailable', out.message, out.code);
    return out;
  }

  /** `scope` (wave 4 pilot): a salon-side action through this service (the salon inviting its own staff) is audited
   *  against that salon, with the actor's own role — not as a platform Super Admin action. */
  private async audit(ctx: AdminCtx, action: string, entityType: string, entityId: string, meta?: Record<string, unknown>, scope?: { tenantId: string; actorRole: string }) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({
      id: sql`gen_random_uuid()` as any, tenant_id: (scope?.tenantId ?? null) as any, user_id: (ctx.userId || null) as any, role: scope?.actorRole ?? 'SUPER_ADMIN',
      action_type: action, entity_type: entityType, entity_id: entityId, metadata_json: JSON.stringify(meta || {}) as any,
    } as any).execute().catch(() => { /* auditing must not break the action; failures surface in health checks */ });
  }

  // ---- tenant applications ----
  applications(q: PlatformListQuery) { return this.repo.applications(q); }
  async createApplication(ctx: AdminCtx, input: any) {
    if (!input?.salon_name || !input?.owner_name) throw new PlatformError('invalid', 'salon_name and owner_name are required.');
    const r = await this.repo.createApplication({
      salon_name: String(input.salon_name), owner_name: String(input.owner_name),
      phone: input.phone ?? null, email: input.email ?? null, city: input.city ?? null, state: input.state ?? null,
      technicians_count: Number.isFinite(+input.technicians_count) ? +input.technicians_count : null,
      current_pos: input.current_pos ?? null, current_processor: input.current_processor ?? null,
      monthly_card_volume_cents: Number.isFinite(+input.monthly_card_volume_cents) ? Math.round(+input.monthly_card_volume_cents) : null,
      preferred_imac_color: input.preferred_imac_color ?? null, source: input.source ?? null,
    });
    await this.audit(ctx, 'super_admin_application_created', 'tenant_application', String(r.id), { salon: r.salon_name });
    return r;
  }
  async setApplicationStatus(ctx: AdminCtx, id: string, status: string, meta?: { note?: string; reason?: string }) {
    if (!APPLICATION_STATUSES.includes(status as any)) throw new PlatformError('invalid', `status must be one of ${APPLICATION_STATUSES.join(', ')}.`);
    const cur = await this.repo.getApplication(id);
    if (!cur) throw new PlatformError('not_found', 'Application not found.');
    const fromStatus = String(cur.status); // captured BEFORE the write — the in-memory driver returns the live row object
    if (!canTransitionApplication(fromStatus, status)) throw new PlatformError('invalid', `Cannot move an application from ${fromStatus} to ${status}.`);
    const stamps: Record<string, unknown> = { status, record_version: Number(cur.record_version || 1) + 1 };
    if (status === 'approved') stamps.approved_at = new Date();
    if (status === 'rejected') stamps.rejected_at = new Date();
    if (status === 'archived') stamps.archived_at = new Date();
    const r = await this.repo.updateApplication(id, stamps);
    if (!r) throw new PlatformError('not_found', 'Application not found.');
    const hist = `Status: ${fromStatus} \u2192 ${status}` + (meta?.reason ? ` \u2014 ${String(meta.reason).slice(0, 300)}` : '') + (meta?.note ? ` \u2014 ${String(meta.note).slice(0, 300)}` : '');
    await this.repo.appendApplicationNote(id, { text: hist, by: ctx.userId || 'super-admin' });
    // approving the free-hardware offer opens its hardware-package record automatically (spec: Approve Package)
    if (status === 'approved') {
      const hw = await this.repo.createHardware({ application_id: id, imac_color: r.preferred_imac_color ?? null, status: 'pending_approval' });
      await this.audit(ctx, 'super_admin_hardware_created', 'hardware_package', String(hw.id), { applicationId: id, auto: true });
      // Emit the MERCHANT_APPLICATION_APPROVED domain event into the automation engine. Fire-and-forget + guarded:
      // automation must never break the approval flow. Idempotent per application (eventId derived from the id).
      if (this.db) {
        const engine = new AutomationEngineService(this.db);
        engine.ingestEvent({ eventId: `merchant-approved|${id}`, type: 'MERCHANT_APPLICATION_APPROVED', tenantId: null, entityId: String(id), entityType: 'tenant_application', triggeredBy: 'super_admin', payload: { status: 'approved', salon: r.salon_name } })
          .catch(() => { /* automation is best-effort; approval already committed */ });
      }
    }
    await this.audit(ctx, 'super_admin_application_status', 'tenant_application', id, { from: fromStatus, to: status, reason: meta?.reason, note: meta?.note });
    return r;
  }
  // ---- application review workflow (Free POS Package intake spec) ------------------------------------------------
  private async appOr404(id: string) { const r = await this.repo.getApplication(id); if (!r) throw new PlatformError('not_found', 'Application not found.'); return r; }
  private async touchApp(ctx: AdminCtx, id: string, patch: Record<string, unknown>, history: string, action: string, meta?: Record<string, unknown>) {
    const cur = await this.appOr404(id);
    const r = await this.repo.updateApplication(id, { ...patch, record_version: Number(cur.record_version || 1) + 1 });
    await this.repo.appendApplicationNote(id, { text: history, by: ctx.userId || 'super-admin' });
    await this.audit(ctx, action, 'tenant_application', id, meta);
    return r;
  }
  async assignApplication(ctx: AdminCtx, id: string, userId: string | null) {
    const uid = userId ? String(userId).slice(0, 64) : null;
    return this.touchApp(ctx, id, { assigned_to_user_id: uid }, uid ? `Assigned reviewer ${uid}` : 'Reviewer unassigned', 'super_admin_application_assigned', { userId: uid });
  }
  async setApplicationPriority(ctx: AdminCtx, id: string, priority: string) {
    if (!APPLICATION_PRIORITIES.includes(priority as any)) throw new PlatformError('invalid', `priority must be one of ${APPLICATION_PRIORITIES.join(', ')}.`);
    return this.touchApp(ctx, id, { priority }, `Priority set to ${priority}`, 'super_admin_application_priority', { priority });
  }
  async scheduleApplicationFollowUp(ctx: AdminCtx, id: string, at: string | null) {
    let when: Date | null = null;
    if (at) { when = new Date(at); if (Number.isNaN(when.getTime())) throw new PlatformError('invalid', 'follow-up date is not a valid date.'); }
    return this.touchApp(ctx, id, { follow_up_at: when }, when ? `Follow-up scheduled for ${when.toISOString()}` : 'Follow-up cleared', 'super_admin_application_follow_up', { at: when?.toISOString() ?? null });
  }
  async logApplicationContact(ctx: AdminCtx, id: string, input: { channel?: string; note?: string }) {
    const channel = String(input?.channel || '');
    if (!APPLICATION_CONTACT_CHANNELS.includes(channel as any)) throw new PlatformError('invalid', `channel must be one of ${APPLICATION_CONTACT_CHANNELS.join(', ')}.`);
    const note = input?.note ? String(input.note).slice(0, 1000) : '';
    return this.touchApp(ctx, id, { last_contacted_at: new Date() }, `Contact logged (${channel})${note ? ': ' + note : ''}`, 'super_admin_application_contact', { channel });
  }
  /** Approval requires an explicit note and revalidates that no tenant is already linked. Side effects (hardware
   *  record + automation event) run via the same setApplicationStatus path the existing screen uses. */
  async approveApplication(ctx: AdminCtx, id: string, input: { note?: string }) {
    const note = String(input?.note || '').trim();
    if (note.length < 3) throw new PlatformError('invalid', 'An approval note is required.');
    const cur = await this.appOr404(id);
    if (cur.converted_tenant_id) throw new PlatformError('invalid', 'This application is already linked to a tenant.');
    return this.setApplicationStatus(ctx, id, 'approved', { note });
  }
  async rejectApplication(ctx: AdminCtx, id: string, input: { reason?: string }) {
    const reason = String(input?.reason || '').trim();
    if (reason.length < 3) throw withCode(new PlatformError('invalid', 'A rejection reason is required.'), 'REJECTION_REASON_REQUIRED');
    return this.setApplicationStatus(ctx, id, 'rejected', { reason });
  }
  async markApplicationDuplicate(ctx: AdminCtx, id: string, input?: { reason?: string }) { return this.setApplicationStatus(ctx, id, 'duplicate', { reason: input?.reason }); }
  async markApplicationSpam(ctx: AdminCtx, id: string, input?: { reason?: string }) { return this.setApplicationStatus(ctx, id, 'spam', { reason: input?.reason }); }
  async archiveApplication(ctx: AdminCtx, id: string) { return this.setApplicationStatus(ctx, id, 'archived'); }
  /** Masked-by-default: EIN decrypts ONLY here, permission-gated at the route, and every reveal is audited. */
  async revealApplicationEin(ctx: AdminCtx, id: string) {
    const r = await this.appOr404(id);
    await this.audit(ctx, 'super_admin_application_ein_viewed', 'tenant_application', id, { last4: r.ein_last4 ?? null });
    if (!r.ein_encrypted) return { ok: true, ein: null, last4: r.ein_last4 ?? null, reason: r.ein_last4 ? 'encryption key not configured at intake' : 'no EIN provided' };
    const plain = decryptField(String(r.ein_encrypted));
    return { ok: true, ein: plain, last4: r.ein_last4 ?? null, ...(plain ? {} : { reason: 'decryption unavailable (key missing or changed)' }) };
  }

  /** Intake metrics (spec: real backend data only; null where genuinely untracked \u2014 the UI renders "\u2014").
   *  avgFirstResponseHours is null: only the LATEST contact timestamp is stored today, so a true first-response
   *  average cannot be computed honestly. */
  async applicationMetrics(_ctx: AdminCtx) {
    const rows = await this.repo.applicationMetricsRows();
    const now = Date.now();
    const day = 86_400_000;
    const ts = (v: Date | string | null | undefined): number | null => { if (!v) return null; const t = new Date(v as any).getTime(); return Number.isNaN(t) ? null : t; };
    const byStatus: Record<string, number> = {};
    const bump = (m: Record<string, number>, k: string | null | undefined) => { const key = String(k || '').trim(); if (!key) return; m[key] = (m[key] || 0) + 1; };
    const bySource: Record<string, number> = {}; const byState: Record<string, number> = {};
    const byVolumeBand: Record<string, number> = {}; const byCurrentPos: Record<string, number> = {}; const byCurrentProcessor: Record<string, number> = {};
    const reviewerWorkload: Record<string, number> = {};
    const OPEN = new Set(['new', 'under_review', 'reviewing', 'contact_attempted', 'contacted', 'info_requested', 'awaiting_applicant', 'demo_scheduled', 'qualified']);
    const CONVERTED = new Set(['converted', 'converted_tenant', 'converted_onboarding']);
    let received7 = 0; let received30 = 0; let dupFlagged = 0; let followUpsOverdue = 0;
    const approvalHours: number[] = [];
    for (const r of rows) {
      bump(byStatus, r.status);
      bump(bySource, r.source); bump(byState, r.state); bump(byVolumeBand, r.card_volume_band);
      bump(byCurrentPos, r.current_pos); bump(byCurrentProcessor, r.current_processor);
      const created = ts(r.created_at);
      if (created != null) { if (now - created <= 7 * day) received7++; if (now - created <= 30 * day) received30++; }
      if (Number(r.duplicate_risk_score || 0) > 0) dupFlagged++;
      const fu = ts(r.follow_up_at);
      if (fu != null && fu < now && OPEN.has(String(r.status))) followUpsOverdue++;
      if (OPEN.has(String(r.status)) && r.assigned_to_user_id) bump(reviewerWorkload, r.assigned_to_user_id);
      const approved = ts(r.approved_at);
      if (created != null && approved != null && approved >= created) approvalHours.push((approved - created) / 3_600_000);
    }
    const total = rows.length;
    const converted = rows.filter((r) => CONVERTED.has(String(r.status))).length;
    const top = (m: Record<string, number>, n = 6) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
    return {
      total, received7, received30, byStatus,
      open: rows.filter((r) => OPEN.has(String(r.status))).length,
      approved: byStatus['approved'] || 0, rejected: byStatus['rejected'] || 0,
      duplicatesFlagged: dupFlagged, spam: byStatus['spam'] || 0,
      converted, conversionRatePct: total ? Math.round((converted / total) * 1000) / 10 : null,
      avgApprovalHours: approvalHours.length ? Math.round((approvalHours.reduce((a, b) => a + b, 0) / approvalHours.length) * 10) / 10 : null,
      avgFirstResponseHours: null,
      followUpsOverdue,
      bySource: top(bySource), byState: top(byState), byVolumeBand: top(byVolumeBand),
      byCurrentPos: top(byCurrentPos), byCurrentProcessor: top(byCurrentProcessor),
      reviewerWorkload: top(reviewerWorkload, 10),
    };
  }

  async noteApplication(ctx: AdminCtx, id: string, note: NoteInput) {
    if (!note?.text) throw new PlatformError('invalid', 'Note text is required.');
    const r = await this.repo.appendApplicationNote(id, { text: String(note.text), by: ctx.email || ctx.userId });
    if (!r) throw new PlatformError('not_found', 'Application not found.');
    await this.audit(ctx, 'super_admin_application_note', 'tenant_application', id);
    return r;
  }
  /** Marks an application converted to a REAL tenant. The tenant itself is created through the existing, fully-audited
   *  Create Tenant flow (super-admin-tenants); this links the two — no duplicate tenant-creation path. */
  async markApplicationConverted(ctx: AdminCtx, id: string, tenantId: string) {
    if (!tenantId) throw new PlatformError('invalid', 'tenantId of the created tenant is required.');
    const cur = await this.appOr404(id);
    const fromStatus = String(cur.status);
    if (cur.converted_tenant_id && cur.converted_tenant_id !== tenantId) throw new PlatformError('invalid', `This application is already linked to tenant ${cur.converted_tenant_id}.`);
    if (!canTransitionApplication(fromStatus, 'converted')) throw new PlatformError('invalid', `Cannot move an application from ${fromStatus} to converted.`);
    const r = await this.repo.updateApplication(id, { status: 'converted', converted_tenant_id: tenantId, record_version: Number(cur.record_version || 1) + 1 });
    if (!r) throw new PlatformError('not_found', 'Application not found.');
    await this.repo.appendApplicationNote(id, { text: `Status: ${fromStatus} \u2192 converted \u2014 tenant ${tenantId}`, by: ctx.userId || 'super-admin' });
    // The onboarding case opened from this application now belongs to that tenant. Without this its tenantId stayed
    // null forever: the ONBOARDING_COMPLETED event carried no tenant and the case's audit rows were never written
    // (wave 4 PILOT, Oct 13 2026).
    if (cur.onboarding_id && this.onboarding?.linkTenant) await this.onboarding.linkTenant(ctx, String(cur.onboarding_id), tenantId);
    await this.audit(ctx, 'super_admin_application_converted', 'tenant_application', id, { from: fromStatus, tenantId });
    return r;
  }

  /** Approval → Onboarding: opens the 14-stage onboarding case for an APPROVED application. The application row
   *  stays the immutable source record (nothing is moved or deleted; the onboarding record carries workflow state
   *  only — per spec, no processor/hardware credentials exist at this point). Double-start is rejected by the
   *  onboarding module's own applicationId conflict guard. */
  async convertApplicationToOnboarding(ctx: AdminCtx, id: string) {
    if (!this.onboarding) throw new PlatformError('invalid', 'Onboarding is not available in this deployment.');
    const cur = await this.appOr404(id);
    const fromStatus = String(cur.status);
    if (!canTransitionApplication(fromStatus, 'converted_onboarding')) throw new PlatformError('invalid', `Cannot start onboarding from status ${fromStatus} \u2014 approve the application first.`);
    if (cur.onboarding_id) throw new PlatformError('invalid', 'Onboarding has already been started for this application.');
    let rec: any;
    try {
      rec = await this.onboarding.createApplication(ctx, {
        applicationId: String(id), applicationType: 'new_tenant',
        priority: (['low', 'normal', 'high', 'urgent'].includes(String(cur.priority)) ? cur.priority : undefined) as any,
        specialistUserId: cur.assigned_to_user_id ?? null,
      });
    } catch (e: any) {
      throw new PlatformError('invalid', String(e?.message || 'Could not start onboarding.'));
    }
    const onboardingId = String(rec?.id || '');
    const r = await this.repo.updateApplication(id, { status: 'converted_onboarding', onboarding_id: onboardingId || null, record_version: Number(cur.record_version || 1) + 1 });
    await this.repo.appendApplicationNote(id, { text: `Status: ${fromStatus} \u2192 converted_onboarding \u2014 onboarding ${onboardingId}`, by: ctx.userId || 'super-admin' });
    await this.audit(ctx, 'super_admin_application_onboarding_started', 'tenant_application', id, { from: fromStatus, onboardingId });
    return r;
  }

  // ---- website leads ----
  leads(q: PlatformListQuery) { return this.repo.leads(q); }
  async createLead(ctx: AdminCtx, input: any) {
    const kind = LEAD_KINDS.includes(input?.kind) ? input.kind : 'contact';
    const r = await this.repo.createLead({
      kind, name: input?.name ?? null, salon_name: input?.salon_name ?? null, phone: input?.phone ?? null,
      email: input?.email ?? null, city: input?.city ?? null, state: input?.state ?? null,
      source_page: input?.source_page ?? null, message: input?.message ?? null,
    });
    await this.audit(ctx, 'super_admin_lead_created', 'website_lead', String(r.id), { kind });
    return r;
  }
  async setLeadStatus(ctx: AdminCtx, id: string, status: string) {
    if (!LEAD_STATUSES.includes(status)) throw new PlatformError('invalid', `status must be one of ${LEAD_STATUSES.join(', ')}.`);
    const r = await this.repo.updateLead(id, { status });
    if (!r) throw new PlatformError('not_found', 'Lead not found.');
    await this.audit(ctx, 'super_admin_lead_status', 'website_lead', id, { status });
    return r;
  }
  /** Convert a lead into a tenant application (spec action), carrying contact fields over and linking back. */
  async convertLead(ctx: AdminCtx, id: string) {
    const { rows } = await this.repo.leads({ page: 1, pageSize: 100 });
    const lead = rows.find((l: any) => String(l.id) === id);
    if (!lead) throw new PlatformError('not_found', 'Lead not found.');
    if (lead.status === 'converted_to_application' && lead.application_id) throw new PlatformError('invalid', 'Lead was already converted.');
    const app = await this.createApplication(ctx, {
      salon_name: lead.salon_name || lead.name || 'Unknown Salon', owner_name: lead.name || 'Unknown',
      phone: lead.phone, email: lead.email, city: lead.city, state: lead.state, source: lead.source_page || `lead:${lead.kind}`,
    });
    await this.repo.updateLead(id, { status: 'converted_to_application', application_id: app.id });
    await this.audit(ctx, 'super_admin_lead_converted', 'website_lead', id, { applicationId: String(app.id) });
    return { lead: { ...lead, status: 'converted_to_application', application_id: app.id }, application: app };
  }

  // ---- hardware packages ----
  hardware(q: PlatformListQuery) { return this.repo.hardware(q); }
  async createHardware(ctx: AdminCtx, input: any) {
    const r = await this.repo.createHardware({
      tenant_id: input?.tenant_id ?? null, application_id: input?.application_id ?? null,
      imac_color: input?.imac_color ?? null, status: HW_STATUSES.includes(input?.status) ? input.status : 'not_started',
    });
    await this.audit(ctx, 'super_admin_hardware_created', 'hardware_package', String(r.id));
    return r;
  }
  async updateHardware(ctx: AdminCtx, id: string, patch: any) {
    const allowed: Record<string, unknown> = {};
    if (patch?.status !== undefined) { if (!HW_STATUSES.includes(patch.status)) throw new PlatformError('invalid', `status must be one of ${HW_STATUSES.join(', ')}.`); allowed.status = patch.status; if (patch.status === 'delivered') allowed.delivered_at = new Date(); if (patch.status === 'activated') allowed.activated_at = new Date(); }
    for (const k of ['tenant_id', 'imac_color', 'imac_serial', 'clover_flex_serial', 'checkin_display_serial'] as const) if (patch?.[k] !== undefined) allowed[k] = patch[k];
    if (patch?.agreement_status !== undefined) { if (!['pending', 'sent', 'signed'].includes(patch.agreement_status)) throw new PlatformError('invalid', 'agreement_status must be pending|sent|signed.'); allowed.agreement_status = patch.agreement_status; }
    if (patch?.payment_setup_status !== undefined) { if (!['pending', 'in_progress', 'complete'].includes(patch.payment_setup_status)) throw new PlatformError('invalid', 'payment_setup_status must be pending|in_progress|complete.'); allowed.payment_setup_status = patch.payment_setup_status; }
    if (!Object.keys(allowed).length) throw withCode(new PlatformError('invalid', 'Nothing to update.'), 'NOTHING_TO_UPDATE');
    const r = await this.repo.updateHardware(id, allowed);
    if (!r) throw new PlatformError('not_found', 'Hardware package not found.');
    await this.audit(ctx, 'super_admin_hardware_updated', 'hardware_package', id, allowed as any);
    return r;
  }

  // ---- support access (spec §15: reason + time limit mandatory; STEP-UP password (+MFA if enrolled); audited) ----
  /** Re-confirms the acting super admin's identity: password always; TOTP too when a confirmed factor exists.
   *  Reuses login's exact primitives — scrypt verifyPassword, mfa-enc decrypt, matchedTotpStep, and the same
   *  monotonic last_used_step replay guard on mfa_factors. Returns which factors were confirmed. */
  private async stepUpVerify(ctx: AdminCtx, password?: string, mfaCode?: string): Promise<'password' | 'password+mfa'> {
    if (!this.db) throw new PlatformError('invalid', 'Step-up confirmation requires the database-backed deployment.');
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const u: any = await (this.db as any).selectFrom('users').select(['password_hash']).where('id', '=', ctx.userId).executeTakeFirst().catch(() => undefined);
    const okPw = !!u?.password_hash && !!password && (await verifyPassword(String(password), String(u.password_hash)));
    if (!okPw) throw new PlatformError('invalid', 'Password confirmation failed.');
    const f: any = await (this.db as any).selectFrom('mfa_factors').select(['secret_enc'])
      .where('user_id', '=', ctx.userId).where('type', '=', 'totp').where('confirmed', '=', true)
      .orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined);
    if (!f?.secret_enc) return 'password';
    let secret: string;
    // No MFA_SECRETS wired means the factor cannot be read — refuse, never skip the second factor.
    if (!this.mfaSecrets) throw new PlatformError('invalid', 'MFA factor could not be read.');
    try { secret = this.mfaSecrets.decrypt(String(f.secret_enc)); } catch { throw new PlatformError('invalid', 'MFA factor could not be read.'); }
    const step = matchedTotpStep(secret, String(mfaCode || ''), Date.now());
    if (step === null) throw withCode(new PlatformError('invalid', 'MFA code confirmation failed.'), 'MFA_CODE_FAILED');
    const res: any = await (this.db as any).updateTable('mfa_factors')
      .set({ last_used_step: step })
      .where('user_id', '=', ctx.userId).where('type', '=', 'totp').where('confirmed', '=', true)
      .where((eb: any) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
      .executeTakeFirst().catch(() => undefined);
    if (!res || Number(res.numUpdatedRows ?? 0) === 0) throw withCode(new PlatformError('invalid', 'That MFA code was already used — wait for the next code.'), 'MFA_CODE_REUSED');
    return 'password+mfa';
  }

  /**
   * Constitution 7 §74–§81 — start a Support Mode session.
   *  • reason: at least 10 characters (§74 "Open Support Case or Reason");
   *  • duration: 15–60 minutes (§77 short default; no long or permanent access);
   *  • scope class (§81): READ_ONLY (default) / STANDARD_SUPPORT / ELEVATED_SUPPORT — elevated needs the tenant-edit
   *    permission as well, so PLATFORM_SUPPORT alone cannot open a write session (§76 least privilege);
   *  • step-up (§8) is the route's @RequireStepUp on THIS session — this method used to demand the password in the body,
   *    which the Support Access screen never sent, so every start from that screen failed with "Password confirmation
   *    failed".
   */
  async startSupport(ctx: AdminCtx, input: any) {
    const reason = String(input?.reason || '').trim();
    const minutes = Math.round(+input?.minutes);
    const scope = supportScopeFrom(input?.scope ?? input?.accessLevel);
    if (!input?.tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (reason.length < 10) throw new PlatformError('invalid', 'A reason of at least 10 characters is required for support access.');
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 60) throw new PlatformError('invalid', 'Support sessions last 15–60 minutes.');
    if (!scope) throw new PlatformError('invalid', 'Choose a support scope: READ_ONLY, STANDARD_SUPPORT or ELEVATED_SUPPORT.');
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (scope === 'ELEVATED_SUPPORT' && !ctx.permissions?.includes('super_admin.tenants.edit')) {
      throw new PlatformError('forbidden', 'Elevated support needs the tenant-edit permission (super_admin.tenants.edit).');
    }
    const branchId = input?.branchId ? String(input.branchId).trim() : null;
    const r = await this.repo.startSupportSession({ tenantId: String(input.tenantId), adminUserId: ctx.userId, adminEmail: ctx.email, reason, minutes, scope });
    await this.audit(ctx, 'super_admin_support_access_started', 'support_access_session', String(r.id), { tenantId: input.tenantId, branchId, reason, minutes, scope, stepUp: 'session_step_up' });
    return r;
  }
  /** Constitution 7 §75 — the caller's own live Support Mode sessions (the SUPPORT MODE banner). */
  async mySupportSessions(ctx: AdminCtx) {
    if (!ctx.userId || !this.repo.mySupportSessions) return [];
    return this.repo.mySupportSessions(ctx.userId);
  }
  /** Constitution 7 §78 — extend the caller's own live session: reason, 15–60 min, ≤2 extensions, ≤2 h total; audited; owner told. */
  async extendSupport(ctx: AdminCtx, id: string, input: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!this.repo.extendSupportSession) throw new PlatformError('invalid', 'Extending support sessions needs the database.');
    const minutes = Math.round(+input?.minutes); const reason = String(input?.reason ?? '').trim();
    const r = await this.repo.extendSupportSession(id, ctx.userId, minutes, reason);
    if (!r.ok) throw new PlatformError(r.notFound ? 'not_found' : 'invalid', r.error);
    await this.audit(ctx, 'super_admin_support_access_extended', 'support_access_session', id, { tenantId: r.tenantId, source: r.source, minutes, reason, expiresAt: r.expiresAt, extensionCount: r.extensionCount });
    return r;
  }
  async endSupport(ctx: AdminCtx, id: string) {
    const r = await this.repo.endSupportSession(id, ctx.userId);
    if (!r) throw new PlatformError('not_found', 'No active support session with that id.');
    await this.audit(ctx, 'super_admin_support_access_ended', 'support_access_session', id);
    return r;
  }
  supportSessions(activeOnly: boolean) { return this.repo.supportSessions(activeOnly); }

  /** Records a controlled Appointment Oversight support action (§25/§36). Normal Super Admin access is read-only;
   *  a salon-operating action on an appointment is permitted ONLY inside an active support session for that tenant,
   *  always carries a reason, and is written to audit_logs with before/after. Performing the underlying mutation in
   *  the tenant's appointment engine is a separate, permission-gated step; this method is the mandatory audit gate. */
  async recordSupportAction(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const appointmentId = String(input?.appointmentId || '').trim();
    const action = String(input?.action || '').trim();
    const reason = String(input?.reason || '').trim();
    const branchId = input?.branchId ? String(input.branchId).trim() : null;
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!appointmentId) throw new PlatformError('invalid', 'appointmentId is required.');
    if (!APPT_SUPPORT_ACTIONS.has(action)) throw new PlatformError('invalid', 'Unsupported support action.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required to record a support action.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open Appointment Support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    await this.audit(ctx, 'super_admin_appointment_support_action', 'appointment', appointmentId, {
      sessionId, tenantId, branchId, action, reason, before: input?.before ?? null, after: input?.after ?? null,
    });
    return { ok: true, sessionId, tenantId, branchId, appointmentId, action };
  }

  /** Records a controlled Customer Data Oversight support action (§9/§37). Normal Super Admin access is read-only and
   *  PII is masked; revealing PII, exporting, merging duplicates, opening privacy cases, changing consent or anonymizing
   *  a customer is permitted ONLY inside an active support session for that tenant, always carries a reason, and is
   *  written to audit_logs with before/after. The underlying data mutation is a separate permission-gated step; this is
   *  the mandatory audit gate (and the audit-of-record for a PII reveal). */
  async recordCustomerSupportAction(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const customerId = String(input?.customerId || '').trim();
    const action = String(input?.action || '').trim();
    const reason = String(input?.reason || '').trim();
    const branchId = input?.branchId ? String(input.branchId).trim() : null;
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!customerId) throw new PlatformError('invalid', 'customerId is required.');
    if (!CUSTOMER_SUPPORT_ACTIONS.has(action)) throw new PlatformError('invalid', 'Unsupported customer support action.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required to record a support action.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open Customer Support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    await this.audit(ctx, 'super_admin_customer_support_action', 'customer', customerId, {
      sessionId, tenantId, branchId, action, reason, before: input?.before ?? null, after: input?.after ?? null,
    });
    return { ok: true, sessionId, tenantId, branchId, customerId, action };
  }

  /** Lineage-preserving customer merge (§25). Permitted ONLY inside an active support session for the tenant, with a
   *  reason; the source customer is archived + flagged 'merged' and a full recovery snapshot is written to
   *  customer_merge_logs (so the merge is recoverable). Relationship reattribution is a separate tenant-confirmed step.
   *  Every merge is audited. */
  async mergeCustomers(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const sourceCustomerId = String(input?.sourceCustomerId || '').trim();
    const targetCustomerId = String(input?.targetCustomerId || '').trim();
    const reason = String(input?.reason || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!sourceCustomerId || !targetCustomerId) throw new PlatformError('invalid', 'sourceCustomerId and targetCustomerId are required.');
    if (sourceCustomerId === targetCustomerId) throw new PlatformError('invalid', 'A customer cannot be merged into itself.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required to merge customers.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open Customer Support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    const res = await this.repo.mergeCustomers({ tenantId, sourceCustomerId, targetCustomerId, byUserId: ctx.userId });
    if (!res) throw new PlatformError('not_found', 'Both customers must exist in the tenant and not be archived.');
    await this.audit(ctx, 'super_admin_customer_merged', 'customer', sourceCustomerId, { sessionId, tenantId, targetCustomerId, reason, mergeLogId: res.mergeLogId });
    return { ok: true, sourceCustomerId, targetCustomerId, mergeLogId: res.mergeLogId };
  }

  async mergeServiceCategories(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const sourceCategoryId = String(input?.sourceCategoryId || '').trim();
    const targetCategoryId = String(input?.targetCategoryId || '').trim();
    const reason = String(input?.reason || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!sourceCategoryId || !targetCategoryId) throw new PlatformError('invalid', 'sourceCategoryId and targetCategoryId are required.');
    if (sourceCategoryId === targetCategoryId) throw new PlatformError('invalid', 'A category cannot be merged into itself.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required to merge service categories.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open tenant support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    const res = await this.repo.mergeServiceCategories({ tenantId, sourceCategoryId, targetCategoryId, byUserId: ctx.userId });
    if (!res) throw new PlatformError('not_found', 'Both categories must exist in the tenant, and the source must not already be merged.');
    await this.audit(ctx, 'super_admin_service_category_merged', 'service_category', sourceCategoryId, { sessionId, tenantId, targetCategoryId, reason, reattributedServiceCount: res.reattributedServiceCount, mergeLogId: res.mergeLogId });
    return { ok: true, sourceCategoryId, targetCategoryId, reattributedServiceCount: res.reattributedServiceCount, mergeLogId: res.mergeLogId };
  }

  tenantProductCategories(tenantId: string) {
    if (!String(tenantId || '').trim()) throw new PlatformError('invalid', 'tenantId is required.');
    return this.repo.tenantProductCategories(String(tenantId).trim());
  }

  async mergeProductCategories(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const sourceCategoryId = String(input?.sourceCategoryId || '').trim();
    const targetCategoryId = String(input?.targetCategoryId || '').trim();
    const reason = String(input?.reason || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!sourceCategoryId || !targetCategoryId) throw new PlatformError('invalid', 'sourceCategoryId and targetCategoryId are required.');
    if (sourceCategoryId === targetCategoryId) throw new PlatformError('invalid', 'A category cannot be merged into itself.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required to merge product categories.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open tenant support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    const res = await this.repo.mergeProductCategories({ tenantId, sourceCategoryId, targetCategoryId, byUserId: ctx.userId });
    if (!res) throw new PlatformError('not_found', 'Both categories must exist in the tenant, and the source must be active (not already merged).');
    await this.audit(ctx, 'super_admin_product_category_merged', 'inventory_category', sourceCategoryId, { sessionId, tenantId, targetCategoryId, reason, reattributedProductCount: res.reattributedProductCount, mergeLogId: res.mergeLogId });
    return { ok: true, sourceCategoryId, targetCategoryId, reattributedProductCount: res.reattributedProductCount, mergeLogId: res.mergeLogId };
  }

  // ---- customer privacy requests (§27) ----
  privacyRequests(q: { status?: string; page?: number; pageSize?: number }) { return this.repo.privacyRequests(q); }

  async createPrivacyRequest(ctx: AdminCtx, input: any) {
    const tenantId = String(input?.tenantId || '').trim();
    const requestType = String(input?.requestType || '').trim();
    const requesterName = input?.requesterName ? String(input.requesterName).trim() : '';
    const customerId = input?.customerId ? String(input.customerId).trim() : '';
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!PRIVACY_REQUEST_TYPES.has(requestType)) throw new PlatformError('invalid', 'Unsupported privacy request type.');
    if (!requesterName && !customerId) throw new PlatformError('invalid', 'A requester name or customerId is required.');
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30-day default response window
    const r = await this.repo.createPrivacyRequest({ tenantId, customerId: customerId || undefined, requestType, requesterName: requesterName || undefined, requesterContact: input?.requesterContact ? String(input.requesterContact) : undefined, scope: input?.scope ? String(input.scope) : undefined, legalBasis: input?.legalBasis ? String(input.legalBasis) : undefined, dueAt, byUserId: ctx.userId });
    if (!r) throw new PlatformError('invalid', 'Could not create the privacy request.');
    await this.audit(ctx, 'super_admin_privacy_request_opened', 'customer_privacy_request', String(r.id), { tenantId, customerId: customerId || null, requestType });
    return r;
  }

  /** Advances a privacy request. Moving to a terminal/sensitive state (esp. completion of a deletion/anonymization) is
   *  permitted ONLY inside an active support session for the tenant, carries a reason, and is audited. */
  async advancePrivacyRequest(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const id = String(input?.id || '').trim();
    const status = String(input?.status || '').trim();
    const note = String(input?.note || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!id) throw new PlatformError('invalid', 'id is required.');
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!PRIVACY_STATUSES.has(status)) throw new PlatformError('invalid', 'Unsupported privacy request status.');
    if (note.length < 5) throw new PlatformError('invalid', 'A note (min 5 characters) is required to advance a privacy request.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open Customer Support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    const r = await this.repo.setPrivacyRequestStatus({ id, status, note, byUserId: ctx.userId });
    if (!r) throw new PlatformError('not_found', 'No privacy request with that id.');
    const action = PRIVACY_TERMINAL.has(status) ? (status === 'completed' ? 'super_admin_privacy_request_completed' : 'super_admin_privacy_request_closed') : 'super_admin_privacy_request_status';
    await this.audit(ctx, action, 'customer_privacy_request', id, { tenantId, status, note });
    return r;
  }

  auditLogs(q: AuditQuery) { return this.repo.auditLogs(q); }
  aiPackages() { return this.repo.aiPackages(); }
  async setAiPackage(ctx: AdminCtx, tenantId: string, pkg: string) {
    const ALLOWED = ['None', 'AI Basic', 'AI Pro'];
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!ALLOWED.includes(pkg)) throw new PlatformError('invalid', `package must be one of ${ALLOWED.join(', ')}.`);
    await this.repo.setAiPackage(tenantId, pkg);
    await this.audit(ctx, 'super_admin_ai_package_changed', 'tenant', tenantId, { package: pkg });
    return { tenantId, package: pkg };
  }
  async setAiFeature(ctx: AdminCtx, tenantId: string, featureKey: string, enabled: unknown) {
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!(AI_FEATURE_KEYS as readonly string[]).includes(featureKey)) throw new PlatformError('invalid', `feature must be one of ${AI_FEATURE_KEYS.join(', ')}.`);
    const v = enabled === null ? null : enabled === true ? true : enabled === false ? false : undefined;
    if (v === undefined) throw new PlatformError('invalid', 'enabled must be true, false, or null (revert to inherit).');
    await this.repo.setAiFeature(tenantId, featureKey, v);
    await this.audit(ctx, 'super_admin_ai_feature_toggled', 'tenant', tenantId, { feature: featureKey, enabled: v });
    return { tenantId, feature: featureKey, enabled: v };
  }
  usageLimits() { return this.repo.usageLimits(); }

  // ---- users & roles ----
  users(q: UsersQuery) {
    const ROLES = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'];
    if (q.role && !ROLES.includes(q.role)) throw new PlatformError('invalid', `role must be one of ${ROLES.join(', ')}.`);
    return this.repo.users(q);
  }

  usersDashboard(q: UsersQuery) {
    return this.repo.usersDashboard(q);
  }

  // Branch oversight dashboard (read-only, platform-wide). Pure passthrough to the aggregate.
  branchesDashboard(scope?: OverviewScope) {
    return this.repo.branchesDashboard(scope);
  }

  // Server-side All Branches Directory (paginated/filtered/sorted). Read-only, platform-wide oversight.
  branchesDirectory(q: Record<string, unknown>, scope?: OverviewScope) {
    return this.repo.branchesDirectory(q, scope);
  }

  // Controlled Add Branch (§28). Pure validation → transactional repo create (tenant + duplicate + manager checks) →
  // audit. Never writes partial records; rejects with a typed PlatformError so the UI can show real messages.
  async createBranch(ctx: AdminCtx, input: CreateBranchInput) {
    const v = validateCreateBranch(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const r = await this.repo.createBranch(v.value);
    if (!r.ok) throw new PlatformError(r.code, r.message);
    await this.audit(ctx, 'super_admin_branch_created', 'branch', r.branch.id, { name: r.branch.name, tenantId: r.branch.tenantId, status: r.branch.status });
    return r.branch;
  }

  // Managers assignable to a branch (MANAGER/OWNER users in its tenant, active). Read-only.
  async assignableManagers(branchId: string) {
    const r = await this.repo.assignableManagers(String(branchId || ''));
    if (!r) throw withCode(new PlatformError('not_found', 'Branch not found.'), 'BRANCH_NOT_FOUND');
    return r;
  }

  // Assign Manager (§34). Pure validation → transactional repo (tenant/role/active checks) → audit. Moving a manager
  // from another branch replaces their prior assignment (a user has a single branch); the audit records the move.
  async assignBranchManager(ctx: AdminCtx, branchId: string, input: { managerUserId?: unknown; effectiveDate?: unknown; reason?: unknown }) {
    const v = validateAssignManager(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const r = await this.repo.assignBranchManager(String(branchId || ''), v.value);
    if (!r.ok) throw new PlatformError(r.code, r.message);
    await this.audit(ctx, 'super_admin_branch_manager_assigned', 'branch', r.branch.id, { managerUserId: r.manager.id, managerName: r.manager.name, effectiveDate: v.value.effectiveDate, movedFromBranchId: r.movedFromBranchId });
    return r;
  }

  // --- Controlled branch transfer (§33). Request + preflight only; the cross-tenant data move is a separate reviewed
  // job and is never executed here, so historical/financial ownership is not silently rewritten. ---
  async branchTransferOptions(branchId: string) {
    const r = await this.repo.transferOptions(String(branchId || ''));
    if (!r) throw withCode(new PlatformError('not_found', 'Branch not found.'), 'BRANCH_NOT_FOUND');
    return r;
  }
  async branchTransferPreflight(branchId: string, destTenantId: string) {
    const r = await this.repo.transferPreflight(String(branchId || ''), String(destTenantId || ''));
    if (!r.ok) throw new PlatformError(r.code, r.message);
    return r;
  }
  async requestBranchTransfer(ctx: AdminCtx, branchId: string, input: { destinationTenantId?: unknown; reason?: unknown; effectiveDate?: unknown; confirmName?: unknown }) {
    const v = validateTransferRequest(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const r = await this.repo.createTransferRequest(String(branchId || ''), v.value, ctx.userId ?? null);
    if (!r.ok) throw new PlatformError(r.code, r.message);
    await this.audit(ctx, 'super_admin_branch_transfer_requested', 'branch', String(branchId || ''), { requestId: r.request.id, toTenantId: r.request.toTenantId, reason: v.value.reason, effectiveDate: v.value.effectiveDate });
    return { ...r.request, executed: false }; // a request, not an executed move
  }

  // Server-side audited export of the branch directory (§44). Authorized by the controller guard; returns the full
  // FILTERED set (matches what the admin is viewing), guards every cell against formula injection, exposes no secrets,
  // and writes an audit event recording who exported what and how many rows.
  async branchesExport(ctx: AdminCtx, q: Record<string, unknown>) {
    const rows = await this.repo.branchesExport(q);
    const content = rowsToCsv(rows);
    const filters = { search: q?.search ?? '', status: q?.status ?? '', tenant: q?.tenant ?? '', city: q?.city ?? '', healthMax: q?.healthMax ?? '', selectedIds: Array.isArray(q?.ids) ? q!.ids!.length : (q?.ids ? String(q.ids).split(',').filter(Boolean).length : 0) };
    await this.audit(ctx, 'super_admin_branches_exported', 'branch', 'directory', { format: 'csv', rowCount: rows.length, filters });
    const filename = `branches-${new Date().toISOString().slice(0, 10)}.csv`;
    return { filename, mime: 'text/csv', content, rowCount: rows.length };
  }

  // --- Branch operating hours (§37). Read is open; write validates the week (pure) → upserts per day → audits. ---
  async branchHours(branchId: string) {
    const r = await this.repo.getBranchHours(String(branchId || ''));
    if (!r) throw withCode(new PlatformError('not_found', 'Branch not found.'), 'BRANCH_NOT_FOUND');
    return r;
  }
  async setBranchHours(ctx: AdminCtx, branchId: string, input: { days?: any[] }) {
    const v = validateWeeklyHours(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const r = await this.repo.setBranchHours(String(branchId || ''), v.days);
    if (!r.ok) throw new PlatformError(r.code, r.message);
    await this.audit(ctx, 'super_admin_branch_hours_updated', 'branch', String(branchId || ''), { dayCount: r.count, closedDays: v.days.filter((d) => d.isClosed).length });
    return r;
  }

  // Bulk status change (§27). Validates the request, applies the per-branch transition rules to each selected branch,
  // and writes a single bulk audit event with the outcome summary. Partial failures are returned, not thrown.
  async bulkBranchStatus(ctx: AdminCtx, input: { branchIds?: unknown; status?: unknown; reason?: unknown }) {
    const v = validateBulkStatus(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const results = await this.repo.bulkApplyStatus(v.value.branchIds, v.value.status);
    const summary = summarizeBulk(results);
    await this.audit(ctx, 'super_admin_branches_bulk_status', 'branch', 'bulk', { status: v.value.status, reason: v.value.reason, total: summary.total, succeeded: summary.succeeded, failed: summary.failed, branchIds: v.value.branchIds });
    return { status: v.value.status, summary, results };
  }

  // --- Device allocation (§36). Read lists the branch's tenant fleet; allocate moves a branch-capable device to this
  // branch (validated against the real device row in the branch's own tenant) and audits the change. ---
  async branchDevices(branchId: string) {
    const r = await this.repo.branchDevices(String(branchId || ''));
    if (!r) throw withCode(new PlatformError('not_found', 'Branch not found.'), 'BRANCH_NOT_FOUND');
    return r;
  }
  async allocateDevice(ctx: AdminCtx, branchId: string, input: { deviceId?: unknown; category?: unknown }) {
    const v = validateAllocateDevice(input);
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const r = await this.repo.allocateDevice(String(branchId || ''), v.value);
    if (!r.ok) throw new PlatformError(r.code, r.message);
    await this.audit(ctx, 'super_admin_branch_device_allocated', 'branch', String(branchId || ''), { deviceId: r.device.id, deviceName: r.device.name, category: v.value.category, movedFromBranchId: r.movedFromBranchId });
    return r;
  }

  // Status lifecycle (§30–§32): pause/suspend/maintenance/close/reactivate. Pure validation (allowed transition +
  // required reason + typed-confirmation for high-risk targets) then a from-guarded update + audit. Never deletes data.
  async changeBranchStatus(ctx: AdminCtx, branchId: string, input: { status?: unknown; reason?: unknown; confirmName?: unknown }) {
    const id = String(branchId || '');
    const b = await this.repo.getBranchForStatus(id);
    if (!b) throw withCode(new PlatformError('not_found', 'Branch not found.'), 'BRANCH_NOT_FOUND');
    const v = validateStatusChange({ from: b.status, to: input?.status, reason: input?.reason, confirmName: input?.confirmName, branchName: b.name });
    if (!v.ok) throw new PlatformError('invalid', v.errors.join(' '));
    const upd = await this.repo.applyBranchStatus(id, b.status, v.value.to);
    if (!upd) throw withCode(new PlatformError('invalid', 'The branch status changed since you loaded it — refresh and try again.'), 'BRANCH_STATUS_CHANGED');
    await this.audit(ctx, 'super_admin_branch_status_changed', 'branch', id, { from: b.status, to: v.value.to, reason: v.value.reason });
    return { id, name: upd.name, from: b.status, to: upd.status };
  }

  platformServices(q: { category?: string; status?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }) {
    return this.repo.platformServices(q);
  }

  platformProducts(q: { category?: string; status?: string; search?: string; lowStock?: boolean; page?: number; pageSize?: number }) {
    return this.repo.platformProducts(q);
  }

  platformAppointments(q: { status?: string; source?: string; search?: string; date?: string; page?: number; pageSize?: number; tenantId?: string }) {
    return this.repo.platformAppointments(q);
  }

  platformPayments(q: { status?: string; method?: string; processor?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }) {
    return this.repo.platformPayments(q);
  }

  // Super Admin Payments & Transactions screen aggregate. Rows are shaped through payments-core so status, masked card,
  // totals, refund + settlement labels are all derived in one tested place. Customer email/phone are masked here.
  async paymentsTransactions(q: import('./super-admin-platform.repository').PaymentsTxnQuery) {
    const raw = await this.repo.paymentsTransactions(q);
    const rows = raw.rows.map((r: any) => {
      const st = deriveTxnStatus({ status: r.status, approved: r.approved, failed: r.failed });
      return {
        id: r.id, tenantId: r.tenantId, tenant: r.tenantName, branch: r.branch, merchant: maskMid(r.merchantId),
        customer: r.customerName || '—', customerEmail: maskEmail(r.customerEmail), customerPhone: maskPhone(r.customerPhone),
        amountCents: r.amountCents, tipCents: r.tipCents, taxCents: r.taxCents, discountCents: r.discountCents, surchargeCents: r.surchargeCents,
        totalChargedCents: totalChargedCents(r), method: r.method, card: maskCard(r.cardBrand, r.cardLast4, r.method),
        status: r.status, statusLabel: st.label, statusTone: st.tone,
        refundStatus: refundStatusLabel(r.refundedCents, r.amountCents), settlementStatus: settlementStatusLabel(r.status, r.approved),
        processor: r.processor, reference: r.reference, createdAt: r.createdAt,
      };
    });
    const k = assemblePaymentKpis(raw.kpiRaw);
    return {
      total: raw.total, rows, kpis: k,
      byMethod: raw.byMethod, trend: raw.trend,
      failed: raw.failed.map((f: any) => ({ id: f.id, amountCents: f.amountCents, reason: deriveTxnStatus({ status: f.reason, failed: true }).label, createdAt: f.createdAt })),
      processors: raw.processors,
    };
  }

  async paymentTransactionDetail(id: string) {
    const r: any = await this.repo.paymentTransactionDetail(id);
    if (!r) return null;
    const st = deriveTxnStatus({ status: r.status, approved: r.approved, failed: r.failed });
    return {
      id: r.id, tenantId: r.tenantId, tenant: r.tenantName, branch: r.branch, merchant: maskMid(r.merchantId),
      authorizationCode: null, // no dedicated auth-code column on payments — honest gap (rendered as —)
      refundStatus: refundStatusLabel(r.refundedCents, r.amountCents), settlementStatus: settlementStatusLabel(r.status, r.approved),
      processorResponse: st.label, deviceUsed: null, // no device linkage on payments — honest gap
      method: r.method, card: maskCard(r.cardBrand, r.cardLast4, r.method), tokenReference: r.reference || null,
      customer: r.customerName || '—', email: maskEmail(r.customerEmail), phone: maskPhone(r.customerPhone),
      amountCents: r.amountCents, tipCents: r.tipCents, taxCents: r.taxCents, discountCents: r.discountCents,
      surchargeCents: r.surchargeCents, totalChargedCents: totalChargedCents(r),
      status: r.status, statusLabel: st.label, statusTone: st.tone, processor: r.processor, createdAt: r.createdAt,
    };
  }

  // Authorization / processor event history (§22). Maps the safe gateway-event log to labelled, read-only rows. Nothing
  // here is editable through the overview; it is a tamper-evident sequence sourced from the processor event log.
  async paymentAuthorizationHistory(id: string) {
    const res = await this.repo.paymentAuthorizationHistory(id);
    if (!res) return null;
    return {
      id,
      events: res.events.map((e: any) => ({
        label: normalizeEventLabel(e.event_type), tone: eventTone(e.event_type), eventType: e.event_type || null,
        processor: e.processor_type || null, processorTransactionId: e.processor_transaction_id || null,
        correlationId: e.event_id || null, signatureValid: e.signature_valid === true, processed: !!e.processed_at, at: e.created_at,
      })),
    };
  }

  platformCustomers(q: { status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformCustomers(q);
  }

  platformCategories(q: { search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformCategories(q);
  }

  platformBrands(q: { search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformBrands(q);
  }

  platformSuppliers(q: { search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformSuppliers(q);
  }

  platformServiceCategories(q: { search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformServiceCategories(q);
  }

  tenantServiceCategories(tenantId: string) {
    if (!String(tenantId || '').trim()) throw new PlatformError('invalid', 'tenantId is required.');
    return this.repo.tenantServiceCategories(String(tenantId).trim());
  }

  customerDuplicates(q: { search?: string; page?: number; pageSize?: number }) {
    return this.repo.customerDuplicates(q);
  }

  platformReportExports(q: { reportKey?: string; format?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformReportExports(q);
  }

  platformReminders(q: { channel?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformReminders(q);
  }

  platformAutomations(q: { status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformAutomations(q);
  }

  platformIntegrations(q: { processor?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformIntegrations(q);
  }

  platformDevices(q: { category?: string; status?: string; search?: string; page?: number; pageSize?: number; tenantId?: string }) {
    return this.repo.platformDevices(q);
  }

  platformSecurity(q: { severity?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.platformSecurity(q);
  }
  roles() { return ROLE_PERMISSIONS as Record<string, readonly string[]>; }
  /** Paginated/filtered/sorted Tenant Performance report (server-side). Reuses the ranked rows; core does the rest. */
  async tenantPerformanceReport(query: Record<string, unknown>) {
    const rows = await this.repo.tenantPerformanceRows(1000);
    return applyPerformanceQuery(rows, query || {});
  }

  reports() { return this.repo.reports(); }

  /** Top Performing Tenants card feed — reuses the same ranked tenantPerformance the full report uses (no new query).
   *  Returns the spec card shape: rank, salon name/code, city/state, monthly card volume + formatted, growth, trend. */
  async topPerformingTenants(limit = 5) {
    const n = Math.min(50, Math.max(1, Number(limit) || 5));
    const r: any = await this.repo.reports();
    const rows = (r?.tenantPerformance || []).slice(0, n);
    return {
      tenants: rows.map((p: any) => ({
        rank: p.rank,
        tenantId: p.tenantId,
        salonName: p.tenantName,
        salonCode: p.salonCode ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        monthlyCardVolume: p.monthlyCardVolumeCents,
        formattedMonthlyCardVolume: '$' + Math.round((p.monthlyCardVolumeCents || 0) / 100).toLocaleString('en-US'),
        growthPercent: p.growthPercent,
        trendDirection: p.growthPercent == null ? 'new' : p.growthPercent >= 0 ? 'up' : 'down',
      })),
    };
  }

  // ---- PUBLIC website intake (unauthenticated): strict validation, honeypot, per-IP rate limit ----
  private ipSubmits = new Map<string, number[]>();
  /** 5 submissions/minute per IP, 10-minute lockout — reuses login's rateLimitDecision (no duplicate limiter). */
  private publicGate(ip: string) {
    const key = ip || 'unknown';
    const now = Date.now();
    const arr = this.ipSubmits.get(key) ?? [];
    const d = rateLimitDecision(arr, now, { windowMs: 60_000, maxFailures: 5, lockMs: 10 * 60_000 });
    if (!d.allowed) throw new PlatformError('rate_limited', 'Too many submissions from this address — please try again in a few minutes.');
    arr.push(now);
    this.ipSubmits.set(key, arr.filter((t) => now - t < 11 * 60_000));
    if (this.ipSubmits.size > 10_000) this.ipSubmits.clear(); // hard memory cap; resets buckets, never blocks legit traffic
  }
  private pubField(v: unknown, max: number, label: string): string | null {
    if (v == null) return null;
    const t = String(v).trim();
    if (!t) return null;
    if (t.length > max) throw new PlatformError('invalid', `${label} is too long (max ${max} characters).`);
    return t;
  }
  private pubEmail(v: unknown): string | null {
    const e = this.pubField(v, 160, 'Email');
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw withCode(new PlatformError('invalid', 'Email looks invalid.'), 'EMAIL_INVALID');
    return e ? e.toLowerCase() : null;
  }

  /** Website lead form → website_leads. Honeypot field `website` silently drops bots (no row, generic ok). */
  async publicCreateLead(input: any, ip: string) {
    if (this.pubField(input?.website, 500, 'hp')) return { ok: true }; // honeypot tripped: accept-and-drop
    this.publicGate(ip);
    const KINDS = ['demo_request', 'contact', 'free_package', 'newsletter'];
    const kind = String(input?.kind || '').trim();
    if (!KINDS.includes(kind)) throw new PlatformError('invalid', `kind must be one of ${KINDS.join(', ')}.`);
    const email = this.pubEmail(input?.email);
    const phone = this.pubField(input?.phone, 40, 'Phone');
    if (kind === 'newsletter' && !email) throw new PlatformError('invalid', 'Newsletter signup requires an email.');
    if (kind !== 'newsletter' && !email && !phone) throw withCode(new PlatformError('invalid', 'An email or phone number is required.'), 'EMAIL_OR_PHONE_REQUIRED');
    const row = await this.repo.createLead({
      kind, status: 'new',
      name: this.pubField(input?.name, 120, 'Name'),
      salon_name: this.pubField(input?.salonName ?? input?.salon_name, 120, 'Salon name'),
      phone, email,
      city: this.pubField(input?.city, 120, 'City'),
      state: this.pubField(input?.state, 40, 'State'),
      source_page: this.pubField(input?.sourcePage ?? input?.source_page, 200, 'Source page'),
      message: this.pubField(input?.message, 2000, 'Message'),
    });
    return { ok: true, id: row?.id };
  }

  /** Website free-package application form → tenant_applications (status new, straight into the §7 queue). */
  async publicCreateApplication(input: any, ip: string, userAgent?: string) {
    // Honeypot (accept-and-drop): the site's hidden field is `company_website`; older embeds used `website`.
    if (this.pubField(input?.website, 500, 'hp') || this.pubField(input?.company_website ?? input?.companyWebsite, 500, 'hp')) return { ok: true };
    this.publicGate(ip);

    // ---- required fields (public form contract: first, last, salon, phone, email, consent) ----
    const first = this.pubField(input?.ownerFirstName ?? input?.owner_first_name, 80, 'Owner first name');
    const last = this.pubField(input?.ownerLastName ?? input?.owner_last_name, 80, 'Owner last name');
    const legacyOwner = this.pubField(input?.ownerName ?? input?.owner_name, 120, 'Owner name');
    const ownerName = (first || last) ? [first, last].filter(Boolean).join(' ') : legacyOwner;
    if (!ownerName || ownerName.length < 2) throw new PlatformError('invalid', 'Owner name is required.');
    const salonName = this.pubField(input?.salonName ?? input?.salon_name, 120, 'Salon name');
    if (!salonName || salonName.length < 2) throw new PlatformError('invalid', 'Salon name is required.');
    const email = this.pubEmail(input?.email);
    if (!email) throw withCode(new PlatformError('invalid', 'A valid email is required.'), 'EMAIL_INVALID');
    const phoneRaw = this.pubField(input?.phone, 40, 'Phone');
    const phoneDigits = String(phoneRaw || '').replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) throw withCode(new PlatformError('invalid', 'A valid phone number is required.'), 'PHONE_INVALID');
    const consent = input?.smsEmailConsent ?? input?.sms_email_consent;
    if (!(consent === true || consent === 'true' || consent === 'on')) throw new PlatformError('invalid', 'Consent to be contacted is required to submit an application.');

    // ---- idempotency: a refresh/double-tap re-sending the same key returns the SAME reference, no new record ----
    const idem = this.pubField(input?.idempotencyKey ?? input?.idempotency_key, 64, 'Idempotency key');
    if (idem) {
      const existing = await this.repo.findApplicationByIdempotencyKey(idem);
      if (existing) return { ok: true, reference: existing.reference_number ?? undefined };
    }

    // ---- optional/normalized fields ----
    const intIn = (v: unknown, max: number, label: string): number | null => {
      if (v == null || v === '') return null;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > max) throw new PlatformError('invalid', `${label} must be 0\u2013${max.toLocaleString()}.`);
      return n;
    };
    const zip = this.pubField(input?.zip, 20, 'ZIP');
    if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) throw new PlatformError('invalid', 'ZIP must be 5 digits (or ZIP+4).');
    // EIN: validated, ENCRYPTED at rest (AES-256-GCM via APP_DATA_ENCRYPTION_KEY), last-4 kept for masked display.
    // The raw EIN is never stored, logged, or echoed. Without a configured key, only the last-4 is retained.
    const einRaw = this.pubField(input?.ein ?? input?.businessEin ?? input?.business_ein, 20, 'EIN');
    let einEncrypted: string | null = null; let einLast4: string | null = null;
    if (einRaw) {
      const einDigits = einRaw.replace(/\D/g, '');
      if (!/^\d{9}$/.test(einDigits)) throw new PlatformError('invalid', 'EIN must be 9 digits (XX-XXXXXXX).');
      einLast4 = einDigits.slice(-4);
      einEncrypted = encryptField(`${einDigits.slice(0, 2)}-${einDigits.slice(2)}`);
    }
    const utmIn = input?.utm && typeof input.utm === 'object' ? input.utm : null;
    const utm: Record<string, string> = {};
    if (utmIn) for (const k of Object.keys(utmIn).slice(0, 10)) { const v = String((utmIn as any)[k] ?? '').slice(0, 200); if (v) utm[k.slice(0, 40)] = v; }

    // ---- duplicate signals: flag for review, never silently discard, never reveal existence to the applicant ----
    const candidates = await this.repo.applicationDuplicateCandidates({ email, einLast4, salonName });
    const reasons: string[] = [];
    for (const c of candidates) {
      if (email && String(c.email || '').toLowerCase() === email.toLowerCase()) reasons.push(`Same email as application ${c.reference_number || c.id}`);
      if (einLast4 && c.ein_last4 === einLast4) reasons.push(`Same EIN last-4 as application ${c.reference_number || c.id}`);
      if (String(c.salon_name || '').toLowerCase() === salonName.toLowerCase() && (!zip || !c.zip || c.zip === zip)) reasons.push(`Same salon name as application ${c.reference_number || c.id}`);
      const cDigits = String(c.phone || '').replace(/\D/g, '');
      if (cDigits && cDigits === phoneDigits) reasons.push(`Same phone as application ${c.reference_number || c.id}`);
    }
    const dupReasons = [...new Set(reasons)].slice(0, 12);
    const dupScore = Math.min(100, dupReasons.length * 25);

    // ---- fraud/spam signals (transparent: reasons are stored and shown to Super Admin; nothing auto-rejects) ----
    const spamReasons: string[] = [];
    const emailDomain = email.split('@')[1]?.toLowerCase() || '';
    if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) spamReasons.push(`Disposable email domain (${emailDomain})`);
    if (/^(\d)\1{9,}$/.test(phoneDigits) || SUSPICIOUS_PHONES.has(phoneDigits)) spamReasons.push('Suspicious phone pattern');
    if (ip && ip !== 'unknown') {
      const recentFromIp = await this.repo.countRecentApplicationsFromIp(String(ip).slice(0, 64), 24).catch(() => 0);
      if (recentFromIp >= 3) spamReasons.push(`High submission velocity from this IP (${recentFromIp} in 24h)`);
    }
    if (await this.repo.activeTenantEmailExists(email).catch(() => false)) spamReasons.push('Email matches an existing tenant account');
    // The two signals deferred at the Jul-26 build (spec: suspicious links in free text; impossible state↔ZIP):
    const linkDomains = linkDomainsIn(String(input?.message || ''));
    if (linkDomains.length) spamReasons.push(`Message contains link(s): ${linkDomains.slice(0, 3).join(', ')}`);
    const stateAbbr = String(input?.state || '').trim().toUpperCase();
    const zip3 = /^\d{5}/.test(String(zip || '')) ? Number(String(zip).slice(0, 3)) : null;
    if (stateAbbr.length === 2 && zip3 != null) {  // unknown state formats never flag
      const ranges = STATE_ZIP_PREFIX_RANGES[stateAbbr];
      if (ranges && !ranges.some(([lo, hi]) => zip3 >= lo && zip3 <= hi)) spamReasons.push(`ZIP ${String(zip).slice(0, 5)} does not appear to match state ${stateAbbr}`);
    }
    const spamScore = Math.min(100, spamReasons.length * 25);
    const riskReasons = [...dupReasons, ...spamReasons].slice(0, 16);

    // ---- public reference number (what the applicant sees — internal ids are never exposed) ----
    const mkRef = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = randomBytes(8); let out = ''; for (let i = 0; i < 8; i++) out += A[b[i] % A.length]; return `APS-${out.slice(0, 4)}-${out.slice(4)}`; };

    const consentText = this.pubField(input?.consentText ?? input?.consent_text, 300, 'Consent text')
      || 'I agree to be contacted by AIPowerSalon by SMS, phone, or email about my application.';
    const base: Record<string, unknown> = {
      status: 'new',
      salon_name: salonName, owner_name: ownerName, owner_first_name: first, owner_last_name: last,
      phone: phoneRaw, email,
      address: this.pubField(input?.address, 200, 'Address'),
      city: this.pubField(input?.city, 120, 'City'),
      state: this.pubField(input?.state, 40, 'State'),
      zip,
      technicians_count: intIn(input?.technicianCount ?? input?.technician_count ?? input?.techniciansCount ?? input?.technicians_count, 500, 'Technician count'),
      locations_count: intIn(input?.locationCount ?? input?.location_count, 200, 'Location count'),
      ein_encrypted: einEncrypted, ein_last4: einLast4,
      referral_source: this.pubField(input?.referralSource ?? input?.referral_source ?? input?.hearAbout ?? input?.hear_about, 120, 'Referral source'),
      current_pos: this.pubField(input?.currentPos ?? input?.current_pos, 80, 'Current POS'),
      current_processor: this.pubField(input?.currentProcessor ?? input?.current_payment_processor ?? input?.current_processor, 80, 'Current processor'),
      card_volume_band: this.pubField(input?.cardVolumeBand ?? input?.average_monthly_card_volume ?? input?.card_volume_band, 60, 'Card volume band'),
      monthly_card_volume_cents: intIn(input?.monthlyCardVolumeCents ?? input?.monthly_card_volume_cents, 1_000_000_000, 'Monthly card volume'),
      best_contact_time: this.pubField(input?.bestTimeToContact ?? input?.best_time_to_contact, 40, 'Best time') || 'Anytime',
      preferred_contact_method: this.pubField(input?.preferredContactMethod ?? input?.preferred_contact_method, 40, 'Contact method'),
      applicant_message: this.pubField(input?.message, 2000, 'Message'),
      consent_given: true, consent_text: consentText, consent_at: new Date(),
      ip_address: String(ip || '').slice(0, 64) || null, user_agent: this.pubField(userAgent, 400, 'User agent'),
      form_version: this.pubField(input?.formVersion ?? input?.form_version, 40, 'Form version'),
      utm: Object.keys(utm).length ? JSON.stringify(utm) : null,
      idempotency_key: idem,
      duplicate_risk_score: dupScore, duplicate_reasons: riskReasons.length ? JSON.stringify(riskReasons) : null,
      spam_score: spamScore,
      source: this.pubField(input?.sourcePage ?? input?.source_page ?? input?.source, 200, 'Source') || 'website',
      preferred_imac_color: this.pubField(input?.preferredImacColor ?? input?.preferred_imac_color, 40, 'Preferred color'),
    };
    // Reference-collision retry (unique index): vanishingly rare, bounded.
    let row: any = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      try { row = await this.repo.createApplication({ ...base, reference_number: mkRef() }); }
      catch (e) { if (attempt === 4) throw e; }
    }
    const note = this.applicationIntakeNote(input);
    if (row?.id && note) await this.repo.appendApplicationNote(String(row.id), { text: note, by: 'website intake' });
    // Applicant confirmations (email + consent-gated SMS): best-effort and ONLY for a fresh submission — the
    // idempotent-replay path above returns earlier and never re-sends.
    if (row && this.confirmations) { void this.confirmations.sendConfirmation(row).catch(() => { /* never blocks intake */ }); }
    return { ok: true, reference: row?.reference_number };
  }
  /** Intake note for form extras with no dedicated column (currently: interested hardware selections). */
  private applicationIntakeNote(input: any): string | null {
    const hw = input?.interestedHardware ?? input?.interested_hardware;
    if (Array.isArray(hw) && hw.length) return `Interested hardware: ${hw.map((h: any) => String(h).slice(0, 60)).slice(0, 12).join(', ')}`;
    return null;
  }
  async disableUser(ctx: AdminCtx, id: string) {
    if (ctx.userId && ctx.userId === id) throw withCode(new PlatformError('invalid', 'You cannot disable your own account.'), 'OWN_ACCOUNT_DISABLE');
    await this.actionTarget(ctx, id, 'disable');   // A3: never a platform account of equal / higher rank
    // BUILD_PLAN Phase 9: a salon always keeps an active owner (409 LAST_OWNER), and a disabled account loses every live
    // session NOW (it used to keep working until the session expired). With a database the check and the write share one
    // transaction with the salon row locked (two concurrent disables of the last two owners → one 409).
    const current = this.repo.userForRoleChange ? await this.repo.userForRoleChange(id) : undefined;
    if (current === null) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (this.db && current?.tenantId) {
      const tenantId = current.tenantId;
      try {
        await this.db.transaction().execute(async (trx) => {
          await assertNotLastOwner(trx, tenantId, id);
          await sql`update users set status = 'suspended', updated_at = now() where id = ${id} and tenant_id = ${tenantId} and ${canMoveToSql(USER_ACCOUNT, 'suspended')}`.execute(trx);
          await recordAuthorizationChange(trx, null, { tenantId, actorUserId: ctx.userId ?? null, targetUserId: id, action: 'status.changed', before: { role: current.role }, after: { status: 'suspended' }, reason: 'platform: disabled by Super Admin' });
        });
      } catch (e) {
        if (e instanceof StaffRoleError && e.reason === LAST_OWNER) throw withCode(new PlatformError('conflict', "This is the salon's only active owner. Make someone else the owner first.", LAST_OWNER), 'ONLY_OWNER_LEFT');
        throw e;
      }
    } else {
      if (current?.role === 'OWNER' && current.tenantId && this.repo.otherActiveOwnerCount && (await this.repo.otherActiveOwnerCount(current.tenantId, id)) === 0) {
        throw withCode(new PlatformError('conflict', "This is the salon's only active owner. Make someone else the owner first.", LAST_OWNER), 'ONLY_OWNER_LEFT');
      }
      const ok = await this.repo.setUserStatus(id, 'suspended');
      if (!ok) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    }
    const revoked = typeof this.repo.revokeAllUserSessions === 'function' ? await this.repo.revokeAllUserSessions(id).catch(() => ({ count: 0 })) : { count: 0 };
    await this.audit(ctx, 'super_admin_user_disabled', 'user', id, { sessionsRevoked: revoked.count });
    return { id, status: 'suspended' };
  }
  async enableUser(ctx: AdminCtx, id: string) {
    await this.actionTarget(ctx, id, 'enable');   // A3
    const ok = await this.repo.setUserStatus(id, 'active');
    if (!ok) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    await this.audit(ctx, 'super_admin_user_enabled', 'user', id);
    return { id, status: 'active' };
  }
  /** C2 / A3 (Oct 23 2026): the new temporary password goes to the ACCOUNT HOLDER (email / SMS), never back to the caller;
   *  a reason is required and audited; a platform account of equal or higher rank is refused (route: step-up). */
  async resetUserPassword(ctx: AdminCtx, id: string, opts: { reason?: string; deliveryMethod?: DeliveryMethod } = {}) {
    const reason = String(opts.reason ?? '').trim();
    if (reason.length < MIN_RESET_REASON) throw new PlatformError('invalid', `A reason of at least ${MIN_RESET_REASON} characters is required.`, 'REASON_REQUIRED');
    const u = await this.actionTarget(ctx, id, 'reset the password of');
    const sent = await this.deliverToHolder(u, opts.deliveryMethod, 'user_reset');
    await this.audit(ctx, 'super_admin_user_password_reset', 'user', id, { reason, delivery: sent.delivery, sentTo: sent.sentTo, targetRole: u.role ?? null });
    return { ok: true, id, delivery: sent.delivery, sentTo: sent.sentTo, expiresAt: sent.expiresAt };
  }

  // Change a user's coarse role (§15 "Change Role"). Backend-enforced: role must be a known role (CUSTOMER excluded);
  // you cannot change your own role (prevents self-lockout/escalation). Audited with the before/after role so the
  // change is fully reconstructable. A no-op (same role) is rejected to keep the audit trail meaningful.
  //
  // Oct 6 2026 (Phase 1): this route could set SUPER_ADMIN on ANY account — salon staff included — with only the
  // users-management permission and no step-up, turning a salon's receptionist into a platform account (and back).
  // Platform accounts are created and changed only through Platform Staff (platform_roles.manage + step-up + the grant
  // ceiling, Constitution 7 §24–25), so this route now moves people between SALON roles only. It also keeps every salon
  // with at least one active owner, and validates BEFORE writing (the same-role check used to run after the update).
  async setUserRole(ctx: AdminCtx, id: string, role: string) {
    const ROLES = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
    const next = String(role || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (ctx.userId === id) throw withCode(new PlatformError('invalid', 'You cannot change your own role.'), 'OWN_ROLE_CHANGE');
    if (next === 'SUPER_ADMIN') throw withCode(new PlatformError('forbidden', 'Platform accounts are created and changed in Platform Staff, not here.'), 'PLATFORM_ACCOUNTS_ELSEWHERE');
    if (!ROLES.includes(next)) throw new PlatformError('invalid', `role must be one of ${ROLES.join(', ')}.`);
    const current = this.repo.userForRoleChange ? await this.repo.userForRoleChange(id) : undefined;
    if (current === null) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (current) {
      if (current.role === 'SUPER_ADMIN' || current.role === 'CUSTOMER') throw new PlatformError('forbidden', current.role === 'SUPER_ADMIN' ? 'Platform accounts are changed in Platform Staff, not here.' : 'A customer account has no staff role.');
      if (current.role === next) throw withCode(new PlatformError('invalid', `User already has the role ${next}.`), 'ROLE_ALREADY_HELD');
      if (current.role === 'OWNER' && next !== 'OWNER' && current.tenantId && this.repo.otherActiveOwnerCount
        && (await this.repo.otherActiveOwnerCount(current.tenantId, id)) === 0) {
        throw withCode(new PlatformError('conflict', 'This is the salon\'s only owner. Make someone else the owner first.', LAST_OWNER), 'ONLY_OWNER_LEFT');
      }
    }
    // BUILD_PLAN Phase 9: with a database the last-owner check is repeated under the salon-row lock in the SAME transaction
    // as the write (race-safe), and the change is written to authorization_audit_events. The person's next request is
    // re-authorized (the users trigger bumped their authorization version).
    let res: { before: string } | null;
    if (this.db && current?.tenantId) {
      const tenantId = current.tenantId;
      try {
        res = await this.db.transaction().execute(async (trx) => {
          if (current.role === 'OWNER' && next !== 'OWNER') await assertNotLastOwner(trx, tenantId, id);
          const u: any = (await sql`select role from users where id = ${id} for update`.execute(trx)).rows[0];
          if (!u) return null;
          await sql`update users set role = ${next}, updated_at = now() where id = ${id}`.execute(trx);
          await recordAuthorizationChange(trx, null, { tenantId, actorUserId: ctx.userId ?? null, targetUserId: id, action: 'role.base_changed', before: { role: String(u.role) }, after: { role: next }, reason: 'platform: changed by Super Admin' });
          return { before: String(u.role) };
        });
      } catch (e) {
        if (e instanceof StaffRoleError && e.reason === LAST_OWNER) throw withCode(new PlatformError('conflict', 'This is the salon\'s only owner. Make someone else the owner first.', LAST_OWNER), 'ONLY_OWNER_LEFT');
        throw e;
      }
    } else {
      res = await this.repo.setUserRole(id, next);
    }
    if (!res) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (res.before === next) throw withCode(new PlatformError('invalid', `User already has the role ${next}.`), 'ROLE_ALREADY_HELD');
    await this.audit(ctx, 'super_admin_user_role_changed', 'user', id, { before: res.before, after: next });
    return { id, before: res.before, after: next };
  }

  // Require / clear 2FA for a user (§26). Writes the real users.mfa_enabled flag, audited on actual change. Idempotent:
  // setting the flag to its current value is a harmless no-op (changed:false, no audit) rather than an error. Note this
  // governs the requirement flag — enrollment/verification/reset of factors needs an MFA-factor table (honest gap).
  async setUserMfa(ctx: AdminCtx, id: string, required: boolean) {
    const want = !!required;
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const res = await this.repo.setUserMfaRequired(id, want);
    if (!res) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (res.before === want) return { id, mfaEnabled: want, changed: false };
    await this.audit(ctx, want ? 'super_admin_user_mfa_required' : 'super_admin_user_mfa_cleared', 'user', id, { before: res.before, after: want });
    return { id, mfaEnabled: want, changed: true };
  }

  // Invitation lifecycle (§10). Both actions are valid only while the account is still 'invited'. Resend re-mints a
  // one-time temp password (only the hash is stored) and keeps the account invited; cancel moves it to 'inactive' so it
  // can't be used. Both audited. (Email/SMS delivery + invitation tokens remain an honest gap — no mailer/token table.)
  // C2 / A3 (Oct 23 2026): the re-sent temporary password goes to the invitee (email / SMS) — never back to the caller.
  async resendInvite(ctx: AdminCtx, id: string, opts: { deliveryMethod?: DeliveryMethod } = {}) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const u: any = await this.actionTarget(ctx, id, 'resend the invitation of');
    if (u.status !== 'invited') throw withCode(new PlatformError('invalid', 'Only a pending invite can be resent.'), 'INVITE_NOT_PENDING');
    const sent = await this.deliverToHolder(u, opts.deliveryMethod, 'invite_resend');
    await this.audit(ctx, 'super_admin_invitation_resent', 'user', id, { email: u.email ?? null, delivery: sent.delivery, sentTo: sent.sentTo });
    return { ok: true, id, email: u.email ?? null, delivery: sent.delivery, sentTo: sent.sentTo, expiresAt: sent.expiresAt };
  }

  async cancelInvite(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const u: any = await this.repo.userById(id);
    if (!u) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (u.status !== 'invited') throw withCode(new PlatformError('invalid', 'Only a pending invite can be cancelled.'), 'INVITE_NOT_PENDING');
    const ok = await this.repo.setUserStatus(id, 'inactive');
    if (!ok) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    await this.audit(ctx, 'super_admin_invitation_cancelled', 'user', id, { email: u.email });
    return { id, status: 'inactive' };
  }

  // Session oversight + revocation (§27). Reads a user's active login sessions, and revokes one or all of them
  // (revoking the session and its refresh tokens). Real auth tables — sessions.status/revoked_at + refresh_tokens.
  userSessions(userId: string) {
    if (!String(userId || '').trim()) throw new PlatformError('invalid', 'userId is required.');
    return this.repo.userActiveSessions(String(userId).trim());
  }

  async revokeSession(ctx: AdminCtx, sessionId: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!String(sessionId || '').trim()) throw new PlatformError('invalid', 'sessionId is required.');
    const r = await this.repo.revokeSession(String(sessionId).trim());
    if (!r) throw new PlatformError('not_found', 'No active session with that id.');
    await this.audit(ctx, 'super_admin_session_revoked', 'session', sessionId, { userId: r.userId });
    return { sessionId, revoked: true };
  }

  async revokeAllUserSessions(ctx: AdminCtx, userId: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!String(userId || '').trim()) throw new PlatformError('invalid', 'userId is required.');
    if (ctx.userId !== String(userId).trim()) await this.actionTarget(ctx, String(userId).trim(), 'sign out');   // A3 (signing yourself out stays allowed)
    const r = await this.repo.revokeAllUserSessions(String(userId).trim());
    await this.audit(ctx, 'super_admin_user_sessions_revoked', 'user', userId, { count: r.count });
    return { userId, revoked: r.count };
  }
  /** C3 (Oct 23 2026): RETIRED. It minted a SUPER_ADMIN account with only users.manage — no platform_roles.manage, no
   *  step-up, no grant ceiling, platform_role NULL — and returned its temporary password to the caller. Platform accounts
   *  are created only by invitation (POST /super-admin/platform/invitations: platform_roles.manage + a named platform role
   *  within the inviter's own permissions + step-up). The route answers 410 so an old screen says so instead of failing. */
  async createSuperAdmin(_ctx: AdminCtx, _input: unknown): Promise<never> {
    throw new PlatformError('gone', 'Creating a platform account this way has been retired. Invite the person from Platform Staff (POST /super-admin/platform/invitations) with the platform role they need.', 'ENDPOINT_RETIRED');
  }

  // General invite (§10). Backend-enforced: role must be one of the known roles (CUSTOMER cannot be invited as a
  // platform/tenant user); a tenant role requires a tenantId; email is normalised + duplicate-checked, then the invitation
  // is created and delivered by createInvitation (never a password back to the caller). Seat/plan limits (§36) are NOT enforced
  // here yet — there's no per-tenant seat-limit wiring — so that remains an honest gap rather than a fabricated check.
  /** Invite a staff account with EITHER an email or a phone number — or both.
   *
   *  Sign-in accepts both identifiers (auth normalizes the typed value and looks the user up by lower(email) or
   *  normalized_phone within the store). Setup has to match that: a salon whose staff are reached by phone can be
   *  set up with a phone alone, and that person signs in with the same number the admin entered. Whatever the
   *  admin provides is what works at the login screen — no silent second requirement.
   *
   *  The phone is stored E.164-normalized (the same normalizeIdentifier the login path uses), so any typed format
   *  — (856) 555-1234, 856-555-1234, +1 856 555 1234 — resolves to the one stored value.
   */
  async inviteUser(ctx: AdminCtx, input: any) {
    const INVITABLE = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
    const email = String(input?.email || '').trim().toLowerCase();
    const phoneRaw = String(input?.phone || '').trim();
    const fullName = String(input?.fullName || '').trim();
    const role = String(input?.role || '').trim();
    const tenantId = input?.tenantId ? String(input.tenantId).trim() : null;
    const branchId = input?.branchId ? String(input.branchId).trim() : null;
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!email && !phoneRaw) throw withCode(new PlatformError('invalid', 'Enter an email address or a phone number — the person signs in with whichever you provide.'), 'EMAIL_OR_PHONE_REQUIRED');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw withCode(new PlatformError('invalid', 'That email address is not valid.'), 'EMAIL_INVALID');
    let phone: string | null = null;
    if (phoneRaw) {
      const norm = normalizeIdentifier(phoneRaw);
      if (norm.kind !== 'phone') throw withCode(new PlatformError('invalid', 'That phone number is not valid. Use 10 digits, for example (856) 555-1234.'), 'PHONE_INVALID');
      phone = norm.value;
    }
    if (fullName.length < 2) throw withCode(new PlatformError('invalid', 'Full name is required.'), 'FULL_NAME_REQUIRED');
    if (!INVITABLE.includes(role)) throw new PlatformError('invalid', `role must be one of ${INVITABLE.join(', ')}.`);
    if (role !== 'SUPER_ADMIN' && !tenantId) throw new PlatformError('invalid', 'A tenant is required for a tenant role.');
    if (role === 'SUPER_ADMIN' && tenantId) throw new PlatformError('invalid', 'A platform Super Admin is not scoped to a tenant.');
    if (email && await this.repo.emailExists(email)) throw withCode(new PlatformError('invalid', 'A user with that email already exists.'), 'EMAIL_IN_USE_USER');
    // Duplicate phone inside one store would make sign-in ambiguous — the lookup is tenant-scoped, so block it there.
    if (phone && await this.repo.phoneExists(tenantId, phone)) throw withCode(new PlatformError('invalid', 'A user in this salon already signs in with that phone number.'), 'PHONE_IN_USE_STAFF');
    // C3 / A3 (Oct 23 2026): this route minted the account itself and returned its temporary password to the caller — and
    // for role SUPER_ADMIN with no platform_roles.manage, no platform role (→ cross-tenant read) and no ceiling. It is now
    // the SAME secure invitation as POST /invitations: a single-use token delivered to the invitee, and for a platform
    // account platform_roles.manage + a named platform role within the inviter's own permissions (createInvitation).
    return this.createInvitation(ctx, { email: email || null, phone, fullName, role, tenantId, branchId, platformRole: input?.platformRole, channel: input?.channel });
  }

  // ── Secure invitation tokens (§23) ────────────────────────────────────────────────────────────────────────────
  // Fallback is the host that is ACTUALLY served (DEPLOY_RUNBOOK + WEB_CORS_ORIGINS + Terraform all target
  // pos.*). It previously fell back to app.*, which is provisioned in no DNS/CloudFront/CORS config — so every
  // invitation link built from the fallback pointed at a dead domain. Set APP_BASE_URL in production.
  // Derived from WEB_CORS_ORIGINS rather than a hard-coded guess. The old fallback pointed at a host that was
  // provisioned nowhere, so invite links silently went to a domain that did not exist — nothing failed, and only
  // a customer clicking one would ever have found out.
  private inviteBaseUrl() { return portalUrl(); }
  /** Delivery seam. When INVITE_NOTIFIER_URL is configured this performs a REAL POST of the accept link to the
   *  operator's mailer/SMS relay and records delivered/failed honestly. When nothing is configured it stays
   *  not_connected and hands the one-time token back for manual delivery — it never fabricates a send. */
  //
  // The body of this method now lives in InvitationDelivery — the technician-invite path needed to send an
  // invitation too, and the choice was to copy this logic or extract it. A second delivery mechanism is a second
  // thing to time out, a second set of status strings, and a second place to forget that `not_connected` is not
  // `sent`. Behaviour here is unchanged; there is simply one implementation of it now.
  private async deliverInvitation(invitationId: string, channel: string, email: string, token: string | null, meta?: { role?: string | null; tenantId?: string | null; expiresAt?: string | null }) {
    return new InvitationDelivery(this.repo).deliver({
      invitationId, channel: channel as 'email' | 'sms' | 'manual', to: email, token,
      baseUrl: this.inviteBaseUrl(), role: meta?.role ?? null, tenantId: meta?.tenantId ?? null, expiresAt: meta?.expiresAt ?? null,
    });
  }
  /** An invitation is addressed to an email OR a phone number — the same two identifiers the login screen accepts.
   *  A phone-addressed invitation is delivered by SMS and creates (or finds) the account keyed on that number, so
   *  the person signs in with exactly the number the admin typed. */
  private validateInvite(input: any) {
    const INVITABLE = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
    const email = String(input?.email || '').trim().toLowerCase();
    const phoneRaw = String(input?.phone || '').trim();
    const role = String(input?.role || '').trim();
    const tenantId = input?.tenantId ? String(input.tenantId).trim() : null;
    const branchId = input?.branchId ? String(input.branchId).trim() : null;
    const fullName = input?.fullName != null ? String(input.fullName).trim() : null;
    if (!email && !phoneRaw) throw withCode(new PlatformError('invalid', 'Enter an email address or a phone number to send the invitation to.'), 'EMAIL_OR_PHONE_REQUIRED');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw withCode(new PlatformError('invalid', 'That email address is not valid.'), 'EMAIL_INVALID');
    let phone: string | null = null;
    if (phoneRaw) {
      const norm = normalizeIdentifier(phoneRaw);
      if (norm.kind !== 'phone') throw withCode(new PlatformError('invalid', 'That phone number is not valid. Use 10 digits, for example (856) 555-1234.'), 'PHONE_INVALID');
      phone = norm.value;
    }
    if (!INVITABLE.includes(role)) throw new PlatformError('invalid', `role must be one of ${INVITABLE.join(', ')}.`);
    if (role !== 'SUPER_ADMIN' && !tenantId) throw new PlatformError('invalid', 'A tenant is required for a tenant role.');
    if (role === 'SUPER_ADMIN' && tenantId) throw new PlatformError('invalid', 'A platform Super Admin is not scoped to a tenant.');
    return { email: email || null, phone, role, tenantId, branchId, fullName };
  }

  async createInvitation(ctx: AdminCtx, input: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const v = this.validateInvite(input);
    // Constitution 7 §24/§25 — a PLATFORM user invitation: only with platform_roles.manage, naming the platform role, and
    // never beyond the inviter's own permissions (grant ceiling). The invitee gets exactly that role on acceptance.
    let platformRole: string | null = null;
    if (v.role === 'SUPER_ADMIN') {
      if (!ctx.permissions?.includes('super_admin.platform_roles.manage')) throw new PlatformError('forbidden', 'Inviting a platform user requires super_admin.platform_roles.manage.');
      platformRole = String(input?.platformRole ?? '').trim();
      if (!isPlatformRole(platformRole)) throw new PlatformError('invalid', 'Choose the platform role the invitee will hold.');
      const beyond = (platformPermissionsFor(platformRole) as string[]).filter((k) => !ctx.permissions!.includes(k));
      if (beyond.length) throw new PlatformError('forbidden', `That platform role includes permissions you do not hold (${beyond.length}).`);
    }
    // A phone-addressed invitation defaults to SMS — an email channel with no email address would be undeliverable.
    const asked = ['email', 'sms', 'manual'].includes(input?.channel) ? input.channel : null;
    const channel = asked && !(asked === 'email' && !v.email) ? asked : (v.email ? 'email' : 'sms');
    const to = channel === 'sms' && v.phone ? v.phone : (v.email || v.phone || '');
    const r = await this.repo.createInvitation({ ...v, invitedByUserId: ctx.userId, channel, platformRole });
    if (r.reused) return { id: r.id, status: 'pending', reused: true, tokenPrefix: r.tokenPrefix, expiresAt: r.expiresAt, deliveryStatus: 'pending', message: 'An outstanding invitation already exists for this person.' };
    const del = await this.deliverInvitation(r.id, channel, to, r.token, { role: v.role, tenantId: v.tenantId, expiresAt: r.expiresAt });
    await this.audit(ctx, 'super_admin_invitation_created', 'user_invitation', r.id, { email: v.email, phone: v.phone, role: v.role, platformRole, tenantId: v.tenantId, channel, deliveryStatus: del.deliveryStatus });
    return { id: r.id, status: 'pending', reused: false, email: v.email, phone: v.phone, role: v.role, tokenPrefix: r.tokenPrefix, expiresAt: r.expiresAt, deliveryStatus: del.deliveryStatus, deliveryNote: del.reason, manualAcceptToken: del.manualToken };
  }

  /**
   * wave 4 pilot P3 — the SALON invites its own front desk / manager. The same invitation as the Super Admin's (one
   * pending invite per person, user_invitations token, InvitationDelivery, the public accept page), with three limits:
   *   - permission-based: the actor holds roles.manage (the controller's guard checks it too);
   *   - always into the actor's own salon (any tenantId in the body is ignored; a branch must be one of the salon's);
   *   - the grant ceiling: the invited role's permissions must all be ones the actor holds (the staff-roles rule).
   * Only RECEPTION / FRONT_DESK / MANAGER ('RECEPTIONIST' = RECEPTION). Audited against the salon.
   */
  async inviteSalonStaff(actor: { tenantId: string; userId: string; role: string; permissions?: string[]; branchId?: string | null; stepUpFresh?: () => Promise<boolean> }, input: any) {
    if (!actor?.tenantId || !actor?.userId) throw withCode(new PlatformError('forbidden', 'Sign in to your salon first.'), 'SIGN_IN_TO_SALON');
    const mine = new Set<string>(Array.isArray(actor.permissions) ? actor.permissions : []);
    if (!mine.has('roles.manage')) throw withCode(new PlatformError('forbidden', 'Inviting staff requires the roles.manage permission.'), 'PERMISSION_DENIED');
    const role = SALON_INVITE_ROLES[String(input?.role ?? '').trim().toUpperCase()];
    if (!role) throw withCode(new PlatformError('invalid', 'A salon can invite a receptionist, front desk or manager here (technicians are hired from the Technicians screen).'), 'STAFF_INVITE_ROLE_INVALID');
    const granted = ((ROLE_PERMISSIONS as Record<string, readonly string[]>)[role] ?? []) as readonly string[];
    const beyond = granted.filter((k) => !mine.has(k));
    if (beyond.length) throw withCode(new PlatformError('forbidden', `That role carries permissions you do not hold yourself (${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? ', …' : ''}). Ask the owner.`), 'ROLE_PERMISSIONS_BEYOND_YOURS');
    // w4 SQL item 5: inviting someone into a role that carries a step-up permission (the registry's stepUp flag — a MANAGER
    // gets refunds approval, payroll, staff control, customer export) is a sensitive action like a role change, so it needs
    // a recent step-up on THIS session (the same sessions.last_step_up_at stamp StepUpGuard reads; POST /auth/step-up).
    // Decided by permissions, not the role name. Fail closed: no checker → refused. A receptionist / front desk invite
    // carries no step-up permission and does not ask.
    if (granted.some((k) => definitionOf(k)?.stepUp) && !(actor.stepUpFresh ? await actor.stepUpFresh() : false))
      throw new PlatformError('forbidden', 'Inviting a manager needs you to confirm your password (and authenticator code, if you use one).', 'STEP_UP_REQUIRED');
    const v = this.validateInvite({ ...input, role, tenantId: actor.tenantId });
    if (v.branchId && this.db) {
      const b = await this.db.selectFrom('branches' as any).select('id' as any).where('id' as any, '=', v.branchId).where('tenant_id' as any, '=', actor.tenantId).executeTakeFirst().catch(() => undefined);
      if (!b) throw withCode(new PlatformError('invalid', 'That location is not one of your salon\'s.'), 'BRANCH_NOT_FOUND');
    }
    const askedCh = ['email', 'sms', 'manual'].includes(input?.channel) ? input.channel : null;
    const channel = askedCh && !(askedCh === 'email' && !v.email) ? askedCh : (v.email ? 'email' : 'sms');
    const to = channel === 'sms' && v.phone ? v.phone : (v.email || v.phone || '');
    const r = await this.repo.createInvitation({ ...v, tenantId: actor.tenantId, invitedByUserId: actor.userId, channel, platformRole: null });
    if (r.reused) return { id: r.id, status: 'pending', reused: true, role, tokenPrefix: r.tokenPrefix, expiresAt: r.expiresAt, deliveryStatus: 'pending', message: 'An outstanding invitation already exists for this person.' };
    const del = await this.deliverInvitation(r.id, channel, to, r.token, { role, tenantId: actor.tenantId, expiresAt: r.expiresAt });
    await this.audit({ userId: actor.userId } as AdminCtx, 'salon_staff_invitation_created', 'user_invitation', r.id,
      { email: v.email, phone: v.phone, role, branchId: v.branchId, channel, deliveryStatus: del.deliveryStatus }, { tenantId: actor.tenantId, actorRole: actor.role });
    return { id: r.id, status: 'pending', reused: false, email: v.email, phone: v.phone, role, branchId: v.branchId, tokenPrefix: r.tokenPrefix, expiresAt: r.expiresAt, deliveryStatus: del.deliveryStatus, deliveryNote: del.reason, manualAcceptToken: del.manualToken,
      acceptUrl: del.manualToken ? acceptUrl(this.inviteBaseUrl(), del.manualToken) : null };   // the link to hand over when nothing was delivered
  }

  listInvitations(q: any) { return this.repo.listInvitations({ status: q?.status, tenantId: q?.tenantId, page: +q?.page || 1, pageSize: +q?.pageSize || 50 }); }

  async resendInvitation(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const r = await this.repo.resendInvitation(id);
    if (!r) throw withCode(new PlatformError('not_found', 'No pending invitation to resend.'), 'NO_PENDING_INVITE');
    // Re-send on the channel the invitation was created with, to the identifier it was addressed to.
    const channel = r.channel === 'sms' || (!r.email && r.phone) ? 'sms' : r.channel || 'email';
    const del = await this.deliverInvitation(r.id, channel, channel === 'sms' && r.phone ? r.phone : r.email, r.token, { expiresAt: r.expiresAt });
    await this.audit(ctx, 'super_admin_invitation_resent', 'user_invitation', id, { deliveryStatus: del.deliveryStatus });
    return { id: r.id, tokenPrefix: r.tokenPrefix, expiresAt: r.expiresAt, deliveryStatus: del.deliveryStatus, deliveryNote: del.reason, manualAcceptToken: del.manualToken };
  }

  async cancelInvitation(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const r = await this.repo.cancelInvitation(id);
    if (!r) throw withCode(new PlatformError('not_found', 'No pending invitation to cancel.'), 'NO_PENDING_INVITE');
    await this.audit(ctx, 'super_admin_invitation_cancelled', 'user_invitation', id, {});
    return r;
  }

  /** PUBLIC — the invitee redeems their token and sets their own password. No admin context; single-use + replay-safe. */
  async acceptInvitation(input: any) {
    const token = String(input?.token || '').trim();
    const password = String(input?.password || '');
    const fullName = input?.fullName != null ? String(input.fullName).trim() : undefined;
    if (!token) throw new PlatformError('invalid', 'An invitation token is required.');
    if (password.length < 10) throw new PlatformError('invalid', 'Password must be at least 10 characters.');
    const r = await this.repo.acceptInvitation({ token, password, fullName });
    if (!r.ok) {
      const msg = r.reason === 'expired' ? 'This invitation has expired.'
        : r.reason === 'already_accepted' ? 'This invitation was already used.'
          : r.reason === 'cancelled' ? 'This invitation was cancelled.'
            // She already has an AIPowerSalon account. An invitation must not be able to SET her password —
            // that would let a link somebody sent her rotate the credential at the salons she already works at.
            // So she signs in with the one she has, and it is the same one everywhere.
            : r.reason === 'existing_account_password'
              ? 'You already have an AIPowerSalon technician account. Use the password you already sign in with — it is the same one at every salon you work at.'
              : 'Invalid invitation.';
      throw new PlatformError(r.reason === 'not_found' ? 'not_found' : 'invalid', msg);
    }
    await this.audit({ userId: r.userId } as AdminCtx, 'user_invitation_accepted', 'user', r.userId, { email: r.email, role: r.role, tenantId: r.tenantId });
    return { ok: true, userId: r.userId, email: r.email, role: r.role };
  }

  // ── Access-request workflow (§26) ─────────────────────────────────────────────────────────────────────────────
  async createAccessRequest(ctx: AdminCtx, input: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const ROLES = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
    const requestingUserId = String(input?.requestingUserId || '').trim();
    const requestedRole = String(input?.requestedRole || '').trim();
    const reason = String(input?.reason || '').trim();
    const requestedDurationDays = input?.requestedDurationDays != null && input.requestedDurationDays !== '' ? Number(input.requestedDurationDays) : null;
    if (!requestingUserId) throw new PlatformError('invalid', 'requestingUserId is required.');
    if (!ROLES.includes(requestedRole)) throw new PlatformError('invalid', `requestedRole must be one of ${ROLES.join(', ')}.`);
    if (reason.length < 5) throw new PlatformError('invalid', 'A business reason (≥5 characters) is required.');
    if (requestedDurationDays != null && (!Number.isFinite(requestedDurationDays) || requestedDurationDays <= 0)) throw new PlatformError('invalid', 'requestedDurationDays must be a positive number, or omitted for a permanent grant.');
    const requester: any = await this.repo.userById(requestingUserId);
    if (!requester) throw new PlatformError('not_found', 'Requesting user not found.');
    const tenantId = input?.tenantId ? String(input.tenantId).trim() : (requester.tenant_id ?? null);
    const r = await this.repo.createAccessRequest({ tenantId, requestingUserId, currentRole: requester.role ?? null, requestedRole, reason, requestedDurationDays, requestedBranchIds: Array.isArray(input?.requestedBranchIds) ? input.requestedBranchIds : [] });
    await this.audit(ctx, 'access_request_created', 'access_request', r.id, { requestingUserId, requestedRole, tenantId, highRisk: r.highRisk });
    return { id: r.id, status: r.status, highRisk: r.highRisk };
  }

  listAccessRequests(q: any) { return this.repo.listAccessRequests({ status: q?.status, tenantId: q?.tenantId, page: +q?.page || 1, pageSize: +q?.pageSize || 50 }); }

  private async decideAccessRequest(ctx: AdminCtx, id: string, action: 'review' | 'approve' | 'reject', body: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    // The approver here is the platform Super Admin (full authority). The pure authority check still applies and is
    // ready for delegated (tenant-admin) approval, where it constrains what a lower-authority approver may grant.
    const r = await this.repo.decideAccessRequest({ id, approverUserId: ctx.userId, approverRole: 'SUPER_ADMIN', action, notes: body?.notes, durationDays: body?.durationDays != null && body.durationDays !== '' ? Number(body.durationDays) : null, confirmHighRisk: body?.confirmHighRisk === true });
    if (!r.ok) {
      const msg = r.reason === 'not_found' ? 'Access request not found.'
        : r.reason === 'beyond_authority' ? 'You cannot grant a role above your own authority.'
        : r.reason === 'high_risk_confirmation_required' ? 'This is a high-risk (privileged) grant — confirmHighRisk is required.'
        : r.reason === 'self_decision' ? 'You cannot review or approve your own access request.'
        : 'This request can no longer be changed.';
      throw new PlatformError(r.reason === 'not_found' ? 'not_found' : 'invalid', msg);
    }
    await this.audit(ctx, `access_request_${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reviewed'}`, 'access_request', id, { status: r.status, requestedRole: r.requestedRole, requestingUserId: r.requestingUserId });
    return r;
  }
  reviewAccessRequest(ctx: AdminCtx, id: string, body: any) { return this.decideAccessRequest(ctx, id, 'review', body); }
  approveAccessRequest(ctx: AdminCtx, id: string, body: any) { return this.decideAccessRequest(ctx, id, 'approve', body); }
  rejectAccessRequest(ctx: AdminCtx, id: string, body: any) { return this.decideAccessRequest(ctx, id, 'reject', body); }
  async cancelAccessRequest(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const r = await this.repo.cancelAccessRequest(id);
    if (!r) throw new PlatformError('not_found', 'No open access request to cancel.');
    await this.audit(ctx, 'access_request_cancelled', 'access_request', id, {});
    return r;
  }

  // ── Tenant self-service (a signed-in user files / tracks / cancels their OWN request) — identity is server-derived
  //    from req.ctx (never the client); a user cannot self-request SUPER_ADMIN. ──
  async createOwnAccessRequest(ctx: AdminCtx, input: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated context required.');
    const SELF_ROLES: readonly string[] = SELF_REQUESTABLE_ROLES; // the one policy (access-request-core) — never SUPER_ADMIN
    const requestedRole = String(input?.requestedRole || '').trim();
    const reason = String(input?.reason || '').trim();
    const requestedDurationDays = input?.requestedDurationDays != null && input.requestedDurationDays !== '' ? Number(input.requestedDurationDays) : null;
    if (!SELF_ROLES.includes(requestedRole)) throw new PlatformError('invalid', `requestedRole must be one of ${SELF_ROLES.join(', ')}.`);
    if (reason.length < 5) throw new PlatformError('invalid', 'A business reason (≥5 characters) is required.');
    if (requestedDurationDays != null && (!Number.isFinite(requestedDurationDays) || requestedDurationDays <= 0)) throw new PlatformError('invalid', 'requestedDurationDays must be a positive number, or omitted for a permanent grant.');
    const me: any = await this.repo.userById(ctx.userId);
    if (!me) throw withCode(new PlatformError('not_found', 'User not found.'), 'USER_NOT_FOUND');
    if (me.role === requestedRole) throw withCode(new PlatformError('invalid', 'You already hold that role.'), 'ROLE_ALREADY_HELD');
    // one open request per role: a second identical request is refused until the first is decided or cancelled
    const open = await this.repo.listAccessRequests({ requestingUserId: ctx.userId, page: 1, pageSize: 100 });
    if ((open?.rows ?? []).some((x: { requestedRole?: string; status?: string }) => x.requestedRole === requestedRole && (x.status === 'submitted' || x.status === 'under_review')))
      throw withCode(new PlatformError('invalid', 'You already have an open request for that role.'), 'ACCESS_REQUEST_DUPLICATE');
    // server-derived tenant + current role; the client cannot spoof who is requesting or for which tenant
    const r = await this.repo.createAccessRequest({ tenantId: me.tenant_id ?? null, requestingUserId: ctx.userId, currentRole: me.role ?? null, requestedRole, reason, requestedDurationDays });
    await this.audit(ctx, 'access_request_created', 'access_request', r.id, { requestingUserId: ctx.userId, requestedRole, self: true, highRisk: r.highRisk });
    return { id: r.id, status: r.status, highRisk: r.highRisk };
  }
  /** batch 8 decision 6: the roles this user may request, from the same policy the create path enforces */
  async ownRequestableRoles(ctx: AdminCtx): Promise<RequestableRolesResponse> {
    if (!ctx.userId) throw withCode(new PlatformError('invalid', 'Please sign in again.'), 'AUTH_REQUIRED');
    const me: any = await this.repo.userById(ctx.userId);
    const open = await this.repo.listAccessRequests({ requestingUserId: ctx.userId, page: 1, pageSize: 100 });
    const openRoles = (open?.rows ?? []).filter((x: { status?: string }) => x.status === 'submitted' || x.status === 'under_review').map((x: { requestedRole?: string }) => String(x.requestedRole));
    return { roles: requestableRoles(me?.role ?? null, openRoles) };
  }
  listOwnAccessRequests(ctx: AdminCtx) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated context required.');
    return this.repo.listAccessRequests({ requestingUserId: ctx.userId, page: 1, pageSize: 100 });
  }
  async cancelOwnAccessRequest(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated context required.');
    const ar = await this.repo._accessRequest(id);
    if (!ar || ar.requestingUserId !== ctx.userId) throw new PlatformError('not_found', 'Access request not found.'); // ownership — don't leak others' requests
    const r = await this.repo.cancelAccessRequest(id);
    if (!r) throw new PlatformError('invalid', 'This request can no longer be cancelled.');
    await this.audit(ctx, 'access_request_cancelled', 'access_request', id, { self: true });
    return r;
  }

  // ── Server-side audited users export (the real export job) ────────────────────────────────────────────────────
  // Pages through the SAME filtered directory query (reuse, not a parallel query) to gather every matching row, then
  // builds an injection-guarded CSV. Tenant/branch/role/status/search filters are honored; one audit record captures
  // who exported what (criteria + row count). Capped so a runaway export can't exhaust memory — truncation is reported.
  /** Page the directory query to gather all matching rows and build the CSV. Shared by the on-demand export and the
   *  scheduled runner so there is exactly one users-CSV code path. Capped; truncation is reported. */
  private async generateUsersCsv(filters: { role?: string; tenantId?: string; branchId?: string; status?: string; search?: string }) {
    const MAX = 20000, PAGE = 100;
    const all: any[] = []; let total = 0; let truncated = false;
    for (let page = 1; page <= MAX / PAGE; page++) {
      const res: any = await this.repo.users({ ...filters, page, pageSize: PAGE });
      total = Number(res?.total || 0);
      all.push(...(res?.rows || []));
      if ((res?.rows || []).length < PAGE) break;
      if (all.length >= MAX) { truncated = all.length < total; break; }
    }
    return { csv: usersExportCsv(all), filename: usersExportFilename(new Date()), rowCount: all.length, total, truncated };
  }

  async usersExport(ctx: AdminCtx, q: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const filters = {
      role: q?.role ? String(q.role) : undefined, tenantId: q?.tenantId ? String(q.tenantId) : undefined,
      branchId: q?.branchId ? String(q.branchId) : undefined, status: q?.status ? String(q.status) : undefined,
      search: q?.search ? String(q.search) : undefined,
    };
    const out = await this.generateUsersCsv(filters);
    await this.audit(ctx, 'super_admin_users_exported', 'user', 'export', { filters, rowCount: out.rowCount, total: out.total, truncated: out.truncated, format: 'csv' });
    return { filename: out.filename, csv: out.csv, rowCount: out.rowCount, total: out.total, truncated: out.truncated };
  }

  // ── Scheduled reports (deferred unit, now unblocked by the export job + delivery notifier) ────────────────────
  /** Deliver a generated report to the configured notifier (REPORTS_NOTIFIER_URL or the shared INVITE_NOTIFIER_URL).
   *  Honest: returns 'not_connected' when nothing is configured — it never claims to have emailed a file. */
  private async deliverReport(name: string, recipient: string | null, filename: string, csv: string): Promise<'delivered' | 'failed' | 'not_connected'> {
    const url = process.env.REPORTS_NOTIFIER_URL || process.env.INVITE_NOTIFIER_URL;
    if (!url) return 'not_connected';
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'scheduled_report', name, to: recipient, filename, format: 'csv', csv }), signal: ac.signal });
      return deliveryStatusFor(res.ok);
    } catch { return 'failed'; } finally { clearTimeout(timer); }
  }

  async createScheduledReport(ctx: AdminCtx, input: any) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const name = String(input?.name || '').trim();
    const reportKey = String(input?.reportKey || 'users').trim();
    const cadence = String(input?.cadence || 'weekly').trim();
    const recipientEmail = input?.recipientEmail ? String(input.recipientEmail).trim() : null;
    if (name.length < 2) throw new PlatformError('invalid', 'A report name is required.');
    if (!isSupportedReport(reportKey)) throw new PlatformError('invalid', `reportKey must be one of: users (got ${reportKey}).`);
    if (!isCadence(cadence)) throw new PlatformError('invalid', `cadence must be one of ${CADENCES.join(', ')}.`);
    if (recipientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) throw new PlatformError('invalid', 'recipientEmail must be a valid email or omitted.');
    const filters = (input?.filters && typeof input.filters === 'object') ? input.filters : {};
    const r = await this.repo.createScheduledReport({ name, reportKey, filters, cadence, recipientEmail, format: 'csv', createdByUserId: ctx.userId, nextRunAt: computeNextRun(cadence as any, new Date()) });
    await this.audit(ctx, 'scheduled_report_created', 'scheduled_report', r.id, { name, reportKey, cadence });
    return { id: r.id, name, reportKey, cadence };
  }
  listScheduledReports() { return this.repo.listScheduledReports(); }
  async toggleScheduledReport(ctx: AdminCtx, id: string, enabled: boolean) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const ok = await this.repo.setScheduledReportEnabled(id, !!enabled);
    if (!ok) throw new PlatformError('not_found', 'Scheduled report not found.');
    await this.audit(ctx, 'scheduled_report_toggled', 'scheduled_report', id, { enabled: !!enabled });
    return { id, enabled: !!enabled };
  }
  async deleteScheduledReport(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const ok = await this.repo.deleteScheduledReport(id);
    if (!ok) throw new PlatformError('not_found', 'Scheduled report not found.');
    await this.audit(ctx, 'scheduled_report_deleted', 'scheduled_report', id, {});
    return { id, deleted: true };
  }

  /** Generate + deliver one definition, then advance its schedule. Reuses the single users-CSV path; unsupported
   *  report keys are recorded honestly rather than silently skipped. */
  private async runOneScheduledReport(def: any): Promise<{ id: string; status: string }> {
    const now = new Date();
    let status: 'delivered' | 'failed' | 'not_connected' | 'unsupported';
    if (def.reportKey === 'users') {
      const out = await this.generateUsersCsv(def.filters || {});
      status = await this.deliverReport(def.name, def.recipientEmail, out.filename, out.csv);
    } else {
      status = 'unsupported';
    }
    await this.repo.recordScheduledReportRun(def.id, status, now, computeNextRun(def.cadence, now));
    return { id: def.id, status };
  }
  /** Run every due definition. Triggered by the internal cron endpoint (shared secret) or a manual run-now. */
  async runDueScheduledReports(): Promise<{ ran: number; results: { id: string; status: string }[] }> {
    const due = await this.repo.dueScheduledReports(new Date());
    const results = [] as { id: string; status: string }[];
    for (const def of due) results.push(await this.runOneScheduledReport(def));
    return { ran: results.length, results };
  }
  async runScheduledReportNow(ctx: AdminCtx, id: string) {
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    const all = await this.repo.listScheduledReports();
    const def = all.rows.find((r: any) => r.id === id);
    if (!def) throw new PlatformError('not_found', 'Scheduled report not found.');
    const res = await this.runOneScheduledReport(def);
    await this.audit(ctx, 'scheduled_report_run', 'scheduled_report', id, { status: res.status, manual: true });
    return res;
  }

  // Branch access assign/revoke (§15 "Assign Branch"). Tenant-scoped mutation → gated on an active support session for
  // the tenant (§36), reason ≥5, audited with before/after. The repo validates that the branch and user both belong to
  // the tenant; access_level is constrained to the schema's set. Never crosses tenants.
  private async branchAccessGate(ctx: AdminCtx, input: any) {
    const sessionId = String(input?.sessionId || '').trim();
    const tenantId = String(input?.tenantId || '').trim();
    const userId = String(input?.userId || '').trim();
    const branchId = String(input?.branchId || '').trim();
    const reason = String(input?.reason || '').trim();
    if (!ctx.userId) throw new PlatformError('invalid', 'Authenticated super-admin context required.');
    if (!sessionId) throw new PlatformError('invalid', 'sessionId is required.');
    if (!tenantId || !userId || !branchId) throw new PlatformError('invalid', 'tenantId, userId and branchId are required.');
    if (reason.length < 5) throw new PlatformError('invalid', 'A reason (min 5 characters) is required.');
    const active = await this.repo.supportSessions(true);
    const session = active.find((s: any) => String(s.id) === sessionId);
    if (!session) throw new PlatformError('not_found', 'No active support session with that id. Open tenant support first.');
    if (String(session.tenant_id) !== tenantId) throw new PlatformError('invalid', 'Support session does not belong to that tenant.');
    return { tenantId, userId, branchId, reason };
  }

  async assignUserBranch(ctx: AdminCtx, input: any) {
    const ACCESS = ['owner', 'manager', 'viewer', 'report_only'];
    const { tenantId, userId, branchId, reason } = await this.branchAccessGate(ctx, input);
    const accessLevel = String(input?.accessLevel || 'viewer').trim();
    if (!ACCESS.includes(accessLevel)) throw new PlatformError('invalid', `accessLevel must be one of ${ACCESS.join(', ')}.`);
    const res = await this.repo.assignUserBranch({ tenantId, userId, branchId, accessLevel, byUserId: ctx.userId });
    if (!res) throw new PlatformError('not_found', 'Both the user and the branch must belong to that tenant.');
    await this.audit(ctx, 'super_admin_user_branch_assigned', 'user', userId, { tenantId, branchId, accessLevel, reason });
    return { ok: true, userId, branchId, accessLevel };
  }

  async revokeUserBranch(ctx: AdminCtx, input: any) {
    const { tenantId, userId, branchId, reason } = await this.branchAccessGate(ctx, input);
    const res = await this.repo.revokeUserBranch({ tenantId, userId, branchId });
    await this.audit(ctx, 'super_admin_user_branch_revoked', 'user', userId, { tenantId, branchId, reason, removed: res.removed });
    return { ok: true, userId, branchId, removed: res.removed };
  }

  tenantUsersAndBranches(tenantId: string) {
    if (!String(tenantId || '').trim()) throw new PlatformError('invalid', 'tenantId is required.');
    return this.repo.tenantUsersAndBranches(String(tenantId).trim());
  }
  async setUsageLimit(ctx: AdminCtx, tenantId: string, metric: string, limitValue: number) {
    const METRICS = ['customers', 'technicians', 'ai_calls', 'sms'];
    if (!tenantId) throw new PlatformError('invalid', 'tenantId is required.');
    if (!METRICS.includes(metric)) throw new PlatformError('invalid', `metric must be one of ${METRICS.join(', ')}.`);
    if (limitValue == null || (limitValue as any) === '') throw new PlatformError('invalid', 'limitValue must be a number from 0 to 100,000,000.');
    const v = Math.round(Number(limitValue));
    if (!Number.isFinite(v) || v < 0 || v > 100_000_000) throw new PlatformError('invalid', 'limitValue must be a number from 0 to 100,000,000.');
    await this.repo.setUsageLimit(tenantId, metric, v);
    await this.audit(ctx, 'super_admin_usage_limit_changed', 'tenant', tenantId, { metric, limitValue: v });
    return { tenantId, metric, limitValue: v };
  }
  paymentGateways() { return this.repo.paymentGateways(); }

  // KPIs + analytics are computed over ALL gateways (platform totals, filter-independent); the table list is the
  // filtered + paginated slice. Every row returned is the masked GatewayView — the raw MID never leaves this method.
  private gatewayPermissions() {
    return {
      view: true, configure: true, test_connection: true, export: true, pause: true, resume: true, view_reports: true,
    };
  }
  private gatewayFilters(q: any): GatewayFilters {
    return {
      search: q?.search, status: q?.status, processor: q?.processor, setupStage: q?.setupStage,
      settlementStatus: q?.settlementStatus, dateFrom: q?.dateFrom, dateTo: q?.dateTo,
    };
  }
  async paymentGatewaysState(q: any = {}) {
    const { gateways, events, chargebacksTracked } = await this.repo.paymentGatewaysState();
    const views = gateways.map(toGatewayView);
    const filters = this.gatewayFilters(q);
    const page = paginate(filterGateways(views, filters), +q?.page || 1, +q?.limit || 10);
    return {
      kpis: computeKpis(gateways, { chargebacksTracked }),
      filters,
      gateways: page.rows,
      pagination: { total: page.total, page: page.page, limit: page.limit, pages: page.pages },
      analytics: {
        statusBreakdown: statusBreakdown(gateways),
        topProcessors: topProcessors(gateways),
        recentEvents: events.slice(0, 12).map(mapEvent),
        recentActivity: events.slice(0, 8).map(mapEvent),
      },
      permissions: this.gatewayPermissions(),
    };
  }
  async paymentGatewaysExport(q: any = {}): Promise<{ filename: string; csv: string }> {
    const { gateways } = await this.repo.paymentGatewaysState();
    const views = gateways.map(toGatewayView);
    return { filename: 'payment-gateways.csv', csv: toCsv(filterGateways(views, this.gatewayFilters(q))) };
  }

  async state() {
    const [counts, apps, leads, hw, ss] = await Promise.all([
      this.repo.counts(),
      this.repo.applications({ page: 1, pageSize: 10 }),
      this.repo.leads({ page: 1, pageSize: 10 }),
      this.repo.hardware({ page: 1, pageSize: 10 }),
      this.repo.supportSessions(true),
    ]);
    return { counts, recentApplications: apps.rows, recentLeads: leads.rows, hardware: hw.rows, activeSupportSessions: ss };
  }

  // Per-tenant Live Operations monitor row: tenant directory (owner, plan, branch count) plus today's operational
  // rollup from `tickets` (services completed, checkouts/paid, collected revenue in integer cents). Tenant-centric
  // (every tenant appears, even with no tickets today), read-only, cross-tenant, scope-aware, and fail-soft (returns
  // [] with no DB-backed deployment). The scope value is parameterized via tenantPred — never string-interpolated.
  async tenantsLiveMonitor(scope?: OverviewScope): Promise<{ tenantId: string; ownerName: string | null; ownerAvatarUrl?: string | null; plan: string | null; branchCount: number; serviceDone: number; checkout: number; revenueTodayCents: number; deviceOnline: number; deviceTotal: number }[]> {
    if (!this.db) return [];
    const res: any = await sql`
      SELECT t.id AS tenant_id, o.full_name AS owner_name, o.avatar_url AS owner_avatar_url, sub.plan AS plan,
        (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id) AS branch_count,
        coalesce(tk.service_done, 0) AS service_done,
        coalesce(tk.checkout, 0) AS checkout,
        coalesce(tk.revenue_today_cents, 0) AS revenue_today_cents
      FROM tenants t
      LEFT JOIN LATERAL (SELECT u.full_name, u.avatar_url FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at ASC LIMIT 1) o ON true
      LEFT JOIN LATERAL (SELECT s.plan FROM tenant_subscriptions s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) sub ON true
      LEFT JOIN (
        SELECT tenant_id,
          count(*) FILTER (WHERE service_done_at::date = current_date) AS service_done,
          count(*) FILTER (WHERE paid_at::date = current_date) AS checkout,
          coalesce(sum(total_cents) FILTER (WHERE paid_at::date = current_date), 0) AS revenue_today_cents
        FROM tickets WHERE removed_at IS NULL GROUP BY tenant_id
      ) tk ON tk.tenant_id = t.id
      WHERE ${tenantPred(scope, 't.id')}
      ORDER BY t.display_name
    `.execute(this.db).catch(() => ({ rows: [] }));

    // Per-tenant device fleet — mirrors platformDevices exactly: same four sources, same "online" status set, and the
    // same app-code aggregation by string tenant_id (pos_payment_terminals.tenant_id is text while the others are uuid,
    // so a SQL union/group-by would need a uuid=text cast; we count in app code instead). Scope-narrowed by string match.
    const t = (this.db as any);
    const tf = <T extends { tenant_id: any }>(arr: T[]): T[] => (scope?.tenantId ? arr.filter((r) => String(r.tenant_id) === String(scope.tenantId)) : arr);
    const activeish = (s: string) => ['paired', 'active', 'online', 'assigned', 'connected'].includes((s || '').toLowerCase());
    const [terminals, displays, kiosks, leased] = await Promise.all([
      t.selectFrom('pos_payment_terminals').select(['status', 'tenant_id']).execute().catch(() => []),
      t.selectFrom('customer_display_devices').select(['pairing_status as status', 'tenant_id']).execute().catch(() => []),
      t.selectFrom('go_checkin_devices').select(['status', 'tenant_id']).execute().catch(() => []),
      t.selectFrom('hardware_package_devices').select(['status', 'tenant_id']).execute().catch(() => []),
    ]);
    const dev = new Map<string, { online: number; total: number }>();
    const tally = (arr: any[]) => tf(arr).forEach((r) => { const k = String(r.tenant_id); const c = dev.get(k) || { online: 0, total: 0 }; c.total++; if (activeish(r.status)) c.online++; dev.set(k, c); });
    tally(terminals); tally(displays); tally(kiosks); tally(leased);

    return (res.rows as any[]).map((r) => {
      const d = dev.get(String(r.tenant_id)) || { online: 0, total: 0 };
      return {
        tenantId: String(r.tenant_id),
        ownerName: r.owner_name ?? null,
        ownerAvatarUrl: r.owner_avatar_url ? buildMediaUrl(r.owner_avatar_url) : null,
        plan: r.plan ?? null,
        branchCount: Number(r.branch_count) || 0,
        serviceDone: Number(r.service_done) || 0,
        checkout: Number(r.checkout) || 0,
        revenueTodayCents: Number(r.revenue_today_cents) || 0,
        deviceOnline: d.online,
        deviceTotal: d.total,
      };
    });
  }


  // Intraday revenue for the Live Revenue Monitor: collected revenue (integer cents) bucketed by hour-of-day for today
  // and yesterday, from `tickets.paid_at`. Read-only, cross-tenant, scope-aware (parameterized via tenantPred), and
  // fail-soft (returns 24 zero-buckets each with no DB-backed deployment). Excludes soft-removed tickets.
  async revenueHourlyTodayYesterday(scope?: OverviewScope): Promise<{ today: number[]; yesterday: number[] }> {
    const zeros = () => Array.from({ length: 24 }, () => 0);
    const out = { today: zeros(), yesterday: zeros() };
    if (!this.db) return out;
    const res: any = await sql`
      SELECT (paid_at::date = current_date) AS is_today, extract(hour from paid_at)::int AS hr, sum(total_cents) AS cents
      FROM tickets
      WHERE removed_at IS NULL AND paid_at IS NOT NULL
        AND paid_at >= current_date - interval '1 day' AND paid_at < current_date + interval '1 day'
        AND ${tenantPred(scope, 'tenant_id')}
      GROUP BY 1, 2
    `.execute(this.db).catch(() => ({ rows: [] }));
    for (const r of res.rows as any[]) {
      const hr = Number(r.hr);
      if (!Number.isInteger(hr) || hr < 0 || hr > 23) continue;
      (r.is_today ? out.today : out.yesterday)[hr] = Number(r.cents) || 0;
    }
    return out;
  }

}

/** Constitution 7 §81 — the support scope class. Accepts the constitution's names and the Support Access screen's
 *  earlier values (read_only / read_operational / limited_support), mapped to the nearest class. Unknown → null. */
export function supportScopeFrom(v: unknown): 'READ_ONLY' | 'STANDARD_SUPPORT' | 'ELEVATED_SUPPORT' | null {
  const s = String(v ?? 'READ_ONLY').trim();
  const map: Record<string, 'READ_ONLY' | 'STANDARD_SUPPORT' | 'ELEVATED_SUPPORT'> = {
    READ_ONLY: 'READ_ONLY', STANDARD_SUPPORT: 'STANDARD_SUPPORT', ELEVATED_SUPPORT: 'ELEVATED_SUPPORT',
    read_only: 'READ_ONLY', read_operational: 'READ_ONLY', limited_support: 'STANDARD_SUPPORT',
  };
  return map[s] ?? null;
}
