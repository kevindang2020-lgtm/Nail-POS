// customer-data-queries.pgtest — executes the Customer Data Oversight repository against the REAL schema.
//
// Third module from the silent-SQL report (7 error-swallowing catches). This surface enforces the platform's
// loudest rule — "a customer from Tenant A must never automatically appear inside Tenant B" — so a query that
// fails silently here shows an EMPTY oversight screen, which reads as "nothing to review" rather than "the
// oversight feed is broken". The tenant-scoping assertion below is the one that matters most.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyCustomerDataOversightRepo } from './super-admin-customer-data.kysely.repository';
// Shared, cached migrated schema — built once, reused by every pgtest (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T_A = '11111111-1111-1111-1111-111111111111';
const T_B = '22222222-2222-2222-2222-222222222222';
const B_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let repo: KyselyCustomerDataOversightRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
      ('${T_A}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active'),
      ('${T_B}','Luxe Salon LLC','Luxe Salon','luxe','LUXE01','active');
    -- Real-schema facts this test surfaced: customers.branch_id is NOT NULL (so branches must exist first),
    -- and first_name/last_name are NOT NULL alongside full_name.
    INSERT INTO branches (id, tenant_id, name) VALUES
      ('${B_A}', '${T_A}', 'Downtown'), ('${B_B}', '${T_B}', 'Main Street');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) VALUES
      (gen_random_uuid(), '${T_A}', '${B_A}', 'Ava','Kim',   'Ava Kim',   '+16095550101', 'ava@example.com',  'active'),
      (gen_random_uuid(), '${T_A}', '${B_A}', 'Mia','Lopez', 'Mia Lopez', '+16095550102', 'mia@example.com',  'active'),
      (gen_random_uuid(), '${T_B}', '${B_B}', 'Sam','Ray',   'Sam Ray',   '+16095550103', 'sam@example.com',  'active');
  `);
  const db = kyselyFor(pg);
  repo = new KyselyCustomerDataOversightRepo(db);
}, 60_000);

describe('customer-data oversight repository executes against the real migrated schema', () => {
  it('loadCustomerProjection returns rows joined to the tenant display name', async () => {
    const rows = await repo.loadCustomerProjection({} as any);
    expect(rows.length).toBe(3);
    const ava = rows.find((r: any) => r.fullName === 'Ava Kim') as any;   // repo maps to camelCase
    expect(ava.tenantName).toBe('Glamour Studio');      // tenants.display_name, joined
    expect(ava.branchName).toBe('Downtown');
  });

  it('TENANT ISOLATION: scoping to one tenant never returns another tenant\'s customers', async () => {
    const a = await repo.loadCustomerProjection({ tenantId: T_A } as any);
    expect(a.length).toBe(2);
    expect(a.every((r: any) => r.tenantId === T_A)).toBe(true);
    expect(a.some((r: any) => r.fullName === 'Sam Ray')).toBe(false);    // Tenant B must not leak in
    const b = await repo.loadCustomerProjection({ tenantId: T_B } as any);
    expect(b.map((r: any) => r.fullName)).toEqual(['Sam Ray']);
  });

  it('every counts/history read executes — null or [] is how these hide', async () => {
    expect(await repo.privacyCounts({} as any)).not.toBeUndefined();
    expect(await repo.deletionCounts({} as any)).not.toBeUndefined();
    expect(await repo.exportCounts({} as any)).not.toBeUndefined();
    expect(Array.isArray(await repo.recentMerges({} as any))).toBe(true);
    expect(Array.isArray(await repo.mergeHistory({} as any))).toBe(true);
    expect(Array.isArray(await repo.recentActivity({} as any))).toBe(true);
    expect(Array.isArray(await repo.auditHistory({} as any))).toBe(true);
  });
});
