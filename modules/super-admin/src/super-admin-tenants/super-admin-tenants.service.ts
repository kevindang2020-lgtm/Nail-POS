/**
 * super-admin-tenants.service.ts
 * ---------------------------------------------------------------------------
 * Orchestrates the Super Admin Tenants use-cases using the tested pure core
 * (super-admin-tenants-core) over a repository port. Framework-free and fully
 * runnable against InMemorySuperAdminTenantsRepo (see the spec). The NestJS
 * controller/module wrap this; the service itself has no framework imports.
 *
 * CROSS-TENANT: every read here is platform-wide by design.
 */

import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import {
  buildTenantsState,
  toViewRow,
  canTransition, statusChangeRequirement,
  actionForStatus,
  auditEventForStatus,
  isSetupComplete,
  validateCreateTenant,
  validateSuspend,
  auditFor,
  type TabKey,
  type TenantFilter,
  type TenantAuditAction,
} from './super-admin-tenants-core';
import type { SuperAdminTenantsRepo } from './super-admin-tenants.repository';
import type {
  TenantsStateResponse,
  CreateTenantRequest,
  TenantMutationResponse,
  ResetOwnerPasswordResponse,
  ImportTenantsRequest,
  ImportTenantsResponse,
  TenantAuditResponse,
} from './super-admin-tenants.dto';
import { normalizeCreateRequest } from './super-admin-tenants.dto';
import { buildTenantDirectoryAggregates, signalsFromRecord, type TenantDirectoryAggregates } from './tenant-directory-aggregates';
import { buildOnboardingPipeline, buildUpcomingRenewals, type OnboardingPipeline, type UpcomingRenewals } from './directory-enrichment';
import { scoreTenantHealth } from '../super-admin-tenant-health/tenant-health-score';
import { decideLifecycleMove, reactivationRequirement, archiveRequirement } from './tenant-lifecycle-core';
import { MIN_STATUS_REASON } from './tenant-lifecycle-core';
import type { CredentialDelivery, DeliveryMethod } from '../admin-credential-delivery';

/** Actor extracted from req.ctx by the controller (the authenticated Super Admin). */
export interface Actor {
  userId?: string;
  ip?: string;
  /** from the SIGNED session only (Constitution 7 §20 reactivation validation) */
  permissions?: string[];
}

const SUPPORT_TTL_MIN = 30;

export class SuperAdminTenantsService {
  /** smsPlans is OPTIONAL (last arg): §41 default-package hook. Absent → behaviour identical to before. */
  constructor(
    private readonly repo: SuperAdminTenantsRepo,
    private readonly smsPlans?: { applyDefaultForNewTenant(tenantId: string): Promise<unknown> },
    private readonly realtime?: RealtimeEmitter,
    /** Security Deep Scan C2: delivers the owner's temporary password to the OWNER (email / SMS). Absent → refused. */
    private readonly credentials?: CredentialDelivery,
  ) {}

  async getState(opts: {
    tab?: TabKey;
    filter?: TenantFilter;
    page?: number;
    pageSize?: number;
  }): Promise<TenantsStateResponse> {
    const records = await this.repo.listTenantRecords();
    const state = buildTenantsState(records, opts);
    // Attach per-row tenant health from the SAME engine that drives the KPI distribution (reconciles, §36).
    const healthById = new Map(records.map((r) => [r.id, scoreTenantHealth(signalsFromRecord(r))]));
    state.tenants = state.tenants.map((row) => {
      const h = healthById.get(row.id);
      return h ? { ...row, healthScore: h.score, healthBand: h.band, churnRisk: h.churnRisk } : row;
    });
    return state;
  }

  /**
   * Read-only directory overview powering the Tenants page's analytics (12 KPIs, plan/status/health
   * distributions, growth, alerts) + enrichment (POS devices, onboarding pipeline, renewals). Derives the
   * aggregate from the SAME records the directory lists, so everything reconciles with the table total (§36).
   * The two device/ticket KPIs and the pipeline/renewals come from the repo's thin enrichment reads; when a
   * source is null the value stays honestly "NotConnected" rather than fabricated.
   */
  async getDirectoryOverview(opts: { now?: number } = {}): Promise<
    TenantDirectoryAggregates & { onboardingPipeline: OnboardingPipeline; upcomingRenewals: UpcomingRenewals }
  > {
    const now = opts.now ?? Date.now();
    const [records, raw] = await Promise.all([this.repo.listTenantRecords(), this.repo.directoryEnrichmentRaw()]);
    const agg = buildTenantDirectoryAggregates(records, { now });
    // Fill the two honest-null KPIs from live enrichment when available.
    agg.kpis.activePosDevices = raw.activePosDevices;
    // openSupportTickets stays null here; the client sources the platform count from overview governance KPIs.
    const onboardingPipeline = buildOnboardingPipeline(raw.applications);
    const upcomingRenewals = buildUpcomingRenewals(raw.renewals, { now });
    // Reconcile the "subscriptions expiring in 7 days" alert from real renewal data when present.
    if (upcomingRenewals.available) {
      const expiring = upcomingRenewals.rows.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 7).length;
      const alert = agg.healthAlerts.find((a) => a.key === 'subscriptions_expiring_7d');
      if (alert) { alert.count = expiring; alert.available = true; }
    }
    return { ...agg, onboardingPipeline, upcomingRenewals };
  }

  async createTenant(
    req: CreateTenantRequest,
    actor: Actor = {},
  ): Promise<TenantMutationResponse> {
    const n = normalizeCreateRequest(req);
    const v = validateCreateTenant(n);
    if (!v.ok) return { ok: false, errors: v.errors };

    const code = (n.tenantCode || autoCode(n.displayName)).toUpperCase();
    if (await this.repo.tenantCodeExists(code)) {
      return { ok: false, errors: [`Tenant code ${code} is already in use`] };
    }
    const id = await this.repo.createTenant({
      displayName: n.displayName,
      legalName: n.legalName,
      tenantCode: code,
      ownerName: n.ownerName,
      ownerEmail: n.ownerEmail,
      ownerPhone: n.ownerPhone,
      plan: n.plan,
      aiPackage: n.aiPackage,
      primaryState: n.state,
      primaryCity: n.city,
      initialCommissionPercent: n.initialCommissionPercent ?? 50,
    });
    // §41: default SMS package for new tenants — fire-and-forget; a new salon must never fail on this.
    void this.smsPlans?.applyDefaultForNewTenant(id).catch(() => undefined);
    await this.repo.writeAudit({
      ...auditFor('super_admin_tenant_created', id, { code }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
    const rec = await this.repo.getTenantRecord(id);
    return { ok: true, tenant: rec ? toViewRow(rec) : undefined };
  }

  async suspend(
    id: string,
    reason: string,
    actor: Actor = {},
  ): Promise<TenantMutationResponse> {
    const v = validateSuspend({ reason });
    if (!v.ok) return { ok: false, errors: v.errors };
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };

    const t = canTransition(rec.storedStatus, 'suspend');
    if (!t.ok) return { ok: false, errors: [t.error!] };

    await this.repo.setStatus(id, t.to!, { reason, byUserId: actor.userId });
    await this.repo.writeAudit({
      ...auditFor('super_admin_tenant_suspended', id, { reason }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
    const updated = await this.repo.getTenantRecord(id);
    return { ok: true, tenant: updated ? toViewRow(updated) : undefined };
  }

  async reactivate(id: string, actor: Actor = {}): Promise<TenantMutationResponse> {
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };

    const t = canTransition(rec.storedStatus, 'reactivate');
    if (!t.ok) return { ok: false, errors: [t.error!] };

    await this.repo.setStatus(id, t.to!);
    await this.repo.writeAudit({
      ...auditFor('super_admin_tenant_reactivated', id),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
    const updated = await this.repo.getTenantRecord(id);
    return { ok: true, tenant: updated ? toViewRow(updated) : undefined };
  }

  /**
   * Security Deep Scan C2 (Oct 23 2026): reset the salon owner's password WITHOUT the Super Admin ever learning it. The
   * temporary password goes to the owner's own email / phone (CredentialDelivery); the caller gets the channel and a
   * masked destination. A reason is required and audited (route: step-up). A platform account set as a salon's owner is
   * refused — platform passwords are never reset from a tenant's page. No channel → CANNOT_DELIVER, nothing changed.
   * (Before: a new password was set, the owner moved to 'invited', and the password returned to the caller.)
   */
  async resetOwnerPassword(
    id: string,
    actor: Actor = {},
    opts: { reason?: string; deliveryMethod?: DeliveryMethod } = {},
  ): Promise<ResetOwnerPasswordResponse> {
    const reason = String(opts.reason ?? '').trim();
    if (reason.length < MIN_STATUS_REASON) return { ok: false, code: 'REASON_REQUIRED', errors: [`A reason of at least ${MIN_STATUS_REASON} characters is required.`] };
    const owner = await this.repo.ownerAccountForReset(id);
    if (!owner) return { ok: false, code: 'RESOURCE_NOT_FOUND', errors: ['Tenant not found'] };
    // a platform account carries no salon (tenant_id NULL) and/or a platform role — either way it is not this salon's owner
    if (owner.platformRole || owner.tenantId !== id) {
      return { ok: false, code: 'PLATFORM_ACCOUNT_TARGET', errors: ['This salon\'s owner account is not a salon account of this salon, so its password cannot be reset here.'] };
    }
    if (!this.credentials) return { ok: false, code: 'CANNOT_DELIVER', errors: ['Password delivery is not configured on this server, so nothing was changed.'] };
    const sent = await this.credentials.deliverTemporaryPassword({ userId: owner.userId, email: owner.email, phone: owner.phone }, opts.deliveryMethod ?? 'auto', 'owner_reset');
    if (!sent.ok) return { ok: false, code: sent.code, errors: [sent.message] };
    await this.repo.writeAudit({
      ...auditFor('super_admin_tenant_owner_password_reset', id, { reason, delivery: sent.delivery, sentTo: sent.sentTo, ownerUserId: owner.userId }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
    return { ok: true, delivery: sent.delivery, sentTo: sent.sentTo, expiresAt: sent.expiresAt };
  }

  // ---- Quick Actions (Tenants/Salons detail panel) -------------------------

  /**
   * Unified status change for the Pause/Activate quick actions. Validates the transition with the same pure engine the
   * suspend/reactivate routes use, then writes a tenant_paused / tenant_activated / tenant_cancelled audit event.
   * Returns warning metadata (non-blocking) when activating a tenant whose payment setup is incomplete.
   */
  /** The one direct tenant_status_updated push (§343 fallback): used only when the change is not recorded as a platform
   *  event that the projection will broadcast. Shared by changeStatus and changeLifecycle so there is a single call site. */
  private pushTenantStatusFallback(tenantId: string, status: string): void { try { this.realtime?.toTenant({ tenantId, branchId: '' } as never, EVENTS.tenantStatusUpdated, { status }); } catch { /* best-effort */ } }   // B-14: both call sites are §343-guarded

  async changeStatus(
    id: string,
    target: 'active' | 'paused' | 'suspended' | 'cancelled',
    reason: string | undefined,
    actor: Actor = {},
    reasonCode?: string,
  ): Promise<TenantMutationResponse & { warning?: string }> {
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };

    const action = actionForStatus(rec.storedStatus, target);
    if (!action) return { ok: false, errors: [`Unsupported target status: ${target}`] };
    const t = canTransition(rec.storedStatus, action);
    if (!t.ok) return { ok: false, errors: [t.error!] };
    // Constitution 7 §18/§20/§21: a suspension needs a reason code + a written reason; reactivation / closure a reason
    const missing = statusChangeRequirement(action, reason, reasonCode);
    if (missing) return { ok: false, errors: [missing] };
    if (action === 'reactivate') {
      const blocked = reactivationRequirement(await this.repo.getSuspensionReasonCode?.(id), actor.permissions);
      if (blocked) return { ok: false, errors: [blocked] };
    }

    await this.repo.setStatus(id, t.to!, { reason: reason ?? '', byUserId: actor.userId, reasonCode: action === 'suspend' ? reasonCode : null });
    // Constitution 9 §246: tenant_status_updated was declared, versioned and routed to dashboard/overview but never
    // emitted — a tenant paused or suspended by Super Admin left every open POS and Owner App showing the old state
    // until the next reload. The authorization revalidation (§43) already ENDS their streams on a non-active tenant;
    // this tells the clients that are still allowed in (a reactivation) to refetch.
    // §343: 'active' and 'suspended' are recorded as platform events and projected when the publisher is on; any other
    // status (and every status with the publisher off) is pushed directly, as before
    const recorded = (t.to === 'active' || t.to === 'suspended') && !!(this.repo as any).emitsDomainEvents?.();
    if (!recorded) this.pushTenantStatusFallback(id, t.to!);
    await this.repo.writeAudit({
      ...auditFor(auditEventForStatus(target), id, { reason, ...(action === 'suspend' ? { reasonCode } : {}), from: rec.storedStatus, to: t.to, source: 'tenants_salons_quick_actions' }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
    const updated = await this.repo.getTenantRecord(id);
    const warning = target === 'active' && !isSetupComplete(rec)
      ? 'Tenant activated, but payment setup is still incomplete.'
      : undefined;
    return { ok: true, tenant: updated ? toViewRow(updated) : undefined, warning };
  }

  /**
   * Bulk status change (Bulk Actions, §27). Dangerous targets (paused/suspended/cancelled) REQUIRE a reason.
   * Each tenant goes through the SAME validated + audited single-tenant path (changeStatus), so every change is
   * transition-checked and writes its own audit row; partial failures are reported per tenant rather than aborting
   * the whole batch. Idempotent in effect: a tenant already in the target state is reported as a skipped/failed
   * item (no duplicate state change), not an exception.
   */
  /**
   * Constitution 7 §16–§21 — move a tenant through the explicit lifecycle (decision D6). The transition table and the
   * per-move requirements are in tenant-lifecycle-core; the access status follows in the database (migration 463).
   */
  async changeLifecycle(id: string, to: string, reason: string | undefined, reasonCode: string | undefined, actor: Actor = {}):
      Promise<{ ok: boolean; errors?: string[]; warnings?: string[]; from?: string; to?: string; status?: string }> {
    if (!this.repo.getLifecycle || !this.repo.setLifecycle) return { ok: false, errors: ['Lifecycle changes need the database.'] };
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };
    const from = (await this.repo.getLifecycle(id)) ?? '';
    const d = decideLifecycleMove(from, to, reason, reasonCode);
    if (!d.ok) return { ok: false, errors: [d.error] };
    if (d.to === 'ARCHIVED') {
      const facts = await this.repo.closureFacts?.(id);
      const blocked = archiveRequirement(facts?.closedAt ?? null, facts?.activeLegalHolds ?? 0, new Date());
      if (blocked) return { ok: false, errors: [blocked] };
    }
    if (d.to === 'ACTIVE' && (d.from === 'SUSPENDED' || d.from === 'RESTRICTED')) {
      const blocked = reactivationRequirement(await this.repo.getSuspensionReasonCode?.(id), actor.permissions);
      if (blocked) return { ok: false, errors: [blocked] };
    }
    const { status } = await this.repo.setLifecycle(id, d.to, { reasonCode: reasonCode ?? null });
    // §343: same rule as changeStatus — an access change to active/suspended is recorded as a platform event (written in
    // setLifecycle's transaction) and projected when the publisher is on; only otherwise is it pushed directly
    const recorded = (status === 'active' || status === 'suspended') && !!(this.repo as any).emitsDomainEvents?.();
    if (status !== rec.storedStatus && !recorded) this.pushTenantStatusFallback(id, status);
    await this.repo.writeAudit({
      ...auditFor('tenant_lifecycle_changed', id, { from: d.from, to: d.to, reason: reason?.trim(), ...(reasonCode ? { reasonCode } : {}), accessStatus: status }),
      actorUserId: actor.userId, ip: actor.ip,
    });
    const stillDisabled = d.to === 'ACTIVE' ? ((await this.repo.compromisedIntegrationCount?.(id)) ?? 0) : 0;
    return { ok: true, from: d.from, to: d.to, status, ...(stillDisabled ? { warnings: [`${stillDisabled} integration(s) disabled as compromised stay disabled — re-enable each after review.`] } : {}) };
  }

  async bulkChangeStatus(
    tenantIds: string[],
    target: 'active' | 'paused' | 'suspended' | 'cancelled',
    reason: string | undefined,
    actor: Actor = {},
    reasonCode?: string,
  ): Promise<{ ok: boolean; total: number; succeeded: number; failed: number; errors?: string[]; results: Array<{ id: string; ok: boolean; error?: string }> }> {
    const ids = Array.from(new Set((tenantIds || []).filter((x) => typeof x === 'string' && x.trim())));
    if (ids.length === 0) return { ok: false, total: 0, succeeded: 0, failed: 0, errors: ['Select at least one tenant.'], results: [] };
    const dangerous = target === 'paused' || target === 'suspended' || target === 'cancelled';
    if (dangerous && !(reason && reason.trim())) {
      return { ok: false, total: ids.length, succeeded: 0, failed: ids.length, errors: ['A reason is required for this action.'], results: [] };
    }
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      const r = await this.changeStatus(id, target, reason, actor, reasonCode);
      results.push({ id, ok: !!r.ok, error: r.ok ? undefined : (r.errors?.[0] || 'Change could not be applied.') });
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { ok: succeeded > 0, total: ids.length, succeeded, failed: ids.length - succeeded, results };
  }

  /** Audit a Super Admin gateway lifecycle action (pause/resume/disable). The status change itself is applied by the
   *  PaymentGatewayResolver; this records the action in audit_logs (no secrets, masked from/to status only). */
  async recordGatewayStatusAudit(
    tenantId: string,
    action: 'pause' | 'resume' | 'disable',
    from: string,
    to: string,
    actor: Actor = {},
  ): Promise<void> {
    const event = action === 'pause' ? 'super_admin_gateway_paused'
      : action === 'resume' ? 'super_admin_gateway_resumed' : 'super_admin_gateway_disabled';
    await this.repo.writeAudit({
      ...auditFor(event, tenantId, { from, to, source: 'payment_gateways_actions' }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
  }

  /** Audit a Configure-Gateway action (verify/sync/rotate-secret) — the event name is the audit verb (spec §12). */
  async recordGatewayAudit(tenantId: string, event: TenantAuditAction, actor: Actor = {}, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.repo.writeAudit({
      ...auditFor(event, tenantId, { source: 'payment_gateways_configure', ...metadata }),
      actorUserId: actor.userId,
      ip: actor.ip,
    });
  }

  /** Send Warning quick action — persists the warning and audits warning_sent. Email/SMS are dispatched downstream. */
  async sendWarning(
    id: string,
    input: { warningType: string; severity: string; subject: string; message: string; sendEmail?: boolean; sendSms?: boolean; showInTenantDashboard?: boolean; internalNote?: string },
    actor: Actor = {},
  ): Promise<{ ok: true; warningId: string; deliveryStatus: string } | { ok: false; errors: string[] }> {
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };
    const subject = (input.subject || '').trim();
    const message = (input.message || '').trim();
    if (!subject || !message) return { ok: false, errors: ['Subject and message are required'] };
    const allowedSeverity = ['low', 'medium', 'high', 'critical'];
    const severity = allowedSeverity.includes(input.severity) ? input.severity : 'medium';

    const saved = await this.repo.createWarning({
      tenantId: id, actorUserId: actor.userId, warningType: input.warningType || 'custom', severity,
      subject, message, sendEmail: !!input.sendEmail, sendSms: !!input.sendSms,
      showInTenantDashboard: input.showInTenantDashboard !== false, internalNote: input.internalNote,
    });
    await this.repo.writeAudit({
      ...auditFor('warning_sent', id, { warningType: input.warningType, severity, subject, source: 'tenants_salons_quick_actions' }),
      actorUserId: actor.userId, ip: actor.ip,
    });
    return { ok: true, warningId: saved.id, deliveryStatus: saved.deliveryStatus };
  }

  /** Recent warnings for a tenant (newest first) with delivery status — drives the detail-panel Recent Warnings list. */
  listWarnings(id: string, limit = 20) {
    return this.repo.listWarnings(id, Math.min(50, Math.max(1, limit)));
  }

  /** View POS / Support Access quick action — opens a short-lived support session and audits support_access_opened. */
  async openSupportAccess(
    id: string,
    opts: { reason?: string; source?: string },
    actor: Actor = {},
  ): Promise<{ ok: true; sessionId: string; expiresAt: string } | { ok: false; errors: string[] }> {
    const rec = await this.repo.getTenantRecord(id);
    if (!rec) return { ok: false, errors: ['Tenant not found'] };
    if (rec.storedStatus === 'cancelled') return { ok: false, errors: ['Cannot open support access for a cancelled tenant'] };

    // Constitution 7 §74 / §302 "never allow Support Mode without reason": a real reason, not a placeholder code
    const reason = String(opts.reason ?? '').trim();
    if (reason.length < MIN_STATUS_REASON || /^[a-z0-9_]+$/.test(reason)) return { ok: false, errors: [`Say why you need access to this salon (at least ${MIN_STATUS_REASON} characters).`] };
    const session = await this.repo.createSupportSession(id, {
      reason, byUserId: actor.userId, ip: actor.ip, ttlMinutes: SUPPORT_TTL_MIN,
    });
    await this.repo.writeAudit({
      ...auditFor('support_access_opened', id, { reason: opts.reason, source: opts.source || 'tenants_salons_quick_actions' }),
      actorUserId: actor.userId, ip: actor.ip,
    });
    // Decision D7 (CONTROL_PLANE_AUDIT.md): this used to return /tenant/<id>/pos?supportSession=… — a route no app has, so
    // the admin landed nowhere. Support Mode happens INSIDE Super Admin (the banner, the oversight screens); a read-only
    // POS view would need a support realm in the POS app (§80: PLATFORM_SUPPORT + supportSessionId, never an owner token).
    return { ok: true, sessionId: session.token, expiresAt: session.expiresAt };
  }

  async importTenants(
    req: ImportTenantsRequest,
    actor: Actor = {},
  ): Promise<ImportTenantsResponse> {
    let created = 0;
    let skipped = 0;
    const rowErrors: Array<{ index: number; errors: string[] }> = [];
    for (let i = 0; i < req.rows.length; i++) {
      const row = req.rows[i];
      const res = await this.createTenant(
        {
          displayName: row.displayName,
          ownerName: row.ownerName ?? row.displayName + ' Owner',
          ownerEmail: row.ownerEmail,
          plan: row.plan ?? 'Starter Plan',
          state: row.state,
        },
        actor,
      );
      if (res.ok) created++;
      else {
        skipped++;
        rowErrors.push({ index: i, errors: res.errors ?? ['Unknown error'] });
      }
    }
    return { ok: rowErrors.length === 0, created, skipped, rowErrors };
  }

  async getAudit(id: string): Promise<TenantAuditResponse> {
    const rec = await this.repo.getTenantRecord(id);
    const entries = await this.repo.getAudit(id);
    return { tenantId: id, tenantName: rec?.displayName ?? '(unknown)', entries };
  }

}

function autoCode(displayName: string): string {
  const letters = (displayName || 'TENANT').replace(/[^a-zA-Z]/g, '').toUpperCase();
  const stem = (letters + 'XXXX').slice(0, 4);
  const n = Math.floor(100 + Math.random() * 900);
  return stem + n;
}
