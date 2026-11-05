// access-review.postgres-race.vitest.spec — BUILD_PLAN Phase 9 (RACEP9B): two owners record a decision for the SAME person
// in the same access review at the same moment — one says keep, the other revoke. Real Postgres (opt-in: PG_RACE_URL=
// postgres://… a migrated database). DETERMINISTIC: a gate connection holds the person's review item FOR UPDATE, so both
// decisions have passed their reads (each sees the item undecided) and are blocked on the claim UPDATE when the gate
// opens; the second re-checks `decision is null` against the committed row and claims nothing → 409 CONFLICT, and — if
// it was the revoke — the account is untouched. Exactly one decision and one audit row exist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { permissionsFor } from '@aipowersalon/permissions';
import { AccessGovernanceService, GovernanceError } from './access-governance.service';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e9b9b9b9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), O1 = id(2), O2 = id(3), TECH = id(4);
let pool: pg.Pool; let db: Kysely<any>;

describe.skipIf(!url)('real-Postgres access-review decision race (RACEP9B)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P9B', 'Race P9B', 'race-p9b', 'RACEP9B', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, role, email, full_name, status) values
        (${O1}, ${T}, 'OWNER', 'race-p9b-1@x.test', 'Owner One', 'active'), (${O2}, ${T}, 'OWNER', 'race-p9b-2@x.test', 'Owner Two', 'active'),
        (${TECH}, ${T}, 'TECHNICIAN', 'race-p9b-t@x.test', 'Tech', 'active')
      on conflict (id) do update set status = 'active'`.execute(db);
    await sql`delete from access_reviews where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from access_reviews where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from users where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('keep and revoke at once → exactly one decision; the loser is 409 and changes nothing', async () => {
    const svc = new AccessGovernanceService(db as any, null, null);
    const actor = (userId: string) => ({ tenantId: T, userId, role: 'OWNER', permissions: permissionsFor('OWNER') });
    const review = await svc.startReview(actor(O1), {});
    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from access_review_items where review_id = $1 and user_id = $2 for update', [review.id, TECH]);
    const pending = Promise.allSettled([
      svc.decide(actor(O1), review.id, { userId: TECH, decision: 'keep' }),
      svc.decide(actor(O2), review.id, { userId: TECH, decision: 'revoke', note: 'left' }),
    ]);
    await new Promise((r) => setTimeout(r, 700));   // both read the item undecided and wait on its row lock
    await gate.query('commit'); gate.release();
    const results = await pending;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(GovernanceError);
    expect(lost.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
    const item = (await sql<any>`select decision from access_review_items where review_id = ${review.id} and user_id = ${TECH}`.execute(db)).rows[0];
    const user = (await sql<any>`select status from users where id = ${TECH}`.execute(db)).rows[0];
    expect(user.status).toBe(item.decision === 'revoke' ? 'inactive' : 'active');   // the account follows the ONE decision recorded
    const audits = (await sql<any>`select count(*)::int as n from authorization_audit_events where tenant_id = ${T} and target_user_id = ${TECH} and action = 'access_review.decided' and after_state->>'reviewId' = ${review.id}`.execute(db)).rows[0];
    expect(audits.n).toBe(1);
  });
});
