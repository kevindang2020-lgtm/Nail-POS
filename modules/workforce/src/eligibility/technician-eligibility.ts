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
// TECHNICIANS WITH NO SERVICES SET UP (§24 — Kevin's decision, Oct 27 2026, reverses the fail-closed rule of 3fa531bc):
// a technician with NO configured service (approvedServiceIds empty — a pre-631 'legacy_unconfigured' one included) is
// still bookable through the CATEGORY FALLBACK: she may take any requested service that belongs to one of the salon's
// service categories (an add-on rides on a main service as for everyone, D2); a service with no category has nothing to
// fall back on and is refused. The verdict says so — basis 'category_fallback_unconfigured' — so a screen can show
// "services not set up". The fallback is ONLY for her: the moment a manager sets one service (technician-skills.ts flips
// her to 'exact') she is strictly exact-skill, and a technician WITH configured services missing the exact one is refused
// (TECHNICIAN_NOT_SKILLED). Certification, employment, branch, schedule and live-service checks apply to both.
// serviceSkillVerdict() below is the one skill rule: this function, eligibleAmong and the AI scheduling day read share it.
//
// `actor.overrideConflicts` (a holder of pos.booking.override_conflict → booking.override, resolved by
// @aipowersalon/permissions resolveManagerOverride) may
// bypass ONLY steps 6–7 (schedule / availability). Skills, certification, branch and employment are never bypassed.
import { utcDate } from '@aipowersalon/date-time';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
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
   *  with no mapping. Informational: the category fallback applies to EVERY technician with no configured service. */
  legacySkillsUnconfigured?: boolean;
  /** set on the record assert() returns: how the skills step was satisfied (absent when no service was asked) */
  eligibilityBasis?: EligibilityBasis;
}
/** how the skills step was satisfied: the exact approved rows, or the category fallback of a technician with none (§24) */
export type EligibilityBasis = 'exact' | 'category_fallback_unconfigured';
export interface SkillServiceInfo { isAddOn?: boolean; categoryName?: string | null }
/**
 * THE skill rule (§24 + D2), pure — the eligibility function, its batch form and the AI scheduling day read all call it.
 * Returns the first service she may not take (null = all allowed) and the basis.
 *   - configured (≥ 1 approved service): exact — every main service must be approved; an add-on is covered by a main in the
 *     same request, an add-on alone must be approved itself.
 *   - unconfigured (none approved): the category fallback — a main service (or an add-on alone) in one of the salon's
 *     categories is allowed; a service with no category is not.
 */
export function serviceSkillVerdict(approvedServiceIds: readonly string[], svc: Record<string, SkillServiceInfo | undefined>, serviceIds: readonly string[]): { missing: string | null; basis: EligibilityBasis; allowed: Record<string, boolean> } {
  const approved = new Set(approvedServiceIds);
  const basis: EligibilityBasis = approved.size === 0 ? 'category_fallback_unconfigured' : 'exact';
  const addOnsCoveredByMain = serviceIds.some((sid) => svc[sid]?.isAddOn !== true);
  const allowed: Record<string, boolean> = {};
  let missing: string | null = null;
  for (const sid of serviceIds) {
    const ok = (svc[sid]?.isAddOn === true && addOnsCoveredByMain) || (basis === 'exact' ? approved.has(sid) : !!String(svc[sid]?.categoryName ?? '').trim());
    allowed[sid] = ok;
    if (!ok && missing === null) missing = sid;
  }
  return { missing, basis, allowed };
}
export interface EligibilityReader {
  technician(tenantId: string, technicianId: string): Promise<TechnicianEligibilityRecord | null>;
  /** M2 (Oct 23 2026, 200-technician scale): the same records for MANY technicians in a fixed number of queries. Optional —
   *  without it the batch falls back to one technician() read each. */
  technicians?(tenantId: string, technicianIds: string[]): Promise<Map<string, TechnicianEligibilityRecord>>;
  /** service id → { name, requiredCertification, isAddOn } for THIS tenant. Unknown ids are absent. `isAddOn`: the service
   *  sits in the salon's "Add-ons" category (D1: the category IS the add-on model; isAddOnCategory is the one rule). */
  services(tenantId: string, serviceIds: string[]): Promise<Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }>>;
}

export interface EligibilityDeps { reader: EligibilityReader; availability?: AvailabilityPort | null; workforce?: WorkforceStatePort | null; now?: () => Date }

export function certificationBlocks(cert: { status: string; expiresAt: string | null } | undefined, now: Date): 'missing' | 'expired' | 'revoked' | null {
  if (!cert) return 'missing';
  if (cert.status === 'REVOKED') return 'revoked';
  if (cert.status === 'EXPIRED') return 'expired';
  if (cert.expiresAt && new Date(cert.expiresAt + (cert.expiresAt.length === 10 ? 'T23:59:59Z' : '')).getTime() < now.getTime()) return 'expired';
  return null;
}

/** Steps 1-5 of the rule (existence, employment, branch, exact service + add-on cover, certification) for ONE technician,
 *  given the records already read. Pure: assertTechnicianEligible and the batch eligibleAmong share it, so the two can
 *  never disagree. Returns the refusal (never throws). */
export function staticEligibilityError(rec: TechnicianEligibilityRecord | null, svc: Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }>, input: { technicianId: string; branchId: string | null; serviceIds: string[] }, now: Date): TechnicianEligibilityError | null {
  try { staticEligibilityAssert(rec, svc, input, now); return null; }
  catch (e) { if (e instanceof TechnicianEligibilityError) return e; throw e; }
}
function staticEligibilityAssert(rec: TechnicianEligibilityRecord | null, svc: Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }>, input: { technicianId: string; branchId: string | null; serviceIds: string[] }, now: Date): asserts rec is TechnicianEligibilityRecord {
  if (!rec) throw new TechnicianEligibilityError('TECHNICIAN_NOT_FOUND', 'Technician not found in this salon.', { technicianId: input.technicianId });
  const name = rec.fullName || 'This technician';
  if (rec.employment !== 'ACTIVE') throw new TechnicianEligibilityError('TECHNICIAN_NOT_ACTIVE', `${name} is not active at this salon (${rec.employment.toLowerCase()}).`, { employment: rec.employment });
  if (input.branchId) {
    const ok = rec.rosterBranchId === input.branchId || rec.branchIds.includes(input.branchId);
    if (!ok) throw new TechnicianEligibilityError('TECHNICIAN_BRANCH_ACCESS_DENIED', `${name} is not assigned to this branch.`, { branchId: input.branchId });
  }
  const serviceIds = [...new Set((input.serviceIds || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (serviceIds.length) {
    // §24 (Kevin, Oct 27 2026) + D2: the one skill rule — exact for a configured technician, the category fallback for one
    // with no configured service (the refusal / the verdict name the basis so a screen can say "services not set up")
    const v = serviceSkillVerdict(rec.approvedServiceIds, svc, serviceIds);
    if (v.missing) {
      const sid = v.missing;
      if (v.basis === 'category_fallback_unconfigured') throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', `${name} is not currently approved for this service.`, { serviceId: sid, serviceName: svc[sid]?.name ?? null, reason: 'skills_not_configured', basis: v.basis, legacy: rec.legacySkillsUnconfigured === true });
      throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', `${name} is not currently approved for this service.`, { serviceId: sid, serviceName: svc[sid]?.name ?? null, basis: v.basis });
    }
    for (const sid of serviceIds) {
      const req = svc[sid]?.requiredCertification?.trim();
      if (req) {
        const cert = rec.certifications.filter((c) => c.name.toLowerCase() === req.toLowerCase()).sort((a, b) => (b.expiresAt || '9999').localeCompare(a.expiresAt || '9999'))[0];
        const why = certificationBlocks(cert, now);
        if (why) throw new TechnicianEligibilityError('TECHNICIAN_NOT_SKILLED', `${name} is not currently approved for this service.`, { serviceId: sid, certification: req, reason: `certification_${why}` });
      }
    }
  }
}

export async function assertTechnicianEligible(deps: EligibilityDeps, input: EligibilityInput): Promise<TechnicianEligibilityRecord> {
  const now = deps.now ? deps.now() : new Date();
  const rec = await deps.reader.technician(input.tenantId, input.technicianId);
  const serviceIdsForRead = [...new Set((input.serviceIds || []).map((s) => String(s || '').trim()).filter(Boolean))];
  const svc = rec && serviceIdsForRead.length ? await deps.reader.services(input.tenantId, serviceIdsForRead) : {};
  staticEligibilityAssert(rec, svc, input, now);
  const name = rec.fullName || 'This technician';
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
  // §24: how the skills step was met — 'category_fallback_unconfigured' lets a screen say "services not set up"
  return serviceIdsForRead.length ? { ...rec, eligibilityBasis: serviceSkillVerdict(rec.approvedServiceIds, svc, serviceIdsForRead).basis } : rec;
}

// ───────────────────────────── production reader (Kysely) ─────────────────────────────
type BatchRow = Record<string, any>;
export class KyselyEligibilityReader implements EligibilityReader {
  constructor(private readonly db: Kysely<DB>) {}
  // check:silent-catch (Oct 21 2026): these reads DECIDE whether a technician may be booked. A database error used to
  // read as "not found" / "no skills" — a refusal with the wrong reason. It is the caller's error now (fails closed, honestly).
  async technician(tenantId: string, technicianId: string): Promise<TechnicianEligibilityRecord | null> {
    const t: any = await this.db.selectFrom('technicians').select(['id', 'full_name', 'status', 'is_active', 'archived_at', 'branch_id', 'user_id', 'global_tech_profile_id'])
      .where('tenant_id', '=', tenantId).where('id', '=', technicianId).executeTakeFirst();
    if (!t) return null;
    const employment: TechnicianEligibilityRecord['employment'] = t.archived_at || t.status === 'archived' ? 'ARCHIVED' : t.status === 'suspended' ? 'SUSPENDED' : t.is_active === false || t.status === 'inactive' || t.status === 'terminated' ? 'INACTIVE' : 'ACTIVE';
    const branchIds = new Set<string>();
    if (t.user_id) {
      const ub: any[] = await this.db.selectFrom('user_branch_access').select(['branch_id']).where('tenant_id', '=', tenantId).where('user_id', '=', t.user_id).execute();
      for (const r of ub) if (r.branch_id) branchIds.add(String(r.branch_id));
    }
    const mem: any[] = await this.db.selectFrom('tech_salon_memberships').select(['branch_id']).where('tenant_id', '=', tenantId).where('status', '=', 'active')
      .where((eb: any) => eb.or([eb('technician_id', '=', technicianId), ...(t.global_tech_profile_id ? [eb('global_tech_profile_id', '=', t.global_tech_profile_id)] : [])])).execute();
    for (const r of mem) if (r.branch_id) branchIds.add(String(r.branch_id));
    // Read on its own so a database that has not run 631 yet (the column is missing) degrades to the pre-deploy rule
    // for an unmapped technician instead of failing the whole read (which would refuse her as TECHNICIAN_NOT_FOUND).
    const mode: any = await this.db.selectFrom('technicians').select(['service_eligibility_mode']).where('tenant_id', '=', tenantId).where('id', '=', technicianId)
      .executeTakeFirst().catch(() => ({ service_eligibility_mode: 'legacy_unconfigured' }));
    const svcs: any[] = await this.db.selectFrom('technician_services').select(['service_id']).where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).execute();
    let certQ = this.db.selectFrom('technician_certifications').select(['name', 'verification_status', 'expires_at']);
    certQ = t.global_tech_profile_id
      ? certQ.where((eb: any) => eb.or([eb('global_tech_profile_id', '=', t.global_tech_profile_id), eb('technician_id', '=', technicianId)]))
      : certQ.where('technician_id', '=', technicianId);
    const certs: any[] = await certQ.execute();
    return {
      technicianId: String(t.id), fullName: String(t.full_name || ''), employment, rosterBranchId: t.branch_id ? String(t.branch_id) : null, branchIds: [...branchIds],
      approvedServiceIds: svcs.map((r) => String(r.service_id)), legacySkillsUnconfigured: mode?.service_eligibility_mode === 'legacy_unconfigured',
      certifications: certs.map((c) => ({ name: String(c.name || ''), status: String(c.verification_status || 'UNVERIFIED') as any, expiresAt: c.expires_at ? (c.expires_at instanceof Date ? utcDate(c.expires_at) : String(c.expires_at).slice(0, 10)) : null })),
    };
  }
  // (row shape of the batch reads — the eb-callback queries are untyped)
  /** The same record as technician(), for many at once: 6 queries whatever the count (was 6 per technician). */
  async technicians(tenantId: string, technicianIds: string[]): Promise<Map<string, TechnicianEligibilityRecord>> {
    const out = new Map<string, TechnicianEligibilityRecord>();
    if (!technicianIds.length) return out;
    const ts: any[] = await this.db.selectFrom('technicians').select(['id', 'full_name', 'status', 'is_active', 'archived_at', 'branch_id', 'user_id', 'global_tech_profile_id', 'service_eligibility_mode'])
      .where('tenant_id', '=', tenantId).where('id', 'in', technicianIds).execute();
    if (!ts.length) return out;
    const userIds = ts.map((t) => t.user_id).filter(Boolean);
    const gtps = ts.map((t) => t.global_tech_profile_id).filter(Boolean);
    const ids = ts.map((t) => String(t.id));
    const [ub, mem, svcs, certs] = await Promise.all([
      userIds.length ? this.db.selectFrom('user_branch_access').select(['user_id', 'branch_id']).where('tenant_id', '=', tenantId).where('user_id', 'in', userIds).execute() : Promise.resolve([] as { user_id: string | null; branch_id: string | null }[]),
      this.db.selectFrom('tech_salon_memberships').select(['technician_id', 'global_tech_profile_id', 'branch_id']).where('tenant_id', '=', tenantId).where('status', '=', 'active')
        .where((eb: any) => eb.or([eb('technician_id', 'in', ids), ...(gtps.length ? [eb('global_tech_profile_id', 'in', gtps)] : [])])).execute(),
      this.db.selectFrom('technician_services').select(['technician_id', 'service_id']).where('tenant_id', '=', tenantId).where('technician_id', 'in', ids).execute(),
      this.db.selectFrom('technician_certifications').select(['technician_id', 'global_tech_profile_id', 'name', 'verification_status', 'expires_at'])
        .where((eb: any) => eb.or([eb('technician_id', 'in', ids), ...(gtps.length ? [eb('global_tech_profile_id', 'in', gtps)] : [])])).execute(),
    ]);
    for (const t of ts) {
      const id = String(t.id);
      const employment: TechnicianEligibilityRecord['employment'] = t.archived_at || t.status === 'archived' ? 'ARCHIVED' : t.status === 'suspended' ? 'SUSPENDED' : t.is_active === false || t.status === 'inactive' || t.status === 'terminated' ? 'INACTIVE' : 'ACTIVE';
      const branchIds = new Set<string>();
      for (const r of ub) if (t.user_id && r.user_id === t.user_id && r.branch_id) branchIds.add(String(r.branch_id));
      for (const r of mem as BatchRow[]) if (r.branch_id && (String(r.technician_id) === id || (t.global_tech_profile_id && r.global_tech_profile_id === t.global_tech_profile_id))) branchIds.add(String(r.branch_id));
      out.set(id, {
        technicianId: id, fullName: String(t.full_name || ''), employment, rosterBranchId: t.branch_id ? String(t.branch_id) : null, branchIds: [...branchIds],
        approvedServiceIds: (svcs as BatchRow[]).filter((r) => String(r.technician_id) === id).map((r) => String(r.service_id)),
        legacySkillsUnconfigured: t.service_eligibility_mode === 'legacy_unconfigured',
        certifications: (certs as BatchRow[]).filter((c) => String(c.technician_id) === id || (t.global_tech_profile_id && c.global_tech_profile_id === t.global_tech_profile_id))
          .map((c) => ({ name: String(c.name || ''), status: String(c.verification_status || 'UNVERIFIED') as TechnicianEligibilityRecord['certifications'][number]['status'], expiresAt: c.expires_at ? (c.expires_at instanceof Date ? utcDate(c.expires_at) : String(c.expires_at).slice(0, 10)) : null })),
      });
    }
    return out;
  }
  async services(tenantId: string, serviceIds: string[]): Promise<Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }>> {
    if (!serviceIds.length) return {};
    const rows: any[] = await this.db.selectFrom('services as s').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .select(['s.id', 's.name', 's.required_certification', 'c.name as category_name']).where('s.tenant_id', '=', tenantId).where('s.id', 'in', serviceIds).execute();
    const out: Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }> = {};
    for (const r of rows) out[String(r.id)] = { name: String(r.name || ''), requiredCertification: r.required_certification ?? null, isAddOn: isAddOnCategory(r.category_name), categoryName: r.category_name ? String(r.category_name) : null };
    return out;
  }
}

// ───────────────────────────── in-memory reader (unit tests) ─────────────────────────────
export class InMemoryEligibilityReader implements EligibilityReader {
  constructor(public techs: Record<string, TechnicianEligibilityRecord> = {}, public svcs: Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }> = {}) {}
  async technician(_t: string, id: string) { return this.techs[id] ?? null; }
  async technicians(_t: string, ids: string[]) { const m = new Map<string, TechnicianEligibilityRecord>(); for (const id of ids) if (this.techs[id]) m.set(id, this.techs[id]); return m; }
  async services(_t: string, ids: string[]) { const o: any = {}; for (const i of ids) if (this.svcs[i]) o[i] = this.svcs[i]; return o; }
}

/** `basis` (§24): 'category_fallback_unconfigured' = eligible / refused under the fallback of a technician with no services set up */
export interface EligibilityVerdict {
  eligible: boolean; code?: EligibilityErrorCode; message?: string; basis?: EligibilityBasis;
  /** Oct 28 2026 (multi-technician plan lines): of the services asked, the ones THIS technician may do on her own line of the
   *  visit — the same skill rule (an add-on rides on the visit's main service) and the same steps 1-5 per service. Read in the
   *  same batch, so a plan never needs a second authority call. */
  allowedServiceIds?: string[];
}
/** Batch form of steps 1-5 (no schedule / workforce state): one services read, one batch technician read. */
export async function eligibleAmong(deps: EligibilityDeps, input: { tenantId: string; branchId: string | null; technicianIds: string[]; serviceIds: string[] }): Promise<Map<string, EligibilityVerdict>> {
  const now = deps.now ? deps.now() : new Date();
  const ids = [...new Set(input.technicianIds.filter(Boolean))];
  const serviceIds = [...new Set((input.serviceIds || []).map((s) => String(s || '').trim()).filter(Boolean))];
  const out = new Map<string, EligibilityVerdict>();
  if (!ids.length) return out;
  const [svc, recs] = await Promise.all([
    serviceIds.length ? deps.reader.services(input.tenantId, serviceIds) : Promise.resolve({}),
    deps.reader.technicians ? deps.reader.technicians(input.tenantId, ids) : (async () => { const m = new Map<string, TechnicianEligibilityRecord>(); for (const id of ids) { const r = await deps.reader.technician(input.tenantId, id); if (r) m.set(id, r); } return m; })(),
  ]);
  for (const id of ids) {
    const rec = recs.get(id) ?? null;
    const err = staticEligibilityError(rec, svc, { technicianId: id, branchId: input.branchId, serviceIds }, now);
    const basis = rec && serviceIds.length ? serviceSkillVerdict(rec.approvedServiceIds, svc, serviceIds).basis : undefined;
    out.set(id, err ? { eligible: false, code: err.code, message: err.message, ...(basis ? { basis } : {}) } : { eligible: true, ...(basis ? { basis } : {}) });
    if (serviceIds.length) out.get(id)!.allowedServiceIds = allowedPerService(rec, svc, id, input.branchId, serviceIds, now);
  }
  return out;
}

/** Per service: the skill answer comes from the visit-wide rule (so an add-on is covered by the visit's main service);
 *  every other step (found, active, branch, certification) is checked for that one service with the skill forced to pass. */
function allowedPerService(rec: TechnicianEligibilityRecord | null, svc: Record<string, { name: string; requiredCertification: string | null; isAddOn?: boolean; categoryName?: string | null }>, technicianId: string, branchId: string | null, serviceIds: string[], now: Date): string[] {
  if (!rec) return [];
  const skill = serviceSkillVerdict(rec.approvedServiceIds, svc, serviceIds).allowed;
  return serviceIds.filter((sid) => skill[sid] && !staticEligibilityError({ ...rec, approvedServiceIds: [sid] }, svc, { technicianId, branchId, serviceIds: [sid] }, now));
}

/** Injectable wrapper: one instance per module binding, carrying the reader + the two ports. */
export class TechnicianEligibilityService {
  constructor(private readonly deps: EligibilityDeps) {}
  assert(input: EligibilityInput): Promise<TechnicianEligibilityRecord> { return assertTechnicianEligible(this.deps, input); }
  /** Steps 1-5 for many technicians at once (who MAY do these services here) — the suggestion lists (queue alternates,
   *  kiosk choices, Find an Opening) read this; the write paths keep calling assert(). */
  eligibleAmong(input: { tenantId: string; branchId: string | null; technicianIds: string[]; serviceIds: string[] }): Promise<Map<string, EligibilityVerdict>> { return eligibleAmong(this.deps, input); }
  get workforce(): WorkforceStatePort | null | undefined { return this.deps.workforce; }
  get availability(): AvailabilityPort | null | undefined { return this.deps.availability; }
}
