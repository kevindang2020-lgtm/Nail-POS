// compensation-agreements.pgtest.vitest.spec.ts — KyselyAgreementsRepo against real PG: create (transactional) writes a
// versioned agreement + JSONB terms and supersedes the prior; acknowledge flips a 'sent' agreement to 'acknowledged' and
// won't re-acknowledge. Applies only migration 414.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyAgreementsRepo } from './compensation-agreements.repository';

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

const ctx = { tenantId: 'ee000000-0000-0000-0000-000000000001', userId: 'ee000000-0000-0000-0000-0000000000f1' };
const TECH = 'ee000000-0000-0000-0000-0000000000c1';
let repo: KyselyAgreementsRepo;

beforeAll(async () => {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/414_compensation_agreements.sql`, 'utf8'));
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyAgreementsRepo(db as any);
});

describe('KyselyAgreementsRepo (real PG)', () => {
  it('creates a versioned agreement with JSONB terms and supersedes the prior one', async () => {
    const v1 = await repo.create(ctx, { technicianId: TECH, title: 'v1', terms: { commissionPercent: 60 } });
    expect(v1).toMatchObject({ status: 'sent', version: 1 });
    expect(v1.terms).toEqual({ commissionPercent: 60 });
    const v2 = await repo.create(ctx, { technicianId: TECH, title: 'v2', terms: { commissionPercent: 65 } });
    expect(v2.version).toBe(2);
    const list = await repo.list(ctx, TECH);
    expect(list.find((a) => a.title === 'v1')!.status).toBe('superseded');
    expect(list.find((a) => a.title === 'v2')!.status).toBe('sent');
  });

  it('acknowledges a sent agreement and will not re-acknowledge', async () => {
    const list = await repo.list(ctx, TECH);
    const sent = list.find((a) => a.status === 'sent')!;
    const ack = await repo.acknowledge(ctx, sent.id, TECH, ctx.userId);
    expect(ack?.status).toBe('acknowledged');
    expect(ack?.acknowledgedAt).not.toBeNull();
    expect(await repo.acknowledge(ctx, sent.id, TECH, ctx.userId)).toBeNull(); // already acknowledged
  });
});
