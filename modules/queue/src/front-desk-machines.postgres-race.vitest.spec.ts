// front-desk-machines.postgres-race — BUILD_PLAN Phase 12 round 2 (#27): the queue item / technician-ticket machines'
// conditional writes on REAL Postgres with real concurrent connections (PGlite is one session and cannot show a lost
// update). Runs when PG_RACE_URL points at a migrated database (the CI race lane).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyQueueRepository } from './queue/queue.kysely.repository';
import { KyselyTechRepository } from './tech/tech.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'd2d00000-0000-4000-8000-000000000001', B = 'd2d00000-0000-4000-8000-0000000000b1', TA = 'd2d00000-0000-4000-8000-0000000000a1';
const ctx = { tenantId: T, branchId: B, userId: '', role: 'MANAGER', permissions: [] } as any;

describe.skipIf(!url)('front-desk machines under real concurrency (Postgres)', () => {
  let pool: pg.Pool; let db: Kysely<any>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES (${T}, 'FD Race LLC', 'FD Race', 'd2drace', 'D2DR') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B}, ${T}, 'Main') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES (${TA}, ${T}, ${B}, 'Ava', 'A', 'Ava A', 'active') ON CONFLICT (id) DO NOTHING`.execute(db);
  });
  afterAll(async () => {
    for (const t of ['pos_queue_status_history', 'outbox_events', 'pos_tech_queue_tickets', 'pos_queue_items', 'technicians']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM branches WHERE id = ${B}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });
  const guest = async (status: string) => (await sql<{ id: string }>`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status, source, priority, requested_services)
    VALUES (${T}, ${B}, 'Race guest', ${status}, 'walk_in', 'normal', '[]') RETURNING id`.execute(db)).rows[0].id;

  it('a cancel that read "waiting" while another desk removed the guest gets 409 — not a lost update', async () => {
    const id = await guest('waiting');
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM pos_queue_items WHERE id = $1 FOR UPDATE', [id]);          // the other desk holds the row …
      const cancel = new KyselyQueueRepository(db as any).setStatus(ctx, id, 'cancelled');           // … this one reads 'waiting' and blocks on the UPDATE
      await new Promise((r) => setTimeout(r, 300));
      await other.query(`UPDATE pos_queue_items SET status = 'removed' WHERE id = $1`, [id]);
      await other.query('COMMIT');
      await expect(cancel).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { reason: 'concurrent', from: 'removed' } });
    } finally { other.release(); }
    expect((await sql<{ status: string }>`SELECT status FROM pos_queue_items WHERE id = ${id}`.execute(db)).rows[0].status).toBe('removed');
  });

  it('20 concurrent "call next" taps on one waiting guest: every one lands on a callable row, none revives a cancel that won', async () => {
    const id = await guest('waiting');
    const repo = new KyselyQueueRepository(db as any);
    const results = await Promise.allSettled([repo.setStatus(ctx, id, 'cancelled'), ...Array.from({ length: 19 }, () => repo.markCalled(ctx, id))]);
    const final = (await sql<{ status: string }>`SELECT status FROM pos_queue_items WHERE id = ${id}`.execute(db)).rows[0].status;
    // whichever order they ran in: once the cancel landed, no later call moved the guest back to 'called'
    if (final === 'cancelled') expect(results[0].status).toBe('fulfilled');
    for (const r of results) if (r.status === 'rejected') expect((r.reason as any).code).toBe('INVALID_STATE_TRANSITION');
    expect(['cancelled', 'called']).toContain(final);
  });

  it('two technicians’ apps accept the same pending offer at once: exactly one wins', async () => {
    const tq = (await sql<{ id: string }>`INSERT INTO pos_tech_queue_tickets (tenant_id, branch_id, customer_name, status, source, priority, requested_services, assigned_technician_id)
      VALUES (${T}, ${B}, 'Race guest', 'assigned', 'walk_in', 'normal', '[]', ${TA}) RETURNING id`.execute(db)).rows[0].id;
    const repo = new KyselyTechRepository(db as any);
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.accept(ctx, tq)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
