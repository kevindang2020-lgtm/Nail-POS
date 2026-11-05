// community.postgres-race.vitest.spec — BUILD_PLAN Phase 8 (agent A, RACEP8A): two approvers approve ONE advisory at the
// same moment → exactly one transition, one version bump, one APPROVED + one PUBLISHED outbox event; the other gets 409.
// Real Postgres (opt-in: PG_RACE_URL=postgres://… a migrated database). DETERMINISTIC: a gate connection holds the post
// row FOR UPDATE, so both approvers have read version N and are blocked on their compare-and-set UPDATE when the gate
// opens; the loser's UPDATE re-checks `version = N and status = 'manager_approval'` against the committed row, matches
// nothing, and its transaction (with its event) rolls back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCommunityRepo } from './community.repository';
import { CommunityService } from './community.service';
import { OutboxCommunityEvents } from './community-events';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e8e8e8e8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), M1 = id(3), M2 = id(4), AUTHOR = id(5), POST = id(6);
let pool: pg.Pool; let db: Kysely<any>;

async function cleanup() {
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from community_post_versions where post_id = ${POST}`.execute(db).catch(() => undefined);
  await sql`delete from community_posts where origin_tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from community_rules_acknowledgments where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from tenant_community_settings where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from audit_logs where tenant_id = ${T}`.execute(db).catch(() => undefined);
}

describe.skipIf(!url)('real-Postgres community approval race (RACEP8A)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P8A', 'Race P8A', 'race-p8a', 'RACEP8A', 'active') on conflict (id) do nothing`.execute(db);
    await cleanup();
    await sql`insert into tenant_community_settings (tenant_id, enabled) values (${T}, true)`.execute(db);
    await sql`insert into community_posts (id, origin_tenant_id, origin_branch_id, status, category, severity, title, redacted_body, created_by_user_id, version)
      values (${POST}, ${T}, ${B}, 'manager_approval', 'gift_card_scam', 'moderate', 'Race advisory', 'a caller asked for gift cards', ${AUTHOR}, 2)`.execute(db);
  });
  afterAll(async () => {
    await cleanup();
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent approvals → one transition, one event pair, the other 409 version_conflict', async () => {
    const svc = new CommunityService(new KyselyCommunityRepo(db), { events: new OutboxCommunityEvents(db, new OutboxWriter()) });
    const m1 = { tenantId: T, branchId: B, userId: M1, role: 'MANAGER' };
    const m2 = { tenantId: T, branchId: B, userId: M2, role: 'OWNER' };

    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from community_posts where id = $1 for update', [POST]);
    const pending = Promise.allSettled([svc.approveAdvisory(m1, POST, { expectedVersion: 2 }), svc.approveAdvisory(m2, POST, { expectedVersion: 2 })]);
    await new Promise((r) => setTimeout(r, 800));       // both have read version 2 and are blocked on their UPDATE
    await gate.query('commit'); gate.release();
    const results = await pending;

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'version_conflict', status: 409 });
    const row = (await sql<any>`select status, version, visibility from community_posts where id = ${POST}`.execute(db)).rows[0];
    expect(row).toEqual({ status: 'published_unverified', version: 3, visibility: 'community_published' });
    const ev = (await sql<any>`select event_type from outbox_events where aggregate_id = ${POST} order by event_type`.execute(db)).rows.map((r) => r.event_type);
    expect(ev).toEqual(['community.advisory_approved', 'community.advisory_published']);
    expect((await sql<any>`select count(*)::int as n from community_post_versions where post_id = ${POST}`.execute(db)).rows[0].n).toBe(1);
  });
});
