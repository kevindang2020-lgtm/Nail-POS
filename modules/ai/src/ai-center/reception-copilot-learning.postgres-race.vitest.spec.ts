// BUILD_PLAN Phase 12 (#27): two managers approve the SAME Copilot learning suggestion at the same instant. Before, both
// read it open, both wrote a knowledge version, both flipped it: two versions. Now the open → approved move is the
// conditional claim inside the transaction that writes the version — exactly one approval wins, the other is told the
// suggestion is no longer open, ONE knowledge version. Real Postgres (opt-in: PG_RACE_URL=a migrated database).
// DETERMINISTIC: a gate connection holds the suggestion row FOR UPDATE until both approvals are blocked on it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ReceptionCopilotLearningService } from './reception-copilot-learning.service';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `c2c2c2c2-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), U = id(2), SUG = id(3);
let pool: pg.Pool; let db: Kysely<any>;
const ctx = { tenantId: T, branchId: null, userId: U, role: 'OWNER', permissions: ['reception_copilot.approve_learning'] };

describe.skipIf(!url)('real-Postgres Copilot learning approval race (RACEP12C)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 6 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P12C', 'Race P12C', 'race-p12c', 'RACEP12C', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, role, email) values (${U}, ${T}, 'OWNER', 'race-p12c@x.test') on conflict (id) do nothing`.execute(db);
    await sql`delete from reception_copilot_knowledge_versions where tenant_id = ${T}`.execute(db);
    await sql`delete from reception_copilot_learning_suggestions where tenant_id = ${T}`.execute(db);
    await sql`insert into reception_copilot_learning_suggestions (id, tenant_id, kind, suggestion, status) values (${SUG}, ${T}, 'faq', 'We close at 7 on Fridays', 'open')`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from reception_copilot_knowledge_versions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from reception_copilot_learning_suggestions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from users where id = ${U}`.execute(db).catch(() => undefined);
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent approvals → one approved, one NOT_FOUND, exactly one knowledge version', async () => {
    const svc = new ReceptionCopilotLearningService(db as any, {} as any);
    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select 1 from reception_copilot_learning_suggestions where id = $1 for update', [SUG]);
    const both = Promise.allSettled([svc.approveSuggestion(ctx as any, SUG), svc.approveSuggestion(ctx as any, SUG)]);
    await new Promise((r) => setTimeout(r, 400));   // both are now blocked on the conditional UPDATE
    await gate.query('commit'); gate.release();
    const r = await both;
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });
    expect((await sql<{ n: number }>`select count(*)::int as n from reception_copilot_knowledge_versions where tenant_id = ${T}`.execute(db)).rows[0].n).toBe(1);
    expect((await sql<{ status: string }>`select status from reception_copilot_learning_suggestions where id = ${SUG}`.execute(db)).rows[0].status).toBe('approved');
  });
});
