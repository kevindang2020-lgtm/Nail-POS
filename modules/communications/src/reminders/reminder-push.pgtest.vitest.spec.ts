/**
 * reminder-push.pgtest.vitest.spec.ts — persistence pillar for the reminder push channel (Jul 26, 2026).
 * Runs the REAL KyselyRemindersRepository.dueCandidates against the fully-migrated schema and pins:
 *   - customerUserId resolves from customers.user_id via the appointment's customer link
 *   - an appointment whose customer has no linked account (or no customer row) yields customerUserId null
 *   - the query stays tenant-scoped: an identical appointment in another tenant never appears
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyRemindersRepository } from './reminders.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'ee000000-0000-0000-0000-000000000001';
const T2 = 'ee000000-0000-0000-0000-000000000002';
const BR = 'ee000000-0000-0000-0000-0000000000b1';
const TECH = 'ee000000-0000-0000-0000-0000000000e1';
const CUST_LINKED = 'ee000000-0000-0000-0000-0000000000c1';
const CUST_UNLINKED = 'ee000000-0000-0000-0000-0000000000c2';
const USER = 'ee000000-0000-0000-0000-0000000000f1';

let pg: PGlite;
let repo: KyselyRemindersRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyRemindersRepository(db as any);

  for (const [tid, code] of [[T, 'REMA'], [T2, 'REMB']] as const) {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D',$2,$2)`, [tid, code]);
  }
  await q(`insert into users (id, tenant_id, email, password_hash, role, full_name) values ($1,$2,'push@t.test','x','CUSTOMER','Push Cust')`, [USER, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) values ($1,$2,$3,'Linked','Cust','Linked Cust',$4)`, [CUST_LINKED, T, BR, USER]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Unlinked','Cust','Unlinked Cust')`, [CUST_UNLINKED, T, BR]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lisa','R','Lisa R')`, [TECH, T, BR]);

  const appt = async (id: string, tid: string, custId: string | null) =>
    q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status)
       values ($1,$2,$3,$4,$5,'G','+1',false,'online','[]','2026-06-02','12:30','13:15',45,'booked')`, [id, tid, BR, custId, TECH]);
  await appt('ee000000-0000-0000-0000-0000000000a1', T, CUST_LINKED);
  await appt('ee000000-0000-0000-0000-0000000000a2', T, CUST_UNLINKED);
  await appt('ee000000-0000-0000-0000-0000000000a3', T, null); // walk-in style: no customer row at all
  // same-shaped appointment in ANOTHER tenant — needs its own tech to satisfy FKs
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Z','Ana Z')`, ['ee000000-0000-0000-0000-0000000000e2', T2, BR]);
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, customer_id, technician_id, customer_name, customer_phone, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status)
           values ('ee000000-0000-0000-0000-0000000000a9',$1,$2,null,'ee000000-0000-0000-0000-0000000000e2','Other','+2',false,'online','[]','2026-06-02','12:30','13:15',45,'booked')`, [T2, BR]);
});

describe('reminders dueCandidates — linked-account resolution (real schema)', () => {
  it('resolves customers.user_id for linked customers, null otherwise, and never leaks across tenants', async () => {
    const rows = await repo.dueCandidates(T, '2026-06-02', '2026-06-02');
    const byId = new Map(rows.map((r) => [r.appointmentId, r]));
    expect(byId.size).toBe(3); // the other tenant's identical appointment is absent
    expect(byId.get('ee000000-0000-0000-0000-0000000000a1')?.customerUserId).toBe(USER);
    expect(byId.get('ee000000-0000-0000-0000-0000000000a2')?.customerUserId ?? null).toBeNull();
    expect(byId.get('ee000000-0000-0000-0000-0000000000a3')?.customerUserId ?? null).toBeNull();
    expect(byId.has('ee000000-0000-0000-0000-0000000000a9')).toBe(false);
  });
});
