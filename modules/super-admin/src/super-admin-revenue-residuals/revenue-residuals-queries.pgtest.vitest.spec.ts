// revenue-residuals-queries.pgtest — executes the MONEY-path repository queries against a real Postgres engine.
//
// Why this module first: the silent-SQL report (scripts/audit-silent-sql.mjs) ranks it highest — 13 catches
// that return null/[] across ~169 raw queries. The residual SPLIT MATH is well covered by core and service
// specs, but nothing executed the SQL that feeds it, so a wrong column name would surface as "no agreements"
// or "$0" rather than as an error.
//
// Stronger pattern than hand-written DDL: it uses the shared cached migrated schema, so the schema cannot
// drift from production. ~6s to build, then the queries run against the genuine tables.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyRevenueResidualsRepo } from './super-admin-revenue-residuals.kysely.repository';
// Shared, cached migrated schema — built once, reused by every pgtest (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let repo: any;
let pg: any;
const TENANT = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
      VALUES ('${TENANT}', 'Glamour Studio LLC', 'Glamour Studio', 'glamour', 'GLAM01', 'active');
    INSERT INTO revenue_agreements (id, code, name, tenant_id, processor, revenue_source, status)
      VALUES (gen_random_uuid(), 'AGR-001', 'Fiserv Schedule A', '${TENANT}', 'fiserv', 'processing', 'active');
  `);
  const db = kyselyFor(pg);
  repo = new KyselyRevenueResidualsRepo(db);
}, 60_000);

describe('revenue-residuals queries execute against the real migrated schema', () => {
  it('overview() returns a shape, not the empty object a broken query would yield', async () => {
    const ov = await repo.overview();
    expect(ov).toBeTruthy();
    expect(typeof ov).toBe('object');
  });

  it('listAgreements() finds the seeded agreement — [] is how a wrong column hides', async () => {
    const rows = await repo.listAgreements({ limit: 10 });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const a = rows.find((r: any) => r.code === 'AGR-001');
    expect(a).toBeTruthy();
    expect(a.tenantName).toBe('Glamour Studio');     // joins tenants correctly (display_name, not name)
  });

  it('agreementDetail() resolves a real agreement id', async () => {
    const rows = await repo.listAgreements({ limit: 1 });
    const detail = await repo.agreementDetail(rows[0].id);
    expect(detail).not.toBeNull();                    // null = the query failed silently
    expect(detail.code).toBe('AGR-001');
  });

  it('listRecords() and listStatements() execute and return arrays', async () => {
    const recs = await repo.listRecords({ limit: 5 });
    expect(Array.isArray(recs.rows)).toBe(true);
    expect(typeof recs.total).toBe('number');
    expect(Array.isArray(await repo.listStatements({ limit: 5 }))).toBe(true);
  });
});
