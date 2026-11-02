// tech-service-history.pgtest.vitest.spec.ts — the Tech pass's Service History query on REAL tables (Jul 29, 2026).
// Pinned: only MY paid lines (another technician's and another tenant's identical rows are invisible), the guest is
// named first-name + last-initial (or "Walk-in guest"), the ticket's satisfaction rating shows honestly as null when
// nobody rated, the service filter narrows, and the distinct-services list feeds the All-Services filter.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTechRepository } from './tech.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = '11111111-1111-4111-8111-111111111111';
const OTHER_T = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TECH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let repo: KyselyTechRepository;
let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`CREATE TABLE tickets (id uuid primary key, tenant_id uuid not null, customer_id uuid, status text not null,
    paid_at timestamptz, satisfaction_rating smallint)`);
  await pg.exec(`CREATE TABLE ticket_service_lines (id uuid primary key, tenant_id uuid not null, ticket_id uuid not null,
    technician_id uuid, service_name_snapshot text, line_total_cents bigint not null default 0)`);
  await pg.exec(`CREATE TABLE customers (id uuid primary key, tenant_id uuid not null, first_name text, last_name text)`);
  const tk = (n: number) => `000000${n}0-0000-4000-8000-0000000000${n}0`.slice(0, 36);
  const cu = (n: number) => `000000${n}1-0000-4000-8000-0000000000${n}1`.slice(0, 36);
  await pg.query(`INSERT INTO customers (id, tenant_id, first_name, last_name) VALUES
    ($1,$3,'Maria','Johnson'), ($2,$3,'Lily',NULL)`, [cu(1), cu(2), T]);
  await pg.query(`INSERT INTO tickets (id, tenant_id, customer_id, status, paid_at, satisfaction_rating) VALUES
    ($1,$5,$6,'paid', now() - interval '1 day', 5),
    ($2,$5,$7,'paid', now() - interval '2 days', NULL),
    ($3,$5,$6,'open', NULL, NULL),
    ($4,$8,$6,'paid', now(), 4)`, [tk(1), tk(2), tk(3), tk(4), T, cu(1), cu(2), OTHER_T]);
  await pg.query(`INSERT INTO ticket_service_lines (id, tenant_id, ticket_id, technician_id, service_name_snapshot, line_total_cents) VALUES
    (gen_random_uuid(),$1,$2,$5,'Gel Manicure',4500),
    (gen_random_uuid(),$1,$3,$5,'Builder Gel Refill',6000),
    (gen_random_uuid(),$1,$4,$5,'Gel Manicure',4500),
    (gen_random_uuid(),$1,$2,$6,'Pedicure',5000),
    (gen_random_uuid(),$7,$8,$5,'Gel Manicure',4500)`, [T, tk(1), tk(2), tk(3), ME, OTHER_TECH, OTHER_T, tk(4)]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyTechRepository(db as any);
});

describe('tech service history (real tables)', () => {
  it('returns only MY paid lines — unpaid tickets, other technicians, other tenants excluded', async () => {
    const r = await repo.serviceHistory({ tenantId: T } as any, ME);
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.serviceName).sort()).toEqual(['Builder Gel Refill', 'Gel Manicure']);
  });

  it('names the guest first-name + last-initial and shows the rating honestly (null when unrated)', async () => {
    const r = await repo.serviceHistory({ tenantId: T } as any, ME);
    const rated = r.items.find((i) => i.serviceName === 'Gel Manicure')!;
    const unrated = r.items.find((i) => i.serviceName === 'Builder Gel Refill')!;
    expect(rated.customerName).toBe('Maria J.');
    expect(rated.rating).toBe(5);
    expect(unrated.customerName).toBe('Lily');
    expect(unrated.rating).toBeNull();
  });

  it('the service filter narrows; the distinct-services list feeds the All-Services filter', async () => {
    const r = await repo.serviceHistory({ tenantId: T } as any, ME, 'Gel Manicure');
    expect(r.items).toHaveLength(1);
    expect(r.services).toEqual(['Builder Gel Refill', 'Gel Manicure']);
  });
});
