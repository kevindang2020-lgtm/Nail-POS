// tech-queue-queries.pgtest — executes the POS Tech Queue repository reads against the real migrated schema.
//
// 35 queries with inline `.catch(() => [])` on the catalog, skills and status lookups. The failure mode here
// is specific and quiet: an empty SERVICE CATALOG reads as "this salon has not configured any services yet",
// and a technician with no skills reads as "not trained on anything". Both look like setup the salon has not
// done, so nobody reports them as bugs.
//
// Every assertion is "NOT empty", because empty is what the catch returns.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyTechQueueRepository } from './tech-queue.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'cccccccc-0000-4000-8000-000000000001';
const B = 'cccccccc-0000-4000-8000-000000000002';
const CAT = 'cccccccc-0000-4000-8000-000000000003';
const SVC = 'cccccccc-0000-4000-8000-000000000004';
const TECH = 'cccccccc-0000-4000-8000-000000000005';
const ctx = { tenantId: T, branchId: B } as never;
let repo: KyselyTechQueueRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Queue Salon LLC', 'Queue Salon', 'queue-salon', 'QUEUE1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new KyselyTechQueueRepository(kyselyFor(pg) as never);

  await pg.exec(`
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
  `);
  await pg.exec(`
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents)
    VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500);
  `);
  await pg.exec(`
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status)
    VALUES ('${TECH}', '${T}', '${B}', 'Mia', 'Chen', 'Mia Chen', 'active');
  `);
  await pg.exec(`
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id)
    VALUES ('${T}', '${B}', '${TECH}', '${SVC}');
  `);
  await pg.exec(`
    INSERT INTO technician_statuses (tenant_id, branch_id, technician_id, status)
    VALUES ('${T}', '${B}', '${TECH}', 'on_break');
  `);
});

describe('the service catalog actually loads', () => {
  it('a seeded service comes BACK — an empty catalog reads as "no services configured", not as a bug', async () => {
    const cat = await repo.serviceCatalog(ctx);
    expect(cat.length).toBeGreaterThan(0);
    expect(cat.map((c) => c.name)).toContain('Gel Manicure');
  });

  it('the LEFT JOIN onto service_categories resolves — otherwise everything falls back to "General"', async () => {
    const cat = await repo.serviceCatalog(ctx);
    expect(cat.find((c) => c.name === 'Gel Manicure')?.categoryName).toBe('Manicures');
  });

  it('duration and price are numbers, not strings', async () => {
    const svc = (await repo.serviceCatalog(ctx)).find((c) => c.name === 'Gel Manicure')!;
    expect(svc.durationMinutes).toBe(45);
    expect(svc.priceCents).toBe(4500);
  });

  it('another tenant sees an empty catalog — the scope is real', async () => {
    const cat = await repo.serviceCatalog({ tenantId: 'dddddddd-0000-4000-8000-000000000009', branchId: null } as never);
    expect(cat).toHaveLength(0);
  });
});

describe('technicians, their skills and their working status', () => {
  it('a seeded technician comes back', async () => {
    const techs = await repo.technicians(ctx);
    expect(techs.length).toBeGreaterThan(0);
  });

  it('the technician carries a real name, not an id fallback', async () => {
    const techs = await repo.technicians(ctx);
    expect(JSON.stringify(techs)).toContain('Mia Chen');
  });

  // The seeded status is deliberately NOT 'available'. When the status lookup fails, the repository falls back
  // to 'available' — so asserting 'available' passes whether the query works or not. A mutation proved exactly
  // that: breaking the technician_statuses table name left all seven tests green. Assert the NON-default.
  it("the status lookup resolved — a broken one silently falls back to 'available'", async () => {
    const techs = await repo.technicians(ctx);
    expect(JSON.stringify(techs)).toMatch(/on_break/i);
  });
});
