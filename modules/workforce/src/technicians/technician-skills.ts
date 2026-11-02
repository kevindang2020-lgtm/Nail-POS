// technician-skills.ts — the ONE writer of technician_services (service eligibility). Merged Oct 12 2026 from the
// Technician Profile package (their tech/technician-skills.ts); lives in the workforce module because eligibility is
// workforce data. The tech-app skill-request approval (modules/queue/src/tech — AUTH merge) imports it from here.
//
// Two paths used to write eligibility independently: skill-request approval (tech app, manager decision) and the
// manager's direct `PATCH /pos/technicians/:id/services`. Both now go through `grantEligibility` /
// `revokeEligibility` / `setTechnicianServices` below, inside the caller's transaction, idempotently
// (INSERT … ON CONFLICT (tenant_id, technician_id, service_id) DO NOTHING — the unique index from migration 583).
// Proficiency and the certificate document key ride along with the grant so the eligibility row records WHAT was
// approved and ON WHAT evidence. Audit rows are written by the callers (they know their actor + audit sink).
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';

export type Proficiency = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
export const PROFICIENCIES: readonly Proficiency[] = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

/** Normalise the free-text proficiency a request carried ('advanced', 'Expert', 'intermediate') to the vocabulary. */
export function normalizeProficiency(v: unknown): Proficiency | null {
  const s = String(v ?? '').trim().toUpperCase();
  return (PROFICIENCIES as readonly string[]).includes(s) ? (s as Proficiency) : null;
}

type Db = Kysely<DB> | Transaction<DB>;

export interface GrantInput {
  tenantId: string; branchId: string | null; technicianId: string; serviceId: string;
  proficiency?: Proficiency | null; certificateDocumentKey?: string | null; grantedByUserId?: string | null;
  /** 'skill_request' | 'manager_patch' | 'seed' … */ via: string;
}

/** Idempotent grant. Returns inserted=false when the row already existed (nothing is overwritten — a later
 *  grant never DOWNGRADES a recorded proficiency; use updateProficiency for that). */
export async function grantEligibility(db: Db, g: GrantInput): Promise<{ inserted: boolean }> {
  const svc: any = await db.selectFrom('services').select(['id', 'branch_id']).where('tenant_id', '=', g.tenantId).where('id', '=', g.serviceId).executeTakeFirst();
  if (!svc) throw new Error('SERVICE_NOT_FOUND');
  const tech: any = await db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', g.tenantId).where('id', '=', g.technicianId).executeTakeFirst();
  if (!tech) throw new Error('TECHNICIAN_NOT_FOUND');
  const branchId = g.branchId || tech.branch_id || svc.branch_id;
  const res: any = await db.insertInto('technician_services').values({
    tenant_id: g.tenantId, branch_id: branchId, technician_id: g.technicianId, service_id: g.serviceId, is_primary: false,
    proficiency: g.proficiency ?? null, certificate_document_key: g.certificateDocumentKey ?? null, granted_by_user_id: g.grantedByUserId ?? null, granted_via: g.via,
  }).onConflict((oc) => oc.columns(['tenant_id', 'technician_id', 'service_id']).doNothing()).executeTakeFirst();
  // the first explicit grant ends the pre-631 "no mapping yet" leniency (migration 631, technician-eligibility.ts)
  await db.updateTable('technicians').set({ service_eligibility_mode: 'exact' }).where('tenant_id', '=', g.tenantId).where('id', '=', g.technicianId).where('service_eligibility_mode', '!=', 'exact').execute();
  return { inserted: Number(res?.numInsertedOrUpdatedRows ?? 0) > 0 };
}

export async function revokeEligibility(db: Db, r: { tenantId: string; technicianId: string; serviceId: string }): Promise<{ removed: boolean }> {
  const res: any = await db.deleteFrom('technician_services').where('tenant_id', '=', r.tenantId).where('technician_id', '=', r.technicianId).where('service_id', '=', r.serviceId).executeTakeFirst();
  return { removed: Number(res?.numDeletedRows ?? 0) > 0 };
}

/** The manager's direct path (`PATCH /pos/technicians/:id/services`): make the set EXACTLY `serviceIds`.
 *  Services the technician already holds are untouched (their proficiency/evidence survive); missing ones are
 *  granted; extras are revoked. Services outside the tenant are refused. */
export async function setTechnicianServices(db: Db, s: { tenantId: string; branchId: string | null; technicianId: string; serviceIds: string[]; grantedByUserId?: string | null; via?: string }): Promise<{ added: string[]; removed: string[]; serviceIds: string[] }> {
  const want = [...new Set(s.serviceIds.map((x) => String(x || '').trim()).filter(Boolean))];
  if (want.length) {
    const rows: any[] = await db.selectFrom('services').select(['id']).where('tenant_id', '=', s.tenantId).where('id', 'in', want).execute();
    const ok = new Set(rows.map((r) => String(r.id)));
    const bad = want.filter((id) => !ok.has(id));
    if (bad.length) throw new Error('SERVICE_NOT_IN_TENANT');
  }
  const have: any[] = await db.selectFrom('technician_services').select(['service_id']).where('tenant_id', '=', s.tenantId).where('technician_id', '=', s.technicianId).execute();
  const haveSet = new Set(have.map((r) => String(r.service_id)));
  const added: string[] = []; const removed: string[] = [];
  for (const sid of want) if (!haveSet.has(sid)) { const r = await grantEligibility(db, { tenantId: s.tenantId, branchId: s.branchId, technicianId: s.technicianId, serviceId: sid, grantedByUserId: s.grantedByUserId ?? null, via: s.via ?? 'manager_patch' }); if (r.inserted) added.push(sid); }
  for (const sid of haveSet) if (!want.includes(sid)) { const r = await revokeEligibility(db, { tenantId: s.tenantId, technicianId: s.technicianId, serviceId: sid }); if (r.removed) removed.push(sid); }
  // an explicit list (even an empty one) ends the pre-631 "no mapping yet" leniency — she is exact-service from now on
  await db.updateTable('technicians').set({ updated_at: sql`now()`, service_eligibility_mode: 'exact' }).where('tenant_id', '=', s.tenantId).where('id', '=', s.technicianId).execute().catch(() => undefined);
  return { added, removed, serviceIds: want };
}
