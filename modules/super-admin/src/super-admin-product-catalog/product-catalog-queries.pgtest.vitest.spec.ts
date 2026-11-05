// product-catalog-queries.pgtest — runs the THREE new catalog queries against a real Postgres engine (PGlite).
//
// Why this exists: every one of these queries is raw SQL wrapped in try/catch that returns null on error, and
// null renders as "NotConnected" in the UI. A wrong column name therefore fails SILENTLY and forever — the
// panel just looks unimplemented. Writing these tests caught three real bugs before they shipped:
//   1. product_distributions has no 'completed' status (pending|processing|distributed|skipped_existing|failed),
//      so "pending = status <> 'completed'" counted EVERY row as pending.
//   2. tenants has display_name, not name — both queries referenced t.name.
//   3. users.full_name exists and is the better actor source.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCatalogRepo } from './super-admin-product-catalog.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(compiled: any) { const r = await pg.query(compiled.sql, compiled.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() {},
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const M1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const U1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let repo: KyselyCatalogRepo;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  // Column names mirror the real migrations — that is the point of the test.
  await pg.exec(`
    create table tenants (id uuid primary key, display_name text not null);
    create table users (id uuid primary key, first_name text, last_name text, full_name text);
    create table inventory_brands (id uuid primary key, tenant_id uuid, name text);
    create table inventory_products (id uuid primary key, tenant_id uuid not null, brand_id uuid, name text not null, sku text);
    create table product_master (id uuid primary key, name text not null);
    create table product_distributions (id uuid primary key, master_product_id uuid, tenant_id uuid not null,
      status text not null, tenant_product_id uuid, created_at timestamptz not null default now());
    create table audit_logs (id uuid primary key, tenant_id uuid, user_id uuid, action_type text not null,
      entity_type text, entity_id text, created_at timestamptz not null default now());

    insert into tenants values ('${T1}','Glamour Studio'), ('${T2}','Luxe Salon');
    insert into users (id, first_name, last_name, full_name) values ('${U1}','Sam','Ray','Sam Ray');
    insert into inventory_brands values (gen_random_uuid(), '${T1}', 'CND');
    -- SKU-A is carried by BOTH tenants (reach 2); SKU-B by one tenant on three rows (reach 1)
    insert into inventory_products (id, tenant_id, name, sku) values
      (gen_random_uuid(),'${T1}','Cuticle Oil','SKU-A'), (gen_random_uuid(),'${T2}','Cuticle Oil','SKU-A'),
      (gen_random_uuid(),'${T1}','Base Coat','SKU-B'),  (gen_random_uuid(),'${T1}','Base Coat','SKU-B'),
      (gen_random_uuid(),'${T1}','Base Coat','SKU-B'),  (gen_random_uuid(),'${T1}','No SKU', null);
    insert into product_master values ('${M1}','Master Cuticle Oil');
    insert into product_distributions (id, master_product_id, tenant_id, status, tenant_product_id) values
      (gen_random_uuid(),'${M1}','${T1}','distributed', gen_random_uuid()),
      (gen_random_uuid(),'${M1}','${T1}','skipped_existing', null),
      (gen_random_uuid(),'${M1}','${T1}','pending', null),
      (gen_random_uuid(),'${M1}','${T2}','processing', null);
    insert into audit_logs (id, tenant_id, user_id, action_type, entity_type, entity_id) values
      (gen_random_uuid(), '${T1}', '${U1}', 'product_distributed', 'product_master', '${M1}'),
      (gen_random_uuid(), null, '${U1}', 'product_master_created', 'product_master', '${M1}'),
      (gen_random_uuid(), null, '${U1}', 'customer_merged', 'customer', 'not-a-product');
  `);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any,
    createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCatalogRepo(db);
});

describe('product-catalog queries execute against real Postgres', () => {
  it('topProductsByReach ranks by DISTINCT tenants over every row (no cap, no page)', async () => {
    const rows = await repo.topProductsByReach({}, 5);
    expect(rows).not.toBeNull();                       // null would mean the SQL failed and the panel dies silently
    expect(rows![0]).toMatchObject({ sku: 'sku-a', tenants: 2 });
    expect(rows!.find((r) => r.sku === 'sku-b')?.tenants).toBe(1);   // 3 rows, ONE tenant
    expect(rows!.some((r) => r.sku == null)).toBe(false);            // SKU-less row excluded
  });

  it('tenantProductConfigs counts pending from the REAL status vocabulary', async () => {
    const rows = await repo.tenantProductConfigs({});
    expect(rows).not.toBeNull();
    const t1 = rows!.find((r) => r.tenantId === T1)!;
    expect(t1.tenantName).toBe('Glamour Studio');       // display_name, not name
    expect(t1.distributed).toBe(3);
    expect(t1.linked).toBe(1);                          // only the row with tenant_product_id
    expect(t1.pending).toBe(1);                         // pending only — NOT 'everything that isn't completed'
    expect(rows!.find((r) => r.tenantId === T2)!.pending).toBe(1);   // 'processing' counts as pending
  });

  it('productChangeHistory returns only product events, with product/actor/tenant joined', async () => {
    const rows = await repo.productChangeHistory({}, 10);
    expect(rows).not.toBeNull();
    expect(rows!).toHaveLength(2);                      // the customer_merged row is excluded
    expect(rows!.map((r) => r.action).sort()).toEqual(['product_distributed', 'product_master_created']);
    const distributed = rows!.find((r) => r.action === 'product_distributed')!;
    expect(distributed.productName).toBe('Master Cuticle Oil');
    expect(distributed.actorName).toBe('Sam Ray');
    expect(distributed.tenantName).toBe('Glamour Studio');
  });
});
