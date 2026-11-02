// technician-skills.port.ts — mandate §51 / §78 (Oct 20 2026): ONE eligibility check on every booking path.
//
// The queue, serving and tech paths ask `TechnicianEligibilityService` (modules/workforce) whether a technician is
// approved for the EXACT service (+ certification, employment, branch). Booking could not import it — workforce already
// depends on booking (Constitution 13 §94: no cycles) — so booking checked only the service CATEGORY, and the customer
// app checked nothing: a customer could book any technician for any service.
//
// This is booking's narrow port for that same authority. The workforce eligibility module (global) provides it
// (TECHNICIAN_SKILLS_PORT → an adapter over TechnicianEligibilityService); booking's services take it optionally and
// fall back to the category rule ONLY when it is absent (no database / unit tests) — in production it is always bound.
// Skills and certification are never overridable (R2); the schedule check stays with booking's own engine.
export const TECHNICIAN_SKILLS_PORT = 'TechnicianSkillsPort';

/**
 * Remaining Production §23 (Oct 28 2026 audit): "one authority" enforced at boot. The exact-service authority is optional in a
 * module's wiring only so a database-less dev / unit-test module still boots on the in-memory category rule. With a database
 * it must be bound — a missing global TechnicianEligibilityModule would otherwise leave the module silently on the lenient
 * category rule in production. QueueModule refused already; booking, customer booking, check-in, Go check-in and the Tech
 * Queue now refuse the same way (fail closed). Re-exported by @aipowersalon/workforce for the queue modules.
 */
export function assertEligibilityAuthorityBound(moduleName: string, databaseBound: boolean, authority: unknown): void {
  if (databaseBound && !authority) throw new Error(`${moduleName}: the technician eligibility authority (TechnicianEligibilityModule) must be bound when a database is configured.`);
}

export interface TechnicianSkillsInput {
  tenantId: string; branchId: string | null; technicianId: string; serviceIds: string[];
  actor?: { userId?: string | null; role?: string | null; permissions?: string[] };
}

export class TechnicianNotSkilledError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'TechnicianNotSkilledError'; }
}

export interface TechnicianSkillsPort {
  /** Throws TechnicianNotSkilledError (code = the eligibility code: TECHNICIAN_NOT_SKILLED, TECHNICIAN_NOT_ACTIVE,
   *  TECHNICIAN_BRANCH_ACCESS_DENIED, TECHNICIAN_NOT_FOUND) when the technician may not do every requested service. */
  assertSkilled(input: TechnicianSkillsInput): Promise<void>;
  /** The same check as a boolean (first-available loops, availability lists). */
  isSkilled(input: TechnicianSkillsInput): Promise<boolean>;
  /** 200-technician mandate §14/§26 (Oct 23 2026): the same rule for MANY technicians in one batch read — the ids that may
   *  do every requested service. Optional: without it the service falls back to isSkilled() per technician. */
  skilledAmong?(input: Omit<TechnicianSkillsInput, 'technicianId'> & { technicianIds: string[] }): Promise<Set<string>>;
}

/** Test double: a fixed map technicianId → approved service ids (unknown technician → not skilled). */
export class InMemoryTechnicianSkills implements TechnicianSkillsPort {
  constructor(public approved: Record<string, string[]> = {}) {}
  async isSkilled(i: TechnicianSkillsInput): Promise<boolean> { const ok = new Set(this.approved[i.technicianId] ?? []); return i.serviceIds.every((s) => ok.has(s)); }
  batchCalls = 0;
  async skilledAmong(i: Omit<TechnicianSkillsInput, 'technicianId'> & { technicianIds: string[] }): Promise<Set<string>> {
    this.batchCalls++; const out = new Set<string>();
    for (const id of i.technicianIds) if (await this.isSkilled({ ...i, technicianId: id })) out.add(id);
    return out;
  }
  async assertSkilled(i: TechnicianSkillsInput): Promise<void> {
    if (!(i.technicianId in this.approved)) throw new TechnicianNotSkilledError('TECHNICIAN_NOT_FOUND', 'Technician not found in this salon.');
    if (!(await this.isSkilled(i))) throw new TechnicianNotSkilledError('TECHNICIAN_NOT_SKILLED', 'This technician is not currently approved for this service.', { serviceIds: i.serviceIds });
  }
}
