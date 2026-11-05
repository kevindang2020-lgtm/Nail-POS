// tech-app-access.pgtest — the Technician App on/off switch is ENFORCED, against the real schema.
//
// app_enabled was read only to display the App Access toggle; nothing consulted it when a technician used the app.
// These tests pin the enforcement and the decisions around it (see tech-app-access.middleware.ts).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TechnicianAppAccessMiddleware, invalidateTechAppAccess, resetTechAppAccessCache, TECH_APP_DISABLED } from '@aipowersalon/workforce';   // the middleware lives in the module; this spec also reads the API's app.module wiring, so it stays in the API
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'c6c6c6c6-0000-4000-8000-000000000001';
const B = 'c6c6c6c6-0000-4000-8000-000000000002';
const U_OFF = 'c6c6c6c6-0000-4000-8000-0000000000a1', TECH_OFF = 'c6c6c6c6-0000-4000-8000-0000000000b1';
const U_ON = 'c6c6c6c6-0000-4000-8000-0000000000a2', TECH_ON = 'c6c6c6c6-0000-4000-8000-0000000000b2';
const U_NOROW = 'c6c6c6c6-0000-4000-8000-0000000000a3', TECH_NOROW = 'c6c6c6c6-0000-4000-8000-0000000000b3';
let pg: any; let mw: TechnicianAppAccessMiddleware;

/** Runs the middleware for a request and reports whether it passed or what it answered. */
async function hit(role: string, userId: string, m = mw) {
  let passed = false; let status = 0; let body: any = null;
  const res = { status(s: number) { status = s; return { json(b: any) { body = b; } }; } };
  await m.use({ ctx: { role, tenantId: T, userId } }, res, () => { passed = true; });
  return { passed, status, body };
}

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Access Salon LLC', 'Access Salon', 'access-salon', 'ACCS1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;`).catch(() => undefined);
  for (const [u, t, name] of [[U_OFF, TECH_OFF, 'Off'], [U_ON, TECH_ON, 'On'], [U_NOROW, TECH_NOROW, 'NoRow']]) {
    await pg.exec(`INSERT INTO users (id, tenant_id, email, role, status) VALUES ('${u}', '${T}', '${name.toLowerCase()}@access.test', 'TECHNICIAN', 'active');`);
    await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name)
                   VALUES ('${t}', '${T}', '${B}', '${u}', '${name}', 'Tech', '${name} Tech');`);
  }
  await pg.exec(`INSERT INTO technician_app_settings (tenant_id, technician_id, app_enabled) VALUES ('${T}', '${TECH_OFF}', false), ('${T}', '${TECH_ON}', true);`);
  mw = new TechnicianAppAccessMiddleware(kyselyFor(pg));
});

beforeEach(() => resetTechAppAccessCache());

describe('the switch is enforced for technicians', () => {
  it('a technician whose app is OFF is refused with 403 and a message they can act on', async () => {
    const r = await hit('TECHNICIAN', U_OFF);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body).toEqual(TECH_APP_DISABLED);
  });

  it('a technician whose app is ON passes', async () => {
    expect((await hit('TECHNICIAN', U_ON)).passed).toBe(true);
  });

  it('NO settings row means enabled — the same answer the App Access screen displays', async () => {
    expect((await hit('TECHNICIAN', U_NOROW)).passed).toBe(true);
  });
});

describe('owners and managers are never blocked', () => {
  it('a MANAGER passes even when acting on a disabled technician\'s surface', async () => {
    expect((await hit('MANAGER', U_OFF)).passed).toBe(true);
  });

  it('an OWNER passes', async () => {
    expect((await hit('OWNER', U_OFF)).passed).toBe(true);
  });
});

describe('a manager\'s change takes effect', () => {
  it('switching the app back ON lets the technician in once the cache is invalidated', async () => {
    expect((await hit('TECHNICIAN', U_OFF)).passed).toBe(false);          // cached as off
    await pg.exec(`UPDATE technician_app_settings SET app_enabled = true WHERE technician_id = '${TECH_OFF}'`);
    invalidateTechAppAccess(T);
    expect((await hit('TECHNICIAN', U_OFF)).passed).toBe(true);
    await pg.exec(`UPDATE technician_app_settings SET app_enabled = false WHERE technician_id = '${TECH_OFF}'`);
    invalidateTechAppAccess(T);
  });

  it('without invalidation, a change still lands once the 30-second cache expires', async () => {
    let clock = 1_000_000;
    const m = new TechnicianAppAccessMiddleware(kyselyFor(pg)); m.now = () => clock;
    expect((await hit('TECHNICIAN', U_ON, m)).passed).toBe(true);
    await pg.exec(`UPDATE technician_app_settings SET app_enabled = false WHERE technician_id = '${TECH_ON}'`);
    expect((await hit('TECHNICIAN', U_ON, m)).passed).toBe(true);          // still cached
    clock += 31_000;
    expect((await hit('TECHNICIAN', U_ON, m)).passed).toBe(false);         // expired → re-read
    await pg.exec(`UPDATE technician_app_settings SET app_enabled = true WHERE technician_id = '${TECH_ON}'`);
  });
});

describe('failure direction', () => {
  it('a LOOKUP ERROR lets the request through — a DB blip must not lock out every technician', async () => {
    const broken = new TechnicianAppAccessMiddleware({ selectFrom: () => { throw new Error('db down'); } });
    expect((await hit('TECHNICIAN', U_OFF, broken)).passed).toBe(true);
  });
});

describe('it covers the tech app\'s whole API surface — and only that', () => {
  const appModule = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
  it('is registered on the tech/* prefix, so tech routes written later are covered too', () => {
    expect(appModule).toMatch(/apply\(TechnicianAppAccessMiddleware\)\.forRoutes\([^)]*'tech\/\(\.\*\)'/);
  });
  it('is NOT registered globally — a technician with app access off must still reach the POS', () => {
    expect(appModule).not.toMatch(/apply\(TechnicianAppAccessMiddleware\)\.forRoutes\('\*'\)/);
  });
});
