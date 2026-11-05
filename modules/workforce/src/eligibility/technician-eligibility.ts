// technician-eligibility.ts — THE ONE eligibility function (workforce audit P0 #7 / P1 #21). Merged Oct 12 2026 from the
// other chat's tech/technician-eligibility.ts into modules/workforce (Constitution 13 layout); ports are WF's workforce-status ones.
//
// Every path that puts a technician on a guest — POS booking create/reschedule/assign, tech-appointments, CUSTOMER
// booking, queue assign, tech-queue reassign, serving assign/helper/start, live-schedule book-slot — calls
// `assertTechnicianEligible`. It checks, in order:
//   1. the technician exists in THIS tenant                      → TECHNICIAN_NOT_FOUND
//   2. employment is active (not suspended/inactive/archived)   → TECHNICIAN_NOT_ACTIVE
//   3. she is employed at the branch (user_branch_access, an active membership, or her roster branch) → TECHNICIAN_BRANCH_ACCESS_DENIED
//   4. she is approved for EVERY requested service — the exact service row in technician_services, never the
//      category                                                   → TECHNICIAN_NOT_SKILLED
//   5. a service that requires a certification: hers is not expired/revoked → TECHNICIAN_NOT_SKILLED
//   6. (when `at` is given) the schedule engine says she is free → TECHNICIAN_NOT_AVAILABLE / SCHEDULE_CONFLICT
//   7. (when `requireAssignable`) the workforce state says assignable; a live service → TECHNICIAN_ALREADY_SERVING
//      (when `requireNotServing` — starting / taking over THIS ticket) only a live service elsewhere refuses
//
// BACKWARD COMPATIBILITY (fix Oct 12 2026, wave-2 regression — see migration 631): a technician who existed before the
// exact-service model with NO service mapping at all is `legacySkillsUnconfigured`; while she still has no mapping the
// skills step (4) is skipped for her — the pre-deploy behaviour of every path that calls this function (the Tech App's
// accept / start and the POS serving start asked no skills question; the assignment paths keep their own category gate).
// Why not grant her every service instead: booking / queue read the same table, so that would WIDEN her eligibility
// there. One with a mapping (her category coverage was materialised as exact rows by 631) and every technician created
// after 631 is exact-service — the mandate's rule; the override never bypasses it.
//
// `actor.overrideConflicts` (a holder of pos.booking.override_conflict → booking.override, resolved by
// @aipowersalon/permissions resolveManagerOverride) may
// bypass ONLY steps 6–7 (schedule / availability). Skills, certification, branch and employment are never bypassed.
import { utcDate } from '@aipowersalon/date-time';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AvailabilityPort, WorkforceStatePort } from '../workforce-status/workforce-ports';

export type EligibilityErrorCode =
  | 'TECHNICIAN_NOT_FOUND' | 'TECHNICIAN_NOT_ACTIVE' | 'TECHNICIAN_BRANCH_ACCESS_DENIED' | 'TECHNICIAN_NOT_SKILLED'
  | 'TECHNICIAN_NOT_AVAILABLE' | 'TECHNICIAN_ALREADY_SERVING' | 'SCHEDULE_CONFLICT';

export class TechnicianEligibilityError extends Error {
  readonly httpStatus: number;
  constructor(public readonly code: EligibilityErrorCode, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message); this.name = 'TechnicianEligibilityError';
    this.httpStatus = code === 'TECHNICIAN_NOT_FOUND' ? 404 : code === 'SCHEDULE_CONFLICT' || code === 'TECHNICIAN_ALREADY_SERVING' ? 409 : code === 'TECHNICIAN_BRANCH_ACCESS_DENIED' ? 403 : 422;
  }
}

export interface EligibilityActor { userId?: string | null; role?: string | null; permissions?: string[]; /** resolved by auth/manager-override.ts — bypasses ONLY schedule/availability */ overrideConflicts?: boolean }
export interface EligibilityInput {
  tenantId: string; branchId: string | null; technicianId: string; serviceIds: string[];
  /** When present the schedule engine is consulted. `at` = { dateIso: 'YYYY-MM-DD', startTime: 'HH:MM' }. */
  at?: { dateIso: string; startTime: string } | null; durationMin?: number | null; ignoreAppointmentId?: string | null;
  /** Ask the workforce state whether she may take ANOTHER guest right now (queue/serving paths). */
  requireAssignable?: boolean;
  /** Starting (or being moved onto, mid-service) THIS ticket: refuse only a live service ELSEWHERE (serving / paused).
   *  Not clocked in (a salon that does not use the time clock), on break (the start ends it — workforce-status-core
   *  serviceStarted) and "already holds this ticket" were never refusals here and are not now. */
  requireNotServing?: boolean;
  actor: EligibilityActor;
}

/** What the function needs to read. The Kysely reader is the production one; tests use the in-memory one. */
export interface TechnicianEligibilityRecord {
  technicianId: string; fullName: string; employment: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'ARCHIVED';
  rosterBranchId: string | null; branchIds: string[]; /** approved service ids (exact) */ approvedServiceIds: string[];
  /** certification name (lower-cased) → status */ certifications: { name: string; status: 'UNVERIFIED' | 'VERIFIED' | 'EXPIRED' | 'REVOKED'; expiresAt: string | null }[];
  /** technicians.service_eligibility_mode = 'legacy_unconfigured' (migration 631): predates the exact-service model
   *  with no mapping. Only honoured while approvedServiceIds is empty. */
  legacySkillsUnconfigured?: boolean;
}
export interface EligibilityReader {
  technician(tenantId: string, technicianId: string): Promise<TechnicianEligibilityRecord | null>;
  /** service id → { name, requiredCertification } for THIS tenant. Unknown ids are absent. */
  services(tenantId: string, serviceIds: string[]): Promise<Record<string, { name: string; requiredCertification: string | null }>>;
}

export interface EligibilityDeps { reader: EligibilityReader; availability?: AvailabilityPort | null; workforce?: WorkforceStatePort | null; now?: () => Date }

export function certificationBlocks(cert: { status: string; expiresAt: string | null } | undefined, now: Date): 'missing' | 'expired' | 'revoked' | null {
  if (!cert) return 'missing';
  if (cert.status === 'REVOKED') return 'revoked';
  if (cert.status === 'EXPIRED') return 'expired';
  if (cert.expiresAt && new Date(cert.expiresAt + (cert.expiresAt.length === 10 ? 'T23:59:59Z' : '')).getTime() < now.getTime()) return 'expired';
  return null;
}

export async function assertTechnicianEligible(deps: EligibilityDeps, input: EligibilityInput): Promise<TechnicianEligibilityRecord> {
  const now = deps.now ? deps.now() : new Date();
  const rec = await deps.reader.technician(input.tenantId, input.technicianId);
  if (!rec) throw new TechnicianEligibilityError('TECHNICIAN_NOT_FOUND', 'Technician not found in this salon.', { technicianId: input.technicianId });
  const name = rec.fullName || 'This technician';
  if (rec.employment !== 'ACTIVE') throw new TechnicianEligibilityError('TECHNICIAN_NOT_ACTIVE', `${name} is not active at this salon (${rec.employment.toLowerCase()}).`, { employment: rec.employment });
  if (input.branchId) {
    const ok = rec.rosterBranchId === input.branchId || rec.branchIds.includes(input.branchId);
    if (!ok) throw new TechnicianEligibilityError('TECHNICIAN_BRANCH_ACCESS_DENIED', `${name} is not assigned to this branch.`, { branchId: input.branchId });
  }
  const serviceIds = [...new Set((input.serviceIds || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (serviceIds.length) {
    const svc = await deps.reader.services(input.tenantId, serviceIds);
    const approved = new Set(rec.approvedServiceIds);
    const legacyUnconfigured = rec.legacySkillsUnconfigured === true && approved.size === 0;
    for (const sid of serviceIds) {
      if (!legacyUnconfigured && !approved.has(sid)) {
        throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', `${name} is not currently approved for this service.`, { serviceId: sid, serviceName: svc[sid]?.name ?? null });
      }
      const req = svc[sid]?.requiredCertification?.trim();
      if (req) {
        const cert = rec.certifications.filter((c) => c.name.toLowerCase() === req.toLowerCase()).sort((a, b) => (b.expiresAt || '9999').localeCompare(a.expiresAt || '9999'))[0];
        const why = certificationBlocks(cert, now);
        if (why) throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', `${name} is not currently approved for this service.`, { serviceId: sid, certification: req, reason: `certification_${why}` });
      }
    }
  }
  const override = input.actor?.overrideConflicts === true;
  if (input.at && deps.availability && !override) {
    const v = await deps.availability.isTechnicianAvailableAt({ tenantId: input.tenantId, branchId: input.branchId, technicianId: input.technicianId, dateIso: input.at.dateIso, startTime: input.at.startTime, durationMin: Math.max(1, Number(input.durationMin || 0) || 30), ignoreAppointmentId: input.ignoreAppointmentId ?? null });
    if (!v.available) {
      if (v.reason === 'CONFLICT') throw new TechnicianEligibilityError('SCHEDULE_CONFLICT', `${name} already has an appointment at that time.`, { conflictingAppointmentId: v.conflictingAppointmentId ?? null });
      throw new TechnicianEligibilityError('TECHNICIAN_NOT_AVAILABLE', `${name} is not available at that time${v.reason ? ` (${String(v.reason).toLowerCase().replace(/_/g, ' ')})` : ''}.`, { reason: v.reason ?? null });
    }
  }
  if (input.requireNotServing && !input.requireAssignable && deps.workforce && !override) {
    const a = await deps.workforce.isAssignable(input.tenantId, input.technicianId);
    if (!a.assignable && a.snapshot && a.snapshot.service !== 'IDLE') throw new TechnicianEligibilityError('TECHNICIAN_ALREADY_SERVING', `${name} is already serving another guest.`, { reason: a.reason ?? null });
  }
  if (input.requireAssignable && deps.workforce && !override) {
    const a = await deps.workforce.isAssignable(input.tenantId, input.technicianId);
    if (!a.assignable) {
      if (a.snapshot && a.snapshot.service !== 'IDLE') throw new TechnicianEligibilityError('TECHNICIAN_ALREADY_SERVING', `${name} is already serving another guest.`, { reason: a.reason ?? null });
      throw new TechnicianEligibilityError('TECHNICIAN_NOT_AVAILABLE', `${name} is not available right now${a.reason ? ` (${a.reason.toLowerCase().replace(/_/g, ' ')})` : ''}.`, { reason: a.reason ?? null });
    }
  }
  return rec;
}

// ───────────────────────────── production reader (Kysely) ─────────────────────────────
export class KyselyEligibilityReader implements EligibilityReader {
  constructor(private readonly db: Kysely<DB>) {}
  async technician(tenantId: string, technicianId: string): Promise<TechnicianEligibilityRecord | null> {
    const t: any = await this.db.selectFrom('technicians').select(['id', 'full_name', 'status', 'is_active', 'archived_at', 'branch_id', 'user_id', 'global_tech_profile_id'])
      .where('tenant_id', '=', tenantId).where('id', '=', technicianId).executeTakeFirst().catch(() => undefined);
    if (!t) return null;
    const employment: TechnicianEligibilityRecord['employment'] = t.archived_at || t.status === 'archived' ? 'ARCHIVED' : t.status === 'suspended' ? 'SUSPENDED' : t.is_active === false || t.status === 'inactive' || t.status === 'terminated' ? 'INACTIVE' : 'ACTIVE';
    const branchIds = new Set<string>();
    if (t.user_id) {
      const ub: any[] = await this.db.selectFrom('user_branch_access').select(['branch_id']).where('tenant_id', '=', tenantId).where('user_id', '=', t.user_id).execute().catch(() => []);
      for (const r of ub) if (r.branch_id) branchIds.add(String(r.branch_id));
    }
    const mem: any[] = await this.db.selectFrom('tech_salon_memberships').select(['branch_id']).where('tenant_id', '=', tenantId).where('status', '=', 'active')
      .where((eb: any) => eb.or([eb('technician_id', '=', technicianId), ...(t.global_tech_profile_id ? [eb('global_tech_profile_id', '=', t.global_tech_profile_id)] : [])])).execute().catch(() => []);
    for (const r of mem) if (r.branch_id) branchIds.add(String(r.branch_id));
    // Read on its own so a database that has not run 631 yet (the column is missing) degrades to the pre-deploy rule
    // for an unmapped technician instead of failing the whole read (which would refuse her as TECHNICIAN_NOT_FOUND).
    const mode: any = await this.db.selectFrom('technicians').select(['service_eligibility_mode']).where('tenant_id', '=', tenantId).where('id', '=', technicianId)
      .executeTakeFirst().catch(() => ({ service_eligibility_mode: 'legacy_unconfigured' }));
    const svcs: any[] = await this.db.selectFrom('technician_services').select(['service_id']).where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).execute().catch(() => []);
    let certQ = this.db.selectFrom('technician_certifications').select(['name', 'verification_status', 'expires_at']);
    certQ = t.global_tech_profile_id
      ? certQ.where((eb: any) => eb.or([eb('global_tech_profile_id', '=', t.global_tech_profile_id), eb('technician_id', '=', technicianId)]))
      : certQ.where('technician_id', '=', technicianId);
    const certs: any[] = await certQ.execute().catch(() => []);
    return {
      technicianId: String(t.id), fullName: String(t.full_name || ''), employment, rosterBranchId: t.branch_id ? String(t.branch_id) : null, branchIds: [...branchIds],
      approvedServiceIds: svcs.map((r) => String(r.service_id)), legacySkillsUnconfigured: mode?.service_eligibility_mode === 'legacy_unconfigured',
      certifications: certs.map((c) => ({ name: String(c.name || ''), status: String(c.verification_status || 'UNVERIFIED') as any, expiresAt: c.expires_at ? (c.expires_at instanceof Date ? utcDate(c.expires_at) : String(c.expires_at).slice(0, 10)) : null })),
    };
  }
  async services(tenantId: string, serviceIds: string[]): Promise<Record<string, { name: string; requiredCertification: string | null }>> {
    if (!serviceIds.length) return {};
    const rows: any[] = await this.db.selectFrom('services').select(['id', 'name', 'required_certification']).where('tenant_id', '=', tenantId).where('id', 'in', serviceIds).execute().catch(() => []);
    const out: Record<string, { name: string; requiredCertification: string | null }> = {};
    for (const r of rows) out[String(r.id)] = { name: String(r.name || ''), requiredCertification: r.required_certification ?? null };
    return out;
  }
}

// ───────────────────────────── in-memory reader (unit tests) ─────────────────────────────
export class InMemoryEligibilityReader implements EligibilityReader {
  constructor(public techs: Record<string, TechnicianEligibilityRecord> = {}, public svcs: Record<string, { name: string; requiredCertification: string | null }> = {}) {}
  async technician(_t: string, id: string) { return this.techs[id] ?? null; }
  async services(_t: string, ids: string[]) { const o: any = {}; for (const i of ids) if (this.svcs[i]) o[i] = this.svcs[i]; return o; }
}

/** Injectable wrapper: one instance per module binding, carrying the reader + the two ports. */
export class TechnicianEligibilityService {
  constructor(private readonly deps: EligibilityDeps) {}
  assert(input: EligibilityInput): Promise<TechnicianEligibilityRecord> { return assertTechnicianEligible(this.deps, input); }
  get workforce(): WorkforceStatePort | null | undefined { return this.deps.workforce; }
  get availability(): AvailabilityPort | null | undefined { return this.deps.availability; }
}
