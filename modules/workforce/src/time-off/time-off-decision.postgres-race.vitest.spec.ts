// time-off-decision.postgres-race.vitest.spec.ts — REAL Postgres (PG_RACE_URL opt-in, our convention): ten managers decide
// the same pending time-off request at the same instant (half approve, half reject) → exactly ONE decision lands; every
// other is 409 already_decided; the row carries the winner's decision. Then a technician's withdraw races a manager's
// approval → exactly one of them wins. Merge Oct 12 2026 (BK) — the compare-and-set through TECHNICIAN_TIME_OFF.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { TechnicianTimeOffService } from './technician-time-off.service';

const url = process.env.PG_RACE_URL;
const T = 'a3000000-0000-4000-8000-0000000000aa', B = 'b3000000-0000-4000-8000-0000000000bb';
const TECH = 'c3000000-0000-4000-8000-0000000000cc', TECH_USER = 'e3000000-0000-4000-8000-0000000000ee';
const mgr = (i: number) => ({ tenantId: T, branchId: B, userId: `f3000000-0000-4000-8000-0000000000${String(10 + i)}`, role: 'MANAGER' });
const techCtx = { tenantId: T, branchId: B, userId: TECH_USER, role: 'TECHNICIAN' };
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('time-off decisions under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from technician_time_off where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race TO', 'Race TO', 'race-to', 'RACETO', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password) values (${TECH_USER}, ${T}, ${B}, 'Race Tech', 'race-to@x.test', 'active', 'TECHNICIAN', false, false) on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, status) values (${TECH}, ${T}, ${B}, ${TECH_USER}, 'Ria', 'Race', 'Ria Race', true, 'active') on conflict (id) do nothing`.execute(db);
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    await sql`delete from technician_time_off where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  for (let round = 1; round <= 3; round++) {
    it(`round ${round}: ten simultaneous decisions on one pending request → exactly one lands, nine are 409 already_decided`, async () => {
      const svc = new TechnicianTimeOffService(db as any, null, null);
      const req = await svc.requestMine(techCtx, { startsAt: `2999-08-0${round}T12:00:00Z`, endsAt: `2999-08-0${round + 1}T12:00:00Z`, kind: 'VACATION' });
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => svc.decide(mgr(i), TECH, req.id, i % 2 ? 'rejected' : 'approved', `m${i}`)));
      const won = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(won).toHaveLength(1);
      expect(lost.every((l) => (l.reason as any)?.code === 'already_decided')).toBe(true);
      const row = (await sql<any>`select status, decision_note, approved_by from technician_time_off where id = ${req.id}`.execute(db)).rows[0];
      expect(row.status).toBe(won[0].value.status);
      expect(row.decision_note).toBe(won[0].value.decisionNote);
    });
  }

  it('a withdraw racing an approval: exactly one of them wins, the row is approved XOR cancelled', async () => {
    const svc = new TechnicianTimeOffService(db as any, null, null);
    for (let i = 0; i < 5; i++) {
      const req = await svc.requestMine(techCtx, { startsAt: `2999-09-${String(10 + i)}T12:00:00Z`, endsAt: `2999-09-${String(11 + i)}T12:00:00Z` });
      const [a, w] = await Promise.allSettled([svc.decide(mgr(0), TECH, req.id, 'approved'), svc.cancelMine(techCtx, req.id)]);
      expect([a.status, w.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
      const st = (await sql<any>`select status from technician_time_off where id = ${req.id}`.execute(db)).rows[0].status;
      expect(st).toBe(a.status === 'fulfilled' ? 'approved' : 'cancelled');
    }
  });
});
