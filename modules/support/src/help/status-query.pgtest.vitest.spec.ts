// status-query.pgtest — runs StatusService.status() against a real Postgres engine (PGlite).
//
// Why: StatusService.rows() catches every error and returns []. A wrong column name therefore produces an
// EMPTY component list, and the POS System Status screen then shows no services at all while still reporting
// "All Systems Operational" — a silent failure that looks like a configuration issue, not a bug. The table
// here is created with the real column names from db/migrations/147_status_and_updates.sql.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { StatusService } from './status.service';

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

let svc: StatusService;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  await pg.exec(`
    create table status_components (id uuid primary key default gen_random_uuid(), key text not null unique,
      name text not null, status text not null default 'operational', sort_order integer not null default 0,
      updated_at timestamptz not null default now());
    create table status_incidents (id uuid primary key default gen_random_uuid(), title text not null,
      status text not null, impact text, started_at timestamptz, resolved_at timestamptz);

    insert into status_components (key, name, status, sort_order, updated_at) values
      ('api','API Gateway','operational',1,'2026-05-06T14:34:20Z'),
      ('sms','SMS Service','degraded',2,'2026-05-06T14:20:00Z');
    insert into status_incidents (title, status, impact, started_at, resolved_at) values
      ('SMS delivery delay','resolved','minor','2026-05-06T10:00:00Z','2026-05-06T11:00:00Z');
  `);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any,
    createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new StatusService(db);
});

describe('StatusService.status() against real Postgres', () => {
  it('returns every component — an empty list is how a broken query hides', async () => {
    const s = await svc.status();
    expect(s.components).toHaveLength(2);
    expect(s.components.map((c) => c.name)).toEqual(['API Gateway', 'SMS Service']);   // sort_order honoured
  });

  it('carries lastCheckedAt from status_components.updated_at', async () => {
    const s = await svc.status();
    const api = s.components.find((c) => c.key === 'api')!;
    expect(api.lastCheckedAt).toBe('2026-05-06T14:34:20.000Z');
    expect(api.status).toBe('operational');
  });

  it('derives overall from the worst component, not from the DB being reachable', async () => {
    const s = await svc.status();
    expect(s.overall.healthy).toBe(false);          // one component is degraded
    expect(s.incidents).toHaveLength(1);
  });
});
