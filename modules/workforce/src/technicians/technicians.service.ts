// technicians.service.ts — tenant POS Technicians. Resolves tenant/role from session; enforces per-action
// permissions; validates; preserves history; sanitizes tech permissions (no super-admin escalation); audits.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { invalidateTechAppAccess } from './tech-app-access.middleware';
import { hasPermission, isStaffPrincipal, hasTenantWideScope } from '@aipowersalon/permissions';
import {
  POSTechniciansFullState, TechnicianFilters, TechnicianListResponse, POSTechnicianRow, POSTechnicianDetail,
  CreateTechnicianRequest, UpdateTechnicianRequest, ChangeTechnicianStatusRequest, TechLifecycleStatus,
  TechnicianSchedule, TechnicianShift, TechnicianSkills, TechnicianServicesMap, TechnicianCommissionConfig,
  TechnicianPayrollSummary, TechnicianAppAccess, TechnicianPermissions, sanitizeTechPermissions, techniciansToCsv,
} from './technicians.dto';
import { stripCommissionFromUpdate, projectTechnicianPay, projectTechnicianListPay, projectTechniciansStatePay } from './technicians-pay-projection';
import { TechniciansContext, TechniciansRepositoryPort } from './technicians.repository';
import type { EntitlementsService } from '@aipowersalon/platform';
import type { GlobalTechIdentityService } from '../tech-profile/global-tech-identity.service';
// from the PURE core, not the service: a value import of the service would drag @nestjs/common into the
// Nest-free esbuild harness bundle for technicians-core.spec.ts and break its build.
import { GlobalTechIdentityError } from '../tech-profile/global-tech-identity-core';
import type { TechniciansAuditSink } from './technicians-audit.kysely';
import { CommissionSecurityService } from './commission-security.service';
import { setTechnicianServices } from './technician-skills';
import { recordEmploymentEvent, lifecycleEventType, readEmploymentHistory, type EmploymentHistoryRow } from './employment-history';
import { parseTechnicianCsv, validateImportRows, type ImportRowResult } from './technician-import-core';
import { revokeTechnicianAccess, restoreTechnicianAccess, type RevokeRealtimeHook } from './revoke-technician-access';
import type { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { TimeClockService, TimeClockConflictError, TimeClockValidationError } from '../time-clock/time-clock.service';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { defaultCommissionForTenant } from '../compensation/compensation-rule-loader';
import { PLATFORM_FALLBACK_COMMISSION_PERCENT } from '../compensation/commission-basis';

import { authorTechnicianCommissionRules, readTechnicianCommissionRules, validateTechnicianCommissionEdit } from './technician-commission-rules';
export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
/** 409 — an illegal clock move (CLOCK_STATE_CONFLICT) surfaced through the legacy PATCH /shifts route. */
export class ConflictError extends Error { constructor(msg: string, public readonly code = 'VERSION_CONFLICT', public readonly currentVersion?: number) { super(msg); this.name = 'ConflictError'; } }

const SENSITIVE_PERMS = ['pos.tech.process_payment', 'pos.tech.reopen_service', 'pos.tech.edit_customer'];

export interface POSTechniciansAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class TechniciansService {
  private audit: POSTechniciansAuditLog[] = [];
  private pending: Promise<void>[] = [];
  // `identity` is optional so the no-database path (in-memory repo, dev, and every existing unit test that
  // constructs `new TechniciansService(repo)`) behaves exactly as before. When a Postgres handle exists it is
  // always injected, and creating a technician always mints or links a global account.
  constructor(
    private readonly repo: TechniciansRepositoryPort,
    private readonly entitlements?: EntitlementsService,
    private readonly identity?: GlobalTechIdentityService,
    private readonly sink?: TechniciansAuditSink,
    private readonly realtime?: RevokeRealtimeHook | null,
    // Technician Profile merge (Oct 12 2026): lifecycle changes mirror into the authoritative employment status (579)
    // and revoke/restore access (mandate §63/§137); the legacy PATCH /shifts route goes through the time clock (server
    // time, one open punch). All optional (no-DB path).
    private readonly workforce?: WorkforceStatusService | null,
    private readonly timeClock?: TimeClockService | null,
  ) {}

  private assertUser(ctx: TechniciansContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Technicians are not available for this role');
  }
  private need(ctx: TechniciansContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  // BUILD_PLAN Phase 9: was PRIVILEGED = ['OWNER', 'MANAGER'] by role NAME. Granting a technician payment processing or
  // another sensitive permission is a permission change — roles.manage (owners and managers by default, the same key the
  // Roles & Permissions screen uses), so a template / DENY that withholds it withholds this too.
  private priv(ctx: TechniciansContext) { return hasPermission(ctx as any, 'roles.manage'); }
  /**
   * Every technician action on the POS passes through here — hiring, suspension, commission changes, payment
   * permissions. Until now it pushed onto an in-memory array and stopped, so `audit_logs` contained none of it
   * and the Super Admin audit screens reported a truthful-looking zero for all of it.
   *
   * The array stays (the Nest-free harness reads it via auditLog()); the sink writes the same event to the real
   * table beside it. Fire-and-forget with the error swallowed inside the sink — an audit failure must never
   * block the action, but it is never faked as written either, and a pgtest asserts the row actually lands.
   */
  private log(ctx: TechniciansContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    const entry: POSTechniciansAuditLog = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() };
    this.audit.push(entry);
    if (this.sink) this.pending.push(this.sink.record(entry));
  }

  /**
   * Await every audit write this service has started.
   *
   * The writes are fire-and-forget so an audit failure can never block a hire — but "fire-and-forget" is also
   * how `KyselyLoginAttemptSink` silently lost every record it ever took, and nothing noticed because no test
   * could wait for it. This lets a test wait, and a graceful shutdown drain.
   */
  async flushAudit(): Promise<void> {
    const p = this.pending.slice();
    this.pending.length = 0;
    await Promise.all(p);
  }
  auditLog(): POSTechniciansAuditLog[] { return this.audit.slice(); }
  private mustFind<T>(v: T | null, msg = 'Technician not found'): T { if (v === null || v === undefined) throw new ValidationError(msg); return v; }

  // ---- read ----
  async getState(ctx: TechniciansContext, f: TechnicianFilters = {}): Promise<POSTechniciansFullState> { this.need(ctx, 'pos.technicians.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_technicians_viewed', 'pos_technician', undefined, undefined, undefined, { filters: f }); return projectTechniciansStatePay(st, this.canViewPay(ctx)); }
  async getKpis(ctx: TechniciansContext) { return (await this.getState(ctx)).kpisFull; }
  async list(ctx: TechniciansContext, f: TechnicianFilters = {}): Promise<TechnicianListResponse> { this.need(ctx, 'pos.technicians.view'); return projectTechnicianListPay((await this.repo.query(ctx, f)).technicians, this.canViewPay(ctx)); }
  // Technicians qualified for a service (active + eligible), tenant/branch scoped. Powers skill search + the helper picker.
  async listQualified(ctx: TechniciansContext, serviceId: string) { this.need(ctx, 'pos.technicians.view'); return this.repo.listQualified(ctx, serviceId); }
  // Server-side enforcement helper (no data exposure): is THIS technician qualified for THIS service in this context?
  async isQualified(ctx: TechniciansContext, technicianId: string, serviceId: string): Promise<boolean> { const q = await this.repo.listQualified(ctx, serviceId); return q.some((t) => t.technicianId === technicianId); }
  async search(ctx: TechniciansContext, f: TechnicianFilters = {}): Promise<TechnicianListResponse> { return this.list(ctx, f); }
  async detail(ctx: TechniciansContext, id: string): Promise<POSTechnicianDetail> { this.need(ctx, 'pos.technicians.view'); return projectTechnicianPay(this.mustFind(await this.repo.detail(ctx, id)), this.canViewPay(ctx)); }
  /** technicians.view_pay — OWNER/MANAGER. Front desk / reception (technicians.view) never see commission or payroll figures (mandate §72, §122). */
  private canViewPay(ctx: TechniciansContext): boolean { return hasPermission(ctx as any, 'technicians.view_pay'); }
  private needPay(ctx: TechniciansContext) { this.need(ctx, 'pos.technicians.view'); if (!this.canViewPay(ctx)) throw new ForbiddenError('Missing technicians.view_pay'); }

  // ---- validation ----
  private validate(req: Partial<CreateTechnicianRequest>, requireAll: boolean) {
    if (requireAll || req.firstName !== undefined) if (!req.firstName || !req.firstName.trim()) throw new ValidationError('First name is required');
    if (requireAll || req.lastName !== undefined) if (!req.lastName || !req.lastName.trim()) throw new ValidationError('Last name is required');
    if (req.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.email)) throw new ValidationError('Email is not valid');
    if (req.phone && !/^[+()\-\s\d]{7,}$/.test(req.phone)) throw new ValidationError('Phone is not valid');
    if (req.defaultCommissionPercent !== undefined && (req.defaultCommissionPercent < 0 || req.defaultCommissionPercent > 100)) throw new ValidationError('Commission percent must be 0–100');
  }

  // ---- create / edit ----
  /**
   * "Does this technician already have an AIPowerSalon account?" — asked BEFORE create, so the manager sees a
   * person to invite rather than a duplicate to make. Gated on the create permission: it is a step of hiring.
   */
  async lookup(ctx: TechniciansContext, input: { phone?: string; email?: string }) {
    this.need(ctx, 'pos.technicians.create');
    if (!this.identity?.available) return { found: false as const };
    return this.identity.lookupForManager(ctx, input);
  }

  /**
   * Create a technician — and give them the ONE permanent global identity that belongs to them, not to us.
   *
   * Until now this wrote a `technicians` row with no user_id and no global_tech_profile_id, and created no
   * `users` row at all. The technician it produced could not log in, and therefore could never reach
   * `getOrCreateMyProfile` — the only code that ever minted a global profile. The global layer existed and was
   * unreachable. That is the defect this closes.
   */
  async create(ctx: TechniciansContext, req: CreateTechnicianRequest): Promise<POSTechnicianRow> {
    this.need(ctx, 'pos.technicians.create'); this.validate(req, true);
    if (req.email) { const dup = (await this.repo.query(ctx, { search: req.email })).rows.items.some((r) => (r.email || '').toLowerCase() === req.email!.toLowerCase()); if (dup) throw new ValidationError('Email already used by another technician'); }

    // A technician already employed HERE is not a new hire. Without this the manager gets a second technicians
    // row for one person at one salon — two roster entries, two schedules, split commission.
    if (this.identity?.available) {
      const found: any = await this.identity.lookupForManager(ctx, { phone: req.phone, email: req.email });
      if (found?.found && found.alreadyAtThisSalon) {
        throw new ValidationError(found.relationshipHere === 'open'
          ? `${found.displayName} (${found.techCode}) already has an open invitation or roster record at this salon. Reactivate or approve that record instead of creating a second one.`
          : `${found.displayName} (${found.techCode}) already works at this salon.`);
      }
    }

    if (this.entitlements) await this.entitlements.assertCanCreate(ctx.tenantId, 'technicians');
    const row = await this.repo.create(ctx, req);

    if (!this.identity?.available) {
      // No database (in-memory/dev). The row is created exactly as before — and honestly carries NO global
      // identity fields rather than a fabricated one.
      this.log(ctx, 'pos_technician_created', 'pos_technician', row.technicianId, undefined, row as any);
      return row;
    }

    try {
      const id = await this.identity.attachToTechnician(ctx, row.technicianId, {
        fullName: row.displayName || `${req.firstName} ${req.lastName}`.trim(),
        phone: req.phone ?? null, email: req.email ?? null, roleLabel: 'Technician',
      });
      this.log(ctx, id.linkedExistingProfile ? 'pos_technician_linked_existing_global' : 'pos_technician_created',
        'pos_technician', row.technicianId, undefined, row as any,
        { profileId: id.profileId, techCode: id.techCode, membershipStatus: id.membershipStatus, matchedOn: id.matchedOn });
      return {
        ...row,
        globalTechProfileId: id.profileId,
        globalTechCode: id.techCode,
        linkedExistingProfile: id.linkedExistingProfile,
        membershipStatus: id.membershipStatus,
        // Surfaced to the manager. An invitation the system could not send is not a failure to hide — it is a
        // link somebody has to hand over, and they cannot hand over what they are never shown.
        invite: {
          created: id.invite.created,
          channel: id.invite.channel ?? null,
          deliveryStatus: id.invite.deliveryStatus ?? null,
          acceptUrl: id.invite.acceptUrl ?? null,
          reason: id.invite.reason ?? null,
        },
      };
    } catch (e) {
      // A refused link (a platform-suspended technician) is a real answer for the manager, not a 500. The
      // `technicians` row survives without a global identity — the same state every technician was in before
      // today, and the one `scripts/backfill-global-tech.mjs` repairs.
      if (e instanceof GlobalTechIdentityError) throw new ValidationError(e.message);
      throw e;
    }
  }
  async update(ctx: TechniciansContext, id: string, req: UpdateTechnicianRequest): Promise<POSTechnicianRow> {
    this.need(ctx, 'pos.technicians.edit');
    if (req.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.email)) throw new ValidationError('Email is not valid');
    // Mandate §94: a profile edit NEVER writes commission. The POS drawer sent commissionSplitPercent on every save,
    // and this path wrote default_commission_split_percent/commission_value with only pos.technicians.edit —
    // bypassing the admin-code-gated setCommission. Strip it; the attempt is audited.
    const { commissionSplitPercent, ...safe } = stripCommissionFromUpdate(req);
    if (commissionSplitPercent !== undefined) {
      this.log(ctx, 'pos_technician_commission_edit_stripped', 'pos_technician', id, undefined, undefined, { attempted: commissionSplitPercent, note: 'commission changes only via PATCH /commission with admin code' });
    }
    const before = this.mustFind(await this.repo.detail(ctx, id));
    // The edit drawer's Status field was silently IGNORED (the repo never wrote it). A lifecycle change is an ACCESS
    // change, so it is routed through changeStatus — the ONE path that checks pos.technicians.status_change,
    // revokes/restores access and mirrors into the workforce state. Suspension needs a reason, so it is only offered
    // as its own action (POST /:id/suspend), never via this generic edit.
    const { status: wantedRaw, ...rest } = safe as typeof safe & { status?: string };
    const wanted: string | undefined = wantedRaw as string | undefined;
    const lifecycle = typeof wanted === 'string' && ['active', 'inactive', 'archived'].includes(wanted) ? wanted as TechLifecycleStatus : null;
    let row = (await this.repo.update(ctx, id, rest as any))!;
    if (lifecycle && lifecycle !== (before as any).status) row = await this.changeStatus(ctx, id, lifecycle, 'pos_technician_status_changed_via_edit');
    else if (wanted === 'suspended' && (before as any).status !== 'suspended') throw new ValidationError('Use Suspend (a reason is required) to suspend a technician');
    // §128: a role-label change is employment history
    const repoDb = (this.repo as any).db;
    const roleFrom = (before as any).roleLabel ?? null, roleTo = (rest as any).roleLabel;
    if (repoDb && typeof roleTo === 'string' && roleTo.trim() && roleTo.trim() !== roleFrom) {
      await recordEmploymentEvent(repoDb, { tenantId: ctx.tenantId, technicianId: id, profileId: (before as any).globalTechProfileId ?? null, branchId: (before as any).branchId ?? null,
        type: 'role_changed', from: roleFrom, to: roleTo.trim(), actorUserId: ctx.userId || null, actorRole: ctx.role || null, source: 'pos_technician_edit' });
    }
    this.log(ctx, 'pos_technician_updated', 'pos_technician', id, before as any, row as any); return row;
  }

  // ---- status changes ----
  private async changeStatus(ctx: TechniciansContext, id: string, status: TechLifecycleStatus, action: string, reason?: string): Promise<POSTechnicianRow> {
    this.need(ctx, 'pos.technicians.status_change');
    if (status === 'suspended' && !reason?.trim()) throw new ValidationError('Suspension requires a reason');
    const prior = (await this.repo.detail(ctx, id)) as any;
    const row = this.mustFind(await this.repo.setLifecycle(ctx, id, status));
    // Mandate §63/§137: a lifecycle change is an ACCESS change. Suspend/archive/inactive cut the login, the membership,
    // every live session for this salon and the kiosk Clock PIN through the shared chain; activate / reactivate
    // reinstate the login + membership (sessions and PIN are not resurrected — see restoreTechnicianAccess).
    const repoDb = (this.repo as any).db;
    let revocation: Record<string, unknown> | undefined;
    if (repoDb) {
      const actor = { userId: ctx.userId || null, role: ctx.role || null, branchId: ctx.branchId || null };
      if (status === 'suspended' || status === 'archived' || status === 'inactive') {
        revocation = await revokeTechnicianAccess(repoDb, {
          tenantId: ctx.tenantId, technicianId: id, mode: status === 'suspended' ? 'suspend' : 'terminate',
          reason: reason ?? null, actor, source: 'pos_' + status,
        }) as unknown as Record<string, unknown>;
      } else if (status === 'active') {
        revocation = await restoreTechnicianAccess(repoDb, { tenantId: ctx.tenantId, technicianId: id, actor, source: action }) as unknown as Record<string, unknown>;
      }
      invalidateTechAppAccess(ctx.tenantId);   // the login's app-access cache (keyed by user) — tenant-wide is the safe reset
      // §128 employment history (suspended / terminated / reactivated) — a no-op when the status did not really change
      const evType = lifecycleEventType(prior?.status ?? null, status);
      if (evType) {
        await recordEmploymentEvent(repoDb, { tenantId: ctx.tenantId, technicianId: id, profileId: prior?.globalTechProfileId ?? null, branchId: prior?.branchId ?? null,
          type: evType, from: prior?.status ?? null, to: status, reason: reason ?? null, actorUserId: ctx.userId || null, actorRole: ctx.role || null, source: action });
      }
    }
    // Mirror the lifecycle into the ONE operational state so queue/booking see UNAVAILABLE at once (best-effort:
    // the roster write already landed; a state hiccup must not undo a suspension).
    if (this.workforce) { try { await this.workforce.setEmployment(ctx.tenantId, id, status); } catch { /* re-synced on next touch */ } }
    this.log(ctx, action, 'pos_technician', id, undefined, undefined, { reason, ...(revocation ? { access: revocation } : {}) });
    return row;
  }
  activate(ctx: TechniciansContext, id: string) { return this.changeStatus(ctx, id, 'active', 'pos_technician_activated'); }
  suspend(ctx: TechniciansContext, id: string, body: ChangeTechnicianStatusRequest) { return this.changeStatus(ctx, id, 'suspended', 'pos_technician_suspended', body?.reason); }
  archive(ctx: TechniciansContext, id: string) { return this.changeStatus(ctx, id, 'archived', 'pos_technician_archived'); }
  reactivate(ctx: TechniciansContext, id: string) { return this.changeStatus(ctx, id, 'active', 'pos_technician_reactivated'); }

  // ---- schedule / shift ----
  async getSchedule(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getSchedule(ctx, id)); }
  async setSchedule(ctx: TechniciansContext, id: string, s: TechnicianSchedule) {
    this.need(ctx, 'pos.technicians.schedule.edit');
    const out = this.mustFind(await this.repo.setSchedule(ctx, id, s));   // ScheduleVersionConflict → 409 (controller)
    this.log(ctx, 'pos_technician_schedule_updated', 'pos_technician_schedule', id, undefined, undefined, { version: out.version });
    try { (this.realtime as any)?.toTenant?.({ tenantId: ctx.tenantId, branchId: ctx.branchId }, EVENTS.technicianScheduleUpdated, { technicianId: id, version: out.version }); } catch { /* best-effort */ }
    return out;
  }
  async getShift(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getShift(ctx, id)); }
  /** PATCH /pos/technicians/:id/shifts — the former client-time clock path now goes through TimeClockService (server
   *  time, one open punch, workforce state). The in-memory repository keeps its local behaviour for the no-DB path. */
  async setShift(ctx: TechniciansContext, id: string, s: TechnicianShift) {
    this.need(ctx, 'pos.technicians.schedule.edit');
    if (this.timeClock) {
      const tc = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions || [] };
      try {
        if (s.shiftStatus === 'on_shift') { await this.timeClock.clockIn(tc, id); if (s.onBreak) await this.timeClock.breakStart(tc, id); else { try { await this.timeClock.breakEnd(tc, id); } catch { /* not on break */ } } }
        else await this.timeClock.clockOut(tc, id);
      } catch (e) {
        if (e instanceof TimeClockConflictError) throw new ConflictError(e.message, e.code);
        if (e instanceof TimeClockValidationError) throw new ValidationError(e.message);
        throw e;
      }
      this.log(ctx, 'pos_technician_shift_updated', 'pos_technician_shift', id, undefined, undefined, { via: 'time-clock' });
      return this.mustFind(await this.repo.getShift(ctx, id));
    }
    const out = this.mustFind(await this.repo.setShift(ctx, id, s)); this.log(ctx, 'pos_technician_shift_updated', 'pos_technician_shift', id); return out;
  }

  // ---- skills / services ----
  async getSkills(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getSkills(ctx, id)); }
  async setSkills(ctx: TechniciansContext, id: string, s: TechnicianSkills) { this.need(ctx, 'pos.technicians.skills.edit'); const out = this.mustFind(await this.repo.setSkills(ctx, id, s)); this.log(ctx, 'pos_technician_skills_updated', 'pos_technician_skills', id); return out; }
  async getServices(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getServices(ctx, id)); }
  /** The manager's direct eligibility path. Writes through the ONE eligibility writer (technician-skills.ts — the same
   *  function skill-request approval uses), so there is a single place that decides what an eligibility row looks
   *  like; the in-memory port is only used when no database is bound. Every grant/revoke is audited. */
  async setServices(ctx: TechniciansContext, id: string, s: TechnicianServicesMap) {
    this.need(ctx, 'pos.technicians.skills.edit');
    const serviceIds = Array.isArray(s?.serviceIds) ? s.serviceIds.map(String) : [];
    const db = (this.repo as any).db;
    let out: TechnicianServicesMap;
    if (db) {
      if (!(await this.repo.getServices(ctx, id))) throw new ValidationError('Technician not found');
      let res: { added: string[]; removed: string[]; serviceIds: string[] };
      try { res = await db.transaction().execute((trx: any) => setTechnicianServices(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId: id, serviceIds, grantedByUserId: ctx.userId || null, via: 'manager_patch' })); }
      catch (e: any) { if (e?.message === 'SERVICE_NOT_IN_TENANT') throw new ValidationError('One or more services do not belong to this salon'); throw e; }
      for (const sid of res.added) this.log(ctx, 'pos_technician_eligibility_granted', 'pos_technician_services', id, undefined, { serviceId: sid }, { via: 'manager_patch' });
      for (const sid of res.removed) this.log(ctx, 'pos_technician_eligibility_revoked', 'pos_technician_services', id, { serviceId: sid }, undefined, { via: 'manager_patch' });
      out = { serviceIds: res.serviceIds };
    } else {
      out = this.mustFind(await this.repo.setServices(ctx, id, { serviceIds }));
    }
    this.log(ctx, 'pos_technician_services_updated', 'pos_technician_services', id, undefined, undefined, { count: serviceIds.length });
    return out;
  }

  // ---- commission / payroll ----
  async getCommission(ctx: TechniciansContext, id: string) {
    this.needPay(ctx);
    const base = this.mustFind(await this.repo.getCommission(ctx, id));
    const repoDb = (this.repo as any).db;
    if (!repoDb) return base;
    // the technician's ACTIVE engine rules are what payroll pays (wave 4 PILOT) — the read-back shows exactly those
    const rules = await readTechnicianCommissionRules(repoDb, ctx.tenantId, id);
    return { ...base, defaultPercent: rules.defaultPercent ?? base.defaultPercent, byService: rules.byService, byCategory: rules.byCategory };
  }
  async setCommission(ctx: TechniciansContext, id: string, c: TechnicianCommissionConfig & { adminAuthCode?: string }) {
    this.need(ctx, 'pos.technicians.commission.edit');
    try { validateTechnicianCommissionEdit(c); } catch (e: any) { throw new ValidationError(String(e?.message || 'Commission percent must be 0–100')); }

    const repoDb = (this.repo as any).db;
    const oldComm = await this.repo.getCommission(ctx, id);
    const oldPct = oldComm?.defaultPercent ?? 0;

    let authRes: { authorizedByUserId: string | null; authorizedByName: string | null; codeUsed: string | null } = { authorizedByUserId: ctx.userId || 'system', authorizedByName: ctx.role || 'System', codeUsed: null };
    if (repoDb) {
      authRes = await CommissionSecurityService.verifyAuthorization(repoDb, ctx.tenantId, ctx.role, c.adminAuthCode);
    }

    const out = this.mustFind(await this.repo.setCommission(ctx, id, c));

    if (repoDb) {
      // The edit is a rule of the ONE compensation engine (technician default / technician + service / + category),
      // active from now — what checkout stamps and payroll pays. It used to land only in a column no money path reads
      // (wave 4 PILOT, Oct 13 2026). Authorized once, above, by the Super Admin code.
      await authorTechnicianCommissionRules(repoDb, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId }, id, c);
      await CommissionSecurityService.recordChange(repoDb, {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        technicianId: id,
        targetType: 'technician',
        oldCommissionPercent: oldPct,
        newCommissionPercent: c.defaultPercent ?? c.byService?.[0]?.percent ?? c.byCategory?.[0]?.percent ?? oldPct,
        requestedByUserId: ctx.userId || 'owner',
        requestedByName: hasTenantWideScope(ctx as any) ? 'Salon Owner' : 'Manager',
        requestedByRole: ctx.role || 'OWNER',
        authorizedByUserId: authRes.authorizedByUserId,
        authorizedByName: authRes.authorizedByName,
        authCodeUsed: authRes.codeUsed,
      });
    }

    this.log(ctx, 'pos_technician_commission_updated', 'pos_technician_commission', id, undefined, out as any, { note: 'closed payroll is not recalculated automatically' });
    return out;
  }

  async getSalonCommission(ctx: TechniciansContext) {
    this.needPay(ctx);
    const repoDb = (this.repo as any).db;
    if (repoDb) return { defaultCommissionPercent: (await defaultCommissionForTenant(repoDb, ctx.tenantId)).commissionValue };
    return { defaultCommissionPercent: PLATFORM_FALLBACK_COMMISSION_PERCENT };
  }

  async setSalonCommission(ctx: TechniciansContext, c: { defaultCommissionPercent: number; adminAuthCode?: string }) {
    this.need(ctx, 'pos.technicians.commission.edit');
    if (c.defaultCommissionPercent < 0 || c.defaultCommissionPercent > 100) throw new ValidationError('Commission percent must be 0–100');

    const repoDb = (this.repo as any).db;
    let authRes: { authorizedByUserId: string | null; authorizedByName: string | null; codeUsed: string | null } = { authorizedByUserId: ctx.userId || 'system', authorizedByName: ctx.role || 'System', codeUsed: null };

    if (repoDb) {
      authRes = await CommissionSecurityService.verifyAuthorization(repoDb, ctx.tenantId, ctx.role, c.adminAuthCode);

      const oldPct = (await defaultCommissionForTenant(repoDb, ctx.tenantId)).commissionValue;

      await repoDb.updateTable('tenants').set({ default_commission_percent: c.defaultCommissionPercent }).where('id', '=', ctx.tenantId as any).execute();

      await CommissionSecurityService.recordChange(repoDb, {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        targetType: 'salon_default',
        oldCommissionPercent: oldPct,
        newCommissionPercent: c.defaultCommissionPercent,
        requestedByUserId: ctx.userId || 'owner',
        requestedByName: hasTenantWideScope(ctx as any) ? 'Salon Owner' : 'Manager',
        requestedByRole: ctx.role || 'OWNER',
        authorizedByUserId: authRes.authorizedByUserId,
        authorizedByName: authRes.authorizedByName,
        authCodeUsed: authRes.codeUsed,
      });
    }

    return { ok: true, defaultCommissionPercent: c.defaultCommissionPercent };
  }

  async getCommissionHistory(ctx: TechniciansContext, id: string) {
    this.needPay(ctx);
    const repoDb = (this.repo as any).db;
    if (!repoDb) return [];
    return CommissionSecurityService.getHistory(repoDb, ctx.tenantId, id);
  }
  async payrollSummary(ctx: TechniciansContext, id: string): Promise<TechnicianPayrollSummary> { this.needPay(ctx); return this.mustFind(await this.repo.payrollSummary(ctx, id)); }

  // ---- app access ----
  async getAppAccess(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getAppAccess(ctx, id)); }
  async setAppAccess(ctx: TechniciansContext, id: string, a: TechnicianAppAccess) {
    this.need(ctx, 'pos.technicians.app_access.edit');
    if (a.canProcessPayment && !this.priv(ctx)) throw new ForbiddenError('Only an owner or manager can grant payment processing');
    const out = this.mustFind(await this.repo.setAppAccess(ctx, id, a));
    invalidateTechAppAccess(ctx.tenantId);   // the switch applies at once here; within 30 s on other instances
    // These two statements sat INSIDE the comment above (a line-joining edit in 11fb262): the app-access change was
    // never audited and setAppAccess returned undefined to the controller. The Nest-free harness had been failing on
    // exactly this since then; nothing else ran that path.
    this.log(ctx, 'pos_technician_app_access_updated', 'pos_technician_app_access', id);
    return out;
  }

  // ---- permissions (sanitized; no super-admin escalation) ----
  async getPermissions(ctx: TechniciansContext, id: string) { this.need(ctx, 'pos.technicians.view'); return this.mustFind(await this.repo.getPermissions(ctx, id)); }
  async setPermissions(ctx: TechniciansContext, id: string, input: { matrix: { permission: string; allowed: boolean }[] }) {
    this.need(ctx, 'pos.technicians.permissions.edit');
    const { matrix, rejected } = sanitizeTechPermissions(input?.matrix || []);
    if (rejected.length) throw new ValidationError('Unknown or non-technician permission(s) rejected: ' + rejected.join(', '));
    const enablingSensitive = matrix.some((m) => m.allowed && SENSITIVE_PERMS.includes(m.permission));
    if (enablingSensitive && !this.priv(ctx)) throw new ForbiddenError('Only an owner or manager can grant sensitive permissions');
    const perms: TechnicianPermissions = { matrix };
    const out = this.mustFind(await this.repo.setPermissions(ctx, id, perms)); this.log(ctx, 'pos_technician_permissions_updated', 'pos_technician_permissions', id, undefined, out as any); return out;
  }

  // ---- §128 employment history (this salon's record only; leave merged from approved time off) ----
  async employmentHistory(ctx: TechniciansContext, id: string): Promise<{ technicianId: string; events: EmploymentHistoryRow[] }> {
    this.need(ctx, 'pos.technicians.view');
    this.mustFind(await this.repo.detail(ctx, id));   // tenant isolation: 404 for another salon's technician
    const repoDb = (this.repo as any).db;
    return { technicianId: id, events: repoDb ? await readEmploymentHistory(repoDb, ctx.tenantId, id) : [] };
  }

  // ---- import / export ----
  async export(ctx: TechniciansContext, f: TechnicianFilters = {}): Promise<{ format: 'csv'; filename: string; csv: string }> {
    this.need(ctx, 'pos.technicians.export'); const { headers, rows } = await this.repo.exportRows(ctx, f); const csv = techniciansToCsv(headers, rows);
    this.log(ctx, 'pos_technicians_exported', 'pos_technicians_export', undefined, undefined, undefined, { rows: rows.length, filters: f }); return { format: 'csv', filename: 'pos-technicians.csv', csv };
  }
  /**
   * §112 technician import. `dryRun` (default true) previews each row — create / invite an existing account / already
   * here / invalid — without writing. A commit sends every valid row through create(): the same identity lookup
   * (phone / email only, §113), invitation, employment, branch (the session's branch) and role as a hand-typed
   * hire. Rows are independent: one refused row never undoes another. The run and its per-row outcome are kept
   * (technician_import_runs) so the manager can see exactly what happened.
   */
  async import(ctx: TechniciansContext, body: { csv?: string; dryRun?: boolean } = {}): Promise<{ dryRun: boolean; runId: string | null; total: number; results: ImportRowResult[]; counts: Record<string, number>; error?: string }> {
    this.need(ctx, 'pos.technicians.import');
    this.need(ctx, 'pos.technicians.create');
    const dryRun = body?.dryRun !== false;
    const parsed = parseTechnicianCsv(String(body?.csv ?? ''));
    if (parsed.error) throw new ValidationError(parsed.error);
    const { valid, invalid } = validateImportRows(parsed.rows);
    const results: ImportRowResult[] = invalid.filter((x) => x.line > 0).map((x) => ({ line: x.line, name: '', outcome: 'invalid' as const, message: x.error }));
    for (const c of valid) {
      const name = `${c.firstName} ${c.lastName}`;
      if (dryRun) {
        const found: any = this.identity?.available ? await this.identity.lookupForManager(ctx, { phone: c.phone ?? undefined, email: c.email ?? undefined }) : { found: false };
        results.push({ line: c.line, name, outcome: found?.found ? (found.alreadyAtThisSalon ? 'already_here' : 'will_invite_existing') : 'will_create', techCode: found?.found ? found.techCode : undefined,
          message: found?.found ? (found.alreadyAtThisSalon ? `${found.displayName} already works at (or is invited to) this salon.` : `${found.displayName} already has an AIPowerSalon account — an invitation will be sent; she joins when she accepts.`) : undefined });
        continue;
      }
      try {
        const row: any = await this.create(ctx, { firstName: c.firstName, lastName: c.lastName, phone: c.phone ?? undefined, email: c.email ?? undefined } as CreateTechnicianRequest);
        if (c.roleLabel) { try { await this.update(ctx, row.technicianId, { roleLabel: c.roleLabel }); } catch { /* the hire stands; the role label can be set on the profile */ } }
        results.push({ line: c.line, name, outcome: row.linkedExistingProfile ? 'invited_existing' : 'created', technicianId: row.technicianId, techCode: row.globalTechCode });
      } catch (e: any) {
        results.push({ line: c.line, name, outcome: 'refused', message: String(e?.message ?? 'Could not add this technician.') });
      }
    }
    results.sort((a, b) => a.line - b.line);
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    let runId: string | null = null;
    const repoDb = (this.repo as any).db;
    if (!dryRun && repoDb) {
      const created = (counts.created ?? 0), invited = (counts.invited_existing ?? 0), failed = (counts.refused ?? 0) + (counts.invalid ?? 0);
      const ins: any = await repoDb.insertInto('technician_import_runs').values({
        tenant_id: ctx.tenantId, created_by_user_id: /^[0-9a-f-]{36}$/i.test(ctx.userId || '') ? ctx.userId : null,
        status: failed === 0 ? 'committed' : created + invited > 0 ? 'partial' : 'failed', total_rows: results.length,
        created_count: created, invited_existing_count: invited, failed_count: failed, results: JSON.stringify(results),
      } as any).returning('id').executeTakeFirst().catch(() => null);
      runId = ins?.id ?? null;
    }
    this.log(ctx, dryRun ? 'pos_technicians_import_previewed' : 'pos_technicians_imported', 'pos_technicians_import', runId ?? undefined, undefined, undefined, { total: results.length, counts });
    return { dryRun, runId, total: results.length, results, counts };
  }
}
