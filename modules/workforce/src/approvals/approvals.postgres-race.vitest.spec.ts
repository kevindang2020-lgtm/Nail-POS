// approvals.postgres-race — BUILD_PLAN Phase 9 (agent D, RACEP9D): two approvers decide ONE request at the same moment →
// exactly one decision, one version bump, one execution, one approval.decided + one approval.executed event; the other
// gets 409. Real Postgres (opt-in: PG_RACE_URL=postgres://… a migrated database). DETERMINISTIC: a gate connection holds the
// request row FOR UPDATE, so both deciders are blocked on their own `select … for update` when the gate opens; the first
// commits approved (version 2), the second then reads version 2 ≠ the expected 1 → version_conflict, and its transaction
// writes nothing. The execution claim (execution_claimed_at, guarded UPDATE) is raced too: two execute() calls → one run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { TenantApprovalsService } from './approvals.service';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e9e9e9e9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), FD = id(3), M1 = id(4), M2 = id(5);
let pool: pg.Pool; let db: Kysely<any>;
const actor = (userId: string, role: string) => ({ tenantId: T, branchId: B, userId, role, permissions: [...((ROLE_PERMISSIONS as any)[role] ?? [])] });

async function cleanup() {
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from tenant_approval_requests where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from audit_logs where tenant_id = ${T}`.execute(db).catch(() => undefined);
}

describe.skipIf(!url)('real-Postgres approval decision race (RACEP9D)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P9D', 'Race P9D', 'race-p9d', 'RACEP9D', 'active') on conflict (id) do nothing`.execute(db);
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent approvals → one decision, one execution, the other 409', async () => {
    let runs = 0;
    const svc = new TenantApprovalsService(db, new OutboxWriter());
    svc.registerExecutor('refund', { execute: async () => { runs++; await new Promise((r) => setTimeout(r, 50)); return { ok: true }; } });
    const { request } = await svc.request(actor(FD, 'FRONT_DESK'), { kind: 'refund', subjectType: 'payment', subjectId: 'race-pay-1', amountCents: 30_000, reason: 'race refund' });

    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from tenant_approval_requests where id = $1 for update', [request.id]);
    const pending = Promise.allSettled([
      svc.decide(actor(M1, 'MANAGER'), request.id, { decision: 'approve', expectedVersion: 1 }),
      svc.decide(actor(M2, 'OWNER'), request.id, { decision: 'approve', expectedVersion: 1 }),
    ]);
    await new Promise((r) => setTimeout(r, 800));       // both are blocked on their FOR UPDATE
    await gate.query('commit'); gate.release();
    const results = await pending;

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'version_conflict', status: 409 });
    expect(runs).toBe(1);
    const row = (await sql<any>`select status, version from tenant_approval_requests where id = ${request.id}`.execute(db)).rows[0];
    expect(row).toEqual({ status: 'executed', version: 3 });
    const ev = async (t: string) => Number((await sql<any>`select count(*)::int as n from outbox_events where tenant_id = ${T} and aggregate_id = ${request.id} and event_type = ${t}`.execute(db)).rows[0].n);
    expect(await ev('approval.decided')).toBe(1);
    expect(await ev('approval.executed')).toBe(1);
  });

  it('two concurrent execute() calls on one approved request → the executor runs once', async () => {
    let runs = 0;
    const svc = new TenantApprovalsService(db, new OutboxWriter());
    svc.registerExecutor('other', { execute: async () => { runs++; await new Promise((r) => setTimeout(r, 100)); } });
    const { request } = await svc.request(actor(FD, 'FRONT_DESK'), { kind: 'other', subjectType: 'note', subjectId: 'race-note-1', reason: 'race execute' });
    // approve WITHOUT running (as if the approving process died before executing), then race two executors
    await sql`update tenant_approval_requests set status = 'approved', decided_by_user_id = ${M1}, version = version + 1 where id = ${request.id}`.execute(db);
    const out = await Promise.all([svc.execute(actor(M1, 'MANAGER'), request.id), svc.execute(actor(M2, 'OWNER'), request.id)]);
    expect(out.filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });
});
