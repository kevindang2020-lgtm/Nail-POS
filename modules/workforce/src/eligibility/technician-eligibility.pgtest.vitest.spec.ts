// technician-eligibility.pgtest — THE eligibility function's production reader + the ONE technician_services writer on
// the REAL schema (every migration in PGlite; 583 unique index + proficiency/evidence columns, 584 certifications).
// Pinned: a configured technician not approved for the exact service → TECHNICIAN_NOT_SKILLED, one with NO services set up
// → the category fallback (§24, Kevin Oct 27); the one writer flips it; an expired / revoked required
// certification blocks and a verified one passes; branch access counts the roster branch, user_branch_access and an
// active membership; suspended employment is refused everywhere; the writer is idempotent and keeps evidence.
// (Wiring into booking / queue / serving is the BK and PAY merges' work — see ledger-AUTH.)
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechnicianEligibilityService, KyselyEligibilityReader, assertTechnicianEligible, TechnicianEligibilityError } from './technician-eligibility';
import { PermissiveWorkforceStatePort } from '../workforce-status/workforce-ports';
import { grantEligibility, revokeEligibility, setTechnicianServices } from '../technicians/technician-skills';

let pg: any; let db: any; let elig: TechnicianEligibilityService;
const u = (x: string) => `e1a6e1a6-0000-4000-8000-${x.padStart(12, '0')}`;
const TA = u('a1'), BA = u('b1'), BA2 = u('b2'), UA = u('d1'), MIA = u('e1'), KIM = u('e2'), CAT = u('c1'), SVC = u('f1'), ACRYLIC = u('f2'), GTP = u('ab');
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { if (e instanceof TechnicianEligibilityError) return e.code; throw e; } };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1, 'E', 'E', 'e-t', 'ELIG1', 'active')`, [TA]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name, status) VALUES ($1, $3, 'Main', 'active'), ($2, $3, 'Second', 'active')`, [BA, BA2, TA]);
  await pg.query(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, status, role) VALUES ($1, $2, $3, 'Owner', 'own@e.test', 'x', 'active', 'OWNER')`, [UA, TA, BA]);
  await pg.query(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ($1, $2, $3, 'Nails')`, [CAT, TA, BA]);
  await pg.query(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, required_certification)
                  VALUES ($1, $3, $4, $5, 'Manicure', 45, 4500, 'active', NULL), ($2, $3, $4, $5, 'Acrylic Full Set', 90, 9000, 'active', 'Acrylic Safety')`, [SVC, ACRYLIC, TA, BA, CAT]);
  await pg.query(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active)
                  VALUES ($1, $3, $4, 'Mia', 'C', 'Mia C', 'active', true), ($2, $3, $4, 'Kim', 'V', 'Kim V', 'active', true)`, [MIA, KIM, TA, BA]);
  elig = new TechnicianEligibilityService({ reader: new KyselyEligibilityReader(db), workforce: new PermissiveWorkforceStatePort(), availability: null });
});

const base = () => ({ reader: new KyselyEligibilityReader(db), workforce: new PermissiveWorkforceStatePort() });

describe('exact-service eligibility on the real schema', () => {
  it('§24 (Kevin, Oct 27 2026): NO services set up → bookable through the category fallback (basis named); a certification still applies', async () => {
    const r: any = await elig.assert({ tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [SVC], actor: { userId: UA, role: 'OWNER' } });
    expect(r.eligibilityBasis).toBe('category_fallback_unconfigured');
    const e = await elig.assert({ tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [ACRYLIC], actor: { userId: UA, role: 'OWNER' } }).catch((x) => x);
    expect(e).toBeInstanceOf(TechnicianEligibilityError);
    expect(e.details).toMatchObject({ reason: 'certification_missing' });
  });
  it('CONFIGURED but not approved for the exact service → TECHNICIAN_NOT_SKILLED with the pinned message (basis exact); the override cannot bypass it', async () => {
    await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: KIM, serviceId: SVC, via: 'seed' });
    const e = await elig.assert({ tenantId: TA, branchId: BA, technicianId: KIM, serviceIds: [ACRYLIC], actor: { userId: UA, role: 'OWNER', overrideConflicts: true } }).catch((x) => x);
    expect(e).toBeInstanceOf(TechnicianEligibilityError);
    expect(e.code).toBe('TECHNICIAN_NOT_SKILLED');
    expect(e.message).toBe('Kim V is not currently approved for this service.');
    expect(e.details).toMatchObject({ basis: 'exact' });
    await revokeEligibility(db, { tenantId: TA, technicianId: KIM, serviceId: SVC });
  });
  it('the ONE writer grants it (idempotently, with proficiency + evidence) and revokes it', async () => {
    const g1 = await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceId: SVC, proficiency: 'EXPERT', certificateDocumentKey: 'skilldoc/t/p/m.pdf', grantedByUserId: UA, via: 'skill_request' });
    expect(g1.inserted).toBe(true);
    const g2 = await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceId: SVC, via: 'manager_patch' });
    expect(g2.inserted).toBe(false);   // ON CONFLICT DO NOTHING — the recorded evidence is not overwritten
    const rows = (await pg.query(`SELECT proficiency, certificate_document_key, granted_via FROM technician_services WHERE tenant_id = $1 AND technician_id = $2 AND service_id = $3`, [TA, MIA, SVC])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proficiency: 'EXPERT', certificate_document_key: 'skilldoc/t/p/m.pdf', granted_via: 'skill_request' });
    expect(await code(elig.assert({ tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [SVC], actor: {} }))).toBe('OK');
    // the unique index itself refuses a raw duplicate
    await expect(pg.query(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ($1, $2, $3, $4)`, [TA, BA, MIA, SVC])).rejects.toThrow(/duplicate|unique/i);
    // a configured technician is exact: with SVC only, the Acrylic set (same category) is refused
    expect(await code(elig.assert({ tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [ACRYLIC], actor: {} }))).toBe('TECHNICIAN_NOT_SKILLED');
    expect((await revokeEligibility(db, { tenantId: TA, technicianId: MIA, serviceId: SVC })).removed).toBe(true);
    // none left → no services set up → the category fallback again (§24)
    expect(await code(elig.assert({ tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [SVC], actor: {} }))).toBe('OK');
    await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceId: SVC, proficiency: 'EXPERT', via: 'seed' });
  });
  it("the manager's direct PATCH (setTechnicianServices) is the SAME writer: idempotent, keeps evidence, revokes extras, refuses foreign services", async () => {
    const r = await setTechnicianServices(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [SVC, ACRYLIC], grantedByUserId: UA });
    expect(r.added).toEqual([ACRYLIC]); expect(r.removed).toEqual([]);
    const after = (await pg.query(`SELECT service_id, proficiency FROM technician_services WHERE tenant_id = $1 AND technician_id = $2 ORDER BY created_at`, [TA, MIA])).rows;
    expect(after).toHaveLength(2);
    expect(after.find((x: any) => x.service_id === SVC).proficiency).toBe('EXPERT');   // evidence survives the PATCH
    const r2 = await setTechnicianServices(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [SVC], grantedByUserId: UA });
    expect(r2.removed).toEqual([ACRYLIC]);
    await expect(setTechnicianServices(db, { tenantId: TA, branchId: BA, technicianId: MIA, serviceIds: [u('dead')] })).rejects.toThrow('SERVICE_NOT_IN_TENANT');
  });
  it('a required certification: expired blocks, verified passes, revoked blocks', async () => {
    await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: KIM, serviceId: ACRYLIC, via: 'seed' });
    const certId = u('cc01');
    await pg.query(`INSERT INTO technician_certifications (id, tenant_id, technician_id, name, expires_at, verification_status) VALUES ($1, $2, $3, 'Acrylic Safety', '2020-01-01', 'VERIFIED')`, [certId, TA, KIM]);
    const input = { tenantId: TA, branchId: BA, technicianId: KIM, serviceIds: [ACRYLIC], actor: { userId: UA, role: 'OWNER', overrideConflicts: true } };
    expect(await code(elig.assert(input))).toBe('TECHNICIAN_NOT_SKILLED');
    await pg.query(`UPDATE technician_certifications SET expires_at = '2099-01-01' WHERE id = $1`, [certId]);
    expect(await code(elig.assert(input))).toBe('OK');
    await pg.query(`UPDATE technician_certifications SET verification_status = 'REVOKED' WHERE id = $1`, [certId]);
    expect(await code(elig.assert(input))).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('branch access: roster branch, user_branch_access and an active membership all count; another branch does not', async () => {
    expect(await code(assertTechnicianEligible(base(), { tenantId: TA, branchId: BA2, technicianId: MIA, serviceIds: [], actor: {} }))).toBe('TECHNICIAN_BRANCH_ACCESS_DENIED');
    await pg.query(`INSERT INTO global_tech_profiles (id, public_slug, display_name, tech_code) VALUES ($1, 'mia-c', 'Mia C', 'MIA001')`, [GTP]);
    await pg.query(`UPDATE technicians SET global_tech_profile_id = $1 WHERE id = $2`, [GTP, MIA]);
    await pg.query(`INSERT INTO tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, status) VALUES ($1, $2, $3, $4, 'active')`, [GTP, TA, BA2, MIA]);
    expect(await code(assertTechnicianEligible(base(), { tenantId: TA, branchId: BA2, technicianId: MIA, serviceIds: [], actor: {} }))).toBe('OK');
  });
  it('suspended employment is refused everywhere (even with an override); an unknown technician is NOT_FOUND', async () => {
    await pg.query(`UPDATE technicians SET status = 'suspended' WHERE id = $1`, [KIM]);
    expect(await code(assertTechnicianEligible(base(), { tenantId: TA, branchId: BA, technicianId: KIM, serviceIds: [], actor: { overrideConflicts: true } }))).toBe('TECHNICIAN_NOT_ACTIVE');
    expect(await code(assertTechnicianEligible(base(), { tenantId: TA, branchId: BA, technicianId: u('dead'), serviceIds: [], actor: {} }))).toBe('TECHNICIAN_NOT_FOUND');
  });
});
