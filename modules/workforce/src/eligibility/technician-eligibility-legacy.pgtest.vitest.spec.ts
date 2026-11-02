// technician-eligibility-legacy.pgtest — BACKWARD COMPATIBILITY of the exact-service eligibility engine (fix Oct 12 2026,
// wave-2 regression: live-phase13-offline "accept 400", live-multitech-queue "start 400").
//
// A salon that existed BEFORE migration 583 is built the way the code of that time built it: migrations up to 582 only,
// technicians created by the old roster writer (technician_services rows with no proficiency / granted_via — the columns
// did not exist), one technician with NO service mapping at all (the roster's serviceIds were optional), and a roster
// skill group in technician_skills (377). THEN the remaining migrations run (583 … 631), exactly as a deploy would.
// Pinned, on the real schema:
//   • a technician mapped to ONE service of a category before the deploy keeps the whole category (the queue / booking /
//     check-in category rule she was eligible under) — 631 materialises it as explicit grants; another category is still
//     refused, exactly as before;
//   • §24 (Kevin's decision, Oct 27 2026 — reverses the fail-closed rule of 3fa531bc): a technician with NO configured
//     service (a pre-deploy legacy_unconfigured one, one hired after the deploy with no grant, one whose list was emptied)
//     is bookable through the CATEGORY FALLBACK — any service in one of the salon's categories, basis
//     'category_fallback_unconfigured' — and the moment she has one configured service she is strictly exact-skill;
//   • a live service elsewhere is the only workforce refusal on a start (not clocked in is not).
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMigrationToPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { TechnicianEligibilityService, KyselyEligibilityReader, TechnicianEligibilityError } from './technician-eligibility';
import { WorkforceStatePortAdapter } from '../workforce-status/workforce-state-port.adapter';
import { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { KyselyWorkforceStateStore } from '../workforce-status/workforce-status.kysely.repository';
import { OutboxWriter } from '@aipowersalon/events';
import { setTechnicianServices, grantEligibility, revokeEligibility } from '../technicians/technician-skills';

const MIGRATIONS = MIGRATIONS_DIR;
const u = (x: string) => `1e9a1e9a-0000-4000-8000-${x.padStart(12, '0')}`;
const TA = u('a1'), BA = u('b1'), UA = u('d1');
const CMANI = u('c1'), CPEDI = u('c2');
const GEL_MANI = u('f1'), CLASSIC_MANI = u('f2'), PEDI = u('f3'), LATER_MANI = u('f4');
const LEE = u('e1') /* mapped to Gel Manicure only */, OONA = u('e2') /* no mapping at all */, NEWBIE = u('e3') /* created after deploy */;
let pg: any; let db: any; let elig: TechnicianEligibilityService;
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { if (e instanceof TechnicianEligibilityError) return e.code; throw e; } };
const ask = (technicianId: string, serviceIds: string[], over: Record<string, unknown> = {}) =>
  code(elig.assert({ tenantId: TA, branchId: BA, technicianId, serviceIds, actor: { userId: UA, role: 'MANAGER' }, ...over } as any));

beforeAll(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  pg = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const before = files.filter((f) => Number(f.slice(0, 3)) < 583), after = files.filter((f) => Number(f.slice(0, 3)) >= 583);
  for (const f of before) await applyMigrationToPglite(pg, readFileSync(join(MIGRATIONS, f), 'utf8'));
  // ── the pre-583 salon, written the way the code of that time wrote it ──
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${TA}', 'Legacy LLC', 'Legacy', 'legacy-salon', 'LEGACY1', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${BA}', '${TA}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, status, role) VALUES ('${UA}', '${TA}', '${BA}', 'Owner', 'own@legacy.test', 'x', 'active', 'OWNER');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CMANI}', '${TA}', '${BA}', 'Manicure'), ('${CPEDI}', '${TA}', '${BA}', 'Pedicure');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${GEL_MANI}', '${TA}', '${BA}', '${CMANI}', 'Gel Manicure', 45, 4500, 'active'),
      ('${CLASSIC_MANI}', '${TA}', '${BA}', '${CMANI}', 'Classic Manicure', 30, 3000, 'active'),
      ('${PEDI}', '${TA}', '${BA}', '${CPEDI}', 'Spa Pedicure', 50, 6000, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${LEE}', '${TA}', '${BA}', 'Lee', 'L', 'Lee L', 'active', true), ('${OONA}', '${TA}', '${BA}', 'Oona', 'O', 'Oona O', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) VALUES ('${TA}', '${BA}', '${LEE}', '${GEL_MANI}', false);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) VALUES ('${TA}', '${BA}', '${LEE}', '${GEL_MANI}', false);   -- the pre-583 duplicate 583 de-duplicates
    INSERT INTO technician_skills (tenant_id, branch_id, technician_id, skill_group) VALUES ('${TA}', '${BA}', '${OONA}', 'gel');
  `);
  // ── the deploy ──
  for (const f of after) await applyMigrationToPglite(pg, readFileSync(join(MIGRATIONS, f), 'utf8'));
  db = kyselyFor(pg);
  // ── after the deploy: a new service in an old category, and a technician hired after the deploy ──
  await pg.exec(`
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${LATER_MANI}', '${TA}', '${BA}', '${CMANI}', 'Chrome Manicure', 40, 4000, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${NEWBIE}', '${TA}', '${BA}', 'Nia', 'N', 'Nia N', 'active', true);
  `);
  const workforce = new WorkforceStatePortAdapter(new WorkforceStatusService(new KyselyWorkforceStateStore(db, new OutboxWriter())));
  elig = new TechnicianEligibilityService({ reader: new KyselyEligibilityReader(db), workforce, availability: null });
}, 240000);

describe('a salon that existed before the exact-service model keeps working after the deploy', () => {
  it('Lee (mapped to Gel Manicure only, category rule) can still accept and start a Classic Manicure — not a Pedicure', async () => {
    expect(await ask(LEE, [CLASSIC_MANI])).toBe('OK');
    expect(await ask(LEE, [GEL_MANI, CLASSIC_MANI])).toBe('OK');
    expect(await ask(LEE, [PEDI])).toBe('TECHNICIAN_NOT_SKILLED');   // another category: refused before the deploy too
    const rows = (await pg.query(`SELECT service_id, granted_via FROM technician_services WHERE technician_id = $1 ORDER BY service_id`, [LEE])).rows;
    expect(rows.map((r: any) => r.service_id).sort()).toEqual([GEL_MANI, CLASSIC_MANI].sort());   // de-duplicated, then the category materialised once
    expect(rows.find((r: any) => r.service_id === CLASSIC_MANI).granted_via).toBe('legacy_category_backfill');
  });
  it('a service added AFTER the deploy is exact-service: Lee needs an explicit grant for it', async () => {
    expect(await ask(LEE, [LATER_MANI])).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('§24 (Kevin, Oct 27): Oona (no service mapping before the deploy) is marked legacy_unconfigured and bookable through the category fallback — accept and start alike, basis named', async () => {
    expect((await pg.query(`SELECT service_eligibility_mode AS m FROM technicians WHERE id = $1`, [OONA])).rows[0].m).toBe('legacy_unconfigured');
    expect(await ask(OONA, [GEL_MANI, PEDI])).toBe('OK');              // accept (requireAssignable=false)
    expect(await ask(OONA, [GEL_MANI], { requireNotServing: true })).toBe('OK');
    const r: any = await elig.assert({ tenantId: TA, branchId: BA, technicianId: OONA, serviceIds: [GEL_MANI], actor: { userId: UA, role: 'MANAGER' } } as any);
    expect(r.eligibilityBasis).toBe('category_fallback_unconfigured');
    const v = await elig.eligibleAmong({ tenantId: TA, branchId: BA, technicianIds: [OONA, LEE], serviceIds: [PEDI] });
    expect(v.get(OONA)).toMatchObject({ eligible: true, basis: 'category_fallback_unconfigured' });
    expect(v.get(LEE)).toMatchObject({ eligible: false, basis: 'exact', code: 'TECHNICIAN_NOT_SKILLED' });   // configured: strictly exact
  });
  it('Nia (hired after the deploy, no services set up) is bookable through the fallback too; a service id that is not one of the salon\'s category services is refused (nothing to fall back on)', async () => {
    expect((await pg.query(`SELECT service_eligibility_mode AS m FROM technicians WHERE id = $1`, [NEWBIE])).rows[0].m).toBe('exact');
    expect(await ask(NEWBIE, [GEL_MANI])).toBe('OK');
    const e: any = await elig.assert({ tenantId: TA, branchId: BA, technicianId: NEWBIE, serviceIds: [u('f9')], actor: { userId: UA, role: 'MANAGER' } } as any).catch((x) => x);
    expect(e).toBeInstanceOf(TechnicianEligibilityError);
    expect(e.details).toMatchObject({ reason: 'skills_not_configured', basis: 'category_fallback_unconfigured' });
  });
  it('once Oona is given an explicit list she is strictly exact-skill; emptying the list puts her back on the fallback', async () => {
    await setTechnicianServices(db, { tenantId: TA, branchId: BA, technicianId: OONA, serviceIds: [PEDI], grantedByUserId: UA });
    expect((await pg.query(`SELECT service_eligibility_mode AS m FROM technicians WHERE id = $1`, [OONA])).rows[0].m).toBe('exact');
    expect(await ask(OONA, [PEDI])).toBe('OK');
    expect(await ask(OONA, [GEL_MANI])).toBe('TECHNICIAN_NOT_SKILLED');   // configured but missing the exact service → refused
    const e: any = await elig.assert({ tenantId: TA, branchId: BA, technicianId: OONA, serviceIds: [GEL_MANI], actor: { userId: UA, role: 'MANAGER' } } as any).catch((x) => x);
    expect(e.details).toMatchObject({ basis: 'exact' });
    expect(e.details.reason).toBeUndefined();
    await setTechnicianServices(db, { tenantId: TA, branchId: BA, technicianId: OONA, serviceIds: [], grantedByUserId: UA });
    expect(await ask(OONA, [GEL_MANI])).toBe('OK');                       // no services set up again → the fallback
  });
  it('an approved skill request makes a legacy technician exact-service', async () => {
    await pg.query(`DELETE FROM technician_services WHERE technician_id = $1`, [OONA]);
    await pg.query(`UPDATE technicians SET service_eligibility_mode = 'legacy_unconfigured' WHERE id = $1`, [OONA]);
    expect(await ask(OONA, [GEL_MANI])).toBe('OK');                       // §24 fallback while she has none
    await grantEligibility(db, { tenantId: TA, branchId: BA, technicianId: OONA, serviceId: PEDI, via: 'skill_request' });
    expect(await ask(OONA, [GEL_MANI])).toBe('TECHNICIAN_NOT_SKILLED');   // one configured service → strictly exact
    expect(await ask(OONA, [PEDI])).toBe('OK');
    await revokeEligibility(db, { tenantId: TA, technicianId: OONA, serviceId: PEDI });
    expect(await ask(OONA, [PEDI])).toBe('OK');                           // none again → the fallback
  });
  it('an override never bypasses the skill rule for a configured technician', async () => {
    expect(await ask(LEE, [PEDI], { actor: { userId: UA, role: 'OWNER', overrideConflicts: true } })).toBe('TECHNICIAN_NOT_SKILLED');
  });
  it('631 is idempotent: a second run grants nothing new and re-marks nobody', async () => {
    const n = async () => (await pg.query(`SELECT count(*)::int AS n FROM technician_services WHERE tenant_id = $1`, [TA])).rows[0].n;
    const before = await n();
    const f = readdirSync(MIGRATIONS).find((x) => x.startsWith('631_'))!;
    await applyMigrationToPglite(pg, readFileSync(join(MIGRATIONS, f), 'utf8'));
    expect(await n()).toBe(before);
    expect((await pg.query(`SELECT service_eligibility_mode AS m FROM technicians WHERE id = $1`, [NEWBIE])).rows[0].m).toBe('exact');
  });
});
