// technicians-audit.pgtest.vitest.spec.ts — the row LANDS. Not "the code looks right": the row lands.
//
// `KyselyLoginAttemptSink` looked correct, was unit-tested green, and silently lost every record in production
// because `login_attempts.ip_address` is INET and Express hands you a proxy chain. The Super Admin Security
// dashboard went right on reporting zero failed logins.
//
// The POS technician audit was worse: it never had a sink at all. It pushed onto an array in memory and the
// tests read the array back, so the suite was green while `audit_logs` contained not one technician event.
//
// A unit test that asserts a mock was called proves the code called a mock. This asks the DATABASE.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTechniciansAuditSink } from './technicians-audit.kysely';
import { TechniciansService } from './technicians.service';
import { InMemoryTechniciansRepository } from './technicians.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH = 'a1111111-1111-1111-1111-111111111111';
const MANAGER = 'a2222222-2222-2222-2222-222222222222';

let pg: PGlite;
let db: any;

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* pg_trgm / btree_gist */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}, 180000);

const ctx = { tenantId: TENANT, branchId: BRANCH, userId: MANAGER, role: 'MANAGER', permissions: ['pos.technicians.create', 'pos.technicians.status_change'] };

describe('the POS technician audit trail reaches the database', () => {
  it('a recorded event is IN audit_logs — with its tenant, its actor, and its metadata', async () => {
    const sink = new KyselyTechniciansAuditSink(db);
    await sink.record({
      tenantId: TENANT, branchId: BRANCH, userId: MANAGER, role: 'MANAGER',
      actionType: 'pos_technician_suspended', entityType: 'pos_technician', entityId: 'tech-1',
      metadata: { reason: 'no-show' }, createdAt: new Date().toISOString(),
    });

    const r: any = await pg.query(
      `select tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json
         from audit_logs where action_type = 'pos_technician_suspended'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].tenant_id).toBe(TENANT);
    expect(r.rows[0].user_id).toBe(MANAGER);
    expect(r.rows[0].entity_id).toBe('tech-1');
    expect(r.rows[0].metadata_json).toMatchObject({ reason: 'no-show' });
  });

  it('before/after collapse into the one JSONB column rather than fragmenting the trail', async () => {
    const sink = new KyselyTechniciansAuditSink(db);
    await sink.record({
      tenantId: TENANT, branchId: BRANCH, userId: MANAGER, role: 'MANAGER',
      actionType: 'pos_technician_commission_updated', entityType: 'pos_technician_commission', entityId: 'tech-2',
      before: { defaultPercent: 40 }, after: { defaultPercent: 45 }, createdAt: new Date().toISOString(),
    });
    const r: any = await pg.query(`select metadata_json from audit_logs where entity_id = 'tech-2'`);
    expect(r.rows[0].metadata_json).toMatchObject({ before: { defaultPercent: 40 }, after: { defaultPercent: 45 } });
  });

  it('a non-uuid tenant does not throw and does not fabricate a row with a broken key', async () => {
    // The INET lesson, generalised: a value the column cannot hold must not take the whole record down with it.
    const sink = new KyselyTechniciansAuditSink(db);
    await expect(sink.record({
      tenantId: 'not-a-uuid', userId: 'nope', role: 'MANAGER',
      actionType: 'pos_technicians_viewed', entityType: 'pos_technician', createdAt: new Date().toISOString(),
    })).resolves.toBeUndefined();
    const r: any = await pg.query(`select tenant_id, user_id from audit_logs where action_type = 'pos_technicians_viewed'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].tenant_id).toBeNull();
  });

  it('THE REAL SERVICE: creating a technician writes pos_technician_created to audit_logs', async () => {
    // Not the sink in isolation — the service that every POS hire actually goes through. Before this session it
    // pushed the event onto an array and the array was the only place it ever went.
    const svc = new TechniciansService(new InMemoryTechniciansRepository(), undefined, undefined, new KyselyTechniciansAuditSink(db));
    await svc.create(ctx as any, { firstName: 'Olivia', lastName: 'Brown', phone: '8565551234' } as any);
    await svc.flushAudit();

    const r: any = await pg.query(`select tenant_id, action_type from audit_logs where action_type = 'pos_technician_created'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].tenant_id).toBe(TENANT);

    // and the in-memory array the Nest-free harness reads is still populated — the fixture was not deleted to
    // make the feature look finished.
    expect(svc.auditLog().some((l) => l.actionType === 'pos_technician_created')).toBe(true);
  });

  it('suspending a technician is recorded too — with the reason the manager had to give', async () => {
    const svc = new TechniciansService(new InMemoryTechniciansRepository(), undefined, undefined, new KyselyTechniciansAuditSink(db));
    const row = await svc.create(ctx as any, { firstName: 'Ana', lastName: 'Lee' } as any);
    await svc.suspend(ctx as any, row.technicianId, { reason: 'repeated no-shows' } as any);
    await svc.flushAudit();

    const r: any = await pg.query(
      `select metadata_json from audit_logs where action_type = 'pos_technician_suspended' and entity_id = $1`, [row.technicianId]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].metadata_json).toMatchObject({ reason: 'repeated no-shows' });
  });
});
